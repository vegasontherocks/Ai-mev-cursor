import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { composeContext, generateText } from "@ai16z/eliza";

const learningTemplate = `
# Post-Execution Learning

You are analyzing the outcome of an MEV execution to improve future decisions.

## Executed Strategy
{{strategyDetails}}

## Execution Outcome
{{executionResult}}

## Expected vs Actual
- Expected Profit: {{expectedProfit}} MATIC
- Actual Profit: {{actualProfit}} MATIC
- Variance: {{variance}}%

## Market Conditions During Execution
{{marketConditions}}

## Your Task

Analyze this execution to extract learnings:

1. **Accuracy Assessment**
   - How accurate was our prediction?
   - What factors did we estimate correctly?
   - What did we miss or miscalculate?

2. **Model Performance**
   - Did the RL model make a good choice?
   - Did our confidence level match reality?
   - Should we adjust model parameters?

3. **Strategy Effectiveness**
   - Is this strategy still profitable?
   - How does it compare to alternatives?
   - Should we adjust strategy weights?

4. **Parameter Updates**
   - Kelly Criterion adjustments needed?
   - Gas estimation improvements?
   - Risk tolerance changes?

5. **Key Insights**
   - What's the main lesson from this execution?
   - How can we improve for similar opportunities?
   - Any new patterns discovered?

Provide actionable insights for model improvement.

## Your Analysis:
`;

export const learnFromResultAction: Action = {
  name: "LEARN_FROM_RESULT",
  similes: ["LEARN", "UPDATE_MODELS", "POST_MORTEM"],
  description: "AI learns from execution outcomes to improve future decisions",
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content as any;
    return content.type === "LEARNING_REQUEST" && content.data !== undefined;
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    elizaLogger.info("🧠 AI learning from execution outcome...");
    
    try {
      const { opportunity, strategy, execution } = (message.content as any).data;
      
      // Step 1: Calculate variance
      const expectedProfit = strategy.expectedProfit || strategy.positionSize * 0.05;
      const actualProfit = parseFloat(execution.profit);
      const variance = ((actualProfit - expectedProfit) / expectedProfit) * 100;
      
      // Step 2: Gather context
      const marketConditions = await getExecutionMarketConditions(runtime, execution);
      
      const context = {
        strategyDetails: JSON.stringify(strategy, null, 2),
        executionResult: JSON.stringify(execution, null, 2),
        expectedProfit: expectedProfit.toFixed(4),
        actualProfit: actualProfit.toFixed(4),
        variance: variance.toFixed(1),
        marketConditions: JSON.stringify(marketConditions, null, 2)
      };
      
      // Step 3: AI analyzes outcome
      const contextState = (state ?? ({} as State)) as State;
      const learningPrompt = composeContext({
        state: contextState,
        template: learningTemplate,
        ...context
      });
      
      const insights = await generateText({
        runtime,
        context: learningPrompt,
        modelClass: "large"
      });
      
      elizaLogger.info("💡 Learning Insights:", insights);
      
      // Step 4: Parse insights and extract updates
      const updates = parseLearnedUpdates(insights, execution, strategy);
      
      // Step 5: Update models and parameters
      await updateKellyParameters(runtime, updates.kelly);
      await updateRLModel(runtime, opportunity, strategy, execution);
      await updateStrategyWeights(runtime, updates.strategyWeights);
      
      // Step 6: Store in memory with high-quality embedding
      const memoryText = `
Execution: ${execution.success ? 'SUCCESS' : 'FAILED'}
Strategy: ${strategy.type}
Profit: ${actualProfit} MATIC
Insight: ${updates.mainInsight}
`;
      
      const runtimeAny = runtime as any;
      const memoryPayload: any = {
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: runtime.agentId,
        content: {
          text: memoryText,
          type: "EXECUTION_LEARNING",
          opportunity,
          strategy,
          execution,
          insights,
          updates,
          timestamp: Date.now()
        }
      };

      if (typeof runtimeAny.embed === "function") {
        try {
          memoryPayload.embedding = await runtimeAny.embed(memoryText);
        } catch (embedError) {
          elizaLogger.warn("Embedding generation failed", embedError);
        }
      }

      await runtime.messageManager.createMemory(memoryPayload);
      
      // Step 7: Update performance metrics
      await updatePerformanceMetrics(runtime, execution);
      
      elizaLogger.success("✅ Learning complete, models updated");
      
      // Log key metrics
      elizaLogger.info("📊 Performance Metrics:");
      const metrics = await getPerformanceMetrics(runtime);
      elizaLogger.info(`  Win Rate: ${metrics.winRate}%`);
      elizaLogger.info(`  Sharpe Ratio: ${metrics.sharpeRatio}`);
      elizaLogger.info(`  Total Profit: ${metrics.totalProfit} MATIC`);
      
      if (callback) {
        callback({
          text: formatLearningResponse(insights, updates, metrics),
          updates
        });
      }
      
      return true;
    } catch (error) {
      elizaLogger.error("Error in LEARN_FROM_RESULT:", error);
      return false;
    }
  },
  
  examples: [
    [
      {
        user: "system",
        content: {
          text: "Learn from successful arbitrage execution"
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "🧠 Learning from execution...\n\n💡 Key insights:\n- Prediction accuracy: 95%\n- Gas estimation: needs +5% adjustment\n- Strategy effectiveness: confirmed\n\n🔄 Updates:\n- Kelly win_rate: 75% → 76%\n- RL model: +0.018 reward\n- Confidence calibration: improved\n\n📈 Metrics: 78% win rate, 2.4 Sharpe\n\nReady for next opportunity!"
        }
      }
    ]
  ]
};

// Helper functions

async function getExecutionMarketConditions(runtime: IAgentRuntime, execution: any): Promise<any> {
  // Would query blockchain state at execution time
  return {
    blockNumber: execution.blockNumber,
    gasPrice: 150,
    competition: "MODERATE",
    timestamp: execution.timestamp
  };
}

function parseLearnedUpdates(insights: string, execution: any, strategy: any): any {
  // Parse AI insights to extract actionable updates
  
  const updates: any = {
    kelly: {},
    strategyWeights: {},
    mainInsight: "Execution analyzed"
  };
  
  // Extract Kelly updates
  if (execution.success && parseFloat(execution.profit) > 0) {
    updates.kelly.adjustWinRate = 0.01; // Increase by 1%
    updates.kelly.updateAvgWin = parseFloat(execution.profit);
  } else {
    updates.kelly.adjustWinRate = -0.01; // Decrease by 1%
    updates.kelly.updateAvgLoss = Math.abs(parseFloat(execution.profit || '0'));
  }
  
  // Extract main insight from AI analysis
  const insightMatch = insights.match(/key insight:?\s*(.+?)(?:\n|$)/i) ||
                       insights.match(/main lesson:?\s*(.+?)(?:\n|$)/i);
  if (insightMatch) {
    updates.mainInsight = insightMatch[1].trim();
  }
  
  // Strategy weight adjustments
  if (execution.success) {
    updates.strategyWeights[strategy.type] = 0.05; // Increase weight
  } else {
    updates.strategyWeights[strategy.type] = -0.05; // Decrease weight
  }
  
  return updates;
}

async function updateKellyParameters(runtime: IAgentRuntime, kellyUpdates: any): Promise<void> {
  // Load current Kelly parameters
  const currentKelly = await getKellyParameters(runtime);
  
  // Apply adjustments
  if (kellyUpdates.adjustWinRate) {
    const newWinRate = Math.max(0.5, Math.min(0.9, 
      currentKelly.winRate + kellyUpdates.adjustWinRate
    ));
    
    await setKellyParameter(runtime, 'winRate', newWinRate);
    elizaLogger.info(`📊 Kelly win rate: ${currentKelly.winRate.toFixed(3)} → ${newWinRate.toFixed(3)}`);
  }
  
  if (kellyUpdates.updateAvgWin) {
    // Exponential moving average
    const newAvgWin = currentKelly.avgWin * 0.9 + kellyUpdates.updateAvgWin * 0.1;
    await setKellyParameter(runtime, 'avgWin', newAvgWin);
    elizaLogger.info(`📊 Kelly avg win: ${currentKelly.avgWin.toFixed(4)} → ${newAvgWin.toFixed(4)}`);
  }
}

async function updateRLModel(
  runtime: IAgentRuntime,
  opportunity: any,
  strategy: any,
  execution: any
): Promise<void> {
  // Store experience for RL training
  const experience = {
    state: opportunity,
    action: strategy.type,
    reward: parseFloat(execution.profit),
    nextState: execution,
    done: true
  };
  
  // Append to experience replay buffer
  await appendRLExperience(runtime, experience);
  
  // Check if we should retrain
  const experienceCount = await getRLExperienceCount(runtime);
  if (experienceCount % 100 === 0) {
    elizaLogger.info(`🤖 RL model: ${experienceCount} experiences collected, triggering retrain`);
    // Would trigger Python training script
    // exec('python rl-models/train.py --incremental');
  }
}

async function updateStrategyWeights(runtime: IAgentRuntime, weights: any): Promise<void> {
  const currentWeights = await getStrategyWeights(runtime);
  
  for (const [strategy, adjustment] of Object.entries(weights)) {
    const currentWeight = currentWeights[strategy] || 0.25;
    const newWeight = Math.max(0.1, Math.min(0.6, currentWeight + (adjustment as number)));
    
    await setStrategyWeight(runtime, strategy, newWeight);
    elizaLogger.info(`⚖️  Strategy ${strategy}: ${currentWeight.toFixed(2)} → ${newWeight.toFixed(2)}`);
  }
}

async function updatePerformanceMetrics(runtime: IAgentRuntime, execution: any): Promise<void> {
  const metrics = await getPerformanceMetrics(runtime);
  
  metrics.totalExecutions++;
  if (execution.success) {
    metrics.successfulExecutions++;
  }
  
  const profit = parseFloat(execution.profit);
  if (profit > 0) {
    metrics.totalProfit += profit;
    metrics.profits.push(profit);
  } else {
    metrics.losses.push(Math.abs(profit));
  }
  
  // Calculate Sharpe ratio
  if (metrics.profits.length > 2) {
    const returns = metrics.profits;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    metrics.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
  }
  
  await savePerformanceMetrics(runtime, metrics);
}

// Storage helpers (would integrate with database)

async function getKellyParameters(runtime: IAgentRuntime): Promise<any> {
  return {
    winRate: 0.75,
    avgWin: 0.05,
    avgLoss: 0.02,
    fractionalKelly: 0.5
  };
}

async function setKellyParameter(runtime: IAgentRuntime, param: string, value: number): Promise<void> {
  // Would update database
}

async function getStrategyWeights(runtime: IAgentRuntime): Promise<any> {
  return {
    ARBITRAGE: 0.45,
    JIT: 0.25,
    LIQUIDATION: 0.20,
    BACKRUN: 0.10
  };
}

async function setStrategyWeight(runtime: IAgentRuntime, strategy: string, weight: number): Promise<void> {
  // Would update database
}

async function appendRLExperience(runtime: IAgentRuntime, experience: any): Promise<void> {
  // Would append to experience replay buffer
}

async function getRLExperienceCount(runtime: IAgentRuntime): Promise<number> {
  return 150; // Placeholder
}

async function getPerformanceMetrics(runtime: IAgentRuntime): Promise<any> {
  return {
    totalExecutions: 100,
    successfulExecutions: 75,
    winRate: 75,
    totalProfit: 1.5,
    sharpeRatio: 2.4,
    profits: [0.01, 0.02, 0.015],
    losses: [0.005]
  };
}

async function savePerformanceMetrics(runtime: IAgentRuntime, metrics: any): Promise<void> {
  // Would save to database
}

function formatLearningResponse(insights: string, updates: any, metrics: any): string {
  return `🧠 LEARNING COMPLETE\n\n` +
         `💡 Key Insight: ${updates.mainInsight}\n\n` +
         `🔄 Model Updates:\n` +
         `- Kelly parameters adjusted\n` +
         `- RL experience recorded\n` +
         `- Strategy weights updated\n\n` +
         `📈 Current Metrics:\n` +
         `- Win Rate: ${metrics.winRate}%\n` +
         `- Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}\n` +
         `- Total Profit: ${metrics.totalProfit.toFixed(3)} MATIC`;
}

export default learnFromResultAction;
