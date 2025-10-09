#!/bin/bash
set -e

echo "🔍 Starting Contract Verification..."
echo ""

# Load environment variables
source .env

CONTRACT_ADDRESS="0x0CD75B9605ad928a47616a6a1549FC856c07dbB7"
CONTRACT_NAME="MEVExecutor"
COMPILER_VERSION="v0.8.20+commit.a1b79de6"
CONSTRUCTOR_ARGS="000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8"

echo "Contract: $CONTRACT_ADDRESS"
echo "Compiler: $COMPILER_VERSION"
echo "API Key: ${POLYGONSCAN_API_KEY:0:10}..."
echo ""

# Read the flattened source code
SOURCE_CODE=$(cat contracts/MEVExecutor_flattened.sol)

echo "📤 Submitting verification to PolygonScan..."
echo ""

# Submit verification
RESPONSE=$(curl -s -X POST "https://api.polygonscan.com/api" \
  --data-urlencode "apikey=$POLYGONSCAN_API_KEY" \
  --data-urlencode "module=contract" \
  --data-urlencode "action=verifysourcecode" \
  --data-urlencode "contractaddress=$CONTRACT_ADDRESS" \
  --data-urlencode "sourceCode=$SOURCE_CODE" \
  --data-urlencode "codeformat=solidity-single-file" \
  --data-urlencode "contractname=$CONTRACT_NAME" \
  --data-urlencode "compilerversion=$COMPILER_VERSION" \
  --data-urlencode "optimizationUsed=1" \
  --data-urlencode "runs=200" \
  --data-urlencode "constructorArguements=$CONSTRUCTOR_ARGS" \
  --data-urlencode "evmversion=default" \
  --data-urlencode "licenseType=3")

echo "Response:"
echo "$RESPONSE"
echo ""

# Check if successful
if echo "$RESPONSE" | grep -q '"status":"1"'; then
    GUID=$(echo "$RESPONSE" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
    echo "✅ Verification submitted successfully!"
    echo "GUID: $GUID"
    echo ""
    echo "⏳ Waiting 5 seconds before checking status..."
    sleep 5
    
    # Check status multiple times
    for i in {1..15}; do
        echo "⏳ Checking verification status (attempt $i/15)..."
        STATUS_RESPONSE=$(curl -s "https://api.polygonscan.com/api?module=contract&action=checkverifystatus&guid=$GUID&apikey=$POLYGONSCAN_API_KEY")
        echo "$STATUS_RESPONSE"
        echo ""
        
        if echo "$STATUS_RESPONSE" | grep -q '"status":"1"'; then
            echo ""
            echo "✅✅✅ CONTRACT VERIFIED SUCCESSFULLY! ✅✅✅"
            echo ""
            echo "🔗 View your verified contract:"
            echo "   https://polygonscan.com/address/$CONTRACT_ADDRESS#code"
            echo ""
            exit 0
        elif echo "$STATUS_RESPONSE" | grep -qi "fail"; then
            echo ""
            echo "❌ Verification failed. Response:"
            echo "$STATUS_RESPONSE"
            echo ""
            echo "This might be a compiler version or source code mismatch."
            exit 1
        fi
        
        sleep 10
    done
    
    echo ""
    echo "⏳ Verification still pending after 150 seconds."
    echo "Check status manually at:"
    echo "https://polygonscan.com/address/$CONTRACT_ADDRESS"
    exit 0
else
    echo "❌ Verification submission failed. Response:"
    echo "$RESPONSE"
    exit 1
fi
