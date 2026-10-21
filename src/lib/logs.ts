import type {
  Connection,
  RpcResponseAndContext,
  SignatureResult,
  SimulatedTransactionResponse,
} from "@solana/web3.js";
import { confirmTransaction } from "./transaction.js";
import { MAX_SUPPORTED_TRANSACTION_VERSION } from "./rpc.js";

export const getLogs = async (
  connection: Connection,
  signature: string,
): Promise<Array<string>> => {
  await confirmTransaction(connection, signature);
  const transactionDetails = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    commitment: "confirmed",
  });
  return [...(transactionDetails?.meta?.logMessages || [])];
};

// JSON.stringify() throws on bigints, which RPC errors can contain
const stringifyWithBigInts = (value: unknown): string => {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
};

// `confirmTransaction` and `simulateTransaction` do not throw when the transaction fails,
// they return a `TransactionError` in `value.err` instead - so we turn that into a thrown Error here.
export const getErrorFromRPCResponse = (
  rpcResponse: RpcResponseAndContext<SignatureResult | SimulatedTransactionResponse>,
) => {
  const error = rpcResponse.value.err;
  if (!error) {
    return;
  }

  if (typeof error === "string") {
    throw new Error(error);
  }

  if ("InstructionError" in error) {
    const [instructionIndex, instructionError] = error.InstructionError;
    // A custom program error looks like:
    // [
    //   1,
    //   {
    //     "Custom": 1
    //   }
    // ]
    // See also https://solana.stackexchange.com/a/931/294
    if (typeof instructionError === "object" && "Custom" in instructionError) {
      throw new Error(
        `Error in transaction: instruction index ${instructionIndex}, custom program error ${instructionError.Custom}`,
      );
    }
    throw new Error(
      `Error in transaction: instruction index ${instructionIndex}, ${stringifyWithBigInts(instructionError)}`,
    );
  }

  throw new Error(`Error in transaction: ${stringifyWithBigInts(error)}`);
};
