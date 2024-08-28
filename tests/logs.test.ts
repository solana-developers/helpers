import { Connection } from "@solana/web3.js";
import { airdropIfRequired, getCustomErrorMessage, getLogs } from "../src";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import assert from "node:assert";

const LOCALHOST = "http://127.0.0.1:8899";

describe(`getLogs`, () => {
  test(`getLogs works`, async () => {
    const connection = new Connection(LOCALHOST);
    const [sender, recipient] = [Keypair.generate(), Keypair.generate()];
    const lamportsToAirdrop = 2 * LAMPORTS_PER_SOL;
    await airdropIfRequired(
      connection,
      sender.publicKey,
      lamportsToAirdrop,
      1 * LAMPORTS_PER_SOL,
    );

    const transaction = await connection.sendTransaction(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      ),
      [sender],
    );

    const logs = await getLogs(connection, transaction);
    assert.deepEqual(logs, [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ]);
  });
});


describe(`getCustomErrorMessage`, () => {
  test(`we turn error messages with hex codes into error messages for the program`, () => {
    // This example set of error is from the token program
    // https://github.com/solana-labs/solana-program-library/blob/master/token/program/src/error.rs
    const programErrors = [
      "Lamport balance below rent-exempt threshold",
      "Insufficient funds",
      "Invalid Mint",
      "Account not associated with this Mint",
      "Owner does not match",
      "Fixed supply",
      "Already in use",
      "Invalid number of provided signers",
      "Invalid number of required signers",
      "State is unititialized",
      "Instruction does not support native tokens",
      "Non-native account can only be closed if its balance is zero",
      "Invalid instruction",
      "State is invalid for requested operation",
      "Operation overflowed",
      "Account does not support specified authority type",
      "This token mint cannot freeze accounts",
      "Account is frozen",
      "The provided decimals value different from the Mint decimals",
      "Instruction does not support non-native tokens",
    ];
    const errorMessage = getCustomErrorMessage(
      programErrors,
      "failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x10",
    );
    assert.equal(errorMessage, "This token mint cannot freeze accounts");
  });
});