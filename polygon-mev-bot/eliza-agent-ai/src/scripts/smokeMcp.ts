import "dotenv/config";

async function main() {
  const secretKey = process.env.THIRDWEB_SECRET_KEY;

  if (!secretKey) {
    console.error("[smoke:mcp] THIRDWEB_SECRET_KEY is not set. Populate .env before running the smoke test.");
    process.exit(1);
  }

  const baseUrl = process.env.THIRDWEB_MCP_URL || "https://api.thirdweb.com/mcp";
  const baseEndpoint = new URL(baseUrl);
  baseEndpoint.searchParams.set("secretKey", secretKey);

  const callRpc = async (label: string, method: string, params: Record<string, unknown>, toolFilter?: string) => {
    const endpoint = new URL(baseEndpoint.toString());
    if (toolFilter) {
      endpoint.searchParams.set("tools", toolFilter);
    }

    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params
      })
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`(${label}) ${response.status} ${response.statusText} in ${latencyMs}ms\n${text}`);
    }

    const json = await response.json().catch(async () => {
      const raw = await response.text();
      throw new Error(`(${label}) Unexpected response format: ${raw}`);
    });

    if (json?.error) {
      throw new Error(`(${label}) ${json.error.message || JSON.stringify(json.error)}`);
    }

    const result = json.result;
    console.log(`✅ [${label}] succeeded in ${latencyMs}ms`);
    return result;
  };

  try {
    const listResponse = await callRpc("tools/list", "tools/list", {}, undefined);
    const tools = Array.isArray(listResponse?.tools) ? listResponse.tools : [];

    if (Array.isArray(tools) && tools.length > 0) {
      const names = tools
        .map((tool: any) => (typeof tool === "string" ? tool : tool?.name))
        .filter((name: any): name is string => typeof name === "string");
      console.log(`Tools available: ${names.join(", ")}`);
    } else {
      console.log("No tool catalog returned; continuing with manual checks.");
    }

    const wallets = await callRpc(
      "listServerWallets",
      "tools/call",
      {
        name: "listServerWallets",
        arguments: {}
      },
      "listServerWallets"
    );
    const walletText = Array.isArray(wallets?.content)
      ? wallets.content.find((chunk: any) => typeof chunk?.text === "string")?.text
      : undefined;
    if (walletText) {
      try {
        console.log(JSON.stringify(JSON.parse(walletText), null, 2));
      } catch {
        console.log(walletText);
      }
    } else {
      console.log(JSON.stringify(wallets, null, 2));
    }

    const testWallet = process.env.THIRDWEB_MCP_TEST_WALLET;
    if (testWallet) {
      const balance = await callRpc(
        "getWalletBalance",
        "tools/call",
        {
          name: "getWalletBalance",
          arguments: {
            address: testWallet,
            chainId: [137]
          }
        },
        "getWalletBalance"
      );
      const balanceText = Array.isArray(balance?.content)
        ? balance.content.find((chunk: any) => typeof chunk?.text === "string")?.text
        : undefined;
      if (balanceText) {
        try {
          console.log(JSON.stringify(JSON.parse(balanceText), null, 2));
        } catch {
          console.log(balanceText);
        }
      } else {
        console.log(JSON.stringify(balance, null, 2));
      }
    } else {
      console.log("Set THIRDWEB_MCP_TEST_WALLET to also verify getWalletBalance.");
    }
  } catch (error) {
    console.error("❌ Thirdweb MCP smoke test failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
