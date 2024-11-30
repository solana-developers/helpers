// tests/bankrun_test/tests/bankrun.test.ts
import * as anchor from "@coral-xyz/anchor";
import type { BankrunTest } from "../target/types/bankrun_test";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { BankrunContextWrapper } from "../../../src";
import assert from "node:assert";
import { describe, it } from "node:test";

const IDL = require("../target/idl/bankrun_test.json");
const PROGRAM_ID = new PublicKey(IDL.address);

describe("bankrun_test", async () => {
  const context = await startAnchor(
    "",
    [{ name: "bankrun_test", programId: PROGRAM_ID }],
    []
  );
  const provider = new BankrunProvider(context);
  const bankrunContextWrapper = new BankrunContextWrapper(context);
  const connection = bankrunContextWrapper.connection.toConnection();
  const program = new anchor.Program<BankrunTest>(IDL, {
    ...provider,
    connection: connection,
  });
  const wallet = provider.wallet;
  const client = context.banksClient;

  it("Is initialized!", async () => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const ix = await program.methods.initialize().instruction();
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.payer.publicKey;
    tx.sign(wallet.payer);
    
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    const status = await client.getTransactionStatus(sig);

    assert(typeof blockhash === "string", "blockhash is not a string");
    assert(
      typeof lastValidBlockHeight === "number",
      "lastValidBlockHeight is not a number"
    );
    assert(
      typeof sig === "string",
      "Signature from transaction is not a string"
    );
    console.log();
    assert.ok(
      status.confirmationStatus !== "confirmed",
      "Txn wasn't confirmed"
    );
  });
});
