import { BigNumber } from "ethers";

export type DexType = "uniswap_v2" | "uniswap_v3";

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
}

export interface DexConfig {
  name: string;
  router: string;
  factory?: string;
  priority?: number;
  type?: DexType;
}

export interface DexQuote {
  dex: DexConfig;
  routeType: DexType;
  router: string;
  quoter?: string;
  tokens: string[];
  fees: number[];
  price: number;
  amountOut?: BigNumber;
}

export interface ArbitrageCandidate {
  id: string;
  flashToken: TokenConfig; // Token borrowed via flash loan (quote token)
  targetToken: TokenConfig; // Token swapped in loop (base token)
  quote: DexQuote;
  spread: number;
  expectedProfit: number;
  timestamp: number;
}

export interface RoutePlan {
  candidate: ArbitrageCandidate;
  flashAmount: BigNumber;
  tokens: string[];
  amounts: string[];
  payload: string;
  minProfitOverride: BigNumber;
  expectedProfit: BigNumber;
  gasPriceWei: BigNumber;
}

export interface SimulationOutcome {
  success: boolean;
  gasEstimate?: string;
  gasPriceGwei?: number;
  revertReason?: string;
  error?: string;
}

export interface ExecutionResult {
  submitted: boolean;
  txHash?: string;
  thirdwebTransactionId?: string;
}
