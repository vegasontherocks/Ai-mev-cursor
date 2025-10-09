# Troubleshooting Guide

Common issues and solutions for Polygon MEV Bot.

## Smart Contract Issues

### Issue: "Insufficient funds for transaction"

**Cause**: Not enough MATIC for gas

**Solution**:
```bash
# Check balance
cast balance $WALLET_ADDRESS --rpc-url $POLYGON_RPC_URL

# Fund wallet (need at least 1 MATIC for deployment)
```

### Issue: "Contract deployment fails with 'out of gas'"

**Cause**: Gas limit too low

**Solution**:
```bash
# Deploy with higher gas limit
forge script script/Deploy.s.sol \
  --rpc-url $POLYGON_RPC_URL \
  --broadcast \
  --gas-limit 3000000
```

### Issue: "Circuit breaker triggered immediately"

**Cause**: Parameters too strict or contract misconfigured

**Solution**:
```bash
# Check current parameters
cast call $MEV_EXECUTOR_ADDRESS "circuitBreaker()"

# Adjust if needed
cast send $MEV_EXECUTOR_ADDRESS \
  "setCircuitBreaker(uint256,uint256,uint256,uint256)" \
  0.005ether 0.2ether 10ether 500 \
  --private-key $PRIVATE_KEY
```

### Issue: "Flash loan fails with 'INSUFFICIENT_LIQUIDITY'"

**Cause**: Balancer pool doesn't have enough tokens

**Solution**:
- Reduce loan amount
- Try different token pairs
- Check Balancer pool liquidity: https://app.balancer.fi

### Issue: "Transaction reverts with 'InsufficientProfit'"

**Cause**: Opportunity no longer profitable (frontrun or stale)

**Solution**: This is normal MEV competition. The bot will:
- Only lose gas costs (no capital loss)
- Circuit breakers prevent excessive losses
- Adjust `minProfitThreshold` if too aggressive

## Agent Issues

### Issue: "WebSocket connection failed"

**Cause**: Invalid WebSocket URL or API limit reached

**Solution**:
```bash
# Test WebSocket connection
wscat -c $POLYGON_WSS_URL

# Use backup RPC if primary fails
export POLYGON_WSS_URL="wss://polygon-rpc.com"
```

### Issue: "Agent starts but no opportunities detected"

**Cause**: This is normal - MEV opportunities are rare

**Expected behavior**:
- May take hours between opportunities
- Polygon has less MEV than Ethereum
- Most opportunities are small (<0.1 MATIC)

**Verify monitoring is working**:
```bash
# Check agent logs
tail -f eliza-agent/logs/*.log

# Should see periodic mempool scans
# "Scanning arbitrage opportunities..."
```

### Issue: "TypeError: Cannot read property 'address'"

**Cause**: MEV_EXECUTOR_ADDRESS not set

**Solution**:
```bash
# Set in .env
echo "MEV_EXECUTOR_ADDRESS=0x..." >> .env

# Restart agent
npm start
```

### Issue: "Gas price exceeds MAX_GAS_PRICE"

**Cause**: Network congestion

**Solution**:
```bash
# Increase max gas price in .env
echo "MAX_GAS_PRICE=1000" >> .env

# Or wait for lower gas prices
```

## Performance Issues

### Issue: "Win rate below 50%"

**Cause**: High competition or suboptimal parameters

**Solutions**:
1. **Reduce min profit threshold** (less selective, more attempts)
   ```bash
   # .env
   MIN_PROFIT_THRESHOLD=0.005
   ```

2. **Increase gas multiplier** (faster execution)
   ```bash
   # In character config
   "gasMultiplier": 1.2  # from 1.1
   ```

3. **Use FastLane** (priority execution)
   ```bash
   FASTLANE_ENABLED=true
   ```

### Issue: "High gas costs eating profits"

**Cause**: Gas optimization needed or wrong strategy

**Solutions**:
1. **Increase min profit threshold**
   ```bash
   MIN_PROFIT_THRESHOLD=0.02  # from 0.01
   ```

2. **Profile gas usage**
   ```bash
   cd contracts
   forge test --gas-report
   ```

3. **Focus on larger opportunities**
   - Adjust DEX monitoring filters
   - Increase minimum swap size detection

### Issue: "Sharpe ratio < 1.0"

**Cause**: Too much volatility or losing trades

**Solutions**:
1. **Tighten circuit breakers**
   ```solidity
   setCircuitBreaker(
     0.02 ether,  // Higher min profit
     0.05 ether,  // Lower max loss
     2 ether,     // Lower daily limit
     200          // Lower drawdown (2%)
   )
   ```

2. **Use fractional Kelly sizing**
   ```solidity
   setKellyParameters(
     7500,        // Win rate
     0.05 ether,  // Avg win
     0.02 ether,  // Avg loss
     2500         // 25% Kelly (more conservative)
   )
   ```

## Security Issues

### Issue: "Suspicious transaction from contract"

**Cause**: Possible exploit attempt

**IMMEDIATE ACTION**:
```bash
# 1. Pause contract
cast send $MEV_EXECUTOR_ADDRESS "emergencyPause()" \
  --private-key $PRIVATE_KEY

# 2. Initiate emergency withdrawal
cast send $MEV_EXECUTOR_ADDRESS "initiateEmergencyWithdrawal()" \
  --private-key $PRIVATE_KEY

# 3. Wait 24 hours, then withdraw
cast send $MEV_EXECUTOR_ADDRESS \
  "executeEmergencyWithdrawal(address)" \
  $TOKEN_ADDRESS \
  --private-key $PRIVATE_KEY
```

### Issue: "Unknown function called on contract"

**Cause**: Only owner should call functions

**Verify**:
```bash
# Check if you're owner
cast call $MEV_EXECUTOR_ADDRESS "owner()(address)"

# Should match your wallet address
echo $WALLET_ADDRESS
```

## Testing Issues

### Issue: "Foundry tests fail on fork"

**Cause**: RPC rate limiting or network issues

**Solution**:
```bash
# Use local Anvil instance
anvil --fork-url $POLYGON_RPC_URL

# In another terminal
forge test --fork-url http://localhost:8545
```

### Issue: "Test fails: 'VM Exception: revert'"

**Cause**: Contract requires specific setup

**Solution**:
```bash
# Run tests with verbosity
forge test -vvvv

# Check specific test
forge test --match-test testFlashArbitrage -vvvv
```

## Network Issues

### Issue: "RPC request timeout"

**Cause**: Slow/overloaded RPC endpoint

**Solution**:
```bash
# Use backup RPC
export POLYGON_RPC_URL="https://polygon-rpc.com"

# Or Alchemy/Infura alternative URL
```

### Issue: "Nonce too low"

**Cause**: Transaction already mined or cancelled

**Solution**:
```bash
# Get current nonce
cast nonce $WALLET_ADDRESS --rpc-url $POLYGON_RPC_URL

# Wait a few blocks and retry
```

## Data Issues

### Issue: "Oracle price stale"

**Cause**: Chainlink oracle not updated recently

**Check**:
```bash
# Query oracle last update
cast call $CHAINLINK_ORACLE \
  "latestRoundData()(uint80,int256,uint256,uint256,uint80)"

# Timestamp should be within 1 hour
```

### Issue: "TWAP deviation too high"

**Cause**: Price manipulation or volatile market

**This is intentional protection!**
- Circuit breaker preventing manipulation
- Wait for prices to stabilize
- Consider increasing MAX_TWAP_DEVIATION (carefully!)

## Debugging Commands

### Check Contract State

```bash
# Circuit breaker status
cast call $MEV_EXECUTOR_ADDRESS "circuitBreaker()"

# Kelly parameters
cast call $MEV_EXECUTOR_ADDRESS "kellyParams()"

# Stats
cast call $MEV_EXECUTOR_ADDRESS "getStats()"

# Sharpe ratio
cast call $MEV_EXECUTOR_ADDRESS "getSharpeRatio()"
```

### Check Recent Transactions

```bash
# Get latest transactions
cast logs $MEV_EXECUTOR_ADDRESS \
  --rpc-url $POLYGON_RPC_URL

# Filter for profits
cast logs $MEV_EXECUTOR_ADDRESS \
  --rpc-url $POLYGON_RPC_URL \
  --event "StrategyExecuted(uint8,address,uint256,uint256,uint256)"
```

### Test Connectivity

```bash
# Test RPC
curl -X POST $POLYGON_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Test WebSocket
wscat -c $POLYGON_WSS_URL
```

## Getting More Help

### Enable Debug Logging

```bash
# In .env
DEBUG=true

# Restart agent
npm start
```

### Collect Diagnostic Info

```bash
# System info
node -v
forge --version
cast --version

# Network info
cast chain-id --rpc-url $POLYGON_RPC_URL
cast block-number --rpc-url $POLYGON_RPC_URL

# Contract info
cast code $MEV_EXECUTOR_ADDRESS --rpc-url $POLYGON_RPC_URL | head -c 100
```

### Review Logs

```bash
# Agent logs
tail -100 eliza-agent/logs/*.log

# System logs
journalctl -u mev-bot -n 100
```

## Still Having Issues?

1. Check contract on PolygonScan: `https://polygonscan.com/address/$MEV_EXECUTOR_ADDRESS`
2. Review recent transactions for errors
3. Test with minimal capital first (0.01 MATIC)
4. Consider consulting a Solidity security expert for contract review

---

**Remember**: Some "failures" are expected in MEV! The bot is designed to:
- Fail safely (circuit breakers)
- Minimize gas costs on failures
- Protect capital above all else
