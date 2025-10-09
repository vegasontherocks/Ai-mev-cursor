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

# Submit verification using standard format
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

echo "$RESPONSE" | jq '.'

STATUS=$(echo "$RESPONSE" | jq -r '.status')
MESSAGE=$(echo "$RESPONSE" | jq -r '.message')
RESULT=$(echo "$RESPONSE" | jq -r '.result')

if [ "$STATUS" == "1" ]; then
    echo ""
    echo "✅ Verification submitted successfully!"
    echo "GUID: $RESULT"
    echo ""
    echo "⏳ Checking verification status..."
    sleep 5
    
    # Check status
    for i in {1..12}; do
        STATUS_RESPONSE=$(curl -s "https://api.polygonscan.com/api?module=contract&action=checkverifystatus&guid=$RESULT&apikey=$POLYGONSCAN_API_KEY")
        echo "$STATUS_RESPONSE" | jq '.'
        
        STATUS_CHECK=$(echo "$STATUS_RESPONSE" | jq -r '.status')
        RESULT_CHECK=$(echo "$STATUS_RESPONSE" | jq -r '.result')
        
        if [ "$STATUS_CHECK" == "1" ]; then
            echo ""
            echo "✅ CONTRACT VERIFIED SUCCESSFULLY!"
            echo "View at: https://polygonscan.com/address/$CONTRACT_ADDRESS#code"
            exit 0
        elif [[ "$RESULT_CHECK" == *"Fail"* ]] || [[ "$RESULT_CHECK" == *"fail"* ]]; then
            echo ""
            echo "❌ Verification failed: $RESULT_CHECK"
            exit 1
        fi
        
        echo "⏳ Still pending... waiting 10 seconds (attempt $i/12)"
        sleep 10
    done
    
    echo ""
    echo "⏳ Verification still pending. Check manually at:"
    echo "https://polygonscan.com/address/$CONTRACT_ADDRESS"
else
    echo ""
    echo "❌ Submission failed: $MESSAGE - $RESULT"
    exit 1
fi
