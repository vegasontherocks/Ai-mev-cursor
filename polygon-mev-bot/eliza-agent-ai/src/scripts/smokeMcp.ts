import "dotenv/config";

async function main() {
  const secretKey = process.env.THIRDWEB_SECRET_KEY;

  if (!secretKey) {
    console.error("[smoke:mcp] THIRDWEB_SECRET_KEY is not set. Populate .env before running the smoke test.");
    process.exit(1);
  }

  const endpoint = new URL("https://api.thirdweb.com/mcp");
  endpoint.searchParams.set("secretKey", secretKey);
  endpoint.searchParams.set("tools", "listServerWallets");

  const payload = {
    type: "callTool",
    toolName: "listServerWallets",
    arguments: {}
  };

  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const text = await response.text();
      console.error(`⚠️  MCP request failed (${response.status} ${response.statusText}) in ${latencyMs}ms`);
      console.error(text);
      process.exit(1);
    }

    const result = await response.json().catch(async () => {
      const raw = await response.text();
      throw new Error(`Unexpected response format: ${raw}`);
    });

    console.log(`✅ Thirdweb MCP response received in ${latencyMs}ms`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Failed to contact Thirdweb MCP server:", error);
    process.exit(1);
  }
}

main();
