import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { composeContext, generateText } from "@ai16z/eliza";
import * as ort from 'onnxruntime-node';

const strategyTemplate = `
# MEV Strategy Selection

You are optimizing strategy selection for MEV execution.

## Opportunity Details
{{opportunityDetails}}

## AI Analysis Result
{{aiAnalysis}}

## RL Model Recommendation
The reinforcement learning model suggests:
- Strategy: {{rlStrategy}}
- Confidence: {{rlConfidence}}%
- Reasoning: Based on {{trainingExperiences}} past experiences

## Market Conditions
- Current competition level: {{competition}}
- Network state: {{networkState}}
- Recent performance by strategy:
  * Arbitrage: {{arbPerf}}% win rate
  * JIT: {{jitPerf}}% win rate
  * Liquidation: {{liqPerf}}% win rate

## Gas Strategy Analysis
- Current gas price: {{gasPrice}} gwei
- Recommended multiplier: {{gasMultiplier}}x
- Expected execution cost: {{expectedGas}} MATIC

## Your Task

1. **Validate RL Model Choice**
   - Does the RL recommendation make sense?
   - Are there factors the model might have missed?
   - Should we override with a different strategy?

2. **Optimize Execution Parameters**
   - Position size (Kelly Criterion)
   - Gas bidding strategy
   - Slippage tolerance
   - Timing (immediate vs wait)

3. **Risk/Reward Assessment**
   - Expected profit: $_____
   - Risk level: LOW/MEDIUM/HIGH
   - Max acceptable loss: $_____

4. **Final Decision**
   - Confirmed strategy: _____
   - Position size: _____ MATIC
   - Gas multiplier: _____x
   - Confidence: _____%
   - Execute: YES/NO

Provide clear, quantitative reasoning.

## Your Strategic Analysis:
`;

export const selectStrategyAction: Action = {
  name: "SELECT_STRATEGY",
  similes: ["CHOOSE_STRATEGY", "OPTIMIZE_STRATEGY", "STRATEGY_SELECTION"],
  description: "Uses RL model + LLM validation to select optimal MEV strategy",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content as any;
    return content.type === "STRATEGY_SELECTION_REQUEST" && content.data !== undefined;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    elizaLogger.info("🎯 AI selecting strategy using RL + LLM reasoning...");

    try {
      const { opportunity, analysis } = (message.content as any).data;

      // Step 1: Get RL model recommendation
      elizaLogger.info("🤖 Querying RL model...");
      const rlRecommendation = await getRLRecommendation(opportunity);

      // Step 2: Gather additional context
      const strategyPerformance = await getStrategyPerformance(runtime);
      const marketConditions = await getMarketConditions(runtime);

      // Step 3: LLM validates and optimizes
      const context = {
        opportunityDetails: JSON.stringify(opportunity, null, 2),
        aiAnalysis: JSON.stringify(analysis, null, 2),
        rlStrategy: rlRecommendation.strategy,
        rlConfidence: rlRecommendation.confidence.toFixed(1),
        trainingExperiences: rlRecommendation.experienceCount || 1000,
        competition: marketConditions.competition,
        networkState: marketConditions.networkState,
        arbPerf: strategyPerformance.ARBITRAGE,
        jitPerf: strategyPerformance.JIT,
        liqPerf: strategyPerformance.LIQUIDATION,
        gasPrice: marketConditions.gasPrice,
        gasMultiplier: calculateGasMultiplier(opportunity, marketConditions),
        expectedGas: estimateGasCost(opportunity, marketConditions)
      };

      const strategyPrompt = composeContext({
        state: (state as State) || ({} as unknown as State),
        template: strategyTemplate,
        ...context
      });

      elizaLogger.debug("Sending to LLM for strategy validation...");

      const strategyAnalysis = await generateText({
        runtime,
        context: strategyPrompt,
        modelClass: "large"
      });

      elizaLogger.info("📊 Strategy Analysis:", strategyAnalysis);

      // Parse final strategy
      const finalStrategy = parseStrategyDecision(strategyAnalysis, rlRecommendation);

      // Store decision in memory
      await runtime.messageManager.createMemory({
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: runtime.agentId,
        content: {
          text: strategyAnalysis,
          type: "STRATEGY_SELECTION",
          opportunity,
          rlRecommendation,
          finalStrategy,
          timestamp: Date.now()
        }
      });

      elizaLogger.success(`✅ Final Strategy: ${finalStrategy.type} (confidence: ${finalStrategy.confidence}%)`);

      // If confident, execute
      if (finalStrategy.shouldExecute && finalStrategy.confidence >= 75) {
        await runtime.processActions(
          {
            userId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: runtime.agentId,
            content: {
              text: "EXECUTE_MEV",
              type: "EXECUTION_REQUEST",
              data: {
                opportunity,
                strategy: finalStrategy
              }
            }
          },
          [],
          state
        );
      } else {
        elizaLogger.info(`⏭️  Not executing: confidence too low (${finalStrategy.confidence}%)`);
      }

      if (callback) {
        callback({
          text: formatStrategyResponse(finalStrategy),
          action: finalStrategy.shouldExecute ? "EXECUTE" : "SKIP"
        });
      }

      return true;
    } catch (error) {
      elizaLogger.error("Error in SELECT_STRATEGY:", error);
      return false;
    }
  },

  examples: [
    [
      {
        user: "system",
        content: {
          text: "Strategy selection required for arbitrage opportunity"
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "🎯 Strategy Selection:\n\nRL Model suggests: ARBITRAGE (confidence: 84%)\nLLM validation: CONFIRMED\n\nOptimized parameters:\n- Position: 0.42 MATIC (Kelly)\n- Gas: 1.2x multiplier\n- Expected profit: 0.018 MATIC\n\nExecuting strategy..."
        }
      }
    ]
  ]
};

// RL Model Integration

let rlSession: ort.InferenceSession | null = null;

async function getRLRecommendation(opportunity: any): Promise<any> {
  try {
    // Load RL model if not loaded
    if (!rlSession) {
      const modelPath = process.env.RL_MODEL_PATH || './models/ppo_agent.onnx';
      rlSession = await ort.InferenceSession.create(modelPath);
      elizaLogger.info("✅ RL model loaded");
    }

    // Extract features from opportunity
    const features = extractRLFeatures(opportunity);
    const inputTensor = new ort.Tensor('float32', features, [1, features.length]);

    // Run inference
    const results = await rlSession.run({ input: inputTensor });
    const actionProbs = Array.from(results.output.data as Float32Array);

    // Map to strategies
    const strategies = ['ARBITRAGE', 'JIT', 'LIQUIDATION', 'BACKRUN'];
    const bestIdx = actionProbs.indexOf(Math.max(...actionProbs));

    return {
      strategy: strategies[bestIdx],
      confidence: actionProbs[bestIdx] * 100,
      allProbs: actionProbs,
      experienceCount: 1500 // Would track this in production
    };
  } catch (error) {
    elizaLogger.warn("RL model not available, using heuristic:", error);

    // Fallback to simple heuristic
    if (opportunity.type === 'ARBITRAGE') {
      return { strategy: 'ARBITRAGE', confidence: 70, experienceCount: 0 };
    }
    return { strategy: opportunity.type, confidence: 60, experienceCount: 0 };
  }
}

function extractRLFeatures(opportunity: any): Float32Array {
  // State vector: [price_diff, liquidity, gas_price, congestion, time_of_day, recent_win_rate, competition]
  return new Float32Array([
    opportunity.priceDiff || 0.005,
    Math.log(opportunity.liquidity || 100000) / 20, // Normalized
    (opportunity.gasEstimate || 150) / 500, // Normalized
    0.5, // Network congestion (placeholder)
    (new Date().getHours()) / 24, // Time of day normalized
    0.75, // Recent win rate (placeholder)
    0.3 // Competition level (placeholder)
  ]);
}

async function getStrategyPerformance(runtime: IAgentRuntime): Promise<any> {
  // Query memory for recent strategy performance
  // This would calculate win rates from past executions
  return {
    ARBITRAGE: 75,
    JIT: 68,
    LIQUIDATION: 82,
    BACKRUN: 55
  };
}

async function getMarketConditions(runtime: IAgentRuntime): Promise<any> {
  // Would integrate with MCP servers / blockchain data
  return {
    competition: "MODERATE",
    networkState: "NORMAL",
    gasPrice: 150
  };
}

function calculateGasMultiplier(opportunity: any, market: any): number {
  // Dynamic gas multiplier based on opportunity value and competition
  const baseMultiplier = 1.1;
  const competitionBonus = market.competition === "HIGH" ? 0.3 : 0.1;
  const valueBonus = (opportunity.expectedProfit || 0.02) > 0.1 ? 0.2 : 0;

  return baseMultiplier + competitionBonus + valueBonus;
}

function estimateGasCost(opportunity: any, market: any): string {
  const gasLimit = opportunity.type === 'ARBITRAGE' ? 200000 : 300000;
  const gasPrice = market.gasPrice || 150;
  const gasCostGwei = gasLimit * gasPrice;
  const gasCostMatic = gasCostGwei / 1e9;

  return gasCostMatic.toFixed(4);
}

function parseStrategyDecision(analysis: string, rlRec: any): any {
  const lines = analysis.toLowerCase();

  // Parse strategy
  let strategy = rlRec.strategy;
  if (lines.includes('arbitrage')) strategy = 'ARBITRAGE';
  else if (lines.includes('jit')) strategy = 'JIT';
  else if (lines.includes('liquidation')) strategy = 'LIQUIDATION';
  else if (lines.includes('backrun')) strategy = 'BACKRUN';

  // Parse execute decision
  const shouldExecute = lines.includes('execute: yes') ||
    (lines.includes('yes') && !lines.includes('no'));

  // Parse confidence
  const confidenceMatch = analysis.match(/confidence:?\s*(\d{1,3})%/i);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : rlRec.confidence;

  // Parse position size
  const positionMatch = analysis.match(/position size:?\s*(\d+\.?\d*)\s*matic/i);
  const positionSize = positionMatch ? parseFloat(positionMatch[1]) : 0.1;

  // Parse gas multiplier
  const gasMatch = analysis.match(/gas multiplier:?\s*(\d+\.?\d*)x/i);
  const gasMultiplier = gasMatch ? parseFloat(gasMatch[1]) : 1.1;

  return {
    type: strategy,
    shouldExecute,
    confidence,
    positionSize,
    gasMultiplier,
    fullAnalysis: analysis
  };
}

function formatStrategyResponse(strategy: any): string {
  if (strategy.shouldExecute) {
    return `✅ EXECUTING ${strategy.type}\n` +
      `Confidence: ${strategy.confidence}%\n` +
      `Position: ${strategy.positionSize} MATIC\n` +
      `Gas: ${strategy.gasMultiplier}x multiplier`;
  } else {
    return `⏭️  STRATEGY SELECTED BUT NOT EXECUTING\n` +
      `Reason: Confidence below threshold`;
  }
}

export default selectStrategyAction;
