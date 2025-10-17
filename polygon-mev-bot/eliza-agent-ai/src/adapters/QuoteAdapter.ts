import { BigNumber } from 'ethers';

export interface IQuoteAdapter {
    name(): string;
    getAmountsOut(router: string, amountIn: BigNumber, path: string[]): Promise<BigNumber[]>;
    getUniswapV3Quote(quoter: string, tokenIn: string, tokenOut: string, amountIn: BigNumber, fee?: number): Promise<BigNumber>;
}

export default IQuoteAdapter;
