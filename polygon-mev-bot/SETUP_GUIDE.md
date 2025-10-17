# MEV Bot Setup & Verification Guide

This guide provides step-by-step instructions for setting up and verifying the AI-powered MEV bot system.

## Quick Start

```bash
# 1. Install dependencies
cd polygon-mev-bot/eliza-agent-ai
npm install

cd ../scripts
npm install

# 2. Setup RL model (placeholder for development)
cd ../eliza-agent-ai
npm run setup:model

# 3. Verify setup
npm run verify:setup

# 4. Configure environment
cp .env.example .env
# Edit .env and fill in your credentials

# 5. Build
npm run build

# 6. Test (dry run mode)
DRY_RUN=true npm start
```

## Detailed Setup Instructions

### 1. Prerequisites

- Node.js v20+ 
- npm v10+
- Foundry (for contract compilation)
- Git

### 2. Install Foundry

```bash
# Download Foundry
curl -L https://foundry.paradigm.xyz | bash

# Install Foundry tools
foundryup
```

If the curl command fails due to network restrictions, download pre-built binaries:

```bash
# Download and extract Foundry
cd /tmp
wget https://github.com/foundry-rs/foundry/releases/download/nightly/foundry_nightly_linux_amd64.tar.gz
tar -xzf foundry_nightly_linux_amd64.tar.gz
mkdir -p ~/.foundry/bin
cp forge cast anvil chisel ~/.foundry/bin/

# Add to PATH
export PATH="$HOME/.foundry/bin:$PATH"
echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> ~/.bashrc
```

### 3. Install Project Dependencies

```bash
cd polygon-mev-bot

# Install agent dependencies
cd eliza-agent-ai
npm install

# Install script dependencies
cd ../scripts
npm install

# Install MCP server dependencies (optional)
cd ../mcp-servers/polygon-blockchain
npm install
```

### 4. Setup RL Model

The bot uses a Reinforcement Learning model for strategy selection. For development, a placeholder model is sufficient:

```bash
cd polygon-mev-bot/eliza-agent-ai
npm run setup:model
```

For production, you need a trained PPO (Proximal Policy Optimization) model:

1. Collect historical MEV execution data
2. Train a PPO agent using the data
3. Export the trained model to ONNX format
4. Set `RL_MODEL_URL` in `.env` to download the model
5. Run `npm run setup:model --force` to download

### 5. Environment Configuration

```bash
cd polygon-mev-bot/eliza-agent-ai
cp .env.example .env
```

Edit `.env` and configure the following **required** variables:

```bash
# Blockchain RPC endpoints
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_WSS_URL=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGONSCAN_API_KEY=YOUR_POLYGONSCAN_KEY

# Wallet
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
WALLET_ADDRESS=0xYOUR_WALLET_ADDRESS

# Thirdweb API (for Nebula LLM and MCP)
THIRDWEB_SECRET_KEY=YOUR_THIRDWEB_SECRET_KEY
THIRDWEB_CLIENT_ID=YOUR_THIRDWEB_CLIENT_ID

# LLM Provider (choose one)
OPENAI_API_KEY=sk-xxxx
# OR
ANTHROPIC_API_KEY=sk-ant-xxxx

# Safety flags (CRITICAL - keep these enabled until you're ready)
DRY_RUN=true
ALLOW_EXECUTION=false
ALLOW_NEBULA_EXECUTION=false

# MEV Executor contract (set after deployment)
MEV_EXECUTOR_ADDRESS=
```

### 6. Compile Smart Contracts

```bash
cd polygon-mev-bot/contracts

# Compile contracts
forge build

# Run tests
forge test -vv

# Gas report
forge test --gas-report
```

All contracts should compile without errors. If you see compilation errors, check that:
- Foundry is properly installed
- Solidity version matches (0.8.20)
- All dependencies are present

### 7. Deploy Contracts

**⚠️ IMPORTANT: Deploy to testnet first!**

```bash
cd polygon-mev-bot/contracts

# Deploy to Mumbai testnet
forge script script/DeployGenerated.s.sol \
  --rpc-url $POLYGON_TESTNET_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY

# Note the deployed address
# Example output: "MEVExecutor deployed at: 0x..."
```

Update your `.env` files with the deployed address:

```bash
# In polygon-mev-bot/eliza-agent-ai/.env
MEV_EXECUTOR_ADDRESS=0xYOUR_DEPLOYED_ADDRESS

# Also update in polygon-mev-bot/.env if it exists
```

### 8. Verify Setup

Run the comprehensive verification script:

```bash
cd polygon-mev-bot/eliza-agent-ai
npm run verify:setup
```

This checks:
- ✅ All 6 generated contracts exist
- ✅ Core integration files present
- ✅ RL model (warns if placeholder)
- ✅ Environment template complete
- ✅ Deployment scripts ready
- ✅ Documentation present
- ✅ MCP configuration valid
- ✅ Dependencies installed

### 9. Test the Agent

#### Dry Run Test (Safe - No Real Transactions)

```bash
cd polygon-mev-bot/eliza-agent-ai

# Ensure safety flags are set
export DRY_RUN=true
export ALLOW_EXECUTION=false

# Start the agent
npm start
```

The agent should:
1. Initialize successfully
2. Connect to Thirdweb Nebula
3. Start monitoring the blockchain
4. Detect opportunities (if any)
5. Analyze and log decisions (but not execute)

Press Ctrl+C to stop.

#### Smoke Tests

```bash
# Test MCP integration
npm run smoke:mcp

# Test transaction encoding
npm run smoke:encode

# Test simulation (requires RPC)
npm run preflight:sim

# Test Thirdweb wallet
npm run thirdweb:wallet
```

### 10. Production Deployment

**⚠️ WARNING: Only proceed when you understand the risks and have tested thoroughly**

1. Deploy contracts to Polygon mainnet
2. Update `MEV_EXECUTOR_ADDRESS` in `.env`
3. Start with small capital in the wallet
4. Enable execution flags gradually:

```bash
# Stage 1: Dry run with real opportunities (logs only)
DRY_RUN=true ALLOW_EXECUTION=false npm start

# Stage 2: Enable execution but keep small capital
DRY_RUN=false ALLOW_EXECUTION=true npm start

# Monitor closely for first 24 hours
# Check logs, profits, gas costs, errors
```

## Verification Matrix

Based on the custom instructions, here's the complete checklist:

- [x] `generate-contracts-with-nebula.ts` - Contract generator exists
- [x] `thirdweb-nebula-integration.ts` - Nebula client implemented
- [x] `mcp-config.json` - MCP servers configured
- [x] `package.json` - Dependencies declared
- [x] `MEVExecutor.sol` - Main contract generated
- [x] `DEXAdapter.sol` - DEX integration generated
- [x] `AaveAdapter.sol` - Aave liquidation generated
- [x] `JITAdapter.sol` - JIT liquidity generated
- [x] `OracleLib.sol` - Oracle utilities generated
- [x] `Interfaces.sol` - Protocol interfaces generated
- [x] Documentation - ACTION_PLAN.md, WHAT_TO_RUN.txt, MASTER_GUIDE.md
- [x] `GENERATE_NOW.sh` - Contract generation script
- [ ] `forge build` - Requires Solidity compiler (network restricted)
- [ ] `forge test -vv` - Requires Solidity compiler
- [x] Deployment scripts - Deploy.s.sol, DeployGenerated.s.sol
- [x] `npm start` - TypeScript builds and runs
- [x] Credentials template - .env.example with all keys
- [x] Contract imports - All contracts reference correct paths
- [x] TODO scan - Minimal TODOs, fallbacks implemented
- [ ] End-to-end demo - Requires deployed contracts and credentials
- [x] RL model - Placeholder created, download logic implemented

## Troubleshooting

### "forge: command not found"

Foundry is not installed or not in PATH. See "Install Foundry" section above.

### "Error sending request for url (soliditylang.org)"

Network restrictions prevent downloading Solidity compiler. Use pre-downloaded binaries or a different network.

### "RL model not available, using heuristic"

This is expected if using the placeholder model. The agent falls back to simple heuristics based on opportunity type. For production, train and provide a real model.

### "Thirdweb MCP endpoint is not configured"

Check that:
1. `THIRDWEB_SECRET_KEY` is set in `.env`
2. `mcp-config.json` has the thirdweb entry
3. The MCP URL is reachable

### Agent detects no opportunities

This is normal! MEV opportunities are rare and competitive. The agent may run for hours before finding a profitable opportunity. Check that:
1. RPC/WSS endpoints are working
2. The monitored DEXs have volume
3. Gas prices are reasonable

### "Failed to execute: revert"

Transaction simulation failed. Common causes:
1. Insufficient balance for gas
2. Slippage tolerance too tight
3. Opportunity already taken
4. Oracle price validation failed

## Monitoring & Metrics

The agent logs comprehensive metrics:

```
📊 Agent Status:
   Uptime: 1h 23m
   Opportunities: 47 detected, 12 analyzed, 3 queued
   Last opportunity: 2m ago
   Route plans: 8/10 successful
   Simulations: 5 succeeded, 2 failed
   Executions: 2 confirmed on-chain
   Last strategy decision: ARBITRAGE (execute, confidence 87.3%)
```

## Next Steps

1. **Train RL Model**: Use historical execution data to train a PPO agent
2. **Optimize Strategies**: Tune gas multipliers, slippage, timing
3. **Add Strategies**: Implement backrunning, sandwich attacks (if ethical)
4. **Scale**: Increase capital gradually as confidence grows
5. **Monitor**: Set up alerts for errors, low profits, high gas

## Support

- Review `docs/ACTION_PLAN.md` for development roadmap
- Check `WHAT_TO_RUN.txt` for accurate workflow
- See `.github/copilot-instructions.md` for implementation guidelines

## Security Warnings

⚠️ **CRITICAL SECURITY PRACTICES:**

1. **Never commit private keys** to git
2. **Use a secrets manager** in production
3. **Start with testnet** and small capital
4. **Monitor closely** for first 24-48 hours
5. **Set circuit breakers** for max loss, gas price
6. **Keep DRY_RUN=true** until thoroughly tested
7. **Review all transactions** before enabling ALLOW_EXECUTION
8. **Use separate wallet** with limited funds initially

MEV trading carries significant risks including:
- Smart contract vulnerabilities
- Front-running by other bots
- Gas fee losses on failed transactions
- Market manipulation
- Regulatory concerns

Only deploy to production when you fully understand these risks.
