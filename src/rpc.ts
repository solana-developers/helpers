import {
  assertAccountExists,
  decodeAccount,
  fetchEncodedAccount,
} from "@solana/accounts";
import { Address } from "@solana/addresses";
import { Rpc, SolanaRpcApi } from "@solana/rpc";
import { SYSVAR_STAKE_HISTORY_ADDRESS } from "@solana/sysvars";
import { stakeAccountCodec, stakeHistoryCodec } from "./stake";
import { getStakeActivatingAndDeactivating } from "./delegation";

export interface StakeActivation {
  status: string;
  active: bigint;
  inactive: bigint;
}

export async function getStakeActivation(
  rpc: Rpc<SolanaRpcApi>,
  stakeAddress: Address,
): Promise<StakeActivation> {
  const [epochInfo, stakeAccount, stakeHistory] = await Promise.all([
    rpc.getEpochInfo().send(),
    (async () => {
      const stakeAccountEncoded = await fetchEncodedAccount(rpc, stakeAddress);
      assertAccountExists(stakeAccountEncoded);
      const stakeAccount = decodeAccount(
        stakeAccountEncoded,
        stakeAccountCodec,
      );
      if (stakeAccount.data.discriminant === 0) {
        throw new Error("");
      }
      return stakeAccount;
    })(),
    (async () => {
      const stakeHistoryAccountEncoded = await fetchEncodedAccount(
        rpc,
        SYSVAR_STAKE_HISTORY_ADDRESS,
      );
      assertAccountExists(stakeHistoryAccountEncoded);
      const stakeHistory = decodeAccount(
        stakeHistoryAccountEncoded,
        stakeHistoryCodec,
      );
      return stakeHistory;
    })(),
  ]);

  const rentExemptReserve = stakeAccount.data.meta.rentExemptReserve;
  if (stakeAccount.data.discriminant === 1) {
    return {
      status: "inactive",
      active: BigInt(0),
      inactive: stakeAccount.lamports - rentExemptReserve,
    };
  }

  // THE HARD PART
  const { effective, activating, deactivating } =
    getStakeActivatingAndDeactivating(
      stakeAccount.data.stake.delegation,
      epochInfo.epoch,
      stakeHistory.data,
    );

  let status;
  if (deactivating > 0) {
    status = "deactivating";
  } else if (activating > 0) {
    status = "activating";
  } else if (effective > 0) {
    status = "active";
  } else {
    status = "inactive";
  }
  const inactive = stakeAccount.lamports - effective - rentExemptReserve;

  return {
    status,
    active: effective,
    inactive,
  };
}
