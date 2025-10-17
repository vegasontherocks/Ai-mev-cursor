import { elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import ThirdwebMcpService from "./thirdwebMcpService.js";
import type { ExecutionResult, RoutePlan } from "../types/mev.js";

const MEV_EXECUTOR_ABI = [
  "function executeArbitrage(address[] tokens, uint256[] amounts, bytes calldata payload) external"
];

export class ThirdwebExecutor {
  private service: ThirdwebMcpService;
  private defaultChainId: number;

  constructor(chainId: number) {
    this.defaultChainId = chainId;
    this.service = new ThirdwebMcpService({ chainId });
  }

  async initialise() {
    await this.service.initialize();
    await this.service.ensureServerWallet();
  }

  async execute(plan: RoutePlan, mevExecutor: string): Promise<ExecutionResult> {
    const wallet = await this.service.ensureServerWallet();

    const iface = new ethers.utils.Interface(MEV_EXECUTOR_ABI);
    const data = iface.encodeFunctionData("executeArbitrage", [plan.tokens, plan.amounts, plan.payload]);

    const submission = await this.service.writeContract({
      contractAddress: mevExecutor,
      abi: MEV_EXECUTOR_ABI,
      functionName: "executeArbitrage",
      args: [plan.tokens, plan.amounts, plan.payload],
      chainId: this.defaultChainId,
      from: wallet
    });

    const txHash = submission?.transactionHash || submission?.hash || submission?.txHash;
    const thirdwebTransactionId = submission?.id || submission?.transactionId;

    if (!txHash && thirdwebTransactionId) {
      const resolved = await this.service.waitForTransaction(thirdwebTransactionId, {
        pollIntervalMs: 2500,
        timeoutMs: 120000
      });
      const resolvedHash = resolved?.transactionHash || resolved?.hash;
      if (resolvedHash) {
        return { submitted: true, txHash: resolvedHash, thirdwebTransactionId };
      }
    }

    if (!txHash) {
      elizaLogger.warn("⚠️  Thirdweb submission returned no transaction hash");
      return { submitted: false, thirdwebTransactionId };
    }

    return { submitted: true, txHash, thirdwebTransactionId };
  }

  async waitForTransaction(idOrHash: string) {
    return this.service.waitForTransaction(idOrHash);
  }

  async getServerWalletAddress() {
    return this.service.ensureServerWallet();
  }
}

export default ThirdwebExecutor;
