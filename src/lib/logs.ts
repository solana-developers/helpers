import { Connection, RpcResponseAndContext, SignatureResult, SimulatedTransactionResponse } from "@solana/web3.js";
import { confirmTransaction } from "./transaction";

export const getLogs = async (
  connection: Connection,
  tx: string,
): Promise<Array<string>> => {
  await confirmTransaction(connection, tx);
  const txDetails = await connection.getTransaction(tx, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  return txDetails?.meta?.logMessages || [];
};

export const getErrorFromRPCResponse = (
  rpcResponse: RpcResponseAndContext<
    SignatureResult | SimulatedTransactionResponse
  >,
) => {
  // Note: `confirmTransaction` does not throw an error if the confirmation does not succeed,
  // but rather a `TransactionError` object. so we handle that here
  // See https://solana-labs.github.io/solana-web3.js/v1.x/classes/Connection.html#confirmTransaction.confirmTransaction-1

  const error = rpcResponse.value.err;
  if (error) {
    // Can be a string or an object (literally just {}, no further typing is provided by the library)
    // https://github.com/solana-labs/solana-web3.js/blob/4436ba5189548fc3444a9f6efb51098272926945/packages/library-legacy/src/connection.ts#L2930
    // TODO: if still occurs in web3.js 2 (unlikely), fix it.
    if (typeof error === "object") {
      const errorKeys = Object.keys(error);
      if (errorKeys.length === 1) {
        if (errorKeys[0] !== "InstructionError") {
          throw new Error(`Unknown RPC error: ${JSON.stringify(error)}`);
        }
        // @ts-ignore due to missing typing information mentioned above.
        const instructionError = error["InstructionError"];
        // An instruction error is a custom program error and looks like:
        // [
        //   1,
        //   {
        //     "Custom": 1
        //   }
        // ]
        // See also https://solana.stackexchange.com/a/931/294
        throw new Error(
          `Error in transaction: instruction index ${instructionError[0]}, custom program error ${instructionError[1]["Custom"]}`,
        );
      }
    }
    throw Error(error.toString());
  }
};