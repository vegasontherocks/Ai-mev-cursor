import { IAgentRuntime, elizaLogger } from "@ai16z/eliza";
import { BigNumber, ethers } from "ethers";
import { EventEmitter } from "events";
import type { ArbitrageCandidate, DexConfig, DexQuote, DexType, TokenConfig } from "../types/mev.js";
import DirectRpcQuoteAdapter from "../adapters/DirectRpcQuoteAdapter.js";
import ThirdwebQuoteAdapter from "../adapters/ThirdwebQuoteAdapter.js";
import type IQuoteAdapter from "../adapters/QuoteAdapter.js";

const UNISWAP_V3_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_V2_FEE_BPS = 30; // 0.30%
const MIN_REEMIT_INTERVAL_MS = 30_000;

export class OpportunityDetector extends EventEmitter {
  private runtime: IAgentRuntime;
  private settings: any;
  private provider: ethers.providers.JsonRpcProvider;
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private lastEmitted: Map<string, number> = new Map();
  private dexes: DexConfig[] = [];
  private tokens: TokenConfig[] = [];
  private adapter: IQuoteAdapter;
  private readonly minProfitThreshold: number;
  private readonly maxPositionSize: number;
  private readonly slippageTolerance: number;

  constructor(runtime: IAgentRuntime, settings: any, adapter?: IQuoteAdapter) {
    super();
    this.runtime = runtime;
    this.settings = settings;

    this.provider = new ethers.providers.JsonRpcProvider(
      settings.blockchain.rpcUrl
    );

    // adapter selection
    if (adapter) {
      this.adapter = adapter;
    } else if (settings.mev?.useThirdwebAdapter) {
      this.adapter = new ThirdwebQuoteAdapter(this.provider);
    } else {
      this.adapter = new DirectRpcQuoteAdapter(this.provider);
    }

    this.dexes = (settings.mev?.dexes || []).map((dex: any) => ({
      ...dex,
      type: this.classifyDex(dex)
    }));

    this.tokens = (settings.mev?.tokens || []).map((token: any) => ({
      symbol: token.symbol,
      address: ethers.utils.getAddress(token.address),
      decimals: token.decimals
    }));

    this.minProfitThreshold = Number(settings.mev?.minProfitThreshold ?? 0.01);
    this.maxPositionSize = Number(settings.mev?.maxPositionSize ?? 1);
    this.slippageTolerance = Number(settings.mev?.slippageTolerance ?? 0.005);
  }

  async start() {
    elizaLogger.info("🎯 Starting opportunity detector...");

    this.isRunning = true;

    try {
      elizaLogger.info(`Quote adapter: ${this.adapter?.name ? this.adapter.name() : 'direct-rpc'}`);
    } catch { }

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
    if (!this.settings.mev?.strategies?.ARBITRAGE?.enabled) {
      return;
    }

    elizaLogger.debug("🔍 Scanning for arbitrage loops...");

    const now = Date.now();
    for (const dex of this.dexes) {
      for (const flashToken of this.tokens) {
        for (const targetToken of this.tokens) {
          if (flashToken.address === targetToken.address) continue;

          try {
            const quote = await this.evaluateLoop(dex, flashToken, targetToken);
            if (!quote) continue;

            const spread = quote.price - 1;
            if (spread < this.minProfitThreshold) continue;

            const candidate: ArbitrageCandidate = {
              id: `${dex.name}:${flashToken.address}:${targetToken.address}`,
              flashToken,
              targetToken,
              quote,
              spread,
              expectedProfit: spread,
              timestamp: now
            };

            if (!this.shouldEmit(candidate)) {
              continue;
            }

            elizaLogger.info(
              `🎯 Arbitrage loop on ${dex.name}: borrow ${flashToken.symbol}, swap through ${targetToken.symbol}, expected multiplier ${(quote.price).toFixed(4)} (spread ${(spread * 100).toFixed(2)}%)`
            );

            this.emit("opportunity", candidate);
          } catch (error) {
            // ignore
          }
        }
      }
    }
  }

  private classifyDex(dex: any): DexType {
    const name = (dex?.name || "").toLowerCase();
    if (name.includes("v3")) {
      return "uniswap_v3";
    }

    return "uniswap_v2";
  }

  private async evaluateLoop(dex: DexConfig, flashToken: TokenConfig, targetToken: TokenConfig): Promise<DexQuote | null> {
    try {
      const amountIn = this.sampleAmount(flashToken.decimals);

      if (dex.type === "uniswap_v3") {
        const amountOut1 = await this.adapter.getUniswapV3Quote(UNISWAP_V3_QUOTER, flashToken.address, targetToken.address, amountIn);
        if (!amountOut1 || amountOut1.isZero()) return null;

        const amountOut2 = await this.adapter.getUniswapV3Quote(UNISWAP_V3_QUOTER, targetToken.address, flashToken.address, amountOut1);
        if (!amountOut2 || amountOut2.isZero()) return null;

        if (amountOut2.lte(amountIn)) return null;

        const amountInFloat = parseFloat(ethers.utils.formatUnits(amountIn, flashToken.decimals));
        const amountOutFloat = parseFloat(ethers.utils.formatUnits(amountOut2, flashToken.decimals));
        const priceMultiplier = amountOutFloat / amountInFloat;

        return {
          dex,
          routeType: "uniswap_v3",
          router: dex.router,
          quoter: UNISWAP_V3_QUOTER,
          tokens: [flashToken.address, targetToken.address, flashToken.address],
          fees: [DEFAULT_V2_FEE_BPS, DEFAULT_V2_FEE_BPS],
          price: priceMultiplier,
          amountOut: amountOut2
        };
      }

      const amounts: BigNumber[] = await this.adapter.getAmountsOut(dex.router, amountIn, [
        flashToken.address,
        targetToken.address,
        flashToken.address
      ]);

      const finalAmount = amounts[amounts.length - 1];
      if (finalAmount.lte(amountIn)) return null;

      const amountInFloat = parseFloat(ethers.utils.formatUnits(amountIn, flashToken.decimals));
      const amountOutFloat = parseFloat(ethers.utils.formatUnits(finalAmount, flashToken.decimals));
      const price = amountOutFloat / amountInFloat;

      return {
        dex,
        routeType: "uniswap_v2",
        router: dex.router,
        quoter: ZERO_ADDRESS,
        tokens: [flashToken.address, targetToken.address, flashToken.address],
        fees: [DEFAULT_V2_FEE_BPS, DEFAULT_V2_FEE_BPS],
        price,
        amountOut: finalAmount
      };
    } catch (error) {
      return null;
    }
  }

  private sampleAmount(decimals: number): BigNumber {
    // use 25% of max position size for probing to keep calls cheap
    const base = Math.max(this.maxPositionSize * 0.25, 0.01);
    return ethers.utils.parseUnits(base.toFixed(decimals > 6 ? 6 : decimals), decimals);
  }

  private async getUniswapV3Quote(
    tokenIn: TokenConfig,
    tokenOut: TokenConfig,
    amountIn: BigNumber,
    preferredFee?: number
  ): Promise<{ amountOut: BigNumber; fee: number } | null> {
    const feeTiers = preferredFee ? [preferredFee] : [500, 1000, 3000, 10000];

    const quoter = new ethers.Contract(
      UNISWAP_V3_QUOTER,
      [
        "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
      ],
      this.provider
    );

    let best: { amountOut: BigNumber; fee: number } | null = null;
    for (const fee of feeTiers) {
      try {
        const amountOut: BigNumber = await quoter.callStatic.quoteExactInputSingle(
          tokenIn.address,
          tokenOut.address,
          fee,
          amountIn,
          0
        );

        if (!best || amountOut.gt(best.amountOut)) {
          best = { amountOut, fee };
        }
      } catch {
        // ignore failures for a given fee tier
      }
    }

    return best;
  }

  private shouldEmit(candidate: ArbitrageCandidate): boolean {
    const key = candidate.id;
    const now = Date.now();
    const last = this.lastEmitted.get(key) || 0;

    if (now - last < MIN_REEMIT_INTERVAL_MS) {
      return false;
    }

    this.lastEmitted.set(key, now);
    return true;
  }
}
