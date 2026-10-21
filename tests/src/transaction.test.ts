import { describe, test } from "node:test";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  Connection,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  PublicKey,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  addComputeInstructions,
  airdropIfRequired,
  confirmTransaction,
  createLookupTable,
  getSimulationComputeUnits,
  hasSetComputeLimitInstruction,
  hasSetComputeUnitPriceInstruction,
  sendTransaction,
  sendTransactionWithLookupTables,
  type TxStatusUpdate,
} from "../../src";
import { blockhash } from "@solana/kit";
import assert from "node:assert";

const LOCALHOST = "http://127.0.0.1:8899";
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// SystemError::ResultWithNegativeLamports
// See https://github.com/anza-xyz/agave/blob/master/sdk/program/src/system_instruction.rs
const SYSTEM_PROGRAM_INSUFFICIENT_FUNDS_ERROR = 1;

// A SOL transfer uses 150 compute units, and sendTransaction() adds 10% by default
const SOL_TRANSFER_COMPUTE_UNITS = 150;
const DEFAULT_BUFFERED_SOL_TRANSFER_COMPUTE_UNITS = Math.floor(SOL_TRANSFER_COMPUTE_UNITS * 1.1);
// The fee for each signature, in lamports
// See https://solana.com/docs/core/fees#base-transaction-fee
const BASE_FEE_PER_SIGNATURE_LAMPORTS = 5000n;

const getSentTransaction = async (connection: Connection, signature: string) => {
  const sentTransaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  });
  assert.ok(sentTransaction, `Transaction ${signature} not found`);
  return sentTransaction;
};

const getV1TransactionConfig = async (connection: Connection, signature: string) => {
  const sentTransaction = await getSentTransaction(connection, signature);
  assert.equal(sentTransaction.version, 1, "Should be a version 1 transaction");
  const message = sentTransaction.transaction.message;
  assert.ok("transactionConfig" in message);
  return { transactionConfig: message.transactionConfig, meta: sentTransaction.meta };
};

const makeFundedKeypair = async (connection: Connection, lamports = 2 * LAMPORTS_PER_SOL) => {
  const keypair = await Keypair.generate();
  await airdropIfRequired(connection, keypair.publicKey, lamports, lamports);
  return keypair;
};

describe("confirmTransaction", () => {
  test("confirmTransaction works for a successful transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();
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
    assert.equal(await confirmTransaction(connection, signature), signature);
  });

  test("confirmTransaction throws for a failed transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    const recipient = await Keypair.generate();
    const signature = await connection.sendTransaction(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          // More than the sender has
          lamports: 5 * LAMPORTS_PER_SOL,
        }),
      ),
      [sender],
      { skipPreflight: true },
    );
    await assert.rejects(() => confirmTransaction(connection, signature), {
      message: `Error in transaction: instruction index 0, custom program error ${SYSTEM_PROGRAM_INSUFFICIENT_FUNDS_ERROR}`,
    });
  });
});

describe("hasSetComputeLimitInstruction and hasSetComputeUnitPriceInstruction", () => {
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: PublicKey.default,
    toPubkey: PublicKey.default,
    lamports: 1,
  });
  const computeUnitLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 });
  const computeUnitPriceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000,
  });

  test("finds a SetComputeUnitLimit instruction", () => {
    assert.equal(hasSetComputeLimitInstruction([transferInstruction]), false);
    assert.equal(
      hasSetComputeLimitInstruction([computeUnitLimitInstruction, transferInstruction]),
      true,
    );
    assert.equal(
      hasSetComputeLimitInstruction([computeUnitPriceInstruction, transferInstruction]),
      false,
    );
  });

  test("finds a SetComputeUnitPrice instruction", () => {
    assert.equal(hasSetComputeUnitPriceInstruction([transferInstruction]), false);
    assert.equal(
      hasSetComputeUnitPriceInstruction([transferInstruction, computeUnitPriceInstruction]),
      true,
    );
    assert.equal(
      hasSetComputeUnitPriceInstruction([computeUnitLimitInstruction, transferInstruction]),
      false,
    );
  });
});

describe("getSimulationComputeUnits", () => {
  test("getSimulationComputeUnits returns the compute units for a SOL transfer, and for a SOL transfer with a memo", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    const recipient = (await Keypair.generate()).publicKey;
    const sendSol = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: 1_000_000,
    });
    const sayThanks = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: new TextEncoder().encode("thanks"),
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

  test("getSimulationComputeUnits throws with the logs when the simulation fails", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    const recipient = (await Keypair.generate()).publicKey;
    const sendTooMuchSol = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: 5 * LAMPORTS_PER_SOL,
    });
    await assert.rejects(
      () => getSimulationComputeUnits(connection, [sendTooMuchSol], sender.publicKey),
      (error: Error) => {
        assert.match(error.message, /^Transaction simulation failed:/);
        assert.match(error.message, /insufficient lamports/);
        return true;
      },
    );
  });
});

describe("sendTransaction", () => {
  test("sends a version 1 transaction, with simulated compute units and loaded accounts data size", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();

    const statusUpdates: Array<TxStatusUpdate> = [];
    const signature = await sendTransaction(
      connection,
      [
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: LAMPORTS_PER_SOL * 0.1,
        }),
      ],
      [sender],
      {
        onStatusUpdate: (status) => {
          statusUpdates.push(status);
        },
      },
    );

    assert.deepEqual(
      statusUpdates.map((statusUpdate) => statusUpdate.status),
      ["created", "signed", "sent", "confirmed"],
    );
    assert.equal(await connection.getBalance(recipient.publicKey), BigInt(LAMPORTS_PER_SOL * 0.1));

    const { transactionConfig, meta } = await getV1TransactionConfig(connection, signature);
    assert.equal(transactionConfig?.computeUnitLimit, DEFAULT_BUFFERED_SOL_TRANSFER_COMPUTE_UNITS);
    assert.ok(transactionConfig?.loadedAccountsDataSizeLimit);
    assert.ok(transactionConfig.loadedAccountsDataSizeLimit > 0);
    // No priority fee unless one is requested
    assert.equal(transactionConfig.priorityFeeLamports, undefined);
    assert.equal(meta?.fee, BASE_FEE_PER_SIGNATURE_LAMPORTS);
  });

  test("uses the compute budget in transactionConfig, and charges its priority fee", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();
    const requestedConfig = {
      computeUnitLimit: 10_000,
      loadedAccountsDataSizeLimit: 100_000,
      priorityFeeLamports: 7_000n,
    };

    const signature = await sendTransaction(
      connection,
      [
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      ],
      [sender],
      { transactionConfig: requestedConfig, onStatusUpdate: () => {} },
    );

    const { transactionConfig, meta } = await getV1TransactionConfig(connection, signature);
    assert.equal(transactionConfig?.computeUnitLimit, requestedConfig.computeUnitLimit);
    assert.equal(
      transactionConfig?.loadedAccountsDataSizeLimit,
      requestedConfig.loadedAccountsDataSizeLimit,
    );
    assert.equal(transactionConfig?.priorityFeeLamports, requestedConfig.priorityFeeLamports);
    assert.equal(meta?.fee, BASE_FEE_PER_SIGNATURE_LAMPORTS + requestedConfig.priorityFeeLamports);
  });

  test("applies a custom computeUnitBuffer to the simulated compute units", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();

    const signature = await sendTransaction(
      connection,
      [
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      ],
      [sender],
      { computeUnitBuffer: { multiplier: 2, fixed: 1_000 }, onStatusUpdate: () => {} },
    );

    const { transactionConfig } = await getV1TransactionConfig(connection, signature);
    assert.equal(transactionConfig?.computeUnitLimit, SOL_TRANSFER_COMPUTE_UNITS * 2 + 1_000);
  });

  test("sends the instructions of an unsigned legacy Transaction as a version 1 transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );
    transaction.feePayer = sender.publicKey;

    const signature = await sendTransaction(connection, transaction, [sender], {
      onStatusUpdate: () => {},
    });

    await getV1TransactionConfig(connection, signature);
    assert.equal(await connection.getBalance(recipient.publicKey), BigInt(LAMPORTS_PER_SOL * 0.1));
  });

  test("throws for compute budget instructions, which do nothing in a version 1 transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await Keypair.generate();
    const transfer = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: PublicKey.default,
      lamports: 1,
    });
    const message =
      "Compute budget instructions do nothing in a version 1 transaction. Remove them, and set computeUnitLimit and priorityFeeLamports in transactionConfig instead.";

    await assert.rejects(
      () =>
        sendTransaction(
          connection,
          [ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 }), transfer],
          [sender],
        ),
      { message },
    );
    await assert.rejects(
      () =>
        sendTransaction(
          connection,
          new Transaction().add(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
            transfer,
          ),
          [sender],
        ),
      { message },
    );
  });

  test("throws for an already signed Transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await Keypair.generate();
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: PublicKey.default,
        lamports: 1,
      }),
    );
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = sender.publicKey;
    await transaction.sign(sender);

    await assert.rejects(() => sendTransaction(connection, transaction, [sender]), {
      message:
        "The transaction is already signed, so it can't be sent as a version 1 transaction without invalidating its signatures. Send it with connection.sendRawTransaction() instead.",
    });
  });

  test("throws with the logs when the simulation fails", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    const recipient = await Keypair.generate();

    await assert.rejects(
      () =>
        sendTransaction(
          connection,
          [
            SystemProgram.transfer({
              fromPubkey: sender.publicKey,
              toPubkey: recipient.publicKey,
              lamports: 5 * LAMPORTS_PER_SOL,
            }),
          ],
          [sender],
        ),
      (error: Error) => {
        assert.match(error.message, /^Transaction simulation failed:/);
        assert.match(error.message, /insufficient lamports/);
        return true;
      },
    );
  });

  test("throws when the transaction fails onchain", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    const recipient = await Keypair.generate();

    const statusUpdates: Array<TxStatusUpdate> = [];
    await assert.rejects(
      () =>
        sendTransaction(
          connection,
          [
            SystemProgram.transfer({
              fromPubkey: sender.publicKey,
              toPubkey: recipient.publicKey,
              lamports: 5 * LAMPORTS_PER_SOL,
            }),
          ],
          [sender],
          {
            // Providing the compute budget skips the simulation, so the failing transaction is sent
            transactionConfig: { computeUnitLimit: 10_000, loadedAccountsDataSizeLimit: 100_000 },
            onStatusUpdate: (status) => {
              statusUpdates.push(status);
            },
          },
        ),
      {
        message: `Error in transaction: instruction index 0, custom program error ${SYSTEM_PROGRAM_INSUFFICIENT_FUNDS_ERROR}`,
      },
    );
    assert.ok(!statusUpdates.some((statusUpdate) => statusUpdate.status === "confirmed"));
  });

  test("retries, then gives up after maxRetries attempts", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );
    // A blockhash the validator has never seen, so the transaction never lands
    transaction.recentBlockhash = blockhash((await Keypair.generate()).publicKey.toBase58());

    const maxRetries = 3;
    const statusUpdates: Array<TxStatusUpdate> = [];
    await assert.rejects(
      () =>
        sendTransaction(connection, transaction, [sender], {
          maxRetries,
          initialDelayMs: 500,
          onStatusUpdate: (status) => {
            statusUpdates.push(status);
          },
        }),
      { message: `Transaction failed after ${maxRetries} attempts` },
    );

    assert.deepEqual(
      statusUpdates.map((statusUpdate) => statusUpdate.status),
      ["created", "signed", "sent", "retry", "retry"],
    );
    assert.equal(await connection.getBalance(recipient.publicKey), 0n);
  });
});

describe("addComputeInstructions", () => {
  test("addComputeInstructions should add compute budget instructions", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );

    const initialInstructionCount = transaction.instructions.length;

    transaction.instructions = await addComputeInstructions(
      connection,
      transaction.instructions,
      [],
      sender.publicKey,
      1000,
      { multiplier: 1.1 },
    );

    // Should add 2 instructions: setComputeUnitPrice and setComputeUnitLimit
    assert.equal(transaction.instructions.length, initialInstructionCount + 2);

    // Verify the instructions are ComputeBudget instructions
    const newInstructions = transaction.instructions.slice(initialInstructionCount);
    newInstructions.forEach((instruction) => {
      assert.ok(instruction.programId.equals(ComputeBudgetProgram.programId));
    });
    assert.ok(hasSetComputeUnitPriceInstruction(newInstructions));
    assert.ok(hasSetComputeLimitInstruction(newInstructions));
  });
});

describe("createLookupTable and sendTransactionWithLookupTables", () => {
  test("sends a version 0 transaction that uses a lookup table", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);

    const [recipient, recipient2, recipient3] = await Promise.all([
      Keypair.generate(),
      Keypair.generate(),
      Keypair.generate(),
    ]);

    const [lookupTableAddress, lookupTableAccount] = await createLookupTable(connection, sender, [
      sender.publicKey,
      recipient.publicKey,
      recipient2.publicKey,
      recipient3.publicKey,
    ]);

    assert.ok(lookupTableAccount.key.equals(lookupTableAddress));
    assert.deepEqual(
      lookupTableAccount.state.addresses.map((address) => address.toBase58()),
      [sender, recipient, recipient2, recipient3].map((keypair) => keypair.publicKey.toBase58()),
    );

    const instructions = [recipient, recipient2, recipient3].map((recipient) =>
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );

    // The compute budget instructions are added to the instructions array
    const transferCount = instructions.length;
    const statusUpdates: Array<TxStatusUpdate> = [];
    const signature = await sendTransactionWithLookupTables(
      connection,
      instructions,
      [sender],
      [lookupTableAccount],
      10000,
      {
        onStatusUpdate: (status) => {
          statusUpdates.push(status);
        },
      },
    );

    // A just-made lookup table can take a slot to become usable, so the first send may be retried
    const statuses = statusUpdates.map((statusUpdate) => statusUpdate.status);
    assert.deepEqual(statuses.slice(0, 3), ["created", "signed", "sent"]);
    assert.equal(statuses.at(-1), "confirmed");
    const sentTransaction = await getSentTransaction(connection, signature);
    assert.equal(sentTransaction.version, 0);
    const sentMessage = sentTransaction.transaction.message;
    assert.ok("addressTableLookups" in sentMessage);
    assert.equal(sentMessage.addressTableLookups.length, 1);
    // Compute budget instructions were added, since a version 0 transaction uses them
    assert.equal(sentMessage.compiledInstructions.length, transferCount + 2);
    assert.equal(await connection.getBalance(recipient3.publicKey), BigInt(LAMPORTS_PER_SOL * 0.1));
  });

  test("sends the instructions as they are when they include a SetComputeUnitLimit instruction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection);
    const recipient = await Keypair.generate();

    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000,
      }),
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    ];

    const signature = await sendTransactionWithLookupTables(
      connection,
      instructions,
      [sender],
      [],
      1000,
      { onStatusUpdate: () => {} },
    );

    const sentTransaction = await getSentTransaction(connection, signature);
    assert.equal(sentTransaction.version, 0);
    assert.equal(sentTransaction.transaction.message.compiledInstructions.length, 2);
  });

  test("throws when the transaction fails onchain", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = await makeFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    const recipient = await Keypair.generate();

    const instructions = [
      // Providing a compute unit limit skips the simulation, so the failing transaction is sent
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000,
      }),
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 5 * LAMPORTS_PER_SOL,
      }),
    ];

    const statusUpdates: Array<TxStatusUpdate> = [];
    await assert.rejects(
      () =>
        sendTransactionWithLookupTables(connection, instructions, [sender], [], 1000, {
          onStatusUpdate: (status) => {
            statusUpdates.push(status);
          },
        }),
      {
        message: `Error in transaction: instruction index 1, custom program error ${SYSTEM_PROGRAM_INSUFFICIENT_FUNDS_ERROR}`,
      },
    );
    assert.ok(!statusUpdates.some((statusUpdate) => statusUpdate.status === "confirmed"));
  });
});
