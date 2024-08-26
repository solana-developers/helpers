import assert from "node:assert";
import { addKeypairToEnvFile, getKeypairFromEnvironment, getKeypairFromFile, makeKeypairs } from "../src";
import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
// See https://m.media-amazon.com/images/I/51TJeGHxyTL._SY445_SX342_.jpg
import { exec as execNoPromises } from "child_process";
import { promisify } from "node:util";
import { writeFile, unlink as deleteFile } from "node:fs/promises";
import dotenv from "dotenv";

const exec = promisify(execNoPromises);
const TEMP_DIR = "tests/temp";

describe("addKeypairToEnvFile", () => {
  let TEST_ENV_VAR_ARRAY_OF_NUMBERS = "TEST_ENV_VAR_ARRAY_OF_NUMBERS";
  let testKeypair: Keypair;

  beforeAll(async () => {
    testKeypair = Keypair.generate();

    process.env[TEST_ENV_VAR_ARRAY_OF_NUMBERS] = JSON.stringify(
      Object.values(testKeypair.secretKey),
    );
  });

  test("generates new keypair and writes to env if variable doesn't exist", async () => {
    // We need to use a specific file name to avoid conflicts with other tests
    const envFileName = "./tests/.env-unittest-addkeypairtoenvfile";
    await addKeypairToEnvFile(testKeypair, "TEMP_KEYPAIR", envFileName);

    // Now reload the environment and check it matches our test keypair
    dotenv.config({ path: envFileName });

    // Get the secret from the .env file
    const secretKeyString = process.env["TEMP_KEYPAIR"];

    if (!secretKeyString) {
      throw new Error("TEMP_KEYPAIR not found in environment");
    }
    const decodedSecretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const envKeypair = Keypair.fromSecretKey(decodedSecretKey);

    assert.ok(envKeypair.secretKey);

    await deleteFile(envFileName);
  });

  test("throws a nice error if the env var already exists", async () => {
    assert.rejects(
      async () =>
        addKeypairToEnvFile(testKeypair, TEST_ENV_VAR_ARRAY_OF_NUMBERS),
      {
        message: `'TEST_ENV_VAR_ARRAY_OF_NUMBERS' already exists in env file.`,
      },
    );
  });
});

describe("makeKeypairs", () => {
  test("makeKeypairs makes exactly the amount of keypairs requested", () => {
    // We could test more, but keypair generation takes time and slows down tests
    const KEYPAIRS_TO_MAKE = 3;
    const keypairs = makeKeypairs(KEYPAIRS_TO_MAKE);
    assert.equal(keypairs.length, KEYPAIRS_TO_MAKE);
    assert.ok(keypairs[KEYPAIRS_TO_MAKE - 1].secretKey);
  });

  test("makeKeypairs() creates the correct number of keypairs", () => {
    const keypairs = makeKeypairs(3);
    assert.equal(keypairs.length, 3);
  });
});

describe("getKeypairFromFile", () => {
  let TEST_FILE_NAME = `${TEMP_DIR}/test-keyfile-do-not-use.json`;
  let MISSING_FILE_NAME = "THIS FILE DOES NOT EXIST";
  let CORRUPT_TEST_FILE_NAME = `${TEMP_DIR}/corrupt-keyfile-do-not-use.json`;
  beforeAll(async () => {
    const { stdout } = await exec(
      `solana-keygen new --force --no-bip39-passphrase -o ${TEST_FILE_NAME}`,
    );
    assert(stdout.includes("Wrote new keypair"));

    await writeFile(CORRUPT_TEST_FILE_NAME, "I AM CORRUPT");
  });

  test("getting a keypair from a file", async () => {
    await getKeypairFromFile(TEST_FILE_NAME);
  });

  test("throws a nice error if the file is missing", async () => {
    assert.rejects(async () => await getKeypairFromFile(MISSING_FILE_NAME), {
      message: `Could not read keypair from file at '${MISSING_FILE_NAME}'`,
    });
  });

  test("throws a nice error if the file is corrupt", async () => {
    assert.rejects(() => getKeypairFromFile(CORRUPT_TEST_FILE_NAME), {
      message: `Invalid secret key file at '${CORRUPT_TEST_FILE_NAME}'!`,
    });
  });
});

describe("getKeypairFromEnvironment", () => {
  let TEST_ENV_VAR_ARRAY_OF_NUMBERS = "TEST_ENV_VAR_ARRAY_OF_NUMBERS";
  let TEST_ENV_VAR_BASE58 = "TEST_ENV_VAR_BASE58";
  let TEST_ENV_VAR_WITH_BAD_VALUE = "TEST_ENV_VAR_WITH_BAD_VALUE";

  beforeAll(async () => {
    const randomKeypair = Keypair.generate();

    process.env[TEST_ENV_VAR_ARRAY_OF_NUMBERS] = JSON.stringify(
      Object.values(randomKeypair.secretKey),
    );

    process.env[TEST_ENV_VAR_BASE58] = base58.encode(randomKeypair.secretKey);

    process.env[TEST_ENV_VAR_WITH_BAD_VALUE] =
      "this isn't a valid value for a secret key";
  });

  test("getting a keypair from an environment variable (array of numbers format)", async () => {
    await getKeypairFromEnvironment(TEST_ENV_VAR_ARRAY_OF_NUMBERS);
  });

  test("getting a keypair from an environment variable (base58 format)", async () => {
    await getKeypairFromEnvironment(TEST_ENV_VAR_BASE58);
  });

  test("throws a nice error if the env var doesn't exist", () => {
    assert.throws(() => getKeypairFromEnvironment("MISSING_ENV_VAR"), {
      message: `Please set 'MISSING_ENV_VAR' in environment.`,
    });
  });

  test("throws a nice error if the value of the env var isn't valid", () => {
    assert.throws(
      () => getKeypairFromEnvironment("TEST_ENV_VAR_WITH_BAD_VALUE"),
      {
        message: `Invalid secret key in environment variable 'TEST_ENV_VAR_WITH_BAD_VALUE'!`,
      },
    );
  });
});