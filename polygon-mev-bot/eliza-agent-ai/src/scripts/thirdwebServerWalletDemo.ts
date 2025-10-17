import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import ThirdwebMcpService from "../services/thirdwebMcpService.js";

interface DemoContractCallConfig {
  contractAddress: string;
  functionName: string;
  abi: any;
  args?: any[];
  value?: string;
  chainId?: number;
}

function loadContractCallConfig(): DemoContractCallConfig | null {
  const configPath = process.env.THIRDWEB_DEMO_CALL_FILE;
  if (!configPath) {
    return null;
  }

  const resolvedPath = resolve(configPath);
  const raw = readFileSync(resolvedPath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!parsed.contractAddress || !parsed.functionName || !parsed.abi) {
    throw new Error("Invalid THIRDWEB_DEMO_CALL_FILE payload. Expect contractAddress, functionName, abi.");
  }

  return parsed;
}

async function main() {
  if (!process.env.THIRDWEB_SECRET_KEY) {
    console.error("[thirdweb-demo] THIRDWEB_SECRET_KEY is required. Populate your .env file before running this script.");
    process.exit(1);
  }

  const chainId = Number(process.env.THIRDWEB_CHAIN_ID || process.env.CHAIN_ID || "137");
  const service = new ThirdwebMcpService({ chainId });
  await service.initialize();

  console.log("🔌 Thirdweb MCP demo starting...");

  const serverWallet = await service.ensureServerWallet();
  console.log("✅ Server wallet ready:", serverWallet);

  const nativeBalance = await service.getWalletBalance({ address: serverWallet, chainId });
  console.log("💰 Native balance:", JSON.stringify(nativeBalance, null, 2));

  const usdcAddress = process.env.THIRDWEB_USDC_ADDRESS || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  const usdcBalance = await service.getWalletBalance({ address: serverWallet, chainId, tokenAddress: usdcAddress });
  console.log("💵 USDC balance:", JSON.stringify(usdcBalance, null, 2));

  if (process.env.THIRDWEB_DEMO_SEND === "true") {
    const recipient = process.env.THIRDWEB_DEMO_RECIPIENT;
    if (!recipient) {
      console.error("[thirdweb-demo] THIRDWEB_DEMO_RECIPIENT is required when THIRDWEB_DEMO_SEND=true");
    } else {
      const amount = process.env.THIRDWEB_DEMO_AMOUNT || "1000000";
      console.log(`🚀 Sending ${amount} units to ${recipient}...`);
      const transferResult = await service.sendTokens({
        to: recipient,
        amount,
        chainId,
        tokenAddress: usdcAddress
      });
      console.log("📦 Transfer response:", JSON.stringify(transferResult, null, 2));
    }
  } else {
    console.log("ℹ️  Set THIRDWEB_DEMO_SEND=true and THIRDWEB_DEMO_RECIPIENT=0x... to demo sendTokens");
  }

  try {
    const contractConfig = loadContractCallConfig();
    if (contractConfig) {
      console.log("🛠️  Executing contract call via Thirdweb MCP...");
      const writeResult = await service.writeContract({
        contractAddress: contractConfig.contractAddress,
        functionName: contractConfig.functionName,
        abi: contractConfig.abi,
        args: contractConfig.args ?? [],
        value: contractConfig.value,
        chainId: contractConfig.chainId ?? chainId
      });
      console.log("🧾 writeContract response:", JSON.stringify(writeResult, null, 2));

      const submissionId = (writeResult as any)?.id || (writeResult as any)?.transactionId;
      const txHash = (writeResult as any)?.transactionHash || (writeResult as any)?.hash || (writeResult as any)?.txHash;

      if (submissionId && !txHash) {
        console.log(`⏳ Polling Thirdweb for transaction ${submissionId}...`);
        const resolved = await service.waitForTransaction(submissionId);
        console.log("✅ Resolved transaction:", JSON.stringify(resolved, null, 2));
      }
    } else {
  console.log("ℹ️  Provide THIRDWEB_DEMO_CALL_FILE=./call.json to demo writeContract (see docs).");
    }
  } catch (error) {
    console.error("❌ Contract demo failed:", error);
  }

  console.log("✅ Thirdweb MCP demo complete.");
}

main().catch((error) => {
  console.error("❌ Thirdweb MCP demo errored:", error);
  process.exit(1);
});
