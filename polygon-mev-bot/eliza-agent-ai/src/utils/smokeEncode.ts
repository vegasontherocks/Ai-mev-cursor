import 'dotenv/config';
import { ethers } from 'ethers';

// Quick smoke test to validate executeArbitrage calldata encoding
(async () => {
    const mevExecutor = process.env.MEV_EXECUTOR_ADDRESS || '0x0000000000000000000000000000000000000000';
    const tokens = [
        '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'  // USDC
    ];
    const amounts = [ethers.utils.parseEther('1').toString(), ethers.BigNumber.from(0).toString()];
    const dexes = [
        '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' // Quickswap V2
    ];
    const pathTokens = [tokens[1]]; // WMATIC -> USDC

    const pathBytes = ethers.utils.defaultAbiCoder.encode(["address[]", "address[]"], [dexes, pathTokens]);
    const abi = ["function executeArbitrage(address[] tokens, uint256[] amounts, bytes path)"];
    const iface = new ethers.utils.Interface(abi);
    const data = iface.encodeFunctionData('executeArbitrage', [tokens, amounts, pathBytes]);

    console.log('To:', mevExecutor);
    console.log('Data:', data);
    console.log('Calldata length (bytes):', (data.length - 2) / 2);
})();
