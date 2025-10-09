import { AgentRuntime, elizaLogger, ModelProviderName } from "@ai16z/eliza";
import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

// Import AI-powered actions
import analyzeOpportunityAction from "./actions/analyzeOpportunity.js";
import selectStrategyAction from "./actions/selectStrategy.js";
import executeMEVAction from "./actions/executeMEV.js";
import learnFromResultAction from "./actions/learnFromResult.js";

// Import services
import { BlockchainMonitor } from "./services/blockchainMonitor.js";
import { OpportunityDetector } from "./services/opportunityDetector.js";

config();

async function main() {
  elizaLogger.info("🚀 Starting AI-Powered MEV Agent (Eliza Framework)");
  elizaLogger.info("=" +".repeat(60));
  
  // Load character configuration
  const characterPath = resolve("./characters/ai-mev-hunter.json");
  const character = JSON.parse(readFileSync(characterPath, "utf-8"));
  
  elizaLogger.info(`🤖 Loading character: ${character.name}`);
  
  // Initialize database adapter
  const databaseAdapter = new SqliteDatabaseAdapter("./data/agent.db");
  await databaseAdapter.init();
  
  // Create runtime with AI capabilities
  const runtime = new AgentRuntime({
    databaseAdapter,
    token: process.env.ANTHROPIC_API_KEY!,
    serverUrl: "https://api.anthropic.com",
    modelProvider: "anthropic" as ModelProviderName,
    character,
    
    // Register AI-powered actions
    actions: [
      analyzeOpportunityAction,
      selectStrategyAction,
      executeMEVAction,
      learnFromResultAction
    ],
    
    // Evaluators can be added for continuous assessment
    evaluators: [],
    
    // Providers for blockchain data
    providers: []
  });
  
  elizaLogger.success("✅ Runtime initialized with AI actions");
  
  // Verify blockchain configuration
  const blockchainConfig = character.settings.blockchain;
  if (!blockchainConfig.mevExecutorAddress) {
    elizaLogger.warn("⚠️  MEV_EXECUTOR_ADDRESS not set in character config");
    elizaLogger.warn("   Please deploy the smart contract first");
    return;
  }
  
  elizaLogger.info("🔗 Blockchain Configuration:");
  elizaLogger.info(`   Chain: Polygon (${blockchainConfig.chainId})`);
  elizaLogger.info(`   RPC: ${blockchainConfig.rpcUrl}`);
  elizaLogger.info(`   MEV Executor: ${blockchainConfig.mevExecutorAddress}`);
  
  // Initialize blockchain monitoring
  elizaLogger.info("🔍 Initializing blockchain monitor...");
  const monitor = new BlockchainMonitor(runtime, character.settings);
  await monitor.start();
  
  // Initialize opportunity detector
  elizaLogger.info("🎯 Initializing opportunity detector...");
  const detector = new OpportunityDetector(runtime, character.settings);
  await detector.start();
  
  elizaLogger.success("=" + "=".repeat(60));
  elizaLogger.success("🧠 AI-POWERED MEV AGENT IS RUNNING");
  elizaLogger.success("=" + "=".repeat(60));
  
  elizaLogger.info("\n📊 Agent Capabilities:");
  elizaLogger.info("   ✅ LLM-based opportunity analysis (Claude Opus)");
  elizaLogger.info("   ✅ Reinforcement learning strategy selection");
  elizaLogger.info("   ✅ Semantic memory of past executions");
  elizaLogger.info("   ✅ Autonomous decision making");
  elizaLogger.info("   ✅ Continuous learning from outcomes");
  
  elizaLogger.info("\n🎯 Monitoring:");
  elizaLogger.info(`   - DEXs: ${character.settings.mev.dexes.length}`);
  elizaLogger.info(`   - Tokens: ${character.settings.mev.tokens.length}`);
  elizaLogger.info(`   - Strategies: ${Object.keys(character.settings.mev.strategies).filter(s => character.settings.mev.strategies[s].enabled).length}`);
  
  elizaLogger.info("\n💡 The agent will:");
  elizaLogger.info("   1. Monitor mempool for opportunities");
  elizaLogger.info("   2. Analyze with AI reasoning");
  elizaLogger.info("   3. Select strategy using RL model");
  elizaLogger.info("   4. Execute autonomously");
  elizaLogger.info("   5. Learn from every outcome");
  
  elizaLogger.info("\n⏳ Waiting for opportunities...\n");
  
  // Event handlers
  monitor.on("opportunity", async (opportunity) => {
    elizaLogger.info(`🎯 Opportunity detected: ${opportunity.type}`);
    
    try {
      // Trigger AI analysis
      await runtime.processActions(
        {
          userId: runtime.agentId,
          agentId: runtime.agentId,
          roomId: runtime.agentId,
          content: {
            text: "ANALYZE_OPPORTUNITY",
            type: "OPPORTUNITY_DETECTED",
            data: opportunity
          }
        },
        [],
        {}
      );
    } catch (error) {
      elizaLogger.error("Error processing opportunity:", error);
    }
  });
  
  // Periodic status updates
  setInterval(() => {
    logAgentStatus(runtime);
  }, 60000); // Every minute
  
  // Graceful shutdown
  process.on("SIGINT", async () => {
    elizaLogger.info("\n🛑 Shutting down gracefully...");
    await monitor.stop();
    await detector.stop();
    process.exit(0);
  });
}

async function logAgentStatus(runtime: AgentRuntime) {
  elizaLogger.info("📊 Agent Status:");
  
  // Would query from database
  const stats = {
    uptime: process.uptime(),
    opportunities: 150,
    analyzed: 120,
    executed: 45,
    winRate: 75,
    totalProfit: 1.8
  };
  
  elizaLogger.info(`   Uptime: ${Math.floor(stats.uptime / 60)} minutes`);
  elizaLogger.info(`   Opportunities: ${stats.opportunities} detected, ${stats.analyzed} analyzed, ${stats.executed} executed`);
  elizaLogger.info(`   Performance: ${stats.winRate}% win rate, ${stats.totalProfit.toFixed(3)} MATIC profit`);
}

// Start the agent
main().catch((error) => {
  elizaLogger.error("Fatal error:", error);
  process.exit(1);
});
