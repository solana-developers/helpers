import {
  Connection,
  PublicKey,
  MessageCompiledInstruction,
  Keypair,
  Message,
} from "@solana/web3.js";
import {
  Program,
  Idl,
  AnchorProvider,
  EventParser,
  BorshAccountsCoder,
  BorshInstructionCoder,
} from "@coral-xyz/anchor";
import BN from "bn.js";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { formatIdl } from "./convertLegacyIdl";

/**
 * Loads an Anchor IDL from a local file path
 *
 * @param idlPath - Path to the IDL JSON file
 * @returns The parsed IDL
 *
 * @example
 * ```typescript
 * const idl = await getIdlByPath("./idl/program.json");
 * ```
 */
export async function getIdlByPath<Idl>(idlPath: string): Promise<Idl> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  // Load and parse IDL file
  const idlFile = fs.readFileSync(path.resolve(idlPath), "utf8");
  const idl = JSON.parse(idlFile) as Idl;
  return idl;
}

/**
 * Fetches an Anchor IDL from a program on-chain
 *
 * @param programId - Public key of the program
 * @param connection - Solana connection object
 * @returns The fetched IDL
 * @throws If IDL cannot be found for the program
 *
 * @example
 * ```typescript
 * const idl = await getIdlByProgramId(
 *   new PublicKey("Foo1111111111111111111111111111111111111"),
 *   connection
 * );
 * ```
 */
export async function getIdlByProgramId<Idl>(
  programId: PublicKey,
  connection: Connection,
): Promise<Idl> {
  let wallet = new NodeWallet(new Keypair());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  var idl = await Program.fetchIdl(programId, provider);
  if (!idl)
    throw new Error(`IDL not found for program ${programId.toString()}`);

  return idl as Idl;
}

/**
 * Fetches and parses an account's data using an Anchor IDL
 *
 * @param idl - The Anchor IDL (use getIdlByProgramId or getIdlByPath to obtain)
 * @param accountName - The name of the account as defined in the IDL
 * @param accountAddress - The public key of the account to fetch
 * @param connection - Optional connection object (uses default provider if not specified)
 * @param programId - Optional program ID needed for legacy IDLs
 * @returns The decoded account data
 *
 * @example
 * ```typescript
 * const idl = await getIdlByProgramId(programId, connection);
 * const data = await getIdlParsedAccountData(idl, "counter", accountAddress);
 * ```
 */
export async function getIdlParsedAccountData<T = any>(
  idl: Idl,
  accountName: string,
  accountAddress: PublicKey,
  connection: Connection,
  programId?: PublicKey,
): Promise<T> {
  // Get or create provider
  let wallet = new NodeWallet(new Keypair());

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Create program
  const program = new Program(formatIdl(idl, programId?.toString()), provider);

  const accountInfo = await provider.connection.getAccountInfo(accountAddress);

  if (!accountInfo) {
    throw new Error(`Account ${accountAddress.toString()} not found`);
  }

  return program.coder.accounts.decode(accountName, accountInfo.data) as T;
}

/**
 * Parses Anchor events from a transaction
 *
 * @param idl - The Anchor IDL (use getIdlByProgramId or getIdlByPath to obtain)
 * @param signature - Transaction signature to parse events from
 * @param connection - Connection object (uses default provider if not specified)
 * @param programId - Optional program ID needed for legacy IDLs
 * @returns Array of parsed events with their name and data
 *
 * @example
 * ```typescript
 * const idl = await getIdlByPath("./idl/program.json");
 * const events = await parseAnchorTransactionEvents(idl, signature);
 * ```
 */
export async function parseAnchorTransactionEvents(
  idl: Idl,
  signature: string,
  connection: Connection,
  programId?: PublicKey,
): Promise<
  Array<{
    name: string;
    data: any;
  }>
> {
  let wallet = new NodeWallet(new Keypair());

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const program = new Program(formatIdl(idl, programId?.toString()), provider);
  const parser = new EventParser(program.programId, program.coder);

  const transaction = await provider.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction?.meta?.logMessages) {
    return [];
  }

  const events: Array<{ name: string; data: any }> = [];
  for (const event of parser.parseLogs(transaction.meta.logMessages)) {
    events.push({
      name: event.name,
      data: event.data,
    });
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
  data?: Record<string, any>; // Decoded account data if it's a program account
};

/**
 * Decoded Anchor instruction with all involved accounts
 */
export type DecodedAnchorInstruction = {
  name: string;
  type: string;
  data: Record<string, any>;
  accounts: InvolvedAccount[];
  toString: () => string;
};

/**
 * Decoded Anchor transaction containing all instructions and their accounts
 */
export type DecodedTransaction = {
  instructions: DecodedAnchorInstruction[];
  toString: () => string;
};

/**
 * Decodes all Anchor instructions and their involved accounts in a transaction
 *
 * @param idl - The Anchor IDL (use getIdlByProgramId or getIdlByPath to obtain)
 * @param signature - Transaction signature to decode
 * @param connection - Optional connection object (uses default provider if not specified)
 * @param programId - Optional program ID needed for legacy IDLs
 * @returns Decoded transaction with instructions and accounts
 *
 * @example
 * ```typescript
 * const idl = await getIdlByProgramId(programId, connection);
 * const decoded = await decodeAnchorTransaction(idl, signature);
 * ```
 */
export async function decodeAnchorTransaction(
  idl: Idl,
  signature: string,
  connection: Connection,
  programId?: PublicKey,
): Promise<DecodedTransaction> {
  let wallet = new NodeWallet(new Keypair());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(formatIdl(idl, programId?.toString()), provider);
  const accountsCoder = new BorshAccountsCoder(program.idl);
  const instructionCoder = new BorshInstructionCoder(program.idl);

  const transaction = await provider.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction) {
    throw new Error(`Transaction ${signature} not found`);
  }

  const decodedInstructions: DecodedAnchorInstruction[] = [];

  const message = transaction.transaction.message;
  const instructions =
    "addressTableLookups" in message
      ? message.compiledInstructions
      : (message as Message).instructions;
  const accountKeys = message.getAccountKeys();

  for (const ix of instructions) {
    const programId = accountKeys.get(
      "programIdIndex" in ix
        ? (ix as MessageCompiledInstruction).programIdIndex
        : (ix as any).programId,
    );

    if (!programId) continue;
    if (programId.equals(program.programId)) {
      try {
        const decoded = instructionCoder.decode(Buffer.from(ix.data));
        if (decoded) {
          const ixType = idl.instructions.find((i) => i.name === decoded.name);
          const accountIndices =
            "accounts" in ix ? ix.accounts : ix.accountKeyIndexes;

          // Get all accounts involved in this instruction
          const accounts: InvolvedAccount[] = await Promise.all(
            accountIndices.map(async (index, i) => {
              const pubkey = accountKeys.get(index);
              if (!pubkey) return null;
              const accountMeta = ixType?.accounts[i];
              const accountInfo =
                await provider.connection.getAccountInfo(pubkey);

              let accountData;
              if (accountInfo?.owner.equals(program.programId)) {
                try {
                  const accountType = idl.accounts?.find((acc) =>
                    accountInfo.data
                      .slice(0, 8)
                      .equals(
                        accountsCoder.accountDiscriminator(
                          acc.name.toLowerCase(),
                        ),
                      ),
                  );
                  if (accountType) {
                    accountData = accountsCoder.decode(
                      accountType.name.toLowerCase(),
                      accountInfo.data,
                    );
                  }
                } catch (e) {
                  console.log(`Failed to decode account data: ${e}`);
                }
              }

              return {
                name: accountMeta?.name || `account_${i}`,
                pubkey: pubkey.toString(),
                isSigner:
                  message.staticAccountKeys.findIndex((k) => k.equals(pubkey)) <
                    message.header.numRequiredSignatures || false,
                isWritable: message.isAccountWritable(index),
                ...(accountData && { data: accountData }),
              };
            }),
          );

          decodedInstructions.push({
            name: decoded.name,
            type: ixType ? JSON.stringify(ixType.args) : "unknown",
            data: decoded.data,
            accounts,
            toString: function () {
              let output = `\nInstruction: ${this.name}\n`;
              output += `├─ Arguments: ${JSON.stringify(
                formatData(this.data),
              )}\n`;
              output += `└─ Accounts:\n`;
              this.accounts.forEach((acc) => {
                output += `   ├─ ${acc.name}:\n`;
                output += `   │  ├─ Address: ${acc.pubkey}\n`;
                output += `   │  ├─ Signer: ${acc.isSigner}\n`;
                output += `   │  ├─ Writable: ${acc.isWritable}\n`;
                if (acc.data) {
                  output += `   │  └─ Data: ${JSON.stringify(
                    formatData(acc.data),
                  )}\n`;
                }
              });
              return output;
            },
          });
        }
      } catch (e) {
        console.log(`Failed to decode instruction: ${e}`);
      }
    }
  }

  return {
    instructions: decodedInstructions,
    toString: function (this: DecodedTransaction) {
      let output = "\n=== Decoded Transaction ===\n";
      this.instructions.forEach((ix, index) => {
        output += `\nInstruction ${index + 1}:${ix.toString()}`;
      });
      return output;
    },
  };
}

// Helper function to format data
function formatData(data: any): any {
  if (data instanceof BN) {
    return `<BN: ${data.toString()}>`;
  }
  if (Array.isArray(data)) {
    return data.map(formatData);
  }
  if (typeof data === "object" && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, formatData(v)]),
    );
  }
  return data;
}
