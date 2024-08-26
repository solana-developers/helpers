import {
  assertAccountExists,
  decodeAccount,
  fetchEncodedAccount,
} from '@solana/accounts';
import { Address } from '@solana/addresses';
import { Rpc, SolanaRpcApi } from '@solana/rpc';
import { SYSVAR_STAKE_HISTORY_ADDRESS } from '@solana/sysvars';
import { stakeAccountCodec, stakeHistoryCodec } from './stake';
import { getStakeActivatingAndDeactivating } from './delegation';

export interface StakeActivation {
  status: string;
  active: bigint;
  inactive: bigint;
}

export async function getStakeActivation(
  rpc: Rpc<SolanaRpcApi>,
  stakeAddress: Address
): Promise<StakeActivation> {
  const stakeAccount = await fetchEncodedAccount(rpc, stakeAddress);
  assertAccountExists(stakeAccount);
  const stake = decodeAccount(stakeAccount, stakeAccountCodec);
  if (stake.data.discriminant === 0) {
    throw new Error('');
  }
  const rentExemptReserve = stake.data.meta.rentExemptReserve;
  if (stake.data.discriminant === 1) {
    return {
      status: 'inactive',
      active: BigInt(0),
      inactive: stake.lamports - rentExemptReserve,
    };
  }

  const stakeHistoryAccount = await fetchEncodedAccount(
    rpc,
    SYSVAR_STAKE_HISTORY_ADDRESS
  );
  assertAccountExists(stakeHistoryAccount);
  const epochInfo = await rpc.getEpochInfo().send();
  const stakeHistory = decodeAccount(stakeHistoryAccount, stakeHistoryCodec);

  // THE HARD PART
  const { effective, activating, deactivating } =
    getStakeActivatingAndDeactivating(
      stake.data.stake.delegation,
      epochInfo.epoch,
      stakeHistory.data
    );

  let status;
  if (deactivating > 0) {
    status = 'deactivating';
  } else if (activating > 0) {
    status = 'activating';
  } else if (effective > 0) {
    status = 'active';
  } else {
    status = 'inactive';
  }
  const inactive = stakeAccount.lamports - effective - rentExemptReserve;

  return {
    status,
    active: effective,
    inactive,
  };
}
