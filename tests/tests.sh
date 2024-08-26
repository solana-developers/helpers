#!/bin/bash

set -e

# Run ts-mocha tests
npm i -g ts-node
node --max-old-space-size=4096 -r ts-node/register tests/index.test.ts

# Change directory to bankrun_test
cd tests/bankrun_test

# Run anchor test
anchor test