import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { createChildLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("git-ops");

const HTTPS_GIT_RE =
  /^https:\/\/(github\.com|gitlab\.com)\/([^/]+\/[^/]+?)(?:\.git)?$/;

/**
 * Convert an HTTPS GitHub/GitLab URL to SSH format.
 * Already-SSH URLs (or URLs for other hosts) are returned as-is.
 */
export function toSshUrl(url: string): string {
  const match = url.match(HTTPS_GIT_RE);
  if (!match) return url;

  const [, host, ownerRepo] = match;
  return `git@${host}:${ownerRepo}.git`;
}

/**
 * If the URL is HTTPS and no GITHUB_TOKEN is set, auto-convert to SSH
 * so that clones/pushes use the SSH key instead.
 */
function maybeConvertToSsh(url: string): string {
  if (process.env.GITHUB_TOKEN) return url;

  const converted = toSshUrl(url);
  if (converted !== url) {
    log.info(
      { from: url, to: converted },
      "No GITHUB_TOKEN set — converted HTTPS URL to SSH",
    );
  }
  return converted;
}

/**
 * Clone a repo if it doesn't exist, or fetch latest if it does.
 */
export async function ensureRepo(
  repoUrl: string,
  reposDir: string,
  repoName: string,
): Promise<string> {
  const workDir = join(reposDir, repoName);
  const effectiveUrl = maybeConvertToSsh(repoUrl);

  if (existsSync(join(workDir, ".git"))) {
    log.info({ workDir }, "Repo exists, fetching latest");
    await git(workDir, ["fetch", "--all", "--prune"]);
  } else {
    log.info({ url: effectiveUrl, workDir }, "Cloning repo");
    await execFileAsync("git", ["clone", effectiveUrl, workDir], {
      timeout: 120_000,
    });
  }

  return workDir;
}

/**
 * Create a new branch from the base branch for a task.
 */
export async function createTaskBranch(
  workDir: string,
  baseBranch: string,
  branchName: string,
): Promise<void> {
  log.info({ baseBranch, branchName }, "Creating task branch");

  // Checkout base and pull latest
  await git(workDir, ["checkout", baseBranch]);
  await git(workDir, ["pull", "origin", baseBranch]);

  // Create and checkout new branch
  try {
    await git(workDir, ["checkout", "-b", branchName]);
  } catch {
    // Branch might already exist from a retry
    await git(workDir, ["checkout", branchName]);
    await git(workDir, ["reset", "--hard", `origin/${baseBranch}`]);
  }
}

/**
 * Stage, commit, and push changes.
 */
export async function commitAndPush(
  workDir: string,
  branchName: string,
  commitMessage: string,
): Promise<void> {
  log.info({ branchName }, "Committing and pushing changes");

  // Ensure the origin remote uses SSH when no token is available
  await ensureRemoteSsh(workDir);

  await git(workDir, ["add", "-A"]);

  // Check if there are changes to commit
  const status = await git(workDir, ["status", "--porcelain"]);
  if (!status.trim()) {
    log.info("No changes to commit");
    return;
  }

  await git(workDir, [
    "commit",
    "-m",
    commitMessage,
  ]);
  await git(workDir, ["push", "-u", "origin", branchName]);
}

/**
 * Create a GitHub PR using gh CLI.
 */
export async function createPr(
  workDir: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<{ url: string; number: number }> {
  log.info({ title, baseBranch }, "Creating GitHub PR");

  const result = await execFileAsync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--base",
      baseBranch,
      "--draft",
      "--json",
      "url,number",
    ],
    { cwd: workDir, timeout: 30_000 },
  );

  const pr = JSON.parse(result.stdout);
  log.info({ url: pr.url, number: pr.number }, "PR created");
  return pr;
}

/**
 * Test SSH access to a git host.
 */
export async function testSshAccess(
  host = "github.com",
): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync("ssh", ["-T", `-o`, `ConnectTimeout=5`, `git@${host}`], {
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err) {
    // ssh -T git@github.com exits with 1 even on success
    const stderr =
      err instanceof Error && "stderr" in err
        ? (err as { stderr: string }).stderr
        : "";
    if (stderr.includes("successfully authenticated")) {
      return { ok: true };
    }
    return {
      ok: false,
      error: stderr || (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Generate a branch name from a task title.
 */
export function generateBranchName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const timestamp = Date.now().toString(36);
  return `nightcode/${slug}-${timestamp}`;
}

/**
 * If the origin remote is an HTTPS GitHub/GitLab URL and no GITHUB_TOKEN is
 * set, rewrite it to the SSH equivalent so push/pull use the SSH key.
 */
async function ensureRemoteSsh(workDir: string): Promise<void> {
  const currentUrl = (
    await git(workDir, ["remote", "get-url", "origin"])
  ).trim();
  const converted = maybeConvertToSsh(currentUrl);
  if (converted !== currentUrl) {
    await git(workDir, ["remote", "set-url", "origin", converted]);
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: 60_000,
  });
  return stdout;
}
