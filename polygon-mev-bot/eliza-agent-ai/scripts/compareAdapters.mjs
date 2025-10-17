#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CHAR_DIR = path.join(ROOT, 'characters');
const RPC = process.env.POLYGON_RPC_URL || process.env.RPC_URL || 'https://polygon-rpc.com';

async function safeReadJSON(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch (e) { return null; }
}

const { ThirdwebSDK } = await import('@thirdweb-dev/sdk');

async function directGetAmountsOut(provider, router, amountIn, pathArr) {
    const routerContract = new ethers.Contract(
        router,
        ['function getAmountsOut(uint256,address[]) external view returns (uint256[] memory)'],
        provider
    );
    return await routerContract.getAmountsOut(amountIn, pathArr);
}

async function thirdwebGetAmountsOut(provider, router, amountIn, pathArr) {
    try {
        const sdk = new ThirdwebSDK(provider);
        const contract = await sdk.getContract(router);
        const amounts = await contract.call('getAmountsOut', amountIn, pathArr);
        return amounts.map(a => (typeof a === 'string' ? a : a.toString()));
    } catch (e) {
        // fall back to direct provider
        return await directGetAmountsOut(provider, router, amountIn, pathArr);
    }
}

async function gatherConfigs() {
    const out = [];
    try {
        const files = await fs.readdir(CHAR_DIR);
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            const j = await safeReadJSON(path.join(CHAR_DIR, f));
            if (j) out.push({ file: f, json: j });
        }
    } catch (e) { }
    return out;
}

function nowMs() { return Date.now(); }

async function run() {
    console.log('COMPARE_ADAPTERS');
    console.log('RPC:', RPC);
    const configs = await gatherConfigs();
    if (!configs.length) { console.error('No character files'); process.exit(1); }

    const provider = new ethers.providers.JsonRpcProvider(RPC);

    for (const cfg of configs) {
        console.log('\n---', cfg.file, '---');
        const j = cfg.json;
        const tokens = j.tokens || (j.settings && j.settings.mev && j.settings.mev.tokens) || [];
        const dexes = j.dexes || (j.settings && j.settings.mev && j.settings.mev.dexes) || [];

        const taddrs = tokens.map(t => (typeof t === 'string' ? t : (t.address || t.token || ''))).filter(Boolean);
        const raddrs = dexes.map(d => (typeof d === 'string' ? d : (d.router || d.address || ''))).filter(Boolean);

        console.log('Tokens:', taddrs);
        console.log('Routers:', raddrs);

        for (const router of raddrs) {
            for (let i = 0; i < taddrs.length; i++) for (let jdx = 0; jdx < taddrs.length; jdx++) {
                if (i === jdx) continue;
                const aIn = taddrs[i];
                const aOut = taddrs[jdx];
                // try sample amount 1 token with 18 decimals
                const amountIn = ethers.utils.parseUnits('1.0', 18);

                // Direct RPC
                let t0 = nowMs();
                let directRes, directErr;
                try { directRes = await directGetAmountsOut(provider, router, amountIn, [aIn, aOut]); } catch (e) { directErr = e; }
                let t1 = nowMs();

                // Thirdweb
                let t2 = nowMs();
                let thirdRes, thirdErr;
                try { thirdRes = await thirdwebGetAmountsOut(provider, router, amountIn, [aIn, aOut]); } catch (e) { thirdErr = e; }
                let t3 = nowMs();

                console.log(`\nPair: ${aIn} -> ${aOut} via ${router}`);
                console.log('DirectRPC time(ms):', t1 - t0, 'result:', directRes ? directRes.map(r => r.toString()) : 'ERR', directErr ? String(directErr.message || directErr) : '');
                console.log('Thirdweb time(ms):', t3 - t2, 'result:', thirdRes ? thirdRes.map(r => r.toString()) : 'ERR', thirdErr ? String(thirdErr.message || thirdErr) : '');
                // Append telemetry lines for each call
                try {
                    const TELE_DIR = path.join(process.cwd(), 'telemetry');
                    await fs.mkdir(TELE_DIR, { recursive: true });
                    const TELE_FILE = path.join(TELE_DIR, 'quotes.log');
                    const entryDirect = JSON.stringify({ adapter: 'direct-rpc', method: 'getAmountsOut', router, path: [aIn, aOut], durationMs: t1 - t0, success: !directErr, error: directErr ? String(directErr?.message || directErr) : undefined, ts: new Date().toISOString() });
                    const entryThird = JSON.stringify({ adapter: 'thirdweb-sdk', method: 'getAmountsOut', router, path: [aIn, aOut], durationMs: t3 - t2, success: !thirdErr, error: thirdErr ? String(thirdErr?.message || thirdErr) : undefined, ts: new Date().toISOString() });
                    await fs.appendFile(TELE_FILE, entryDirect + '\n', 'utf8');
                    await fs.appendFile(TELE_FILE, entryThird + '\n', 'utf8');
                } catch (e) {
                    // ignore telemetry write errors
                }
            }
        }
    }
    console.log('\nDONE');
}

run().catch(e => { console.error('compareAdapters error', e); process.exit(2); });
