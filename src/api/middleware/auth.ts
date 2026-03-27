import { createMiddleware } from "hono/factory";
import type { NightcodeConfig } from "../../config/index.js";

/**
 * Bearer token authentication middleware.
 * Validates Authorization header against the configured auth token.
 * Skips auth if no token is configured (local-only mode).
 */
export function authMiddleware(config: NightcodeConfig) {
  return createMiddleware(async (c, next) => {
    // Skip auth for public endpoints
    if (c.req.path === "/api/health" || c.req.path.startsWith("/api/setup")) {
      return next();
    }

    // If no auth token configured, allow all requests (local mode)
    if (!config.authToken) {
      return next();
    }

    // Accept token from Authorization header or query param (for SSE/EventSource)
    const authHeader = c.req.header("Authorization");
    const queryToken = new URL(c.req.url).searchParams.get("token");
    const token = authHeader ? authHeader.replace("Bearer ", "") : queryToken;

    if (!token) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Missing Authorization header" } }, 401);
    }

    if (token !== config.authToken) {
      return c.json({ error: { code: "FORBIDDEN", message: "Invalid auth token" } }, 403);
    }

    return next();
  });
}
