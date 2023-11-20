# Solana node helpers

The `node-helpers` package package contains node.js specific Solana helper functions.

See `@solana/web3.js` for functions that work in both the browser and node.js.

## Installation

```bash
npm i @solana-developers/node-helpers
```

## getKeypairFromFile()

Gets a keypair from a file - the format must be the same as [Solana CLI](https://docs.solana.com/wallet-guide/file-system-wallet) uses, ie, a JSON array of numbers:

To load the default keypair `~/.config/solana/id.json`, just run:

```typescript
const keyPair = await getKeypairFromFile();
```

or to load a specific file:

```typescript
const keyPair = await getKeypairFromFile("somefile.json");
```

or using home dir expansion:

```typescript
const keyPair = await getKeypairFromFile("~/code/solana/demos/steve.json");
```

## getKeypairFromEnvironment()

Gets a keypair from a secret key stored in an environment variable. This is typically used to load secret keys from [env files](https://stackoverflow.com/questions/68267862/what-is-an-env-or-dotenv-file-exactly).

```typescript
const keyPair = await getKeypairFromEnvironment("SECRET_KEY");
```

## addKeypairToEnvFile()

Saves a keypair to the environment file.

```typescript
await addKeypairToEnvFile(testKeypair, "SECRET_KEY");
```

or to specify a file name:

```typescript
await addKeypairToEnvFile(testKeypair, "SECRET_KEY", ".env.local");
```

This will also reload the env file

### Secret key format

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

To run tests

```
npm run test
```

The tests use the [node native test runner](https://blog.logrocket.com/exploring-node-js-native-test-runner/).
