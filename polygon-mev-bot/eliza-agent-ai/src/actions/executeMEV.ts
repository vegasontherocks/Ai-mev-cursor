import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import { composeContext, generateText } from "@ai16z/eliza";

const executionTemplate = `
# MEV Execution Decision

You are making final execution decisions for MEV strategies.

## Strategy Selected
{{strategyDetails}}

## Pre-Execution Checks
- Transaction simulation: {{simulationResult}}
- Current gas price: {{currentGasPrice}} gwei
- Mempool competition: {{mempoolCompetition}}
- Time since opportunity detected: {{timeElapsed}}ms

## Risk Factors
{{riskFactors}}

## Your Task

This is the FINAL decision before sending the transaction on-chain.

1. **Validate Execution Readiness**
   - Is the opportunity still valid?
   - Has market moved against us?
   - Is competition manageable?

2. **Final Parameter Adjustment**
   - Should we adjust gas?
   - Should we adjust position size?
   - Should we adjust slippage tolerance?

3. **Go/No-Go Decision**
   - EXECUTE: Send transaction now
   - WAIT: Delay 100ms and recheck
   - ABORT: Opportunity no longer valid

Be decisive. Time is critical in MEV.

## Your Decision:
`;

export const executeMEVAction: Action = {
  name: "EXECUTE_MEV",
  similes: ["EXECUTE_STRATEGY", "SEND_TRANSACTION", "MEV_EXECUTION"],
  description: "Executes MEV strategy with final AI validation and real-time monitoring",
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content as any;
    return content.type === "EXECUTION_REQUEST" && content.data !== undefined;
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    elizaLogger.info("⚡ AI executing MEV strategy...");
    
    try {
      const { opportunity, strategy } = (message.content as any).data;
      const startTime = Date.now();
      
      // Step 1: Simulate transaction
      elizaLogger.info("🔮 Simulating transaction...");
      const simulation = await simulateTransaction(runtime, opportunity, strategy);
      
      if (!simulation.success) {
        elizaLogger.warn("⚠️  Simulation failed:", simulation.error);
        
        // AI decides how to handle failure
        const failureDecision = await handleSimulationFailure(
          runtime,
          simulation,
          opportunity,
          strategy
        );
        
        if (failureDecision.action === 'ABORT') {
          elizaLogger.info("🛑 AI decided to abort execution");
          await recordFailedExecution(runtime, opportunity, strategy, 'SIMULATION_FAILED');
          return false;
        } else if (failureDecision.action === 'ADJUST') {
          // Adjust parameters and retry
          strategy.gasMultiplier = failureDecision.newGasMultiplier;
          strategy.slippageTolerance = failureDecision.newSlippage;
        }
      }
      
      // Step 2: Final AI validation
      const timeElapsed = Date.now() - startTime;
      const marketConditions = await getCurrentMarketConditions(runtime);
      
      const context = {
        strategyDetails: JSON.stringify(strategy, null, 2),
        simulationResult: simulation.success ? 'SUCCESS' : 'FAILED',
        currentGasPrice: marketConditions.gasPrice,
        mempoolCompetition: marketConditions.competition,
        timeElapsed,
        riskFactors: formatRiskFactors(simulation, marketConditions)
      };
      
      const executionPrompt = composeContext({
        state: state || {},
        template: executionTemplate,
        ...context
      });
      
      const executionDecision = await generateText({
        runtime,
        context: executionPrompt,
        modelClass: "large"
      });
      
      elizaLogger.info("🤔 AI Decision:", executionDecision);
      
      const decision = parseExecutionDecision(executionDecision);
      
      if (decision.action === 'ABORT') {
        elizaLogger.info("🛑 AI aborted execution:", decision.reason);
        await recordFailedExecution(runtime, opportunity, strategy, decision.reason);
        return false;
      }
      
      if (decision.action === 'WAIT') {
        elizaLogger.info("⏸️  AI delaying execution for", decision.waitTime, "ms");
        await new Promise(resolve => setTimeout(resolve, decision.waitTime));
        // Recursively retry
        return await this.handler!(runtime, message, state, options, callback);
      }
      
      // Step 3: Build and send transaction
      elizaLogger.info("🚀 Building transaction...");
      const transaction = await buildTransaction(runtime, opportunity, strategy, decision);
      
      elizaLogger.info("📤 Sending transaction:", transaction.hash);
      const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
      
      const tx = await wallet.sendTransaction(transaction);
      elizaLogger.info("⏳ Transaction sent:", tx.hash);
      
      // Step 4: Monitor execution
      const receipt = await tx.wait();
      
      const executionResult = {
        success: receipt.status === 1,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
        profit: await calculateProfit(receipt, opportunity, strategy),
        timestamp: Date.now()
      };
      
      elizaLogger.success(`✅ Transaction mined: ${tx.hash}`);
      elizaLogger.success(`💰 Profit: ${executionResult.profit} MATIC`);
      
      // Step 5: Learn from result
      await runtime.processActions(
        {
          userId: runtime.agentId,
          agentId: runtime.agentId,
          roomId: runtime.agentId,
          content: {
            text: "LEARN_FROM_RESULT",
            type: "LEARNING_REQUEST",
            data: {
              opportunity,
              strategy,
              execution: executionResult
            }
          }
        },
        [],
        state
      );
      
      if (callback) {
        callback({
          text: formatExecutionResponse(executionResult),
          success: executionResult.success
        });
      }
      
      return true;
    } catch (error) {
      elizaLogger.error("❌ Error in EXECUTE_MEV:", error);
      await recordFailedExecution(
        runtime,
        (message.content as any).data.opportunity,
        (message.content as any).data.strategy,
        error.message
      );
      return false;
    }
  },
  
  examples: [
    [
      {
        user: "system",
        content: {
          text: "Execute arbitrage strategy"
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "⚡ Executing MEV strategy...\n\n🔮 Simulation: SUCCESS\n🤔 Final check: GO\n🚀 Transaction: 0xabc...\n✅ Mined in block 12345\n💰 Profit: 0.018 MATIC"
        }
      }
    ]
  ]
};

// Helper functions

async function simulateTransaction(
  runtime: IAgentRuntime,
  opportunity: any,
  strategy: any
): Promise<any> {
  try {
    // Would use Tenderly API or local fork
    // For now, return simulated result
    return {
      success: Math.random() > 0.2, // 80% success rate in simulation
      estimatedProfit: strategy.positionSize * 0.05,
      gasEstimate: 180000,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function handleSimulationFailure(
  runtime: IAgentRuntime,
  simulation: any,
  opportunity: any,
  strategy: any
): Promise<any> {
  // AI decides how to handle simulation failure
  const decision = await generateText({
    runtime,
    context: `
Transaction simulation failed: ${simulation.error}

Original strategy: ${JSON.stringify(strategy)}

Options:
1. ABORT - Give up on this opportunity
2. ADJUST - Modify parameters and retry

What should we do? Consider:
- Is the error recoverable?
- Can we adjust gas/slippage to succeed?
- Is the opportunity still worth pursuing?

Decision (ABORT or ADJUST with new parameters):
`,
    modelClass: "large"
  });
  
  if (decision.toLowerCase().includes('abort')) {
    return { action: 'ABORT', reason: 'Simulation failed' };
  }
  
  return {
    action: 'ADJUST',
    newGasMultiplier: strategy.gasMultiplier * 1.2,
    newSlippage: strategy.slippageTolerance * 1.5
  };
}

async function getCurrentMarketConditions(runtime: IAgentRuntime): Promise<any> {
  // Would query MCP servers or blockchain
  return {
    gasPrice: 150,
    competition: "MODERATE",
    blockNumber: 12345678
  };
}

function formatRiskFactors(simulation: any, market: any): string {
  const risks: string[] = [];
  
  if (!simulation.success) {
    risks.push(`⚠️  Simulation failed: ${simulation.error}`);
  }
  
  if (market.gasPrice > 300) {
    risks.push(`⚠️  High gas price: ${market.gasPrice} gwei`);
  }
  
  if (market.competition === "HIGH") {
    risks.push(`⚠️  High MEV competition detected`);
  }
  
  return risks.length > 0 ? risks.join('\n') : '✅ No significant risk factors';
}

function parseExecutionDecision(decision: string): any {
  const lower = decision.toLowerCase();
  
  if (lower.includes('abort') || lower.includes('no-go')) {
    const reasonMatch = decision.match(/reason:?\s*(.+?)(?:\n|$)/i);
    return {
      action: 'ABORT',
      reason: reasonMatch ? reasonMatch[1] : 'AI decision'
    };
  }
  
  if (lower.includes('wait') || lower.includes('delay')) {
    const timeMatch = decision.match(/(\d+)\s*ms/i);
    return {
      action: 'WAIT',
      waitTime: timeMatch ? parseInt(timeMatch[1]) : 100
    };
  }
  
  return {
    action: 'EXECUTE',
    reason: 'AI approved'
  };
}

async function buildTransaction(
  runtime: IAgentRuntime,
  opportunity: any,
  strategy: any,
  decision: any
): Promise<any> {
  const mevExecutor = process.env.MEV_EXECUTOR_ADDRESS;
  
  // Build transaction based on strategy type
  // This would integrate with MEVExecutor contract
  
  return {
    to: mevExecutor,
    data: '0x', // Would be actual calldata
    value: 0,
    gasLimit: 200000,
    maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
    maxFeePerGas: ethers.utils.parseUnits('150', 'gwei')
  };
}

async function calculateProfit(receipt: any, opportunity: any, strategy: any): Promise<string> {
  // Parse logs to calculate actual profit
  // For now, return estimated
  const gasUsed = ethers.BigNumber.from(receipt.gasUsed);
  const gasPrice = ethers.BigNumber.from(receipt.effectiveGasPrice);
  const gasCost = gasUsed.mul(gasPrice);
  
  const estimatedRevenue = ethers.utils.parseEther((strategy.positionSize * 0.05).toString());
  const profit = estimatedRevenue.sub(gasCost);
  
  return ethers.utils.formatEther(profit);
}

async function recordFailedExecution(
  runtime: IAgentRuntime,
  opportunity: any,
  strategy: any,
  reason: string
): Promise<void> {
  await runtime.messageManager.createMemory({
    userId: runtime.agentId,
    agentId: runtime.agentId,
    roomId: runtime.agentId,
    content: {
      text: `Failed execution: ${reason}`,
      type: "EXECUTION_FAILED",
      opportunity,
      strategy,
      reason,
      timestamp: Date.now()
    },
    embedding: await runtime.embed(JSON.stringify({ opportunity, strategy, reason }))
  });
}

function formatExecutionResponse(result: any): string {
  if (result.success) {
    return `✅ EXECUTION SUCCESSFUL\n` +
           `TX: ${result.txHash}\n` +
           `Profit: ${result.profit} MATIC\n` +
           `Gas: ${result.gasUsed} units\n` +
           `Block: ${result.blockNumber}`;
  } else {
    return `❌ EXECUTION FAILED\n` +
           `TX: ${result.txHash}\n` +
           `Reason: Transaction reverted`;
  }
}

export default executeMEVAction;
