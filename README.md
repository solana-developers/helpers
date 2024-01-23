# Solana helpers

The `helpers` package contains Solana helper functions, for use in the browser and/or node.js, [made by the Solana Foundation Developer Ecosystem team](https://youtu.be/zvQIa68ObK8?t=319).

Eventually most of these will end up in `@solana/web3.js`.

## What can I do with this module?

[Resolve a custom error message](#getcustomerrormessageprogramerrors-errormessage)

[Get an airdrop, and wait until it's confirmed](#requestandconfirmairdropconnection-publickey-lamports)

[Get an airdrop if your balance is below some amount](#requestandconfirmairdropifrequiredconnection-publickey-lamports-maximumbalance)

[Get a Solana Explorer link for a transaction, address, or block](#getexplorerlinktype-identifier-clustername)

[Get a keypair from a keypair file (like id.json)](#getkeypairfromfilefilename)

[Get a keypair from an environment variable](#getkeypairfromenvironmentenvironmentvariable)

[Add a new keypair to an env file](#addkeypairtoenvfilekeypair-environmentvariable-file)

## Installation

```bash
npm i @solana-developers/helpers
```

## helpers for the browser and node.js

### getCustomErrorMessage(programErrors, errorMessage)

Sometimes Solana libaries return an error like:

> failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x10

`getCustomErrorMessage()` allows you to turn this message into the more readable message that matches the number message from the custom program, like:

> This token mint cannot freeze accounts

Just:

- Get the errors from the specific program's `error.rs` file - for example, there are [the errors for the Token Program](https://github.com/solana-labs/solana-program-library/blob/master/token/program/src/error.rs)

- Save the errors into an array

```typescript
// Token program errors
// https://github.com/solana-labs/solana-program-library/blob/master/token/program/src/error.rs
const tokenProgramErrors = [
  "Lamport balance below rent-exempt threshold",
  "Insufficient funds",
  "Invalid Mint",
  "Account not associated with this Mint",
  "Owner does not match",
  "Fixed supply",
  "Already in use",
  "Invalid number of provided signers",
  "Invalid number of required signers",
  "State is unititialized",
  "Instruction does not support native tokens",
  "Non-native account can only be closed if its balance is zero",
  "Invalid instruction",
  "State is invalid for requested operation",
  "Operation overflowed",
  "Account does not support specified authority type",
  "This token mint cannot freeze accounts",
  "Account is frozen",
  "The provided decimals value different from the Mint decimals",
  "Instruction does not support non-native tokens",
];
```

Then run:

```typescript
const errorMessage = getCustomErrorMessage(
  tokenProgramErrors,
  "failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x10",
);
```

And `errorMessage` will now be:

```
"This token mint cannot freeze accounts";
```

### requestAndConfirmAirdrop(connection, publicKey, lamports)

Request and confirm an airdrop in one step. This is built into the next future version of web3.js, but we've added it here now for your convenience.

```typescript
const balance = await requestAndConfirmAirdrop(
  connection,
  keypair.publicKey,
  lamportsToAirdrop,
);
```

As soon as the `await` returns, the airdropped tokens will be ready in the address, and the new balance of tokens is returned by requestAndConfirmAirdrop(). This makes `requestAndConfirmAirdrop()` very handy in testing scripts.

Note you may want to use `requestAndConfirmAirdropIfRequired()` (see below) to ensure you only use your airdrops when you need them.

### requestAndConfirmAirdropIfRequired(connection, publicKey, lamports, maximumBalance)

If you're running the same script repeatedly, you probably don't want to request airdrops on every single run. So to ask for 1 SOL, if the balance is below 0.5 SOL, you can use:

```typescript
const newBalance = await requestAndConfirmAirdropIfRequired(
  connection,
  keypair.publicKey,
  1 * LAMPORTS_PER_SOL,
  0.5 * LAMPORTS_PER_SOL,
);
```

### getExplorerLink(type, identifier, clusterName)

Get an explorer link for an `address`, `block` or `transaction` (`tx` works too).

```
getExplorerLink(
  "address",
  "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8",
  "mainnet-beta",
);
```

Will return `"https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8"`. The cluster name isn't included since mainnet-beta is the default.

```
getExplorerLink(
  "address",
  "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8",
  "devnet",
);
```

Will return `"https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8?cluster=devnet"`

```
getExplorerLink("block", "241889720", "mainnet-beta");
```

Will return `"https://explorer.solana.com/block/241889720"`

## node.js specific helpers

### getKeypairFromFile(filename)

Gets a keypair from a file - the format must be the same as [Solana CLI](https://docs.solana.com/wallet-guide/file-system-wallet) uses, ie, a JSON array of numbers:

To load the default keypair `~/.config/solana/id.json`, just run:

```typescript
const keyPair = await getKeypairFromFile(file);
```

or to load a specific file:

```typescript
const keyPair = await getKeypairFromFile("somefile.json");
```

or using home dir expansion:

```typescript
const keyPair = await getKeypairFromFile("~/code/solana/demos/steve.json");
```

### getKeypairFromEnvironment(environmentVariable)

Gets a keypair from a secret key stored in an environment variable. This is typically used to load secret keys from [env files](https://stackoverflow.com/questions/68267862/what-is-an-env-or-dotenv-file-exactly).

```typescript
const keyPair = await getKeypairFromEnvironment("SECRET_KEY");
```

### addKeypairToEnvFile(keypair, environmentVariable, file)

Saves a keypair to the environment file.

```typescript
await addKeypairToEnvFile(testKeypair, "SECRET_KEY");
```

or to specify a file name:

```typescript
await addKeypairToEnvFile(testKeypair, "SECRET_KEY", ".env.local");
```

This will also reload the env file

## Secret key format

Secret keys can be read in either the more compact base58 format (`base58.encode(randomKeypair.secretKey);`), like:

```
# A random secret key for demo purposes
SECRET_KEY=QqKYBnj5mcgUsS4vrCeyMczbTyV1SMrr7SjSAPj7JGFtxfrgD8AWU8NciwHNCbmkscbvj4HdeEen42GDBSHCj1N
```

Or the longer, 'array of numbers' format `JSON.stringify(Object.values(randomKeypair.secretKey));`:

```
# A random secret key for demo purposes
SECRET_KEY=[112,222,91,246,55,109,221,4,23,148,251,127,212,180,44,249,182,139,18,13,209,208,6,7,193,210,186,249,148,237,237,1,70,118,1,153,238,134,239,75,187,96,101,138,147,130,181,71,22,82,44,217,194,122,59,208,134,119,98,53,136,108,44,105]
```

We always save keys using the 'array of numbers' format, since most other Solana apps (like the CLI SDK and Rust tools) use the 'array of numbers' format.

## Development

To run tests - open a terminal tab, and run:

```
solana-test-validator
```

Then in a different tab, run:

```
npm run test
```

The tests use the [node native test runner](https://blog.logrocket.com/exploring-node-js-native-test-runner/).
