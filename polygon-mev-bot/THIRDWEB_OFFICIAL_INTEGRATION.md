# 🔗 Official thirdweb Integration Guide

Based on official thirdweb documentation for:
- Blockchain LLM (Nebula)
- MCP Server
- Insight Webhooks
- Eliza Plugin
- Foundry deployment

## 🔑 Keys Required

From thirdweb Dashboard (https://thirdweb.com/dashboard):
✅ Client ID: `1f327e8dd39e78abf7da1e6c80ced8cd`
✅ Secret Key: `5PRECcNSQ9QQdndSpaRAs4zvqER6VzJP8UOTEplGj7JgIZFRIH4p4r2JKmX9uauvEDqOg-VZOUwFBLQz1OrL3Q`

## 1️⃣ Blockchain LLM Integration

### Server API Route (Next.js/Node)

```typescript
// app/api/chat/route.ts
export const maxDuration = 300;

import { streamText, convertToModelMessages } from "ai";
import { createThirdwebAI } from "@thirdweb-dev/ai-sdk-provider";

const thirdwebAI = createThirdwebAI({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});

export async function POST(req: Request) {
  const { messages, id } = await req.json();

  const result = streamText({
    model: thirdwebAI.chat(id, {
      context: {
        chain_ids: [137], // Polygon
        auto_execute_transactions: false, // human-in-loop
      },
    }),
    messages: convertToModelMessages(messages),
    tools: thirdwebAI.tools(), // sign_transaction, sign_swap, etc.
  });

  return result.toAIStreamResponse();
}
```

### Direct HTTP (Alternative)

```bash
curl -X POST https://api.thirdweb.com/ai/chat \
  -H "x-secret-key: YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"Check WMATIC balance"}],
    "context": {"chain_ids": [137]}
  }'
```

### Add LLM docs to prompts

```
https://api.thirdweb.com/llms.txt
```

## 2️⃣ Insight Webhooks (Monitoring)

### Create Webhook

Dashboard: Insight → Webhooks
- URL: `https://your-domain.com/api/insight/webhook`
- Topics: `v1.events`, `v1.transactions`
- Filters: Chain IDs, addresses, function signatures

### Verify Webhook Signature

```typescript
// app/api/insight/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const raw = await req.text(); // RAW body
  const signature = req.headers.get("x-thirdweb-signature") || "";
  
  const expected = crypto
    .createHmac("sha256", process.env.INSIGHT_WEBHOOK_SECRET!)
    .update(raw)
    .digest("hex");

  const ok = signature.length === expected.length &&
    crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );

  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  const event = JSON.parse(raw);
  // Process event → trigger MEV bot
  
  return NextResponse.json({ ok: true });
}
```

## 3️⃣ MCP Server (Hosted)

No server needed! Use the hosted endpoint:

```
https://api.thirdweb.com/mcp?secretKey=YOUR_SECRET_KEY
```

Filter tools (optional):
```
https://api.thirdweb.com/mcp?secretKey=KEY&tools=fetchWithPayment,getWalletBalance
```

## 4️⃣ Eliza Integration (Official Plugin)

### Setup

```bash
# Clone Eliza starter
git clone https://github.com/elizaos/eliza-starter.git mev-eliza
cd mev-eliza

# Install
pnpm install

# Configure .env
cat > .env << 'ENVEOF'
THIRDWEB_SECRET_KEY=your_thirdweb_secret
THIRDWEB_CLIENT_ID=your_client_id
OPENAI_API_KEY=your_openai_key
POLYGON_RPC_URL=your_rpc
PRIVATE_KEY=your_key
ENVEOF

# Start
pnpm start
```

### Character Configuration

```typescript
// agent/character.ts
import { thirdwebPlugin } from "@elizaos/plugin-thirdweb";

export default {
  name: "MEV-Hunter",
  plugins: [thirdwebPlugin()],
  
  instructions: [
    "Use thirdweb tools for onchain reads/writes",
    "Never execute transactions without approval",
    "Analyze MEV opportunities on Polygon",
  ],
  
  // MCP integration
  mcpServers: [{
    url: `https://api.thirdweb.com/mcp?secretKey=${process.env.THIRDWEB_SECRET_KEY}`
  }],
  
  // Blockchain context
  settings: {
    thirdweb: {
      chainId: 137,
      autoExecute: false,
    }
  }
};
```

## 5️⃣ Foundry Deploy & Verify

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Project Setup

```toml
# foundry.toml
[profile.default]
src = "contracts"
out = "out"
solc-version = "0.8.20"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
polygon = "${POLYGON_RPC_URL}"

[etherscan]
polygon = { key = "${ETHERSCAN_API_KEY}", chain = 137 }
```

### Deploy

```bash
# Build
forge build

# Deploy
forge create \
  --rpc-url $POLYGON_RPC_URL \
  --private-key $PRIVATE_KEY \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  contracts/MEVExecutor.sol:MEVExecutor \
  --constructor-args 0xBA12222222228d8Ba445958a75a0704d566BF2C8
```

### Verify Existing Contract

```bash
forge verify-contract \
  --chain-id 137 \
  --watch \
  0xa623c86831Fe8c23DD9dC9D53a0541623c23ecE3 \
  contracts/MEVExecutor.sol:MEVExecutor \
  --constructor-args $(cast abi-encode "constructor(address)" \
    0xBA12222222228d8Ba445958a75a0704d566BF2C8) \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

## 6️⃣ End-to-End Test

```bash
# 1. Start your server
pnpm dev

# 2. Test webhook (local)
BODY='{"test":"data"}'
SIG=$(printf "$BODY" | openssl dgst -sha256 -hmac "$INSIGHT_WEBHOOK_SECRET" | cut -d' ' -f2)

curl -X POST http://localhost:3000/api/insight/webhook \
  -H "x-thirdweb-signature: $SIG" \
  -d "$BODY"

# 3. Test chat API
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"Get WMATIC balance on Polygon"}],
    "id": "test"
  }'

# 4. Test MCP endpoint
curl "https://api.thirdweb.com/mcp?secretKey=$THIRDWEB_SECRET_KEY"
```

## 📚 Official Documentation Links

- Blockchain LLM: https://portal.thirdweb.com/ai/nebula
- MCP Server: https://portal.thirdweb.com/ai/mcp
- Insight Webhooks: https://portal.thirdweb.com/insight/webhooks
- Eliza Plugin: https://portal.thirdweb.com/ai/eliza
- llms.txt: https://api.thirdweb.com/llms.txt
- Foundry: https://book.getfoundry.sh

## ✅ Checklist

- [ ] thirdweb Client ID & Secret Key in .env
- [ ] Blockchain LLM API route (/api/chat)
- [ ] Insight Webhook configured & verified
- [ ] MCP endpoint accessible
- [ ] Eliza starter cloned with thirdwebPlugin
- [ ] Contract deployed with Foundry
- [ ] Contract verified on Polygonscan
- [ ] llms.txt added to agent prompts
- [ ] End-to-end smoke test passed

## 🚀 Production Ready

Your MEV bot now has:
✅ Official thirdweb Blockchain LLM integration
✅ Real-time monitoring via Insight Webhooks
✅ MCP server for agent tools
✅ Eliza framework with thirdweb plugin
✅ Verified smart contracts on Polygon

**Start extracting MEV with official thirdweb stack!**
