import { IAgentRuntime, elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import { EventEmitter } from "events";

export class BlockchainMonitor extends EventEmitter {
  private runtime: IAgentRuntime;
  private settings: any;
  private provider: ethers.providers.WebSocketProvider;
  private isRunning: boolean = false;
  
  constructor(runtime: IAgentRuntime, settings: any) {
    super();
    this.runtime = runtime;
    this.settings = settings;
    
    this.provider = new ethers.providers.WebSocketProvider(
      settings.blockchain.wssUrl
    );
  }
  
  async start() {
    elizaLogger.info("🔍 Starting blockchain monitor...");
    
    this.isRunning = true;
    
    // Monitor pending transactions
    this.provider.on("pending", async (txHash: string) => {
      if (!this.isRunning) return;
      
      try {
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;
        
        // Filter for DEX transactions
        const targetDEXs = this.settings.mev.dexes.map((d: any) => d.router.toLowerCase());
        if (!tx.to || !targetDEXs.includes(tx.to.toLowerCase())) {
          return;
        }
        
        // Parse transaction for opportunity
        const opportunity = await this.parseTransaction(tx);
        if (opportunity) {
          this.emit("opportunity", opportunity);
        }
      } catch (error) {
        // Silently ignore - many txs will fail to fetch
      }
    });
    
    // Monitor new blocks
    this.provider.on("block", async (blockNumber: number) => {
      if (!this.isRunning) return;
      
      elizaLogger.debug(`New block: ${blockNumber}`);
      
      // Check for liquidation opportunities
      await this.scanForLiquidations(blockNumber);
    });
    
    elizaLogger.success("✅ Blockchain monitor active");
  }
  
  async stop() {
    elizaLogger.info("🛑 Stopping blockchain monitor...");
    this.isRunning = false;
    this.provider.removeAllListeners();
    await this.provider.destroy();
  }
  
  private async parseTransaction(tx: ethers.providers.TransactionResponse): Promise<any | null> {
    // Parse DEX swap transactions
    const swapSignatures = [
      "0x38ed1739", // swapExactTokensForTokens
      "0x8803dbee", // swapTokensForExactTokens
      "0x414bf389"  // exactInputSingle (Uniswap V3)
    ];
    
    const methodId = tx.data.slice(0, 10);
    if (!swapSignatures.includes(methodId)) {
      return null;
    }
    
    // Check if swap is large enough
    const value = parseFloat(ethers.utils.formatEther(tx.value || "0"));
    if (value < 0.5) return null; // Minimum 0.5 MATIC
    
    return {
      type: "ARBITRAGE",
      txHash: tx.hash,
      dex: tx.to,
      value,
      gasPrice: tx.gasPrice ? parseFloat(ethers.utils.formatUnits(tx.gasPrice, "gwei")) : 150,
      timestamp: Date.now()
    };
  }
  
  private async scanForLiquidations(blockNumber: number) {
    // Would scan Aave V3 for underwater positions
    // Simplified for now
  }
}
