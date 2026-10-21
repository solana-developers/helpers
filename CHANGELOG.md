## 3.0

- **Breaking**: Uses `@solana/web3.js` version 3, which keeps the `Connection`, `PublicKey`,
  `Keypair` and `Transaction` classes and is built on Solana Kit. Use version 2 of this package with
  `@solana/web3.js` version 1.
- **Breaking**: The package is an ES module only, and needs Node.js 20.19+ or 22.12+. CommonJS code
  can still load it with `require()`, which those Node.js versions support for ES modules, so a
  separate CommonJS build would add nothing. A CommonJS build couldn't load on older Node.js
  versions anyway, since a dependency (`@noble/hashes`, used by Codama) is ESM only. Jest needs
  `NODE_OPTIONS=--experimental-vm-modules` to load ES modules with `require()`.
- **Breaking**: `getExplorerLink()` uses `"mainnet"` as the name for Solana's main network, and
  defaults to it. `"mainnet-beta"` still works, but logs a warning and is marked as deprecated. The
  `ExplorerCluster` type lists the cluster names it accepts.
- **Breaking**: `sendTransaction()` sends version 1 transactions (SIMD-0385), which can be up to
  4096 bytes. It takes an array of instructions or an unsigned `Transaction`, and its options take a
  `transactionConfig` with `computeUnitLimit`, `loadedAccountsDataSizeLimit` and
  `priorityFeeLamports` (the total priority fee), replacing the `priorityFee` (microLamports per
  compute unit) parameter. If the compute unit limit and loaded accounts data size limit aren't
  given, it simulates the transaction to set them, since a version 1 transaction without them gets
  zero of each. It throws an error for compute budget instructions, which do nothing in a version 1
  transaction, and for an already signed `Transaction`. There's no priority fee unless one is set.
- **Breaking**: `sendVersionedTransaction()` is now `sendTransactionWithLookupTables()`, since
  version 1 transactions are versioned too. It sends version 0 transactions, which can use address
  lookup tables, and takes the lookup tables before the priority fee.
- **Breaking**: `createLookupTable()` sends a version 1 transaction, and its last parameter is
  `priorityFeeLamports`, the total priority fee in lamports.
- **Breaking**: `makeKeypairs()` and `getKeypairFromEnvironment()` are now async, since making a
  keypair is async in web3.js version 3.
- **Breaking**: `airdropIfRequired()` returns the balance as a `bigint`. It,
  `createAccountsMintsAndTokenAccounts()` and `initializeKeypair()` accept amounts as a `number` or
  a `bigint`.
- **Breaking**: The Anchor IDL helpers take a `Connection` instead of an Anchor `AnchorProvider`,
  and `createProviderForConnection()` is removed, since Anchor's TypeScript package needs web3.js
  version 1. The helpers decode with Codama: names are camelCase, 64-bit integers are `bigint`s
  rather than `BN`s, and public keys are base58 strings. The `AnchorIdl` and `Idl` types are
  exported.
- **Breaking**: `createAccountsMintsAndTokenAccounts()` makes the payer the mint authority of every
  mint, and initializes each mint once. This fixes the transaction failing when two users hold the
  same token, and mints that no user held being left uninitialized.
- Replaced `@solana/spl-token`, `@solana/spl-token-metadata`, `@coral-xyz/anchor`, `bn.js` and
  `bs58` with `@solana-program/token-2022`, `@solana-program/program-metadata`, Codama and
  `@solana/kit`.
- `makeTokenMint()` works when `updateAuthority` is a different account from the mint authority and
  `additionalMetadata` is given.
- `sendTransaction()` and `sendTransactionWithLookupTables()` throw an error when the transaction
  lands but fails, rather than reporting it as confirmed.
- `getIdlByProgramId()` fetches IDLs published with the Program Metadata program, which Anchor 1.0
  and later use, as well as legacy Anchor IDL accounts. It reads IDLs stored directly, in another
  account, or at a URL, and takes an optional `authority` to fetch a non-canonical IDL.
- The IDL helpers accept Codama IDLs as well as Anchor IDLs, using the exported `Idl` type.
  `getIdlByPath()` and `getIdlByProgramId()` throw an error if the IDL isn't an Anchor or Codama
  IDL.
- `getIdlParsedAccountData()` throws an error if the account isn't owned by the program or isn't the
  requested type, instead of decoding it anyway.
- `getLogs()`, `parseAnchorTransactionEvents()` and `decodeAnchorTransaction()` read version 1
  transactions (SIMD-0385), as well as legacy and version 0 transactions. Thanks to @Kestrel-index,
  whose PR #85 made the same change for web3.js version 1.
- `decodeAnchorTransaction()` includes accounts loaded from address lookup tables, and fetches all
  the accounts in one request.
- `hasSetComputeLimitInstruction()` and `hasSetComputeUnitPriceInstruction()` return `true` when the
  instructions contain at least one matching instruction.
- `getErrorFromRPCResponse()` gives a readable message for every kind of transaction error.
- `getSimulationComputeUnits()` includes the transaction error in the message when the simulation
  fails, and its `lookupTables` parameter is optional.

## 2.8.1

- Fix issue with CJS import of Anchor's `NodeWallet` to use the correct `Wallet` class exported
- Fixed type errors on `ArrayBuffer`s and `Uint8Array`s

## 2.8

- Added `sendVersionedTransaction()` to send a versioned transaction with lookup tables. Also adds
  priority fee support.
- Added `createLookupTable()` to easily create a lookup table and extend it with additional
  addresses
- Added `getIdlByProgramId()` to fetch an IDL from a program onchain
- Added `getIdlByPath()` to parse an IDL from a local file path
- Added `getIdlParsedAccountData()` to parse account data using an IDL
- Added `parseAnchorTransactionEvents()` to parse anchor transaction events using an IDL
- Added `decodeAnchorTransaction()` to decode a transaction completely using an IDL
- Fixed account data parsing in `decodeAnchorTransaction()`

## 2.7

- Added `sendTransaction()` to send transactions with compute unit optimization and automatic
  retries.
- Removed `sendTransactionWithRetry()` as `sendTransaction()` is more convenient.
- Fixed the node specific imports for the Anchor transaction helpers

## 2.6

- Added Transaction send helpers. `prepareTransactionWithCompute()` and `sendTransactionWithRetry()`
- Added Transaction Parser helper functions `getIdlParsedAccountData()`,
  `parseAnchorTransactionEvents()` and `getIdlParsedInstructionData()`
- Fixed `createAccountsMintsAndTokenAccounts()` function to use correct commitment and not `max`
  blockhash
- Fixed `confirmTransaction()` to not use correct commitment

## 2.5

- Add `makeTokenMint()`
- 2.5.4 includes a few fixes to build system and TS types that were missing in earlier 2.5.x
  releases
- 2.5.6 includes a fix for esm module post-build script

## 2.4

- Add `createAccountsMintsAndTokenAccounts()`

## 2.3

Improved browser support by only loading node-specific modules when they are needed. Thanks
@piotr-layerzero!

## 2.2

- Add `getSimulationComputeUnits()`

## 2.1

- Add `initializeKeypair()`
- Change documentation to be task based.

## 2.0

- **Breaking**: Replace both `requestAndConfirmAirdropIfRequired()` and `requestAndConfirmAirdrop()`
  with a single function, `airdropIfRequired()`. See [README.md]!
- Fix error handling in `confirmTransaction()` to throw errors correctly.
- Added `getLogs()` function

## 1.5

- Added `getExplorerLink()`

## 1.4

- Added `requestAndConfirmAirdropIfRequired()`

## 1.3

- Now just `helpers`. The old `node-helpers` package is marked as deprecated.
- Added `requestAndConfirmAirdrop()`
- Added `getCustomErrorMessage()`

## 1.2

- Added `addKeypairToEnvFile()`

## 1.0

Original release.
