import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { elizaLogger } from "@ai16z/eliza";
import NebulaContractWriter from "../services/nebulaContractWriter.js";
import { getNebulaClient } from "../thirdweb-nebula-integration.js";

function loadEnv() {
  const candidatePaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
    resolve(process.cwd(), "..", "..", ".env")
  ];

  let loaded = false;
  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) {
      config({ path: envPath });
  elizaLogger.info(`Loaded environment variables from ${envPath}`);
      loaded = true;
      break;
    }
  }

  if (!loaded) {
    config();
  elizaLogger.warn("No .env file found in expected locations; relying on existing process environment");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  loadEnv();

  const secretKey = requireEnv("THIRDWEB_SECRET_KEY");
  const clientId = process.env.THIRDWEB_CLIENT_ID || "";
  const privateKey = requireEnv("PRIVATE_KEY");
  const chainId = Number(process.env.POLYGON_CHAIN_ID || process.env.CHAIN_ID || "137");
  const mevExecutorAddress = process.env.MEV_EXECUTOR_ADDRESS || "0x0000000000000000000000000000000000000000";

  getNebulaClient({
    secretKey,
    clientId,
    privateKey,
    chainId,
    mevExecutorAddress
  });

  const writer = new NebulaContractWriter({} as any);

  const specification = `Generate a production-grade MEV Executor smart contract for Polygon with COMPLETE implementation.

Contract Name: MEVExecutor
Solidity Version: 0.8.20

REQUIREMENTS:

1. FLASH LOAN INTEGRATION (Balancer V2)
   - Implement IFlashLoanRecipient interface
   - receiveFlashLoan callback with full logic
   - Support multi-token flash loans
   - Zero-fee borrowing from Balancer Vault (0xBA12222222228d8Ba445958a75a0704d566BF2C8)

2. ARBITRAGE STRATEGY
   - Multi-DEX swap execution (Uniswap V2/V3, SushiSwap, QuickSwap)
   - Optimal routing algorithm
   - Price comparison logic
   - Slippage protection
   - Gas-optimized swaps using assembly where beneficial
   - Support for:
  * Direct swaps (tokenA -> tokenB)
  * Multi-hop swaps (tokenA -> WMATIC -> tokenB)
  * Complex routes (3+ hops)

3. JIT LIQUIDITY STRATEGY
   - Uniswap V3 position management
   - Optimal tick range calculation
   - Liquidity provision and removal in same transaction
   - Fee collection logic
   - Frontrun and backrun execution

4. LIQUIDATION STRATEGY
   - Aave V3 integration (Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD)
   - Health factor calculation
   - Liquidation call implementation
   - Collateral to debt swap logic
   - Profit extraction

5. CIRCUIT BREAKERS & RISK MANAGEMENT
   - Per-transaction profit threshold
   - Maximum loss limits
   - Daily loss accumulator with auto-reset
   - Drawdown-based auto-pause
   - Emergency pause mechanism
   - Timelock withdrawal (24 hours)

6. KELLY CRITERION POSITION SIZING
   - Win rate tracking
   - Average win/loss calculation
   - Fractional Kelly implementation
   - Dynamic position sizing

7. ORACLE INTEGRATION
   - Chainlink price feed validation
   - TWAP vs spot price comparison
   - Maximum deviation checks (0.5%)
   - Stale data protection

8. GAS OPTIMIZATION
   - Assembly for critical paths
   - Minimal storage reads/writes
   - Efficient loops
   - Batch operations
   - Target: <200k gas per arbitrage execution

9. SECURITY
   - ReentrancyGuard on all external calls
   - Ownable with 2-step transfer
   - Safe ERC20 operations
   - Input validation
   - Integer overflow protection
   - Emergency controls

10. EVENTS & LOGGING
   - Strategy execution events
   - Profit/loss tracking
   - Circuit breaker triggers
   - All state changes

Include:
- Complete interfaces (IUniswapV2Router, IUniswapV3Router, IAavePool, etc.)
- Full function implementations (no TODOs or placeholders)
- Inline comments explaining complex logic
- NatSpec documentation
- All helper functions needed

Generate COMPLETE, PRODUCTION-READY code that can be deployed immediately.
Return ONLY the Solidity code, no explanations.`;

  elizaLogger.info("Requesting Nebula to generate MEVExecutor.sol...");
  const result = await writer.generate({
    prompt: specification,
    contractName: "MEVExecutor",
    outputPath: "../contracts/src/generated/MEVExecutor.sol",
    temperature: 0.1,
    maxTokens: 8000
  });

  elizaLogger.success(`Nebula generated MEVExecutor at ${result.outputPath}`);
  elizaLogger.info(`Latency: ${result.latency}ms`);
}

main().catch((error) => {
  elizaLogger.error("Nebula contract generation failed", error);
  console.error(error);
  process.exit(1);
});
