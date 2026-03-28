import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface NightcodeConfig {
  port: number;
  dataDir: string;
  reposDir: string;
  maxConcurrent: number;
  authToken: string | null;
  publicUrl: string | null;
  timezone: string;
  kavela: {
    apiKey: string | null;
    endpoint: string;
  };
  github: {
    token: string | null;
  };
}

export function loadConfig(): NightcodeConfig {
  const dataDir = process.env.NIGHTCODE_DATA_DIR || "./data";
  const reposDir = process.env.NIGHTCODE_REPOS_DIR || "./repos";

  // Try loading auth token from file if not in env
  let authToken = process.env.NIGHTCODE_AUTH_TOKEN || null;
  const tokenPath = join(dataDir, ".auth-token");
  if (!authToken && existsSync(tokenPath)) {
    authToken = readFileSync(tokenPath, "utf-8").trim();
  }

  return {
    port: parseInt(process.env.NIGHTCODE_PORT || "3777", 10),
    dataDir,
    reposDir,
    maxConcurrent: parseInt(
      process.env.NIGHTCODE_MAX_CONCURRENT || "2",
      10,
    ),
    authToken,
    publicUrl: process.env.NIGHTCODE_URL || null,
    timezone: process.env.TZ || "UTC",
    kavela: {
      apiKey: process.env.KAVELA_API_KEY || null,
      endpoint: "https://mcp.kavela.ai/sse",
    },
    github: {
      token: process.env.GITHUB_TOKEN || null,
    },
  };
}
