import { AgentRuntime, elizaLogger, ModelProviderName } from "@ai16z/eliza";
import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { mkdirSync } from "fs";
import { resolve } from "path";
import Database from "better-sqlite3";

// Import AI-powered actions
import analyzeOpportunityAction from "./actions/analyzeOpportunity.js";
import selectStrategyAction from "./actions/selectStrategy.js";
import executeMEVAction from "./actions/executeMEV.js";
import learnFromResultAction from "./actions/learnFromResult.js";
import generateContractAction from "./actions/generateContract.js";

// Import services
import { BlockchainMonitor } from "./services/blockchainMonitor.js";
import { OpportunityDetector } from "./services/opportunityDetector.js";
import ExecutionCoordinator from "./services/executionCoordinator.js";
import { ThirdwebMCPIntegration, getNebulaClient } from "./thirdweb-nebula-integration.js";
import type { ArbitrageCandidate } from "./types/mev.js";
import {
  getMetricsSnapshot,
  recordOpportunityDetected,
  recordOpportunityForwarded
} from "./metrics/agentMetrics.js";
import type { OpportunityOrigin } from "./metrics/agentMetrics.js";

config();

const missingEnvPlaceholders = new Set<string>();

function resolvePlaceholders<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\{\{(.*?)\}\}/g, (_match, key: string) => {
      const envKey = key.trim();
      const envValue = process.env[envKey];
      if (envValue === undefined) {
        if (!missingEnvPlaceholders.has(envKey)) {
          elizaLogger.warn(`⚠️  Missing environment variable ${envKey} for character configuration`);
          missingEnvPlaceholders.add(envKey);
        }
        return "";
      }
      return envValue;
    }) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolvePlaceholders(item)) as T;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      (value as Record<string, unknown>)[key] = resolvePlaceholders(item);
    }
  }

  return value;
}

async function main() {
  elizaLogger.info("🚀 Starting AI-Powered MEV Agent (Eliza Framework)");
  elizaLogger.info("=" + "=".repeat(60));

  // Load character configuration (probe several likely locations so compiled dist can run)
  const scriptPath = new URL(import.meta.url).pathname;
  const scriptDir = resolve(scriptPath).replace(/\/index.js$|\/index.ts$/i, '');

  const candidatePaths = [
    resolve(scriptDir, './characters/ai-mev-hunter.json'), // dist/characters
    resolve(scriptDir, '../src/characters/ai-mev-hunter.json'), // src/characters when running from dist
    resolve(process.cwd(), './characters/ai-mev-hunter.json'), // repo root
    resolve(process.cwd(), './polygon-mev-bot/eliza-agent-ai/characters/ai-mev-hunter.json') // package path
  ];

  let characterPath: string | null = null;
  for (const p of candidatePaths) {
    try {
      readFileSync(p, 'utf-8');
      characterPath = p;
      break;
    } catch (e) {
      // ignore
    }
  }

  if (!characterPath) {
    throw new Error('characters/ai-mev-hunter.json not found in any expected location: ' + candidatePaths.join(', '));
  }

  const character = resolvePlaceholders(JSON.parse(readFileSync(characterPath, 'utf-8')));

  elizaLogger.info(`🤖 Loading character: ${character.name}`);

  // Initialize database adapter
  const dataDir = resolve("./data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, "agent.db");
  const db = new Database(dbPath);
  const databaseAdapter = new SqliteDatabaseAdapter(db);
  await databaseAdapter.init();

  const providerEnv = (process.env.ELIZA_MODEL_PROVIDER || "anthropic").toLowerCase();
  let modelProvider: ModelProviderName;
  let token: string | undefined;
  let serverUrl: string | undefined;

  switch (providerEnv) {
    case "openai":
      modelProvider = ModelProviderName.OPENAI;
      token = process.env.OPENAI_API_KEY;
      serverUrl = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
      break;
    case "anthropic":
    default:
      modelProvider = ModelProviderName.ANTHROPIC;
      token = process.env.ANTHROPIC_API_KEY;
      serverUrl = "https://api.anthropic.com";
      break;
  }

  if (!token) {
    throw new Error(`Missing API key for provider ${modelProvider}. Check environment configuration.`);
  }

  character.modelProvider = providerEnv;
  if (character.settings) {
    character.settings.modelProvider = providerEnv;
  }

  elizaLogger.info(`🧠 Using model provider: ${modelProvider}`);

  // Create runtime with AI capabilities
  const runtime = new AgentRuntime({
    databaseAdapter,
    token,
    serverUrl,
    modelProvider,
    character,

    // Register AI-powered actions
    actions: [
      analyzeOpportunityAction,
      selectStrategyAction,
      executeMEVAction,
      learnFromResultAction,
      generateContractAction
    ],

    // Evaluators can be added for continuous assessment
    evaluators: [],

    // Providers for blockchain data
    providers: []
  } as any);

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

  if (process.env.THIRDWEB_SECRET_KEY) {
    try {
      getNebulaClient({
        secretKey: process.env.THIRDWEB_SECRET_KEY,
        clientId: process.env.THIRDWEB_CLIENT_ID || "",
        privateKey: process.env.PRIVATE_KEY || blockchainConfig.privateKey,
        chainId: blockchainConfig.chainId,
        mevExecutorAddress: blockchainConfig.mevExecutorAddress
      });
    } catch (error) {
      elizaLogger.error("Failed to initialize Thirdweb Nebula client", error);
    }

    try {
      const thirdwebMcp = new ThirdwebMCPIntegration();
      await thirdwebMcp.initialize();
    } catch (error) {
      elizaLogger.error("Failed to initialize Thirdweb MCP integration", error);
    }
  } else {
    elizaLogger.warn("⚠️  THIRDWEB_SECRET_KEY not set. Nebula integration disabled.");
  }

  // Initialize blockchain monitoring
  elizaLogger.info("🔍 Initializing blockchain monitor...");
  const monitor = new BlockchainMonitor(runtime, character.settings);
  await monitor.start();

  // Initialize opportunity detector
  elizaLogger.info("🎯 Initializing opportunity detector...");
  const detector = new OpportunityDetector(runtime, character.settings);
  await detector.start();
  let executionCoordinator: ExecutionCoordinator | null = null;
  try {
    executionCoordinator = new ExecutionCoordinator({ runtimeSettings: character.settings });
  } catch (error) {
    elizaLogger.error("Failed to initialise execution coordinator", error);
  }

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

  const forwardOpportunity = async (opportunity: any, origin: OpportunityOrigin) => {
    recordOpportunityDetected(origin);
    recordOpportunityForwarded();

    const label = opportunity?.type || "ARBITRAGE";
    elizaLogger.info(`🎯 Opportunity detected: ${label}`);

    try {
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
        undefined
      );
    } catch (error) {
      elizaLogger.error("Error processing opportunity:", error);
    }
  };

  monitor.on("opportunity", (opportunity) => {
    void forwardOpportunity(opportunity, "blockchain-monitor");
  });
  detector.on("opportunity", async (opportunity: ArbitrageCandidate) => {
    executionCoordinator?.enqueue(opportunity);
    await forwardOpportunity({
      type: "ARBITRAGE_LOOP",
      source: "opportunity_detector",
      data: opportunity
    }, "loop-detector");
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
  const snapshot = getMetricsSnapshot();
  elizaLogger.info("📊 Agent Status:");

  elizaLogger.info(`   Uptime: ${formatDuration(snapshot.uptimeMs)}`);

  const detected = snapshot.opportunities.detected;
  if (detected.total === 0) {
    elizaLogger.info("   Opportunities: none detected yet");
  } else {
    elizaLogger.info(
      `   Opportunities: ${detected.total} detected (mempool ${detected.byOrigin["blockchain-monitor"] ?? 0}, loop ${detected.byOrigin["loop-detector"] ?? 0}), ${snapshot.opportunities.analyzed} analyzed, ${snapshot.opportunities.readyForExecution} queued`
    );
    if (detected.lastDetectedAt) {
      elizaLogger.info(`   Last opportunity: ${formatRelativeTime(detected.lastDetectedAt)}`);
    }
  }

  if (snapshot.routePlans.attempted > 0) {
    elizaLogger.info(
      `   Route plans: ${snapshot.routePlans.successful}/${snapshot.routePlans.attempted} successful`
    );
  }

  if (snapshot.simulations.attempted > 0) {
    elizaLogger.info(
      `   Simulations: ${snapshot.simulations.succeeded} succeeded, ${snapshot.simulations.failed} failed`
    );
  }

  if (snapshot.executions.confirmed > 0) {
    elizaLogger.info(
      `   Executions: ${snapshot.executions.confirmed} confirmed on-chain (${formatRelativeTime(snapshot.executions.lastConfirmationAt)})`
    );
  } else if (snapshot.executions.submitted > 0) {
    elizaLogger.info(
      `   Executions: ${snapshot.executions.submitted} submitted, awaiting confirmation`
    );
  } else if (snapshot.dryRunEnabled) {
    elizaLogger.info("   Executions: DRY_RUN enabled (on-chain submissions disabled)");
  } else {
    elizaLogger.info("   Executions: none submitted yet");
  }

  if (snapshot.executions.failed > 0) {
    const reason = snapshot.executions.lastFailureReason || "unknown";
    elizaLogger.info(
      `   Execution failures: ${snapshot.executions.failed} (latest ${formatRelativeTime(snapshot.executions.lastFailureAt)}): ${reason}`
    );
  }

  if (snapshot.lastDecision) {
    const { type, shouldExecute, confidence } = snapshot.lastDecision;
    elizaLogger.info(
      `   Last strategy decision: ${type} (${shouldExecute ? "execute" : "skip"}, confidence ${confidence.toFixed(1)}%)`
    );
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) {
    return "never";
  }
  const delta = Date.now() - timestamp;
  if (delta < 0) {
    return "in future";
  }
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Start the agent
main().catch((error) => {
  elizaLogger.error("Fatal error:", error);
  console.error("Fatal error details:", error);
  process.exit(1);
});
