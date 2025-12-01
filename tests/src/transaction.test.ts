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
  AddressLookupTableProgram,
} from "@solana/web3.js";
import {
  addComputeInstructions,
  airdropIfRequired,
  confirmTransaction,
  createLookupTable,
  encodeLength,
  getSignatureCountLength,
  getSimulationComputeUnits,
  sendTransaction,
  sendVersionedTransaction,
  serializeTransactionWithoutSizeLimit,
} from "../../src";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import assert from "node:assert";

const LOCALHOST = "http://127.0.0.1:8899";
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

describe("confirmTransaction", () => {
  test("confirmTransaction works for a successful transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const [sender, recipient] = [Keypair.generate(), Keypair.generate()];
    const lamportsToAirdrop = 2 * LAMPORTS_PER_SOL;
    await airdropIfRequired(connection, sender.publicKey, lamportsToAirdrop, 1 * LAMPORTS_PER_SOL);
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
  test("sendTransaction without priority fee should send and confirm a transaction", async () => {
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
    const signature = await sendTransaction(connection, transaction, [sender], 0, {
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
        console.log("status", status);
      },
    });

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );
  });

  test("prepareTransactionWithCompute should add compute budget instructions", async () => {
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
      assert.equal(instruction.programId.toString(), "ComputeBudget111111111111111111111111111111");
    });
  });

  test("send versioned transaction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    await airdropIfRequired(
      connection,
      sender.publicKey,
      2 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    const recipient = Keypair.generate();

    const instructions = [
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    ];

    const statusUpdates: any[] = [];
    const signature = await sendVersionedTransaction(connection, instructions, [sender], 1000, [], {
      computeUnitBuffer: { multiplier: 1.1 },
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
        console.log("status", status);
      },
    });

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );

    console.log("Versioned transaction signature", signature);
  });

  test("send versioned transaction with already setComputeLimit instructions", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    await airdropIfRequired(
      connection,
      sender.publicKey,
      2 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    const recipient = Keypair.generate();

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

    const statusUpdates: any[] = [];
    const signature = await sendVersionedTransaction(connection, instructions, [sender], 1000, [], {
      computeUnitBuffer: { multiplier: 1.1 },
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
        console.log("status", status);
      },
    });

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );

    console.log("Versioned transaction signature", signature);
  });

  test("send versioned transaction with lookup table", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    await airdropIfRequired(
      connection,
      sender.publicKey,
      2 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );

    const recipient = Keypair.generate();
    const recipient2 = Keypair.generate();
    const recipient3 = Keypair.generate();

    const [lookupTableAddress, lookupTableAccount] = await createLookupTable(connection, sender, [
      sender.publicKey,
      recipient.publicKey,
      recipient2.publicKey,
      recipient3.publicKey,
    ]);

    const instructions = [
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient2.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient3.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    ];

    const signature = await sendVersionedTransaction(connection, instructions, [sender], 10000, [
      lookupTableAccount,
    ]);

    assert.ok(signature);

    console.log("Versioned transaction with lookup tables signature", signature);
  });

  test("sendTransaction should prepare and send a transaction and add priority fee instructions", async () => {
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

    const statusUpdates: any[] = [];
    const signature = await sendTransaction(connection, transaction, [sender], 10000, {
      computeUnitBuffer: { multiplier: 1.1 },
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
        console.log("status", status);
      },
    });

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );

    // Verify compute budget instructions were added
    assert.equal(transaction.instructions.length, 3); // transfer + 2 compute budget instructions
    const computeInstructions = transaction.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    assert.equal(computeInstructions.length, 2);
  });

  test("sendTransaction still works when there is already a setComputeUnitPrice instruction", async () => {
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
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1000000,
      }),
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );

    const statusUpdates: any[] = [];
    const signature = await sendTransaction(connection, transaction, [sender], 10000, {
      computeUnitBuffer: { multiplier: 1.1 },
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
        console.log("status", status);
      },
    });

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );

    // Verify compute budget instructions were added
    assert.equal(transaction.instructions.length, 3); // transfer + 2 compute budget instructions
    const computeInstructions = transaction.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    assert.equal(computeInstructions.length, 2);
  });

  test("sendTransaction still works when there is already a setComputeUnitLimit instruction", async () => {
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
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 10000,
      }),
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: LAMPORTS_PER_SOL * 0.1,
      }),
    );

    const statusUpdates: any[] = [];
    const signature = await sendTransaction(connection, transaction, [sender], 10000, {
      computeUnitBuffer: { multiplier: 1.1 },
      onStatusUpdate: (status) => {
        statusUpdates.push(status);
        console.log("status", status);
      },
    });

    assert.ok(signature);
    assert.deepEqual(
      statusUpdates.map((s) => s.status),
      ["created", "signed", "sent", "confirmed"],
    );

    // Verify compute budget instructions were added
    assert.equal(transaction.instructions.length, 3); // transfer + 2 compute budget instructions
    const computeInstructions = transaction.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    assert.equal(computeInstructions.length, 2);
  });
});

describe("getSignatureCountLength", () => {
  test("returns 1 for counts less than 0x80 (127)", () => {
    assert.equal(getSignatureCountLength(1), 1);
    assert.equal(getSignatureCountLength(10), 1);
    assert.equal(getSignatureCountLength(127), 1);
  });

  test("returns 2 for counts between 0x80 and 0x4000 (128 to 16383)", () => {
    assert.equal(getSignatureCountLength(128), 2);
    assert.equal(getSignatureCountLength(1000), 2);
    assert.equal(getSignatureCountLength(16383), 2);
  });

  test("returns 3 for counts 0x4000 and above (16384+)", () => {
    assert.equal(getSignatureCountLength(16384), 3);
    assert.equal(getSignatureCountLength(20000), 3);
    assert.equal(getSignatureCountLength(65535), 3);
  });
});

describe("encodeLength", () => {
  test("encodes single-byte length correctly (count < 0x80)", () => {
    const buffer = Buffer.alloc(10);
    const bytesWritten = encodeLength(1, buffer, 0);
    assert.equal(bytesWritten, 1);
    assert.equal(buffer[0], 1);
  });

  test("encodes two-byte length correctly (0x80 <= count < 0x4000)", () => {
    const buffer = Buffer.alloc(10);
    const bytesWritten = encodeLength(128, buffer, 0);
    assert.equal(bytesWritten, 2);
    // 128 = 0x80, encoded as: 0x80 (with continuation bit) | 0x01
    // First byte: lowest 7 bits of 128 = 0, continuation bit set = 0x80
    // Second byte: 128 >> 7 = 1, lowest 7 bits = 1, no continuation = 0x01
    assert.equal(buffer[0], 0x80);
    assert.equal(buffer[1], 0x01);
  });

  test("encodes three-byte length correctly (count >= 0x4000)", () => {
    const buffer = Buffer.alloc(10);
    const bytesWritten = encodeLength(16384, buffer, 0);
    assert.equal(bytesWritten, 3);
    // 16384 = 0x4000, encoded as: 0x80 | 0x80 | 0x01
    // First byte: lowest 7 bits of 16384 = 0, continuation bit set = 0x80
    // Second byte: 16384 >> 7 = 128, lowest 7 bits = 0, continuation bit set = 0x80
    // Third byte: 128 >> 7 = 1, lowest 7 bits = 1, no continuation = 0x01
    assert.equal(buffer[0], 0x80);
    assert.equal(buffer[1], 0x80);
    assert.equal(buffer[2], 0x01);
  });

  test("writes to correct offset", () => {
    const buffer = Buffer.alloc(20);
    const offset = 5;
    const bytesWritten = encodeLength(10, buffer, offset);
    assert.equal(bytesWritten, 1);
    assert.equal(buffer[offset], 10);
    // Verify other positions are unchanged (still 0)
    assert.equal(buffer[offset - 1], 0);
    assert.equal(buffer[offset + 1], 0);
  });

  test("encodes various counts correctly", () => {
    const testCases = [
      { count: 0, expectedBytes: 1 },
      { count: 127, expectedBytes: 1 },
      { count: 128, expectedBytes: 2 },
      { count: 255, expectedBytes: 2 },
      { count: 16383, expectedBytes: 2 },
      { count: 16384, expectedBytes: 3 },
    ];

    for (const testCase of testCases) {
      const buffer = Buffer.alloc(10);
      const bytesWritten = encodeLength(testCase.count, buffer, 0);
      assert.equal(bytesWritten, testCase.expectedBytes, `Failed for count ${testCase.count}`);
    }
  });
});

describe("serializeTransactionWithoutSizeLimit", () => {
  test("serializes a standard signed transaction correctly", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1_000_000,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;
    transaction.sign(sender);

    const serialized = serializeTransactionWithoutSizeLimit(transaction);
    const standardSerialized = transaction.serialize();

    // For standard transactions, output should match
    assert.ok(Buffer.isBuffer(serialized));
    assert.equal(serialized.length, standardSerialized.length);
    assert.deepEqual(serialized, standardSerialized);
  });

  test("throws error when transaction is not signed", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1_000_000,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;
    // Transaction is NOT signed

    assert.throws(
      () => serializeTransactionWithoutSizeLimit(transaction),
      /Transaction must be fully signed before serialization/,
    );
  });

  test("serializes transaction with multiple signatures", async () => {
    const connection = new Connection(LOCALHOST);
    const sender1 = Keypair.generate();
    const sender2 = Keypair.generate();
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender1.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1_000_000,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender1.publicKey;
    // Add both signers to the transaction's required signers
    transaction.partialSign(sender1);
    transaction.partialSign(sender2);

    const serialized = serializeTransactionWithoutSizeLimit(transaction);

    assert.ok(Buffer.isBuffer(serialized));
    assert.ok(serialized.length > 0);
    // Should have 2 signatures (2 * 64 bytes) + signature count encoding + message
    assert.ok(serialized.length >= 128);
  });

  test("serializes large transaction without size limit error", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    const recipient = Keypair.generate();

    // Create a transaction with many instructions to exceed 1232 bytes
    const transaction = new Transaction();
    for (let i = 0; i < 50; i++) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000,
        }),
      );
    }

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;
    transaction.sign(sender);

    // Standard serialize would throw if > 1232 bytes
    let standardSerializeThrew = false;
    try {
      transaction.serialize();
    } catch (error) {
      standardSerializeThrew = true;
    }

    // Custom serialize should work regardless of size
    const serialized = serializeTransactionWithoutSizeLimit(transaction);
    assert.ok(Buffer.isBuffer(serialized));
    assert.ok(serialized.length > 0);

    // If standard serialize threw, verify our custom one is larger than 1232
    if (standardSerializeThrew) {
      assert.ok(serialized.length > 1232);
    }
  });

  test("produces valid transaction buffer structure", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1_000_000,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;
    transaction.sign(sender);

    const serialized = serializeTransactionWithoutSizeLimit(transaction);

    // Buffer should start with signature count (compact u16)
    assert.ok(serialized.length > 0);
    // First byte should be signature count (1 signature = 1 byte encoding)
    assert.equal(serialized[0], 1);

    // Next 64 bytes should be the signature
    const signatureBytes = serialized.slice(1, 65);
    assert.equal(signatureBytes.length, 64);
    // Signature should not be all zeros (would indicate unsigned)
    assert.ok(!signatureBytes.every((byte) => byte === 0));

    // Remaining bytes should be the serialized message
    const messageBytes = serialized.slice(65);
    assert.ok(messageBytes.length > 0);
  });

  test("handles transaction with memo instruction", async () => {
    const connection = new Connection(LOCALHOST);
    const sender = Keypair.generate();
    const recipient = Keypair.generate();

    const transaction = new Transaction()
      .add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      )
      .add(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from("test memo"),
        }),
      );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sender.publicKey;
    transaction.sign(sender);

    const serialized = serializeTransactionWithoutSizeLimit(transaction);
    const standardSerialized = transaction.serialize();

    // Should match standard serialize for valid transactions
    assert.deepEqual(serialized, standardSerialized);
  });
});
