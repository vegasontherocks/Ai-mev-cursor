#!/bin/bash
set -e

cd /workspace/polygon-mev-bot/contracts
source ../.env

echo "🔍 Attempting Contract Verification via Blockscout..."
echo "   Contract: 0x0CD75B9605ad928a47616a6a1549FC856c07dbB7"
echo "   Network: Polygon Mainnet"
echo ""

~/.foundry/bin/forge verify-contract \
  0x0CD75B9605ad928a47616a6a1549FC856c07dbB7 \
  src/generated/MEVExecutor.sol:MEVExecutor \
  --verifier blockscout \
  --verifier-url "https://polygon.blockscout.com/api/" \
  --chain-id 137 \
  --constructor-args 000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8 \
  --watch

