import { IQuoteAdapter } from './QuoteAdapter.js';
import { BigNumber, ethers } from 'ethers';
import { appendTelemetry } from '../utils/quoteTelemetry.js';

const DEFAULT_TIMEOUT_MS = 3000;
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
            // small backoff
            await new Promise(r => setTimeout(r, 100 * (i + 1)));
        }
    }
    throw lastErr;
}

export class DirectRpcQuoteAdapter implements IQuoteAdapter {
    private provider: ethers.providers.JsonRpcProvider;
    constructor(provider: ethers.providers.JsonRpcProvider) {
        this.provider = provider;
    }

    name(): string { return 'direct-rpc'; }

    async getAmountsOut(router: string, amountIn: BigNumber, path: string[]): Promise<BigNumber[]> {
        const routerContract = new ethers.Contract(
            router,
            ['function getAmountsOut(uint256,address[]) external view returns (uint256[] memory)'],
            this.provider
        );

        const start = Date.now();
        try {
            const res = await withRetries(() => routerContract.getAmountsOut(amountIn, path));
            appendTelemetry({ adapter: this.name(), method: 'getAmountsOut', router, path, durationMs: Date.now() - start, success: true });
            return res as unknown as BigNumber[];
        } catch (e) {
            appendTelemetry({ adapter: this.name(), method: 'getAmountsOut', router, path, durationMs: Date.now() - start, success: false, error: String(e && e.message ? e.message : e) });
            throw e;
        }
    }

    async getUniswapV3Quote(quoter: string, tokenIn: string, tokenOut: string, amountIn: BigNumber, fee?: number): Promise<BigNumber> {
        const quoterContract = new ethers.Contract(
            quoter,
            ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)'],
            this.provider
        );

        if (fee) {
            const start = Date.now();
            try {
                const out = await withRetries(() => quoterContract.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0));
                appendTelemetry({ adapter: this.name(), method: 'quoteExactInputSingle', quoter, tokenIn, tokenOut, fee, durationMs: Date.now() - start, success: true });
                return out;
            } catch (e) {
                appendTelemetry({ adapter: this.name(), method: 'quoteExactInputSingle', quoter, tokenIn, tokenOut, fee, durationMs: Date.now() - start, success: false, error: String(e && e.message ? e.message : e) });
                throw e;
            }
        }

        // try common tiers and return best
        const tiers = [500, 1000, 3000, 10000];
        let best = BigNumber.from(0);
        for (const t of tiers) {
            try {
                const out = await withRetries(() => quoterContract.callStatic.quoteExactInputSingle(tokenIn, tokenOut, t, amountIn, 0));
                if (out.gt(best)) best = out;
            } catch { /* ignore */ }
        }
        return best;
    }
}

export default DirectRpcQuoteAdapter;
