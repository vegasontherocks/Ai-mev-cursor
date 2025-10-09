/**
 * Test Configuration and Health Checks
 * Run before starting the agent to verify all systems
 */

import { config } from 'dotenv';
import { ThirdwebSDK } from '@thirdweb-dev/sdk';
import { ethers } from 'ethers';

config();

const results = [];

function log(result) {
  const emoji = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${emoji} ${result.name}: ${result.message}`);
  if (result.details) {
    console.log(`   Details:`, result.details);
  }
  results.push(result);
}

async function testEnvironmentVariables() {
  console.log('\n📋 Testing Environment Variables...\n');
  
  const required = [
    'MEV_EXECUTOR_ADDRESS',
    'THIRDWEB_CLIENT_ID',
    'THIRDWEB_SECRET_KEY',
    'POLYGON_RPC_URL',
    'PRIVATE_KEY',
    'WALLET_ADDRESS'
  ];
  
  for (const key of required) {
    if (process.env[key]) {
      log({
        name: `ENV: ${key}`,
        status: 'PASS',
        message: `Set (${process.env[key]?.slice(0, 10)}...)`
      });
    } else {
      log({
        name: `ENV: ${key}`,
        status: 'FAIL',
        message: 'Not set'
      });
    }
  }
  
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'PLACEHOLDER_GET_FROM_USER') {
    log({
      name: 'ENV: OPENAI_API_KEY',
      status: 'WARN',
      message: 'Not configured - Eliza needs this. Provide your OpenAI API key.'
    });
  } else {
    log({
      name: 'ENV: OPENAI_API_KEY',
      status: 'PASS',
      message: `Set (${process.env.OPENAI_API_KEY.slice(0, 15)}...)`
    });
  }
}

async function testPolygonRPC() {
  console.log('\n🔗 Testing Polygon RPC Connection...\n');
  
  try {
    const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    
    log({
      name: 'Polygon RPC',
      status: 'PASS',
      message: `Connected to chain ${network.chainId}`,
      details: { blockNumber, chainId: network.chainId.toString() }
    });
  } catch (error) {
    log({
      name: 'Polygon RPC',
      status: 'FAIL',
      message: error.message
    });
  }
}

async function testThirdwebSDK() {
  console.log('\n🌐 Testing Thirdweb SDK...\n');
  
  try {
    const sdk = ThirdwebSDK.fromPrivateKey(
      process.env.PRIVATE_KEY,
      'polygon',
      {
        clientId: process.env.THIRDWEB_CLIENT_ID,
        secretKey: process.env.THIRDWEB_SECRET_KEY
      }
    );
    
    const address = await sdk.wallet.getAddress();
    log({
      name: 'Thirdweb SDK',
      status: 'PASS',
      message: `Connected with wallet ${address}`
    });
  } catch (error) {
    log({
      name: 'Thirdweb SDK',
      status: 'FAIL',
      message: error.message
    });
  }
}

async function testContractDeployment() {
  console.log('\n📜 Testing MEV Executor Contract...\n');
  
  try {
    const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const contractAddress = process.env.MEV_EXECUTOR_ADDRESS;
    
    const code = await provider.getCode(contractAddress);
    
    if (code === '0x') {
      log({
        name: 'MEV Contract',
        status: 'FAIL',
        message: `No contract found at ${contractAddress}`
      });
    } else {
      log({
        name: 'MEV Contract',
        status: 'PASS',
        message: `Contract deployed at ${contractAddress}`,
        details: { codeSize: code.length }
      });
      
      // Test contract owner
      const contract = new ethers.Contract(
        contractAddress,
        ['function owner() view returns (address)'],
        provider
      );
      
      const owner = await contract.owner();
      const expectedOwner = process.env.WALLET_ADDRESS;
      
      if (owner.toLowerCase() === expectedOwner?.toLowerCase()) {
        log({
          name: 'Contract Owner',
          status: 'PASS',
          message: `Owner matches wallet: ${owner}`
        });
      } else {
        log({
          name: 'Contract Owner',
          status: 'WARN',
          message: `Owner (${owner}) != Wallet (${expectedOwner})`
        });
      }
    }
  } catch (error) {
    log({
      name: 'MEV Contract',
      status: 'FAIL',
      message: error.message
    });
  }
}

async function testWalletBalance() {
  console.log('\n💰 Testing Wallet Balance...\n');
  
  try {
    const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const balance = await provider.getBalance(process.env.WALLET_ADDRESS);
    const balanceMATIC = ethers.utils.formatEther(balance);
    
    if (parseFloat(balanceMATIC) > 0.01) {
      log({
        name: 'Wallet Balance',
        status: 'PASS',
        message: `${balanceMATIC} MATIC (sufficient for gas)`
      });
    } else {
      log({
        name: 'Wallet Balance',
        status: 'WARN',
        message: `${balanceMATIC} MATIC (low - may need more for gas)`
      });
    }
  } catch (error) {
    log({
      name: 'Wallet Balance',
      status: 'FAIL',
      message: error.message
    });
  }
}

async function testDEXConnections() {
  console.log('\n🔄 Testing DEX Connectivity...\n');
  
  const dexes = [
    { name: 'QuickSwap', address: process.env.QUICKSWAP_ROUTER },
    { name: 'SushiSwap', address: process.env.SUSHISWAP_ROUTER },
    { name: 'Uniswap V3', address: process.env.UNISWAP_V3_ROUTER }
  ];
  
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  
  for (const dex of dexes) {
    try {
      const code = await provider.getCode(dex.address);
      if (code !== '0x') {
        log({
          name: `DEX: ${dex.name}`,
          status: 'PASS',
          message: `Contract found at ${dex.address.slice(0, 10)}...`
        });
      } else {
        log({
          name: `DEX: ${dex.name}`,
          status: 'FAIL',
          message: 'No contract at address'
        });
      }
    } catch (error) {
      log({
        name: `DEX: ${dex.name}`,
        status: 'FAIL',
        message: error.message
      });
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║          MEV BOT AI AGENT - SYSTEM HEALTH CHECK           ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  await testEnvironmentVariables();
  await testPolygonRPC();
  await testThirdwebSDK();
  await testContractDeployment();
  await testWalletBalance();
  await testDEXConnections();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Warnings: ${warned}`);
  console.log(`📋 Total: ${results.length}`);
  
  if (failed > 0) {
    console.log('\n❌ TESTS FAILED - Fix errors before starting agent');
    process.exit(1);
  } else if (warned > 0) {
    console.log('\n⚠️  TESTS PASSED WITH WARNINGS - Review warnings');
    console.log('   Agent may still work but some features might be limited');
  } else {
    console.log('\n✅ ALL TESTS PASSED - System ready!');
    console.log('\n🚀 Start the agent with: npm start');
  }
}

main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
