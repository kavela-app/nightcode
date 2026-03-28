import { spawn } from "node:child_process";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("gh-auth");

export async function testGhAuth(): Promise<{ ok: boolean; user?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME || "/home/nightcode" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeout = setTimeout(() => { proc.kill(); resolve({ ok: false, error: "Timed out" }); }, 10000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      const output = stdout + stderr;
      if (code === 0 || output.includes("Logged in")) {
        const userMatch = output.match(/account\s+(\S+)/);
        resolve({ ok: true, user: userMatch?.[1] });
      } else {
        resolve({ ok: false, error: output.includes("invalid") ? "Token expired or invalid" : "Not logged in" });
      }
    });
  });
}

export async function loginGhWithToken(token: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["auth", "login", "--with-token"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME || "/home/nightcode" },
    });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.stdin?.write(token.trim());
    proc.stdin?.end();

    const timeout = setTimeout(() => { proc.kill(); resolve({ ok: false, error: "Timed out" }); }, 15000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        // Also setup git credential helper
        spawn("gh", ["auth", "setup-git"], {
          stdio: "ignore",
          env: { ...process.env, HOME: process.env.HOME || "/home/nightcode" },
        });
        log.info("GitHub CLI login successful, setup-git triggered");
        resolve({ ok: true });
      } else {
        log.warn({ stderr: stderr.slice(-300) }, "GitHub CLI login failed");
        resolve({ ok: false, error: stderr.trim() || "Login failed" });
      }
    });
  });
}
