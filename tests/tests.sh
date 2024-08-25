#!/bin/bash

set -e
set -o pipefail

# Run ts-mocha tests
pnpm esrun tests/index.test.ts

# Change directory to bankrun_test
cd tests/bankrun_test

# Run anchor test
anchor test