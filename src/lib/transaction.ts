import {
  AddressLookupTableAccount,
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SignatureStatus,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Message,
  MessageV0,
  MessageCompiledInstruction,
} from "@solana/web3.js";
import { getErrorFromRPCResponse } from "./logs";
import {
  Program,
  Idl,
  AnchorProvider,
  EventParser,
  BorshAccountsCoder,
  BorshInstructionCoder,
  BN,
} from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

export const confirmTransaction = async (
  connection: Connection,
  signature: string,
  commitment: Commitment = "confirmed",
): Promise<string> => {
  const block = await connection.getLatestBlockhash(commitment);
  const rpcResponse = await connection.confirmTransaction(
    {
      signature,
      ...block,
    },
    commitment,
  );

  getErrorFromRPCResponse(rpcResponse);

  return signature;
};

// Was getSimulationUnits
// Credit https://twitter.com/stegabob, originally from
// https://x.com/stegaBOB/status/1766662289392889920
export const getSimulationComputeUnits = async (
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  payer: PublicKey,
  lookupTables: Array<AddressLookupTableAccount> | [],
  commitment: Commitment = "confirmed",
): Promise<number | null> => {
  const testInstructions = [
    // Set an arbitrarily high number in simulation
    // so we can be sure the transaction will succeed
    // and get the real compute units used
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...instructions,
  ];

  const testTransaction = new VersionedTransaction(
    new TransactionMessage({
      instructions: testInstructions,
      payerKey: payer,
      // RecentBlockhash can by any public key during simulation
      // since 'replaceRecentBlockhash' is set to 'true' below
      recentBlockhash: PublicKey.default.toString(),
    }).compileToV0Message(lookupTables),
  );

  const rpcResponse = await connection.simulateTransaction(testTransaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    commitment,
  });

  if (rpcResponse?.value?.err) {
    const logs = rpcResponse.value.logs?.join("\n  • ") || "No logs available";
    throw new Error(`Transaction simulation failed:\n  •${logs}`);
  }

  return rpcResponse.value.unitsConsumed || null;
};

/**
 * Constants for transaction retry configuration
 */
export const RETRY_INTERVAL_MS = 2000;
export const RETRY_INTERVAL_INCREASE = 200;
export const MAX_RETRIES = 15;

/**
 * Represents the different states of a transaction during its lifecycle
 * @property status - The current status of the transaction
 * @property signature - The transaction signature (only present when status is "sent")
 * @property result - The signature status (only present when status is "confirmed")
 */
export type TxStatusUpdate =
  | { status: "created" }
  | { status: "signed" }
  | { status: "sent"; signature: string }
  | { status: "retry"; signature: string | null }
  | { status: "confirmed"; result: SignatureStatus };

/**
 * Configuration options for transaction retry mechanism
 * @property maxRetries - Maximum number of retry attempts
 * @property initialDelayMs - Delay between retries in milliseconds
 * @property commitment - Desired commitment level for the transaction
 * @property skipPreflight - Whether to skip transaction simulation
 * @property onStatusUpdate - Callback function to receive transaction status updates
 */
export type SendTransactionOptions = Partial<{
  maxRetries: number;
  initialDelayMs: number;
  commitment: Commitment;
  onStatusUpdate: (status: TxStatusUpdate) => void;
  skipPreflight: boolean;
}>;

/**
 * Configuration for compute unit buffer calculation
 * @property multiplier - Multiply simulated units by this value (e.g., 1.1 adds 10%)
 * @property fixed - Add this fixed amount of compute units
 */
export type ComputeUnitBuffer = {
  multiplier?: number;
  fixed?: number;
};

/**
 * Default configuration values for transaction sending
 */
export const DEFAULT_SEND_OPTIONS: Required<
  Omit<SendTransactionOptions, "onStatusUpdate">
> = {
  maxRetries: MAX_RETRIES,
  initialDelayMs: RETRY_INTERVAL_MS,
  commitment: "confirmed",
  skipPreflight: true,
};

/**
 * Sends a transaction with automatic retries and status updates
 *
 * @param connection - The Solana connection object
 * @param transaction - The transaction to send
 * @param signers - Array of signers needed for the transaction
 * @param options - Optional configuration for the retry mechanism
 *
 * @returns Promise that resolves to the transaction signature
 *
 * @remarks
 * This function implements a robust retry mechanism that:
 * 1. Signs the transaction (if signers are provided)
 * 2. Sends the transaction only once
 * 3. Monitors the transaction status until confirmation
 * 4. Retries on failure with a fixed delay
 * 5. Provides detailed status updates through the callback
 *
 * The function uses default values that can be partially overridden through the options parameter.
 * Default values are defined in DEFAULT_SEND_OPTIONS.
 *
 * Status updates include:
 * - "created": Initial transaction state
 * - "signed": Transaction has been signed
 * - "sent": Transaction has been sent (includes signature)
 * - "confirmed": Transaction is confirmed or finalized
 *
 * @throws Error if the transaction fails after all retry attempts
 *
 * @example
 * ```typescript
 * const signature = await sendTransactionWithRetry(
 *   connection,
 *   transaction,
 *   signers,
 *   {
 *     onStatusUpdate: (status) => console.log(status),
 *     commitment: "confirmed"
 *   }
 * );
 * ```
 */
export async function sendTransactionWithRetry(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
  {
    maxRetries = DEFAULT_SEND_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_SEND_OPTIONS.initialDelayMs,
    commitment = DEFAULT_SEND_OPTIONS.commitment,
    skipPreflight = DEFAULT_SEND_OPTIONS.skipPreflight,
    onStatusUpdate = (status) => console.log("Transaction status:", status),
  }: SendTransactionOptions = {},
): Promise<string> {
  onStatusUpdate?.({ status: "created" });

  // Sign the transaction
  if (signers.length > 0) {
    transaction.sign(...signers);
  }

  onStatusUpdate?.({ status: "signed" });

  let signature: string | null = null;
  let status: SignatureStatus | null = null;
  let retries = 0;
  // Setting a minimum to decrease spam and for the confirmation to work
  let delayBetweenRetries = Math.max(initialDelayMs, 500);

  while (retries < maxRetries) {
    try {
      const isFirstSend = signature === null;

      // Send transaction if not sent yet
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight,
        preflightCommitment: commitment,
        maxRetries: 0,
      });

      if (isFirstSend) {
        onStatusUpdate?.({ status: "sent", signature });
      }

      // Poll for confirmation
      let pollTimeout = delayBetweenRetries;
      const timeBetweenPolls = 500;
      while (pollTimeout > 0) {
        await new Promise((resolve) => setTimeout(resolve, timeBetweenPolls));
        const response = await connection.getSignatureStatus(signature);
        if (response?.value) {
          status = response.value;
          if (
            status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized"
          ) {
            onStatusUpdate?.({ status: "confirmed", result: status });
            return signature;
          }
        }
        pollTimeout -= timeBetweenPolls;
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.log(`Attempt ${retries + 1} failed:`, error.message);
      } else {
        console.log(`Attempt ${retries + 1} failed:`, error);
      }
    }

    retries++;

    if (retries < maxRetries) {
      onStatusUpdate?.({ status: "retry", signature: signature ?? null });
      delayBetweenRetries += RETRY_INTERVAL_INCREASE;
    }
  }

  throw new Error(`Transaction failed after ${maxRetries} attempts`);
}

/**
 * Prepares a transaction by adding compute budget instructions
 *
 * @param connection - The Solana connection object
 * @param tx - The transaction to prepare
 * @param payer - The public key of the transaction payer
 * @param priorityFee - Priority fee in microLamports (default: 10000 which is the minimum required for helius to see a transaction as priority)
 * @param computeUnitBuffer - Optional buffer to add to simulated compute units
 *
 * @remarks
 * This function:
 * 1. Adds a compute unit price instruction with the specified priority fee
 * 2. Simulates the transaction to determine required compute units
 * 3. Applies any specified compute unit buffers
 * 4. Adds a compute unit limit instruction based on the simulation
 *
 * The compute unit buffer can be specified as:
 * - A multiplier (e.g., 1.1 adds 10% to simulated units)
 * - A fixed value (e.g., 1000 adds 1000 compute units)
 * - Both (multiplier is applied first, then fixed value is added)
 *
 * Priority Fees:
 * To find an appropriate priority fee, refer to your RPC provider's documentation:
 * - Helius: https://docs.helius.dev/solana-apis/priority-fee-api
 * - Triton: https://docs.triton.one/chains/solana/improved-priority-fees-api
 * - Quicknode: https://www.quicknode.com/docs/solana/qn_estimatePriorityFees
 *
 * @throws If the transaction simulation fails
 *
 * @example
 * ```typescript
 * // Add 10% buffer plus 1000 fixed compute units
 * await prepareTransactionWithCompute(
 *   connection,
 *   transaction,
 *   payer.publicKey,
 *   1000,
 *   { multiplier: 1.1, fixed: 1000 }
 * );
 * ```
 */
export async function prepareTransactionWithCompute(
  connection: Connection,
  tx: Transaction,
  payer: PublicKey,
  priorityFee: number = 10000,
  computeUnitBuffer: ComputeUnitBuffer = {},
  commitment: Commitment = "confirmed",
): Promise<void> {
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee,
    }),
  );

  const simulatedCompute = await getSimulationComputeUnits(
    connection,
    tx.instructions,
    payer,
    [],
    commitment,
  );

  if (simulatedCompute === null) {
    throw new Error("Failed to simulate compute units");
  }

  console.log("Simulated compute units", simulatedCompute);

  // Apply buffer to compute units
  let finalComputeUnits = simulatedCompute;
  if (computeUnitBuffer.multiplier) {
    finalComputeUnits = Math.floor(
      finalComputeUnits * computeUnitBuffer.multiplier,
    );
  }
  if (computeUnitBuffer.fixed) {
    finalComputeUnits += computeUnitBuffer.fixed;
  }

  console.log("Final compute units (with buffer)", finalComputeUnits);

  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: finalComputeUnits,
    }),
  );
}

/**
 * Fetches and parses an account's data using an Anchor IDL file
 *
 * @param idlPath - Path to the IDL JSON file
 * @param accountName - The name of the account as defined in the IDL
 * @param accountAddress - The public key of the account to fetch
 * @param connection - Optional connection object (uses default provider if not specified)
 * @returns The decoded account data
 *
 * @throws If the IDL file doesn't exist or account cannot be decoded
 */
export async function getIdlParsedAccountData<T = any>(
  idlPath: string,
  accountName: string,
  accountAddress: PublicKey,
  connection?: Connection,
): Promise<T> {
  // Load and parse IDL file
  const idlFile = fs.readFileSync(path.resolve(idlPath), "utf8");
  const idl = JSON.parse(idlFile) as Idl;

  // Get or create provider
  const provider = connection
    ? new AnchorProvider(connection, AnchorProvider.env().wallet, {})
    : AnchorProvider.env();

  // Create program
  const program = new Program(idl, provider);

  const accountInfo = await provider.connection.getAccountInfo(accountAddress);

  if (!accountInfo) {
    throw new Error(`Account ${accountAddress.toString()} not found`);
  }

  return program.coder.accounts.decode(accountName, accountInfo.data) as T;
}

/**
 * Parses Anchor events from a transaction
 *
 * @param idlPath - Path to the IDL JSON file
 * @param signature - Transaction signature to parse events from
 * @param connection - Optional connection object (uses default provider if not specified)
 * @returns Array of parsed events with their name and data
 */
export async function parseAnchorTransactionEvents(
  idlPath: string,
  signature: string,
  connection?: Connection,
): Promise<
  Array<{
    name: string;
    data: any;
  }>
> {
  const idlFile = fs.readFileSync(path.resolve(idlPath), "utf8");
  const idl = JSON.parse(idlFile) as Idl;

  const provider = connection
    ? new AnchorProvider(connection, AnchorProvider.env().wallet, {})
    : AnchorProvider.env();

  const program = new Program(idl, provider);
  const parser = new EventParser(program.programId, program.coder);

  const transaction = await provider.connection.getTransaction(signature, {
    commitment: "confirmed",
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
 */
export async function decodeAnchorTransaction(
  idlPath: string,
  signature: string,
  connection?: Connection,
): Promise<DecodedTransaction> {
  const idlFile = fs.readFileSync(path.resolve(idlPath), "utf8");
  const idl = JSON.parse(idlFile) as Idl;

  const provider = connection
    ? new AnchorProvider(connection, AnchorProvider.env().wallet, {})
    : AnchorProvider.env();

  const program = new Program(idl, provider);
  const accountsCoder = new BorshAccountsCoder(idl);
  const instructionCoder = new BorshInstructionCoder(idl);

  const transaction = await provider.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction) {
    throw new Error(`Transaction ${signature} not found`);
  }

  const decodedInstructions: DecodedAnchorInstruction[] = [];

  // Decode instructions
  const message = transaction.transaction.message;
  const instructions =
    "version" in message
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
                      .equals(accountsCoder.accountDiscriminator(acc.name)),
                  );
                  if (accountType) {
                    accountData = accountsCoder.decode(
                      accountType.name,
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
