import { elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import type { ArbitrageCandidate, RoutePlan } from "../types/mev.js";
import RouteAssembler from "./routeAssembler.js";
import SimulationService from "./simulationService.js";
import ThirdwebExecutor from "./thirdwebExecutor.js";
import {
  recordDryRunSkip,
  recordExecutionConfirmed,
  recordExecutionFailure,
  recordExecutionSubmitted,
  recordRoutePlan,
  recordSimulationResult
} from "../metrics/agentMetrics.js";

interface ExecutionCoordinatorOptions {
  runtimeSettings: any;
}

interface QueueItem {
  candidate: ArbitrageCandidate;
}

export class ExecutionCoordinator {
  private queue: QueueItem[] = [];
  private processing = false;
  private dedupeWindowMs = 60_000;
  private recentKeys: Map<string, number> = new Map();
  private routeAssembler: RouteAssembler;
  private simulationService: SimulationService;
  private executor: ThirdwebExecutor;
  private mevExecutorAddress: string;
  private dryRun: boolean;
  private allowExecution: boolean;
  private provider: ethers.providers.JsonRpcProvider;

  constructor(options: ExecutionCoordinatorOptions) {
    const settings = options.runtimeSettings;
    const rpcUrl = settings?.blockchain?.rpcUrl || process.env.POLYGON_RPC_URL || "";
    if (!rpcUrl) {
      throw new Error("RPC URL required for execution coordinator");
    }

  this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  this.routeAssembler = new RouteAssembler(rpcUrl, settings);
    this.simulationService = new SimulationService({
      SIMULATION_RPC_URL: process.env.SIMULATION_RPC_URL,
      POLYGON_RPC_URL: process.env.POLYGON_RPC_URL,
      TENDERLY_USER: process.env.TENDERLY_USER,
      TENDERLY_PROJECT: process.env.TENDERLY_PROJECT,
      TENDERLY_ACCESS_KEY: process.env.TENDERLY_ACCESS_KEY
    });
    const chainId = Number(settings?.blockchain?.chainId || process.env.THIRDWEB_CHAIN_ID || 137);
    this.executor = new ThirdwebExecutor(chainId);
    this.mevExecutorAddress = settings?.blockchain?.mevExecutorAddress || process.env.MEV_EXECUTOR_ADDRESS || "";
    if (!this.mevExecutorAddress) {
      throw new Error("MEV_EXECUTOR_ADDRESS is required for execution coordinator");
    }

    this.dryRun = process.env.DRY_RUN === "true";
    this.allowExecution = process.env.ALLOW_EXECUTION === "true";

    void this.executor.initialise().catch((error) => {
      elizaLogger.error("Failed to initialise Thirdweb executor", error);
    });
  }

  enqueue(candidate: ArbitrageCandidate) {
    if (!candidate) return;

    if (this.isDuplicate(candidate.id)) {
      return;
    }

    this.queue.push({ candidate });
    this.processQueue().catch((error) => {
      elizaLogger.error("Coordinator queue failure", error);
    });
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    const last = this.recentKeys.get(key) || 0;
    if (now - last < this.dedupeWindowMs) {
      return true;
    }
    this.recentKeys.set(key, now);
    return false;
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      try {
        await this.processCandidate(item.candidate);
      } catch (error) {
        elizaLogger.error("❌ Failed to process opportunity", error);
        const message = error instanceof Error ? error.message : String(error);
        recordExecutionFailure(message);
      }
    }

    this.processing = false;
  }

  private async processCandidate(candidate: ArbitrageCandidate) {
    elizaLogger.info(`🧮 Building route for ${candidate.flashToken.symbol}/${candidate.targetToken.symbol}`);

    const routePlan = await this.routeAssembler.buildRoute(candidate);
    recordRoutePlan(!!routePlan);
    if (!routePlan) {
      elizaLogger.info("ℹ️  Route assembler returned no profitable plan");
      return;
    }

    const serverWallet = await this.executor.getServerWalletAddress();

    const simulation = await this.simulationService.simulate(routePlan, this.mevExecutorAddress, serverWallet);
    recordSimulationResult(simulation.success);
    if (!simulation.success) {
      elizaLogger.warn("⚠️  Simulation failed, skipping execution");
      return;
    }

    const expectedProfitEth = parseFloat(
      ethers.utils.formatUnits(routePlan.expectedProfit, candidate.flashToken.decimals)
    );
    elizaLogger.info(
      `📈 Plan ready: borrow ${ethers.utils.formatUnits(routePlan.flashAmount, candidate.flashToken.decimals)} ${candidate.flashToken.symbol}, expected profit ${expectedProfitEth.toFixed(6)} ${candidate.flashToken.symbol}`
    );

    if (this.dryRun || !this.allowExecution) {
      elizaLogger.warn("DRY_RUN or ALLOW_EXECUTION disabled – not submitting transaction");
      recordDryRunSkip("dry-run");
      return;
    }

    const submission = await this.executor.execute(routePlan, this.mevExecutorAddress);
    if (!submission.submitted) {
      elizaLogger.error("❌ Transaction submission failed");
      recordExecutionFailure("submission failed");
      return;
    }

    recordExecutionSubmitted();

    elizaLogger.info(`⏳ Transaction submitted: ${submission.txHash || submission.thirdwebTransactionId}`);
    if (submission.txHash) {
      const receipt = await this.provider.waitForTransaction(submission.txHash, 1, 120000).catch(() => null);
      if (receipt) {
        elizaLogger.info(`✅ Execution settled in block ${receipt.blockNumber}`);
        recordExecutionConfirmed();
      } else {
        elizaLogger.warn("⚠️  Timed out waiting for transaction confirmation");
      }
    } else if (submission.thirdwebTransactionId) {
      const receipt = await this.executor.waitForTransaction(submission.thirdwebTransactionId);
      elizaLogger.info(`✅ Execution settled. Thirdweb receipt: ${JSON.stringify(receipt)}`);
      recordExecutionConfirmed();
    }
  }
}

export default ExecutionCoordinator;
