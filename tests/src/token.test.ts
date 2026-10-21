import { describe, test } from "node:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { unwrapOption } from "@solana/kit";
import {
  getMintDecoder,
  getTokenDecoder,
  isExtension,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { airdropIfRequired, createAccountsMintsAndTokenAccounts, makeTokenMint } from "../../src";
import assert from "node:assert";

const LOCALHOST = "http://127.0.0.1:8899";

const getMint = async (connection: Connection, mintAddress: PublicKey) => {
  const mintAccount = await connection.getAccountInfo(mintAddress);
  if (!mintAccount) {
    throw new Error(`Mint ${mintAddress.toBase58()} not found`);
  }
  assert.equal(mintAccount.owner.toBase58(), TOKEN_2022_PROGRAM_ADDRESS);
  return getMintDecoder().decode(mintAccount.data);
};

const getTokenMetadata = async (connection: Connection, mintAddress: PublicKey) => {
  const mint = await getMint(connection, mintAddress);
  const extensions = unwrapOption(mint.extensions) ?? [];
  const tokenMetadata = extensions.find((extension) => isExtension("TokenMetadata", extension));
  if (!tokenMetadata || !isExtension("TokenMetadata", tokenMetadata)) {
    throw new Error(`Token metadata not found for mint address ${mintAddress.toBase58()}`);
  }
  return tokenMetadata;
};

const getTokenBalance = async (connection: Connection, tokenAccount: PublicKey) => {
  const tokenAccountInfo = await connection.getAccountInfo(tokenAccount);
  if (!tokenAccountInfo) {
    throw new Error(`Token account ${tokenAccount.toBase58()} not found`);
  }
  return getTokenDecoder().decode(tokenAccountInfo.data).amount;
};

describe("makeTokenMint", () => {
  test("makeTokenMint makes a new mint with the specified metadata", async () => {
    const mintAuthority = await Keypair.generate();
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

    const mint = await getMint(connection, mintAddress);
    assert.equal(mint.decimals, decimals);
    assert.equal(unwrapOption(mint.mintAuthority), mintAuthority.publicKey.toBase58());
    assert.equal(unwrapOption(mint.freezeAuthority), null);

    const tokenMetadata = await getTokenMetadata(connection, mintAddress);

    assert.equal(tokenMetadata.mint, mintAddress.toBase58());
    assert.equal(unwrapOption(tokenMetadata.updateAuthority), mintAuthority.publicKey.toBase58());
    assert.equal(tokenMetadata.name, name);
    assert.equal(tokenMetadata.symbol, symbol);
    assert.equal(tokenMetadata.uri, uri);
    assert.deepEqual(Object.fromEntries(tokenMetadata.additionalMetadata), additionalMetadata);
  });

  test("makeTokenMint sets a separate update authority and freeze authority", async () => {
    const mintAuthority = await Keypair.generate();
    const updateAuthority = await Keypair.generate();
    const freezeAuthority = await Keypair.generate();
    const connection = new Connection(LOCALHOST);
    await airdropIfRequired(
      connection,
      mintAuthority.publicKey,
      10 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );

    const additionalMetadata: Array<[string, string]> = [["issuer", "Example Bank"]];

    const mintAddress = await makeTokenMint(
      connection,
      mintAuthority,
      "Example Dollar",
      "EXUSD",
      6,
      "https://example.com/exusd.json",
      additionalMetadata,
      updateAuthority.publicKey,
      freezeAuthority.publicKey,
    );

    const mint = await getMint(connection, mintAddress);
    assert.equal(unwrapOption(mint.mintAuthority), mintAuthority.publicKey.toBase58());
    assert.equal(unwrapOption(mint.freezeAuthority), freezeAuthority.publicKey.toBase58());

    const tokenMetadata = await getTokenMetadata(connection, mintAddress);
    assert.equal(unwrapOption(tokenMetadata.updateAuthority), updateAuthority.publicKey.toBase58());
    assert.deepEqual([...tokenMetadata.additionalMetadata.entries()], additionalMetadata);
  });
});

describe("createAccountsMintsAndTokenAccounts", () => {
  test("createAccountsMintsAndTokenAccounts works", async () => {
    const payer = await Keypair.generate();
    const connection = new Connection(LOCALHOST, "confirmed");
    await airdropIfRequired(
      connection,
      payer.publicKey,
      100 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );

    const SOL_BALANCE = 10 * LAMPORTS_PER_SOL;

    const usersMintsAndTokenAccounts = await createAccountsMintsAndTokenAccounts(
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
        assert.equal(balance, BigInt(SOL_BALANCE));
      }),
    );

    // Check the mints
    const mints = usersMintsAndTokenAccounts.mints;
    assert.equal(mints.length, 2);
    for (const mintKeypair of mints) {
      const mint = await getMint(connection, mintKeypair.publicKey);
      assert.equal(unwrapOption(mint.mintAuthority), payer.publicKey.toBase58());
    }

    // Check the token accounts
    const tokenAccounts = usersMintsAndTokenAccounts.tokenAccounts;

    // First user, first token mint
    assert.equal(await getTokenBalance(connection, tokenAccounts[0][0]), 1_000_000_000n);
    // Second user, second token mint
    assert.equal(await getTokenBalance(connection, tokenAccounts[1][1]), 1_000_000_000n);

    // Users with no balance of a token don't get a token account
    assert.equal(await connection.getAccountInfo(tokenAccounts[0][1]), null);
    assert.equal(await connection.getAccountInfo(tokenAccounts[1][0]), null);
  });

  test("createAccountsMintsAndTokenAccounts lets several users hold the same token", async () => {
    const payer = await Keypair.generate();
    const connection = new Connection(LOCALHOST, "confirmed");
    await airdropIfRequired(
      connection,
      payer.publicKey,
      100 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL,
    );

    const { users, tokenAccounts } = await createAccountsMintsAndTokenAccounts(
      [[5_000_000n, 7_000_000n], [3_000_000n, 0n], [2_000_000n]],
      1 * LAMPORTS_PER_SOL,
      connection,
      payer,
    );

    assert.equal(users.length, 3);
    assert.equal(await getTokenBalance(connection, tokenAccounts[0][0]), 5_000_000n);
    assert.equal(await getTokenBalance(connection, tokenAccounts[0][1]), 7_000_000n);
    assert.equal(await getTokenBalance(connection, tokenAccounts[1][0]), 3_000_000n);
    assert.equal(await getTokenBalance(connection, tokenAccounts[2][0]), 2_000_000n);

    // Token accounts are owned by the user they belong to
    const tokenAccountInfo = await connection.getAccountInfo(tokenAccounts[2][0]);
    assert.ok(tokenAccountInfo);
    assert.equal(
      getTokenDecoder().decode(tokenAccountInfo.data).owner,
      users[2].publicKey.toBase58(),
    );
  });
});
