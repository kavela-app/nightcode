import type { ErrorHandler } from "hono";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("api");

export const errorHandler: ErrorHandler = (err, c) => {
  log.error({ error: err.message, path: c.req.path }, "API error");

  const status = "status" in err ? (err as { status: number }).status : 500;

  return c.json(
    {
      error: {
        code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
        message: err.message || "Internal server error",
      },
    },
    status as 400 | 401 | 403 | 404 | 500,
  );
};
