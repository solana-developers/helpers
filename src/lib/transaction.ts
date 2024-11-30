import { AddressLookupTableAccount, Commitment, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
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

  getErrorFromRPCResponse(rpcResponse);
  return rpcResponse.value.unitsConsumed || null;
};

export async function getComputeUnitPrice(connection: Connection, ignoreZeroMembers = 1 / 2) {
  let prioritizationFees = await connection.getRecentPrioritizationFees();
  let length = prioritizationFees.length;
  let prioritizationZeros = 0, prioritizationTotal = 0;
  for (let i = 0; i < length; i++) {
    if (prioritizationFees[i].prioritizationFee === 0) {
      prioritizationZeros++;
    } else {
      prioritizationTotal += prioritizationFees[i].prioritizationFee;
    }
  }
  if (prioritizationZeros >= length * ignoreZeroMembers) {
    return 0;
  }
  return Math.ceil(
    prioritizationTotal / (length - prioritizationZeros),
  );
}
