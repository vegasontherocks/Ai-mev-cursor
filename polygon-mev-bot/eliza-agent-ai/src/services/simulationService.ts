import { elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import type { RoutePlan, SimulationOutcome } from "../types/mev.js";
import { Simulator } from "../utils/simulator.js";

const MEV_EXECUTOR_ABI = [
  "function executeArbitrage(address[] tokens, uint256[] amounts, bytes calldata payload) external"
];

export class SimulationService {
  private rpcUrl: string;
  private tenderlyConfig?: {
    user: string;
    project: string;
    accessKey: string;
    networkId: string;
  };

  constructor(settings: any) {
    this.rpcUrl =
      settings?.SIMULATION_RPC_URL ||
      settings?.POLYGON_RPC_URL ||
      process.env.SIMULATION_RPC_URL ||
      process.env.POLYGON_RPC_URL ||
      "";

    const tenderlyUser = settings?.TENDERLY_USER || process.env.TENDERLY_USER;
    const tenderlyProject = settings?.TENDERLY_PROJECT || process.env.TENDERLY_PROJECT;
    const tenderlyKey = settings?.TENDERLY_ACCESS_KEY || process.env.TENDERLY_ACCESS_KEY;

    if (tenderlyUser && tenderlyProject && tenderlyKey) {
      this.tenderlyConfig = {
        user: tenderlyUser,
        project: tenderlyProject,
        accessKey: tenderlyKey,
        networkId: "137"
      };
    }
  }

  async simulate(plan: RoutePlan, mevExecutor: string, from?: string): Promise<SimulationOutcome> {
    if (!this.rpcUrl) {
      elizaLogger.warn("⚠️  No RPC URL configured for simulation");
      return { success: false, error: "Missing simulation RPC URL" };
    }

    const iface = new ethers.utils.Interface(MEV_EXECUTOR_ABI);
    const data = iface.encodeFunctionData("executeArbitrage", [plan.tokens, plan.amounts, plan.payload]);

    const simulator = new Simulator(
      this.tenderlyConfig
        ? {
            mode: "tenderly",
            tenderly: this.tenderlyConfig
          }
        : {
            mode: "rpc",
            rpcUrl: this.rpcUrl
          }
    );

    const result = await simulator.simulate({
      to: mevExecutor,
      from,
      data,
      maxFeePerGas: plan.gasPriceWei,
      maxPriorityFeePerGas: plan.gasPriceWei
    });

    if (!result.success) {
      elizaLogger.warn(`⚠️  Simulation failed: ${result.error || result.revertReason || "unknown"}`);
    }

    return result;
  }
}

export default SimulationService;
