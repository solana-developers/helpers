#!/bin/bash

set -e

# Run ts-mocha tests
npm i -g esrun
esrun --verbose tests/index.test.ts

# Change directory to bankrun_test
cd tests/bankrun_test

# Run anchor test
anchor test