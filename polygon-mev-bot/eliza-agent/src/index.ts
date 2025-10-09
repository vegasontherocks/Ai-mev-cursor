import { config } from 'dotenv';
import { ethers } from 'ethers';
import { startMempoolMonitor } from './services/mempoolMonitor';
import { startOpportunityAnalyzer } from './services/opportunityAnalyzer';
import { logger } from './utils/logger';

config();

interface AgentConfig {
  rpcUrl: string;
  wssUrl: string;
  mevExecutorAddress: string;
  privateKey: string;
  minProfitThreshold: string;
}

class MEVHunterAgent {
  private provider: ethers.providers.JsonRpcProvider;
  private wsProvider: ethers.providers.WebSocketProvider;
  private wallet: ethers.Wallet;
  private config: AgentConfig;

  constructor() {
    this.config = {
      rpcUrl: process.env.POLYGON_RPC_URL!,
      wssUrl: process.env.POLYGON_WSS_URL!,
      mevExecutorAddress: process.env.MEV_EXECUTOR_ADDRESS!,
      privateKey: process.env.PRIVATE_KEY!,
      minProfitThreshold: process.env.MIN_PROFIT_THRESHOLD || '0.01',
    };

    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);
    this.wsProvider = new ethers.providers.WebSocketProvider(this.config.wssUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
  }

  async start() {
    logger.info('🚀 Starting Polygon MEV Hunter Agent...');

    // Verify connection
    const network = await this.provider.getNetwork();
    logger.info(`📡 Connected to network: ${network.name} (chainId: ${network.chainId})`);

    // Check wallet balance
    const balance = await this.wallet.getBalance();
    logger.info(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} MATIC`);

    if (!this.config.mevExecutorAddress) {
      logger.warn('⚠️  MEV_EXECUTOR_ADDRESS not set. Please deploy the contract first.');
      logger.info('Run: cd contracts && forge script script/Deploy.s.sol --broadcast');
      return;
    }

    // Verify executor contract
    const code = await this.provider.getCode(this.config.mevExecutorAddress);
    if (code === '0x') {
      logger.error('❌ MEVExecutor contract not found at specified address');
      return;
    }

    logger.info(`✅ MEVExecutor contract verified at: ${this.config.mevExecutorAddress}`);

    // Start services
    logger.info('🔍 Starting mempool monitor...');
    await startMempoolMonitor(this.wsProvider, this.config);

    logger.info('🧠 Starting opportunity analyzer...');
    await startOpportunityAnalyzer(this.provider, this.wallet, this.config);

    logger.info('✅ MEV Hunter Agent is running');
    logger.info('📊 Monitoring for arbitrage, liquidation, and JIT opportunities...');
  }

  async stop() {
    logger.info('🛑 Stopping MEV Hunter Agent...');
    this.wsProvider.removeAllListeners();
    await this.wsProvider.destroy();
    logger.info('✅ Agent stopped');
  }
}

// Main execution
async function main() {
  const agent = new MEVHunterAgent();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await agent.stop();
    process.exit(0);
  });

  try {
    await agent.start();
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
