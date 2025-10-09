# Quick Start Guide - Polygon MEV Bot

This guide will get you running in **under 30 minutes**.

## Prerequisites

- ✅ Funded Polygon wallet with at least 1 MATIC for gas
- ✅ Alchemy API key (already configured)
- ✅ Basic understanding of MEV concepts

## Step-by-Step Deployment

### 1. Clone and Setup (5 minutes)

```bash
# Navigate to project
cd polygon-mev-bot

# Verify environment
cat .env
# Should show your credentials (already configured)
```

### 2. Install Dependencies (5 minutes)

```bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install smart contract dependencies
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v4.9.0
forge install foundry-rs/forge-std

# Install agent dependencies
cd ../eliza-agent
npm install
```

### 3. Test Smart Contracts (5 minutes)

```bash
cd ../contracts

# Run tests
forge test -vv

# Expected output:
# [PASS] testDeployment() (gas: 12345)
# [PASS] testCircuitBreakerConfiguration() (gas: 23456)
# [PASS] testEmergencyPause() (gas: 34567)
# ...
# Test result: ok. X passed; 0 failed
```

### 4. Deploy to Polygon (10 minutes)

```bash
# Deploy smart contract
forge script script/Deploy.s.sol \
  --rpc-url $POLYGON_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY

# 📝 IMPORTANT: Copy the deployed address from output
# Look for: "MEVExecutor deployed at: 0x..."
```

### 5. Update Configuration (2 minutes)

```bash
# Add deployed address to both .env files
export MEV_EXECUTOR_ADDRESS=0xYOUR_DEPLOYED_ADDRESS

# Update root .env
echo "MEV_EXECUTOR_ADDRESS=$MEV_EXECUTOR_ADDRESS" >> ../.env

# Update agent .env
echo "MEV_EXECUTOR_ADDRESS=$MEV_EXECUTOR_ADDRESS" >> ../eliza-agent/.env
```

### 6. Start the Agent (3 minutes)

```bash
cd ../eliza-agent

# Create .env if not exists
cp .env.example .env

# Add your deployed address
nano .env  # or vim, or any editor

# Start the agent
npm start
```

## Verification Checklist

After starting, you should see:

```
✅ Connected to network: matic (chainId: 137)
✅ Wallet balance: X.XXX MATIC
✅ MEVExecutor contract verified at: 0x...
✅ Mempool monitor active
✅ Opportunity analyzer active
```

## First Steps After Deployment

### 1. Verify Contract on PolygonScan

Visit: `https://polygonscan.com/address/YOUR_DEPLOYED_ADDRESS`

You should see:
- ✅ Contract verified
- ✅ Source code visible
- ✅ Write functions available

### 2. Fund the Contract

```bash
# Send initial capital (start small!)
cast send $MEV_EXECUTOR_ADDRESS \
  --value 0.1ether \
  --private-key $PRIVATE_KEY
```

### 3. Monitor First Operations

Watch the agent logs for:

```
[OPPORTUNITY] 🎯 Large swap detected...
[INFO] Analyzing arbitrage opportunity...
[PROFIT] 💰 Strategy executed: +0.XX MATIC
```

### 4. Check Circuit Breakers

```bash
# Query circuit breaker status
cast call $MEV_EXECUTOR_ADDRESS \
  "circuitBreaker()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)"

# Should return: minProfit, maxLoss, dailyLimit, etc.
```

## Common Issues & Solutions

### Issue: "MEVExecutor contract not found"

**Solution**: Ensure you've set `MEV_EXECUTOR_ADDRESS` in `.env`

```bash
echo $MEV_EXECUTOR_ADDRESS
# Should output: 0x...
```

### Issue: "Insufficient funds for gas"

**Solution**: Fund your wallet

```bash
# Check balance
cast balance $WALLET_ADDRESS --rpc-url $POLYGON_RPC_URL

# Need at least 1 MATIC for gas
```

### Issue: "WebSocket connection failed"

**Solution**: Verify your Alchemy WebSocket URL

```bash
# Test connection
wscat -c $POLYGON_WSS_URL
```

### Issue: "No opportunities detected"

**Solution**: This is normal! MEV opportunities are rare. Key points:

- Be patient - may take hours between opportunities
- Ensure mempool monitor is running
- Check that you're monitoring correct DEXs
- Polygon has less MEV than Ethereum mainnet

## Monitoring Commands

### Check Contract Balance

```bash
cast balance $MEV_EXECUTOR_ADDRESS --rpc-url $POLYGON_RPC_URL
```

### Check Execution Stats

```bash
cast call $MEV_EXECUTOR_ADDRESS "getStats()(uint256,uint256,uint256,uint256,uint256,uint256)"
# Returns: totalExecutions, successfulExecutions, totalProfit, totalGasSpent, largestProfit, largestLoss
```

### Check Sharpe Ratio

```bash
cast call $MEV_EXECUTOR_ADDRESS "getSharpeRatio()(uint256)"
# Returns: sharpeRatio (in basis points, e.g., 20000 = 2.0)
```

## Next Steps

Once running successfully:

1. **Monitor for 24-48 hours** with minimal capital
2. **Review logs** for opportunity detection
3. **Analyze profitability** of executed strategies
4. **Gradually increase capital** if metrics meet targets:
   - Win rate >70%
   - Sharpe ratio >2.0
   - Max drawdown <15%

## Safety Reminders

⚠️ **Start small**: Begin with 0.1-1 MATIC
⚠️ **Monitor closely**: Check logs every few hours initially
⚠️ **Circuit breakers**: Ensure they're configured and working
⚠️ **Emergency pause**: Know how to pause if needed

```bash
# Emergency pause command
cast send $MEV_EXECUTOR_ADDRESS "emergencyPause()" --private-key $PRIVATE_KEY
```

## Getting Help

If you encounter issues:

1. Check logs: `tail -f eliza-agent/logs/*.log`
2. Review contract events on PolygonScan
3. Test circuit breakers manually
4. Consult [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

**You're now ready to start extracting MEV on Polygon! 🚀**

**Estimated time to first opportunity**: 1-24 hours (depending on market conditions)

**Target first profit**: 0.05-0.1 MATIC from arbitrage
