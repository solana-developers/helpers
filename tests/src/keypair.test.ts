import { describe, test, before, after } from "node:test";
import assert from "node:assert";
import {
  addKeypairToEnvFile,
  getKeypairFromEnvironment,
  getKeypairFromFile,
  keypairToSecretKeyJSON,
  makeKeypairs,
} from "../../src";
import { Keypair } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
// See https://m.media-amazon.com/images/I/51TJeGHxyTL._SY445_SX342_.jpg
import { exec as execNoPromises } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile, unlink as deleteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dotenv from "dotenv";

const exec = promisify(execNoPromises);
const TEMP_DIR = "temp";

describe("keypairToSecretKeyJSON", () => {
  test("makes a JSON array of numbers that can be turned back into the same keypair", async () => {
    const keypair = await Keypair.generate();
    const secretKeyJSON = keypairToSecretKeyJSON(keypair);

    const secretKeyNumbers = JSON.parse(secretKeyJSON);
    assert.ok(Array.isArray(secretKeyNumbers));
    // Solana secret keys are the 32 byte private key followed by the 32 byte public key
    assert.equal(secretKeyNumbers.length, 64);

    const restoredKeypair = await Keypair.fromSecretKey(Uint8Array.from(secretKeyNumbers));
    assert.ok(restoredKeypair.publicKey.equals(keypair.publicKey));
  });
});

describe("addKeypairToEnvFile", () => {
  const TEST_ENV_VAR_ARRAY_OF_NUMBERS = "TEST_ENV_VAR_ARRAY_OF_NUMBERS";
  let testKeypair: Keypair;

  before(async () => {
    testKeypair = await Keypair.generate();

    process.env[TEST_ENV_VAR_ARRAY_OF_NUMBERS] = keypairToSecretKeyJSON(testKeypair);
  });

  test("generates new keypair and writes to env if variable doesn't exist", async () => {
    // We need to use a specific file name to avoid conflicts with other tests
    const envFileName = "../.env-unittest-addkeypairtoenvfile";
    await addKeypairToEnvFile(testKeypair, "TEMP_KEYPAIR", envFileName);

    // Now reload the environment and check it matches our test keypair
    dotenv.config({ path: envFileName });

    // Get the secret from the .env file
    const secretKeyString = process.env.TEMP_KEYPAIR;

    if (!secretKeyString) {
      throw new Error("TEMP_KEYPAIR not found in environment");
    }
    const decodedSecretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const envKeypair = await Keypair.fromSecretKey(decodedSecretKey);

    assert.ok(envKeypair.publicKey.equals(testKeypair.publicKey));

    await deleteFile(envFileName);
  });

  test("throws a nice error if the env var already exists", async () => {
    await assert.rejects(
      async () => addKeypairToEnvFile(testKeypair, TEST_ENV_VAR_ARRAY_OF_NUMBERS),
      {
        message: `'TEST_ENV_VAR_ARRAY_OF_NUMBERS' already exists in env file.`,
      },
    );
  });
});

describe("makeKeypairs", () => {
  test("makeKeypairs makes exactly the amount of keypairs requested", async () => {
    // We could test more, but keypair generation takes time and slows down tests
    const KEYPAIRS_TO_MAKE = 3;
    const keypairs = await makeKeypairs(KEYPAIRS_TO_MAKE);
    assert.equal(keypairs.length, KEYPAIRS_TO_MAKE);
    assert.ok(keypairs[KEYPAIRS_TO_MAKE - 1].secretKey);
  });

  test("makeKeypairs() makes distinct keypairs", async () => {
    const keypairs = await makeKeypairs(3);
    const addresses = new Set(keypairs.map((keypair) => keypair.publicKey.toBase58()));
    assert.equal(addresses.size, 3);
  });
});

describe("getKeypairFromFile", () => {
  const TEST_FILE_NAME = `${TEMP_DIR}/test-keyfile-do-not-use.json`;
  const MISSING_FILE_NAME = "THIS FILE DOES NOT EXIST";
  const CORRUPT_TEST_FILE_NAME = `${TEMP_DIR}/corrupt-keyfile-do-not-use.json`;
  let fakeHomeDirectory: string;
  const realHomeDirectory = process.env.HOME;

  before(async () => {
    await mkdir(TEMP_DIR, { recursive: true });
    const { stdout } = await exec(
      `solana-keygen new --force --no-bip39-passphrase -o ${TEST_FILE_NAME}`,
    );
    assert(stdout.includes("Wrote new keypair"));

    await writeFile(CORRUPT_TEST_FILE_NAME, "I AM CORRUPT");

    fakeHomeDirectory = await mkdtemp(join(tmpdir(), "helpers-home-"));
  });

  after(async () => {
    process.env.HOME = realHomeDirectory;
    await rm(fakeHomeDirectory, { recursive: true, force: true });
  });

  test("getting a keypair from a file", async () => {
    const { stdout } = await exec(`solana-keygen pubkey ${TEST_FILE_NAME}`);
    const keypair = await getKeypairFromFile(TEST_FILE_NAME);
    assert.equal(keypair.publicKey.toBase58(), stdout.trim());
  });

  test("expands '~' to the home directory, and defaults to the Solana CLI's keypair file", async () => {
    const keypair = await Keypair.generate();
    await mkdir(join(fakeHomeDirectory, ".config", "solana"), { recursive: true });
    await writeFile(
      join(fakeHomeDirectory, ".config", "solana", "id.json"),
      keypairToSecretKeyJSON(keypair),
    );
    process.env.HOME = fakeHomeDirectory;

    const keypairFromHomeDirectory = await getKeypairFromFile("~/.config/solana/id.json");
    assert.ok(keypairFromHomeDirectory.publicKey.equals(keypair.publicKey));

    const keypairFromDefaultPath = await getKeypairFromFile();
    assert.ok(keypairFromDefaultPath.publicKey.equals(keypair.publicKey));

    process.env.HOME = realHomeDirectory;
  });

  test("throws a nice error if the file is missing", async () => {
    await assert.rejects(async () => await getKeypairFromFile(MISSING_FILE_NAME), {
      message: `Could not read keypair from file at '${MISSING_FILE_NAME}'`,
    });
  });

  test("throws a nice error if the file is corrupt", async () => {
    await assert.rejects(() => getKeypairFromFile(CORRUPT_TEST_FILE_NAME), {
      message: `Invalid secret key file at '${CORRUPT_TEST_FILE_NAME}'!`,
    });
  });
});

describe("getKeypairFromEnvironment", () => {
  const TEST_ENV_VAR_ARRAY_OF_NUMBERS = "TEST_ENV_VAR_ARRAY_OF_NUMBERS";
  const TEST_ENV_VAR_BASE58 = "TEST_ENV_VAR_BASE58";
  const TEST_ENV_VAR_WITH_BAD_VALUE = "TEST_ENV_VAR_WITH_BAD_VALUE";
  let randomKeypair: Keypair;

  before(async () => {
    randomKeypair = await Keypair.generate();

    process.env[TEST_ENV_VAR_ARRAY_OF_NUMBERS] = keypairToSecretKeyJSON(randomKeypair);

    // Kit's base58 *decoder* turns bytes into a base58 string
    process.env[TEST_ENV_VAR_BASE58] = getBase58Decoder().decode(randomKeypair.secretKey);

    process.env[TEST_ENV_VAR_WITH_BAD_VALUE] = "this isn't a valid value for a secret key";
  });

  test("getting a keypair from an environment variable (array of numbers format)", async () => {
    const keypair = await getKeypairFromEnvironment(TEST_ENV_VAR_ARRAY_OF_NUMBERS);
    assert.ok(keypair.publicKey.equals(randomKeypair.publicKey));
  });

  test("getting a keypair from an environment variable (base58 format)", async () => {
    const keypair = await getKeypairFromEnvironment(TEST_ENV_VAR_BASE58);
    assert.ok(keypair.publicKey.equals(randomKeypair.publicKey));
  });

  test("throws a nice error if the env var doesn't exist", async () => {
    await assert.rejects(() => getKeypairFromEnvironment("MISSING_ENV_VAR"), {
      message: `Please set 'MISSING_ENV_VAR' in environment.`,
    });
  });

  test("throws a nice error if the value of the env var isn't valid", async () => {
    await assert.rejects(() => getKeypairFromEnvironment("TEST_ENV_VAR_WITH_BAD_VALUE"), {
      message: `Invalid secret key in environment variable 'TEST_ENV_VAR_WITH_BAD_VALUE'!`,
    });
  });
});
