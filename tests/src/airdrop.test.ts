import { describe, test } from "node:test";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  airdropIfRequired,
  initializeKeypair,
  keypairToSecretKeyJSON,
  type InitializeKeypairOptions,
} from "../../src";
import assert from "node:assert";
import dotenv from "dotenv";
import { mkdir, writeFile, unlink as deleteFile } from "node:fs/promises";

const LOCALHOST = "http://127.0.0.1:8899";
const TEMP_DIR = "temp";

describe("initializeKeypair", () => {
  const connection = new Connection(LOCALHOST);
  const keypairVariableName = "INITIALIZE_KEYPAIR_TEST";

  test("generates a new keypair and airdrops needed amount", async () => {
    // We need to use a specific file name to avoid conflicts with other tests
    const envFileName = "../.env-unittest-initkeypair";
    const options: InitializeKeypairOptions = {
      envFileName,
      envVariableName: keypairVariableName,
    };

    const userBefore = await initializeKeypair(connection, options);

    // Check balance
    const balanceBefore = await connection.getBalance(userBefore.publicKey);
    assert.ok(balanceBefore > 0n);

    // Check that the environment variable was created
    dotenv.config({ path: envFileName });
    const secretKeyString = process.env[keypairVariableName];
    if (!secretKeyString) {
      throw new Error(`${secretKeyString} not found in environment`);
    }

    // Now reload the environment and check it matches our test keypair
    const userAfter = await initializeKeypair(connection, options);

    // Check the keypair is the same
    assert.ok(userBefore.publicKey.equals(userAfter.publicKey));

    // Check balance has not changed
    const balanceAfter = await connection.getBalance(userAfter.publicKey);
    assert.equal(balanceBefore, balanceAfter);

    // Check there is a secret key
    assert.ok(userAfter.secretKey);

    await deleteFile(envFileName);
  });

  test("loads a keypair from keypairPath and airdrops the requested amount", async () => {
    const keypair = await Keypair.generate();
    const keypairPath = `${TEMP_DIR}/initialize-keypair-test.json`;
    await mkdir(TEMP_DIR, { recursive: true });
    await writeFile(keypairPath, keypairToSecretKeyJSON(keypair));

    const airdropAmount = 3 * LAMPORTS_PER_SOL;
    const loadedKeypair = await initializeKeypair(connection, {
      keypairPath,
      airdropAmount,
    });

    assert.ok(loadedKeypair.publicKey.equals(keypair.publicKey));
    const balance = await connection.getBalance(loadedKeypair.publicKey);
    assert.equal(balance, BigInt(airdropAmount));

    await deleteFile(keypairPath);
  });

  test("does not airdrop when airdropAmount is null", async () => {
    const keypair = await Keypair.generate();
    const keypairPath = `${TEMP_DIR}/initialize-keypair-no-airdrop-test.json`;
    await mkdir(TEMP_DIR, { recursive: true });
    await writeFile(keypairPath, keypairToSecretKeyJSON(keypair));

    const loadedKeypair = await initializeKeypair(connection, {
      keypairPath,
      airdropAmount: null,
    });

    const balance = await connection.getBalance(loadedKeypair.publicKey);
    assert.equal(balance, 0n);

    await deleteFile(keypairPath);
  });
});

describe("airdropIfRequired", () => {
  test("Checking the balance after airdropIfRequired", async () => {
    const keypair = await Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const originalBalance = await connection.getBalance(keypair.publicKey);
    assert.equal(originalBalance, 0n);
    const lamportsToAirdrop = 1 * LAMPORTS_PER_SOL;

    const newBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      1 * LAMPORTS_PER_SOL,
    );

    assert.equal(newBalance, BigInt(lamportsToAirdrop));

    const recipient = await Keypair.generate();

    // Spend our SOL now to ensure we can use the airdrop immediately
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 500_000_000,
        }),
      ),
      [keypair],
    );
  });

  test("doesn't request unnecessary airdrops", async () => {
    const keypair = await Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const originalBalance = await connection.getBalance(keypair.publicKey);
    assert.equal(originalBalance, 0n);
    const lamportsToAirdrop = 1 * LAMPORTS_PER_SOL;

    await airdropIfRequired(connection, keypair.publicKey, lamportsToAirdrop, 500_000);
    const finalBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      1 * LAMPORTS_PER_SOL,
    );
    // Check second airdrop didn't happen (since we only had 1 sol)
    assert.equal(finalBalance, BigInt(lamportsToAirdrop));
  });

  test("airdropIfRequired does airdrop when necessary", async () => {
    const keypair = await Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const originalBalance = await connection.getBalance(keypair.publicKey);
    assert.equal(originalBalance, 0n);
    // Get 999_999_999 lamports if we have less than 500_000 lamports
    const lamportsToAirdrop = 1 * LAMPORTS_PER_SOL - 1;
    await airdropIfRequired(connection, keypair.publicKey, lamportsToAirdrop, 500_000);
    // We only have 999_999_999 lamports, so we should need another airdrop
    const finalBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      1 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    // Check second airdrop happened
    assert.equal(finalBalance, BigInt(2 * LAMPORTS_PER_SOL - 1));
  });

  test("airdropIfRequired accepts bigint amounts", async () => {
    const keypair = await Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const lamportsToAirdrop = 2n * BigInt(LAMPORTS_PER_SOL);
    const newBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      lamportsToAirdrop,
    );
    assert.equal(newBalance, lamportsToAirdrop);
  });
});
