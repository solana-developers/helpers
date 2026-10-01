import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { createAccountsMintsAndTokenAccounts } from "../../src";

describe("createAccountsMintsAndTokenAccounts signing", () => {
  const balances = [
    [[0], [1_000_000]],
    [[1_000_000], [0]],
    [[0], [0]],
    [[], [1_000_000]],
    [
      [1_000_000, 0],
      [0, 1_000_000],
    ],
  ];

  for (const tokenBalances of balances) {
    test(`signs only required keys for ${JSON.stringify(tokenBalances)}`, async (context) => {
      const payer = Keypair.generate();
      const connection = new Connection("http://127.0.0.1:8899");
      const blockhash = "11111111111111111111111111111111";
      context.mock.method(connection, "getMinimumBalanceForRentExemption", async () => 1_461_600);
      context.mock.method(connection, "getLatestBlockhash", async () => ({
        blockhash,
        lastValidBlockHeight: 1,
      }));
      let sentTransaction: VersionedTransaction | undefined;
      const sendTransaction = context.mock.method(
        connection,
        "sendTransaction",
        async (transaction: VersionedTransaction) => {
          sentTransaction = transaction;
          return "offline-signature";
        },
      );
      const confirmTransaction = context.mock.method(
        connection,
        "confirmTransaction",
        async () => ({
          context: { slot: 1 },
          value: { err: null },
        }),
      );

      const { users, mints } = await createAccountsMintsAndTokenAccounts(
        tokenBalances,
        LAMPORTS_PER_SOL,
        connection,
        payer,
      );

      assert.ok(sentTransaction);
      const requiredSigners = sentTransaction.message.staticAccountKeys.slice(
        0,
        sentTransaction.message.header.numRequiredSignatures,
      );
      const expectedSigners = [
        payer,
        ...mints,
        ...users.filter((_, index) => tokenBalances[index].some((amount) => amount !== 0)),
      ];
      assert.deepEqual(
        requiredSigners.map((key) => key.toBase58()).sort(),
        expectedSigners.map((signer) => signer.publicKey.toBase58()).sort(),
      );
      assert.ok(
        sentTransaction.signatures.every((signature) => signature.some((byte) => byte !== 0)),
      );
      assert.equal(sendTransaction.mock.calls.length, 1);
      assert.equal(confirmTransaction.mock.calls.length, 1);
    });
  }
});
