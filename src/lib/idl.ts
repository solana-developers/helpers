import { type Connection, type MessageCompiledInstruction, PublicKey } from "@solana/web3.js";
import {
  addDecoderSizePrefix,
  fixDecoderSize,
  getAddressDecoder,
  getBase64Encoder,
  getBytesDecoder,
  getStructDecoder,
  getU32Decoder,
} from "@solana/kit";
import {
  Compression,
  DataSource,
  decodeData,
  Encoding,
  findCanonicalPda,
  findNonCanonicalPda,
  getMetadataDecoder,
  type Metadata,
  uncompressData,
  unpackDirectData,
  unpackExternalData,
  unpackUrlData,
} from "@solana-program/program-metadata";
import { type AnchorIdl, rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import {
  type AccountNode,
  type DiscriminatorNode,
  type EventNode,
  type InstructionNode,
  isNode,
  type ProgramNode,
  type RootNode,
  STANDALONE_VALUE_NODE_KINDS,
} from "@codama/nodes";
import { containsBytes, getCodecAndValueVisitors } from "@codama/dynamic-codecs";
import {
  getRecordLinkablesVisitor,
  LinkableDictionary,
  NodeStack,
  visit,
} from "@codama/visitors-core";

import { MAX_SUPPORTED_TRANSACTION_VERSION } from "./rpc.js";
export type { AnchorIdl };

/**
 * An Anchor IDL (from any version of Anchor), or a Codama IDL
 */
export type Idl = AnchorIdl | RootNode;

const isCodamaIdl = (idl: Idl): idl is RootNode => {
  return "standard" in idl && idl.standard === "codama";
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

// Checks the shape of IDLs from files and onchain, so a malformed IDL fails here
// with a clear message rather than later while decoding.
const assertIsIdl: (value: unknown, source: string) => asserts value is Idl = (value, source) => {
  if (isRecord(value) && value.standard === "codama" && value.kind === "rootNode") {
    return;
  }
  // Anchor 0.30 and later
  if (
    isRecord(value) &&
    isRecord(value.metadata) &&
    typeof value.address === "string" &&
    Array.isArray(value.instructions)
  ) {
    return;
  }
  // Legacy Anchor IDLs, from before Anchor 0.30
  if (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    Array.isArray(value.instructions)
  ) {
    return;
  }
  throw new Error(`${source} is not an Anchor or Codama IDL`);
};

const parseIdl = (content: string, source: string): Idl => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  assertIsIdl(parsed, source);
  return parsed;
};

/**
 * Account, instruction, and event data decoded using an IDL.
 * Integers larger than 32 bits are `bigint`s, public keys are base58 strings,
 * and plain bytes are `["base64", string]` tuples.
 */
export type DecodedData = Record<string, unknown>;

// Anchor 1.0 and later publish IDLs with the Program Metadata program, using this seed
// See https://github.com/solana-program/program-metadata
const PROGRAM_METADATA_IDL_SEED = "idl";

// Earlier versions of Anchor store the IDL in an account at an address derived from the program ID
// See https://github.com/solana-foundation/anchor/blob/master/lang/src/idl.rs
const LEGACY_IDL_ACCOUNT_SEED = "anchor:idl";
// Anchor's 'IdlAccount': an 8 byte discriminator, the authority, then the zlib-compressed IDL JSON
const LEGACY_IDL_ACCOUNT_DISCRIMINATOR_SIZE = 8;
const getLegacyIdlAccountDecoder = () =>
  getStructDecoder([
    ["discriminator", fixDecoderSize(getBytesDecoder(), LEGACY_IDL_ACCOUNT_DISCRIMINATOR_SIZE)],
    ["authority", getAddressDecoder()],
    ["data", addDecoderSizePrefix(getBytesDecoder(), getU32Decoder())],
  ]);

// Anchor programs emit events by logging their base64-encoded data
// See https://github.com/solana-foundation/anchor/blob/master/ts/packages/anchor/src/program/event.ts
const PROGRAM_DATA_LOG_PREFIX = "Program data: ";
// Programs built with older versions of Anchor used 'Program log:' for events
const PROGRAM_LOG_PREFIX = "Program log: ";
const PROGRAM_INVOKE_LOG = /^Program (\S+) invoke \[\d+\]$/;
const PROGRAM_EXIT_LOG = /^Program (\S+) (success|failed)/;

type ProgramContext = {
  program: ProgramNode;
  programId: PublicKey;
  codecVisitor: ReturnType<typeof getCodecAndValueVisitors>["codecVisitor"];
  valueVisitor: ReturnType<typeof getCodecAndValueVisitors>["valueVisitor"];
};

const getProgramContext = (idl: Idl, programId?: PublicKey): ProgramContext => {
  const root = isCodamaIdl(idl) ? idl : rootNodeFromAnchor(idl);
  const program = root.program;
  // Legacy IDLs don't always include the program's address
  const programAddress = programId?.toBase58() ?? program.publicKey;
  if (!programAddress) {
    throw new Error(`The IDL does not include the program's address, please provide the programId`);
  }
  const linkables = new LinkableDictionary();
  visit(root, getRecordLinkablesVisitor(linkables));
  const { codecVisitor, valueVisitor } = getCodecAndValueVisitors(linkables, {
    stack: new NodeStack([root, program]),
  });
  return {
    program,
    programId: new PublicKey(programAddress),
    codecVisitor,
    valueVisitor,
  };
};

const getDiscriminatorFields = (node: AccountNode | InstructionNode) => {
  if (node.kind === "instructionNode") {
    return node.arguments ?? [];
  }
  return node.data.kind === "structTypeNode" ? (node.data.fields ?? []) : [];
};

const discriminatorMatches = (
  context: ProgramContext,
  node: AccountNode | InstructionNode | EventNode,
  discriminator: DiscriminatorNode,
  data: Uint8Array,
): boolean => {
  if (discriminator.kind === "sizeDiscriminatorNode") {
    return data.length === discriminator.size;
  }
  if (discriminator.kind === "constantDiscriminatorNode") {
    const codec = visit(discriminator.constant.type, context.codecVisitor);
    const expectedBytes = codec.encode(visit(discriminator.constant.value, context.valueVisitor));
    return containsBytes(data, expectedBytes, discriminator.offset);
  }
  // A field discriminator is a field whose default value identifies the node, like Anchor's
  // 8 byte 'discriminator' field at the start of account and instruction data.
  if (node.kind === "eventNode") {
    return false;
  }
  const field = getDiscriminatorFields(node).find((field) => field.name === discriminator.name);
  const defaultValue = field?.defaultValue;
  if (!field || !isNode(defaultValue, STANDALONE_VALUE_NODE_KINDS)) {
    return false;
  }
  const codec = visit(field.type, context.codecVisitor);
  const expectedBytes = codec.encode(visit(defaultValue, context.valueVisitor));
  return containsBytes(data, expectedBytes, discriminator.offset);
};

// Nodes without discriminators can't be identified from their data, so never match
const nodeMatchesData = (
  context: ProgramContext,
  node: AccountNode | InstructionNode | EventNode,
  data: Uint8Array,
): boolean => {
  const discriminators = node.discriminators ?? [];
  return (
    discriminators.length > 0 &&
    discriminators.every((discriminator) =>
      discriminatorMatches(context, node, discriminator, data),
    )
  );
};

const findNodeForData = <TNode extends AccountNode | InstructionNode | EventNode>(
  context: ProgramContext,
  nodes: Array<TNode>,
  data: Uint8Array,
): TNode | null => {
  return nodes.find((node) => nodeMatchesData(context, node, data)) ?? null;
};

const decodeNodeData = (
  context: ProgramContext,
  node: AccountNode | InstructionNode | EventNode,
  data: Uint8Array,
): DecodedData => {
  const decoded = visit(node, context.codecVisitor).decode(data) as DecodedData;
  // Discriminator fields identify the account or instruction type, they aren't part of its data
  const discriminatorFieldNames = (node.discriminators ?? []).flatMap((discriminator) =>
    discriminator.kind === "fieldDiscriminatorNode" ? [discriminator.name] : [],
  );
  return Object.fromEntries(
    Object.entries(decoded).filter(
      ([key]) => !discriminatorFieldNames.some((fieldName) => fieldName === key),
    ),
  );
};

const decodeAccountData = (context: ProgramContext, data: Uint8Array): DecodedData | null => {
  const accountNode = findNodeForData(context, context.program.accounts ?? [], data);
  if (!accountNode) {
    return null;
  }
  return decodeNodeData(context, accountNode, data);
};

// Program Metadata accounts can hold their data directly, point to a URL,
// or point to part of another account's data.
const getProgramMetadataContent = async (
  connection: Connection,
  metadata: Metadata,
): Promise<string> => {
  if (metadata.dataSource === DataSource.Direct) {
    return unpackDirectData(metadata);
  }

  if (metadata.dataSource === DataSource.Url) {
    const url = unpackUrlData(metadata);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not fetch IDL from ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  const { address, offset = 0, length } = unpackExternalData(metadata.data);
  const externalAccount = await connection.getAccountInfo(new PublicKey(address));
  if (!externalAccount) {
    throw new Error(`The account ${address} holding the IDL was not found`);
  }
  const externalData = externalAccount.data.slice(
    offset,
    length === undefined ? undefined : offset + length,
  );
  return decodeData(uncompressData(externalData, metadata.compression), metadata.encoding);
};

/**
 * Loads an Anchor or Codama IDL from a local file path
 *
 * @param idlPath - Path to the IDL JSON file
 * @returns The parsed IDL
 *
 * @example
 * ```typescript
 * const idl = await getIdlByPath("./idl/program.json");
 * ```
 */
export async function getIdlByPath(idlPath: string): Promise<Idl> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  const idlFile = await readFile(path.resolve(idlPath), "utf8");
  return parseIdl(idlFile, `The IDL file '${idlPath}'`);
}

/**
 * Fetches a program's IDL from onchain
 *
 * Looks for an IDL published with the Program Metadata program (what Anchor 1.0 and later use,
 * and where Codama IDLs are published), then for a legacy Anchor IDL account (what earlier
 * versions of Anchor use).
 *
 * @param programId - Public key of the program
 * @param connection - The Solana connection object
 * @param authority - Optional authority of a non-canonical IDL, ie one published with
 * `--non-canonical` by an account other than the program's upgrade authority. When provided,
 * only that authority's IDL is fetched.
 * @returns The fetched Anchor or Codama IDL
 * @throws If IDL cannot be found for the program, or isn't an Anchor or Codama IDL
 *
 * @example
 * ```typescript
 * const idl = await getIdlByProgramId(
 *   new PublicKey("verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC"),
 *   connection,
 * );
 * ```
 */
export async function getIdlByProgramId(
  programId: PublicKey,
  connection: Connection,
  authority?: PublicKey,
): Promise<Idl> {
  const program = programId.toBase58();
  const [programMetadataAddress] = authority
    ? await findNonCanonicalPda({
        program,
        authority: authority.toBase58(),
        seed: PROGRAM_METADATA_IDL_SEED,
      })
    : await findCanonicalPda({ program, seed: PROGRAM_METADATA_IDL_SEED });

  const [legacyIdlBase] = await PublicKey.findProgramAddress([], programId);
  const legacyIdlAddress = await PublicKey.createWithSeed(
    legacyIdlBase,
    LEGACY_IDL_ACCOUNT_SEED,
    programId,
  );

  const [programMetadataAccount, legacyIdlAccount] = await connection.getMultipleAccountsInfo([
    new PublicKey(programMetadataAddress),
    legacyIdlAddress,
  ]);

  if (programMetadataAccount) {
    const metadata = getMetadataDecoder().decode(programMetadataAccount.data);
    return parseIdl(
      await getProgramMetadataContent(connection, metadata),
      `The IDL published for program ${program}`,
    );
  }

  // Legacy IDL accounts aren't tied to an authority
  if (legacyIdlAccount && !authority) {
    const { data } = getLegacyIdlAccountDecoder().decode(legacyIdlAccount.data);
    const idlJson = decodeData(uncompressData(data, Compression.Zlib), Encoding.Utf8);
    return parseIdl(idlJson, `The IDL published for program ${program}`);
  }

  const authorityDescription = authority ? ` by authority ${authority.toBase58()}` : "";
  throw new Error(`IDL not found for program ${program}${authorityDescription}`);
}

/**
 * Fetches and parses an account's data using an Anchor IDL
 *
 * @param idl - The Anchor or Codama IDL (use getIdlByProgramId or getIdlByPath to obtain)
 * @param accountName - The name of the account as defined in the IDL, in camelCase
 * @param accountAddress - The public key of the account to fetch
 * @param connection - The Solana connection object
 * @param programId - Optional program ID, needed for legacy IDLs that don't include the program's address
 * @returns The decoded account data
 *
 * @example
 * ```typescript
 * const idl = await getIdlByProgramId(programId, connection);
 * const data = await getIdlParsedAccountData(idl, "counter", accountAddress, connection);
 * ```
 */
export async function getIdlParsedAccountData<T = DecodedData>(
  idl: Idl,
  accountName: string,
  accountAddress: PublicKey,
  connection: Connection,
  programId?: PublicKey,
): Promise<T> {
  const context = getProgramContext(idl, programId);
  const accountNode = (context.program.accounts ?? []).find(
    (account) => account.name === accountName,
  );
  if (!accountNode) {
    throw new Error(`Account type '${accountName}' not found in IDL`);
  }

  const accountInfo = await connection.getAccountInfo(accountAddress);
  if (!accountInfo) {
    throw new Error(`Account ${accountAddress.toBase58()} not found`);
  }

  const hasDiscriminators = (accountNode.discriminators ?? []).length > 0;
  if (
    !accountInfo.owner.equals(context.programId) ||
    (hasDiscriminators && !nodeMatchesData(context, accountNode, accountInfo.data))
  ) {
    throw new Error(`Account ${accountAddress.toBase58()} is not a '${accountName}' account`);
  }

  return decodeNodeData(context, accountNode, accountInfo.data) as T;
}

/**
 * An event emitted by an Anchor program
 */
export type AnchorEvent = {
  name: string;
  data: DecodedData;
};

/**
 * Parses Anchor events from a transaction
 *
 * @param idl - The Anchor or Codama IDL (use getIdlByProgramId or getIdlByPath to obtain)
 * @param signature - Transaction signature to parse events from
 * @param connection - The Solana connection object
 * @param programId - Optional program ID, needed for legacy IDLs that don't include the program's address
 * @returns Array of parsed events with their name and data
 *
 * @example
 * ```typescript
 * const idl = await getIdlByPath("./idl/program.json");
 * const events = await parseAnchorTransactionEvents(idl, signature, connection);
 * ```
 */
export async function parseAnchorTransactionEvents(
  idl: Idl,
  signature: string,
  connection: Connection,
  programId?: PublicKey,
): Promise<Array<AnchorEvent>> {
  const context = getProgramContext(idl, programId);
  const programAddress = context.programId.toBase58();

  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
  });

  const logMessages = transaction?.meta?.logMessages;
  if (!logMessages) {
    return [];
  }

  const base64Encoder = getBase64Encoder();
  const events: Array<AnchorEvent> = [];
  // Track which program is running so we only parse logs written by our program
  const invokedPrograms: Array<string> = [];

  for (const logMessage of logMessages) {
    const invokeMatch = PROGRAM_INVOKE_LOG.exec(logMessage);
    if (invokeMatch) {
      invokedPrograms.push(invokeMatch[1]);
      continue;
    }
    if (PROGRAM_EXIT_LOG.test(logMessage)) {
      invokedPrograms.pop();
      continue;
    }
    if (invokedPrograms.at(-1) !== programAddress) {
      continue;
    }

    const prefix = [PROGRAM_DATA_LOG_PREFIX, PROGRAM_LOG_PREFIX].find((prefix) =>
      logMessage.startsWith(prefix),
    );
    if (!prefix) {
      continue;
    }

    let eventBytes: Uint8Array;
    try {
      // Kit's base64 *encoder* turns a base64 string into bytes
      eventBytes = Uint8Array.from(base64Encoder.encode(logMessage.slice(prefix.length)));
    } catch {
      // A regular log message, not an event
      continue;
    }

    const eventNode = findNodeForData(context, context.program.events ?? [], eventBytes);
    if (eventNode) {
      events.push({
        name: eventNode.name,
        data: decodeNodeData(context, eventNode, eventBytes),
      });
    }
  }

  return events;
}

/**
 * Account involved in an instruction
 */
type InvolvedAccount = {
  name: string;
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
  // Decoded current account data, if the account is owned by the program
  data?: DecodedData;
};

/**
 * Decoded Anchor instruction with all involved accounts
 */
export type DecodedAnchorInstruction = {
  name: string;
  // JSON describing the instruction's arguments, from the IDL
  type: string;
  data: DecodedData;
  accounts: Array<InvolvedAccount>;
  toString: () => string;
};

/**
 * Decoded Anchor transaction containing all instructions and their accounts
 */
export type DecodedTransaction = {
  instructions: Array<DecodedAnchorInstruction>;
  toString: () => string;
};

/**
 * Decodes all Anchor instructions and their involved accounts in a transaction
 *
 * @param idl - The Anchor or Codama IDL (use getIdlByProgramId or getIdlByPath to obtain)
 * @param signature - Transaction signature to decode
 * @param connection - The Solana connection object
 * @param programId - Optional program ID, needed for legacy IDLs that don't include the program's address
 * @returns Decoded transaction with instructions and accounts
 *
 * @example
 * ```typescript
 * const idl = await getIdlByProgramId(programId, connection);
 * const decoded = await decodeAnchorTransaction(idl, signature, connection);
 * ```
 */
export async function decodeAnchorTransaction(
  idl: Idl,
  signature: string,
  connection: Connection,
  programId?: PublicKey,
): Promise<DecodedTransaction> {
  const context = getProgramContext(idl, programId);

  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
  });

  if (!transaction) {
    throw new Error(`Transaction ${signature} not found`);
  }

  const message = transaction.transaction.message;
  const accountKeys = message.getAccountKeys({
    accountKeysFromLookups: transaction.meta?.loadedAddresses,
  });

  const programInstructions = message.compiledInstructions.filter(
    (instruction: MessageCompiledInstruction) =>
      accountKeys.get(instruction.programIdIndex)?.equals(context.programId),
  );

  // Fetch every account used by the program's instructions in one request
  const involvedAccountIndexes = [
    ...new Set(programInstructions.flatMap((instruction) => instruction.accountKeyIndexes)),
  ];
  const involvedAccountAddresses = involvedAccountIndexes.map((index) => {
    const address = accountKeys.get(index);
    if (!address) {
      throw new Error(`Account index ${index} not found in transaction ${signature}`);
    }
    return address;
  });
  const involvedAccountInfos = await connection.getMultipleAccountsInfo(involvedAccountAddresses);
  const decodedAccountDataByIndex = new Map<number, DecodedData>();
  involvedAccountIndexes.forEach((accountIndex, position) => {
    const accountInfo = involvedAccountInfos[position];
    if (!accountInfo?.owner.equals(context.programId)) {
      return;
    }
    const decodedAccountData = decodeAccountData(context, accountInfo.data);
    if (decodedAccountData) {
      decodedAccountDataByIndex.set(accountIndex, decodedAccountData);
    }
  });

  const decodedInstructions: Array<DecodedAnchorInstruction> = [];

  for (const instruction of programInstructions) {
    const instructionData = instruction.data;
    const instructionNode = findNodeForData(
      context,
      context.program.instructions ?? [],
      instructionData,
    );
    if (!instructionNode) {
      console.log(`Could not find instruction in IDL matching data for ${signature}`);
      continue;
    }

    const accounts: Array<InvolvedAccount> = instruction.accountKeyIndexes.map(
      (accountIndex, position) => {
        const decodedAccountData = decodedAccountDataByIndex.get(accountIndex);
        return {
          name: instructionNode.accounts?.[position]?.name || `account_${position}`,
          pubkey: involvedAccountAddresses[involvedAccountIndexes.indexOf(accountIndex)].toBase58(),
          isSigner: message.isAccountSigner(accountIndex),
          isWritable: message.isAccountWritable(accountIndex),
          ...(decodedAccountData && { data: decodedAccountData }),
        };
      },
    );

    const argumentsWithoutDiscriminators = (instructionNode.arguments ?? []).filter(
      (argument) =>
        !(instructionNode.discriminators ?? []).some(
          (discriminator) =>
            discriminator.kind === "fieldDiscriminatorNode" && discriminator.name === argument.name,
        ),
    );

    decodedInstructions.push({
      name: instructionNode.name,
      type: JSON.stringify(
        argumentsWithoutDiscriminators.map((argument) => ({
          name: argument.name,
          type: argument.type,
        })),
      ),
      data: decodeNodeData(context, instructionNode, instructionData),
      accounts,
      toString: function () {
        let output = `\nInstruction: ${this.name}\n`;
        output += `├─ Arguments: ${JSON.stringify(formatData(this.data))}\n`;
        output += `└─ Accounts:\n`;
        this.accounts.forEach((account) => {
          output += `   ├─ ${account.name}:\n`;
          output += `   │  ├─ Address: ${account.pubkey}\n`;
          output += `   │  ├─ Signer: ${account.isSigner}\n`;
          output += `   │  ├─ Writable: ${account.isWritable}\n`;
          if (account.data) {
            output += `   │  └─ Data: ${JSON.stringify(formatData(account.data))}\n`;
          }
        });
        return output;
      },
    });
  }

  return {
    instructions: decodedInstructions,
    toString: function (this: DecodedTransaction) {
      let output = "\n=== Decoded Transaction ===\n";
      this.instructions.forEach((instruction, index) => {
        output += `\nInstruction ${index + 1}:${instruction.toString()}`;
      });
      return output;
    },
  };
}

// JSON.stringify() throws on bigints, so turn them into strings for display
function formatData(data: unknown): unknown {
  if (typeof data === "bigint") {
    return data.toString();
  }
  if (Array.isArray(data)) {
    return data.map(formatData);
  }
  if (typeof data === "object" && data !== null) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, formatData(value)]));
  }
  return data;
}
