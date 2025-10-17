#!/usr/bin/env node
/**
 * Post-install setup script
 * Automatically runs after npm install to ensure the system is ready
 */

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔧 Running post-install setup...\n');

// Check if RL model exists
const modelPath = resolve(__dirname, '../models/ppo_agent.onnx');

if (!existsSync(modelPath)) {
  console.log('📥 RL model not found, creating placeholder...');
  try {
    execSync('npm run setup:model', { 
      cwd: resolve(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('⚠️  Could not setup RL model. Run manually: npm run setup:model');
  }
} else {
  console.log('✅ RL model already present');
}

// Check if .env exists
const envPath = resolve(__dirname, '../.env');
const envExamplePath = resolve(__dirname, '../.env.example');

if (!existsSync(envPath) && existsSync(envExamplePath)) {
  console.log('\n⚠️  .env file not found!');
  console.log('   Copy .env.example to .env and fill in your credentials:');
  console.log('   cp .env.example .env');
} else if (existsSync(envPath)) {
  console.log('✅ .env file present');
}

// Check if contracts directory exists (we're in eliza-agent-ai)
const contractsDir = resolve(__dirname, '../../contracts/src/generated');
if (existsSync(contractsDir)) {
  console.log('✅ Generated contracts found');
} else {
  console.log('⚠️  Generated contracts not found at expected location');
}

console.log('\n✅ Post-install setup complete!');
console.log('\n📋 Next steps:');
console.log('   1. Run verification: npm run verify:setup');
console.log('   2. Copy and configure .env: cp .env.example .env');
console.log('   3. Build the project: npm run build');
console.log('   4. Start in dry-run: DRY_RUN=true npm start');
console.log('\n📚 See SETUP_GUIDE.md for detailed instructions\n');
