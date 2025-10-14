import { IAgentRuntime, elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import type { BigNumber } from "ethers";
import { EventEmitter } from "events";

const UNISWAP_V3_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
}

interface DexConfig {
  name: string;
  router: string;
  factory?: string;
  priority?: number;
}

interface ArbitrageOpportunity {
  type: "ARBITRAGE";
  source: "opportunity_detector";
  tokenIn: TokenConfig;
  tokenOut: TokenConfig;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  expectedProfitTokenOut: number;
  timestamp: number;
}

export class OpportunityDetector extends EventEmitter {
  private runtime: IAgentRuntime;
  private settings: any;
  private provider: ethers.providers.JsonRpcProvider;
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private lastEmitted: Map<string, number> = new Map();
  private readonly minReemitIntervalMs = 30000;
  
  constructor(runtime: IAgentRuntime, settings: any) {
    super();
    this.runtime = runtime;
    this.settings = settings;
    
    this.provider = new ethers.providers.JsonRpcProvider(
      settings.blockchain.rpcUrl
    );
  }
  
  async start() {
    elizaLogger.info("🎯 Starting opportunity detector...");
    
    this.isRunning = true;
    
    // Scan for arbitrage opportunities every 15 seconds
    this.scanInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.scanArbitrage();
      } catch (error) {
        elizaLogger.error("Error scanning arbitrage:", error);
      }
    }, 15000);
    
    elizaLogger.success("✅ Opportunity detector active");
  }
  
  async stop() {
    elizaLogger.info("🛑 Stopping opportunity detector...");
    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
  }
  
  private async scanArbitrage() {
    const strategies = this.settings.mev.strategies;
    if (!strategies.ARBITRAGE.enabled) return;
    
    elizaLogger.debug("🔍 Scanning for arbitrage opportunities...");
    
    // Scan token pairs across DEXs
  const tokens: TokenConfig[] = this.settings.mev.tokens;
  const dexes: DexConfig[] = this.settings.mev.dexes;
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i];
        const tokenB = tokens[j];
        
        // Get prices from all DEXs
        const quotes = await Promise.all(
          dexes.map(async (dex) => {
            const price = await this.getPrice(dex, tokenA, tokenB);
            return price ? { dex, price } : null;
          })
        );

        const validQuotes = quotes.filter(
          (q): q is { dex: DexConfig; price: number } =>
            q !== null && Number.isFinite(q.price) && q.price > 0
        );

        if (validQuotes.length < 2) {
          continue;
        }

        const sortedQuotes = [...validQuotes].sort((a, b) => a.price - b.price);
        const bestBuy = sortedQuotes[0];
        const bestSell = sortedQuotes[sortedQuotes.length - 1];

        if (bestBuy.price <= 0) {
          continue;
        }

        const priceDiff = (bestSell.price - bestBuy.price) / bestBuy.price;
        
        // Check if profitable
        if (priceDiff > strategies.ARBITRAGE.minPriceDiff) {
          const opportunity: ArbitrageOpportunity = {
            type: "ARBITRAGE",
            source: "opportunity_detector",
            tokenIn: tokenA,
            tokenOut: tokenB,
            buyDex: bestBuy.dex.name,
            sellDex: bestSell.dex.name,
            buyPrice: bestBuy.price,
            sellPrice: bestSell.price,
            spread: priceDiff,
            expectedProfitTokenOut: bestSell.price - bestBuy.price,
            timestamp: Date.now()
          };

          if (this.shouldEmit(opportunity)) {
            elizaLogger.info(
              `🎯 Arbitrage: buy ${tokenA.symbol} on ${bestBuy.dex.name} at ${bestBuy.price.toFixed(6)} ${tokenB.symbol} and sell on ${bestSell.dex.name} at ${bestSell.price.toFixed(6)} (${(priceDiff * 100).toFixed(2)}% spread)`
            );

            this.emit("opportunity", opportunity);
          }
        }
      }
    }
  }
  
  private async getPrice(dex: DexConfig, tokenIn: TokenConfig, tokenOut: TokenConfig): Promise<number | null> {
    try {
      const amountIn = ethers.utils.parseUnits("1", tokenIn.decimals);

      if (dex.name.toLowerCase().includes("uniswapv3")) {
        return await this.getUniswapV3Quote(tokenIn, tokenOut, amountIn);
      }

      const routerContract = new ethers.Contract(
        dex.router,
        [
          "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory)"
        ],
        this.provider
      );

      const amounts: BigNumber[] = await routerContract.getAmountsOut(amountIn, [
        tokenIn.address,
        tokenOut.address
      ]);

      return parseFloat(ethers.utils.formatUnits(amounts[1], tokenOut.decimals));
    } catch (error) {
      return null;
    }
  }

  private async getUniswapV3Quote(tokenIn: TokenConfig, tokenOut: TokenConfig, amountIn: BigNumber): Promise<number | null> {
    const feeTiers = [500, 3000, 10000];

    const quoter = new ethers.Contract(
      UNISWAP_V3_QUOTER,
      [
        "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
      ],
      this.provider
    );

    const results = await Promise.all(
      feeTiers.map(async (fee) => {
        try {
          const amountOut: BigNumber = await quoter.callStatic.quoteExactInputSingle(
            tokenIn.address,
            tokenOut.address,
            fee,
            amountIn,
            0
          );
          return amountOut;
        } catch (error) {
          return null;
        }
      })
    );

    const successful = results.filter((value): value is BigNumber => value !== null);

    if (successful.length === 0) {
      return null;
    }

    const best = successful.reduce((max, current) => (current.gt(max) ? current : max), successful[0]);
    return parseFloat(ethers.utils.formatUnits(best, tokenOut.decimals));
  }

  private shouldEmit(opportunity: ArbitrageOpportunity): boolean {
    const key = [
      opportunity.tokenIn.address.toLowerCase(),
      opportunity.tokenOut.address.toLowerCase(),
      opportunity.buyDex.toLowerCase(),
      opportunity.sellDex.toLowerCase()
    ].join(":");

    const now = Date.now();
    const last = this.lastEmitted.get(key) || 0;

    if (now - last < this.minReemitIntervalMs) {
      return false;
    }

    this.lastEmitted.set(key, now);
    return true;
  }
}
