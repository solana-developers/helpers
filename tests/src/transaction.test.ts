import { describe, test } from "node:test";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  Connection,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  PublicKey,
} from "@solana/web3.js";
import {
  airdropIfRequired,
  confirmTransaction,
  getSimulationComputeUnits,
  prepareTransactionWithCompute,
  sendTransactionWithRetry,
} from "../../src";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import assert from "node:assert";

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

    const signature = await sendAndConfirmTransaction(
      connection,
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

describe("Transaction utilities", () => {
  test.only("sendTransactionWithRetry should send and confirm a transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    await airdropIfRequired(
      connection,
      sender.publicKey,
      2 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );

    // Add recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;

    const statusUpdates: any[] = [];
    const signature = await sendTransactionWithRetry(
      connection,
      transaction,
      [sender],
      {
        commitment: "confirmed",
        onStatusUpdate: (status) => statusUpdates.push(status),
      },
    );

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );
  });

  test.only("prepareTransactionWithCompute should add compute budget instructions", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    await airdropIfRequired(
      connection,
      sender.publicKey,
      2 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );

    // Add recent blockhash and feePayer
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;

    const initialInstructionCount = transaction.instructions.length;

    await prepareTransactionWithCompute(
      connection,
      transaction,
      sender.publicKey,
      1000,
      { multiplier: 1.1 },
    );

    // Should add 2 instructions: setComputeUnitPrice and setComputeUnitLimit
    assert.equal(transaction.instructions.length, initialInstructionCount + 2);

    // Verify the instructions are ComputeBudget instructions
    const newInstructions = transaction.instructions.slice(
      initialInstructionCount,
    );
    newInstructions.forEach((instruction) => {
      assert.equal(
        instruction.programId.toString(),
        "ComputeBudget111111111111111111111111111111",
      );
    });
  });
});
