#!/usr/bin/env ts-node

/**
 * SMART CONTRACT GENERATION USING THIRDWEB NEBULA
 * 
 * This script uses Thirdweb Nebula (blockchain-trained LLM) to generate
 * production-grade MEV smart contracts with COMPLETE logic.
 * 
 * Nebula knows:
 * - Balancer V2/V3 flash loan patterns
 * - Uniswap V2/V3 swap logic
 * - Aave V3 liquidation mechanics
 * - Gas optimization techniques
 * - Security best practices
 */

import { ThirdwebSDK } from "@thirdweb-dev/sdk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

console.log("Starting Nebula contract generator script...");

const candidateEnvPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
  resolve(process.cwd(), "..", "..", ".env")
];

let envLoaded = false;
for (const envPath of candidateEnvPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    console.log(`🔐 Loaded environment variables from ${envPath}`);
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  config();
  console.warn("⚠️  No .env file found in expected locations; relying on process environment variables");
}

const REQUIRED_CONTRACT_NAMES = [
  "Interfaces.sol",
  "OracleLib.sol",
  "DEXAdapter.sol",
  "AaveAdapter.sol",
  "JITAdapter.sol",
  "MEVExecutor.sol"
] as const;

interface GeneratedContract {
  name: string;
  code: string;
  description: string;
}

class NebulaContractGenerator {
  private sdk: ThirdwebSDK;
  
  constructor() {
    const requiredEnv = ["PRIVATE_KEY", "THIRDWEB_SECRET_KEY", "THIRDWEB_CLIENT_ID"];
    for (const key of requiredEnv) {
      if (!process.env[key] || process.env[key]!.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }

    try {
      this.sdk = ThirdwebSDK.fromPrivateKey(
        process.env.PRIVATE_KEY!,
        137, // Polygon
        {
          secretKey: process.env.THIRDWEB_SECRET_KEY!,
          clientId: process.env.THIRDWEB_CLIENT_ID!
        }
      );
    } catch (error) {
      console.error("❌ Failed to initialize Thirdweb SDK", error);
      throw error;
    }
    
    console.log("✅ Connected to Thirdweb Nebula (blockchain LLM)");
  }
  
  /**
   * Ask Nebula to generate main MEV executor contract
   */
  async generateMEVExecutor(): Promise<GeneratedContract> {
    console.log("\n🔮 Asking Nebula to generate MEVExecutor.sol...");
    
    const prompt = `
Generate a production-grade MEV Executor smart contract for Polygon with COMPLETE implementation.

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
     * Direct swaps (tokenA → tokenB)
     * Multi-hop swaps (tokenA → WMATIC → tokenB)
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
Include ALL logic for flash loans, swaps, liquidations, and risk management.

Return ONLY the Solidity code, no explanations.
`;

    try {
      const response = await this.callNebula(prompt, {
        temperature: 0.1, // Low temperature for precise code
        maxTokens: 8000
      });
      
      return {
        name: "MEVExecutor.sol",
        code: this.extractSolidityCode(response),
        description: "Main MEV execution contract with flash loans, arbitrage, JIT, and liquidation strategies"
      };
    } catch (error) {
      console.error("❌ Nebula generation failed:", error);
      throw error;
    }
  }
  
  /**
   * Generate DEX adapter library
   */
  async generateDEXAdapter(): Promise<GeneratedContract> {
    console.log("\n🔮 Asking Nebula to generate DEXAdapter.sol...");
    
    const prompt = `
Generate a DEX adapter library for Polygon MEV operations.

Contract Name: DEXAdapter
Type: Library
Solidity Version: 0.8.20

REQUIREMENTS:

1. UNISWAP V2 INTEGRATION
   - getAmountOut calculation with fees
   - swapExactTokensForTokens wrapper
   - Optimal path finding
   - Support for: QuickSwap, SushiSwap

2. UNISWAP V3 INTEGRATION
   - exactInputSingle implementation
   - exactInput for multi-hop
   - Pool fee tier selection (0.05%, 0.3%, 1%)
   - Quoter integration for price discovery
   - Tick math for price calculations

3. PRICE COMPARISON
   - Compare prices across all DEXs
   - Find best route for arbitrage
   - Calculate expected output
   - Account for gas costs

4. GAS OPTIMIZATION
   - Minimal external calls
   - Efficient price calculations
   - Batch operations where possible

5. ROUTER ADDRESSES (Polygon mainnet)
   - QuickSwap: 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff
   - SushiSwap: 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506
   - Uniswap V3: 0xE592427A0AEce92De3Edee1F18E0157C05861564
   - Uniswap V3 Quoter: 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6

Generate COMPLETE implementation with all swap logic, price calculations,
and gas optimizations. No placeholders or TODOs.

Return ONLY the Solidity code.
`;

    const response = await this.callNebula(prompt, {
      temperature: 0.1,
      maxTokens: 6000
    });
    
    return {
      name: "DEXAdapter.sol",
      code: this.extractSolidityCode(response),
      description: "Library for interacting with multiple DEXs (Uniswap V2/V3, SushiSwap, QuickSwap)"
    };
  }
  
  /**
   * Generate Aave V3 liquidation library
   */
  async generateAaveAdapter(): Promise<GeneratedContract> {
    console.log("\n🔮 Asking Nebula to generate AaveAdapter.sol...");
    
    const prompt = `
Generate an Aave V3 adapter library for liquidation operations on Polygon.

Contract Name: AaveAdapter
Type: Library
Solidity Version: 0.8.20

REQUIREMENTS:

1. AAVE V3 INTEGRATION
   - Pool address: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
   - PoolDataProvider: 0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654
   - PriceOracle: 0xb023e699F5a33916Ea823A16485e259257cA8Bd1

2. LIQUIDATION LOGIC
   - getUserAccountData implementation
   - Health factor calculation
   - Liquidation threshold checks
   - liquidationCall wrapper
   - Liquidation bonus calculation (typically 5%)
   - Maximum liquidatable amount calculation

3. POSITION SCANNING
   - Find underwater positions efficiently
   - Calculate profitability after gas
   - Sort by liquidation value
   - Filter by minimum profit threshold

4. COLLATERAL HANDLING
   - Receive aTokens after liquidation
   - Unwrap to underlying tokens
   - Optimal swap routing to repay debt

5. PROFITABILITY CHECKS
   - Calculate liquidation bonus in USD
   - Estimate gas costs
   - Ensure profit > (gas_cost * safety_multiplier)
   - Account for slippage on collateral swap

Generate COMPLETE implementation with all Aave V3 interfaces,
liquidation logic, and profitability calculations.

Return ONLY the Solidity code.
`;

    const response = await this.callNebula(prompt, {
      temperature: 0.1,
      maxTokens: 5000
    });
    
    return {
      name: "AaveAdapter.sol",
      code: this.extractSolidityCode(response),
      description: "Library for Aave V3 liquidations with profitability checks"
    };
  }
  
  /**
   * Generate Uniswap V3 JIT library
   */
  async generateJITAdapter(): Promise<GeneratedContract> {
    console.log("\n🔮 Asking Nebula to generate JITAdapter.sol...");
    
    const prompt = `
Generate a Uniswap V3 JIT (Just-In-Time) liquidity library for Polygon.

Contract Name: JITAdapter
Type: Library
Solidity Version: 0.8.20

REQUIREMENTS:

1. UNISWAP V3 INTEGRATION
   - NonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88
   - SwapRouter: 0xE592427A0AEce92De3Edee1F18E0157C05861564
   - Pool interface for tick/liquidity queries

2. JIT STRATEGY LOGIC
   - Calculate optimal tick range based on:
     * Current pool price
     * Expected swap size
     * Pool fee tier
     * Volatility estimate
   - Mint position (add liquidity)
   - Collect fees after target swap executes
   - Burn position (remove liquidity)
   - All in atomic transaction

3. TICK CALCULATIONS
   - Current tick from pool
   - Tick spacing for fee tier
   - Upper and lower tick bounds
   - Liquidity amount calculation
   - Expected fee capture estimation

4. FEE OPTIMIZATION
   - Target: capture >80% of swap fees
   - Narrow range for concentrated liquidity
   - Account for tick spacing constraints
   - Gas efficiency vs fee capture tradeoff

5. POSITION MANAGEMENT
   - MintParams struct construction
   - CollectParams for fee collection
   - DecreaseLiquidityParams for exit
   - Optimal token ratios for range

6. SAFETY CHECKS
   - Slippage protection on mint
   - Minimum fee threshold
   - Maximum price movement limits
   - Deadline enforcement

Generate COMPLETE implementation with all Uniswap V3 position logic,
tick calculations, and fee collection mechanisms.

Return ONLY the Solidity code.
`;

    const response = await this.callNebula(prompt, {
      temperature: 0.1,
      maxTokens: 6000
    });
    
    return {
      name: "JITAdapter.sol",
      code: this.extractSolidityCode(response),
      description: "Library for Uniswap V3 JIT liquidity provision"
    };
  }
  
  /**
   * Generate Oracle validation library
   */
  async generateOracleLib(): Promise<GeneratedContract> {
    console.log("\n🔮 Asking Nebula to generate OracleLib.sol...");
    
    const prompt = `
Generate a Chainlink oracle validation library for Polygon MEV protection.

Contract Name: OracleLib
Type: Library
Solidity Version: 0.8.20

REQUIREMENTS:

1. CHAINLINK INTEGRATION
   - AggregatorV3Interface for price feeds
   - Key oracles on Polygon:
     * MATIC/USD: 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
     * USDC/USD: 0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7
     * ETH/USD: 0xF9680D99D6C9589e2a93a78A04A279e509205945
     * BTC/USD: 0xc907E116054Ad103354f2D350FD2514433D57F6f

2. TWAP VALIDATION
   - Get latest price from oracle
   - Check staleness (max 1 hour old)
   - Calculate deviation from DEX spot price
   - Maximum allowed deviation: 0.5% (50 basis points)
   - Revert if deviation too high (price manipulation)

3. PRICE CONVERSIONS
   - Handle different decimals (6, 8, 18)
   - Normalize all prices to 18 decimals
   - Token pair price calculation
   - USD value calculations

4. SAFETY CHECKS
   - Validate price > 0
   - Check round completeness
   - Ensure updatedAt is recent
   - AnsweredInRound validation
   - Circuit breaker for oracle failures

5. GAS EFFICIENCY
   - Cache oracle results (5 second TTL)
   - Batch oracle queries
   - Minimize storage reads

Generate COMPLETE implementation with all oracle validation,
TWAP protection, and price manipulation prevention logic.

Return ONLY the Solidity code.
`;

    const response = await this.callNebula(prompt, {
      temperature: 0.1,
      maxTokens: 4000
    });
    
    return {
      name: "OracleLib.sol",
      code: this.extractSolidityCode(response),
      description: "Library for Chainlink oracle validation and TWAP protection"
    };
  }
  
  /**
   * Generate all interfaces needed
   */
  async generateInterfaces(): Promise<GeneratedContract> {
    console.log("\n🔮 Asking Nebula to generate Interfaces.sol...");
    
    const prompt = `
Generate a comprehensive interfaces file for Polygon MEV operations.

File Name: Interfaces.sol
Solidity Version: 0.8.20

REQUIREMENTS:

Include COMPLETE interfaces for:

1. BALANCER V2
   - IVault (flash loans, swaps)
   - IFlashLoanRecipient
   - IAsset

2. UNISWAP V2 STYLE (QuickSwap, SushiSwap)
   - IUniswapV2Router02
   - IUniswapV2Factory
   - IUniswapV2Pair

3. UNISWAP V3
   - ISwapRouter
   - IQuoter
   - IUniswapV3Pool
   - IUniswapV3Factory
   - INonfungiblePositionManager

4. AAVE V3
   - IPool (lending, liquidations)
   - IPoolDataProvider
   - IPriceOracleGetter

5. CHAINLINK
   - AggregatorV3Interface

6. ERC20
   - IERC20
   - IERC20Metadata

Generate ALL functions for each interface - no incomplete interfaces.
Use exact function signatures from mainnet deployments.

Return ONLY the Solidity code with all interfaces.
`;

    const response = await this.callNebula(prompt, {
      temperature: 0.1,
      maxTokens: 8000
    });
    
    return {
      name: "Interfaces.sol",
      code: this.extractSolidityCode(response),
      description: "Complete interfaces for all protocols (Balancer, Uniswap, Aave, Chainlink)"
    };
  }
  
  /**
   * Call Thirdweb Nebula blockchain LLM
   */
  private async callNebula(prompt: string, options: {
    temperature?: number;
    maxTokens?: number;
  } = {}): Promise<string> {
    console.log("   📡 Calling Thirdweb Nebula (blockchain LLM)...");
    
    try {
      // Call Nebula through Thirdweb SDK
      const wallet = (this.sdk as any).wallet;
      if (!wallet || typeof wallet.call !== "function") {
        throw new Error("Thirdweb SDK wallet call() method unavailable. Ensure SDK version supports nebula_generate.");
      }

      const response = await wallet.call({
        method: "nebula_generate",
        params: [{
          prompt,
          temperature: options.temperature || 0.1,
          maxTokens: options.maxTokens || 4000,
          model: "nebula-t1", // Thirdweb's blockchain model
          task: "code_generation"
        }]
      });
      
      console.log("   ✅ Nebula response received");
      
      return response;
      
    } catch (error) {
      console.error("   ❌ Nebula call failed:", error);
      
      // Fallback: Use alternative method
      console.log("   🔄 Trying alternative Nebula endpoint...");
      
      const fallbackResponse = await fetch("https://nebula.thirdweb.com/v1/generate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.THIRDWEB_SECRET_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt,
          ...options,
          model: "nebula-t1"
        })
      });
      
      const data = await fallbackResponse.json();
      return data.code || data.response || data.text;
    }
  }
  
  /**
   * Extract Solidity code from Nebula response
   */
  private extractSolidityCode(response: string): string {
    // Remove markdown code blocks if present
    let code = response;
    
    if (code.includes("```solidity")) {
      code = code.split("```solidity")[1].split("```")[0];
    } else if (code.includes("```")) {
      code = code.split("```")[1].split("```")[0];
    }
    
    return code.trim();
  }
  
  /**
   * Save contract to file
   */
  private saveContract(contract: GeneratedContract, dir: string = "contracts/src") {
    const path = `${dir}/${contract.name}`;
    writeFileSync(path, contract.code);
    console.log(`✅ Saved: ${path}`);
    console.log(`   ${contract.description}`);
  }

  /**
   * Ensure Nebula outputs contain real Solidity sources
   */
  private validateGeneratedArtifacts(contracts: GeneratedContract[]) {
    const seen = new Set<string>();
    for (const contract of contracts) {
      if (!contract.code || contract.code.trim().length === 0) {
        throw new Error(`Nebula returned empty code for ${contract.name}`);
      }

      if (!/pragma\s+solidity/i.test(contract.code)) {
        throw new Error(`Missing Solidity pragma in ${contract.name}`);
      }

      if (!/(contract|library|interface)\s+\w+/.test(contract.code)) {
        throw new Error(`No contract, library, or interface declaration found in ${contract.name}`);
      }

      seen.add(contract.name);
    }

    for (const required of REQUIRED_CONTRACT_NAMES) {
      if (!seen.has(required)) {
        throw new Error(`Nebula did not return required artifact: ${required}`);
      }
    }
  }
  
  /**
   * Generate all contracts
   */
  async generateAll() {
    console.log("╔════════════════════════════════════════════════════════════════╗");
    console.log("║  GENERATING MEV SMART CONTRACTS WITH THIRDWEB NEBULA         ║");
    console.log("║  (Blockchain-trained LLM with 1B+ transactions)               ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    
    try {
      // Create directory
      mkdirSync("contracts/src/generated", { recursive: true });
      
      // Generate all contracts using Nebula
      const contracts = await Promise.all([
        this.generateInterfaces(),
        this.generateOracleLib(),
        this.generateDEXAdapter(),
        this.generateAaveAdapter(),
        this.generateJITAdapter(),
        this.generateMEVExecutor()
      ]);

      this.validateGeneratedArtifacts(contracts);
      
      // Save all contracts
      console.log("\n📝 Saving generated contracts...\n");
      contracts.forEach(contract => {
        this.saveContract(contract, "contracts/src/generated");
      });
      
      console.log("\n╔════════════════════════════════════════════════════════════════╗");
      console.log("║  ✅ ALL CONTRACTS GENERATED BY NEBULA!                        ║");
      console.log("╚════════════════════════════════════════════════════════════════╝");
      
      console.log("\nGenerated files:");
      contracts.forEach(c => console.log(`  - ${c.name}: ${c.description}`));
      
      console.log("\nNext steps:");
      console.log("  1. Review generated contracts in contracts/src/generated/");
      console.log("  2. Run tests: forge test");
      console.log("  3. Deploy: forge script script/Deploy.s.sol --broadcast");
      
    } catch (error) {
      console.error("\n❌ Generation failed:", error);
      process.exit(1);
    }
  }
}

// Run generator
async function main() {
  const generator = new NebulaContractGenerator();
  await generator.generateAll();
}

main().catch(console.error);
