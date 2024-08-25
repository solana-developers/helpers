#!/bin/bash

set -e

# Run ts-mocha tests
npx --max-old-space-size=4096 esrun tests/index.test.ts

# Change directory to bankrun_test
cd tests/bankrun_test

# Run anchor test
anchor test