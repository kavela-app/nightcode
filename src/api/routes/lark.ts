import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("lark");

type AgentHandler = (message: string) => Promise<{ reply: string; action: string | null; data?: unknown }>;

// ── Lark API helpers ──

async function getLarkAccessToken(appId: string, appSecret: string): Promise<string> {
  const resp = await fetch("https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!resp.ok) {
    throw new Error(`Lark auth failed with status ${resp.status}`);
  }

  const data = (await resp.json()) as { code: number; msg: string; app_access_token?: string };
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`Lark auth error: ${data.msg}`);
  }

  return data.app_access_token;
}

async function sendLarkReply(accessToken: string, chatId: string, text: string): Promise<void> {
  const resp = await fetch(
    `https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    log.warn({ status: resp.status, body: body.slice(0, 200) }, "Failed to send Lark reply");
  }
}

function getLarkCredentials(): { appId: string; appSecret: string } | null {
  const db = getDb();
  const appIdRow = db.select().from(schema.settings).where(eq(schema.settings.key, "lark_app_id")).get();
  const appSecretRow = db.select().from(schema.settings).where(eq(schema.settings.key, "lark_app_secret")).get();

  if (!appIdRow?.value || !appSecretRow?.value) {
    return null;
  }

  return { appId: appIdRow.value, appSecret: appSecretRow.value };
}

// ── Deduplication for Lark event retries ──

const processedEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicateEvent(eventId: string): boolean {
  // Clean up old entries
  const now = Date.now();
  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_TTL_MS) processedEvents.delete(id);
  }

  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

// ── Routes ──

export function createLarkRoutes(agentHandler: AgentHandler) {
  const app = new Hono();

  // POST /webhook — Lark event callback
  app.post("/webhook", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();

    // URL verification challenge
    if (body.type === "url_verification") {
      log.info("Lark URL verification challenge received");
      return c.json({ challenge: body.challenge });
    }

    // Event callback
    const header = body.header as Record<string, unknown> | undefined;
    if (header?.event_type === "im.message.receive_v1") {
      const eventId = header.event_id as string;

      // Deduplicate retried events
      if (eventId && isDuplicateEvent(eventId)) {
        log.debug({ eventId }, "Duplicate Lark event, skipping");
        return c.json({ code: 0, msg: "ok" });
      }

      const event = body.event as Record<string, unknown> | undefined;
      const message = event?.message as Record<string, unknown> | undefined;
      const chatId = message?.chat_id as string;
      const msgType = message?.message_type as string;
      const content = message?.content as string;

      if (!chatId || !content) {
        log.warn("Lark event missing chat_id or content");
        return c.json({ code: 0, msg: "ok" });
      }

      // Only handle text messages
      if (msgType !== "text") {
        log.debug({ msgType }, "Ignoring non-text Lark message");
        return c.json({ code: 0, msg: "ok" });
      }

      // Extract text from Lark content JSON
      let text: string;
      try {
        const parsed = JSON.parse(content) as { text?: string };
        text = parsed.text || content;
      } catch {
        text = content;
      }

      // Strip @mention prefix if present
      text = text.replace(/@\S+\s*/, "").trim();

      if (!text) {
        return c.json({ code: 0, msg: "ok" });
      }

      log.info({ chatId, textLength: text.length }, "Processing Lark message");

      // Get Lark credentials
      const creds = getLarkCredentials();
      if (!creds) {
        log.warn("Lark credentials not configured in settings");
        return c.json({ code: 0, msg: "ok" });
      }

      // Process in background so we return 200 quickly (Lark has a 3s timeout)
      (async () => {
        try {
          const result = await agentHandler(text);
          const accessToken = await getLarkAccessToken(creds.appId, creds.appSecret);

          let replyText = result.reply;
          if (result.data && result.action) {
            // Append summary data for list/stats actions
            if (Array.isArray(result.data) && result.data.length > 0) {
              const items = result.data.slice(0, 10).map((item: Record<string, unknown>) =>
                item.name || item.title || `id=${item.id}`,
              );
              replyText += "\n" + items.join("\n");
            }
          }

          await sendLarkReply(accessToken, chatId, replyText);
        } catch (err) {
          log.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to process Lark message");
          try {
            const accessToken = await getLarkAccessToken(creds.appId, creds.appSecret);
            await sendLarkReply(accessToken, chatId, `Error: ${err instanceof Error ? err.message : "Unknown error"}`);
          } catch {
            // Best effort reply failed
          }
        }
      })();

      return c.json({ code: 0, msg: "ok" });
    }

    // Unknown event type
    log.debug({ type: body.type, eventType: header?.event_type }, "Unhandled Lark event");
    return c.json({ code: 0, msg: "ok" });
  });

  // POST /test — manual test endpoint
  app.post("/test", async (c) => {
    const body = await c.req.json<{ message: string }>();
    if (!body.message) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "\"message\" field is required" } }, 400);
    }

    const result = await agentHandler(body.message);
    return c.json({ data: result });
  });

  return app;
}
