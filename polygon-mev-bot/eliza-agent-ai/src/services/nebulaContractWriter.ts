import { IAgentRuntime, elizaLogger } from "@ai16z/eliza";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { getNebulaClient } from "../thirdweb-nebula-integration.js";

interface ContractGenerationParams {
  prompt: string;
  contractName?: string;
  outputPath?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ContractGenerationResult {
  code: string;
  raw: string;
  outputPath: string;
  latency: number;
}

export class NebulaContractWriter {
  constructor(private readonly runtime: IAgentRuntime) {}

  async generate(params: ContractGenerationParams): Promise<ContractGenerationResult> {
    const nebula = getNebulaClient();

    const contractName = params.contractName?.trim() || "MEVExecutor";
    const targetPath = params.outputPath
      ? resolve(process.cwd(), params.outputPath)
      : resolve(process.cwd(), "..", "contracts", "src", "generated", `${contractName}.sol`);

    const generation = await nebula.generateContract({
      name: contractName,
      specification: params.prompt,
      temperature: params.temperature,
      maxTokens: params.maxTokens
    });

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, generation.code, "utf8");

    elizaLogger.success(`✅ Nebula generated ${contractName} at ${targetPath}`);

    return {
      code: generation.code,
      raw: generation.raw,
      outputPath: targetPath,
      latency: generation.latency
    };
  }
}

export default NebulaContractWriter;
