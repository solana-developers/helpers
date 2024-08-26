import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Signer, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { makeKeypairs } from "./keypair";
import { createAssociatedTokenAccountIdempotentInstruction, createInitializeInstruction, createInitializeMetadataPointerInstruction, createInitializeMint2Instruction, createInitializeMintInstruction, createMintToInstruction, ExtensionType, getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint, getMintLen, LENGTH_SIZE, MINT_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TYPE_SIZE } from "@solana/spl-token";
import { confirmTransaction } from "./transaction";
import { createUpdateFieldInstruction, pack, TokenMetadata } from "@solana/spl-token-metadata";

const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID =
  TOKEN_2022_PROGRAM_ID;

// Create users, mints, create ATAs and mint tokens.
// TODO: we may actually want to split this into multiple transactions
// to avoid the transaction size limit (or use lookup tables)
// in the future. However it works for two transactions of the size
// used in our unit tests.
export const createAccountsMintsAndTokenAccounts = async (
  usersAndTokenBalances: Array<Array<number>>,
  lamports: number,
  connection: Connection,
  payer: Keypair,
) => {
  const userCount = usersAndTokenBalances.length;
  // Set the variable mintCount to the largest array in the usersAndTokenBalances array
  const mintCount = Math.max(
    ...usersAndTokenBalances.map((mintBalances) => mintBalances.length),
  );

  const users = makeKeypairs(userCount);
  const mints = makeKeypairs(mintCount);

  // This will be returned
  // [user index][mint index]address of token account
  let tokenAccounts: Array<Array<PublicKey>>;

  tokenAccounts = users.map((user) => {
    return mints.map((mint) =>
      getAssociatedTokenAddressSync(
        mint.publicKey,
        user.publicKey,
        false,
        TOKEN_PROGRAM,
      ),
    );
  });

  const sendSolInstructions: Array<TransactionInstruction> = users.map((user) =>
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: user.publicKey,
      lamports,
    }),
  );

  // Airdrops to user
  const minimumLamports = await getMinimumBalanceForRentExemptMint(connection);

  const createMintInstructions: Array<TransactionInstruction> = mints.map(
    (mint) =>
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: minimumLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM,
      }),
  );

  // Make tokenA and tokenB mints, mint tokens and create ATAs
  const mintTokensInstructions: Array<TransactionInstruction> =
    usersAndTokenBalances.flatMap((userTokenBalances, userIndex) => {
      return userTokenBalances.flatMap((tokenBalance, mintIndex) => {
        if (tokenBalance === 0) {
          return [];
        }
        return makeMintInstructions(
          mints[mintIndex].publicKey,
          tokenAccounts[userIndex][mintIndex],
          tokenBalance,
          users[userIndex].publicKey,
          payer.publicKey,
        );
      });
    });

  const instructions = [
    ...sendSolInstructions,
    ...createMintInstructions,
    ...mintTokensInstructions,
  ];

  const signers = [...users, ...mints, payer];

  // Finally, make the transaction and send it.
  await makeAndSendAndConfirmTransaction(
    connection,
    instructions,
    signers,
    payer,
  );

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
) => {
  const mint = Keypair.generate();

  if (!Array.isArray(additionalMetadata)) {
    additionalMetadata = Object.entries(additionalMetadata);
  }

  const addMetadataInstructions = additionalMetadata.map(
    (additionalMetadataItem) => {
      return createUpdateFieldInstruction({
        metadata: mint.publicKey,
        updateAuthority: updateAuthority,
        programId: TOKEN_2022_PROGRAM_ID,
        field: additionalMetadataItem[0],
        value: additionalMetadataItem[1],
      });
    },
  );

  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name,
    symbol,
    uri,
    additionalMetadata,
  };

  // Work out how much SOL we need to store our Token
  const mintLength = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLength = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const mintLamports = await connection.getMinimumBalanceForRentExemption(
    mintLength + metadataLength,
  );

  const mintTransaction = new Transaction().add(
    // Create Account
    SystemProgram.createAccount({
      fromPubkey: mintAuthority.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLength,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),

    // Initialize metadata pointer (so the mint points to itself for metadata)
    createInitializeMetadataPointerInstruction(
      mint.publicKey,
      mintAuthority.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),

    // Initialize mint
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      mintAuthority.publicKey,
      freezeAuthority,
      TOKEN_2022_PROGRAM_ID,
    ),

    // Initialize
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: mintAuthority.publicKey,
      updateAuthority: updateAuthority,
    }),

    // Update field (actually used to add a custom field)
    // See https://github.com/solana-labs/solana-program-library/blob/master/token/js/examples/metadata.ts#L81C6-L81C6
    // Must come last!
    ...addMetadataInstructions,
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    mintTransaction,
    [mintAuthority, mint],
  );

  return mint.publicKey;
};

// Just a non-exposed helper function to create all the instructions instructions
// needed for creating a mint, creating an ATA, and minting tokens to the ATA
// TODO: maybe we should expose this? To discuss.
const makeMintInstructions = (
  mintAddress: PublicKey,
  ataAddress: PublicKey,
  amount: number | bigint,
  authority: PublicKey,
  payer: PublicKey = authority,
): Array<TransactionInstruction> => {
  return [
    // Initializes a new mint and optionally deposits all the newly minted tokens in an account.
    createInitializeMint2Instruction(
      mintAddress,
      6,
      authority,
      null,
      TOKEN_PROGRAM,
    ),
    // Create the ATA
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ataAddress,
      authority,
      mintAddress,
      TOKEN_PROGRAM,
    ),
    // Mint some tokens to the ATA
    createMintToInstruction(
      mintAddress,
      ataAddress,
      authority,
      amount,
      [],
      TOKEN_PROGRAM,
    ),
  ];
};

// Send a versioned transaction with less boilerplate
// https://www.quicknode.com/guides/solana-development/transactions/how-to-use-versioned-transactions-on-solana
// TODO: maybe we should expose this? To discuss.
const makeAndSendAndConfirmTransaction = async (
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  signers: Array<Signer>,
  payer: Keypair,
) => {
  const latestBlockhash = (await connection.getLatestBlockhash("max"))
    .blockhash;

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash,
    instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign(signers);

  const signature = await connection.sendTransaction(transaction);

  await confirmTransaction(connection, signature);
};