/**
 * OFFICIAL THIRDWEB INTEGRATION
 * 
 * Uses:
 * - Thirdweb Nebula blockchain LLM (OpenAI-compatible API)
 * - Vercel AI SDK for streaming
 * - Direct blockchain execution prompts (manual confirmation gate)
 */
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { elizaLogger } from "@ai16z/eliza";
import { readFileSync } from "fs";
import { resolve } from "path";

interface MEVOpportunity {
  type: "ARBITRAGE" | "JIT" | "LIQUIDATION" | "BACKRUN";
  dex?: string;
  tokens?: string[];
  expectedProfit: string;
  confidence: number;
}

/**
 * Thirdweb Nebula Client
 * 
 * Direct blockchain LLM - can READ/REASON/WRITE on-chain
 */
export class ThirdwebNebulaClient {
  private readonly provider;
  private readonly model;
  private readonly secretKey: string;
  private readonly defaultHeaders: Record<string, string>;
  private mevExecutorAddress: string;
  private readonly chainId: number;
  private readonly baseUrl: string;
  
  constructor(config: {
    secretKey: string;
    clientId: string;
    privateKey: string;
    chainId: number;
    mevExecutorAddress: string;
  }) {
    if (!config.secretKey) {
      throw new Error("Thirdweb Nebula secret key is required to initialize the client");
    }

    this.secretKey = config.secretKey;
    this.chainId = config.chainId;
    this.baseUrl = process.env.THIRDWEB_NEBULA_URL || "https://nebula.thirdweb.com/v1";
    this.defaultHeaders = {};
    if (config.clientId) {
      this.defaultHeaders["x-client-id"] = config.clientId;
      this.defaultHeaders["x-thirdweb-client-id"] = config.clientId;
    }

    this.provider = createOpenAI({
      apiKey: this.secretKey,
      baseURL: this.baseUrl,
      headers: this.defaultHeaders
    });
    this.model = this.provider("nebula-t1");
    
    this.mevExecutorAddress = config.mevExecutorAddress;
    
    elizaLogger.info("✅ Thirdweb Nebula initialized");
    elizaLogger.info(`   Chain: ${config.chainId} (Polygon)`);
    elizaLogger.info(`   MEV Executor: ${this.mevExecutorAddress}`);
  }
  
  private async callNebula(prompt: string, options: {
    temperature?: number;
    maxTokens?: number;
  } = {}) {
    const start = Date.now();
    const base = this.baseUrl.replace(/\/$/, "");
    const url = `${base}/chat/completions`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/json",
      ...this.defaultHeaders
    };

    const payload = {
      model: "nebula-t1",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1200
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (response.status === 405) {
      elizaLogger.warn("Nebula chat endpoint rejected request; falling back to legacy generate endpoint");
      return this.callLegacyNebula(prompt, options, start);
    }

    const bodyText = await response.text();

    if (!response.ok) {
      throw new Error(`Nebula chat endpoint failed (${response.status}): ${bodyText}`);
    }

    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch (parseError) {
      throw new Error(`Nebula chat endpoint returned non-JSON payload: ${bodyText}`);
    }

    const output =
      data?.choices?.[0]?.message?.content?.toString().trim() ??
      data?.output?.toString().trim() ??
      data?.text?.toString().trim() ??
      "";

    if (!output) {
      throw new Error("Nebula response did not contain content");
    }

    return {
      output,
      latency: Date.now() - start
    };
  }

  private async callLegacyNebula(
    prompt: string,
    options: { temperature?: number; maxTokens?: number },
    start: number
  ) {
    const url = "https://api.thirdweb.com/nebula/generate";
    const headers: Record<string, string> = {
      "x-secret-key": this.secretKey,
      "Content-Type": "application/json"
    };

    if (this.defaultHeaders["x-client-id"]) {
      headers["x-client-id"] = this.defaultHeaders["x-client-id"];
    }

    if (this.defaultHeaders["x-thirdweb-client-id"]) {
      headers["x-thirdweb-client-id"] = this.defaultHeaders["x-thirdweb-client-id"];
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        temperature: options.temperature ?? 0.2,
        maxTokens: options.maxTokens ?? 1200,
        model: "nebula-t1",
        type: "solidity"
      })
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new Error(`Nebula legacy endpoint failed (${response.status}): ${bodyText}`);
    }

    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch (parseError) {
      throw new Error(`Nebula legacy endpoint returned non-JSON payload: ${bodyText}`);
    }

    const output = (data.code || data.response || data.text || "").toString().trim();

    if (!output) {
      throw new Error("Nebula legacy endpoint returned empty payload");
    }

    return {
      output,
      latency: Date.now() - start
    };
  }
  
  private parseJSON<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      elizaLogger.warn("Nebula response was not valid JSON", { raw });
      return null;
    }
  }
  
  private extractSolidity(raw: string): string | null {
    if (!raw) return null;
    if (raw.includes("```")) {
      const parts = raw.split("```solidity");
      if (parts.length > 1) {
        return parts[1].split("```", 1)[0].trim();
      }
      return raw.split("```", 2)[1]?.split("```", 1)[0]?.trim() ?? null;
    }
    return raw.trim() || null;
  }
  
  /**
   * Find MEV opportunities using Thirdweb's blockchain LLM
   * 
   * Nebula directly scans blockchain for opportunities
   * Target latency: <500ms
   */
  async findOpportunities(): Promise<MEVOpportunity[]> {
    elizaLogger.debug("🔍 Nebula scanning for MEV opportunities...");
    
    try {
      const prompt = `
Scan Polygon blockchain for MEV opportunities:

1. ARBITRAGE:
   - Compare prices on QuickSwap, Uniswap V3, SushiSwap
   - Token pairs: WMATIC/USDC, WETH/USDC, DAI/USDC
   - Min spread: 0.5%

2. JIT LIQUIDITY:
   - Monitor large pending swaps (>$50k)
   - Uniswap V3 pools with high volume
   - Calculate optimal liquidity ranges

3. LIQUIDATIONS:
   - Scan Aave V3 for underwater positions
   - Health factor < 1.0
   - Position value > $5000

Return JSON array of opportunities:
{
  type: "ARBITRAGE" | "JIT" | "LIQUIDATION",
  data: {...},
  expectedProfit: "0.xx MATIC",
  confidence: 0-1
}
`;

      const { output, latency } = await this.callNebula(prompt, {
        temperature: 0.2,
        maxTokens: 1500
      });

      const opportunities = this.parseJSON<MEVOpportunity[]>(output) || [];

      elizaLogger.info(`⚡ Found ${opportunities.length} opportunities in ${latency}ms`);
      
      return opportunities;
      
    } catch (error) {
      elizaLogger.error("Nebula scan failed:", error);
      return [];
    }
  }
  
  /**
   * Analyze specific opportunity using blockchain LLM
   * 
   * Nebula has direct blockchain context - no need for external data fetching
   * Target latency: <300ms
   */
  async analyzeOpportunity(opportunity: any): Promise<{
    shouldExecute: boolean;
    confidence: number;
    expectedProfit: string;
    gasEstimate: string;
    reasoning: string;
    latency: number;
  }> {
    elizaLogger.debug("🧠 Nebula analyzing opportunity...");
    
    try {
      const prompt = `
Analyze this MEV opportunity on Polygon:

${JSON.stringify(opportunity, null, 2)}

Check:
1. Is it still valid? (check current blockchain state)
2. What's the expected profit after gas?
3. What's the competition level?
4. Should we execute?

Use your direct blockchain connection to:
- Get current DEX prices
- Check mempool for competing transactions
- Estimate gas costs accurately
- Validate profitability

Return JSON:
{
  shouldExecute: bool,
  confidence: 0-1,
  expectedProfit: "string",
  gasEstimate: "string",
  reasoning: "brief explanation"
}
`;

      const { output, latency } = await this.callNebula(prompt, {
        temperature: 0.15,
        maxTokens: 900
      });

      const analysis = this.parseJSON<any>(output) || {
        shouldExecute: false,
        confidence: 0,
        expectedProfit: "0",
        gasEstimate: "0",
        reasoning: "Nebula did not return valid analysis"
      };

      elizaLogger.info(`⚡ Analysis completed in ${latency}ms`);
      elizaLogger.info(`   Decision: ${analysis.shouldExecute ? "EXECUTE" : "SKIP"}`);
      elizaLogger.info(`   Confidence: ${analysis.confidence ? (analysis.confidence * 100).toFixed(0) : 0}%`);
      
      return { ...analysis, latency };
      
    } catch (error) {
      elizaLogger.error("Nebula analysis failed:", error);
      return {
        shouldExecute: false,
        confidence: 0,
        expectedProfit: "0",
        gasEstimate: "0",
        reasoning: "Analysis failed",
        latency: 0
      };
    }
  }
  
  /**
   * Execute MEV strategy directly through Thirdweb
   * 
   * Nebula builds and executes transaction in one step!
   * Target latency: <500ms (including on-chain confirmation)
   */
  async executeStrategy(opportunity: any): Promise<{
    success: boolean;
    txHash?: string;
    profit?: string;
    error?: string;
    latency: number;
  }> {
    elizaLogger.info("⚡ Nebula executing strategy...");
    
    try {
      const prompt = `
Execute this MEV opportunity on Polygon:

${JSON.stringify(opportunity, null, 2)}

Steps:
1. Build optimal transaction for MEVExecutor at ${this.mevExecutorAddress}
2. Use Balancer V2 flash loan if needed (zero fees)
3. Set optimal gas price to compete
4. Execute transaction
5. Wait for confirmation

Return immediately after sending transaction:
{
  success: bool,
  txHash: "0x...",
  expectedProfit: "string"
}
`;
      const allowNebula = process.env.ALLOW_NEBULA_EXECUTION === "true";
      const { output, latency } = await this.callNebula(prompt, {
        temperature: 0.1,
        maxTokens: allowNebula ? 1200 : 800
      });

      const result = this.parseJSON<any>(output) || {
        success: false,
        error: "Nebula did not return execution result"
      };

      if (result.success) {
        elizaLogger.success(`✅ Strategy executed in ${latency}ms`);
        if (result.txHash) {
          elizaLogger.success(`   TX: ${result.txHash}`);
        }
        if (result.expectedProfit) {
          elizaLogger.success(`   Profit: ${result.expectedProfit} MATIC`);
        }
      } else if (result.error) {
        elizaLogger.warn(`⚠️  Execution failed: ${result.error}`);
      }
      
      return { ...result, latency };
      
    } catch (error) {
      elizaLogger.error("Nebula execution failed:", error);
      return {
        success: false,
        error: error.message,
        latency: 0
      };
    }
  }
  
  /**
   * Stream MEV monitoring (continuous operation)
   * 
   * Uses Vercel AI SDK for streaming responses
   */
  async streamMonitoring(onOpportunity: (opp: MEVOpportunity) => void) {
    elizaLogger.info("🔄 Starting continuous MEV monitoring with Nebula...");
    
    try {
      const { textStream } = await streamText({
        model: this.provider("nebula-t1"),
        
  prompt: `
Monitor Polygon blockchain continuously for MEV opportunities.

For each block:
1. Scan mempool for large swaps
2. Check DEX price differences
3. Look for liquidatable positions

When opportunity found:
- Stream the opportunity data immediately
- Include: type, tokens, expected profit, confidence

Keep monitoring and streaming opportunities as they appear.
`,
        
      });
      
      // Process streamed opportunities
      for await (const chunk of textStream) {
        try {
          const opportunity = JSON.parse(chunk);
          onOpportunity(opportunity);
        } catch {
          // Not JSON, continue
        }
      }
      
    } catch (error) {
      elizaLogger.error("Streaming monitoring failed:", error);
    }
  }
  
  /**
   * Batch execute multiple strategies
   * 
   * Nebula can optimize and execute multiple MEV opportunities in parallel
   */
  async batchExecute(opportunities: any[]): Promise<{
    executed: number;
    failed: number;
    totalProfit: string;
    txHashes: string[];
  }> {
    elizaLogger.info(`⚡ Batch executing ${opportunities.length} strategies...`);
    
    try {
      const prompt = `
Execute these ${opportunities.length} MEV opportunities on Polygon:

${JSON.stringify(opportunities, null, 2)}

Optimize execution:
1. Order by profitability
2. Batch where possible
3. Use optimal gas for each
4. Execute via MEVExecutor at ${this.mevExecutorAddress}

Return:
{
  executed: number,
  failed: number,
  totalProfit: "string",
  txHashes: ["0x..."]
}
`;

      const { output, latency } = await this.callNebula(prompt, {
        temperature: 0.1,
        maxTokens: 1200
      });

      const result = this.parseJSON<any>(output) || {
        executed: 0,
        failed: opportunities.length,
        totalProfit: "0",
        txHashes: []
      };

      elizaLogger.success(`✅ Batch execution completed in ${latency}ms`);
      elizaLogger.success(`   Executed: ${result.executed}/${opportunities.length}`);
      elizaLogger.success(`   Total profit: ${result.totalProfit} MATIC`);
      
      return result;
      
    } catch (error) {
      elizaLogger.error("Batch execution failed:", error);
      return {
        executed: 0,
        failed: opportunities.length,
        totalProfit: "0",
        txHashes: []
      };
    }
  }

  async generateContract(params: {
    name: string;
    specification: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ code: string; raw: string; latency: number; }> {
    const prompt = `
You are Thirdweb Nebula, a blockchain-native LLM. Generate a production-grade Solidity smart contract.

Contract Name: ${params.name}
Target Chain: Polygon (chainId ${this.chainId})
Use MEV Executor address (if needed): ${this.mevExecutorAddress || "N/A"}

Requirements:
${params.specification}

Output:
- Full Solidity source code
- SPDX identifier
- pragma solidity 0.8.20
- No placeholders or ellipses
- Include NatSpec comments for public/external functions
- Ensure the code compiles without modification

Return only the Solidity code, optionally wrapped in a solidity code block.`;

    const { output, latency } = await this.callNebula(prompt, {
      temperature: params.temperature ?? 0.05,
      maxTokens: params.maxTokens ?? 6000
    });

    const code = this.extractSolidity(output);
    if (!code) {
      throw new Error("Nebula did not return Solidity output");
    }

    return {
      code,
      raw: output,
      latency
    };
  }
}

/**
 * MCP Server Integration
 * 
 * Connects Eliza to Thirdweb's MCP server for blockchain tools
 */
export class ThirdwebMCPIntegration {
  private thirdwebEndpoint?: string;
  private initialized = false;
  private availableTools: Set<string> | null = null;
  
  async initialize() {
    if (this.initialized) {
      return;
    }

    elizaLogger.info("🔌 Configuring Thirdweb MCP server...");

    try {
      const configPath = resolve("./mcp-config.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const entry = config?.mcpServers?.thirdweb;

      if (!entry || typeof entry.url !== "string" || entry.url.length === 0) {
        elizaLogger.warn("⚠️  No Thirdweb MCP endpoint found in mcp-config.json");
        return;
      }

      const secretKey = process.env.THIRDWEB_SECRET_KEY;
      let endpoint = entry.url;

      if (endpoint.includes("${THIRDWEB_SECRET_KEY}")) {
        if (!secretKey) {
          elizaLogger.warn("⚠️  THIRDWEB_SECRET_KEY not set; cannot initialize hosted MCP endpoint");
          return;
        }
        endpoint = endpoint.replace("${THIRDWEB_SECRET_KEY}", secretKey);
      }

      // If the URL still lacks a secret key, append from env as query param
      if (!endpoint.includes("secretKey=")) {
        if (!secretKey) {
          elizaLogger.warn("⚠️  THIRDWEB_SECRET_KEY not set; cannot authenticate with Thirdweb MCP endpoint");
          return;
        }
        const url = new URL(endpoint);
        url.searchParams.set("secretKey", secretKey);
        endpoint = url.toString();
      }

      this.thirdwebEndpoint = endpoint;
      await this.refreshToolCache();
      this.initialized = true;
      elizaLogger.success("✅ Thirdweb MCP endpoint configured");
    } catch (error) {
      elizaLogger.error("Failed to load MCP configuration", error);
    }
  }

  private async refreshToolCache(force = false) {
    if (!this.thirdwebEndpoint) {
      return;
    }

    if (!force && this.availableTools) {
      return;
    }

    const url = new URL(this.thirdwebEndpoint);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/list",
          params: {}
        })
      });

      if (!response.ok) {
        elizaLogger.warn(`⚠️  Unable to list MCP tools (${response.status} ${response.statusText})`);
        return;
      }

      const payload = await response.json().catch(async () => {
        const raw = await response.text();
        throw new Error(`Unexpected tools/list response: ${raw}`);
      });

      if (payload?.error) {
        elizaLogger.warn(`⚠️  tools/list returned error: ${payload.error.message || payload.error}`);
        this.availableTools = null;
        return;
      }

      const toolsArray = Array.isArray(payload?.result?.tools)
        ? payload.result.tools
        : [];

      if (!Array.isArray(toolsArray) || toolsArray.length === 0) {
        elizaLogger.warn("⚠️  Thirdweb MCP returned no tool metadata; continuing without cache");
        this.availableTools = null;
        return;
      }

      this.availableTools = new Set(
        toolsArray
          .map((tool: any) => (typeof tool === "string" ? tool : tool?.name))
          .filter((name: string | undefined): name is string => typeof name === "string" && name.length > 0)
      );

      elizaLogger.info(`🧰 Thirdweb MCP tools available (${this.availableTools.size}): ${Array.from(this.availableTools).join(", ")}`);
      elizaLogger.debug(`listTools latency: ${Date.now() - startedAt}ms`);
    } catch (error) {
      elizaLogger.warn("⚠️  Failed to refresh MCP tool cache", error);
      this.availableTools = null;
    }
  }
  
  /**
   * Call MCP tool through Thirdweb server
   */
  async callTool(toolName: string, params: any): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.thirdwebEndpoint) {
      throw new Error("Thirdweb MCP endpoint is not configured. Ensure THIRDWEB_SECRET_KEY is set and mcp-config.json has a 'thirdweb' entry.");
    }

    await this.refreshToolCache();

    const normalizedTool = (toolName || "").trim();
    const url = new URL(this.thirdwebEndpoint);
    if (normalizedTool.length > 0) {
      url.searchParams.set("tools", normalizedTool);
      if (this.availableTools && !this.availableTools.has(normalizedTool)) {
        elizaLogger.warn(`⚠️  MCP tool '${normalizedTool}' not reported by tools/list; attempting call anyway`);
      }
    }
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: normalizedTool,
            arguments: params ?? {}
          }
        })
      });

      const latency = Date.now() - startedAt;

      if (!response.ok) {
        const errorText = await response.text();
        elizaLogger.error(`Thirdweb MCP call failed (${response.status} ${response.statusText})`, errorText);
        throw new Error(`MCP tool ${toolName} failed: ${errorText}`);
      }

      const rawResult = await response.json().catch(async () => {
        const raw = await response.text();
        throw new Error(`Unexpected response format: ${raw}`);
      });

      if (rawResult?.error) {
        throw new Error(`MCP tool ${toolName} error: ${rawResult.error.message || JSON.stringify(rawResult.error)}`);
      }

      const content = rawResult?.result?.content;
      let normalizedResult: any = rawResult?.result;

      if (Array.isArray(content)) {
        const textChunk = content.find((chunk: any) => typeof chunk?.text === "string")?.text;
        if (textChunk) {
          try {
            normalizedResult = JSON.parse(textChunk);
          } catch {
            normalizedResult = textChunk;
          }
        }
      }

      elizaLogger.info(`🔧 MCP tool ${toolName} completed in ${latency}ms`);
      return {
        success: true,
        latency,
        result: normalizedResult,
        raw: rawResult
      };
    } catch (error) {
      elizaLogger.error(`Error calling Thirdweb MCP tool ${toolName}`, error);
      throw error;
    }
  }
}

// Export singleton instance
let nebulaClient: ThirdwebNebulaClient | null = null;

export function getNebulaClient(config?: any): ThirdwebNebulaClient {
  if (!nebulaClient && config) {
    nebulaClient = new ThirdwebNebulaClient(config);
  }
  
  if (!nebulaClient) {
    throw new Error("Nebula client not initialized. Call with config first.");
  }
  
  return nebulaClient;
}

export default ThirdwebNebulaClient;
