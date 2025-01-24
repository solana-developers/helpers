import { describe, test } from "node:test";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  airdropIfRequired,
  makeTokenMint,
} from "../../src";
import { Connection } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { getTokenMetadata } from "@solana/spl-token";
import assert from "node:assert";

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

