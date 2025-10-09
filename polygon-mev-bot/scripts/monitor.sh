#!/bin/bash

# Monitoring Script for MEV Bot
# Shows real-time statistics and status

set -e

# Load environment
source .env

if [ -z "$MEV_EXECUTOR_ADDRESS" ]; then
    echo "❌ MEV_EXECUTOR_ADDRESS not set in .env"
    echo "Deploy the contract first!"
    exit 1
fi

echo "📊 MEV Bot Monitor"
echo "================="
echo "Contract: $MEV_EXECUTOR_ADDRESS"
echo ""

# Function to query stats
query_stats() {
    echo "Execution Statistics:"
    echo "--------------------"
    
    STATS=$(cast call $MEV_EXECUTOR_ADDRESS \
        "getStats()(uint256,uint256,uint256,uint256,uint256,uint256)" \
        --rpc-url $POLYGON_RPC_URL)
    
    # Parse stats (simplified)
    echo "  Total Executions: $(echo $STATS | cut -d' ' -f1)"
    echo "  Successful: $(echo $STATS | cut -d' ' -f2)"
    echo "  Total Profit: $(echo $STATS | cut -d' ' -f3)"
    echo ""
}

# Function to query circuit breaker
query_circuit_breaker() {
    echo "Circuit Breaker Status:"
    echo "----------------------"
    
    CB=$(cast call $MEV_EXECUTOR_ADDRESS \
        "circuitBreaker()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)" \
        --rpc-url $POLYGON_RPC_URL)
    
    echo "  Status: $(echo $CB | cut -d' ' -f8)"
    echo ""
}

# Function to check balance
query_balance() {
    echo "Contract Balance:"
    echo "----------------"
    
    BALANCE=$(cast balance $MEV_EXECUTOR_ADDRESS --rpc-url $POLYGON_RPC_URL)
    BALANCE_ETH=$(echo "scale=4; $BALANCE / 1000000000000000000" | bc)
    
    echo "  MATIC: $BALANCE_ETH"
    echo ""
}

# Main monitoring loop
while true; do
    clear
    echo "📊 MEV Bot Monitor - $(date)"
    echo "================================================"
    echo "Contract: $MEV_EXECUTOR_ADDRESS"
    echo ""
    
    query_balance
    query_stats
    query_circuit_breaker
    
    echo "Press Ctrl+C to exit"
    echo "Refreshing in 10 seconds..."
    
    sleep 10
done
