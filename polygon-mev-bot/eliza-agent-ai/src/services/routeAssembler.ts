import { elizaLogger } from "@ai16z/eliza";
import { BigNumber, ethers } from "ethers";
import type { ArbitrageCandidate, RoutePlan } from "../types/mev.js";

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory)"
];

const V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256)"
];

export class RouteAssembler {
  private provider: ethers.providers.JsonRpcProvider;
  private minPositionSize: number;
  private maxPositionSize: number;
  private minProfitThreshold: number;
  private slippageTolerance: number;

  constructor(rpcUrl: string, settings: any) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.minPositionSize = Number(settings?.mev?.minPositionSize ?? 0.05);
    this.maxPositionSize = Number(settings?.mev?.maxPositionSize ?? 1);
    this.minProfitThreshold = Number(settings?.mev?.minProfitThreshold ?? 0.01);
    this.slippageTolerance = Number(settings?.mev?.slippageTolerance ?? 0.005);
  }

  async buildRoute(candidate: ArbitrageCandidate): Promise<RoutePlan | null> {
    const decimals = candidate.flashToken.decimals;
    const minAmount = ethers.utils.parseUnits(this.minPositionSize.toString(), decimals);
    const maxAmount = ethers.utils.parseUnits(Math.max(this.maxPositionSize, this.minPositionSize).toString(), decimals);

    let best: { amountIn: BigNumber; amountOut: BigNumber; profit: BigNumber } | null = null;

    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const ratio = i / steps;
      const amountIn = minAmount.add(maxAmount.sub(minAmount).mul(Math.floor(ratio * 1000)).div(1000));
      if (amountIn.lte(0)) continue;

      const amountOut = await this.evaluateAmount(candidate, amountIn);
      if (!amountOut || amountOut.lte(amountIn)) {
        continue;
      }

      const profit = amountOut.sub(amountIn);
      const profitRatio = profit.mul(ethers.constants.WeiPerEther).div(amountIn);
      const profitRatioFloat = parseFloat(ethers.utils.formatUnits(profitRatio, 18));

      if (profit.lte(0) || profitRatioFloat < this.minProfitThreshold) {
        continue;
      }

      if (!best || profit.gt(best.profit)) {
        best = { amountIn, amountOut, profit };
      }
    }

    if (!best) {
      return null;
    }

    const gasPriceWei = await this.provider.getGasPrice();
  const minProfitOverride = best.profit.mul(95).div(100); // keep 5% safety margin
  const slippageBps = Math.max(0, Math.min(10000, Math.floor(this.slippageTolerance * 10000)));
  const minAmountOut = best.amountIn.add(best.profit.mul(10000 - slippageBps).div(10000));

    const payload = ethers.utils.defaultAbiCoder.encode(
      [
        "tuple(uint8 routeType,address router,address quoter,address[] tokens,uint24[] fees,uint256 estimatedGas,uint256 minAmountOut)[]",
        "uint256",
        "uint256"
      ],
      [
        [
          {
            routeType: candidate.quote.routeType === "uniswap_v3" ? 1 : 0,
            router: candidate.quote.router,
            quoter: candidate.quote.quoter ?? ethers.constants.AddressZero,
            tokens: candidate.quote.tokens,
            fees: candidate.quote.fees,
            estimatedGas: 240000,
            minAmountOut: minAmountOut
          }
        ],
        minProfitOverride,
        gasPriceWei
      ]
    );

    return {
      candidate,
      flashAmount: best.amountIn,
      tokens: [candidate.flashToken.address],
      amounts: [best.amountIn.toString()],
      payload,
      minProfitOverride,
      expectedProfit: best.profit,
      gasPriceWei
    };
  }

  private async evaluateAmount(candidate: ArbitrageCandidate, amountIn: BigNumber): Promise<BigNumber | null> {
    if (candidate.quote.routeType === "uniswap_v3") {
      return this.evaluateV3(candidate, amountIn);
    }

    const router = new ethers.Contract(candidate.quote.router, V2_ROUTER_ABI, this.provider);
    try {
      const amounts: BigNumber[] = await router.getAmountsOut(amountIn, candidate.quote.tokens);
      return amounts[amounts.length - 1];
    } catch (error) {
      elizaLogger.debug(`⚠️  V2 quote failed for ${candidate.quote.dex.name}: ${(error as Error).message}`);
      return null;
    }
  }

  private async evaluateV3(candidate: ArbitrageCandidate, amountIn: BigNumber): Promise<BigNumber | null> {
    if (!candidate.quote.quoter) {
      return null;
    }

    const quoter = new ethers.Contract(candidate.quote.quoter, V3_QUOTER_ABI, this.provider);

    let current = amountIn;
    for (let i = 0; i < candidate.quote.tokens.length - 1; i++) {
      const tokenIn = candidate.quote.tokens[i];
      const tokenOut = candidate.quote.tokens[i + 1];
      const fee = candidate.quote.fees[i] ?? 3000;

      try {
        current = await quoter.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, current, 0);
      } catch (error) {
        elizaLogger.debug(`⚠️  V3 quote failed for ${candidate.quote.dex.name}: ${(error as Error).message}`);
        return null;
      }
    }

    return current;
  }
}

export default RouteAssembler;
