#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

const REQUIRED_FILES = [
  "AaveAdapter.sol",
  "DEXAdapter.sol",
  "Interfaces.sol",
  "JITAdapter.sol",
  "MEVExecutor.sol",
  "OracleLib.sol",
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ensureGeneratedContracts() {
  const generatedDir = resolve(process.cwd(), "contracts", "src", "generated");
  if (!existsSync(generatedDir)) {
    fail(`Generated contracts directory not found: ${generatedDir}`);
  }

  const files = new Set(readdirSync(generatedDir));

  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      fail(`Missing required generated contract: ${required}`);
    }

    const filePath = resolve(generatedDir, required);
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      fail(`Expected ${required} to be a file`);
    }

    if (stats.size < 200) {
      fail(`${required} appears to be empty or truncated (${stats.size} bytes)`);
    }

    const contents = readFileSync(filePath, "utf8");
    if (!/pragma\s+solidity/i.test(contents)) {
      fail(`${required} is missing a Solidity pragma`);
    }

    if (!/(contract|library|interface)\s+\w+/.test(contents)) {
      fail(`${required} does not declare a contract, library, or interface`);
    }
  }

  console.log("✅ All generated contracts present and non-empty.");
}

ensureGeneratedContracts();
