import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { composeContext, generateText } from "@ai16z/eliza";

interface OpportunityData {
  type: 'ARBITRAGE' | 'JIT' | 'LIQUIDATION' | 'BACKRUN';
  dex?: string;
  tokenA?: string;
  tokenB?: string;
  priceDiff?: number;
  liquidity?: number;
  gasEstimate?: number;
  timestamp: number;
}

const opportunityTemplate = `
# MEV Opportunity Analysis

You are an expert MEV trader AI analyzing opportunities on Polygon network.

## Current Opportunity
{{opportunityDetails}}

## Market Context
- Current Gas Price: {{gasPrice}} gwei
- Network Congestion: {{congestion}}
- Recent Win Rate: {{winRate}}%
- Active Competitors: {{competitors}}
- Time of Day: {{timeOfDay}}

## Historical Context
{{similarOpportunities}}

## Your Task
Analyze this opportunity using the following framework:

1. **Profitability Analysis**
   - Calculate expected profit after gas costs
   - Consider slippage and price impact
   - Factor in competition probability

2. **Risk Assessment**
   - What could go wrong?
   - Frontrunning risk level?
   - Liquidity risk?
   - Smart contract risk?

3. **Execution Strategy**
   - Optimal position size using Kelly Criterion
   - Gas bidding strategy
   - Timing considerations
   - Fallback plans

4. **Decision**
   - Should we execute? (YES/NO/WAIT)
   - Confidence level (0-100%)
   - Recommended position size

Be precise, quantitative, and explain your reasoning clearly.

## Your Analysis:
`;

export const analyzeOpportunityAction: Action = {
  name: "ANALYZE_OPPORTUNITY",
  similes: ["ANALYZE_MEV", "EVALUATE_OPPORTUNITY", "ASSESS_TRADE"],
  description: "Uses AI reasoning to analyze MEV opportunities and decide whether to execute",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content = message.content as any;
    return content.type === "OPPORTUNITY_DETECTED" && content.data !== undefined;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    elizaLogger.info("🧠 AI analyzing opportunity with LLM reasoning...");

    try {
      const opportunity: OpportunityData = (message.content as any).data;

      // Gather market context
      const marketContext = await gatherMarketContext(runtime);

      // Find similar opportunities from memory
      const similarOpps = await findSimilarOpportunities(runtime, opportunity);

      // Compose context for LLM
      const context = {
        opportunityDetails: formatOpportunity(opportunity),
        gasPrice: marketContext.gasPrice,
        congestion: marketContext.congestion,
        winRate: marketContext.winRate,
        competitors: marketContext.competitors,
        timeOfDay: new Date().toUTCString(),
        similarOpportunities: formatSimilarOpportunities(similarOpps)
      };

      // Generate AI analysis using LLM
      const analysisPrompt = composeContext({
        state: (state as State) || ({} as unknown as State),
        template: opportunityTemplate,
        ...context
      });

      elizaLogger.debug("Sending to LLM for reasoning...");

      const analysis = await generateText({
        runtime,
        context: analysisPrompt,
        modelClass: "large" // Use best model for critical decisions
      });

      elizaLogger.info("📊 AI Analysis Complete:", analysis);

      // Parse LLM decision
      const decision = parseLLMAnalysis(analysis);

      // Store analysis in memory for future learning
      await runtime.messageManager.createMemory({
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: runtime.agentId,
        content: {
          text: analysis,
          type: "OPPORTUNITY_ANALYSIS",
          opportunity,
          decision,
          timestamp: Date.now()
        }
      });

      elizaLogger.success(`✅ Decision: ${decision.shouldExecute ? 'EXECUTE' : 'SKIP'} (confidence: ${decision.confidence}%)`);

      // If AI says execute, trigger strategy selection
      if (decision.shouldExecute && decision.confidence >= 70) {
        await runtime.processActions(
          {
            userId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: runtime.agentId,
            content: {
              text: "SELECT_STRATEGY",
              type: "STRATEGY_SELECTION_REQUEST",
              data: {
                opportunity,
                analysis: decision
              }
            }
          },
          [],
          state
        );
      } else {
        elizaLogger.info(`⏭️  Skipping opportunity: ${decision.reason}`);
      }

      if (callback) {
        callback({
          text: formatAnalysisResponse(decision),
          action: decision.shouldExecute ? "EXECUTE" : "SKIP"
        });
      }

      return true;
    } catch (error) {
      elizaLogger.error("Error in ANALYZE_OPPORTUNITY:", error);
      return false;
    }
  },

  examples: [
    [
      {
        user: "system",
        content: {
          text: "Opportunity detected: WMATIC/USDC arbitrage, 0.4% price difference"
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "🧠 Analyzing opportunity...\n\nReasoning:\n- Price differential: 0.4% (above threshold ✓)\n- Liquidity sufficient: $2.3M\n- Gas acceptable: 145 gwei\n- Historical success: 75%\n\nDecision: EXECUTE with 0.35 MATIC\nConfidence: 87%"
        }
      }
    ]
  ]
};

// Helper functions

async function gatherMarketContext(runtime: IAgentRuntime): Promise<any> {
  // Query blockchain state
  // This would integrate with MCP servers or direct RPC
  return {
    gasPrice: 150,
    congestion: "LOW",
    winRate: 75,
    competitors: 3
  };
}

async function findSimilarOpportunities(
  runtime: IAgentRuntime,
  opportunity: OpportunityData
): Promise<any[]> {
  // Fallback: naive retrieval of recent similar messages by type
  const recent = await runtime.messageManager.getMemories({
    roomId: runtime.agentId,
    count: 20
  });
  return (recent || []).filter((m: any) => m.content?.type === 'OPPORTUNITY_ANALYSIS');
}

function formatOpportunity(opp: OpportunityData): string {
  return `
Type: ${opp.type}
DEX: ${opp.dex || 'N/A'}
Pair: ${opp.tokenA || 'N/A'} / ${opp.tokenB || 'N/A'}
Price Difference: ${opp.priceDiff ? (opp.priceDiff * 100).toFixed(2) + '%' : 'N/A'}
Liquidity: $${opp.liquidity?.toLocaleString() || 'N/A'}
Est. Gas: ${opp.gasEstimate?.toFixed(4) || 'N/A'} MATIC
Detected: ${new Date(opp.timestamp).toISOString()}
`;
}

function formatSimilarOpportunities(similar: any[]): string {
  if (similar.length === 0) {
    return "No similar opportunities found in memory.";
  }

  return `Found ${similar.length} similar opportunities:\n` +
    similar.map((s, i) =>
      `${i + 1}. ${s.content.decision?.shouldExecute ? '✅ Executed' : '❌ Skipped'} - ` +
      `Confidence: ${s.content.decision?.confidence || 'N/A'}% - ` +
      `Outcome: ${s.content.result?.profit || 'Unknown'}`
    ).join('\n');
}

function parseLLMAnalysis(analysis: string): any {
  // Parse LLM response to extract decision
  const lines = analysis.toLowerCase();

  const shouldExecute = lines.includes('yes') && !lines.includes('no');

  // Extract confidence (look for patterns like "confidence: 85%" or "85% confidence")
  const confidenceMatch = analysis.match(/(\d{1,3})%/);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;

  // Extract position size
  const positionMatch = analysis.match(/(\d+\.?\d*)\s*matic/i);
  const positionSize = positionMatch ? parseFloat(positionMatch[1]) : 0.1;

  // Extract reason (usually after "because" or "reason:")
  let reason = "Analysis complete";
  const reasonMatch = analysis.match(/reason:?\s*(.+?)(?:\n|$)/i) ||
    analysis.match(/because\s+(.+?)(?:\n|$)/i);
  if (reasonMatch) {
    reason = reasonMatch[1].trim();
  }

  return {
    shouldExecute,
    confidence,
    positionSize,
    reason,
    fullAnalysis: analysis
  };
}

function formatAnalysisResponse(decision: any): string {
  if (decision.shouldExecute) {
    return `✅ EXECUTE - Confidence: ${decision.confidence}%\n` +
      `Position: ${decision.positionSize} MATIC\n` +
      `Reason: ${decision.reason}`;
  } else {
    return `⏭️  SKIP - ${decision.reason}`;
  }
}

export default analyzeOpportunityAction;
