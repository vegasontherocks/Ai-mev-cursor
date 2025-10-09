/**
 * Official thirdweb Integration for Eliza MEV Bot
 * Based on thirdweb docs: https://portal.thirdweb.com/ai
 */

import { createThirdwebClient } from "thirdweb";
import { polygon } from "thirdweb/chains";
import { privateKeyToAccount } from "thirdweb/wallets";
import dotenv from 'dotenv';

dotenv.config();

// Initialize thirdweb client (official SDK)
export const client = createThirdwebClient({
  clientId: process.env.THIRDWEB_CLIENT_ID!,
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});

// Create wallet from private key
export const account = privateKeyToAccount({
  client,
  privateKey: process.env.PRIVATE_KEY!,
});

// Chain configuration
export const chain = polygon;

// MCP Server endpoint (hosted by thirdweb)
export const MCP_ENDPOINT = `https://api.thirdweb.com/mcp?secretKey=${process.env.THIRDWEB_SECRET_KEY}`;

// Blockchain LLM API endpoint
export const NEBULA_ENDPOINT = "https://api.thirdweb.com/ai/chat";

/**
 * Call thirdweb Blockchain LLM (Nebula)
 * Official API: https://portal.thirdweb.com/ai/nebula
 */
export async function callNebulaAI(prompt: string, context?: any) {
  const response = await fetch(NEBULA_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-secret-key': process.env.THIRDWEB_SECRET_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: 'You are an MEV bot analyzing opportunities on Polygon. Be concise and precise.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      context: {
        chain_ids: [137], // Polygon
        auto_execute_transactions: false, // Safety: never auto-execute
        ...context,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Nebula API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Query MCP server for tools
 * Official MCP: https://portal.thirdweb.com/ai/mcp
 */
export async function getMCPTools() {
  const response = await fetch(MCP_ENDPOINT);
  
  if (!response.ok) {
    throw new Error(`MCP error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Execute MEV opportunity analysis with Nebula
 */
export async function analyzeOpportunity(opportunity: any) {
  const prompt = `
Analyze this MEV opportunity on Polygon:
- Type: ${opportunity.type}
- Tokens: ${opportunity.tokens?.join(', ')}
- Amount: ${opportunity.amount}
- Expected profit: ${opportunity.estimatedProfit}

Should we execute? Consider gas costs, competition, and risk.
Respond in JSON: {"execute": boolean, "confidence": number, "reason": string}
  `.trim();

  return callNebulaAI(prompt, {
    chain_ids: [137],
    from: process.env.WALLET_ADDRESS,
  });
}

export default {
  client,
  account,
  chain,
  callNebulaAI,
  getMCPTools,
  analyzeOpportunity,
  MCP_ENDPOINT,
  NEBULA_ENDPOINT,
};
