import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getStakeActivatingAndDeactivating } from ".";

describe("getStakeActivation", () => {
  const HUGE_NUM = 1_000_000_000_000_000n;

  test("activating", (t) => {
    const targetEpoch = 11n;
    const stake = 10n;
    const delegation = {
      stake,
      activationEpoch: targetEpoch,
      deactivationEpoch: HUGE_NUM,
      unused: 0n,
      voterPubkey: new Uint8Array(),
    };
    const stakeHistory = [
      {
        epoch: targetEpoch - 1n,
        effective: HUGE_NUM,
        activating: HUGE_NUM,
        deactivating: HUGE_NUM,
      },
    ];
    const status = getStakeActivatingAndDeactivating(
      delegation,
      targetEpoch,
      stakeHistory,
    );
    assert(status.activating === stake);
    assert(status.effective === 0n);
    assert(status.deactivating === 0n);
  });

  test("effective", (t) => {
    const targetEpoch = 11n;
    const stake = 10n;
    const delegation = {
      stake,
      activationEpoch: targetEpoch - 1n,
      deactivationEpoch: HUGE_NUM,
      unused: 0n,
      voterPubkey: new Uint8Array(),
    };
    const stakeHistory = [
      {
        epoch: targetEpoch - 1n,
        effective: HUGE_NUM,
        activating: stake,
        deactivating: HUGE_NUM,
      },
    ];
    const status = getStakeActivatingAndDeactivating(
      delegation,
      targetEpoch,
      stakeHistory,
    );
    assert(status.activating === 0n);
    assert(status.effective === stake);
    assert(status.deactivating === 0n);
  });

  test("deactivating", (t) => {
    const targetEpoch = 11n;
    const stake = 10n;
    const delegation = {
      stake,
      activationEpoch: targetEpoch - 1n,
      deactivationEpoch: targetEpoch,
      unused: 0n,
      voterPubkey: new Uint8Array(),
    };
    const stakeHistory = [
      {
        epoch: targetEpoch - 1n,
        effective: HUGE_NUM,
        activating: stake,
        deactivating: stake,
      },
    ];
    const status = getStakeActivatingAndDeactivating(
      delegation,
      targetEpoch,
      stakeHistory,
    );
    assert(status.activating === 0n);
    assert(status.effective === stake);
    assert(status.deactivating === stake);
  });

  test("multi-epoch activation", (t) => {
    const targetEpoch = 11n;
    const stake = HUGE_NUM;
    const delegation = {
      stake,
      activationEpoch: targetEpoch - 1n,
      deactivationEpoch: HUGE_NUM,
      unused: 0n,
      voterPubkey: new Uint8Array(),
    };
    const stakeHistory = [
      {
        epoch: targetEpoch - 1n,
        effective: HUGE_NUM,
        activating: HUGE_NUM,
        deactivating: HUGE_NUM,
      },
    ];
    const status = getStakeActivatingAndDeactivating(
      delegation,
      targetEpoch,
      stakeHistory,
    );
    // all of the total amount activating, but only 9% allowed, so it'll activate 9%
    const effective = (stake * 9n) / 100n;
    assert(status.activating === stake - effective);
    assert(status.effective === effective);
    assert(status.deactivating === 0n);
  });

  test("multi-epoch deactivation", (t) => {
    const targetEpoch = 11n;
    const stake = HUGE_NUM;
    const delegation = {
      stake,
      activationEpoch: targetEpoch - 2n,
      deactivationEpoch: targetEpoch - 1n,
      unused: 0n,
      voterPubkey: new Uint8Array(),
    };
    const stakeHistory = [
      {
        epoch: targetEpoch - 2n,
        effective: HUGE_NUM * 100n, // make sure it all activates in one epoch
        activating: stake,
        deactivating: stake,
      },
      {
        epoch: targetEpoch - 1n,
        effective: HUGE_NUM,
        activating: HUGE_NUM,
        deactivating: HUGE_NUM,
      },
    ];
    const status = getStakeActivatingAndDeactivating(
      delegation,
      targetEpoch,
      stakeHistory,
    );
    // all of the total amount deactivating, but only 9% allowed, so it'll deactivate 9%
    const deactivated = (stake * 9n) / 100n;
    assert(status.activating === 0n);
    assert(status.effective === stake - deactivated);
    assert(status.deactivating === stake - deactivated);
  });
});
