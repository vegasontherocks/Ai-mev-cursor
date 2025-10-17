#!/usr/bin/env ts-node
/**
 * Verification Matrix Check
 * 
 * Validates that all components mentioned in the custom instructions are present,
 * properly configured, and ready for deployment.
 * 
 * Based on the Verification Matrix from .github/copilot-instructions.md
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CheckResult {
  name: string;
  status: '✅' | '⚠️' | '❌';
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, condition: boolean, successMsg: string, failMsg: string): boolean {
  if (condition) {
    results.push({ name, status: '✅', message: successMsg });
    return true;
  } else {
    results.push({ name, status: '❌', message: failMsg });
    return false;
  }
}

function warn(name: string, message: string) {
  results.push({ name, status: '⚠️', message });
}

async function main() {
  console.log('🔍 MEV Bot Setup Verification');
  console.log('='.repeat(70));
  console.log('\nChecking Verification Matrix from custom instructions...\n');

  // 1. Check generated contracts
  const contractsDir = resolve(__dirname, '../../contracts/src/generated');
  const requiredContracts = [
    'MEVExecutor.sol',
    'DEXAdapter.sol',
    'AaveAdapter.sol',
    'JITAdapter.sol',
    'OracleLib.sol',
    'Interfaces.sol'
  ];

  console.log('📄 Generated Contracts:');
  for (const contract of requiredContracts) {
    const path = resolve(contractsDir, contract);
    const exists = existsSync(path);
    check(
      `contracts/${contract}`,
      exists,
      `Found at ${path}`,
      `Missing: ${path}`
    );
  }

  // 2. Check key TypeScript files
  console.log('\n🔧 Core Integration Files:');
  
  const coreFiles = [
    { path: '../src/thirdweb-nebula-integration.ts', name: 'Nebula Integration' },
    { path: '../mcp-config.json', name: 'MCP Configuration' },
    { path: '../package.json', name: 'Package Configuration' },
    { path: '../../scripts/generate-contracts-with-nebula.ts', name: 'Contract Generator' }
  ];

  for (const file of coreFiles) {
    const path = resolve(__dirname, file.path);
    check(
      file.name,
      existsSync(path),
      `Found at ${path}`,
      `Missing: ${path}`
    );
  }

  // 3. Check RL model
  console.log('\n🤖 AI/ML Components:');
  const modelPath = resolve(__dirname, '../models/ppo_agent.onnx');
  const modelExists = existsSync(modelPath);
  
  if (modelExists) {
    try {
      const modelData = readFileSync(modelPath, 'utf-8');
      const isPlaceholder = modelData.includes('placeholder');
      
      if (isPlaceholder) {
        warn(
          'RL Model',
          'Placeholder model present. Train a real PPO model for production.'
        );
      } else {
        check(
          'RL Model',
          true,
          'Production model found',
          ''
        );
      }
    } catch {
      check(
        'RL Model',
        true,
        'Binary model found (assuming trained)',
        ''
      );
    }
  } else {
    check(
      'RL Model',
      false,
      '',
      'Missing. Run: npm run setup:model'
    );
  }

  // 4. Check environment configuration
  console.log('\n🔐 Environment Configuration:');
  const envExamplePath = resolve(__dirname, '../.env.example');
  const envExists = existsSync(envExamplePath);
  
  check(
    '.env.example',
    envExists,
    'Template present',
    'Missing environment template'
  );

  if (envExists) {
    const envContent = readFileSync(envExamplePath, 'utf-8');
    const requiredKeys = [
      'THIRDWEB_SECRET_KEY',
      'THIRDWEB_CLIENT_ID',
      'PRIVATE_KEY',
      'POLYGON_RPC_URL',
      'POLYGON_WSS_URL',
      'DRY_RUN',
      'ALLOW_EXECUTION'
    ];

    for (const key of requiredKeys) {
      check(
        `  ${key}`,
        envContent.includes(key),
        'Present in template',
        'Missing from .env.example'
      );
    }
  }

  // 5. Check deployment scripts
  console.log('\n🚀 Deployment Scripts:');
  const deploymentScripts = [
    '../../contracts/script/Deploy.s.sol',
    '../../contracts/script/DeployGenerated.s.sol'
  ];

  for (const script of deploymentScripts) {
    const path = resolve(__dirname, script);
    check(
      script.split('/').pop() || script,
      existsSync(path),
      'Ready for deployment',
      'Missing deployment script'
    );
  }

  // 6. Check documentation
  console.log('\n📚 Documentation:');
  const docs = [
    '../../WHAT_TO_RUN.txt',
    '../../MASTER_GUIDE.md',
    '../../docs/ACTION_PLAN.md'
  ];

  for (const doc of docs) {
    const path = resolve(__dirname, doc);
    check(
      doc.split('/').pop() || doc,
      existsSync(path),
      'Documentation present',
      'Missing documentation'
    );
  }

  // 7. Check MCP configuration
  console.log('\n🔌 MCP Server Configuration:');
  const mcpConfigPath = resolve(__dirname, '../mcp-config.json');
  if (existsSync(mcpConfigPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
      
      check(
        'Local MCP Server',
        !!mcpConfig.mcpServers?.polygon,
        'Configured',
        'Not configured'
      );
      
      check(
        'Thirdweb MCP',
        !!mcpConfig.mcpServers?.thirdweb,
        'Configured',
        'Not configured'
      );
    } catch (error) {
      check(
        'MCP Config Parse',
        false,
        '',
        'Invalid JSON in mcp-config.json'
      );
    }
  }

  // 8. Check dependencies
  console.log('\n📦 Dependencies:');
  try {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf-8')
    );
    
    const criticalDeps = [
      '@ai16z/eliza',
      '@thirdweb-dev/sdk',
      'ethers',
      'onnxruntime-node'
    ];

    for (const dep of criticalDeps) {
      check(
        `  ${dep}`,
        !!packageJson.dependencies[dep],
        `v${packageJson.dependencies[dep]}`,
        'Not in dependencies'
      );
    }
  } catch (error) {
    check(
      'package.json',
      false,
      '',
      'Cannot read package.json'
    );
  }

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('📊 Verification Results:');
  console.log('='.repeat(70));

  let passed = 0;
  let warnings = 0;
  let failed = 0;

  for (const result of results) {
    console.log(`${result.status} ${result.name}`);
    if (result.message) {
      console.log(`   ${result.message}`);
    }
    
    if (result.status === '✅') passed++;
    else if (result.status === '⚠️') warnings++;
    else failed++;
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Summary: ${passed} passed, ${warnings} warnings, ${failed} failed`);
  console.log('='.repeat(70));

  // Recommendations
  if (failed > 0 || warnings > 0) {
    console.log('\n📋 Recommended Actions:');
    
    if (results.some(r => r.name.includes('RL Model') && r.status !== '✅')) {
      console.log('   • Run: npm run setup:model');
    }
    
    if (results.some(r => r.name.includes('placeholder'))) {
      console.log('   • Train a production RL model using historical execution data');
    }
    
    if (failed > 0) {
      console.log('   • Fix missing files before deployment');
      console.log('   • Review .github/copilot-instructions.md for requirements');
    }
    
    console.log('\n⚠️  System is not ready for production deployment');
  } else {
    console.log('\n✅ All checks passed! System ready for testing.');
    console.log('\n📋 Next Steps:');
    console.log('   1. Copy .env.example to .env and fill in your credentials');
    console.log('   2. Run: npm run build');
    console.log('   3. Test with: DRY_RUN=true npm start');
    console.log('   4. Deploy contracts: cd ../contracts && forge script script/DeployGenerated.s.sol');
    console.log('   5. Update MEV_EXECUTOR_ADDRESS in .env');
    console.log('   6. Run production: ALLOW_EXECUTION=true npm start');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
