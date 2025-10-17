import { elizaLogger } from "@ai16z/eliza";
import { ethers } from "ethers";
import { ThirdwebMCPIntegration } from "../thirdweb-nebula-integration.js";

interface WalletBalanceParams {
  address: string;
  chainId?: number;
  tokenAddress?: string;
}

interface SendTokensParams {
  to: string;
  amount: string;
  chainId?: number;
  tokenAddress?: string;
  from?: string;
}

interface WriteContractParams {
  contractAddress: string;
  abi: any;
  functionName: string;
  args?: any[];
  chainId?: number;
  from?: string;
  value?: string;
}

interface WaitForTransactionOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type NormalizedResult = Record<string, any> | string | undefined;

function tryParseJSON<T = any>(value: unknown): T | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed.length) {
    return undefined;
  }

  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

function normalizeResult(payload: any, depth = 0): NormalizedResult {
  if (payload === null || payload === undefined) {
    return undefined;
  }

  if (depth > 5) {
    return payload;
  }

  if (typeof payload === "string") {
    const parsed = tryParseJSON(payload);
    return parsed !== undefined ? normalizeResult(parsed, depth + 1) : payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeResult(item, depth + 1));
  }

  if (typeof payload === "object") {
    if (Array.isArray((payload as any).content)) {
      const textChunk = (payload as any).content.find((chunk: any) => typeof chunk?.text === "string")?.text;
      if (textChunk) {
        return normalizeResult(textChunk, depth + 1);
      }
    }

    if ((payload as any).result !== undefined) {
      return normalizeResult((payload as any).result, depth + 1);
    }

    if ((payload as any).data !== undefined && Object.keys(payload).length === 1) {
      return normalizeResult((payload as any).data, depth + 1);
    }

    return payload as Record<string, any>;
  }

  return payload;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ThirdwebMcpService {
  private integration: ThirdwebMCPIntegration | null = null;
  private initialised = false;
  private serverWalletAddress?: string;
  private readonly identifier?: string;
  private readonly defaultChainId: number;

  constructor(options: { identifier?: string; chainId?: number; preconfiguredAddress?: string } = {}) {
    this.identifier = options.identifier || process.env.THIRDWEB_SERVER_WALLET_IDENTIFIER || undefined;
    this.defaultChainId = options.chainId ?? Number(process.env.THIRDWEB_CHAIN_ID || process.env.CHAIN_ID || "137");

    const preconfigured = options.preconfiguredAddress || process.env.THIRDWEB_SERVER_WALLET_ADDRESS;
    if (preconfigured) {
      try {
        this.serverWalletAddress = ethers.utils.getAddress(preconfigured);
      } catch {
        elizaLogger.warn(`⚠️  Provided THIRDWEB_SERVER_WALLET_ADDRESS is invalid: ${preconfigured}`);
      }
    }
  }

  async initialize() {
    if (this.initialised) {
      return;
    }

    this.integration = new ThirdwebMCPIntegration();
    await this.integration.initialize();
    this.initialised = true;
  }

  private async ensureInitialized() {
    if (!this.initialised) {
      await this.initialize();
    }

    if (!this.integration) {
      throw new Error("Thirdweb MCP integration failed to initialise");
    }
  }

  async ensureServerWallet(): Promise<string> {
    await this.ensureInitialized();

    if (this.serverWalletAddress) {
      return this.serverWalletAddress;
    }

    const args: Record<string, any> = {};
    if (this.identifier) {
      args.identifier = this.identifier;
    }

    const response = await this.integration!.callTool("createServerWallet", args);
    const normalized = normalizeResult(response.result);

    if (!normalized || typeof normalized !== "object") {
      throw new Error("createServerWallet response missing wallet payload");
    }

    const wallet = (normalized as any).wallet || normalized;
    const address = wallet?.address || wallet?.walletAddress || (wallet?.result && wallet.result.address);

    if (!address) {
      throw new Error("Thirdweb createServerWallet did not return an address");
    }

    try {
      this.serverWalletAddress = ethers.utils.getAddress(address);
    } catch {
      throw new Error(`Received invalid server wallet address: ${address}`);
    }

    elizaLogger.info(`🤝 Thirdweb server wallet ready: ${this.serverWalletAddress}`);
    return this.serverWalletAddress;
  }

  async listServerWallets() {
    await this.ensureInitialized();
    const response = await this.integration!.callTool("listServerWallets", {});
    return normalizeResult(response.result);
  }

  async getWalletBalance(params: WalletBalanceParams) {
    await this.ensureInitialized();

    const chainId = params.chainId ?? this.defaultChainId;
    const response = await this.integration!.callTool("getWalletBalance", {
      address: params.address,
      chainId: Array.isArray(chainId) ? chainId : [chainId],
      tokenAddress: params.tokenAddress
    });

    return normalizeResult(response.result);
  }

  async sendTokens(params: SendTokensParams) {
    await this.ensureInitialized();

    const chainId = params.chainId ?? this.defaultChainId;
    const fromAddress = params.from || (await this.ensureServerWallet());

    const response = await this.integration!.callTool("sendTokens", {
      from: fromAddress,
      to: params.to,
      chainId,
      tokenAddress: params.tokenAddress,
      amount: params.amount
    });

    return normalizeResult(response.result);
  }

  async writeContract(params: WriteContractParams) {
    await this.ensureInitialized();

    const chainId = params.chainId ?? this.defaultChainId;
    const fromAddress = params.from || (await this.ensureServerWallet());

    const response = await this.integration!.callTool("writeContract", {
      from: fromAddress,
      chainId,
      contractAddress: params.contractAddress,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args ?? [],
      value: params.value ?? "0"
    });

    return normalizeResult(response.result) as Record<string, any> | undefined;
  }

  async getTransactionById(id: string) {
    await this.ensureInitialized();
    const response = await this.integration!.callTool("getTransactionById", {
      transactionId: id
    });
    return normalizeResult(response.result);
  }

  async waitForTransaction(idOrHash: string, options: WaitForTransactionOptions = {}) {
    const pollInterval = options.pollIntervalMs ?? 2500;
    const timeout = options.timeoutMs ?? 120_000;
    const started = Date.now();

    let lastData: any = undefined;
    let current = idOrHash;

    while (Date.now() - started < timeout) {
      const data = await this.getTransactionById(current).catch(() => undefined);
      if (data) {
        lastData = data;
      }

      const hash = data?.transactionHash || data?.hash;
      if (hash) {
        return { ...data, transactionHash: hash };
      }

      await delay(pollInterval);
    }

    return lastData ?? { status: "unknown" };
  }
}

export default ThirdwebMcpService;
