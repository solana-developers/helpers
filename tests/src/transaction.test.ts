import { describe, test } from "node:test";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import {
  airdropIfRequired,
  confirmTransaction,
  getSimulationComputeUnits,
  isVersionedTransaction,
} from "../../src";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import assert from "node:assert";
import { TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

const LOCALHOST = "http://127.0.0.1:8899";
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

describe("confirmTransaction", () => {
  test("confirmTransaction works for a successful transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const [sender, recipient] = [Keypair.generate(), Keypair.generate()];
    const lamportsToAirdrop = 2 * LAMPORTS_PER_SOL;
    await airdropIfRequired(
      connection,
      sender.publicKey,
      lamportsToAirdrop,
      1 * LAMPORTS_PER_SOL,
    );

    const signature = await sendAndConfirmTransaction(connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      ),
      [sender],
    );

    await confirmTransaction(connection, signature);
  });
});

describe("getSimulationComputeUnits", () => {
  test("getSimulationComputeUnits returns 300 CUs for a SOL transfer, and 3888 for a SOL transfer with a memo", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    await airdropIfRequired(
      connection,
      sender.publicKey,
      1 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    const recipient = Keypair.generate().publicKey;

    const sendSol = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: 1_000_000,
    });

    const sayThanks = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from("thanks"),
    });

    const computeUnitsSendSol = await getSimulationComputeUnits(
      connection,
      [sendSol],
      sender.publicKey,
      [],
    );

    // TODO: it would be useful to have a breakdown of exactly how 300 CUs is calculated
    assert.equal(computeUnitsSendSol, 300);

    const computeUnitsSendSolAndSayThanks = await getSimulationComputeUnits(
      connection,
      [sendSol, sayThanks],
      sender.publicKey,
      [],
    );

    // TODO: it would be useful to have a breakdown of exactly how 3888 CUs is calculated
    // also worth reviewing why memo program seems to use so many CUs.
    assert.equal(computeUnitsSendSolAndSayThanks, 3888);
  });
});

describe("isVersionedTx", () => {
  test("isVersionedTx returns true for a VersionedTransaction", async () => {
    const payer = Keypair.generate();
    const toAccount = Keypair.generate();

    // connect to the cluster and get the minimum rent for rent exempt status
    const connection = new Connection(LOCALHOST);
    let minRent = await connection.getMinimumBalanceForRentExemption(0);
    let blockhash = await connection
      .getLatestBlockhash()
      .then((res) => res.blockhash);

    const instructions = [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: toAccount.publicKey,
        lamports: minRent,
      }),
    ];

    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    // sign your transaction with the required `Signers`
    transaction.sign([payer]);
    
    const result = isVersionedTransaction(transaction);

    assert.equal(result, true);
  });
});
