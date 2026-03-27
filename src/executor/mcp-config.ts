import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("mcp-config");

export interface McpServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Generate a temporary .mcp.json file for a task execution.
 * Returns the file path.
 */
export function generateMcpConfig(
  taskId: number,
  kavelaApiKey?: string | null,
  customConfig?: string | null,
): string | null {
  const servers: Record<string, McpServerConfig> = {};

  // Add Kavela MCP if configured
  if (kavelaApiKey) {
    servers.kavela = {
      type: "sse",
      url: "https://mcp.kavela.ai/sse",
      headers: {
        Authorization: `Bearer ${kavelaApiKey}`,
      },
    };
    log.info({ taskId }, "Adding Kavela MCP server to config");
  }

  // Parse and add custom MCP servers
  if (customConfig) {
    try {
      const custom = JSON.parse(customConfig);
      if (custom.mcpServers) {
        Object.assign(servers, custom.mcpServers);
      } else {
        Object.assign(servers, custom);
      }
    } catch (err) {
      log.warn({ taskId, error: err }, "Failed to parse custom MCP config");
    }
  }

  // No MCP servers to configure
  if (Object.keys(servers).length === 0) {
    return null;
  }

  // Write to temp file
  const tmpDir = join(tmpdir(), "nightcode");
  mkdirSync(tmpDir, { recursive: true });

  const configPath = join(tmpDir, `task-${taskId}-mcp.json`);
  const config = { mcpServers: servers };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  log.info(
    { taskId, path: configPath, servers: Object.keys(servers) },
    "Generated MCP config",
  );

  return configPath;
}

/**
 * Build the system prompt addition for Kavela-aware execution.
 */
export function buildKavelaSystemPrompt(hasKavela: boolean): string {
  if (!hasKavela) return "";

  return `
IMPORTANT: You have access to the Kavela MCP server for team context.
- Before starting work, call check_context with a description of your current task to load relevant team knowledge, coding standards, and patterns.
- After completing significant work, call suggest_skill_updates to capture any new patterns or decisions worth remembering for the team.
- Use get_skill to load full content of any skills surfaced by check_context.
`.trim();
}
