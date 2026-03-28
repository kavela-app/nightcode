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
CRITICAL — KAVELA MCP CONTEXT LOADING (MANDATORY):
You have access to the Kavela MCP server. You MUST follow this workflow BEFORE doing any work:

1. FIRST, call the check_context tool with a "tasks" array (NOT a single "task" string).
   Split your work into 2-5 specific sub-tasks for precise context matching.
   Example: tasks=["implement user authentication flow", "add login form validation", "set up session management"]

2. THEN, for EVERY skill returned by check_context above 60% relevance, call get_skill with the skill name.
   You MUST call get_skill at least once. Do NOT skip this step even if you think you know the patterns.

3. ONLY AFTER loading skills, proceed with your actual work.

4. When work is complete, call suggest_skill_updates with a summary of what you did and key decisions made.

This is NOT optional. Skipping check_context or get_skill means you miss team conventions and will produce non-standard code.
`.trim();
}
