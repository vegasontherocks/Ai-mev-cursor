import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function loadCharacter() {
    const scriptPath = new URL(import.meta.url).pathname;
    const scriptDir = resolve(scriptPath).replace(/\/debugQuotes.ts$/i, '');
    const candidatePaths = [
        resolve(scriptDir, '../characters/ai-mev-hunter.json'),
        resolve(scriptDir, '../../src/characters/ai-mev-hunter.json'),
        resolve(process.cwd(), './polygon-mev-bot/eliza-agent-ai/characters/ai-mev-hunter.json'),
        resolve(process.cwd(), './characters/ai-mev-hunter.json')
    ];

    for (const p of candidatePaths) {
        try {
            const raw = readFileSync(p, 'utf-8');
            return JSON.parse(raw);
        } catch (e) {
            // ignore
        }
    }
    throw new Error('Could not find character file in candidate paths: ' + candidatePaths.join(', '));
}

function formatEth(n: ethers.BigNumberish, decimals = 18) {
    try {
        return parseFloat(ethers.utils.formatUnits(n, decimals));
    } catch {
        return null;
    }
}

async function main() {
    const character = await loadCharacter();
    const blockchain = character.settings.blockchain || {};
    const rpc = process.env.POLYGON_RPC_URL || blockchain.rpcUrl || '';
    if (!rpc) throw new Error('RPC URL not found in env or character config');

    const provider = new ethers.providers.JsonRpcProvider(rpc);

    const tokens = (character.settings.mev?.tokens || []).map((t: any) => ({ symbol: t.symbol, address: ethers.utils.getAddress(t.address), decimals: t.decimals }));
    const dexes = character.settings.mev?.dexes || [];

    console.log(`Using RPC: ${rpc}`);
    console.log(`Tokens: ${tokens.map((t: any) => t.symbol + ':' + t.address).join(', ')}`);
    console.log(`DEXes: ${dexes.map((d: any) => d.name + ':' + d.router).join(', ')}`);

    // Uniswap V3 quoter address
    const UNISWAP_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
    const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)'], provider);

    for (const dex of dexes) {
        console.log('\n--- DEX:', dex.name, dex.type || 'unknown', dex.router);
        for (const a of tokens) {
            for (const b of tokens) {
                if (a.address === b.address) continue;
                try {
                    if ((dex.name || '').toLowerCase().includes('v3')) {
                        // try several fee tiers
                        const feeTiers = [500, 1000, 3000, 10000];
                        let bestOut: ethers.BigNumber | null = null;
                        let bestFee: number | null = null;
                        for (const fee of feeTiers) {
                            try {
                                const out = await quoter.callStatic.quoteExactInputSingle(a.address, b.address, fee, ethers.utils.parseUnits('1', a.decimals), 0);
                                if (!bestOut || out.gt(bestOut)) {
                                    bestOut = out;
                                    bestFee = fee;
                                }
                            } catch (e) {
                                // ignore
                            }
                        }
                        if (bestOut) {
                            const price = formatEth(bestOut, a.decimals);
                            console.log(`V3 ${a.symbol}->${b.symbol} bestFee=${bestFee} out=${price}`);
                        } else {
                            console.log(`V3 ${a.symbol}->${b.symbol} no quote`);
                        }
                    } else {
                        // v2 style getAmountsOut
                        const routerAbi = ['function getAmountsOut(uint256,address[]) external view returns (uint256[])'];
                        const router = new ethers.Contract(dex.router, routerAbi, provider);
                        const path = [a.address, b.address, a.address];
                        try {
                            const amounts: ethers.BigNumber[] = await router.getAmountsOut(ethers.utils.parseUnits('1', a.decimals), path);
                            const final = amounts[amounts.length - 1];
                            const price = formatEth(final, a.decimals);
                            console.log(`V2 ${a.symbol}->${b.symbol} out=${price}`);
                        } catch (e) {
                            console.log(`V2 ${a.symbol}->${b.symbol} quote failed`);
                        }
                    }
                } catch (err) {
                    console.log('Error querying pair', a.symbol, b.symbol, err?.message || err);
                }
            }
        }
    }
}

main().catch((e) => {
    console.error('Diagnostics failed:', e.message || e);
    process.exit(2);
});
