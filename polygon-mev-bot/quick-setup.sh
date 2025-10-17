#!/bin/bash
# Quick Setup Script for MEV Bot
# This script automates the initial setup process

set -e  # Exit on error

echo "🚀 MEV Bot Quick Setup"
echo "======================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v20+ first."
    exit 1
fi

echo "✅ Node.js $(node --version) found"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm $(npm --version) found"

# Navigate to project root
cd "$(dirname "$0")"
PROJECT_ROOT=$(pwd)

echo ""
echo "📦 Installing dependencies..."
echo ""

# Install eliza-agent-ai dependencies
echo "📥 Installing eliza-agent-ai dependencies..."
cd "$PROJECT_ROOT/eliza-agent-ai"
npm install

# Install scripts dependencies
echo "📥 Installing scripts dependencies..."
cd "$PROJECT_ROOT/scripts"
npm install

# Install MCP server dependencies (optional)
if [ -d "$PROJECT_ROOT/mcp-servers/polygon-blockchain" ]; then
    echo "📥 Installing MCP server dependencies..."
    cd "$PROJECT_ROOT/mcp-servers/polygon-blockchain"
    npm install || echo "⚠️  MCP server dependencies failed (optional)"
fi

echo ""
echo "🤖 Setting up RL model..."
cd "$PROJECT_ROOT/eliza-agent-ai"
npm run setup:model

echo ""
echo "📋 Verifying setup..."
npm run verify:setup

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Copy .env.example to .env:"
echo "     cd eliza-agent-ai && cp .env.example .env"
echo ""
echo "  2. Edit .env and fill in your credentials:"
echo "     - THIRDWEB_SECRET_KEY"
echo "     - THIRDWEB_CLIENT_ID"
echo "     - POLYGON_RPC_URL"
echo "     - POLYGON_WSS_URL"
echo "     - PRIVATE_KEY"
echo "     - OPENAI_API_KEY or ANTHROPIC_API_KEY"
echo ""
echo "  3. Build the project:"
echo "     npm run build"
echo ""
echo "  4. Test in dry-run mode:"
echo "     DRY_RUN=true npm start"
echo ""
echo "  5. Deploy contracts (testnet first!):"
echo "     cd ../contracts"
echo "     forge script script/DeployGenerated.s.sol --rpc-url \$POLYGON_TESTNET_RPC_URL --broadcast"
echo ""
echo "📚 For detailed instructions, see:"
echo "  - SETUP_GUIDE.md (comprehensive guide)"
echo "  - WHAT_TO_RUN.txt (quick reference)"
echo "  - docs/ACTION_PLAN.md (development roadmap)"
echo ""
