import { describe, test } from "node:test";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  createProviderForConnection,
  decodeAnchorTransaction,
  getIdlByProgramId,
  getIdlParsedAccountData,
  parseAnchorTransactionEvents,
} from "../../src";
import assert from "node:assert";
import { Idl } from "@coral-xyz/anchor";

const DEVNET = "https://api.devnet.solana.com";
const MAINNET = "https://api.mainnet-beta.solana.com";

describe("confirmTransaction", () => {
  test("Parsing verify transaction contains two events", async () => {
    const connection = new Connection(MAINNET);
    const provider = createProviderForConnection(connection);
    const idl: Idl = await getIdlByProgramId(
      new PublicKey("verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC"),
      provider,
    );

    var events = await parseAnchorTransactionEvents(
      idl,
      "51f5WEqS7VSaeyg1o7qSY4oVqbuzxm4tCe7woSBKdSgxqkp9h1ebJLV5nKhaLHYohkSaV4Kaccs1ye8CexhBhgG6",
      provider,
    );
    console.log("Events", JSON.stringify(events, null, 2));
    assert.equal(events.length, 1, "Should have two events");
    assert.equal(events[0].name, "otterVerifyEvent", "Its a otterVerifyEvent");
  });

  test("Decoding transaction returns correct data", async () => {
    const connection = new Connection(DEVNET);
    const provider = createProviderForConnection(connection);
    const programId = new PublicKey(
      "ancA4duevpt3eSgS5J7cD8oJntmfLKJDM59GhMtegES",
    );

    const idl: Idl | null = await getIdlByProgramId(programId, provider);
    if (!idl)
      throw new Error(`IDL not found for program ${programId.toString()}`);

    var counterTransaction = await decodeAnchorTransaction(
      idl,
      "56nR9azAzpwTCNSJ5Qtnwz9DExogNav7uXQDKBpQ8oRcadYakngrT3QRp7ZLFSuiQxjbbFX6NCiQ2aSaPEugxiLf",
      provider,
      programId,
    );
    console.log(
      "Counter increase transaction",
      JSON.stringify(counterTransaction, null, 2),
    );

    // Assert transaction structure
    assert.equal(
      counterTransaction.instructions.length,
      1,
      "Should have one instruction",
    );

    const instruction = counterTransaction.instructions[0];
    assert.equal(
      instruction.name,
      "increment",
      "Should be increment instruction",
    );
    assert.deepEqual(instruction.data, {}, "Should have empty data");

    // Assert accounts
    assert.equal(instruction.accounts.length, 2, "Should have two accounts");

    const [signer, counter] = instruction.accounts;
    assert.equal(signer.name, "signer", "First account should be signer");
    assert.equal(signer.pubkey, "5vJwnLeyjV8uNJSp1zn7VLW8GwiQbcsQbGaVSwRmkE4r");
    assert.equal(signer.isSigner, true, "Signer should be a signer");
    assert.equal(signer.isWritable, true, "Signer should be writable");

    assert.equal(counter.name, "counter", "Second account should be counter");
    assert.equal(
      counter.pubkey,
      "BGBMtk7oqrb4qAZa6v6sZPKpC8BJoEunxc2LJSi5BPPc",
    );
    assert.equal(counter.isSigner, false, "Counter should not be a signer");
    assert.equal(counter.isWritable, true, "Counter should be writable");
  });

  test("Decode versioned transaction", async () => {
    const connection = new Connection(DEVNET);
    const provider = createProviderForConnection(connection);
    const programId = new PublicKey(
      "ancA4duevpt3eSgS5J7cD8oJntmfLKJDM59GhMtegES",
    );

    const idl: Idl | null = await getIdlByProgramId(programId, provider);
    if (!idl)
      throw new Error(`IDL not found for program ${programId.toString()}`);

    var versionedTransactionDecoded = await decodeAnchorTransaction(
      idl,
      "4sh5VrmTpiQjNaaNgHiDtd6QCnEjQHKS5tcq4nobUoWnFeAEQVLUTqdTbVJYCbHNPHDPSjxiUeK7qXsQwFSTrSmg",
      provider,
      programId,
    );
    console.log(
      "VerifyTransaction",
      JSON.stringify(versionedTransactionDecoded, null, 2),
    );

    // Assert transaction structure
    assert.equal(
      versionedTransactionDecoded.instructions.length,
      1,
      "Should have one instruction",
    );

    const instruction = versionedTransactionDecoded.instructions[0];
    assert.equal(
      instruction.name,
      "initialize",
      "Should be initialize instruction",
    );

    // Assert counter account data
    const counterAccount = instruction.accounts.find(
      (acc) => acc.name === "counter",
    );
    assert.ok(counterAccount, "Counter account should exist");
    assert.ok(counterAccount.data, "Counter account should have data");
    assert.equal(
      counterAccount.data.count.toString(),
      "1",
      "Counter should be initialized to 1",
    );
  });

  test("Parsing verify account returns correct data", async () => {
    const connection = new Connection(MAINNET);
    const provider = createProviderForConnection(connection);
    const idl: Idl = await getIdlByProgramId(
      new PublicKey("verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC"),
      provider,
    );

    var accountData = await getIdlParsedAccountData(
      idl,
      "buildParams",
      new PublicKey("NRBNcTmfRkZWCLwnd6ygiz8CYerneu6m5Hcchx8RbFD"),
      provider,
    );
    console.log("Account data", JSON.stringify(accountData, null, 2));

    // Type assertion for better IDE support
    const buildParams = accountData as {
      address: string;
      signer: string;
      version: string;
      gitUrl: string;
      commit: string;
      args: string[];
      deploySlot: string;
      bump: number;
    };

    assert.ok(buildParams.address, "Should have address");
    assert.ok(buildParams.signer, "Should have signer");
    assert.ok(buildParams.version, "Should have version");
    assert.ok(
      buildParams.gitUrl.includes("github.com"),
      "Should have valid git URL",
    );
    assert.ok(
      buildParams.commit.length === 40,
      "Should have valid commit hash",
    );
    assert.ok(Array.isArray(buildParams.args), "Should have args array");
    assert.ok(buildParams.deploySlot, "Should have deploySlot");
    assert.ok(
      typeof buildParams.bump === "number",
      "Should have bump of type number",
    );
  });
});
