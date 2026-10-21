import { before, describe, test } from "node:test";
import assert from "node:assert";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  airdropIfRequired,
  decodeAnchorTransaction,
  getIdlByPath,
  getIdlParsedAccountData,
  getLogs,
  parseAnchorTransactionEvents,
  sendTransaction,
} from "../../src";

// Version 1 transactions (SIMD-0385) put their compute budget in the message, and RPC nodes only
// return them to requests that set 'maxSupportedTransactionVersion' to 1 or more.
// These tests send v1 transactions to a local validator and read them back with the helpers.

const LOCALHOST = "http://127.0.0.1:8899";

// The counter program from devnet, whose IDL is in fixtures/counter-idl.json.
// 'npm run validator' starts the local validator with a copy of it, at the same program ID,
// since Anchor programs refuse to run at any other program ID.
// Tests run from the 'tests' directory
const COUNTER_IDL_PATH = "fixtures/counter-idl.json";
// sendTransaction() sends version 1 transactions
const sendV1Transaction = (
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  signers: Array<Keypair>,
) => sendTransaction(connection, instructions, signers, { onStatusUpdate: () => {} });

describe("reading version 1 transactions", () => {
  const connection = new Connection(LOCALHOST);
  let payer: Keypair;
  let counterProgramId: PublicKey;
  let counterAddress: PublicKey;
  let incrementSignature: string;
  let countBeforeIncrement: bigint;

  before(async () => {
    payer = await Keypair.generate();
    await airdropIfRequired(connection, payer.publicKey, LAMPORTS_PER_SOL, LAMPORTS_PER_SOL);

    const idl = await getIdlByPath(COUNTER_IDL_PATH);
    assert.ok("address" in idl);
    const getDiscriminator = (name: string) => {
      const instruction = idl.instructions.find((instruction) => instruction.name === name);
      assert.ok(instruction, `${name} instruction not in IDL`);
      return Uint8Array.from(instruction.discriminator);
    };

    counterProgramId = new PublicKey(idl.address);
    assert.ok(
      await connection.getAccountInfo(counterProgramId),
      "The counter program isn't on the local validator. Start the validator with 'npm run validator'.",
    );

    [counterAddress] = await PublicKey.findProgramAddress(
      [new TextEncoder().encode("counter")],
      counterProgramId,
    );

    // The counter account lasts as long as the local validator, so only make it once
    if (!(await connection.getAccountInfo(counterAddress))) {
      await sendV1Transaction(
        connection,
        [
          new TransactionInstruction({
            programId: counterProgramId,
            keys: [
              { pubkey: payer.publicKey, isSigner: true, isWritable: true },
              { pubkey: counterAddress, isSigner: false, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: getDiscriminator("initialize"),
          }),
        ],
        [payer],
      );
    }

    const counterBefore = await getIdlParsedAccountData(idl, "counter", counterAddress, connection);
    countBeforeIncrement = counterBefore.count as bigint;

    incrementSignature = await sendV1Transaction(
      connection,
      [
        new TransactionInstruction({
          programId: counterProgramId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: counterAddress, isSigner: false, isWritable: true },
          ],
          data: getDiscriminator("increment"),
        }),
      ],
      [payer],
    );

    const sentTransaction = await connection.getTransaction(incrementSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    });
    assert.equal(sentTransaction?.version, 1, "The test transaction should be a v1 transaction");
  });

  test("getLogs reads a v1 transaction", async () => {
    const recipient = await Keypair.generate();
    const signature = await sendV1Transaction(
      connection,
      [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      ],
      [payer],
    );
    const logs = await getLogs(connection, signature);
    assert.deepEqual(logs, [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ]);
  });

  test("decodeAnchorTransaction reads a v1 transaction", async () => {
    const idl = await getIdlByPath(COUNTER_IDL_PATH);
    const decoded = await decodeAnchorTransaction(idl, incrementSignature, connection);

    assert.equal(decoded.instructions.length, 1);
    const [instruction] = decoded.instructions;
    assert.equal(instruction.name, "increment");
    assert.deepEqual(instruction.data, {});

    const [signer, counter] = instruction.accounts;
    assert.equal(signer.name, "signer");
    assert.equal(signer.pubkey, payer.publicKey.toBase58());
    assert.equal(signer.isSigner, true);
    assert.equal(signer.isWritable, true);
    assert.equal(counter.name, "counter");
    assert.equal(counter.pubkey, counterAddress.toBase58());
    assert.equal(counter.isSigner, false);
    assert.equal(counter.isWritable, true);
    assert.equal(counter.data?.count, countBeforeIncrement + 1n);
  });

  test("parseAnchorTransactionEvents reads a v1 transaction", async () => {
    const idl = await getIdlByPath(COUNTER_IDL_PATH);
    const events = await parseAnchorTransactionEvents(idl, incrementSignature, connection);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.name, "counterEvent");
    assert.equal(event.data.counter, countBeforeIncrement + 1n);
    assert.equal(typeof event.data.timestamp, "bigint");
  });
});
