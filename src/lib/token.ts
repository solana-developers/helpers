import {
  type Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { type Instruction, none, some } from "@solana/kit";
import {
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getCreateMintInstructionPlan,
  getMintToInstruction,
  getUpdateTokenMetadataFieldInstruction,
  getUpdateTokenMetadataUpdateAuthorityInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  tokenMetadataField,
} from "@solana-program/token-2022";
import { makeKeypairs } from "./keypair.js";

// Decimals used by createAccountsMintsAndTokenAccounts(), matching USDC
const DEFAULT_MINT_DECIMALS = 6;

const getAssociatedTokenAccountAddress = async (
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> => {
  const [associatedTokenAccountAddress] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  return new PublicKey(associatedTokenAccountAddress);
};

// Create users, mints, create ATAs and mint tokens.
// The payer funds everything and is the mint authority of every mint.
// TODO: we may actually want to split this into multiple transactions
// to avoid the transaction size limit (or use lookup tables)
// in the future. However it works for two transactions of the size
// used in our unit tests.
export const createAccountsMintsAndTokenAccounts = async (
  usersAndTokenBalances: Array<Array<number | bigint>>,
  lamports: number | bigint,
  connection: Connection,
  payer: Keypair,
): Promise<{
  users: Array<Keypair>;
  mints: Array<Keypair>;
  tokenAccounts: Array<Array<PublicKey>>;
}> => {
  const userCount = usersAndTokenBalances.length;
  // Set the variable mintCount to the largest array in the usersAndTokenBalances array
  const mintCount = Math.max(...usersAndTokenBalances.map((mintBalances) => mintBalances.length));

  const users = await makeKeypairs(userCount);
  const mints = await makeKeypairs(mintCount);

  // [user index][mint index]address of token account
  const tokenAccounts: Array<Array<PublicKey>> = await Promise.all(
    users.map((user) =>
      Promise.all(
        mints.map((mint) => getAssociatedTokenAccountAddress(mint.publicKey, user.publicKey)),
      ),
    ),
  );

  const sendSolInstructions = users.map((user) =>
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: user.publicKey,
      lamports,
    }),
  );

  const createMintInstructionPlans = await Promise.all(
    mints.map((mint) =>
      getCreateMintInstructionPlan(connection, {
        payer,
        newMint: mint,
        decimals: DEFAULT_MINT_DECIMALS,
        mintAuthority: payer,
      }),
    ),
  );

  const mintTokensInstructions = usersAndTokenBalances.flatMap((userTokenBalances, userIndex) => {
    return userTokenBalances.flatMap((tokenBalance, mintIndex) => {
      if (BigInt(tokenBalance) === 0n) {
        return [];
      }
      return makeCreateTokenAccountAndMintInstructions(
        mints[mintIndex].publicKey,
        users[userIndex].publicKey,
        tokenAccounts[userIndex][mintIndex],
        tokenBalance,
        payer,
      );
    });
  });

  const transaction = new Transaction().add(
    ...sendSolInstructions,
    ...createMintInstructionPlans,
    ...mintTokensInstructions,
  );

  await sendAndConfirmTransaction(connection, transaction, [payer, ...mints]);

  return {
    users,
    mints,
    tokenAccounts,
  };
};

export const makeTokenMint = async (
  connection: Connection,
  mintAuthority: Keypair,
  name: string,
  symbol: string,
  decimals: number,
  uri: string,
  additionalMetadata: Array<[string, string]> | Record<string, string> = [],
  updateAuthority: PublicKey = mintAuthority.publicKey,
  freezeAuthority: PublicKey | null = null,
): Promise<PublicKey> => {
  const mint = await Keypair.generate();

  const additionalMetadataEntries = Array.isArray(additionalMetadata)
    ? additionalMetadata
    : Object.entries(additionalMetadata);

  // The mint authority is the metadata's first update authority, since it signs the
  // instructions that add the additional metadata fields below.
  const extensions = [
    extension("MetadataPointer", {
      authority: some(mintAuthority.publicKey),
      // The mint points to itself for metadata
      metadataAddress: some(mint.publicKey),
    }),
    extension("TokenMetadata", {
      updateAuthority: some(mintAuthority.publicKey),
      mint: mint.publicKey,
      name,
      symbol,
      uri,
      additionalMetadata: new Map(additionalMetadataEntries),
    }),
  ];

  // Creates the mint account, funded for the full size of its metadata,
  // initializes the extensions and the mint, and initializes the metadata
  const createMintInstructionPlan = await getCreateMintInstructionPlan(connection, {
    payer: mintAuthority,
    newMint: mint,
    decimals,
    mintAuthority,
    freezeAuthority: freezeAuthority ? some(freezeAuthority) : none(),
    extensions,
  });

  const addMetadataInstructions = additionalMetadataEntries.map(([key, value]) =>
    getUpdateTokenMetadataFieldInstruction({
      metadata: mint.publicKey,
      updateAuthority: mintAuthority,
      field: tokenMetadataField("Key", [key]),
      value,
    }),
  );

  // Hand the update authority to `updateAuthority` once the fields are written
  const transferUpdateAuthorityInstructions: Array<Instruction> = updateAuthority.equals(
    mintAuthority.publicKey,
  )
    ? []
    : [
        getUpdateTokenMetadataUpdateAuthorityInstruction({
          metadata: mint.publicKey,
          updateAuthority: mintAuthority,
          newUpdateAuthority: some(updateAuthority),
        }),
      ];

  const transaction = new Transaction().add(
    createMintInstructionPlan,
    ...addMetadataInstructions,
    ...transferUpdateAuthorityInstructions,
  );

  await sendAndConfirmTransaction(connection, transaction, [mintAuthority, mint]);

  return mint.publicKey;
};

// The instructions needed to create an associated token account and mint tokens to it.
// The payer is the mint authority.
const makeCreateTokenAccountAndMintInstructions = (
  mint: PublicKey,
  owner: PublicKey,
  associatedTokenAccount: PublicKey,
  amount: number | bigint,
  payer: Keypair,
): Array<Instruction> => {
  return [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: associatedTokenAccount,
      owner,
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getMintToInstruction({
      mint,
      token: associatedTokenAccount,
      mintAuthority: payer,
      amount,
    }),
  ];
};
