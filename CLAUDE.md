# Nightcode

Autonomous Claude Code task runner. Queue coding tasks, run them in Docker via Claude Code, wake up to PRs.

## Architecture

- **Server**: Hono (Node.js) API on port 3777
- **Dashboard**: React + Vite SPA served from `/dashboard/dist/`
- **Database**: SQLite via Drizzle ORM (`better-sqlite3`)
- **Executor**: Spawns `claude -p` with `--dangerously-skip-permissions` (requires non-root user)
- **Docker**: Ubuntu 24.04, runs as `nightcode` user, volumes for data/repos/SSH/Claude auth

## Directory Structure

```
src/
  api/              Hono routes + middleware
    routes/         repos, tasks, schedules, settings, dashboard, agent, lark
    middleware/     auth (bearer token), error handler
  config/           Environment config loader
  db/               Drizzle schema + SQLite init
  executor/         Task execution engine
    steps/          Workflow step definitions (plan, audit, implement, test, pr)
    claude-cli.ts   Spawns claude CLI, handles OAuth PKCE auth
    event-bus.ts    EventEmitter for SSE streaming
    git-ops.ts      Clone, branch, commit, push, PR creation
    mcp-config.ts   Kavela MCP config generation
    workflow-engine.ts  Multi-step workflow orchestration
  scheduler/        Interval/cron-based task scheduling with time windows
  utils/            Logger (pino), crypto, templates
dashboard/
  src/
    api/client.ts   Typed API client with all endpoints
    pages/          Dashboard, Tasks, TaskDetail, Repos, Schedules, Settings, Setup
    components/     Layout, StepProgress
```

## Database Schema (src/db/schema.ts)

- **repos**: id, name, url, branch, systemPrompt, mcpConfig, kavelaGroup, allowedTools
- **tasks**: id, repoId, title, prompt, workflow, priority, status, currentStep, branchName, prUrl, prNumber, sessionId, error, notes, scheduleId
- **taskSteps**: id, taskId, stepName, stepOrder, status, sessionId, prompt, result
- **sessionMessages**: id, taskId, stepName, messageType, content (for chat export)
- **schedules**: id, name, cronExpr, intervalMinutes, windowStart, windowEnd, timezone, enabled, taskTemplate
- **settings**: key (PK), value (key-value store for API keys etc.)

## Key Patterns

- Auth: Bearer token via `Authorization` header or `?token=` query param (for SSE)
- Auth token auto-generated on first run, stored at `{dataDir}/.auth-token`
- API responses: `{ data: ... }` for success, `{ error: { code, message } }` for errors
- Validation: Zod schemas on all POST/PATCH routes
- Workflows: `implement-pr`, `plan-implement-pr`, `plan-audit-implement-pr`
- Task statuses: pending → queued → running → completed/failed/paused/cancelled
- SSE streaming: `/api/tasks/:id/stream` for live Claude output
- Git: auto HTTPS→SSH conversion when no GITHUB_TOKEN set
- OAuth PKCE: direct token exchange with `platform.claude.com` (no TTY needed)
- Kavela API key: resolved from env var `KAVELA_API_KEY` or DB settings table

## Development

```bash
npm run dev          # tsx watch server
npm run build        # tsc + vite build
npm start            # node dist/index.js
```

## Docker

```bash
npm run build
docker compose up -d --build
```

Runs as non-root `nightcode` user. SSH keys mount to `/home/nightcode/.ssh:ro`.

## Commit Convention

Follow Kavela conventions: `feat:`, `fix:`, `major:`, `chore:` prefix. Add `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` when AI-assisted.
