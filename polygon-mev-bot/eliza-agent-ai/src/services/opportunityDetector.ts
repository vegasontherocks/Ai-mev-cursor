import { IAgentRuntime, elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";

export class OpportunityDetector {
  private runtime: IAgentRuntime;
  private settings: any;
  private provider: ethers.providers.JsonRpcProvider;
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  
  constructor(runtime: IAgentRuntime, settings: any) {
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
    const tokens = this.settings.mev.tokens;
    const dexes = this.settings.mev.dexes;
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i];
        const tokenB = tokens[j];
        
        // Get prices from all DEXs
        const prices = await Promise.all(
          dexes.map((dex: any) => 
            this.getPrice(dex.router, tokenA.address, tokenB.address)
          )
        );
        
        // Find price deviation
        const maxPrice = Math.max(...prices.filter(p => p > 0));
        const minPrice = Math.min(...prices.filter(p => p > 0));
        
        if (minPrice === 0 || maxPrice === 0) continue;
        
        const priceDiff = (maxPrice - minPrice) / minPrice;
        
        // Check if profitable
        if (priceDiff > strategies.ARBITRAGE.minPriceDiff) {
          elizaLogger.info(`🎯 Arbitrage opportunity: ${tokenA.symbol}/${tokenB.symbol} - ${(priceDiff * 100).toFixed(2)}% spread`);
          
          // This would emit to BlockchainMonitor or directly trigger analysis
          // For now, just log
        }
      }
    }
  }
  
  private async getPrice(router: string, tokenA: string, tokenB: string): Promise<number> {
    try {
      const routerContract = new ethers.Contract(
        router,
        [
          "function getAmountsOut(uint amountIn, address[] path) view returns (uint[])"
        ],
        this.provider
      );
      
      const amountIn = ethers.utils.parseEther("1");
      const path = [tokenA, tokenB];
      
      const amounts = await routerContract.getAmountsOut(amountIn, path);
      return parseFloat(ethers.utils.formatEther(amounts[1]));
    } catch (error) {
      return 0;
    }
  }
}
