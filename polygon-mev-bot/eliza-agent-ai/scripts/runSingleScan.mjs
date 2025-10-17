# This script runs a single scan for the Polygon MEV bot.
#!/usr/bin / env node
import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import dotenv from 'dotenv';
dotenv.config();
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CHAR_DIR = path.join(__dirname, '..', 'characters');
const RPC = process.env.POLYGON_RPC_URL || process.env.RPC_URL || 'https://polygon-rpc.com';
async function safeReadJSON(p) {
    try {
        const txt = await fs.readFile(p, 'utf8');
        return JSON.parse(txt);
    } catch (e) {
        return null;
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
    } catch (e) {
        // directory missing
    }
    return out;
}
function uniq(a) { return [...new Set(a)]; }
async function main() {
    console.log('RUN_SINGLE_SCAN');
    console.log('RPC:', RPC);
    const configs = await gatherConfigs();
    if (!configs.length) {
        console.log('No character JSON files found under', CHAR_DIR);
        console.log('Please run this script from the repository and ensure characters/*.json exist.');
        process.exit(1);
        const { ethers } = await import('ethers');
        const provider = new ethers.providers.JsonRpcProvider(RPC);
        const routerAbi = ['function getAmountsOut(uint256,address[]) view returns (uint256[])'];
        for (const cfg of configs) {
            console.log('\n---', cfg.file, '---');
            const j = cfg.json;
            // try multiple common fields
            // Support multiple possible locations for tokens/dexes in character JSON files
            const tokens = j.tokens
                || (j.settings && j.settings.mev && j.settings.mev.tokens)
                || j.tokenList
                || j.watchTokens
                || j.tokensToWatch
                || [];
            const dexes = j.dexes
                || (j.settings && j.settings.mev && j.settings.mev.dexes)
                || j.routers
                || j.exchanges
                || j.dexList
                || [];
            console.log('Found tokens count:', tokens.length);
            console.log('Found dexes count:', dexes.length);
            // extract router addresses from dex objects or strings
            const routers = [];
            for (const d of dexes) {
                if (!d) continue;
                if (typeof d === 'string') routers.push(d);
                else if (d.router) routers.push(d.router);
                else if (d.address) routers.push(d.address);
                else if (d.quoter) routers.push(d.quoter);
            }
            // some configs might have a top-level router, or under settings.mev.router
            if (j.router) routers.push(j.router);
            if (j.settings && j.settings.mev && j.settings.mev.router) routers.push(j.settings.mev.router);
            const rlist = uniq(routers).filter(Boolean);
            if (!rlist.length) console.log('No routers found in this character file; please inspect the JSON.');
            else console.log('Routers:', rlist);
            // Build token pairs (unique addresses)
            const taddrs = tokens.map(t => (typeof t === 'string' ? t : (t.address || t.token || ''))).filter(Boolean);
            const tuniq = uniq(taddrs);
            if (tuniq.length < 2) console.log('Need at least two tokens to form a pair. Found:', tuniq);
            // For each router and token pair, try getAmountsOut
            for (const routerAddr of rlist) {
                try {
                    const router = new ethers.Contract(routerAddr, routerAbi, provider);
                    console.log('\nTesting router', routerAddr);
                    for (let i = 0; i < tuniq.length; i++) for (let jdx = 0; jdx < tuniq.length; jdx++) {
                        if (i === jdx) continue;
                        const aIn = tuniq[i];
                        const aOut = tuniq[jdx];
                        // try different amount scales
                        for (const decimals of [18, 6]) {
                            const amountIn = ethers.utils.parseUnits('1.0', decimals).toString();
                            try {
                                const amounts = await router.getAmountsOut(amountIn, [aIn, aOut]);
                                console.log(`getAmountsOut [decimals=${decimals}] ${aIn.slice(0, 10)}... -> ${aOut.slice(0, 10)}... =`, amounts.map(a => a.toString()));
                                try {
                                    const TELE_DIR = path.join(process.cwd(), 'telemetry');
                                    await fs.mkdir(TELE_DIR, { recursive: true });
                                    const TELE_FILE = path.join(TELE_DIR, 'quotes.log');
                                    const entry = JSON.stringify({ adapter: 'direct-rpc', method: 'getAmountsOut', router: routerAddr, path: [aIn, aOut], decimals, success: true, ts: new Date().toISOString() });
                                    await fs.appendFile(TELE_FILE, entry + '\n', 'utf8');
                                } catch (e) { }
                                break; // success for this pair
                            } catch (err) {
                                // show the first error but continue
                                console.log(`  getAmountsOut error for pair ${aIn} -> ${aOut} (decimals=${decimals}):`, err && err.message ? err.message : String(err));
                                try {
                                    const TELE_DIR = path.join(process.cwd(), 'telemetry');
                                    await fs.mkdir(TELE_DIR, { recursive: true });
                                    const TELE_FILE = path.join(TELE_DIR, 'quotes.log');
                                    const entry = JSON.stringify({ adapter: 'direct-rpc', method: 'getAmountsOut', router: routerAddr, path: [aIn, aOut], decimals, success: false, error: err && err.message ? err.message : String(err), ts: new Date().toISOString() });
                                    await fs.appendFile(TELE_FILE, entry + '\n', 'utf8');
                                } catch (e) { }
                            }
                        }
                    }
                } catch (err) {
                    console.log('Error constructing router contract for', routerAddr, ':', err && err.message ? err.message : String(err));
                }
            }
        }
        console.log('\nDONE');
        process.exit(0);
    }
    main().catch(e => {
        console.error('Fatal error in runSingleScan:', e && e.stack ? e.stack : e);
        process.exit(2);
    });
#!/usr/bin / env node
    import fs from 'fs/promises';
    import path from 'path';
    import url from 'url';
    import dotenv from 'dotenv';

    dotenv.config();

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const CHAR_DIR = path.join(__dirname, '..', 'characters');
    const RPC = process.env.POLYGON_RPC_URL || process.env.RPC_URL || 'https://polygon-rpc.com';

    async function safeReadJSON(p) {
        try {
            const txt = await fs.readFile(p, 'utf8');
            return JSON.parse(txt);
        } catch (e) {
            return null;
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
        } catch (e) {
            // directory missing
        }
        return out;
    }

    function uniq(a) { return [...new Set(a)]; }

    async function main() {
        console.log('RUN_SINGLE_SCAN');
        console.log('RPC:', RPC);
        const configs = await gatherConfigs();
        if (!configs.length) {
            console.log('No character JSON files found under', CHAR_DIR);
            console.log('Please run this script from the repository and ensure characters/*.json exist.');
            process.exit(1);
        }

        const { ethers } = await import('ethers');
        const provider = new ethers.providers.JsonRpcProvider(RPC);

        const routerAbi = ['function getAmountsOut(uint256,address[]) view returns (uint256[])'];

        for (const cfg of configs) {
            console.log('\n---', cfg.file, '---');
            const j = cfg.json;
            // try multiple common fields
            // Support multiple possible locations for tokens/dexes in character JSON files
            const tokens = j.tokens
                || (j.settings && j.settings.mev && j.settings.mev.tokens)
                || j.tokenList
                || j.watchTokens
                || j.tokensToWatch
                || [];

            const dexes = j.dexes
                || (j.settings && j.settings.mev && j.settings.mev.dexes)
                || j.routers
                || j.exchanges
                || j.dexList
                || [];

            console.log('Found tokens count:', tokens.length);
            console.log('Found dexes count:', dexes.length);

            // extract router addresses from dex objects or strings
            const routers = [];
            for (const d of dexes) {
                if (!d) continue;
                if (typeof d === 'string') routers.push(d);
                else if (d.router) routers.push(d.router);
                else if (d.address) routers.push(d.address);
                else if (d.quoter) routers.push(d.quoter);
            }
            // some configs might have a top-level router, or under settings.mev.router
            if (j.router) routers.push(j.router);
            if (j.settings && j.settings.mev && j.settings.mev.router) routers.push(j.settings.mev.router);

            const rlist = uniq(routers).filter(Boolean);
            if (!rlist.length) console.log('No routers found in this character file; please inspect the JSON.');
            else console.log('Routers:', rlist);

            // Build token pairs (unique addresses)
            const taddrs = tokens.map(t => (typeof t === 'string' ? t : (t.address || t.token || ''))).filter(Boolean);
            const tuniq = uniq(taddrs);
            if (tuniq.length < 2) console.log('Need at least two tokens to form a pair. Found:', tuniq);

            // For each router and token pair, try getAmountsOut
            for (const routerAddr of rlist) {
                try {
                    const router = new ethers.Contract(routerAddr, routerAbi, provider);
                    console.log('\nTesting router', routerAddr);
                    for (let i = 0; i < tuniq.length; i++) for (let jdx = 0; jdx < tuniq.length; jdx++) {
                        if (i === jdx) continue;
                        const aIn = tuniq[i];
                        const aOut = tuniq[jdx];
                        // try different amount scales
                        for (const decimals of [18, 6]) {
                            const amountIn = ethers.utils.parseUnits('1.0', decimals).toString();
                            try {
                                const amounts = await router.getAmountsOut(amountIn, [aIn, aOut]);
                                console.log(`getAmountsOut [decimals=${decimals}] ${aIn.slice(0, 10)}... -> ${aOut.slice(0, 10)}... =`, amounts.map(a => a.toString()));
                                try {
                                    const TELE_DIR = path.join(process.cwd(), 'telemetry');
                                    await fs.mkdir(TELE_DIR, { recursive: true });
                                    const TELE_FILE = path.join(TELE_DIR, 'quotes.log');
                                    const entry = JSON.stringify({ adapter: 'direct-rpc', method: 'getAmountsOut', router: routerAddr, path: [aIn, aOut], decimals, success: true, ts: new Date().toISOString() });
                                    await fs.appendFile(TELE_FILE, entry + '\n', 'utf8');
                                } catch (e) { }
                                break; // success for this pair
                            } catch (err) {
                                // show the first error but continue
                                console.log(`  getAmountsOut error for pair ${aIn} -> ${aOut} (decimals=${decimals}):`, err && err.message ? err.message : String(err));
                                try {
                                    const TELE_DIR = path.join(process.cwd(), 'telemetry');
                                    await fs.mkdir(TELE_DIR, { recursive: true });
                                    const TELE_FILE = path.join(TELE_DIR, 'quotes.log');
                                    const entry = JSON.stringify({ adapter: 'direct-rpc', method: 'getAmountsOut', router: routerAddr, path: [aIn, aOut], decimals, success: false, error: err && err.message ? err.message : String(err), ts: new Date().toISOString() });
                                    await fs.appendFile(TELE_FILE, entry + '\n', 'utf8');
                                } catch (e) { }
                            }
                        }
                    }
                } catch (err) {
                    console.log('Error constructing router contract for', routerAddr, ':', err && err.message ? err.message : String(err));
                }
            }
        }

        console.log('\nDONE');
        process.exit(0);
    }

    main().catch(e => {
        console.error('Fatal error in runSingleScan:', e && e.stack ? e.stack : e);
        process.exit(2);
    });
