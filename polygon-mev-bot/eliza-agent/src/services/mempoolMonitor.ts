import { ethers } from 'ethers';
import { logger } from '../utils/logger';

interface MempoolTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  data: string;
}

const TARGET_DEXS = [
  '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap
  '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
  '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3
];

const SWAP_SIGNATURES = [
  '0x38ed1739', // swapExactTokensForTokens
  '0x8803dbee', // swapTokensForExactTokens
  '0x7ff36ab5', // swapExactETHForTokens
  '0x18cbafe5', // swapExactTokensForETH
  '0x414bf389', // exactInputSingle (Uniswap V3)
];

export async function startMempoolMonitor(
  wsProvider: ethers.providers.WebSocketProvider,
  config: any
) {
  logger.info('🔍 Mempool monitor starting...');

  // Listen to pending transactions
  wsProvider.on('pending', async (txHash: string) => {
    try {
      const tx = await wsProvider.getTransaction(txHash);

      if (!tx) return;

      // Filter for DEX transactions
      if (!tx.to || !TARGET_DEXS.includes(tx.to.toLowerCase())) {
        return;
      }

      // Check if it's a swap transaction
      const methodId = tx.data.slice(0, 10);
      if (!SWAP_SIGNATURES.includes(methodId)) {
        return;
      }

      // Estimate transaction value
      const valueInEth = parseFloat(ethers.utils.formatEther(tx.value || '0'));

      // Log large swaps (>$1000 equivalent)
      if (valueInEth > 0.5) {
        // Rough ~$500 at $1000/MATIC
        logger.opportunity(`Large swap detected:`, {
          hash: txHash,
          to: tx.to,
          value: `${valueInEth.toFixed(4)} MATIC`,
          gasPrice: ethers.utils.formatUnits(tx.gasPrice || 0, 'gwei'),
        });

        // TODO: Analyze for arbitrage opportunity
        // This would trigger the opportunity analyzer
      }
    } catch (error) {
      // Silently ignore - many pending txs will fail to fetch
      if (process.env.DEBUG === 'true') {
        logger.debug('Error fetching pending tx:', error);
      }
    }
  });

  // Monitor new blocks
  wsProvider.on('block', async (blockNumber: number) => {
    logger.debug(`New block: ${blockNumber}`);

    // TODO: Check for liquidation opportunities
    // This would scan Aave, Compound, etc. for underwater positions
  });

  logger.success('Mempool monitor active');
}
