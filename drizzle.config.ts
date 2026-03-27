import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.NIGHTCODE_DATA_DIR
      ? `${process.env.NIGHTCODE_DATA_DIR}/nightcode.db`
      : "./data/nightcode.db",
  },
});
