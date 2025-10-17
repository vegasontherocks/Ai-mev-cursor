import { IQuoteAdapter } from './QuoteAdapter.js';
import { BigNumber, ethers } from 'ethers';
import { ThirdwebSDK } from '@thirdweb-dev/sdk';
import { appendTelemetry } from '../utils/quoteTelemetry.js';

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_RETRIES = 2;

function timeoutPromise<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
    });
}

async function withRetries<T>(fn: () => Promise<T>, retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await timeoutPromise(fn(), timeoutMs);
        } catch (e) {
            lastErr = e;
            await new Promise(r => setTimeout(r, 150 * (i + 1)));
        }
    }
    throw lastErr;
}

export class ThirdwebQuoteAdapter implements IQuoteAdapter {
    private sdk: any;
    private provider: ethers.providers.JsonRpcProvider;

    constructor(provider: ethers.providers.JsonRpcProvider, opts?: { privateKey?: string, url?: string }) {
        this.provider = provider;
        // initialize SDK with provider
        try {
            this.sdk = new ThirdwebSDK(provider);
        } catch (e) {
            this.sdk = null;
        }
    }

    name(): string { return 'thirdweb-sdk'; }

    async getAmountsOut(router: string, amountIn: BigNumber, path: string[]): Promise<BigNumber[]> {
        if (this.sdk) {
            try {
                const contract = await this.sdk.getContract(router);
                // call view method via SDK
                const amounts = await withRetries(() => contract.call('getAmountsOut', amountIn, path));
                const arr = amounts as any[];
                appendTelemetry({ adapter: this.name(), method: 'getAmountsOut', router, path, durationMs: 0, success: true });
                return arr.map((a: any) => BigNumber.from(a.toString()));
            } catch (e) {
                // fallthrough to provider
            }
        }

        // fallback using provider directly
        const routerContract = new ethers.Contract(
            router,
            ['function getAmountsOut(uint256,address[]) external view returns (uint256[] memory)'],
            this.provider
        );
        return await withRetries(() => routerContract.getAmountsOut(amountIn, path));
    }

    async getUniswapV3Quote(quoter: string, tokenIn: string, tokenOut: string, amountIn: BigNumber, fee?: number): Promise<BigNumber> {
        if (this.sdk) {
            try {
                const contract = await this.sdk.getContract(quoter);
                if (fee) {
                    const start = Date.now();
                    const out = await withRetries(() => contract.call('quoteExactInputSingle', tokenIn, tokenOut, fee, amountIn, 0));
                    appendTelemetry({ adapter: this.name(), method: 'quoteExactInputSingle', quoter, tokenIn, tokenOut, fee, durationMs: Date.now() - start, success: true });
                    return BigNumber.from(out.toString());
                }
                // try tiers
                const tiers = [500, 1000, 3000, 10000];
                let best = BigNumber.from(0);
                for (const t of tiers) {
                    try {
                        const start = Date.now();
                        const out = await withRetries(() => contract.call('quoteExactInputSingle', tokenIn, tokenOut, t, amountIn, 0));
                        appendTelemetry({ adapter: this.name(), method: 'quoteExactInputSingle', quoter, tokenIn, tokenOut, fee: t, durationMs: Date.now() - start, success: true });
                        const bn = BigNumber.from(out.toString());
                        if (bn.gt(best)) best = bn;
                    } catch {
                        appendTelemetry({ adapter: this.name(), method: 'quoteExactInputSingle', quoter, tokenIn, tokenOut, fee: t, durationMs: 0, success: false });
                    }
                }
                return best;
            } catch {
                // fallthrough
            }
        }

        // fallback to provider
        const quoterContract = new ethers.Contract(
            quoter,
            ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)'],
            this.provider
        );

        if (fee) {
            return await withRetries(() => quoterContract.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0));
        }

        const tiers = [500, 1000, 3000, 10000];
        let best = BigNumber.from(0);
        for (const t of tiers) {
            try {
                const out = await withRetries(() => quoterContract.callStatic.quoteExactInputSingle(tokenIn, tokenOut, t, amountIn, 0));
                if (out.gt(best)) best = out;
            } catch { }
        }
        return best;
    }
}

export default ThirdwebQuoteAdapter;
