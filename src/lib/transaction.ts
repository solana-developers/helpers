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
} from "@solana/web3.js";
import { getErrorFromRPCResponse } from "./logs";

export const confirmTransaction = async (
  connection: Connection,
  signature: string,
  commitment: Commitment = "finalized",
): Promise<string> => {
  const block = await connection.getLatestBlockhash();
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
  });

  if (rpcResponse.value.err) {
    const logs = rpcResponse.value.logs?.join("\n  • ") || "No logs available";
    throw new Error(`Transaction simulation failed:\n  •${logs}`);
  }

  return rpcResponse.value.unitsConsumed || null;
};

/**
 * Constants for transaction retry configuration
 */
export const RETRY_INTERVAL_MS = 2000;
export const MAX_RETRIES = 30;

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
    onStatusUpdate = () => {},
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

  while (retries < maxRetries) {
    try {
      // Send transaction if not sent yet
      if (!signature) {
        signature = await connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight,
            preflightCommitment: commitment,
            maxRetries: 0,
          },
        );
        onStatusUpdate?.({ status: "sent", signature });
      }

      // Check status
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
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.log(`Attempt ${retries + 1} failed:`, error.message);
      } else {
        console.log(`Attempt ${retries + 1} failed:`, error);
      }
    }

    retries++;
    if (retries < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
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
 * @param priorityFee - Priority fee in microLamports (default: 1000)
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
  priorityFee: number = 1000,
  computeUnitBuffer: ComputeUnitBuffer = {},
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
