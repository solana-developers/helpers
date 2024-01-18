import { Cluster, Connection, Keypair, PublicKey } from "@solana/web3.js";
import base58 from "bs58";
import path from "path";
import { readFile, appendFile } from "fs/promises";
const log = console.log;

// Default value from Solana CLI
const DEFAULT_FILEPATH = "~/.config/solana/id.json";

export const keypairToSecretKeyJSON = (keypair: Keypair): string => {
  return JSON.stringify(Array.from(keypair.secretKey));
};

export const getCustomErrorMessage = (
  possibleProgramErrors: Array<string>,
  errorMessage: string,
): string | null => {
  const customErrorExpression =
    /.*custom program error: 0x(?<errorNumber>[0-9abcdef]+)/;

  let match = customErrorExpression.exec(errorMessage);
  const errorNumberFound = match?.groups?.errorNumber;
  if (!errorNumberFound) {
    return null;
  }
  // errorNumberFound is a base16 string
  const errorNumber = parseInt(errorNumberFound, 16);
  return possibleProgramErrors[errorNumber] || null;
};

export const getExplorerLink = (
  linkType: "transaction" | "tx" | "address" | "block",
  id: string,
  cluster: Cluster | "localnet" = "mainnet-beta",
): string => {
  const queryParams: Record<string, string> = {};
  if (cluster !== "mainnet-beta") {
    if (cluster === "localnet") {
      // localnet technically isn't a cluster, so requires special handling
      queryParams["cluster"] = "custom";
      queryParams["customUrl"] = "http://localhost:8899";
    } else {
      queryParams["cluster"] = cluster;
    }
  }
  let url: string = "";
  if (linkType === "address") {
    url = `https://explorer.solana.com/address/${id}`;
  }
  if (linkType === "transaction" || linkType === "tx") {
    url = `https://explorer.solana.com/tx/${id}`;
  }
  if (linkType === "block") {
    url = `https://explorer.solana.com/block/${id}`;
  }

  if (Object.keys(queryParams).length === 0) {
    return url;
  }
  const queryParamsString = new URLSearchParams(queryParams);
  return `${url}?${queryParamsString}`;
};

export const getKeypairFromFile = async (filepath?: string) => {
  // Work out correct file name
  if (!filepath) {
    filepath = DEFAULT_FILEPATH;
  }
  if (filepath[0] === "~") {
    const home = process.env.HOME || null;
    if (home) {
      filepath = path.join(home, filepath.slice(1));
    }
  }

  // Get contents of file
  let fileContents: string;
  try {
    const fileContentsBuffer = await readFile(filepath);
    fileContents = fileContentsBuffer.toString();
  } catch (error) {
    throw new Error(`Could not read keypair from file at '${filepath}'`);
  }

  // Parse contents of file
  let parsedFileContents: Uint8Array;
  try {
    parsedFileContents = Uint8Array.from(JSON.parse(fileContents));
  } catch (thrownObject) {
    const error = thrownObject as Error;
    if (!error.message.includes("Unexpected token")) {
      throw error;
    }
    throw new Error(`Invalid secret key file at '${filepath}'!`);
  }
  return Keypair.fromSecretKey(parsedFileContents);
};

export const getKeypairFromEnvironment = (variableName: string) => {
  const secretKeyString = process.env[variableName];
  if (!secretKeyString) {
    throw new Error(`Please set '${variableName}' in environment.`);
  }

  // Try the shorter base58 format first
  let decodedSecretKey: Uint8Array;
  try {
    decodedSecretKey = base58.decode(secretKeyString);
    return Keypair.fromSecretKey(decodedSecretKey);
  } catch (throwObject) {
    const error = throwObject as Error;
    if (!error.message.includes("Non-base58 character")) {
      throw new Error(
        `Invalid secret key in environment variable '${variableName}'!`,
      );
    }
  }

  // Try the longer JSON format
  try {
    decodedSecretKey = Uint8Array.from(JSON.parse(secretKeyString));
  } catch (error) {
    throw new Error(
      `Invalid secret key in environment variable '${variableName}'!`,
    );
  }
  return Keypair.fromSecretKey(decodedSecretKey);
};

export const addKeypairToEnvFile = async (
  keypair: Keypair,
  variableName: string,
  fileName?: string,
) => {
  if (!fileName) {
    fileName = ".env";
  }
  const existingSecretKey = process.env[variableName];
  if (existingSecretKey) {
    throw new Error(`'${variableName}' already exists in env file.`);
  }
  const secretKeyString = keypairToSecretKeyJSON(keypair);
  await appendFile(fileName, `\n${variableName}=${secretKeyString}`);
};

export const requestAndConfirmAirdrop = async (
  connection: Connection,
  publicKey: PublicKey,
  amount: number,
) => {
  let airdropTransactionSignature = await connection.requestAirdrop(
    publicKey,
    amount,
  );
  // Wait for airdrop confirmation
  const latestBlockHash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    {
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropTransactionSignature,
    },
    "confirmed",
  );
  return connection.getBalance(publicKey, "confirmed");
};

export const requestAndConfirmAirdropIfRequired = async (
  connection: Connection,
  publicKey: PublicKey,
  airdropAmount: number,
  minimumBalance: number,
): Promise<number> => {
  const balance = await connection.getBalance(publicKey, "confirmed");
  if (balance < minimumBalance) {
    return requestAndConfirmAirdrop(connection, publicKey, airdropAmount);
  }
  return balance;
};
