import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { testClaudeAuth } from "../../executor/claude-cli.js";
import { testSshAccess } from "../../executor/git-ops.js";

const app = new Hono();

// Get all settings
app.get("/", (c) => {
  const db = getDb();
  const settings = db.select().from(schema.settings).all();

  // Convert to key-value object, masking sensitive values
  const result: Record<string, string> = {};
  for (const s of settings) {
    if (s.key.includes("key") || s.key.includes("token") || s.key.includes("secret")) {
      result[s.key] = s.value.slice(0, 8) + "...";
    } else {
      result[s.key] = s.value;
    }
  }

  return c.json({ data: result });
});

// Update settings
app.patch("/", async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    db.insert(schema.settings)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, updatedAt: new Date().toISOString() },
      })
      .run();
  }

  return c.json({ data: { updated: true } });
});

// Test Claude Code authentication
app.post("/test-claude", async (c) => {
  const result = await testClaudeAuth();
  return c.json({ data: result });
});

// Test GitHub SSH access
app.post("/test-github", async (c) => {
  const result = await testSshAccess();
  return c.json({ data: result });
});

// Test Kavela MCP connection
app.post("/test-kavela", async (c) => {
  const body = await c.req.json();
  const apiKey = body.apiKey as string;

  if (!apiKey || !apiKey.startsWith("kav_")) {
    return c.json({
      data: { ok: false, error: "Invalid API key format. Must start with kav_" },
    });
  }

  try {
    const response = await fetch("https://mcp-staging.kavela.ai/api/users/me", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const data = await response.json() as { user?: { email?: string } };
      return c.json({
        data: { ok: true, email: data.user?.email },
      });
    }
    return c.json({
      data: { ok: false, error: `Authentication failed (${response.status})` },
    });
  } catch (err) {
    return c.json({
      data: {
        ok: false,
        error: err instanceof Error ? err.message : "Connection failed",
      },
    });
  }
});

export default app;
