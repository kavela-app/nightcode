import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../db/index.js";
import { testSshAccess } from "../../executor/git-ops.js";

const app = new Hono();

const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().min(1),
  branch: z.string().default("main"),
  systemPrompt: z.string().optional(),
  mcpConfig: z.string().optional(),
  kavelaGroup: z.string().optional(),
  allowedTools: z.string().optional(),
});

// List all repos
app.get("/", (c) => {
  const db = getDb();
  const repos = db.select().from(schema.repos).all();
  return c.json({ data: repos });
});

// Get single repo
app.get("/:id", (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);
  const repo = db.select().from(schema.repos).where(eq(schema.repos.id, id)).get();
  if (!repo) return c.json({ error: { code: "NOT_FOUND", message: "Repo not found" } }, 404);
  return c.json({ data: repo });
});

// Create repo
app.post("/", async (c) => {
  const db = getDb();
  const body = await c.req.json();
  const parsed = createRepoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const result = db.insert(schema.repos).values(parsed.data).returning().get();
  return c.json({ data: result }, 201);
});

// Update repo
app.patch("/:id", async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

  const result = db
    .update(schema.repos)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.repos.id, id))
    .returning()
    .get();

  if (!result) return c.json({ error: { code: "NOT_FOUND", message: "Repo not found" } }, 404);
  return c.json({ data: result });
});

// Delete repo
app.delete("/:id", (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);
  db.delete(schema.repos).where(eq(schema.repos.id, id)).run();
  return c.json({ data: { deleted: true } });
});

// Test SSH connection
app.post("/:id/test-connection", async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);
  const repo = db.select().from(schema.repos).where(eq(schema.repos.id, id)).get();
  if (!repo) return c.json({ error: { code: "NOT_FOUND", message: "Repo not found" } }, 404);

  // Extract host from URL
  const match = repo.url.match(/@([^:]+):/);
  const host = match ? match[1] : "github.com";

  const result = await testSshAccess(host);
  return c.json({ data: result });
});

export default app;
