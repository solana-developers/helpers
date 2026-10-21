import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  type Commitment,
  ComputeBudgetInstruction,
  type ComputeBudgetInstructionType,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  type SignatureStatus,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { type Blockhash, blockhash, type V1TransactionConfig } from "@solana/kit";
import { getErrorFromRPCResponse } from "./logs.js";

// The most compute units a single transaction may request
// See https://solana.com/docs/core/fees#compute-unit-limit
const MAX_COMPUTE_UNITS_PER_TRANSACTION = 1_400_000;

// The most account data, in bytes, a single transaction may load (64 MiB)
// See https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0186-loaded-transaction-data-size-specification.md
const MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES = 64 * 1024 * 1024;

// Used when the caller doesn't provide a ComputeUnitBuffer: adds 10% to simulated amounts
const DEFAULT_COMPUTE_UNIT_BUFFER: ComputeUnitBuffer = { multiplier: 1.1 };

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

const getComputeBudgetInstructionType = (
  instruction: TransactionInstruction,
): ComputeBudgetInstructionType | null => {
  if (!instruction.programId.equals(ComputeBudgetProgram.programId)) {
    return null;
  }
  try {
    return ComputeBudgetInstruction.decodeInstructionType(instruction);
  } catch {
    return null;
  }
};

const isSetComputeLimitInstruction = (instruction: TransactionInstruction): boolean => {
  return getComputeBudgetInstructionType(instruction) === "SetComputeUnitLimit";
};

const isSetComputeUnitPriceInstruction = (instruction: TransactionInstruction): boolean => {
  return getComputeBudgetInstructionType(instruction) === "SetComputeUnitPrice";
};

/**
 * Check if the given instructions contain a SetComputeUnitLimit instruction
 */
export function hasSetComputeLimitInstruction(
  instructions: Array<TransactionInstruction>,
): boolean {
  return instructions.some(isSetComputeLimitInstruction);
}

/**
 * Check if the given instructions contain a SetComputeUnitPrice instruction
 */
export function hasSetComputeUnitPriceInstruction(
  instructions: Array<TransactionInstruction>,
): boolean {
  return instructions.some(isSetComputeUnitPriceInstruction);
}

// Was getSimulationUnits
// Credit https://twitter.com/stegabob, originally from
// https://x.com/stegaBOB/status/1766662289392889920
export const getSimulationComputeUnits = async (
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  payer: PublicKey,
  lookupTables: Array<AddressLookupTableAccount> = [],
  commitment: Commitment = "confirmed",
): Promise<number | null> => {
  const simulationInstructions = [...instructions];

  // Replace or add compute limit instruction, so the simulation
  // isn't limited by the default per-instruction compute limit
  const computeLimitIndex = simulationInstructions.findIndex(isSetComputeLimitInstruction);
  const simulationLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
    units: MAX_COMPUTE_UNITS_PER_TRANSACTION,
  });

  if (computeLimitIndex >= 0) {
    simulationInstructions[computeLimitIndex] = simulationLimitInstruction;
  } else {
    simulationInstructions.unshift(simulationLimitInstruction);
  }

  const testTransaction = new VersionedTransaction(
    new TransactionMessage({
      instructions: simulationInstructions,
      payerKey: payer,
      // RecentBlockhash can by any public key during simulation
      // since 'replaceRecentBlockhash' is set to 'true' below
      recentBlockhash: blockhash(PublicKey.default.toBase58()),
    }).compileToV0Message(lookupTables),
  );

  const rpcResponse = await simulateWithoutSigning(connection, testTransaction, commitment);

  const unitsConsumed = rpcResponse.value.unitsConsumed;
  if (unitsConsumed === undefined) {
    return null;
  }
  return Number(unitsConsumed);
};

// Simulates a transaction that hasn't been signed yet, throwing an error with the logs if it fails
const simulateWithoutSigning = async (
  connection: Connection,
  transaction: VersionedTransaction,
  commitment: Commitment,
) => {
  const rpcResponse = await connection.simulateTransaction(transaction, {
    // The blockhash is replaced, and signatures aren't checked, during simulation
    replaceRecentBlockhash: true,
    sigVerify: false,
    commitment,
  });

  if (rpcResponse.value.err) {
    const logs = rpcResponse.value.logs?.join("\n  • ") || "No logs available";
    try {
      getErrorFromRPCResponse(rpcResponse);
    } catch (thrownObject) {
      const error = ensureError(thrownObject);
      throw new Error(`Transaction simulation failed:\n  •${logs}\n${error.message}`);
    }
  }
  return rpcResponse;
};

const applyBuffer = (simulatedAmount: number, buffer: ComputeUnitBuffer, maximum: number) => {
  let bufferedAmount = simulatedAmount;
  if (buffer.multiplier) {
    bufferedAmount = Math.floor(bufferedAmount * buffer.multiplier);
  }
  if (buffer.fixed) {
    bufferedAmount += buffer.fixed;
  }
  return Math.min(bufferedAmount, maximum);
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
 * Configuration for the buffer added to simulated compute units (and, for version 1 transactions,
 * to the simulated loaded accounts data size)
 * @property multiplier - Multiply simulated amounts by this value (e.g., 1.1 adds 10%)
 * @property fixed - Add this fixed amount
 */
export type ComputeUnitBuffer = {
  multiplier?: number;
  fixed?: number;
};

/**
 * Default configuration values for transaction sending
 */
export const DEFAULT_SEND_OPTIONS: Required<Omit<SendTransactionOptions, "onStatusUpdate">> = {
  maxRetries: MAX_RETRIES,
  initialDelayMs: RETRY_INTERVAL_MS,
  commitment: "confirmed",
  skipPreflight: true,
};

// Compute budget instructions do nothing in a version 1 transaction,
// which sets its compute budget in the message instead
const assertNoComputeBudgetInstructions = (instructions: Array<TransactionInstruction>) => {
  if (
    instructions.some((instruction) => instruction.programId.equals(ComputeBudgetProgram.programId))
  ) {
    throw new Error(
      "Compute budget instructions do nothing in a version 1 transaction. Remove them, and set computeUnitLimit and priorityFeeLamports in transactionConfig instead.",
    );
  }
};

/**
 * Sends a version 1 transaction, with automatic retries
 *
 * Version 1 transactions (SIMD-0385) set their compute budget in the transaction message, rather
 * than with compute budget instructions, and can be up to 4096 bytes. A version 1 transaction that
 * doesn't set a compute unit limit and a loaded accounts data size limit gets zero of each, so if
 * `transactionConfig` doesn't set them, the transaction is simulated, and the simulated amounts
 * plus `computeUnitBuffer` are used.
 *
 * @param connection - The Solana connection object
 * @param instructionsOrTransaction - The instructions to send, or an unsigned legacy Transaction
 * whose instructions (and fee payer, if set) are used
 * @param signers - Array of signers needed for the transaction. The first signer pays the
 * transaction fees, unless a Transaction with a fee payer is given.
 * @param options - Optional configuration for the transaction, its compute budget, and retries
 * @param options.transactionConfig - The version 1 transaction config: `computeUnitLimit`,
 * `loadedAccountsDataSizeLimit`, `priorityFeeLamports` (the total priority fee) and `heapSize`
 * @param options.computeUnitBuffer - Added to the simulated amounts (default: 10% more)
 * @returns Promise that resolves to the transaction signature
 * @throws If the instructions include compute budget instructions, or the Transaction is
 * already signed
 *
 * @example
 * ```typescript
 * const signature = await sendTransaction(connection, [transferInstruction], [payer], {
 *   transactionConfig: { priorityFeeLamports: 5_000n },
 *   onStatusUpdate: (status) => console.log(status),
 * });
 * ```
 */
export async function sendTransaction(
  connection: Connection,
  instructionsOrTransaction: Array<TransactionInstruction> | Transaction,
  signers: Array<Keypair>,
  options: SendTransactionOptions & {
    computeUnitBuffer?: ComputeUnitBuffer;
    transactionConfig?: V1TransactionConfig;
  } = {},
): Promise<string> {
  const {
    computeUnitBuffer = DEFAULT_COMPUTE_UNIT_BUFFER,
    transactionConfig = {},
    commitment = "confirmed",
    ...sendOptions
  } = options;

  let instructions: Array<TransactionInstruction>;
  let payer: PublicKey | undefined = signers[0]?.publicKey;
  let recentBlockhash: Blockhash | undefined;
  if (instructionsOrTransaction instanceof Transaction) {
    if (instructionsOrTransaction.signatures.some(({ signature }) => signature !== null)) {
      throw new Error(
        "The transaction is already signed, so it can't be sent as a version 1 transaction without invalidating its signatures. Send it with connection.sendRawTransaction() instead.",
      );
    }
    instructions = instructionsOrTransaction.instructions;
    payer = instructionsOrTransaction.feePayer ?? payer;
    recentBlockhash = instructionsOrTransaction.recentBlockhash;
  } else {
    instructions = instructionsOrTransaction;
  }
  if (!payer) {
    throw new Error("No signers or fee payer provided");
  }

  assertNoComputeBudgetInstructions(instructions);

  let { computeUnitLimit, loadedAccountsDataSizeLimit } = transactionConfig;
  if (computeUnitLimit === undefined || loadedAccountsDataSizeLimit === undefined) {
    const simulationMessage = new TransactionMessage({
      payerKey: payer,
      instructions,
      recentBlockhash: blockhash(PublicKey.default.toBase58()),
      transactionConfig: {
        ...transactionConfig,
        // The most a transaction can use, so the simulation isn't limited
        computeUnitLimit: MAX_COMPUTE_UNITS_PER_TRANSACTION,
        loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
      },
    }).compileToV1Message();
    const simulation = await simulateWithoutSigning(
      connection,
      new VersionedTransaction(simulationMessage),
      commitment,
    );
    const { unitsConsumed, loadedAccountsDataSize } = simulation.value;
    if (unitsConsumed === undefined || loadedAccountsDataSize === undefined) {
      throw new Error(
        "The RPC didn't return the simulated compute units and loaded accounts data size",
      );
    }
    computeUnitLimit ??= applyBuffer(
      Number(unitsConsumed),
      computeUnitBuffer,
      MAX_COMPUTE_UNITS_PER_TRANSACTION,
    );
    loadedAccountsDataSizeLimit ??= applyBuffer(
      loadedAccountsDataSize,
      computeUnitBuffer,
      MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
    );
  }

  const message = new TransactionMessage({
    payerKey: payer,
    instructions,
    recentBlockhash: recentBlockhash ?? (await connection.getLatestBlockhash(commitment)).blockhash,
    transactionConfig: { ...transactionConfig, computeUnitLimit, loadedAccountsDataSizeLimit },
  }).compileToV1Message();

  const transaction = new VersionedTransaction(message);
  await transaction.sign(signers);

  return sendRawTransactionWithRetry(connection, transaction.serialize(), {
    commitment,
    ...sendOptions,
  });
}

/**
 * Sends a version 0 transaction that uses address lookup tables, with compute unit optimization
 * and automatic retries
 *
 * Version 1 transactions can't use address lookup tables, so use this function (rather than
 * `sendTransaction`) for a transaction that references more accounts than fit in a version 1
 * transaction.
 *
 * @param connection - The Solana connection object
 * @param instructions - Array of instructions to include in the transaction
 * @param signers - Array of signers needed for the transaction. The first signer pays the
 * transaction fees.
 * @param lookupTables - The address lookup tables the transaction uses
 * @param priorityFee - Priority fee in microLamports per compute unit (default: 10000)
 * @param options - Optional configuration for retry mechanism and compute units
 * @returns Promise that resolves to the transaction signature
 *
 * @remarks
 * If the instructions don't include a SetComputeUnitLimit instruction, this function adds a
 * SetComputeUnitPrice instruction (if there isn't one) and a SetComputeUnitLimit instruction based
 * on simulation, like `addComputeInstructions`. If they do, the instructions are sent as they are.
 *
 * @example
 * ```typescript
 * const signature = await sendTransactionWithLookupTables(
 *   connection,
 *   instructions,
 *   [payer],
 *   [lookupTableAccount],
 *   10000,
 *   {
 *     computeUnitBuffer: { multiplier: 1.1 },
 *     onStatusUpdate: (status) => console.log(status),
 *   }
 * );
 * ```
 */
export async function sendTransactionWithLookupTables(
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  signers: Array<Keypair>,
  lookupTables: Array<AddressLookupTableAccount>,
  priorityFee: number = 10000,
  options: SendTransactionOptions & {
    computeUnitBuffer?: ComputeUnitBuffer;
  } = {},
): Promise<string> {
  const {
    computeUnitBuffer = DEFAULT_COMPUTE_UNIT_BUFFER,
    commitment = "confirmed",
    ...sendOptions
  } = options;

  if (!hasSetComputeLimitInstruction(instructions)) {
    instructions = await addComputeInstructions(
      connection,
      instructions,
      lookupTables,
      signers[0].publicKey,
      priorityFee,
      computeUnitBuffer,
      commitment,
    );
  }

  const messageV0 = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: (await connection.getLatestBlockhash(commitment)).blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const transaction = new VersionedTransaction(messageV0);

  await transaction.sign(signers);

  return await sendRawTransactionWithRetry(connection, transaction.serialize(), {
    commitment,
    ...sendOptions,
  });
}

/**
 * Adds compute unit price and limit instructions and returns the updated instructions
 *
 * @param connection - The Solana connection object
 * @param instructions - Array of instructions to which compute unit instructions will be added
 * @param lookupTables - Optional array of address lookup tables for account compression
 * @param payer - The public key of the transaction payer
 * @param priorityFee - Priority fee in microLamports (default: 10000)
 * @param computeUnitBuffer - Optional buffer to add to simulated compute units
 * @param commitment - Desired commitment level for the transaction
 * @returns Array of instructions with compute unit instructions added
 */
export async function addComputeInstructions(
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  lookupTables: Array<AddressLookupTableAccount>,
  payer: PublicKey,
  priorityFee: number = 10000,
  computeUnitBuffer: ComputeUnitBuffer = {},
  commitment: Commitment = "confirmed",
): Promise<Array<TransactionInstruction>> {
  if (!hasSetComputeUnitPriceInstruction(instructions)) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee,
      }),
    );
  }

  if (!hasSetComputeLimitInstruction(instructions)) {
    const simulatedCompute = await getSimulationComputeUnits(
      connection,
      instructions,
      payer,
      lookupTables,
      commitment,
    );

    if (simulatedCompute === null) {
      throw new Error("Failed to simulate compute units");
    }

    console.log("Simulated compute units", simulatedCompute);

    const finalComputeUnits = applyBuffer(
      simulatedCompute,
      computeUnitBuffer,
      MAX_COMPUTE_UNITS_PER_TRANSACTION,
    );

    console.log("Final compute units (with buffer)", finalComputeUnits);

    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: finalComputeUnits,
      }),
    );
  }

  return instructions;
}

// In JS it's possible to throw *anything*. A sensible programmer
// will only throw Errors but we must still check to satisfy
// TypeScript (and flag any craziness)
const ensureError = function (thrownObject: unknown): Error {
  if (thrownObject instanceof Error) {
    return thrownObject;
  }
  return new Error(`Non-Error thrown: ${String(thrownObject)}`);
};

/**
 * Internal helper to send a serialized transaction with automatic retries and status updates
 *
 * @param connection - The Solana connection object
 * @param transaction - The serialized transaction to send
 * @param options - Optional configuration for the retry mechanism
 * @returns Promise that resolves to the transaction signature
 *
 * @remarks
 * This function:
 * 1. Sends the transaction
 * 2. Polls the transaction status until confirmation
 * 3. Re-sends the transaction with an increasing delay if it is not confirmed in time
 * 4. Provides detailed status updates through the callback
 *
 * The function uses default values that can be partially overridden through the options parameter.
 * Default values are defined in DEFAULT_SEND_OPTIONS.
 *
 * Retry behavior:
 * - Initial delay between retries is max(500ms, options.initialDelayMs)
 * - Delay increases by RETRY_INTERVAL_INCREASE (200ms) after each retry
 * - Maximum retries defined by options.maxRetries (default: 15)
 *
 * Status updates include:
 * - "created": Initial transaction state
 * - "signed": Transaction has been signed
 * - "sent": Transaction has been sent (includes signature)
 * - "retry": Transaction is being retried (includes last signature if any)
 * - "confirmed": Transaction is confirmed or finalized (includes status)
 *
 * @throws Error if the transaction is confirmed but failed, or is not confirmed after all retry attempts
 *
 * @internal This is an internal helper function used by sendTransaction and
 * sendTransactionWithLookupTables
 */
async function sendRawTransactionWithRetry(
  connection: Connection,
  transaction: Uint8Array,
  {
    maxRetries = DEFAULT_SEND_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_SEND_OPTIONS.initialDelayMs,
    commitment = DEFAULT_SEND_OPTIONS.commitment,
    skipPreflight = DEFAULT_SEND_OPTIONS.skipPreflight,
    onStatusUpdate = (status) => console.log("Transaction status:", status),
  }: SendTransactionOptions = {},
): Promise<string> {
  onStatusUpdate?.({ status: "created" });
  onStatusUpdate?.({ status: "signed" });

  let signature: string | null = null;
  let retries = 0;
  // Setting a minimum to decrease spam and for the confirmation to work
  let delayBetweenRetries = Math.max(initialDelayMs, 500);

  while (retries < maxRetries) {
    let confirmedStatus: SignatureStatus | null = null;
    try {
      const isFirstSend = signature === null;

      // Send transaction if not sent yet
      signature = await connection.sendRawTransaction(transaction, {
        skipPreflight,
        preflightCommitment: commitment,
        // We handle retries ourselves
        maxRetries: 0n,
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
        const status = response?.value;
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          confirmedStatus = status;
          break;
        }
        pollTimeout -= timeBetweenPolls;
      }
    } catch (thrownObject) {
      const error = ensureError(thrownObject);
      console.log(`Attempt ${retries + 1} failed:`, error.message);
    }

    if (confirmedStatus && signature) {
      // A transaction that landed with an error will fail the same way if we re-send it
      getErrorFromRPCResponse({
        context: { slot: confirmedStatus.slot },
        value: { err: confirmedStatus.err },
      });
      onStatusUpdate?.({ status: "confirmed", result: confirmedStatus });
      return signature;
    }

    retries++;

    if (retries < maxRetries) {
      onStatusUpdate?.({ status: "retry", signature });
      delayBetweenRetries += RETRY_INTERVAL_INCREASE;
    }
  }

  throw new Error(`Transaction failed after ${maxRetries} attempts`);
}

/**
 * Creates a new address lookup table and extends it with additional addresses
 *
 * @param connection - The Solana connection object
 * @param sender - The keypair of the transaction sender
 * @param additionalAddresses - Array of additional addresses to include in the lookup table
 * @param priorityFeeLamports - Optional total priority fee, in lamports, for the transaction that
 * creates the lookup table
 * @returns A tuple containing the lookup table address and the lookup table account
 */
export async function createLookupTable(
  connection: Connection,
  sender: Keypair,
  additionalAddresses: Array<PublicKey>,
  priorityFeeLamports?: bigint,
): Promise<[PublicKey, AddressLookupTableAccount]> {
  // The lookup table program requires a recent slot that is in the SlotHashes sysvar,
  // so we use a finalized slot to make sure it is not on a dropped fork.
  const slot = await connection.getSlot("finalized");

  const [lookupTableInstruction, lookupTableAddress] =
    await AddressLookupTableProgram.createLookupTable({
      authority: sender.publicKey,
      payer: sender.publicKey,
      recentSlot: slot,
    });

  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: sender.publicKey,
    authority: sender.publicKey,
    lookupTable: lookupTableAddress,
    addresses: additionalAddresses,
  });

  const lookupTableInstructions = [lookupTableInstruction, extendInstruction];

  // Making a lookup table doesn't need a lookup table, so this is a version 1 transaction
  const lookupTableInstructionsSignature = await sendTransaction(
    connection,
    lookupTableInstructions,
    [sender],
    { transactionConfig: { priorityFeeLamports } },
  );

  // Need to wait until the lookup table is active
  await confirmTransaction(connection, lookupTableInstructionsSignature, "finalized");

  console.log("Lookup table instructions signature", lookupTableInstructionsSignature);

  const lookupTableAccount = (
    await connection.getAddressLookupTable(lookupTableAddress, {
      commitment: "confirmed",
    })
  ).value;

  if (!lookupTableAccount) {
    throw new Error("Failed to get lookup table account");
  }

  return [lookupTableAddress, lookupTableAccount];
}
