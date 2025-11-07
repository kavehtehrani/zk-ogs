#!/bin/bash
# Regenerate Solidity verifier with --oracle_hash keccak flag
# Following: https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/

set -e

echo "Regenerating verification key with --oracle_hash keccak..."
bb write_vk -b ./target/circuit.json -o ./target --oracle_hash keccak

echo "Generating Solidity verifier..."
bb write_solidity_verifier -k ./target/vk -o ../contracts/contracts/Verifier.sol

echo "✅ Verifier regenerated at ../contracts/contracts/Verifier.sol"
echo ""
echo "Next steps:"
echo "1. Check the contract size: cd ../contracts && npx hardhat compile"
echo "2. If size is acceptable, deploy with: npx hardhat ignition deploy ignition/modules/RockPaperScissors.ts --network localhost"





