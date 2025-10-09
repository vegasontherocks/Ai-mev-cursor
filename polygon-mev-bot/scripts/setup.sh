#!/bin/bash

# Polygon MEV Bot Setup Script
# This script automates the initial setup process

set -e

echo "🚀 Polygon MEV Bot - Automated Setup"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    echo "Please create .env file with your credentials"
    exit 1
fi

echo -e "${GREEN}✅ Found .env file${NC}"

# Load environment variables
source .env

# Check required variables
if [ -z "$PRIVATE_KEY" ]; then
    echo -e "${RED}❌ PRIVATE_KEY not set in .env${NC}"
    exit 1
fi

if [ -z "$POLYGON_RPC_URL" ]; then
    echo -e "${RED}❌ POLYGON_RPC_URL not set in .env${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Environment variables loaded${NC}"
echo ""

# Check for Foundry
echo "Checking dependencies..."
if ! command -v forge &> /dev/null; then
    echo -e "${YELLOW}⚠️  Foundry not found. Installing...${NC}"
    curl -L https://foundry.paradigm.xyz | bash
    source ~/.bashrc
    foundryup
else
    echo -e "${GREEN}✅ Foundry installed${NC}"
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
else
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✅ Node.js installed: $NODE_VERSION${NC}"
fi

echo ""
echo "Installing smart contract dependencies..."
cd contracts

# Install Foundry dependencies
if [ ! -d "lib/openzeppelin-contracts" ]; then
    forge install OpenZeppelin/openzeppelin-contracts@v4.9.0 --no-commit
    echo -e "${GREEN}✅ OpenZeppelin installed${NC}"
else
    echo -e "${GREEN}✅ OpenZeppelin already installed${NC}"
fi

if [ ! -d "lib/forge-std" ]; then
    forge install foundry-rs/forge-std --no-commit
    echo -e "${GREEN}✅ forge-std installed${NC}"
else
    echo -e "${GREEN}✅ forge-std already installed${NC}"
fi

echo ""
echo "Running smart contract tests..."
forge test -vv

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed${NC}"
else
    echo -e "${RED}❌ Tests failed${NC}"
    exit 1
fi

echo ""
echo "Installing agent dependencies..."
cd ../eliza-agent

if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✅ Agent dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Agent dependencies already installed${NC}"
fi

# Copy .env to agent directory
if [ ! -f .env ]; then
    cp ../.env .env
    echo -e "${GREEN}✅ Copied .env to agent directory${NC}"
fi

cd ..

echo ""
echo "===================================="
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Deploy smart contract:"
echo "   cd contracts"
echo "   forge script script/Deploy.s.sol --rpc-url \$POLYGON_RPC_URL --broadcast"
echo ""
echo "2. Add deployed address to .env:"
echo "   echo 'MEV_EXECUTOR_ADDRESS=0x...' >> .env"
echo ""
echo "3. Start the agent:"
echo "   cd eliza-agent"
echo "   npm start"
echo ""
echo "For detailed instructions, see docs/QUICK_START.md"
