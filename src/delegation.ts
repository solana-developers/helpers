import { Delegation, StakeHistoryEntry } from './stake';

const WARMUP_COOLDOWN_RATE = 0.09;

export interface StakeActivatingAndDeactivating {
  effective: bigint;
  activating: bigint;
  deactivating: bigint;
}

export interface EffectiveAndActivating {
  effective: bigint;
  activating: bigint;
}

function getStakeHistoryEntry(
  epoch: bigint,
  stakeHistory: StakeHistoryEntry[]
): StakeHistoryEntry | null {
  for (const entry of stakeHistory) {
    if (entry.epoch === epoch) {
      return entry;
    }
  }
  return null;
}

function getStakeAndActivating(
  delegation: Delegation,
  targetEpoch: bigint,
  stakeHistory: StakeHistoryEntry[]
): EffectiveAndActivating {
  if (delegation.activationEpoch === delegation.deactivationEpoch) {
    // activated but instantly deactivated; no stake at all regardless of target_epoch
    return {
      effective: BigInt(0),
      activating: BigInt(0),
    };
  } else if (targetEpoch === delegation.activationEpoch) {
    // all is activating
    return {
      effective: BigInt(0),
      activating: delegation.stake,
    };
  } else if (targetEpoch < delegation.activationEpoch) {
    // not yet enabled
    return {
      effective: BigInt(0),
      activating: BigInt(0),
    };
  }

  let currentEpoch = delegation.activationEpoch;
  let entry = getStakeHistoryEntry(currentEpoch, stakeHistory);
  if (entry !== null) {
    // target_epoch > self.activation_epoch

    // loop from my activation epoch until the target epoch summing up my entitlement
    // current effective stake is updated using its previous epoch's cluster stake
    let currentEffectiveStake = BigInt(0);
    while (entry !== null) {
      currentEpoch++;
      const remaining = delegation.stake - currentEffectiveStake;
      const weight = Number(remaining) / Number(entry.activating);
      const newlyEffectiveClusterStake =
        Number(entry.effective) * WARMUP_COOLDOWN_RATE;
      const newlyEffectiveStake = BigInt(
        Math.max(1, Math.round(weight * newlyEffectiveClusterStake))
      );

      currentEffectiveStake += newlyEffectiveStake;
      if (currentEffectiveStake >= delegation.stake) {
        currentEffectiveStake = delegation.stake;
        break;
      }

      if (
        currentEpoch >= targetEpoch ||
        currentEpoch >= delegation.deactivationEpoch
      ) {
        break;
      }
      entry = getStakeHistoryEntry(currentEpoch, stakeHistory);
    }
    return {
      effective: currentEffectiveStake,
      activating: delegation.stake - currentEffectiveStake,
    };
  } else {
    // no history or I've dropped out of history, so assume fully effective
    return {
      effective: delegation.stake,
      activating: BigInt(0),
    };
  }
}

export function getStakeActivatingAndDeactivating(
  delegation: Delegation,
  targetEpoch: bigint,
  stakeHistory: StakeHistoryEntry[]
): StakeActivatingAndDeactivating {
  const { effective, activating } = getStakeAndActivating(
    delegation,
    targetEpoch,
    stakeHistory
  );

  // then de-activate some portion if necessary
  if (targetEpoch < delegation.deactivationEpoch) {
    return {
      effective,
      activating,
      deactivating: BigInt(0),
    };
  } else if (targetEpoch == delegation.deactivationEpoch) {
    // can only deactivate what's activated
    return {
      effective,
      activating: BigInt(0),
      deactivating: effective,
    };
  }
  let currentEpoch = delegation.deactivationEpoch;
  let entry = getStakeHistoryEntry(currentEpoch, stakeHistory);
  if (entry !== null) {
    // target_epoch > self.activation_epoch
    // loop from my deactivation epoch until the target epoch
    // current effective stake is updated using its previous epoch's cluster stake
    let currentEffectiveStake = effective;
    while (entry !== null) {
      currentEpoch++;
      // if there is no deactivating stake at prev epoch, we should have been
      // fully undelegated at this moment
      if (entry.deactivating === BigInt(0)) {
        break;
      }

      // I'm trying to get to zero, how much of the deactivation in stake
      //   this account is entitled to take
      const weight = Number(currentEffectiveStake) / Number(entry.deactivating);

      // portion of newly not-effective cluster stake I'm entitled to at current epoch
      const newlyNotEffectiveClusterStake =
        Number(entry.effective) * WARMUP_COOLDOWN_RATE;
      const newlyNotEffectiveStake = BigInt(
        Math.max(1, Math.round(weight * newlyNotEffectiveClusterStake))
      );

      currentEffectiveStake -= newlyNotEffectiveStake;
      if (currentEffectiveStake <= 0) {
        currentEffectiveStake = BigInt(0);
        break;
      }

      if (currentEpoch >= targetEpoch) {
        break;
      }
      entry = getStakeHistoryEntry(currentEpoch, stakeHistory);
    }

    // deactivating stake should equal to all of currently remaining effective stake
    return {
      effective: currentEffectiveStake,
      deactivating: currentEffectiveStake,
      activating: BigInt(0),
    };
  } else {
    return {
      effective: BigInt(0),
      activating: BigInt(0),
      deactivating: BigInt(0),
    };
  }
}
