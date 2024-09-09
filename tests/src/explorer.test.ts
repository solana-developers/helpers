import { getExplorerLink } from "../../src/index";
import { describe, test } from "node:test";
import assert from "node:assert";

describe("getExplorerLink", () => {
  test("getExplorerLink works for a block on mainnet", () => {
    const link = getExplorerLink("block", "242233124", "mainnet-beta");
    assert.equal(link, "https://explorer.solana.com/block/242233124");
  });

  test("getExplorerLink works for a block on mainnet when no network is supplied", () => {
    const link = getExplorerLink("block", "242233124");
    assert.equal(link, "https://explorer.solana.com/block/242233124");
  });

  test("getExplorerLink works for an address on mainnet", () => {
    const link = getExplorerLink(
      "address",
      "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8",
      "mainnet-beta",
    );
    assert.equal(
      link,
      "https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8",
    );
  });

  test("getExplorerLink works for an address on devnet", () => {
    const link = getExplorerLink(
      "address",
      "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8",
      "devnet",
    );
    assert.equal(
      link,
      "https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8?cluster=devnet",
    );
  });

  test("getExplorerLink works for a transaction on mainnet", () => {
    const link = getExplorerLink(
      "transaction",
      "4nzNU7YxPtPsVzeg16oaZvLz4jMPtbAzavDfEFmemHNv93iYXKKYAaqBJzFCwEVxiULqTYYrbjPwQnA1d9ZCTELg",
      "mainnet-beta",
    );
    assert.equal(
      link,
      "https://explorer.solana.com/tx/4nzNU7YxPtPsVzeg16oaZvLz4jMPtbAzavDfEFmemHNv93iYXKKYAaqBJzFCwEVxiULqTYYrbjPwQnA1d9ZCTELg",
    );
  });

  test("getExplorerLink works for a block on mainnet", () => {
    const link = getExplorerLink("block", "241889720", "mainnet-beta");
    assert.equal(link, "https://explorer.solana.com/block/241889720");
  });

  test("getExplorerLink provides a localnet URL", () => {
    const link = getExplorerLink(
      "tx",
      "2QC8BkDVZgaPHUXG9HuPw7aE5d6kN5DTRXLe2inT1NzurkYTCFhraSEo883CPNe18BZ2peJC1x1nojZ5Jmhs94pL",
      "localnet",
    );
    assert.equal(
      link,
      "https://explorer.solana.com/tx/2QC8BkDVZgaPHUXG9HuPw7aE5d6kN5DTRXLe2inT1NzurkYTCFhraSEo883CPNe18BZ2peJC1x1nojZ5Jmhs94pL?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899",
    );
  });
});
