import { getExplorerLink } from "../../src/index";
import { describe, mock, test } from "node:test";
import assert from "node:assert";

describe("getExplorerLink", () => {
  test("getExplorerLink works for a block on mainnet", () => {
    const link = getExplorerLink("block", "242233124", "mainnet");
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
      "mainnet",
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
      "mainnet",
    );
    assert.equal(
      link,
      "https://explorer.solana.com/tx/4nzNU7YxPtPsVzeg16oaZvLz4jMPtbAzavDfEFmemHNv93iYXKKYAaqBJzFCwEVxiULqTYYrbjPwQnA1d9ZCTELg",
    );
  });

  test("getExplorerLink works for a block on mainnet", () => {
    const link = getExplorerLink("block", "241889720", "mainnet");
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

  test("getExplorerLink treats 'mainnet-beta' as 'mainnet', and warns once", () => {
    const warn = mock.method(console, "warn", () => {});
    try {
      const firstLink = getExplorerLink("block", "241889720", "mainnet-beta");
      const secondLink = getExplorerLink("block", "241889720", "mainnet-beta");
      assert.equal(firstLink, "https://explorer.solana.com/block/241889720");
      assert.equal(secondLink, "https://explorer.solana.com/block/241889720");
      assert.equal(warn.mock.callCount(), 1);
      assert.equal(
        warn.mock.calls[0].arguments[0],
        "'mainnet-beta' is now called 'mainnet'. Please use 'mainnet' instead.",
      );
    } finally {
      warn.mock.restore();
    }
  });

  test("getExplorerLink works for an address on testnet", () => {
    const link = getExplorerLink(
      "address",
      "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8",
      "testnet",
    );
    assert.equal(
      link,
      "https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8?cluster=testnet",
    );
  });
});
