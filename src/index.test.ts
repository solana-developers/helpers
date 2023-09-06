import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "util";
import { exec as lameExec } from "child_process";
const exec = promisify(lameExec);
import { Keypair } from "@solana/web3.js";
import { getKeypairFromFile, getKeypairFromEnvironment } from "./index";
import { writeFile } from "node:fs/promises";
import base58 from "bs58";

const log = console.log;

const TEMP_DIR = "src/temp";

describe("getKeypairFromFile", () => {
  test("getting a keypair from a file", async () => {
    const TEST_FILE_NAME = `${TEMP_DIR}/test-keyfile-do-not-use.json`;
    const { stdout, stderr } = await exec(
      `solana-keygen new --force --no-bip39-passphrase -o ${TEST_FILE_NAME}`,
    );
    assert(stdout.includes("Wrote new keypair"));
    const keypair = await getKeypairFromFile(TEST_FILE_NAME);
  });

  test("throws a nice error if the file is missing", async () => {
    try {
      await getKeypairFromFile("I DONT EXIST");
    } catch (thrownObject) {
      const error = thrownObject as Error;
      assert.strictEqual(
        error.message,
        `Could not read keypair from file at 'I DONT EXIST'`,
      );
    }
  });

  test("throws a nice error if the file is corrupt", async () => {
    const TEST_FILE_NAME = `${TEMP_DIR}/corrupt-keyfile-do-not-use.json`;
    await writeFile(TEST_FILE_NAME, "I AM CORRUPT");
    try {
      await getKeypairFromFile(TEST_FILE_NAME);
    } catch (thrownObject) {
      const error = thrownObject as Error;
      assert.strictEqual(
        error.message,
        `Invalid secret key file at '${TEST_FILE_NAME}'!`,
      );
    }
  });
});

describe("getKeypairFromEnvironment", () => {
  test("getting a keypair from an environment variable (array of numbers format)", async () => {
    const randomKeypair = Keypair.generate();
    const TEST_ENV_VAR = "TEST_ENV_VAR";
    process.env[TEST_ENV_VAR] = JSON.stringify(
      Object.values(randomKeypair.secretKey),
    );

    await getKeypairFromEnvironment(TEST_ENV_VAR);
  });

  test("getting a keypair from an environment variable (base58 format)", async () => {
    const randomKeypair = Keypair.generate();
    const TEST_ENV_VAR = "TEST_ENV_VAR";
    process.env[TEST_ENV_VAR] = base58.encode(randomKeypair.secretKey);
    await getKeypairFromEnvironment(TEST_ENV_VAR);
  });

  test("throws a nice error if the env var doesn't exist", async () => {
    let keypair: Keypair;
    try {
      keypair = await getKeypairFromEnvironment("MISSING_ENV_VAR");
    } catch (thrownObject) {
      const error = thrownObject as Error;
      assert.strictEqual(
        error.message,
        `Please set 'MISSING_ENV_VAR' in environment.`,
      );
    }
  });

  test("throws a nice error if the value of the env var isn't valid", async () => {
    const TEST_ENV_VAR = "TEST_ENV_VAR_WITH_BAD_VALUE";
    process.env[TEST_ENV_VAR] = "this isn't a valid value for a secret key";

    try {
      await getKeypairFromEnvironment(TEST_ENV_VAR);
    } catch (thrownObject) {
      const error = thrownObject as Error;
      assert.strictEqual(
        error.message,
        `Invalid secret key in environment variable '${TEST_ENV_VAR}'!`,
      );
    }
  });
});
