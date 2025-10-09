#!/bin/bash

# ONE-COMMAND MEV CONTRACT GENERATION
# Uses Thirdweb Nebula (blockchain LLM) to generate all smart contracts

set -e

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                        ║"
echo "║     🔮 GENERATING MEV CONTRACTS WITH THIRDWEB NEBULA 🔮               ║"
echo "║                                                                        ║"
echo "║          Let the blockchain-trained LLM write your code!              ║"
echo "║                                                                        ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

# Check environment
if [ ! -f .env ]; then
    echo "❌ .env file not found"
    exit 1
fi

source .env

if [ -z "$THIRDWEB_SECRET_KEY" ]; then
    echo "❌ THIRDWEB_SECRET_KEY not set in .env"
    exit 1
fi

echo "✅ Environment configured"
echo "   Thirdweb Client ID: ${THIRDWEB_CLIENT_ID:0:20}..."
echo "   Wallet: $WALLET_ADDRESS"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
cd scripts
npm install --silent
cd ..

echo "✅ Dependencies installed"
echo ""

# Generate contracts with Nebula
echo "🔮 Calling Thirdweb Nebula to generate smart contracts..."
echo "   This will take 5-10 minutes..."
echo ""

npx ts-node scripts/generate-contracts-with-nebula.ts

if [ $? -eq 0 ]; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════════════╗"
    echo "║  ✅ CONTRACTS GENERATED SUCCESSFULLY!                                  ║"
    echo "╚════════════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Generated contracts in: contracts/src/generated/"
    echo ""
    echo "Next steps:"
    echo "  1. Review contracts: cd contracts/src/generated && ls -lah"
    echo "  2. Compile: cd contracts && forge build"
    echo "  3. Test: forge test -vv"
    echo "  4. Deploy: forge script script/Deploy.s.sol --broadcast"
    echo ""
else
    echo "❌ Generation failed"
    exit 1
fi
