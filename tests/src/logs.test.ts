import { describe, test } from "node:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import {
  airdropIfRequired,
  getCustomErrorMessage,
  getErrorFromRPCResponse,
  getLogs,
} from "../../src";
import assert from "node:assert";

const LOCALHOST = "http://127.0.0.1:8899";

describe("getLogs", () => {
  test("getLogs works", async () => {
    const connection = new Connection(LOCALHOST);
    const [sender, recipient] = [await Keypair.generate(), await Keypair.generate()];
    const lamportsToAirdrop = 2 * LAMPORTS_PER_SOL;
    await airdropIfRequired(connection, sender.publicKey, lamportsToAirdrop, 1 * LAMPORTS_PER_SOL);

    const signature = await connection.sendTransaction(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1_000_000,
        }),
      ),
      [sender],
    );

    const logs = await getLogs(connection, signature);
    assert.deepEqual(logs, [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ]);
  });
});

describe("getCustomErrorMessage", () => {
  // This example set of error is from the token program
  // https://github.com/solana-program/token/blob/main/program/src/error.rs
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

  test("we turn error messages with hex codes into error messages for the program", () => {
    const errorMessage = getCustomErrorMessage(
      programErrors,
      "failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x10",
    );
    assert.equal(errorMessage, "This token mint cannot freeze accounts");
  });

  test("returns null for messages without a custom program error", () => {
    const errorMessage = getCustomErrorMessage(programErrors, "Blockhash not found");
    assert.equal(errorMessage, null);
  });

  test("returns null for custom program errors the program doesn't have", () => {
    const errorMessage = getCustomErrorMessage(
      programErrors,
      "Error processing Instruction 0: custom program error: 0xff",
    );
    assert.equal(errorMessage, null);
  });
});

describe("getErrorFromRPCResponse", () => {
  const context = { slot: 1n };

  test("does nothing when the transaction succeeded", () => {
    assert.equal(getErrorFromRPCResponse({ context, value: { err: null } }), undefined);
  });

  test("throws the instruction index and custom program error number", () => {
    assert.throws(
      () =>
        getErrorFromRPCResponse({
          context,
          value: { err: { InstructionError: [1, { Custom: 6001 }] } },
        }),
      {
        message: "Error in transaction: instruction index 1, custom program error 6001",
      },
    );
  });

  test("throws for instruction errors that aren't custom program errors", () => {
    assert.throws(
      () =>
        getErrorFromRPCResponse({
          context,
          value: { err: { InstructionError: [0, "InvalidAccountData"] } },
        }),
      {
        message: `Error in transaction: instruction index 0, "InvalidAccountData"`,
      },
    );
  });

  test("throws for transaction errors", () => {
    assert.throws(() => getErrorFromRPCResponse({ context, value: { err: "BlockhashNotFound" } }), {
      message: "BlockhashNotFound",
    });
    assert.throws(
      () =>
        getErrorFromRPCResponse({
          context,
          value: { err: { InsufficientFundsForRent: { account_index: 2 } } },
        }),
      { message: `Error in transaction: {"InsufficientFundsForRent":{"account_index":2}}` },
    );
  });
});
