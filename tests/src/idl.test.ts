import { describe, test } from "node:test";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  decodeAnchorTransaction,
  getIdlByPath,
  getIdlByProgramId,
  getIdlParsedAccountData,
  parseAnchorTransactionEvents,
} from "../../src";
import assert from "node:assert";

const DEVNET = "https://api.devnet.solana.com";
const MAINNET = "https://api.mainnet.solana.com";

// The 'verify' program on mainnet - see https://github.com/otter-sec/otter-verify
const VERIFY_PROGRAM_ID = new PublicKey("verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC");
// A counter program on devnet
const COUNTER_PROGRAM_ID = new PublicKey("ancA4duevpt3eSgS5J7cD8oJntmfLKJDM59GhMtegES");
const COUNTER_INCREMENT_TRANSACTION =
  "56nR9azAzpwTCNSJ5Qtnwz9DExogNav7uXQDKBpQ8oRcadYakngrT3QRp7ZLFSuiQxjbbFX6NCiQ2aSaPEugxiLf";
const COUNTER_INITIALIZE_TRANSACTION =
  "4sh5VrmTpiQjNaaNgHiDtd6QCnEjQHKS5tcq4nobUoWnFeAEQVLUTqdTbVJYCbHNPHDPSjxiUeK7qXsQwFSTrSmg";

// Third-party devnet programs that publish their IDLs in each of the ways getIdlByProgramId() supports.
// Found by searching the Program Metadata program's accounts.
// Publishes its IDL in another account (the 'External' data source)
const EXTERNAL_IDL_PROGRAM_ID = new PublicKey("AiwMCrYks78fMmA9X2fo7gEs6qhyLWpH3znFAGwHFd9Y");
// Publishes a Codama IDL as a URL
const HOOK_PROGRAM_ID = new PublicKey("3LMvqjQPwmEtCi8WbyddNgL3jrJV2EPpv9NXr6y1iqF9");
const HOOK_CONFIG_ACCOUNT = new PublicKey("HLbBsVxJdpVsRAcorojh6Tw3b9a6ZamvzizW1p4XMnQg");
const HOOK_PROGRAM_OTHER_ACCOUNT = new PublicKey("HpF7b8yogiMfX7bUTE64JYjMTE2HkW2fyBYAyhHyasT");
// Has a non-canonical IDL, published by an account other than its upgrade authority
const NON_CANONICAL_IDL_PROGRAM_ID = new PublicKey("7SW7msFvNE6oHxoCx93axB3gx3E5KjUoW2WcJsffhwNv");
const NON_CANONICAL_IDL_AUTHORITY = new PublicKey("2CQPz54PeYsH8MUVLns833ghrVEBH1WRLy6ZThR8tSBP");
// Someone has published a non-canonical 'IDL' for the Token Program that isn't an Anchor or Codama IDL
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MALFORMED_TOKEN_IDL_AUTHORITY = new PublicKey("4EhK6yKokBZjn9aWDCxoH65T3eNyPUJSaGaki5i9RuGh");

// Tests run from the 'tests' directory
const COUNTER_IDL_PATH = "fixtures/counter-idl.json";
const COUNTER_LEGACY_IDL_PATH = "fixtures/counter-idl-legacy.json";

describe("getIdlByPath", () => {
  test("loads an IDL from a file", async () => {
    const idl = await getIdlByPath(COUNTER_IDL_PATH);
    assert.ok("address" in idl);
    assert.equal(idl.address, COUNTER_PROGRAM_ID.toBase58());
    assert.deepEqual(
      idl.instructions.map((instruction) => instruction.name),
      ["increment", "initialize"],
    );
  });

  test("throws if the file isn't an IDL", async () => {
    await assert.rejects(() => getIdlByPath("package.json"), {
      message: "The IDL file 'package.json' is not an Anchor or Codama IDL",
    });
  });
});

describe("getIdlByProgramId", () => {
  test("fetches an IDL published with the Program Metadata program", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(COUNTER_PROGRAM_ID, connection);
    assert.ok("address" in idl);
    assert.equal(idl.address, COUNTER_PROGRAM_ID.toBase58());
    const instructionNames = idl.instructions.map((instruction) => instruction.name);
    assert.ok(instructionNames.includes("increment"));
    assert.ok(instructionNames.includes("initialize"));
  });

  test("prefers the Program Metadata IDL over the legacy Anchor IDL account", async () => {
    // The counter program has both, and the legacy IDL account holds an older IDL
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(COUNTER_PROGRAM_ID, connection);
    const olderIdl = await getIdlByPath(COUNTER_IDL_PATH);
    assert.notDeepEqual(idl, olderIdl);
  });

  test("fetches an IDL from a legacy Anchor IDL account", async () => {
    // The verify program only has a legacy IDL account
    const connection = new Connection(MAINNET);
    const idl = await getIdlByProgramId(VERIFY_PROGRAM_ID, connection);
    assert.ok("address" in idl);
    assert.equal(idl.address, VERIFY_PROGRAM_ID.toBase58());
    assert.equal(idl.metadata.name, "otter_verify");
  });

  test("fetches an IDL stored in another account", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(EXTERNAL_IDL_PROGRAM_ID, connection);
    assert.ok("address" in idl);
    assert.equal(idl.address, EXTERNAL_IDL_PROGRAM_ID.toBase58());
    assert.equal(idl.metadata.name, "ic_rollup");
  });

  test("fetches a Codama IDL published as a URL", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(HOOK_PROGRAM_ID, connection);
    assert.ok("standard" in idl);
    assert.equal(idl.standard, "codama");
    assert.equal(idl.program.publicKey, HOOK_PROGRAM_ID.toBase58());
  });

  test("fetches a non-canonical IDL published by a particular authority", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(
      NON_CANONICAL_IDL_PROGRAM_ID,
      connection,
      NON_CANONICAL_IDL_AUTHORITY,
    );
    assert.ok("address" in idl);
    assert.equal(idl.address, NON_CANONICAL_IDL_PROGRAM_ID.toBase58());
    assert.equal(idl.metadata.name, "project_audit_attestation");

    // The program's upgrade authority hasn't published an IDL
    await assert.rejects(() => getIdlByProgramId(NON_CANONICAL_IDL_PROGRAM_ID, connection), {
      message: `IDL not found for program ${NON_CANONICAL_IDL_PROGRAM_ID.toBase58()}`,
    });
  });

  test("throws if the published IDL isn't an Anchor or Codama IDL", async () => {
    const connection = new Connection(DEVNET);
    await assert.rejects(
      () => getIdlByProgramId(TOKEN_PROGRAM_ID, connection, MALFORMED_TOKEN_IDL_AUTHORITY),
      {
        message: `The IDL published for program ${TOKEN_PROGRAM_ID.toBase58()} is not an Anchor or Codama IDL`,
      },
    );
  });

  test("throws if the program has no IDL", async () => {
    const connection = new Connection(DEVNET);
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    await assert.rejects(() => getIdlByProgramId(systemProgram, connection), {
      message: `IDL not found for program ${systemProgram.toBase58()}`,
    });
  });
});

describe("parseAnchorTransactionEvents", () => {
  test("Parsing verify transaction contains an otterVerifyEvent", async () => {
    const connection = new Connection(MAINNET);
    const idl = await getIdlByProgramId(VERIFY_PROGRAM_ID, connection);

    const events = await parseAnchorTransactionEvents(
      idl,
      "51f5WEqS7VSaeyg1o7qSY4oVqbuzxm4tCe7woSBKdSgxqkp9h1ebJLV5nKhaLHYohkSaV4Kaccs1ye8CexhBhgG6",
      connection,
    );
    assert.equal(events.length, 1, "Should have one event");
    const [event] = events;
    assert.equal(event.name, "otterVerifyEvent", "Its a otterVerifyEvent");
    assert.equal(typeof event.data.signer, "string");
    assert.ok(new PublicKey(event.data.signer as string));
    assert.ok(event.data.params, "Event should include the verify params");
  });
});

describe("decodeAnchorTransaction", () => {
  test("Decoding transaction returns correct data", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(COUNTER_PROGRAM_ID, connection);

    const counterTransaction = await decodeAnchorTransaction(
      idl,
      COUNTER_INCREMENT_TRANSACTION,
      connection,
      COUNTER_PROGRAM_ID,
    );

    // Assert transaction structure
    assert.equal(counterTransaction.instructions.length, 1, "Should have one instruction");

    const instruction = counterTransaction.instructions[0];
    assert.equal(instruction.name, "increment", "Should be increment instruction");
    assert.deepEqual(instruction.data, {}, "Should have empty data");

    // Assert accounts
    assert.equal(instruction.accounts.length, 2, "Should have two accounts");

    const [signer, counter] = instruction.accounts;
    assert.equal(signer.name, "signer", "First account should be signer");
    assert.equal(signer.pubkey, "5vJwnLeyjV8uNJSp1zn7VLW8GwiQbcsQbGaVSwRmkE4r");
    assert.equal(signer.isSigner, true, "Signer should be a signer");
    assert.equal(signer.isWritable, true, "Signer should be writable");

    assert.equal(counter.name, "counter", "Second account should be counter");
    assert.equal(counter.pubkey, "BGBMtk7oqrb4qAZa6v6sZPKpC8BJoEunxc2LJSi5BPPc");
    assert.equal(counter.isSigner, false, "Counter should not be a signer");
    assert.equal(counter.isWritable, true, "Counter should be writable");
    assert.equal(typeof counter.data?.count, "bigint", "Counter should have a count");

    // The human-readable form includes bigints, which JSON.stringify() can't handle by itself
    const description = counterTransaction.toString();
    assert.match(description, /Instruction: increment/);
    assert.match(description, /Address: BGBMtk7oqrb4qAZa6v6sZPKpC8BJoEunxc2LJSi5BPPc/);
  });

  test("Decode versioned transaction", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(COUNTER_PROGRAM_ID, connection);

    const versionedTransactionDecoded = await decodeAnchorTransaction(
      idl,
      COUNTER_INITIALIZE_TRANSACTION,
      connection,
      COUNTER_PROGRAM_ID,
    );

    // Assert transaction structure
    assert.equal(versionedTransactionDecoded.instructions.length, 1, "Should have one instruction");

    const instruction = versionedTransactionDecoded.instructions[0];
    assert.equal(instruction.name, "initialize", "Should be initialize instruction");

    // Assert counter account data
    const counterAccount = instruction.accounts.find((account) => account.name === "counter");
    assert.ok(counterAccount, "Counter account should exist");
    assert.ok(counterAccount.data, "Counter account should have data");
    assert.equal(typeof counterAccount.data.count, "bigint", "Counter should have a count");

    const systemProgramAccount = instruction.accounts.find(
      (account) => account.name === "systemProgram",
    );
    assert.ok(systemProgramAccount, "System program account should exist");
    assert.equal(systemProgramAccount.data, undefined, "Only program-owned accounts are decoded");
  });

  test("Decodes a transaction using a legacy IDL and the program ID", async () => {
    const connection = new Connection(DEVNET);
    const legacyIdl = await getIdlByPath(COUNTER_LEGACY_IDL_PATH);

    // Legacy IDLs don't include the program's address
    await assert.rejects(
      () => decodeAnchorTransaction(legacyIdl, COUNTER_INCREMENT_TRANSACTION, connection),
      { message: "The IDL does not include the program's address, please provide the programId" },
    );

    const counterTransaction = await decodeAnchorTransaction(
      legacyIdl,
      COUNTER_INCREMENT_TRANSACTION,
      connection,
      COUNTER_PROGRAM_ID,
    );
    const [instruction] = counterTransaction.instructions;
    assert.equal(instruction.name, "increment");
    assert.deepEqual(
      instruction.accounts.map((account) => account.name),
      ["signer", "counter"],
    );
    assert.equal(typeof instruction.accounts[1].data?.count, "bigint");
  });
});

describe("getIdlParsedAccountData", () => {
  test("Parsing verify account returns correct data", async () => {
    const connection = new Connection(MAINNET);
    const idl = await getIdlByProgramId(VERIFY_PROGRAM_ID, connection);

    const buildParams = await getIdlParsedAccountData<{
      address: string;
      signer: string;
      version: string;
      gitUrl: string;
      commit: string;
      args: Array<string>;
      deploySlot: bigint;
      bump: number;
    }>(
      idl,
      "buildParams",
      new PublicKey("NRBNcTmfRkZWCLwnd6ygiz8CYerneu6m5Hcchx8RbFD"),
      connection,
    );

    assert.ok(new PublicKey(buildParams.address), "Should have address");
    assert.ok(new PublicKey(buildParams.signer), "Should have signer");
    assert.ok(buildParams.version, "Should have version");
    assert.ok(buildParams.gitUrl.includes("github.com"), "Should have valid git URL");
    assert.equal(buildParams.commit.length, 40, "Should have valid commit hash");
    assert.ok(Array.isArray(buildParams.args), "Should have args array");
    assert.equal(typeof buildParams.deploySlot, "bigint", "Should have deploySlot");
    assert.ok(buildParams.deploySlot > 0n, "deploySlot should be after genesis");
    assert.equal(typeof buildParams.bump, "number", "Should have bump of type number");
  });

  test("Parsing an account with a legacy IDL", async () => {
    const connection = new Connection(DEVNET);
    const legacyIdl = await getIdlByPath(COUNTER_LEGACY_IDL_PATH);
    const counter = await getIdlParsedAccountData(
      legacyIdl,
      "counter",
      new PublicKey("BGBMtk7oqrb4qAZa6v6sZPKpC8BJoEunxc2LJSi5BPPc"),
      connection,
      COUNTER_PROGRAM_ID,
    );
    assert.equal(typeof counter.count, "bigint");
  });

  test("Parsing an account with a Codama IDL", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(HOOK_PROGRAM_ID, connection);
    const hookConfig = await getIdlParsedAccountData(
      idl,
      "hookConfig",
      HOOK_CONFIG_ACCOUNT,
      connection,
    );
    assert.ok(new PublicKey(hookConfig.vaultState as string));
    assert.equal(typeof hookConfig.lockDurationSeconds, "bigint");
    assert.equal(typeof hookConfig.complianceCheckEnabled, "boolean");
  });

  test("throws if the account is a different type", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByProgramId(HOOK_PROGRAM_ID, connection);
    await assert.rejects(
      () => getIdlParsedAccountData(idl, "hookConfig", HOOK_PROGRAM_OTHER_ACCOUNT, connection),
      {
        message: `Account ${HOOK_PROGRAM_OTHER_ACCOUNT.toBase58()} is not a 'hookConfig' account`,
      },
    );
  });

  test("throws if the account type isn't in the IDL", async () => {
    const connection = new Connection(DEVNET);
    const idl = await getIdlByPath(COUNTER_IDL_PATH);
    await assert.rejects(
      () =>
        getIdlParsedAccountData(
          idl,
          "notAnAccount",
          new PublicKey("BGBMtk7oqrb4qAZa6v6sZPKpC8BJoEunxc2LJSi5BPPc"),
          connection,
        ),
      { message: "Account type 'notAnAccount' not found in IDL" },
    );
  });
});
