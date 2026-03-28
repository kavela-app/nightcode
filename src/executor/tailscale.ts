import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { createChildLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("tailscale");

/**
 * Check if Tailscale is installed in the container
 */
export function isTailscaleInstalled(): boolean {
  return existsSync("/usr/bin/tailscale") || existsSync("/usr/sbin/tailscale");
}

/**
 * Check Tailscale status
 */
export async function getTailscaleStatus(): Promise<{
  installed: boolean;
  running: boolean;
  url: string | null;
  hostname: string | null;
  error?: string;
}> {
  if (!isTailscaleInstalled()) {
    return { installed: false, running: false, url: null, hostname: null };
  }

  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], { timeout: 5000 });
    const status = JSON.parse(stdout);

    let url: string | null = null;
    let hostname: string | null = null;

    if (status.Self) {
      hostname = status.Self.HostName || null;
      const dnsName = status.Self.DNSName;
      if (dnsName) {
        // DNSName is like "machine.tailnet-name.ts.net."
        url = `https://${dnsName.replace(/\.$/, "")}`;
      }
    }

    return {
      installed: true,
      running: status.BackendState === "Running",
      url,
      hostname,
    };
  } catch (err) {
    // tailscaled might not be running
    return {
      installed: true,
      running: false,
      url: null,
      hostname: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Start tailscaled daemon if not running
 */
async function ensureTailscaled(): Promise<void> {
  try {
    await execFileAsync("tailscale", ["status"], { timeout: 3000 });
    return; // already running
  } catch {
    // Start tailscaled in background
    log.info("Starting tailscaled daemon");
    const proc = spawn("tailscaled", ["--state=/var/lib/tailscale/tailscaled.state", "--socket=/var/run/tailscale/tailscaled.sock"], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();

    // Wait for it to be ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        await execFileAsync("tailscale", ["status"], { timeout: 2000 });
        log.info("tailscaled is ready");
        return;
      } catch { /* keep waiting */ }
    }
    throw new Error("tailscaled failed to start within 10 seconds");
  }
}

/**
 * Connect Tailscale with auth key and enable funnel
 */
export async function connectTailscale(authKey: string): Promise<{
  ok: boolean;
  url: string | null;
  error?: string;
}> {
  try {
    await ensureTailscaled();

    log.info("Connecting to Tailscale");

    // Authenticate
    await execFileAsync("tailscale", [
      "up",
      `--authkey=${authKey}`,
      "--hostname=nightcode",
    ], { timeout: 30000 });

    log.info("Tailscale connected, enabling funnel");

    // Enable funnel on port 3777
    // First, enable HTTPS
    await execFileAsync("tailscale", ["serve", "--bg", "--https=443", "http://127.0.0.1:3777"], { timeout: 15000 }).catch(() => {
      // serve might not be available, try funnel directly
    });

    try {
      await execFileAsync("tailscale", ["funnel", "--bg", "443"], { timeout: 15000 });
    } catch {
      // Funnel might need different syntax or might already be on
      log.warn("Funnel command failed — may need to be enabled in Tailscale admin console");
    }

    // Get the URL
    const status = await getTailscaleStatus();

    if (status.url) {
      log.info({ url: status.url }, "Tailscale funnel active");
      return { ok: true, url: status.url };
    }

    return { ok: true, url: null, error: "Connected but could not detect URL. Check Tailscale admin console." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "Tailscale connection failed");

    if (msg.includes("operation not permitted") || msg.includes("NET_ADMIN")) {
      return { ok: false, url: null, error: "Docker needs NET_ADMIN capability. Use: docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d" };
    }

    return { ok: false, url: null, error: msg };
  }
}

/**
 * Disconnect Tailscale
 */
export async function disconnectTailscale(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync("tailscale", ["down"], { timeout: 10000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
