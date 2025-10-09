#!/bin/bash

# Smart Contract Deployment Script
# Deploys MEVExecutor to Polygon mainnet

set -e

echo "🚀 Deploying MEVExecutor to Polygon"
echo "===================================="
echo ""

# Load environment
if [ ! -f .env ]; then
    echo "❌ .env file not found"
    exit 1
fi

source .env

# Validate environment
if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ PRIVATE_KEY not set"
    exit 1
fi

if [ -z "$POLYGON_RPC_URL" ]; then
    echo "❌ POLYGON_RPC_URL not set"
    exit 1
fi

if [ -z "$POLYGONSCAN_API_KEY" ]; then
    echo "⚠️  POLYGONSCAN_API_KEY not set - contract won't be verified"
fi

echo "Configuration:"
echo "  RPC: $POLYGON_RPC_URL"
echo "  Wallet: $WALLET_ADDRESS"
echo ""

# Check wallet balance
echo "Checking wallet balance..."
BALANCE=$(cast balance $WALLET_ADDRESS --rpc-url $POLYGON_RPC_URL)
BALANCE_ETH=$(echo "scale=4; $BALANCE / 1000000000000000000" | bc)

echo "  Balance: $BALANCE_ETH MATIC"

if (( $(echo "$BALANCE_ETH < 0.5" | bc -l) )); then
    echo "⚠️  Warning: Low balance. Need at least 0.5 MATIC for deployment"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "Deploying contract..."
cd contracts

if [ -z "$POLYGONSCAN_API_KEY" ]; then
    # Deploy without verification
    forge script script/Deploy.s.sol \
        --rpc-url $POLYGON_RPC_URL \
        --broadcast \
        --slow
else
    # Deploy with verification
    forge script script/Deploy.s.sol \
        --rpc-url $POLYGON_RPC_URL \
        --broadcast \
        --verify \
        --etherscan-api-key $POLYGONSCAN_API_KEY \
        --slow
fi

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📝 IMPORTANT: Copy the MEV_EXECUTOR_ADDRESS from above"
    echo "   and add it to your .env file:"
    echo ""
    echo "   MEV_EXECUTOR_ADDRESS=0x..."
    echo ""
else
    echo "❌ Deployment failed"
    exit 1
fi
