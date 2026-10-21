import { Keypair } from "@solana/web3.js";
import { getBase58Encoder } from "@solana/kit";

// Default value from Solana CLI
const DEFAULT_FILEPATH = "~/.config/solana/id.json";

export const keypairToSecretKeyJSON = (keypair: Keypair): string => {
  return JSON.stringify(Array.from(keypair.secretKey));
};

export const getKeypairFromFile = async (filepath?: string): Promise<Keypair> => {
  // Node-specific imports
  const path = await import("node:path");
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
    // Node-specific imports
    const { readFile } = await import("node:fs/promises");
    const fileContentsBuffer = await readFile(filepath);
    fileContents = fileContentsBuffer.toString();
  } catch {
    throw new Error(`Could not read keypair from file at '${filepath}'`);
  }

  // Parse contents of file
  try {
    const parsedFileContents = Uint8Array.from(JSON.parse(fileContents));
    return await Keypair.fromSecretKey(parsedFileContents);
  } catch {
    throw new Error(`Invalid secret key file at '${filepath}'!`);
  }
};

// Secret keys are stored either as a JSON array of numbers (the format
// the Solana CLI uses) or as the shorter base58 string.
const decodeSecretKeyString = (secretKeyString: string): Uint8Array => {
  if (secretKeyString.trim().startsWith("[")) {
    return Uint8Array.from(JSON.parse(secretKeyString));
  }
  // Kit's base58 *encoder* turns a base58 string into bytes
  return Uint8Array.from(getBase58Encoder().encode(secretKeyString));
};

export const getKeypairFromEnvironment = async (variableName: string): Promise<Keypair> => {
  const secretKeyString = process.env[variableName];
  if (!secretKeyString) {
    throw new Error(`Please set '${variableName}' in environment.`);
  }

  try {
    return await Keypair.fromSecretKey(decodeSecretKeyString(secretKeyString));
  } catch {
    throw new Error(`Invalid secret key in environment variable '${variableName}'!`);
  }
};

export const addKeypairToEnvFile = async (
  keypair: Keypair,
  variableName: string,
  envFileName?: string,
) => {
  // Node-specific imports
  const { appendFile } = await import("node:fs/promises");
  if (!envFileName) {
    envFileName = ".env";
  }
  const existingSecretKey = process.env[variableName];
  if (existingSecretKey) {
    throw new Error(`'${variableName}' already exists in env file.`);
  }
  const secretKeyString = keypairToSecretKeyJSON(keypair);
  await appendFile(
    envFileName,
    `\n# Solana Address: ${keypair.publicKey.toBase58()}\n${variableName}=${secretKeyString}`,
  );
};

// Shout out to Dean from WBA for this technique
export const makeKeypairs = (amount: number): Promise<Array<Keypair>> => {
  return Promise.all(Array.from({ length: amount }, () => Keypair.generate()));
};
