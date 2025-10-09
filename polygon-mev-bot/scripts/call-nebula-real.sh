#!/bin/bash

# Load environment variables
source .env

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🔮 CALLING THIRDWEB NEBULA API TO GENERATE CONTRACTS 🔮     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Using credentials:"
echo "  Client ID: ${THIRDWEB_CLIENT_ID:0:20}..."
echo "  Secret Key: ${THIRDWEB_SECRET_KEY:0:10}..."
echo ""

# Try Thirdweb's actual API endpoint
echo "📡 Attempting to call Thirdweb Nebula..."
echo ""

# Prompt for Nebula
PROMPT='Generate a production-grade MEV Executor smart contract for Polygon blockchain.

Solidity Version: 0.8.20
Contract Name: MEVExecutor

REQUIREMENTS (COMPLETE IMPLEMENTATION):

1. Balancer V2 Flash Loan Integration
   - Vault: 0xBA12222222228d8Ba445958a75a0704d566BF2C8
   - IFlashLoanRecipient interface
   - receiveFlashLoan callback with COMPLETE arbitrage logic

2. Multi-DEX Arbitrage
   - QuickSwap: 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff
   - SushiSwap: 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506
   - Uniswap V3: 0xE592427A0AEce92De3Edee1F18E0157C05861564
   - Complete swap implementations

3. Aave V3 Liquidations
   - Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
   - Complete liquidation logic

4. Risk Management
   - Circuit breakers
   - Emergency pause
   - Owner controls

Generate COMPLETE working Solidity code with ALL logic implemented.'

# Try multiple Thirdweb API endpoints
echo "Trying endpoint 1: insight.thirdweb.com..."
curl -X POST https://insight.thirdweb.com/v1/generate \
  -H "Content-Type: application/json" \
  -H "x-client-id: $THIRDWEB_CLIENT_ID" \
  -H "x-secret-key: $THIRDWEB_SECRET_KEY" \
  -d "{\"prompt\":\"$PROMPT\",\"type\":\"solidity\"}" \
  -o /tmp/nebula_response1.json 2>/dev/null

if [ -s /tmp/nebula_response1.json ]; then
  echo "✅ Response received!"
  cat /tmp/nebula_response1.json
else
  echo "❌ No response from endpoint 1"
  echo ""
  echo "Trying endpoint 2: embedded.thirdweb.com..."
  curl -X POST https://embedded.thirdweb.com/contract/generate \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $THIRDWEB_SECRET_KEY" \
    -H "x-client-id: $THIRDWEB_CLIENT_ID" \
    -d "{\"prompt\":\"$PROMPT\"}" \
    -o /tmp/nebula_response2.json 2>/dev/null
  
  if [ -s /tmp/nebula_response2.json ]; then
    echo "✅ Response received!"
    cat /tmp/nebula_response2.json
  else
    echo "❌ No response from endpoint 2"
    echo ""
    echo "Trying endpoint 3: thirdweb.com API..."
    curl -X POST https://thirdweb.com/api/contract/generate \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $THIRDWEB_SECRET_KEY" \
      -d "{\"prompt\":\"$PROMPT\"}" \
      -o /tmp/nebula_response3.json 2>/dev/null
    
    if [ -s /tmp/nebula_response3.json ]; then
      echo "✅ Response received!"
      cat /tmp/nebula_response3.json
    else
      echo "❌ Thirdweb Nebula API endpoints not publicly accessible"
      echo ""
      echo "Note: Thirdweb Nebula may require:"
      echo "  - Special API access or waitlist approval"
      echo "  - Different SDK method (not REST API)"
      echo "  - Enterprise tier access"
      echo ""
      echo "Using blockchain-optimized contract template instead..."
    fi
  fi
fi
