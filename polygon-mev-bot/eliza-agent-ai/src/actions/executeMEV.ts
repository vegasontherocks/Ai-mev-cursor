import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import { composeContext, generateText } from "@ai16z/eliza";
import { Simulator } from "../utils/simulator.js";
import ThirdwebMcpService from "../services/thirdwebMcpService.js";
import {
  recordDryRunSkip,
  recordExecutionConfirmed,
  recordExecutionFailure,
  recordExecutionSubmitted
} from "../metrics/agentMetrics.js";

const MEV_EXECUTOR_ABI = [
  {
    inputs: [
      {
        internalType: "address[]",
        name: "tokens",
        type: "address[]"
      },
      {
        internalType: "uint256[]",
        name: "amounts",
        type: "uint256[]"
      },
      {
        internalType: "bytes",
        name: "path",
        type: "bytes"
      }
    ],
    name: "executeArbitrage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

let thirdwebServicePromise: Promise<ThirdwebMcpService | null> | null = null;

async function getThirdwebExecutionService(): Promise<ThirdwebMcpService | null> {
  if (process.env.THIRDWEB_USE_MCP_EXECUTION !== "true" || !process.env.THIRDWEB_SECRET_KEY) {
    return null;
  }

  if (!thirdwebServicePromise) {
    thirdwebServicePromise = (async () => {
      try {
        const service = new ThirdwebMcpService();
        await service.initialize();
        return service;
      } catch (error) {
        elizaLogger.error("Failed to initialise Thirdweb MCP execution service", error);
        return null;
      }
    })();
  }

  return thirdwebServicePromise;
}

type ExecutionLogLevel = "info" | "warn" | "error";

async function recordExecutionEvent(
  runtime: IAgentRuntime,
  eventType: string,
  payload: Record<string, unknown>,
  level: ExecutionLogLevel = "info"
): Promise<void> {
  const entry = {
    eventType,
    timestamp: Date.now(),
    ...payload
  };

  const serialized = JSON.stringify(entry);

  switch (level) {
    case "error":
      elizaLogger.error(`[EXECUTION] ${eventType}`, serialized);
      break;
    case "warn":
      elizaLogger.warn(`[EXECUTION] ${eventType}`, serialized);
      break;
    default:
      elizaLogger.info(`[EXECUTION] ${eventType}`, serialized);
      break;
  }

  await runtime.messageManager.createMemory({
    userId: runtime.agentId,
    agentId: runtime.agentId,
    roomId: runtime.agentId,
    content: {
      text: `[${eventType}] ${serialized}`,
      type: "EXECUTION_EVENT",
      ...entry
    }
  });
}

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

      await recordExecutionEvent(runtime, "SIMULATION_RESULT", {
        success: simulation.success,
        estimatedProfit: simulation.estimatedProfit ?? null,
        gasEstimate: simulation.gasEstimate ?? null,
        error: simulation.error ?? null
      }, simulation.success ? "info" : "warn");

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
          await recordExecutionEvent(
            runtime,
            "SIMULATION_ABORT",
            { reason: 'SIMULATION_FAILED', error: simulation.error ?? null },
            "warn"
          );
          await recordFailedExecution(runtime, opportunity, strategy, 'SIMULATION_FAILED');
          return false;
        } else if (failureDecision.action === 'ADJUST') {
          // Adjust parameters and retry
          strategy.slippageTolerance = failureDecision.newSlippage;
          await recordExecutionEvent(
            runtime,
            "SIMULATION_ADJUST",
            {
              newSlippage: strategy.slippageTolerance,
              newGasMultiplier: failureDecision.newGasMultiplier
            }
          );
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
        state: (state as State) || ({} as unknown as State),
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
        await recordExecutionEvent(runtime, "EXECUTION_DELAY", { waitTime: decision.waitTime });
        await new Promise(resolve => setTimeout(resolve, decision.waitTime));
        // Recursively retry using the exported action handler reference
        return (await executeMEVAction.handler!(runtime, message, state, options, callback)) as boolean;
      }

      // Step 3: Build and send transaction
      elizaLogger.info("🚀 Building transaction...");
      const preparedTx = await buildTransaction(runtime, opportunity, strategy, decision);
      const transaction = preparedTx.request;
      const contractCall = preparedTx.call;

      // Note: no tx hash before sending; log destination and gas params instead
      elizaLogger.info("📤 Prepared transaction to:", transaction.to);

      // Apply conservative gasLimit from simulation if available (20% buffer)
      try {
        const simGas = (simulation as any)?.gasUsed;
        if (simGas && !transaction.gasLimit) {
          const gasBn = ethers.BigNumber.from(simGas.toString());
          transaction.gasLimit = gasBn.mul(120).div(100);
          elizaLogger.debug("⛽ Using gasLimit from simulation (+20% buffer):", transaction.gasLimit.toString());
        }
      } catch (e) {
        // Non-fatal; will estimate later if needed
      }

      // Safety gate: don't send transactions when in DRY_RUN or when execution is not explicitly allowed
      const dryRun = process.env.DRY_RUN === 'true' || process.env.ALLOW_EXECUTION !== 'true';
      if (dryRun) {
        elizaLogger.warn('DRY_RUN enabled or ALLOW_EXECUTION not set. Skipping on-chain send.');
        await recordExecutionEvent(
          runtime,
          "DRY_RUN_SKIP",
          { transaction, contractCall, opportunity, strategy },
          "warn"
        );
        recordDryRunSkip("execute action dry-run");
        if (callback) {
          callback({ text: 'DRY_RUN - transaction not sent', success: false });
        }
        return false;
      }

      // Preconditions for live send
      if (!process.env.POLYGON_RPC_URL) {
        await recordFailedExecution(runtime, opportunity, strategy, 'Missing POLYGON_RPC_URL');
        elizaLogger.error('Missing POLYGON_RPC_URL');
        return false;
      }

      const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
      const useThirdwebExecution = process.env.THIRDWEB_USE_MCP_EXECUTION === 'true';
      let txHash: string | undefined;
      let thirdwebSubmissionId: string | undefined;
  let submissionRecorded = false;

      if (useThirdwebExecution) {
        const thirdwebService = await getThirdwebExecutionService();
        if (thirdwebService) {
          try {
            const serverWallet = await thirdwebService.ensureServerWallet();
            const submission = await thirdwebService.writeContract({
              contractAddress: contractCall.contractAddress,
              abi: contractCall.abi,
              functionName: contractCall.functionName,
              args: contractCall.args,
              chainId: contractCall.chainId,
              from: serverWallet,
              value: contractCall.value ?? '0'
            });

            thirdwebSubmissionId = submission?.id || submission?.transactionId;
            txHash = submission?.transactionHash || submission?.hash || submission?.txHash;

            if (!txHash && thirdwebSubmissionId) {
              const resolved = await thirdwebService.waitForTransaction(thirdwebSubmissionId);
              txHash = resolved?.transactionHash || resolved?.hash;
            }

            if (!txHash) {
              throw new Error('Thirdweb writeContract did not return a transaction hash');
            }

            await recordExecutionEvent(runtime, "TX_SUBMITTED", {
              hash: txHash,
              to: transaction.to,
              maxFeePerGas: transaction.maxFeePerGas?.toString() ?? null,
              maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString() ?? null,
              gasLimit: transaction.gasLimit?.toString() ?? null,
              thirdwebTransactionId: thirdwebSubmissionId ?? null
            });
            recordExecutionSubmitted();
            submissionRecorded = true;
          } catch (error) {
            elizaLogger.error('Thirdweb MCP execution failed, falling back to direct signer', error);
            txHash = undefined;
            thirdwebSubmissionId = undefined;
          }
        } else {
          elizaLogger.warn('Thirdweb MCP execution requested but service unavailable. Falling back to private key execution.');
        }
      }

      let receipt: ethers.providers.TransactionReceipt;

      if (!txHash) {
        if (!process.env.PRIVATE_KEY) {
          await recordFailedExecution(runtime, opportunity, strategy, 'Missing PRIVATE_KEY');
          elizaLogger.error('Missing PRIVATE_KEY');
          recordExecutionFailure('missing PRIVATE_KEY');
          return false;
        }

        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

        // Estimate gas if not set from simulation
        if (!transaction.gasLimit) {
          try {
            const est = await wallet.estimateGas(transaction);
            // add 20% headroom
            transaction.gasLimit = est.mul(120).div(100);
            elizaLogger.debug('⛽ Estimated gasLimit with headroom:', transaction.gasLimit.toString());
          } catch (e) {
            elizaLogger.warn('Gas estimation failed; proceeding without explicit gasLimit:', e);
          }
        }

        const tx = await wallet.sendTransaction(transaction);
        recordExecutionSubmitted();
        submissionRecorded = true;
        txHash = tx.hash;
        elizaLogger.info("⏳ Transaction sent:", tx.hash);
        await recordExecutionEvent(runtime, "TX_SUBMITTED", {
          hash: tx.hash,
          to: transaction.to,
          maxFeePerGas: transaction.maxFeePerGas?.toString() ?? null,
          maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString() ?? null,
          gasLimit: transaction.gasLimit?.toString() ?? null
        });
        receipt = await tx.wait();
        recordExecutionConfirmed();
      } else {
        elizaLogger.info("⏳ Transaction submitted via Thirdweb:", txHash);
        if (!submissionRecorded) {
          recordExecutionSubmitted();
          submissionRecorded = true;
        }
        receipt = await provider.waitForTransaction(txHash) as ethers.providers.TransactionReceipt;
        if (!receipt) {
          recordExecutionFailure('provider waitForTransaction returned null');
          throw new Error('Failed to retrieve transaction receipt via provider');
        }
        recordExecutionConfirmed();
      }

      const executionResult = {
        success: receipt.status === 1,
        txHash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
        profit: await calculateProfit(receipt, opportunity, strategy),
        timestamp: Date.now()
      };

      elizaLogger.success(`✅ Transaction mined: ${txHash}`);
      elizaLogger.success(`💰 Profit: ${executionResult.profit} MATIC`);
      await recordExecutionEvent(runtime, "TX_MINED", executionResult);

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
    } catch (error: any) {
      elizaLogger.error("❌ Error in EXECUTE_MEV:", error);
      await recordFailedExecution(
        runtime,
        (message.content as any).data.opportunity,
        (message.content as any).data.strategy,
        error?.message || String(error)
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
  const rpcUrl = process.env.SIMULATION_RPC_URL || process.env.POLYGON_RPC_URL;
  const mevExecutor = process.env.MEV_EXECUTOR_ADDRESS;
  if (!rpcUrl) return { success: false, error: 'Missing RPC URL (SIMULATION_RPC_URL or POLYGON_RPC_URL)' };
  if (!mevExecutor) return { success: false, error: 'Missing MEV_EXECUTOR_ADDRESS' };

  try {
    // Build a candidate transaction for dry-run
    const decision = { action: 'EXECUTE' };
    const prepared = await buildTransaction(runtime, opportunity, strategy, decision);
    const tx = prepared.request;

    // Determine simulator mode
    const useTenderly = !!process.env.TENDERLY_ACCESS_KEY && !!process.env.TENDERLY_USER && !!process.env.TENDERLY_PROJECT;
    const simulator = new Simulator(
      useTenderly
        ? {
          mode: 'tenderly',
          tenderly: {
            user: process.env.TENDERLY_USER as string,
            project: process.env.TENDERLY_PROJECT as string,
            accessKey: process.env.TENDERLY_ACCESS_KEY as string,
            networkId: '137',
          },
        }
        : { mode: 'rpc', rpcUrl }
    );

    // Prepare from address if available
    let from: string | undefined;
    try {
      if (process.env.PRIVATE_KEY) {
        const tmpWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
        from = await tmpWallet.getAddress();
      }
    } catch { }

    if (!from && process.env.THIRDWEB_USE_MCP_EXECUTION === 'true') {
      try {
        const thirdwebService = await getThirdwebExecutionService();
        if (thirdwebService) {
          from = await thirdwebService.ensureServerWallet();
        }
      } catch (error) {
        elizaLogger.warn('Unable to derive Thirdweb server wallet for simulation', error);
      }
    }

    const simRes = await simulator.simulate({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gasLimit: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      from,
    });

    const estRevenue = typeof strategy?.positionSize === 'number' ? strategy.positionSize * 0.05 : 0;

    return {
      success: simRes.success,
      estimatedProfit: estRevenue,
      gasEstimate: simRes.gasEstimate,
      gasPriceGwei: simRes.gasPriceGwei,
      error: simRes.error || simRes.revertReason || null,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
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
  if (!mevExecutor) {
    throw new Error('MEV_EXECUTOR_ADDRESS not set');
  }

  // Assumptions (documented):
  // - We call MEVExecutor.executeArbitrage(address[] tokens, uint256[] amounts, bytes path)
  // - opportunity/strategy provide arrays for tokens/amounts and a swap path definition
  // - If not provided, we fail fast to avoid sending meaningless calldata

  // Derive tokens and amounts
  const tokens: string[] = (decision?.tokens
    || strategy?.tokens
    || opportunity?.tokens) as string[];
  const amounts: string[] = (decision?.amounts
    || strategy?.amounts
    || opportunity?.amounts) as string[];

  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Missing tokens array for executeArbitrage');
  }
  if (!Array.isArray(amounts) || amounts.length !== tokens.length) {
    throw new Error('Missing or mismatched amounts array for executeArbitrage');
  }

  // Derive path: (dexes[], pathTokens[]) packed with abi.encode
  const dexes: string[] = (decision?.dexes
    || strategy?.dexes
    || opportunity?.dexes) as string[];
  const pathTokens: string[] = (decision?.pathTokens
    || strategy?.pathTokens
    || opportunity?.pathTokens) as string[];

  if (!Array.isArray(dexes) || !Array.isArray(pathTokens) || dexes.length === 0 || pathTokens.length === 0 || dexes.length !== pathTokens.length) {
    throw new Error('Missing or invalid swap path (dexes/pathTokens)');
  }

  const pathBytes = ethers.utils.defaultAbiCoder.encode(["address[]", "address[]"], [dexes, pathTokens]);

  const iface = new ethers.utils.Interface(MEV_EXECUTOR_ABI as any);
  const data = iface.encodeFunctionData("executeArbitrage", [tokens, amounts, pathBytes]);

  // Reasonable default gas params; simulator/estimator will refine
  const maxPriority = process.env.MAX_PRIORITY_FEE_GWEI ? ethers.utils.parseUnits(process.env.MAX_PRIORITY_FEE_GWEI, 'gwei') : ethers.utils.parseUnits('2', 'gwei');
  const maxFee = process.env.MAX_FEE_GWEI ? ethers.utils.parseUnits(process.env.MAX_FEE_GWEI, 'gwei') : ethers.utils.parseUnits('150', 'gwei');

  const request = {
    to: mevExecutor,
    data,
    value: 0,
    // gasLimit left undefined to allow estimateGas to set appropriately in simulation
    maxPriorityFeePerGas: maxPriority,
    maxFeePerGas: maxFee
  };

  const chainId = Number(process.env.THIRDWEB_CHAIN_ID || process.env.CHAIN_ID || "137");

  return {
    request,
    call: {
      contractAddress: mevExecutor,
      abi: MEV_EXECUTOR_ABI,
      functionName: "executeArbitrage",
      args: [tokens, amounts, pathBytes],
      chainId,
      value: "0"
    }
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
  await recordExecutionEvent(
    runtime,
    "TX_FAILED",
    {
      opportunity,
      strategy,
      reason
    },
    "error"
  );
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
