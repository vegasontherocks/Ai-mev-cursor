const { config } = require('dotenv');
const https = require('https');
const fs = require('fs');

config();

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  🔮 CALLING THIRDWEB NEBULA TO GENERATE CONTRACTS 🔮         ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

async function callNebulaAPI(prompt, contractName) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            model: 'nebula-t1',
            messages: [{
                role: 'user',
                content: prompt
            }],
            temperature: 0.1,
            max_tokens: 4000
        });

        const options = {
            hostname: 'nebula.thirdweb.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.THIRDWEB_SECRET_KEY}`,
                'Content-Length': data.length
            }
        };

        console.log(`📡 Calling Thirdweb Nebula for ${contractName}...`);
        
        const req = https.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const response = JSON.parse(body);
                        const content = response.choices[0].message.content;
                        console.log(`✅ Nebula generated ${contractName}! (${content.length} chars)`);
                        resolve(content);
                    } catch (e) {
                        reject(new Error(`Parse error: ${e.message}`));
                    }
                } else {
                    reject(new Error(`API error ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

async function generateContracts() {
    const contracts = [
        {
            name: 'MEVExecutor.sol',
            prompt: `Generate a production-grade MEV Executor smart contract for Polygon.

Solidity Version: 0.8.20

COMPLETE IMPLEMENTATION REQUIRED:

1. Balancer V2 Flash Loan Integration
   - Import IVault, IFlashLoanRecipient
   - receiveFlashLoan callback with FULL arbitrage logic
   - Support multi-token flash loans
   - Zero-fee borrowing from 0xBA12222222228d8Ba445958a75a0704d566BF2C8

2. Multi-DEX Arbitrage Strategy
   - Uniswap V2 swaps (QuickSwap: 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff)
   - Uniswap V3 swaps (0xE592427A0AEce92De3Edee1F18E0157C05861564)
   - SushiSwap (0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506)
   - Multi-hop routing
   - Gas-optimized swaps

3. Aave V3 Liquidations
   - Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
   - Health factor checks
   - Liquidation execution
   - Collateral swap back to debt token

4. Circuit Breakers
   - Min profit threshold
   - Max loss per transaction
   - Daily loss limits
   - Emergency pause

5. Access Control
   - Owner-only execution
   - Reentrancy guard
   - Profit withdrawal

Generate COMPLETE, working code with ALL logic implemented. No TODOs or placeholders.
Return ONLY the Solidity code.`
        }
    ];

    for (const contract of contracts) {
        try {
            const code = await callNebulaAPI(contract.prompt, contract.name);
            
            // Extract Solidity code from markdown if wrapped
            let solidityCode = code;
            if (code.includes('```solidity')) {
                solidityCode = code.split('```solidity')[1].split('```')[0].trim();
            } else if (code.includes('```')) {
                solidityCode = code.split('```')[1].split('```')[0].trim();
            }
            
            // Save to file
            const path = `../contracts/src/generated/${contract.name}`;
            fs.writeFileSync(path, solidityCode);
            console.log(`💾 Saved to ${path}\n`);
            
        } catch (error) {
            console.error(`❌ Error generating ${contract.name}:`, error.message);
        }
    }
    
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ NEBULA CONTRACT GENERATION COMPLETE!                      ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

generateContracts().catch(console.error);
