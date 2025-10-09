# Polygon MEV Bot - Production-Grade MEV Extraction System

A comprehensive MEV (Maximum Extractable Value) bot for Polygon network featuring:
- ✅ Zero-fee Balancer flash loans
- ✅ Multi-strategy execution (Arbitrage, JIT, Liquidation, Backrun)
- ✅ AI-powered opportunity detection
- ✅ Kelly Criterion position sizing
- ✅ Multi-layer circuit breakers
- ✅ TWAP oracle protection
- ✅ Institutional-grade risk management

## 🏗️ Architecture

### Smart Contract Layer (`/contracts`)
- **MEVExecutor.sol**: Core execution contract with flash loan integration
- Balancer V2 integration for zero-fee flash loans
- Circuit breakers: per-tx, daily, and drawdown limits
- Gas-optimized with <200k gas per execution target

### AI Agent Layer (`/eliza-agent`)
- **Mempool Monitor**: Real-time transaction scanning
- **Opportunity Analyzer**: MEV detection and validation
- **Strategy Selector**: ML-based strategy optimization
- **Risk Manager**: Kelly Criterion position sizing

## 🚀 Quick Start

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install Node.js dependencies
cd eliza-agent && npm install
```

### Configuration

1. **Set up environment variables**:

```bash
cp .env.example .env
# Edit .env with your credentials
```

2. **Configure your credentials** (already populated from your prompt):
- ✅ Alchemy RPC URL
- ✅ Private key
- ✅ Wallet address
- ✅ API keys

### Deployment

#### Step 1: Deploy Smart Contract

```bash
cd contracts

# Install dependencies
forge install OpenZeppelin/openzeppelin-contracts
forge install foundry-rs/forge-std

# Run tests
forge test -vv

# Deploy to Polygon
forge script script/Deploy.s.sol \
  --rpc-url $POLYGON_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY

# Note the deployed MEV_EXECUTOR_ADDRESS
```

#### Step 2: Update Configuration

```bash
# Add deployed address to .env
echo "MEV_EXECUTOR_ADDRESS=0xYOUR_DEPLOYED_ADDRESS" >> .env
```

#### Step 3: Start AI Agent

```bash
cd eliza-agent

# Install dependencies
npm install

# Start the agent
npm start
```

## 📊 Expected Output

When running successfully, you'll see:

```
🚀 Starting Polygon MEV Hunter Agent...
📡 Connected to network: matic (chainId: 137)
💰 Wallet balance: 1.234 MATIC
✅ MEVExecutor contract verified at: 0x...
🔍 Starting mempool monitor...
✅ Mempool monitor active
🧠 Starting opportunity analyzer...
✅ Opportunity analyzer active
📊 Monitoring for arbitrage, liquidation, and JIT opportunities...

[OPPORTUNITY] 🎯 Large swap detected: { hash: '0x...', value: '125.5 MATIC' }
[PROFIT] 💰 Arbitrage executed: +0.15 MATIC (gas: 0.02 MATIC)
```

## 🧪 Testing

### Smart Contract Tests

```bash
cd contracts

# Unit tests
forge test -vv

# Gas profiling
forge test --gas-report

# Fuzz testing (10k runs)
forge test --fuzz-runs 10000

# Fork testing against Polygon mainnet
forge test --fork-url $POLYGON_RPC_URL -vvv
```

### Test Coverage

Run the comprehensive test suite:

```bash
forge coverage
```

Target: >90% coverage on critical paths

## 🔐 Security Features

### Circuit Breakers

1. **Per-Transaction Limits**
   - Min profit: 0.01 MATIC
   - Max loss: 0.1 MATIC

2. **Daily Limits**
   - Daily loss cap: 5 MATIC
   - Auto-reset at midnight UTC

3. **Drawdown Protection**
   - Auto-pause at 3% drawdown
   - Peak capital tracking

### Emergency Controls

```solidity
// Pause all operations
mevExecutor.emergencyPause()

// Initiate withdrawal (24h timelock)
mevExecutor.initiateEmergencyWithdrawal()

// Execute after timelock
mevExecutor.executeEmergencyWithdrawal(tokenAddress)
```

## 📈 Performance Monitoring

### Key Metrics

Track these metrics for optimal performance:

- **Sharpe Ratio**: Target >2.0
- **Win Rate**: Target >70%
- **Max Drawdown**: Target <15%
- **Gas Efficiency**: Target >20:1 (profit/gas)

### Statistics

```bash
# Query on-chain stats
cast call $MEV_EXECUTOR_ADDRESS "getStats()(uint256,uint256,uint256,uint256,uint256,uint256)"

# Calculate Sharpe ratio
cast call $MEV_EXECUTOR_ADDRESS "getSharpeRatio()(uint256)"
```

## 🎯 Strategy Configuration

### Arbitrage Strategy

```typescript
{
  type: "ARBITRAGE",
  targetDEXs: ["QuickSwap", "Uniswap V3", "SushiSwap"],
  minProfit: "0.01 MATIC",
  maxSlippage: "0.5%"
}
```

### JIT Liquidity Strategy

```typescript
{
  type: "JIT",
  targetPools: ["MATIC/USDC", "WETH/USDC"],
  minSwapSize: "$10,000",
  feeCapture: ">80%"
}
```

### Liquidation Strategy

```typescript
{
  type: "LIQUIDATION",
  protocols: ["Aave V3"],
  minHealthFactor: "<1.0",
  minLiquidationValue: "$5,000"
}
```

## 🔧 Maintenance

### Update Circuit Breaker Parameters

```bash
cast send $MEV_EXECUTOR_ADDRESS \
  "setCircuitBreaker(uint256,uint256,uint256,uint256)" \
  0.02ether 0.2ether 10ether 500 \
  --private-key $PRIVATE_KEY
```

### Update Kelly Parameters

```bash
cast send $MEV_EXECUTOR_ADDRESS \
  "setKellyParameters(uint256,uint256,uint256,uint256)" \
  8000 0.1ether 0.03ether 6000 \
  --private-key $PRIVATE_KEY
```

### Withdraw Profits

```bash
cast send $MEV_EXECUTOR_ADDRESS \
  "withdrawProfit(address,uint256)" \
  $TOKEN_ADDRESS $AMOUNT \
  --private-key $PRIVATE_KEY
```

## 📚 Documentation

- [Smart Contract API](./docs/CONTRACT_API.md)
- [Strategy Guide](./docs/STRATEGIES.md)
- [Risk Management](./docs/RISK_MANAGEMENT.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

## ⚠️ Risk Warnings

**IMPORTANT**: MEV extraction involves significant risks:

1. **Smart Contract Risk**: Bugs in contracts can lead to loss of funds
2. **Competition Risk**: MEV is highly competitive, profits not guaranteed
3. **Gas Risk**: Failed transactions still cost gas
4. **Price Risk**: Market volatility can cause unexpected losses
5. **Regulatory Risk**: MEV regulations vary by jurisdiction

**Recommendations**:
- ✅ Start with small capital (0.1-1 MATIC)
- ✅ Monitor closely for first 48 hours
- ✅ Use circuit breakers (already configured)
- ✅ Regular security audits
- ✅ Keep private keys secure

## 🤝 Support

For issues or questions:
1. Check [Troubleshooting Guide](./docs/TROUBLESHOOTING.md)
2. Review [FAQ](./docs/FAQ.md)
3. Open an issue on GitHub

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- Balancer V2 for zero-fee flash loans
- OpenZeppelin for secure contract libraries
- Foundry for development framework
- Eliza framework for AI agent capabilities

---

**Built with ❤️ for the Polygon MEV community**

**Status**: 🚧 Production-Ready (Test thoroughly before mainnet deployment)

**Last Updated**: 2025-10-09
