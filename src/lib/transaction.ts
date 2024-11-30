import {
  AddressLookupTableAccount,
  Commitment,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Signer, Transaction
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

  getErrorFromRPCResponse(rpcResponse);
  return rpcResponse.value.unitsConsumed || null;
};

export const getLegacySimulationComputeUnits = async (
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  signers: Array<PublicKey> | Array<Signer>,
  feePayer?: PublicKey | Signer
): Promise<number | null> => {
  const testInstructions = [
    // Set an arbitrarily high number in simulation
    // so we can be sure the transaction will succeed
    // and get the real compute units used
    ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000}),
    ...instructions,
  ];
  signers = (signers as Signer[]).map(signer => signer?.publicKey ? signer.publicKey : signer) as Array<PublicKey>
  feePayer = ((feePayer as Signer)?.publicKey ? (feePayer as Signer).publicKey : feePayer || signers[0]) as PublicKey

  const transaction = new Transaction();
  transaction.instructions = testInstructions;
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = '11111111111111111111111111111111';

  // deprecated:
  // transaction.setSigners(...signers.map(signer => signer.publicKey))
  transaction.signatures = signers.map(publicKey => ({
    signature: null,
    publicKey
  }))

  const args = [
    transaction.serialize({ verifySignatures: false }).toString('base64'),
    {
      encoding: 'base64',
      replaceRecentBlockhash: true
    }
  ];

  // deprecated:
  // const rpcResponse = await connection.simulateTransaction(transaction, signers);
  // @ts-ignore
  const rpcResponse = (await connection._rpcRequest('simulateTransaction', args)).result

  getErrorFromRPCResponse(rpcResponse);
  return rpcResponse.value.unitsConsumed || null;
};
