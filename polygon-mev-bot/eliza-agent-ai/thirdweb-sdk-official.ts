/**
 * Official thirdweb SDK Integration
 * Docs: https://portal.thirdweb.com/typescript/v5
 */

import { createThirdwebClient } from "thirdweb";
import { polygon } from "thirdweb/chains";
import { privateKeyToAccount } from "thirdweb/wallets";
import { createThirdwebAI } from "@thirdweb-dev/ai-sdk-provider";
import dotenv from 'dotenv';

dotenv.config();

// Official thirdweb client
export const client = createThirdwebClient({
  clientId: process.env.THIRDWEB_CLIENT_ID!,
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});

// Wallet account
export const account = privateKeyToAccount({
  client,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Chain (Polygon)
export const chain = polygon;

// Blockchain LLM (Nebula) - Official provider
export const thirdwebAI = createThirdwebAI({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});

// MCP Server endpoint (hosted by thirdweb - no infra needed!)
export const MCP_ENDPOINT = `https://api.thirdweb.com/mcp?secretKey=${process.env.THIRDWEB_SECRET_KEY}`;

// LLM docs for better tool use
export const THIRDWEB_DOCS_URL = "https://api.thirdweb.com/llms.txt";

/**
 * Call thirdweb Blockchain LLM for MEV analysis
 * Uses official Nebula API
 */
export async function analyzeWithNebula(prompt: string, context?: any) {
  const response = await fetch("https://api.thirdweb.com/ai/chat", {
    method: 'POST',
    headers: {
      'x-secret-key': process.env.THIRDWEB_SECRET_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `You are an MEV bot on Polygon. Analyze opportunities and respond in JSON.
          
Docs: ${THIRDWEB_DOCS_URL}

Minimum profit: $${process.env.MIN_PROFIT_USD || 25} USD
Max gas: ${process.env.MAX_GAS_PRICE_GWEI || 50} gwei
Max slippage: ${process.env.SLIPPAGE_TOLERANCE_BPS || 40} bps`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      context: {
        chain_ids: [137], // Polygon
        from: process.env.WALLET_ADDRESS,
        auto_execute_transactions: false, // Never auto-execute
        ...context,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Nebula API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Query MCP server for available tools
 */
export async function getMCPTools(filterTools?: string[]) {
  let url = MCP_ENDPOINT;
  if (filterTools && filterTools.length > 0) {
    url += `&tools=${filterTools.join(',')}`;
  }
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`MCP error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Analyze MEV opportunity with realistic USD thresholds
 */
export async function analyzeMEVOpportunity(opportunity: {
  type: string;
  tokens?: string[];
  amount?: string;
  estimatedProfitUsd?: number;
}) {
  const prompt = `
Analyze MEV opportunity on Polygon:

Type: ${opportunity.type}
Tokens: ${opportunity.tokens?.join(' → ') || 'unknown'}
Amount: ${opportunity.amount || 'unknown'}
Estimated profit: $${opportunity.estimatedProfitUsd?.toFixed(2) || '0'}

Requirements:
- Minimum net profit: $${process.env.MIN_PROFIT_USD || 25} USD
- Maximum gas cost: $${process.env.MAX_GAS_COST_USD || 5} USD  
- Maximum slippage: ${process.env.SLIPPAGE_TOLERANCE_BPS || 40} bps

Should we execute? Consider:
1. Net profit after gas costs (must be >= $25)
2. Slippage risk
3. MEV competition
4. Gas price (current vs max ${process.env.MAX_GAS_PRICE_GWEI || 50} gwei)

Respond in JSON:
{
  "execute": boolean,
  "confidence": number (0-1),
  "expectedNetUsd": number,
  "reason": string,
  "gasEstimateUsd": number
}
  `.trim();

  return analyzeWithNebula(prompt, {
    chain_ids: [137],
  });
}

export default {
  client,
  account,
  chain,
  thirdwebAI,
  MCP_ENDPOINT,
  THIRDWEB_DOCS_URL,
  analyzeWithNebula,
  getMCPTools,
  analyzeMEVOpportunity,
};
