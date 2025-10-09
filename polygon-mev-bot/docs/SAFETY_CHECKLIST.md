# Safety Checklist

Complete this checklist before deploying to mainnet with significant capital.

## Pre-Deployment Checklist

### Smart Contract Security

- [ ] **All tests pass**
  ```bash
  cd contracts && forge test -vv
  ```

- [ ] **Gas profiling complete**
  ```bash
  forge test --gas-report
  # Verify arbitrage execution <200k gas
  ```

- [ ] **Fuzz testing passed**
  ```bash
  forge test --fuzz-runs 10000
  ```

- [ ] **Fork testing successful**
  ```bash
  forge test --fork-url $POLYGON_RPC_URL -vvv
  ```

- [ ] **Circuit breakers configured**
  - Min profit: 0.01 MATIC ✓
  - Max loss per tx: 0.1 MATIC ✓
  - Daily limit: 5 MATIC ✓
  - Drawdown: 3% ✓

- [ ] **Emergency controls tested**
  - Emergency pause works ✓
  - Timelock withdrawal works ✓
  - Only owner can call admin functions ✓

- [ ] **Oracles registered**
  - WMATIC oracle: 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0 ✓
  - USDC oracle: 0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7 ✓
  - WETH oracle: 0xF9680D99D6C9589e2a93a78A04A279e509205945 ✓

- [ ] **DEXs approved**
  - QuickSwap ✓
  - Uniswap V3 ✓
  - SushiSwap ✓

### Agent Configuration

- [ ] **Environment variables set**
  ```bash
  grep -E "PRIVATE_KEY|POLYGON_RPC_URL|MEV_EXECUTOR_ADDRESS" .env
  ```

- [ ] **Character config updated**
  - mevExecutorAddress set correctly
  - Strategy weights configured
  - Risk parameters set

- [ ] **Monitoring enabled**
  - Mempool monitor active
  - Opportunity analyzer running
  - Logs being written

### Wallet Security

- [ ] **Private key secured**
  - Not committed to git ✓
  - .env in .gitignore ✓
  - File permissions: `chmod 600 .env` ✓

- [ ] **Wallet funded appropriately**
  - At least 1 MATIC for gas ✓
  - Test with small amount first (0.1 MATIC) ✓

- [ ] **Backup wallet access**
  - Seed phrase backed up offline
  - Multiple secure copies
  - Recovery process tested

### Operational Security

- [ ] **Rate limits understood**
  - Alchemy: 660 compute units/second
  - Blocknative: 50 requests/second
  - Have backup RPCs configured

- [ ] **Monitoring setup**
  - Discord/Telegram alerts configured
  - Email notifications enabled
  - Dashboard accessible

- [ ] **Emergency procedures documented**
  - Know how to pause contract
  - Know how to withdraw funds
  - Emergency contacts listed

## Deployment Checklist

### Phase 1: Testnet Validation (Optional)

- [ ] **Deploy to Mumbai testnet**
  ```bash
  # Update .env with Mumbai RPC
  forge script script/Deploy.s.sol --rpc-url $MUMBAI_RPC --broadcast
  ```

- [ ] **Run agent on testnet for 24 hours**
  - Monitor for errors
  - Verify mempool monitoring
  - Test emergency pause

### Phase 2: Mainnet Deployment

- [ ] **Deploy contract to Polygon mainnet**
  ```bash
  ./scripts/deploy.sh
  ```

- [ ] **Verify on PolygonScan**
  - Contract verified ✓
  - Source code visible ✓
  - Constructor args correct ✓

- [ ] **Initial configuration**
  - Circuit breakers set ✓
  - Kelly parameters set ✓
  - Oracles registered ✓
  - DEXs approved ✓

- [ ] **Transfer ownership** (if using multisig)
  ```bash
  cast send $MEV_EXECUTOR_ADDRESS \
    "transferOwnership(address)" \
    $MULTISIG_ADDRESS \
    --private-key $PRIVATE_KEY
  ```

### Phase 3: Initial Capital Deployment

- [ ] **Start with minimal capital (0.1 MATIC)**
  ```bash
  cast send $MEV_EXECUTOR_ADDRESS \
    --value 0.1ether \
    --private-key $PRIVATE_KEY
  ```

- [ ] **Run agent for 24-48 hours**
  - Monitor all logs
  - Check every few hours
  - Verify circuit breakers work

- [ ] **Review performance metrics**
  - Win rate: ____% (target: >70%)
  - Sharpe ratio: ____ (target: >2.0)
  - Max drawdown: ____% (target: <15%)
  - Gas efficiency: ____ (target: >20:1)

### Phase 4: Gradual Scaling

- [ ] **Increase to 1 MATIC** (if metrics good)
  - Monitor for 48 hours
  - Verify profitability
  - Check gas costs

- [ ] **Increase to 5 MATIC** (if still profitable)
  - Monitor for 1 week
  - Analyze strategy performance
  - Adjust parameters if needed

- [ ] **Scale to target capital** (if consistently profitable)
  - Never exceed 10% of wallet balance
  - Maintain emergency reserves
  - Regular profit withdrawals

## Ongoing Monitoring Checklist

### Daily Checks

- [ ] **Review logs for errors**
  ```bash
  tail -100 eliza-agent/logs/*.log | grep ERROR
  ```

- [ ] **Check circuit breaker status**
  ```bash
  ./scripts/monitor.sh
  ```

- [ ] **Verify agent is running**
  ```bash
  ps aux | grep "npm start"
  ```

- [ ] **Monitor wallet balance**
  ```bash
  cast balance $WALLET_ADDRESS
  ```

### Weekly Checks

- [ ] **Calculate performance metrics**
  - Sharpe ratio
  - Win rate
  - Max drawdown
  - Total profit

- [ ] **Review strategy effectiveness**
  - Which strategies are profitable?
  - Where are losses coming from?
  - Should we adjust weights?

- [ ] **Check for contract updates**
  - Any security advisories?
  - Protocol upgrades needed?

- [ ] **Withdraw accumulated profits**
  ```bash
  cast send $MEV_EXECUTOR_ADDRESS \
    "withdrawProfit(address,uint256)" \
    $TOKEN_ADDRESS $AMOUNT \
    --private-key $PRIVATE_KEY
  ```

### Monthly Checks

- [ ] **Comprehensive security review**
  - Review all transactions
  - Check for anomalies
  - Verify no unauthorized access

- [ ] **Performance analysis**
  - Compare to targets
  - Identify improvement areas
  - Backtest strategy changes

- [ ] **Update dependencies**
  ```bash
  cd contracts && forge update
  cd ../eliza-agent && npm update
  ```

- [ ] **Backup critical data**
  - Execution logs
  - Performance metrics
  - Configuration files

## Emergency Response Checklist

### If Circuit Breaker Triggers

1. [ ] **Don't panic** - this is designed protection
2. [ ] **Review logs** for trigger reason
3. [ ] **Analyze what happened**
   - Market volatility?
   - Bad parameters?
   - Competition increased?
4. [ ] **Decide action**
   - Adjust parameters?
   - Unpause and continue?
   - Withdraw and reassess?

### If Unexpected Loss

1. [ ] **Pause immediately**
   ```bash
   cast send $MEV_EXECUTOR_ADDRESS "emergencyPause()"
   ```

2. [ ] **Review transaction on PolygonScan**
   - What went wrong?
   - Was it frontrun?
   - Price manipulation?

3. [ ] **Analyze impact**
   - How much lost?
   - Can it happen again?
   - Need code changes?

4. [ ] **Take corrective action**
   - Fix vulnerability
   - Adjust parameters
   - Redeploy if needed

### If Suspicious Activity

1. [ ] **Pause contract immediately**
2. [ ] **Initiate emergency withdrawal**
   ```bash
   cast send $MEV_EXECUTOR_ADDRESS "initiateEmergencyWithdrawal()"
   ```
3. [ ] **Wait 24 hours for timelock**
4. [ ] **Execute withdrawal**
5. [ ] **Investigate thoroughly**
6. [ ] **Consider security audit**

## Risk Acknowledgment

By deploying this system, I acknowledge:

- [ ] **Smart contract risk**: Bugs could lead to loss of funds
- [ ] **Competition risk**: MEV is highly competitive
- [ ] **Gas risk**: Failed transactions still cost gas
- [ ] **Market risk**: Volatility can cause losses
- [ ] **Technical risk**: Infrastructure failures possible
- [ ] **Regulatory risk**: Laws may change

I have:

- [ ] Read and understood all documentation
- [ ] Tested thoroughly on small amounts
- [ ] Set appropriate risk limits
- [ ] Secured private keys properly
- [ ] Prepared emergency procedures

**Signature**: ____________________

**Date**: ____________________

---

**This checklist should be reviewed and completed before each major deployment or capital increase.**
