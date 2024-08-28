import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { airdropIfRequired, createAccountsMintsAndTokenAccounts, makeTokenMint } from "../src";
import { Connection } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { getTokenMetadata } from "@solana/spl-token";
import assert from 'node:assert';

const LOCALHOST = "http://127.0.0.1:8899";

describe("makeTokenMint", () => {
  test("makeTokenMint makes a new mint with the specified metadata", async () => {
    const mintAuthority = Keypair.generate();
    const connection = new Connection(LOCALHOST);
    await airdropIfRequired(
      connection,
      mintAuthority.publicKey,
      100 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );

    const name = "Unit test token";
    const symbol = "TEST";
    const decimals = 9;
    const uri = "https://example.com";
    const additionalMetadata = {
      shlerm: "frobular",
      glerp: "flerpy",
      gurperderp: "erpy",
      nurmagerd: "flerpy",
      zurp: "flerpy",
      eruper: "flerpy",
      zerperurperserp: "flerpy",
      zherp: "flerpy",
    };

    const mintAddress = await makeTokenMint(
      connection,
      mintAuthority,
      name,
      symbol,
      decimals,
      uri,
      additionalMetadata,
    );

    assert.ok(mintAddress);

    const tokenMetadata = await getTokenMetadata(connection, mintAddress);

    if (!tokenMetadata) {
      throw new Error(
        `Token metadata not found for mint address ${mintAddress}`,
      );
    }

    assert.equal(tokenMetadata.mint.toBase58(), mintAddress.toBase58());
    assert.equal(
      tokenMetadata.updateAuthority?.toBase58(),
      mintAuthority.publicKey.toBase58(),
    );
    assert.equal(tokenMetadata.name, name);
    assert.equal(tokenMetadata.symbol, symbol);
    assert.equal(tokenMetadata.uri, uri);
    assert.deepEqual(
      tokenMetadata.additionalMetadata,
      Object.entries(additionalMetadata),
    );
  });
});

describe("createAccountsMintsAndTokenAccounts", () => {
  test("createAccountsMintsAndTokenAccounts works", async () => {
    const payer = Keypair.generate();
    const connection = new Connection(LOCALHOST);
    await airdropIfRequired(
      connection,
      payer.publicKey,
      100 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );

    const SOL_BALANCE = 10 * LAMPORTS_PER_SOL;

    const usersMintsAndTokenAccounts =
      await createAccountsMintsAndTokenAccounts(
        [
          [1_000_000_000, 0], // User 0 has 1_000_000_000 of token A and 0 of token B
          [0, 1_000_000_000], // User 1 has 0 of token A and 1_000_000_000 of token B
        ],
        SOL_BALANCE,
        connection,
        payer,
      );

    // Check all users have been created and have some SOL
    const users = usersMintsAndTokenAccounts.users;
    assert.equal(users.length, 2);
    await Promise.all(
      users.map(async (user) => {
        const balance = await connection.getBalance(user.publicKey);
        assert(balance === SOL_BALANCE);
      }),
    );

    // Check the mints
    assert.equal(usersMintsAndTokenAccounts.mints.length, 2);

    // Check the token accounts
    const tokenAccounts = usersMintsAndTokenAccounts.tokenAccounts;

    // Get the balances of the token accounts for the first user
    // (note there is no tokenAccountB balance yet)
    const firstUserFirstTokenBalance = await connection.getTokenAccountBalance(
      tokenAccounts[0][0], // First user, first token mint
    );
    assert(Number(firstUserFirstTokenBalance.value.amount) === 1_000_000_000);

    // // Get the balances of the token accounts for the second user
    // // (note there is no tokenAccountA account yet)
    const secondUserSecondTokenBalance =
      await connection.getTokenAccountBalance(tokenAccounts[1][1]); // Second user, second token mint
    assert(Number(secondUserSecondTokenBalance.value.amount) === 1_000_000_000);
  });
});