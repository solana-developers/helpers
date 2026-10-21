// The package is ESM only. Node.js 20.19+ and 22.12+ can require() ES modules,
// so check CommonJS users can still load it. Run after 'npm run build'.
const assert = require("node:assert");
// A package can require() itself by name, which uses package.json's 'exports'
const helpers = require("@solana-developers/helpers");

assert.equal(typeof helpers.makeKeypairs, "function");
assert.equal(typeof helpers.getIdlByProgramId, "function");
console.log(
  `require() loaded ${Object.keys(helpers).length} exports on Node.js ${process.version}`,
);
