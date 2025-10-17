import { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { NebulaContractWriter } from "../services/nebulaContractWriter.js";

interface ContractRequestPayload {
  specification?: string;
  prompt?: string;
  contractName?: string;
  outputPath?: string;
  temperature?: number;
  maxTokens?: number;
}

function extractSpecification(content: any): string | null {
  if (!content) return null;
  if (content.data?.specification) return String(content.data.specification);
  if (content.data?.prompt) return String(content.data.prompt);
  if (content.text) return String(content.text);
  return null;
}

export const generateContractAction: Action = {
  name: "GENERATE_CONTRACT",
  similes: ["WRITE_CONTRACT", "NEBULA_CONTRACT", "GENERATE_SOLIDITY"],
  description: "Leverages Thirdweb Nebula to generate a production-grade Solidity contract and saves it to disk",

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const content: any = message.content;
    if (content?.type === "CONTRACT_GENERATION_REQUEST") return true;
    const text = typeof content?.text === "string" ? content.text.toLowerCase() : "";
    return text.includes("generate contract") || text.includes("nebula contract");
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      const payload = (message.content as { data?: ContractRequestPayload; text?: string }).data;
      const spec = extractSpecification(message.content as any);

      if (!spec || spec.trim().length === 0) {
        elizaLogger.warn("Nebula contract request missing specification");
        if (callback) {
          callback({
            success: false,
            text: "Contract specification required for Nebula generation"
          });
        }
        return false;
      }

      const writer = new NebulaContractWriter(runtime);
      const result = await writer.generate({
        prompt: spec,
        contractName: payload?.contractName,
        outputPath: payload?.outputPath,
        temperature: payload?.temperature,
        maxTokens: payload?.maxTokens
      });

      await runtime.messageManager.createMemory({
        userId: runtime.agentId,
        agentId: runtime.agentId,
        roomId: runtime.agentId,
        content: {
          text: `Generated contract ${payload?.contractName || "MEVExecutor"}`,
          type: "CONTRACT_GENERATION_RESULT",
          path: result.outputPath,
          latency: result.latency,
          timestamp: Date.now()
        }
      });

      if (callback) {
        callback({
          success: true,
          text: `Nebula generated contract at ${result.outputPath}`
        });
      }

      return true;
    } catch (error) {
      elizaLogger.error("Nebula contract generation failed", error);
      if (callback) {
        callback({
          success: false,
          text: `Contract generation failed: ${(error as Error).message}`
        });
      }
      return false;
    }
  },

  examples: [
    [
      {
        user: "system",
        content: {
          text: "Generate contract with Nebula",
          type: "CONTRACT_GENERATION_REQUEST",
          data: {
            specification: "Production-grade MEV executor for Polygon"
          }
        }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "🛠️ Request received. Calling Nebula for contract generation..."
        }
      }
    ]
  ]
};

export default generateContractAction;
