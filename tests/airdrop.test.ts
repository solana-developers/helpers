import { Connection } from "@solana/web3.js";
import { airdropIfRequired, initializeKeypair, InitializeKeypairOptions } from "../src";
import assert from "node:assert";
import dotenv from "dotenv";
import { unlink as deleteFile } from "node:fs/promises"
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { sendAndConfirmTransaction } from "@solana/web3.js";

const LOCALHOST = "http://127.0.0.1:8899";

describe("initializeKeypair", () => {
  const connection = new Connection(LOCALHOST);
  const keypairVariableName = "INITIALIZE_KEYPAIR_TEST";

  test("generates a new keypair and airdrops needed amount", async () => {
    // We need to use a specific file name to avoid conflicts with other tests
    const envFileName = "./tests/.env-unittest-initkeypair";
    const options: InitializeKeypairOptions = {
      envFileName,
      envVariableName: keypairVariableName,
    };

    const signerFirstLoad = await initializeKeypair(connection, options);

    // Check balance
    const firstBalanceLoad = await connection.getBalance(
      signerFirstLoad.publicKey,
    );
    assert.ok(firstBalanceLoad > 0);

    // Check that the environment variable was created
    dotenv.config({ path: envFileName });
    const secretKeyString = process.env[keypairVariableName];
    if (!secretKeyString) {
      throw new Error(`${secretKeyString} not found in environment`);
    }

    // Now reload the environment and check it matches our test keypair
    const signerSecondLoad = await initializeKeypair(connection, options);

    // Check the keypair is the same
    assert.ok(signerFirstLoad.publicKey.equals(signerSecondLoad.publicKey));

    // Check balance has not changed
    const secondBalanceLoad = await connection.getBalance(
      signerSecondLoad.publicKey,
    );
    assert.equal(firstBalanceLoad, secondBalanceLoad);

    // Check there is a secret key
    assert.ok(signerSecondLoad.secretKey);

    await deleteFile(envFileName);
  });
});

describe("airdropIfRequired", () => {
  test("Checking the balance after airdropIfRequired", async () => {
    const keypair = Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const originalBalance = await connection.getBalance(keypair.publicKey);
    assert.equal(originalBalance, 0);
    const lamportsToAirdrop = 1 * LAMPORTS_PER_SOL;

    const newBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      1 * LAMPORTS_PER_SOL,
    );

    assert.equal(newBalance, lamportsToAirdrop);

    const recipient = Keypair.generate();

    // Spend our SOL now to ensure we can use the airdrop immediately
    await sendAndConfirmTransaction(connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 500_000_000,
        }),
      ),
      [keypair],
    )
  });

  test("doesn't request unnecessary airdrops", async () => {
    const keypair = Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const originalBalance = await connection.getBalance(keypair.publicKey);
    assert.equal(originalBalance, 0);
    const lamportsToAirdrop = 1 * LAMPORTS_PER_SOL;

    await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      500_000,
    );
    const finalBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      1 * LAMPORTS_PER_SOL,
    );
    // Check second airdrop didn't happen (since we only had 1 sol)
    assert.equal(finalBalance, 1 * lamportsToAirdrop);
  });

  test("airdropIfRequired does airdrop when necessary", async () => {
    const keypair = Keypair.generate();
    const connection = new Connection(LOCALHOST);
    const originalBalance = await connection.getBalance(keypair.publicKey);
    assert.equal(originalBalance, 0);
    // Get 999_999_999 lamports if we have less than 500_000 lamports
    const lamportsToAirdrop = 1 * LAMPORTS_PER_SOL - 1;
    await airdropIfRequired(
      connection,
      keypair.publicKey,
      lamportsToAirdrop,
      500_000,
    );
    // We only have 999_999_999 lamports, so we should need another airdrop
    const finalBalance = await airdropIfRequired(
      connection,
      keypair.publicKey,
      1 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );
    // Check second airdrop happened
    assert.equal(finalBalance, 2 * LAMPORTS_PER_SOL - 1);
  });
});