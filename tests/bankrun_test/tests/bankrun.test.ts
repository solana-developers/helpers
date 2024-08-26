// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BankrunTest } from "../target/types/bankrun_test";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { BankrunContextWrapper } from "../../../src/lib/bankrun-context";
import assert from "node:assert";

const IDL = require("../target/idl/bankrun_test.json");
const PROGRAM_ID = new PublicKey(IDL.address);

describe("bankrun_test", async () => {
  const context = await startAnchor(
    "",
    [{ name: "bankrun_test", programId: PROGRAM_ID }],
    []
  );
  const provider = new BankrunProvider(context);
  const payer = provider.wallet as anchor.Wallet;
  const bankrunContextWrapper = new BankrunContextWrapper(context);
  const connection = bankrunContextWrapper.connection.toConnection();
  const program = new anchor.Program<BankrunTest>(IDL, provider);

  it("Is initialized!", async () => {
    const ix = await program.methods.initialize().instruction();
    const tx = new Transaction().add(ix);
    const { blockhash, _height } = await connection.getLatestBlockhash();
    const sig = await sendAndConfirmTransaction(connection, tx);
    assert.ok(sig);
  });
});
