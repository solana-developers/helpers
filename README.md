# Solana helpers for web3.js version 3

The `@solana-developers/helpers` package contains Solana helper functions, for use in the browser
and/or node.js, made by the Solana Foundation's
[Developer Relations team](https://x.com/solana_devs) and contributions from
[Anza](https://anza.xyz), [Turbin3](https://turbin3.com/),
[Unboxed Software](https://beunboxed.com/), and [StarAtlas](https://staratlas.com/).

The helpers take away the boilerplate of common Solana tasks: making and loading keypairs, getting
devnet SOL, making token mints, sending transactions with priority fees and retries, and decoding
Anchor accounts, events and transactions.

Version 3 of this package uses
[`@solana/web3.js` version 3](https://www.npmjs.com/package/@solana/web3.js), which keeps the
familiar `Connection`, `PublicKey`, `Keypair` and `Transaction` classes and is built on
[Solana Kit](https://solanakit.com). If your project still uses `@solana/web3.js` version 1, use
version 2 of this package: `npm i @solana-developers/helpers@2`.

## What can I do with this module?

**Account & Keypair Management:**

[Make multiple keypairs at once](#make-multiple-keypairs-at-once)

[Get a keypair from a keypair file](#get-a-keypair-from-a-keypair-file)

[Get a keypair from an environment variable](#get-a-keypair-from-an-environment-variable)

[Add a new keypair to an env file](#add-a-new-keypair-to-an-env-file)

[Load or create a keypair and airdrop to it if needed](#load-or-create-a-keypair-and-airdrop-to-it-if-needed)

[Get an airdrop if your balance is below some amount](#get-an-airdrop-if-your-balance-is-below-some-amount)

**Token Operations:**

[Make a token mint with metadata](#make-a-token-mint-with-metadata)

[Create users, mints and token accounts in a single step](#create-users-mints-and-token-accounts-in-a-single-step)

**Transaction & Compute Management:**

[Confirm a transaction](#confirm-a-transaction)

[Get the logs for a transaction](#get-the-logs-for-a-transaction)

[Send a transaction with priority fees and retries](#send-a-transaction-with-priority-fees-and-retries)

[Send a transaction that uses address lookup tables](#send-a-transaction-that-uses-address-lookup-tables)

[Create an address lookup table](#create-an-address-lookup-table)

[Get simulated compute units (CUs) for transaction instructions](#get-simulated-compute-units-cus-for-transaction-instructions)

[Add compute budget instructions](#add-compute-budget-instructions)

**Error Handling & Utilities:**

[Resolve a custom error message](#resolve-a-custom-error-message)

[Turn a failed RPC response into an error](#turn-a-failed-rpc-response-into-an-error)

[Get a Solana Explorer link for a transaction, address, or block](#get-a-solana-explorer-link-for-a-transaction-address-or-block)

**Anchor Program Interaction:**

[Load an IDL](#load-an-idl)

[Parse account data with an IDL](#parse-account-data-with-an-idl)

[Parse transaction events with an IDL](#parse-transaction-events-with-an-idl)

[Decode an Anchor transaction](#decode-an-anchor-transaction)

## Installation

```bash
npm i @solana-developers/helpers @solana/web3.js
```

The package is an ES module. It needs Node.js 20.19 or newer on the Node.js 20 line, or 22.12 or
newer. In the browser it needs a modern browser with `BigInt` support.

Projects that use CommonJS can still load it with `require()`, which Node.js supports for ES modules
from those versions. Anchor projects' TypeScript tests made with Anchor's Mocha template, which run
with mocha and tsx, work as they are. Two settings are needed in some setups:

- Jest needs Node.js's `--experimental-vm-modules` flag to load ES modules with `require()`: run
  `NODE_OPTIONS=--experimental-vm-modules npx jest`.
- web3.js version 3 and Solana Kit use web platform types like `CryptoKeyPair`, so if you typecheck
  with `tsc`, add `"DOM"` to `lib` in your `tsconfig.json`. Anchor's generated `tsconfig.json` sets
  `"lib": ["es2015"]`, which doesn't include them.

## Version 1 Transactions Are the Default

`sendTransaction()` sends version 1 transactions
([SIMD-0385](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md)),
which are active on mainnet, devnet and testnet. A version 1 transaction:

- sets its compute unit limit, loaded accounts data size limit and priority fee in the transaction
  message. Compute budget instructions do nothing in a version 1 transaction.
- can be up to 4096 bytes, so it holds about three times as many account addresses as a 1232 byte
  version 0 or legacy transaction.
- can't use address lookup tables. To use a lookup table, send a version 0 transaction with
  [`sendTransactionWithLookupTables()`](#send-a-transaction-that-uses-address-lookup-tables).

`getLogs()`, `parseAnchorTransactionEvents()` and `decodeAnchorTransaction()` read legacy, version 0
and version 1 transactions.

Local validators need Agave 4 or newer to process version 1 transactions.

## Keypairs Are Async and Amounts Are Bigints

A few web3.js version 3 behaviors show up in every helper:

- Making a keypair is asynchronous: use `await Keypair.generate()` and
  `await Keypair.fromSecretKey(secretKey)`. Helpers that make or load keypairs, like
  `makeKeypairs()` and `getKeypairFromEnvironment()`, are asynchronous too.
- Lamport balances, slots and token amounts are `bigint`s. Helpers that take an amount accept either
  a `number` or a `bigint`, and helpers that return a balance return a `bigint`.
- Signing a transaction is asynchronous: use `await transaction.sign(...)`.

If you're moving a project from web3.js version 1, see the
[web3.js version 1 to version 3 migration guide](https://github.com/solana-foundation/solana-web3.js/blob/main/docs/web3js-v1-to-v3-migration.md).

## Contributing

PRs are very much welcome! Read the
[CONTRIBUTING guidelines for the Solana course](https://github.com/Unboxed-Software/solana-course/blob/main/CONTRIBUTING.md#code)
then send a PR!

## Helpers for the browser and node.js

### Make multiple keypairs at once

Usage:

```typescript
await makeKeypairs(amount);
```

In some situations - like making tests for your onchain programs - you might need to make lots of
keypairs at once. You can use `makeKeypairs()` combined with JS destructuring to quickly create
multiple variables with distinct keypairs.

```typescript
const [sender, recipient] = await makeKeypairs(2);
```

### Get an airdrop if your balance is below some amount

Usage:

```typescript
await airdropIfRequired(connection, publicKey, lamports, minimumBalance);
```

Request and confirm an airdrop in one step. As soon as the `await` returns, the airdropped SOL will
be ready to use, and the new balance, in lamports, will be returned as a `bigint`. The
`minimumBalance` is used to avoid errors caused by unnecessarily asking for SOL when there's already
enough in the account, and makes `airdropIfRequired()` very handy in scripts that run repeatedly.

To ask for 0.5 SOL, if the balance is below 1 SOL, use:

```typescript
const newBalance = await airdropIfRequired(
  connection,
  keypair.publicKey,
  0.5 * LAMPORTS_PER_SOL,
  1 * LAMPORTS_PER_SOL,
);
```

### Make a token mint with metadata

The `makeTokenMint` makes a new token mint. A token mint is the account that defines a type of token
and controls its supply. So if you want to make a new token, this is the right function for you!

The mint is made with the Token Extensions Program, using the Token Metadata and Metadata Pointer
extensions to put all metadata into the mint account itself, without needing a separate metadata
account.

Parameters

- `connection`: Connection.
- `mintAuthority`: Keypair of the account that can make new tokens. It also pays for the mint
  account.
- `name`: string, name of the token.
- `symbol`: string, like a ticker symbol. Usually in all-caps.
- `decimals`: number, how many decimal places the new token will have.
- `uri`: string, URI to a JSON file containing at minimum a value for `image`.
- `additionalMetadata`: additional metadata as either `Record<string, string>` or
  `Array<[string, string]>` (optional).
- `updateAuthority`: PublicKey (optional) - public key of the account that can update the token's
  metadata. Defaults to the mint authority.
- `freezeAuthority`: PublicKey (optional) - public key of the account that can freeze token
  accounts. Defaults to `null`, meaning token accounts can't be frozen.

`makeTokenMint` returns the `PublicKey` of the new mint.

```typescript
const mintAddress = await makeTokenMint(
  connection,
  mintAuthority,
  "Unit test token",
  "TEST",
  9,
  "https://raw.githubusercontent.com/solana-developers/professional-education/main/labs/sample-token-metadata.json",
);
```

### Create users, mints and token accounts in a single step

Frequently, tests for onchain programs need to make not just users with SOL, but also token mints
and give each user some balance of each token. To save this boilerplate,
`createAccountsMintsAndTokenAccounts()` handles making user keypairs, giving them SOL, making mints,
creating associated token accounts, and minting tokens directly to the associated token accounts.

The mints are made with the Token Extensions Program and have 6 decimal places. The `payer` pays for
everything and is the mint authority for every mint.

Eg, to make two new users, and two tokens:

- the first user with 1000 of the first token, none of the second token, and 1 SOL
- the second user with none of the first token, 1000 of the second token, and 1 SOL

Just run:

```typescript
const usersMintsAndTokenAccounts = await createAccountsMintsAndTokenAccounts(
  [
    [1_000_000_000, 0], // User 0 has 1_000_000_000 minor units of token A and 0 of token B
    [0, 1_000_000_000], // User 1 has 0 of token A and 1_000_000_000 minor units of token B
  ],
  1 * LAMPORTS_PER_SOL,
  connection,
  payer,
);
```

The returned `usersMintsAndTokenAccounts` will be an object of the form:

```
{
  users: Array<Keypair>,
  mints: Array<Keypair>,
  tokenAccounts: Array<Array<PublicKey>>
}
```

tokenAccounts are indexed by the user, then the mint. Eg, the ATA of `users[0]` for `mints[0]` is
`tokenAccounts[0][0]`. Token accounts are only created for balances above zero.

### Resolve a custom error message

Usage:

```typescript
getCustomErrorMessage(programErrors, errorMessage);
```

Sometimes Solana transactions throw an error with a message like:

> failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom
> program error: 0x10

`getCustomErrorMessage()` turns this message into a more readable message from the custom program,
like:

> This token mint cannot freeze accounts

Just:

- Get the errors from the specific program's `error.rs` file - for example, there are
  [the errors for the Token Program](https://github.com/solana-program/token/blob/main/program/src/error.rs)

- Save the errors into an array

```typescript
// Token program errors
// https://github.com/solana-program/token/blob/main/program/src/error.rs
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

```typescript
"This token mint cannot freeze accounts";
```

If the message doesn't contain a custom program error, or the program doesn't have an error with
that number, `getCustomErrorMessage()` returns `null`.

### Turn a failed RPC response into an error

Usage:

```typescript
getErrorFromRPCResponse(rpcResponse);
```

`connection.confirmTransaction()` and `connection.simulateTransaction()` don't throw when a
transaction fails - they return the failure in `rpcResponse.value.err`. `getErrorFromRPCResponse()`
throws an `Error` with a readable message if there is a failure, and does nothing if there isn't.

```typescript
const rpcResponse = await connection.simulateTransaction(transaction);
// Throws "Error in transaction: instruction index 0, custom program error 1"
getErrorFromRPCResponse(rpcResponse);
```

### Get a Solana Explorer link for a transaction, address, or block

Usage:

```typescript
getExplorerLink(type, identifier, clusterName);
```

Get an explorer link for an `address`, `block` or `transaction` (`tx` works too). The cluster name
is an `ExplorerCluster`: `"mainnet"` (the default), `"devnet"`, `"testnet"` or `"localnet"`.

```typescript
getExplorerLink("address", "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8", "mainnet");
```

Will return `"https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8"`. The
cluster name isn't included since mainnet is Explorer's default.

```typescript
getExplorerLink("address", "dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8", "devnet");
```

Will return
`"https://explorer.solana.com/address/dDCQNnDmNbFVi8cQhKAgXhyhXeJ625tvwsunRyRc7c8?cluster=devnet"`

```typescript
getExplorerLink("block", "241889720");
```

Will return `"https://explorer.solana.com/block/241889720"`

Use `"localnet"` as the cluster name to get links for transactions on a local
`solana-test-validator`.

Solana's main network used to be called `"mainnet-beta"`. `getExplorerLink()` still accepts
`"mainnet-beta"` and treats it as `"mainnet"`, but logs a warning, and editors show it as
deprecated.

### Confirm a transaction

Usage:

```typescript
await confirmTransaction(connection, signature);
```

Confirm a transaction, and also gets the recent blockhash required to confirm it. Throws an error if
the transaction failed. Returns the signature.

The optional third parameter is the commitment to wait for, `"confirmed"` by default:

```typescript
await confirmTransaction(connection, signature, "finalized");
```

### Get the logs for a transaction

Usage:

```typescript
await getLogs(connection, signature);
```

Waits for the transaction to be confirmed, then gets its logs:

```typescript
const logs = await getLogs(connection, signature);
```

The `logs` will be an array of strings, eg:

```typescript
[
  "Program 11111111111111111111111111111111 invoke [1]",
  "Program 11111111111111111111111111111111 success",
];
```

This a good way to assert your onchain programs return particular logs during unit tests.

### Send a transaction with priority fees and retries

`sendTransaction` sends a version 1 transaction with automatic retries:

```typescript
const signature = await sendTransaction(connection, instructions, [payer]);
```

The first signer pays the transaction fees. You can pass an array of instructions, or an unsigned
legacy `Transaction`, whose instructions (and fee payer, if it has one) are used.

A version 1 transaction that doesn't set a compute unit limit and a loaded accounts data size limit
gets zero of each, and fails. So if you don't provide them, `sendTransaction` simulates the
transaction and uses the simulated amounts, plus the `computeUnitBuffer` (10% more by default).

Set any part of the compute budget yourself with `transactionConfig`:

```typescript
const signature = await sendTransaction(connection, instructions, [payer], {
  transactionConfig: {
    // The total priority fee, in lamports. There's no priority fee unless you set one.
    priorityFeeLamports: 10_000n,
    // Set these to skip the simulation
    computeUnitLimit: 50_000,
    loadedAccountsDataSizeLimit: 100_000,
  },
  computeUnitBuffer: { multiplier: 1.2 }, // add 20% to simulated amounts
  onStatusUpdate: (status) => console.log(status),
  commitment: "confirmed",
  maxRetries: 10,
  initialDelayMs: 2000,
});
```

The function will:

- Throw an error if the instructions include compute budget instructions, since they do nothing in a
  version 1 transaction. Use `transactionConfig` instead.
- Throw an error if it's given a `Transaction` that's already signed, since sending it as a version
  1 transaction would invalidate its signatures.
- Simulate the transaction if `transactionConfig` doesn't set `computeUnitLimit` and
  `loadedAccountsDataSizeLimit`, and throw an error that includes the logs if the simulation fails
- Handle retries and confirmation automatically
- Provide status updates: "created" → "signed" → "sent" → "confirmed", with "retry" each time the
  transaction is re-sent
- Throw an error if the transaction lands but fails, or if it isn't confirmed after `maxRetries`
  attempts

RPC providers' priority fee APIs give a price per compute unit, in microLamports. For a version 1
transaction, multiply the price by the compute unit limit and divide by 1,000,000 to get
`priorityFeeLamports`:

- Helius: minimum 10000 microLamports per compute unit
- Triton: see their
  [priority fee API](https://docs.triton.one/chains/solana/improved-priority-fees-api)
- Quicknode: see their
  [priority fee estimation](https://www.quicknode.com/docs/solana/qn_estimatePriorityFees)

### Send a transaction that uses address lookup tables

Version 1 transactions can't use address lookup tables. For a transaction that references more
accounts than fit in a version 1 transaction, `sendTransactionWithLookupTables` sends a version 0
transaction that uses lookup tables, with compute unit optimization and automatic retries.

```typescript
async function sendTransactionWithLookupTables(
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  signers: Array<Keypair>,
  lookupTables: Array<AddressLookupTableAccount>,
  priorityFee: number = 10000, // microLamports per compute unit
  options?: SendTransactionOptions & {
    computeUnitBuffer?: ComputeUnitBuffer;
  },
): Promise<string>;
```

The first signer pays the transaction fees. Version 0 transactions set their compute budget with
compute budget instructions: if the instructions don't include a compute unit limit, it adds a
compute unit price and a compute unit limit based on simulation, like
[`addComputeInstructions`](#add-compute-budget-instructions). If they already include a compute unit
limit, the instructions are sent as they are.

Example:

```typescript
const signature = await sendTransactionWithLookupTables(
  connection,
  instructions,
  [payer],
  [lookupTableAccount],
  10000,
  {
    computeUnitBuffer: { multiplier: 1.1 },
    onStatusUpdate: (status) => console.log(status),
  },
);
```

### Create an address lookup table

`createLookupTable` creates a new address lookup table and extends it with additional addresses. It
waits until the lookup table can be used.

```typescript
async function createLookupTable(
  connection: Connection,
  sender: Keypair,
  additionalAddresses: Array<PublicKey>,
  priorityFeeLamports?: bigint, // the total priority fee for the transaction that makes the table
): Promise<[PublicKey, AddressLookupTableAccount]>;
```

Example:

```typescript
const [lookupTableAddress, lookupTableAccount] = await createLookupTable(connection, payer, [
  account1.publicKey,
  account2.publicKey,
  account3.publicKey,
]);
// Can either cache the lookup table address and lookup table account for reuse, or use them directly
const signature = await sendTransactionWithLookupTables(
  connection,
  instructions,
  [payer],
  [lookupTableAccount],
  10000,
  {
    onStatusUpdate: (status) => console.log(status),
  },
);
```

### Get simulated compute units (CUs) for transaction instructions

Usage:

```typescript
await getSimulationComputeUnits(connection, instructions, payer, lookupTables);
```

Get the compute units required for an array of instructions, for a version 0 or legacy transaction.
(`sendTransaction` simulates version 1 transactions itself.) Create your instructions:

```typescript
const sendSol = SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: recipient,
  lamports: 1_000_000,
});
```

Then use `getSimulationComputeUnits` to get the number of compute units the instructions will use:

```typescript
const units = await getSimulationComputeUnits(connection, [sendSol], payer.publicKey);
```

You can then use `ComputeBudgetProgram.setComputeUnitLimit({ units })` as the first instruction in
your transaction. See
[How to Request Optimal Compute Budget](https://solana.com/developers/guides/advanced/how-to-request-optimal-compute)
for more information on compute units.

The simulation includes a SetComputeUnitLimit instruction, so the result includes the compute units
that instruction uses.

If the simulation fails, `getSimulationComputeUnits` throws an error that includes the simulation's
logs.

### Add compute budget instructions

Adds compute unit instructions to a version 0 or legacy transaction's instructions, if they don't
already exist. (Version 1 transactions set their compute budget in the message instead, see
[`sendTransaction`](#send-a-transaction-with-priority-fees-and-retries).)

```typescript
const updatedInstructions = await addComputeInstructions(
  connection,
  instructions,
  lookupTables,
  payer.publicKey,
  10000, // priority fee default 10000 microLamports per compute unit
  { multiplier: 1.1 }, // compute unit buffer default adds 10%
);

// Returns instructions array with:
// 1. setComputeUnitPrice instruction (if not present)
// 2. setComputeUnitLimit instruction based on simulation (if not present)
// The limit is calculated by simulating the transaction and adding the specified buffer
```

This function:

1. Adds priority fee instruction if not present
2. Simulates transaction to determine required compute units
3. Adds compute unit limit instruction with buffer
4. Returns the updated instructions array

The new instructions are added to the end of the array you pass in, which is changed in place.

`hasSetComputeLimitInstruction(instructions)` and `hasSetComputeUnitPriceInstruction(instructions)`
tell you whether an array of instructions already has each compute budget instruction.

## Node.js specific helpers

### Get a keypair from a keypair file

Usage:

```typescript
await getKeypairFromFile(filename);
```

Gets a keypair from a file - the format must be the same as
[Solana CLI](https://docs.anza.xyz/cli/wallets/file-system) uses, ie, a JSON array of numbers:

To load the default keypair `~/.config/solana/id.json`, just run:

```typescript
const keypair = await getKeypairFromFile();
```

or to load a specific file:

```typescript
const keypair = await getKeypairFromFile("somefile.json");
```

or using home dir expansion:

```typescript
const keypair = await getKeypairFromFile("~/code/solana/demos/steve.json");
```

### Get a keypair from an environment variable

Usage:

```typescript
await getKeypairFromEnvironment(environmentVariable);
```

Gets a keypair from a secret key stored in an environment variable. This is typically used to load
secret keys from
[env files](https://stackoverflow.com/questions/68267862/what-is-an-env-or-dotenv-file-exactly).

```typescript
const keypair = await getKeypairFromEnvironment("SECRET_KEY");
```

### Add a new keypair to an env file

Usage:

```typescript
await addKeypairToEnvFile(keypair, environmentVariable, envFileName);
```

Saves a keypair to the environment file.

```typescript
await addKeypairToEnvFile(testKeypair, "SECRET_KEY");
```

or to specify a file name:

```typescript
await addKeypairToEnvFile(testKeypair, "SECRET_KEY", ".env.local");
```

`addKeypairToEnvFile()` throws an error if the environment variable already exists.

`keypairToSecretKeyJSON(keypair)` returns the secret key in the same 'array of numbers' format that
`addKeypairToEnvFile()` saves.

### Load or create a keypair and airdrop to it if needed

Usage:

```typescript
await initializeKeypair(connection, options);
```

Loads a keypair from a keypair file or an environment variable, or makes a new one, and then
airdrops to it if needed.

How the keypair is initialized is dependent on the `InitializeKeypairOptions`:

```typescript
interface InitializeKeypairOptions {
  envFileName?: string;
  envVariableName?: string;
  airdropAmount?: number | bigint | null;
  minimumBalance?: number | bigint;
  keypairPath?: string;
}
```

By default, the keypair is read from the `PRIVATE_KEY` environment variable (or `envVariableName`).
`initializeKeypair()` reads `process.env`, so load your env file first, for example with
`node --env-file=.env` or the `dotenv` package. If the environment variable isn't set, it makes a
new keypair and adds it to the env file (`.env`, or `envFileName`), creating the file if needed.

To load the keypair from a keypair file, pass in the `keypairPath`. When set, the keypair file takes
precedence over the environment variable.

If `airdropAmount` amount is set to something other than `null` or `0`, this function will then
check the account's balance. If the balance is below the `minimumBalance`, it will airdrop the
account `airdropAmount`.

To initialize a keypair from the environment, and airdrop it 1 SOL if it's beneath 0.5 SOL:

```typescript
const keypair = await initializeKeypair(connection);
```

To initialize a keypair from a different environment variable:

```typescript
const keypair = await initializeKeypair(connection, {
  envVariableName: "TEST_KEYPAIR",
});
```

To initialize a keypair from a keypair file, and airdrop it 3 SOL:

```typescript
const keypair = await initializeKeypair(connection, {
  keypairPath: "~/.config/solana/id.json",
  airdropAmount: LAMPORTS_PER_SOL * 3,
});
```

The default options are as follows:

```typescript
const DEFAULT_AIRDROP_AMOUNT = 1 * LAMPORTS_PER_SOL;
const DEFAULT_MINIMUM_BALANCE = 0.5 * LAMPORTS_PER_SOL;
const DEFAULT_ENV_KEYPAIR_VARIABLE_NAME = "PRIVATE_KEY";
```

## Anchor IDL Utilities

These helpers read the IDL (Interface Definition Language) file that describes a program, and use it
to decode the program's accounts, events and instructions. They work with:

- IDLs made by Anchor 0.30 and later
- Legacy IDLs, made by earlier versions of Anchor
- [Codama](https://github.com/codama-idl/codama) IDLs

They decode data using Codama and Solana Kit, so you don't need to install Anchor's TypeScript
package.

Decoded data uses these types:

- Account, instruction, event, and field names are camelCase, like `buildParams` or `gitUrl`.
- Integers of 64 bits or more, like `u64` and `i128`, are `bigint`s. Smaller integers are `number`s.
- Public keys are base58 strings.
- Options are `{ __option: "Some", value }` or `{ __option: "None" }`.
- Plain bytes are `["base64", string]` tuples.

Legacy IDLs, made before Anchor 0.30, don't include the program's address. Pass the program ID as
the last argument when you use a legacy IDL.

### Load an IDL

Get an IDL from a local file (node.js only):

```typescript
const idl = await getIdlByPath("./idl/program.json");
```

Or fetch the IDL a program has published onchain:

```typescript
const idl = await getIdlByProgramId(
  new PublicKey("verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC"),
  connection,
);
```

`getIdlByProgramId()` finds IDLs published either way Anchor has used:

- Anchor 1.0 and later publish IDLs with the
  [Program Metadata program](https://github.com/solana-program/program-metadata), which is also
  where Codama IDLs are published. The IDL can be stored in the metadata account, in another
  account, or at a URL.
- Earlier versions of Anchor store the IDL in an IDL account derived from the program ID.

If a program has both, the Program Metadata IDL is used.

The program's upgrade authority publishes its canonical IDL. To fetch an IDL that another account
published (with `--non-canonical`), pass that account as the authority:

```typescript
const idl = await getIdlByProgramId(programId, connection, publisherAddress);
```

Both functions return an `Idl`, which is an Anchor IDL (`AnchorIdl`) or a Codama IDL. Both types are
exported. They throw an error if the IDL isn't an Anchor or Codama IDL.

### Parse account data with an IDL

Usage:

```typescript
const idl = await getIdlByProgramId(programId, connection);
const data = await getIdlParsedAccountData(idl, "counter", accountAddress, connection);

// Decoded Data: { count: 2n }
```

Fetches and parses an account's data using an IDL. This is useful when you need to decode account
data from Anchor programs. It throws an error if the account isn't owned by the program, or isn't
the type of account you asked for.

### Parse transaction events with an IDL

Usage:

```typescript
const idl = await getIdlByPath("./idl/program.json");
const events = await parseAnchorTransactionEvents(idl, signature, connection);

// Events will be an array of:
// {
//   name: "gameCreated",
//   data: { gameId: 123n, player: "..." }
// }
```

Parses all Anchor events emitted in a transaction. This helps you track and verify program events
after transaction execution.

### Decode an Anchor transaction

Usage:

```typescript
const idl = await getIdlByProgramId(programId, connection);
const decoded = await decodeAnchorTransaction(idl, signature, connection);

// Print human-readable format
console.log(decoded.toString());

// Access specific instruction data
decoded.instructions.forEach((instruction) => {
  console.log(`Instruction: ${instruction.name}`);
  console.log(`Arguments: ${Object.keys(instruction.data).join(", ")}`);
  console.log(`Accounts: ${instruction.accounts.map((account) => account.name).join(", ")}`);
});
```

Decodes every top-level instruction in the transaction that calls the program, including:

- Instruction names and arguments
- All involved accounts with their roles (signer/writable), including accounts loaded from address
  lookup tables
- The current account data for accounts owned by the program
- Human-readable string representation

## Exported types

As well as the functions above, the package exports these TypeScript types:

- `InitializeKeypairOptions` - the options for `initializeKeypair()`
- `ExplorerCluster` - the cluster names `getExplorerLink()` accepts
- `SendTransactionOptions`, `ComputeUnitBuffer` and `TxStatusUpdate` - the options and status
  updates for `sendTransaction()` and `sendTransactionWithLookupTables()`
- `Idl` and `AnchorIdl` - the IDLs the IDL helpers accept
- `DecodedData`, `AnchorEvent`, `DecodedAnchorInstruction` and `DecodedTransaction` - the results of
  the IDL helpers

It also exports the default retry settings used when sending transactions: `DEFAULT_SEND_OPTIONS`,
`MAX_RETRIES`, `RETRY_INTERVAL_MS` and `RETRY_INTERVAL_INCREASE`.

## Secret key format

Secret keys can be read in either the more compact base58 format
(`getBase58Decoder().decode(keypair.secretKey)` from `@solana/kit`), like:

```bash
# A random secret key for demo purposes
SECRET_KEY=QqKYBnj5mcgUsS4vrCeyMczbTyV1SMrr7SjSAPj7JGFtxfrgD8AWU8NciwHNCbmkscbvj4HdeEen42GDBSHCj1N
```

Or the longer, 'array of numbers' format (`keypairToSecretKeyJSON(keypair)`):

```bash
# A random secret key for demo purposes
SECRET_KEY=[112,222,91,246,55,109,221,4,23,148,251,127,212,180,44,249,182,139,18,13,209,208,6,7,193,210,186,249,148,237,237,1,70,118,1,153,238,134,239,75,187,96,101,138,147,130,181,71,22,82,44,217,194,122,59,208,134,119,98,53,136,108,44,105]
```

We always save keys using the 'array of numbers' format, since most other Solana apps (like the CLI
SDK and Rust tools) use the 'array of numbers' format.

## Development

The tests need the [Solana CLI](https://docs.anza.xyz/cli/install) version 4 or newer, for
`solana-test-validator` and `solana-keygen`. Version 4 supports version 1 transactions, which the
tests send. The tests of the Anchor IDL helpers also read from devnet and mainnet, so they need an
internet connection.

To run tests, open a terminal tab, and run:

```bash
npm run validator
```

This starts `solana-test-validator` with a copy of an Anchor counter program from devnet, at the
same program ID, so the tests can send version 1 transactions to it.

Then in a different tab, run:

```bash
npm run test
```

The tests use the [node native test runner](https://nodejs.org/api/test.html), with
[tsx](https://tsx.is) to run TypeScript.

If you'd like to run a single test, use:

```bash
cd tests
node --test --import tsx --test-name-pattern="getCustomErrorMessage" src/logs.test.ts
```

To just run tests matching the name `getCustomErrorMessage`.

To build the package, run:

```bash
npm run build
```

`npm run test:ci` typechecks the package and the tests, builds the package, runs the tests, then
checks that CommonJS code can load the package with `require()`.

To list the README headings for the table of contents, run:

```bash
npx tsx make-table-of-contents.ts
```
