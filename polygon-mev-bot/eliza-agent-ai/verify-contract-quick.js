import { ethers } from 'ethers';
import { config } from 'dotenv';
config();

const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
const address = '0x0CD75B9605ad928a47616a6a1549FC856c07dbB7';

console.log(`\n🔍 Checking contract at: ${address}\n`);

const code = await provider.getCode(address);
console.log(`Bytecode length: ${code.length} characters`);
console.log(`Bytecode preview: ${code.slice(0, 100)}...`);
console.log(`Has bytecode: ${code !== '0x' ? '✅ YES' : '❌ NO'}`);

if (code !== '0x') {
    const contract = new ethers.Contract(
        address,
        ['function owner() view returns (address)'],
        provider
    );
    try {
        const owner = await contract.owner();
        console.log(`\n✅ Contract owner: ${owner}`);
    } catch (e) {
        console.log(`\n⚠️  Could not call owner(): ${e.message}`);
    }
}
