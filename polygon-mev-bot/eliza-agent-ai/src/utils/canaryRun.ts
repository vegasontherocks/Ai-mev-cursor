import 'dotenv/config';
import { ethers } from 'ethers';

async function canary() {
    console.log('Canary preflight starting (DRY_RUN only)');
    if (!process.env.POLYGON_RPC_URL) {
        console.error('POLYGON_RPC_URL missing; aborting canary');
        process.exit(1);
    }
    if (!process.env.MEV_EXECUTOR_ADDRESS) {
        console.error('MEV_EXECUTOR_ADDRESS missing; aborting canary');
        process.exit(1);
    }

    const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);

    // optional: determine a wallet address to simulate from
    let simFrom: string | undefined = process.env.WALLET_ADDRESS;
    if (!simFrom && process.env.PRIVATE_KEY) {
        try {
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
            simFrom = wallet.address;
        } catch (_) {
            // ignore
        }
    }

    // Check contract owner() if available
    try {
        const ownerAbi = ['function owner() view returns (address)'];
        const ownerIface = new ethers.utils.Interface(ownerAbi);
        const ownerData = ownerIface.encodeFunctionData('owner');
        const callTx: any = { to: process.env.MEV_EXECUTOR_ADDRESS, data: ownerData };
        const res = await provider.call(callTx);
        const decoded = ownerIface.decodeFunctionResult('owner', res);
        const owner = decoded[0];
        console.log('Contract owner:', owner);
        if (simFrom) {
            if (owner.toLowerCase() !== simFrom.toLowerCase()) {
                console.warn('Simulated from address does not match contract owner; eth_call may revert for owner-only functions. Simulating from configured address:', simFrom);
            } else {
                console.log('Simulated from address matches contract owner.');
            }
        }
    } catch (e: any) {
        console.warn('Could not read owner() from contract (continuing):', e.message || e);
    }

    // Build a minimal single-token calldata to match the contract's expected path
    const tokens = ['0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'];
    const amounts = [ethers.utils.parseEther('0.01')];
    const dexes = ['0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'];
    const pathTokens = [tokens[0]];
    const pathBytes = ethers.utils.defaultAbiCoder.encode(['address[]', 'address[]'], [dexes, pathTokens]);
    const abi = ['function executeArbitrage(address[] tokens, uint256[] amounts, bytes path)'];
    const iface = new ethers.utils.Interface(abi);
    const data = iface.encodeFunctionData('executeArbitrage', [tokens, amounts, pathBytes]);

    const tx: any = {
        to: process.env.MEV_EXECUTOR_ADDRESS,
        data,
        value: 0
    };
    if (simFrom) tx.from = simFrom;

    try {
        // Run eth_call first to capture revert reason if any
        console.log('Calling eth_call (dry-run)...');
        const callRes = await provider.call(tx);
        console.log('eth_call returned (hex):', callRes);
    } catch (callError: any) {
        const dataField = callError?.error?.data || callError?.data || callError?.body;
        if (dataField) {
            const hex = typeof dataField === 'string' ? dataField : JSON.stringify(dataField);
            const reason = decodeRevertReason(hex);
            console.error('eth_call reverted:', reason || hex);
        } else {
            console.error('eth_call failed:', callError.message || callError);
        }
        process.exit(2);
    }

    try {
        console.log('Estimating gas...');
        const gasEstimate = await provider.estimateGas(tx);
        console.log('Estimated gas:', gasEstimate.toString());
    } catch (e: any) {
        console.warn('Gas estimation failed after eth_call; transaction may require custom gasLimit:', e.message || e);
        console.warn('Proceeding since eth_call succeeded (DRY_RUN).');
    }

    console.log('Canary preflight OK (DRY_RUN)');
}

function decodeRevertReason(hex: string | undefined): string | null {
    if (!hex) return null;
    try {
        if (hex.startsWith('{')) return null;
        if (hex.startsWith('0x08c379a0')) {
            const stripped = hex.replace(/^0x/, '');
            // skip selector (8) + offset (64)
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

canary().catch((e) => {
    console.error('Canary preflight failed:', e.message || e);
    process.exit(2);
});
