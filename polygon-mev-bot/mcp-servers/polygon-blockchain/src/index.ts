#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import {
  Contract,
  JsonRpcProvider,
  WebSocketProvider,
  formatEther,
  formatUnits,
  parseEther
} from "ethers";
import { LRUCache } from "lru-cache";

type AnyProvider = JsonRpcProvider | WebSocketProvider;

type DexPriceEntry = {
  dex: string;
  price: number | null;
  timestamp: number;
  error?: string;
};

type CachedResult<T> = T & { cached: boolean; latency: number };

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] memory)"
];

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

const cache = new LRUCache<string, CachedResult<any>>({
  max: 1000,
  ttl: 5000,
  updateAgeOnGet: true
});

const providers = {
  primary: new WebSocketProvider(requireEnv("POLYGON_WSS_URL")),
  backup: new JsonRpcProvider(requireEnv("POLYGON_RPC_URL"))
};

const inFlightRequests = new Map<string, Promise<any>>();
const UNIT = parseEther("1");

async function callWithFallback<T>(fn: (provider: AnyProvider) => Promise<T>): Promise<T> {
  try {
    return await fn(providers.primary);
  } catch (primaryError) {
    return fn(providers.backup);
  }
}

function withCacheHit<T>(result: CachedResult<T>): CachedResult<T> {
  return { ...result, cached: true };
}

async function getDEXPrices(params: { tokenA: string; tokenB: string; dexes: string[] }): Promise<CachedResult<{ prices: DexPriceEntry[] }>> {
  const cacheKey = `prices:${params.tokenA}:${params.tokenB}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return withCacheHit(cached);
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const start = Date.now();
  const quotePromise = Promise.all(
    params.dexes.map(async (dex): Promise<DexPriceEntry> => {
      try {
        const fetchQuote = async (provider: AnyProvider) => {
          const router = new Contract(dex, ROUTER_ABI, provider);
          return router.getAmountsOut(UNIT, [params.tokenA, params.tokenB]);
        };

        const amounts = await callWithFallback(fetchQuote);
        return {
          dex,
          price: Number(formatEther(amounts[1])),
          timestamp: Date.now()
        };
      } catch (error: any) {
        return {
          dex,
          price: null,
          timestamp: Date.now(),
          error: error?.message ?? String(error)
        };
      }
    })
  );

  inFlightRequests.set(cacheKey, quotePromise);

  try {
    const prices = await quotePromise;
    const result: CachedResult<{ prices: DexPriceEntry[] }> = {
      prices,
      latency: Date.now() - start,
      cached: false
    };
    cache.set(cacheKey, result);
    return result;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

async function getGasPrice(): Promise<CachedResult<{
  baseFee: number;
  maxPriorityFee: number;
  maxFee: number;
  gasStation: any;
  error?: string;
}>> {
  const cacheKey = "gas_price";
  const cached = cache.get(cacheKey);
  if (cached) {
    return withCacheHit(cached);
  }

  const start = Date.now();

  try {
    const [feeData, gasStation] = await Promise.all([
      providers.primary.getFeeData(),
      fetch("https://gasstation.polygon.technology/v2")
        .then((r) => r.json())
        .catch(() => null)
    ]);

    const baseFeePerGas = feeData.gasPrice ?? feeData.maxFeePerGas ?? undefined;

    const result: CachedResult<{
      baseFee: number;
      maxPriorityFee: number;
      maxFee: number;
      gasStation: any;
      error?: string;
    }> = {
      baseFee: baseFeePerGas ? Number(formatUnits(baseFeePerGas, "gwei")) : 0,
      maxPriorityFee: feeData.maxPriorityFeePerGas ? Number(formatUnits(feeData.maxPriorityFeePerGas, "gwei")) : 0,
      maxFee: feeData.maxFeePerGas ? Number(formatUnits(feeData.maxFeePerGas, "gwei")) : 0,
      gasStation: gasStation
        ? {
            safeLow: gasStation.safeLow?.maxFee,
            standard: gasStation.standard?.maxFee,
            fast: gasStation.fast?.maxFee,
            fastest: gasStation.fastest?.maxFee
          }
        : null,
      latency: Date.now() - start,
      cached: false
    };

    cache.set(cacheKey, result, { ttl: 2000 });
    return result;
  } catch (error: any) {
    const result: CachedResult<{
      baseFee: number;
      maxPriorityFee: number;
      maxFee: number;
      gasStation: any;
      error?: string;
    }> = {
      baseFee: 0,
      maxPriorityFee: 0,
      maxFee: 0,
      gasStation: null,
      error: error?.message ?? String(error),
      latency: Date.now() - start,
      cached: false
    };
    cache.set(cacheKey, result, { ttl: 2000 });
    return result;
  }
}

async function getPendingTransaction(txHash: string): Promise<CachedResult<{ tx: any; error?: string }>> {
  const cacheKey = `tx:${txHash}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return withCacheHit(cached);
  }

  const start = Date.now();

  try {
    const tx = await callWithFallback((provider) => provider.getTransaction(txHash));
    const result: CachedResult<{ tx: any; error?: string }> = {
      tx: tx
        ? {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value ? Number(formatEther(tx.value)) : 0,
            gasPrice: tx.gasPrice ? Number(formatUnits(tx.gasPrice, "gwei")) : 0,
            data: tx.data,
            nonce: tx.nonce
          }
        : null,
      latency: Date.now() - start,
      cached: false
    };
    cache.set(cacheKey, result, { ttl: 1000 });
    return result;
  } catch (error: any) {
    const result: CachedResult<{ tx: any; error?: string }> = {
      tx: null,
      error: error?.message ?? String(error),
      latency: Date.now() - start,
      cached: false
    };
    cache.set(cacheKey, result, { ttl: 1000 });
    return result;
  }
}

async function getBlockData(blockNumber: number | "latest"): Promise<CachedResult<any>> {
  const cacheKey = `block:${blockNumber}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return withCacheHit(cached);
  }

  const start = Date.now();

  try {
    const block = await callWithFallback((provider) => provider.getBlock(blockNumber));
    const result: CachedResult<any> = {
      number: block?.number ?? null,
      timestamp: block?.timestamp ?? null,
      gasUsed: block?.gasUsed?.toString() ?? null,
      gasLimit: block?.gasLimit?.toString() ?? null,
      baseFeePerGas: block?.baseFeePerGas ? Number(formatUnits(block.baseFeePerGas, "gwei")) : null,
      transactions: block?.transactions?.length ?? 0,
      latency: Date.now() - start,
      cached: false
    };
    cache.set(cacheKey, result);
    return result;
  } catch (error: any) {
    const result: CachedResult<any> = {
      error: error?.message ?? String(error),
      latency: Date.now() - start,
      cached: false
    };
    cache.set(cacheKey, result);
    return result;
  }
}

async function batchGetPrices(queries: Array<{ tokenA: string; tokenB: string; dex: string }>): Promise<CachedResult<{ results: DexPriceEntry[]; count: number }>> {
  const start = Date.now();

  const results = await Promise.all(
    queries.map(async (query) => {
      const cacheKey = `price:${query.tokenA}:${query.tokenB}:${query.dex}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return { ...withCacheHit(cached), query };
      }

      try {
        const fetchQuote = async (provider: AnyProvider) => {
          const router = new Contract(query.dex, ROUTER_ABI, provider);
          return router.getAmountsOut(UNIT, [query.tokenA, query.tokenB]);
        };

        const amounts = await callWithFallback(fetchQuote);
        const entry: CachedResult<{ price: number; timestamp: number }> = {
          price: Number(formatEther(amounts[1])),
          timestamp: Date.now(),
          latency: 0,
          cached: false
        };
        cache.set(cacheKey, entry);
        return { query, price: entry.price, timestamp: entry.timestamp, error: undefined };
      } catch (error: any) {
        return { query, price: null, timestamp: Date.now(), error: error?.message ?? String(error) };
      }
    })
  );

  return {
    results,
    count: results.length,
    latency: Date.now() - start,
    cached: false
  };
}

const server = new Server(
  { name: "polygon-blockchain", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const TOOLS: Tool[] = [
  {
    name: "get_dex_prices",
    description: "Get token prices from multiple DEXs (cached, <50ms)",
    inputSchema: {
      type: "object",
      properties: {
        tokenA: { type: "string", description: "Token A address" },
        tokenB: { type: "string", description: "Token B address" },
        dexes: {
          type: "array",
          items: { type: "string" },
          description: "DEX router addresses"
        }
      },
      required: ["tokenA", "tokenB", "dexes"]
    }
  },
  {
    name: "get_gas_price",
    description: "Get current gas prices (cached, <10ms)",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_pending_tx",
    description: "Get pending transaction details (fast, <100ms)",
    inputSchema: {
      type: "object",
      properties: {
        txHash: { type: "string", description: "Transaction hash" }
      },
      required: ["txHash"]
    }
  },
  {
    name: "get_block",
    description: "Get block data (cached, <50ms)",
    inputSchema: {
      type: "object",
      properties: {
        blockNumber: { type: ["number", "string"], description: "Block number or 'latest'" }
      },
      required: ["blockNumber"]
    }
  },
  {
    name: "batch_get_prices",
    description: "Batch fetch prices for maximum speed (parallel)",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tokenA: { type: "string" },
              tokenB: { type: "string" },
              dex: { type: "string" }
            },
            required: ["tokenA", "tokenB", "dex"]
          }
        }
      },
      required: ["queries"]
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case "get_dex_prices":
        result = await getDEXPrices(args as any);
        break;
      case "get_gas_price":
        result = await getGasPrice();
        break;
      case "get_pending_tx":
        result = await getPendingTransaction((args as any).txHash);
        break;
      case "get_block":
        result = await getBlockData((args as any).blockNumber);
        break;
      case "batch_get_prices":
        result = await batchGetPrices((args as any).queries);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: error?.message ?? String(error) }) }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Polygon MCP Server running (stdio)");
  console.error("📊 Cache size: 1000 entries, TTL: 5s");
  console.error("⚡ Target latency: <50ms (cached), <200ms (uncached)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
