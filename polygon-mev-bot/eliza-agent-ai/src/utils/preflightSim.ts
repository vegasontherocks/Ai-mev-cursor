import 'dotenv/config';
import { ethers } from 'ethers';

async function main() {
    if (!process.env.POLYGON_RPC_URL) {
        console.error('POLYGON_RPC_URL not set; skipping preflight');
        process.exit(1);
    }
    if (!process.env.MEV_EXECUTOR_ADDRESS) {
        console.error('MEV_EXECUTOR_ADDRESS not set; skipping preflight');
        process.exit(1);
    }

    const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);

    // Sample transaction from smokeEncode
    // Use single-token flash loan to match MEVExecutor restrictions
    const tokens = [
        '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
    ];
    const amounts = [ethers.utils.parseEther('0.01')];
    const dexes = ['0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'];
    const pathTokens = [tokens[0]]; // single-token path

    const pathBytes = ethers.utils.defaultAbiCoder.encode(['address[]', 'address[]'], [dexes, pathTokens]);
    const abi = ['function executeArbitrage(address[] tokens, uint256[] amounts, bytes path)'];
    const iface = new ethers.utils.Interface(abi);
    const data = iface.encodeFunctionData('executeArbitrage', [tokens, amounts, pathBytes]);

    const tx = {
        to: process.env.MEV_EXECUTOR_ADDRESS,
        data,
        value: 0
    } as any;

    // If we have a configured wallet address, set it as the 'from' for simulation
    const cfgAddr = process.env.WALLET_ADDRESS || (process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY).address : undefined);
    if (cfgAddr) tx.from = cfgAddr;

    // Verify owner matches configured wallet (if PRIVATE_KEY or WALLET_ADDRESS provided)
    try {
        const ownerAbi = ['function owner() view returns (address)'];
        const executor = new ethers.Contract(process.env.MEV_EXECUTOR_ADDRESS, ownerAbi, provider);
        const ownerAddr = await executor.owner();
        console.log('Contract owner:', ownerAddr);

        const cfgAddr = process.env.WALLET_ADDRESS || (process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY).address : undefined);
        if (cfgAddr) {
            if (ownerAddr.toLowerCase() !== cfgAddr.toLowerCase()) {
                console.error('Configured wallet does not match contract owner. Preflight cannot simulate owner-only functions.');
                console.error('Owner:', ownerAddr, 'Configured:', cfgAddr);
                process.exit(3);
            }
        } else {
            console.warn('No WALLET_ADDRESS or PRIVATE_KEY configured; preflight may fail for owner-only functions.');
        }
    } catch (e) {
        console.warn('Could not fetch contract owner:', e?.message || e);
    }

    // First perform eth_call to capture revert reasons if any
    try {
        const callRes = await provider.call(tx);
        console.log('eth_call returned (hex):', callRes);
    } catch (callError: any) {
        // Try to decode revert reason if present
        const data = callError?.error?.data || callError?.data || callError?.body;
        if (data) {
            const hex = typeof data === 'string' ? data : JSON.stringify(data);
            const reason = decodeRevertReason(hex);
            console.error('eth_call reverted:', reason || hex);
        } else {
            console.error('eth_call failed:', callError.message || callError);
        }
        // eth_call failed -> treat as preflight failure
        process.exit(2);
    }

    // If eth_call succeeded, attempt to estimate gas but do not treat failure as fatal.
    try {
        const gasEstimate = await provider.estimateGas(tx);
        console.log('Estimated gas:', gasEstimate.toString());
    } catch (e: any) {
        console.warn('Gas estimation failed after eth_call; transaction may require custom gasLimit:', e.message || e);
        console.warn('Proceeding since eth_call succeeded (DRY_RUN).');
    }

    console.log('Preflight simulation OK (DRY_RUN)');

    function decodeRevertReason(hex: string | undefined): string | null {
        if (!hex) return null;
        try {
            if (hex.startsWith('{')) return null;
            if (hex.startsWith('0x08c379a0')) {
                // standard Revert(string)
                const stripped = hex.replace(/^0x/, '');
                // skip selector (8) + offset (64) + length (64) => start at 8+64+64 = 136 chars
                const reasonLenHex = stripped.substring(8 + 64, 8 + 64 + 64);
                const reasonLen = parseInt(reasonLenHex, 16) * 2;
                const reasonHex = stripped.substring(8 + 64 + 64, 8 + 64 + 64 + reasonLen);
                return Buffer.from(reasonHex, 'hex').toString('utf8');
            }
            return null;
        } catch (err) {
            return null;
        }
    }
}

main();
