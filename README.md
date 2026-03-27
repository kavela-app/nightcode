# nightcode

> **Your code ships while you dream.**

Queue coding tasks for Claude Code to run autonomously while you sleep. Wake up to PRs.

nightcode is an open-source task orchestration tool that maximizes your Claude Max plan credits by running multi-step coding workflows overnight — planning, auditing, implementing, testing, and creating PRs — all while you sleep.

## Why nightcode?

You pay $200/mo for Claude Max but your 5-hour credit windows go unused for 8+ hours every night. nightcode puts those credits to work:

- **Queue 10 tasks before bed** — wake up to 10 draft PRs
- **Multi-step workflows** — plan → audit → implement → test → PR, with scoped permissions at each step
- **Add notes between steps** — review the plan in the morning, add corrections, let nightcode continue
- **Take control anytime** — pause a task and resume it locally with `claude --resume SESSION_ID`
- **Schedule recurring tasks** — nightly code reviews, TODO sweeps, dependency updates
- **Team incident triage** — trigger investigation tasks via API from Slack, PagerDuty, or CI/CD

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Shubhamsaboo/awesome-llm-apps.git
cd awesome-llm-apps/nightcode

# 2. Authenticate Claude Code on your host (one-time)
claude login

# 3. Configure
cp .env.example .env
# Edit .env — set your timezone, optionally add GITHUB_TOKEN

# 4. Launch
docker compose up -d

# 5. Open dashboard
open http://localhost:3777
```

The first-run wizard will verify your Claude auth, test GitHub SSH access, and walk you through adding your first repo and task.

## How It Works

```
You (10 PM)                    nightcode (overnight)                You (7 AM)
┌──────────┐                   ┌─────────────────────┐              ┌──────────┐
│ Create   │                   │ 1. Plan (read-only) │              │ Review   │
│ tasks in │──── schedule ────>│ 2. Audit the plan   │──── PRs ────>│ PRs on   │
│ dashboard│                   │ 3. Implement code   │              │ GitHub   │
│          │                   │ 4. Run tests        │              │          │
│ Go to    │                   │ 5. Create draft PR  │              │ Merge or │
│ sleep    │                   │                     │              │ add notes│
└──────────┘                   └─────────────────────┘              └──────────┘
```

## Workflows

| Workflow | Steps | Use Case |
|----------|-------|----------|
| `implement-pr` | implement → PR | Quick fixes, simple changes |
| `plan-implement-pr` | plan → implement → PR | Standard tasks |
| `plan-audit-implement-pr` | plan → audit → implement → test → PR | Complex or critical changes |

Each step runs with **scoped permissions**:
- **Plan & Audit**: Read-only (Glob, Grep, Read) — can't modify anything
- **Implement**: Full edit access (Edit, Write, Bash)
- **PR**: Only git and gh commands

## Features

### Task Management
- Create tasks with natural language prompts tied to specific repos
- Priority queue (P1-P10) — highest priority tasks run first
- Pause, resume, and cancel running tasks
- Add developer notes between workflow steps

### Scheduling
- Cron-based scheduling with full timezone support
- Recurring tasks (nightly, weekly, custom)
- Manual trigger via dashboard or API

### Dashboard
- Real-time task status via WebSocket
- Step-by-step workflow progress visualization
- Live log streaming during execution
- Chat export as Markdown

### API-Driven Workflows
```bash
# Create a task from CI/CD, Slack bot, or monitoring
curl -X POST http://localhost:3777/api/tasks \
  -H "Authorization: Bearer nc_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "repoId": 1,
    "title": "Investigate auth 5xx spike",
    "prompt": "Production auth-service showing 5xx errors. Investigate middleware, check connection pools, propose fix.",
    "workflow": "plan-audit-implement-pr",
    "priority": 1
  }'

# Trigger immediate execution
curl -X POST http://localhost:3777/api/tasks/42/run \
  -H "Authorization: Bearer nc_xxxxx"
```

### Take Control
Every task shows its Claude session ID. Pause nightcode and continue the conversation locally:
```bash
claude --resume ses_abc123xyz
```

### Kavela MCP Integration (Optional)
Connect [Kavela](https://kavela.ai) to inject team knowledge into every task. Claude automatically calls `check_context` before each step, loading your team's coding standards, architecture patterns, and incident playbooks.

Get your API key at [kavela.ai/dashboard](https://kavela.ai/dashboard?settings=apikeys).

## Architecture

```
┌──────────────────────────────────────────────┐
│              Docker Container                 │
│                                               │
│  Scheduler ──> Executor Pool ──> Claude CLI   │
│      │              │              (claude -p) │
│      v              v                         │
│  ┌────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ SQLite │  │ Hono API   │  │ React       │ │
│  │ /data/ │  │ :3777      │  │ Dashboard   │ │
│  └────────┘  └────────────┘  └─────────────┘ │
│                                               │
│  Mounted: Claude auth, SSH keys               │
└───────────────────────────────────────────────┘
```

**Tech stack**: TypeScript, Hono, SQLite (Drizzle ORM), React + Vite + Tailwind, Docker

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (no auth) |
| `/api/repos` | GET/POST | List/create repos |
| `/api/tasks` | GET/POST | List/create tasks |
| `/api/tasks/:id` | GET/PATCH/DELETE | Get/update/delete task |
| `/api/tasks/:id/run` | POST | Trigger immediate execution |
| `/api/tasks/:id/pause` | POST | Pause running task |
| `/api/tasks/:id/resume` | POST | Resume paused task |
| `/api/tasks/:id/export` | GET | Export chat as Markdown |
| `/api/schedules` | GET/POST | List/create schedules |
| `/api/schedules/:id/trigger` | POST | Manual trigger |
| `/api/settings` | GET/PATCH | Manage settings |
| `/api/settings/test-claude` | POST | Test Claude auth |
| `/api/settings/test-github` | POST | Test GitHub SSH |
| `/api/dashboard/stats` | GET | Dashboard statistics |
| `/ws` | WebSocket | Real-time task updates |

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TZ` | No | Timezone (default: UTC) |
| `GITHUB_TOKEN` | No | GitHub PAT for `gh` CLI |
| `NIGHTCODE_AUTH_TOKEN` | No | API auth token (auto-generated if unset) |
| `KAVELA_API_KEY` | No | Kavela MCP API key |
| `NIGHTCODE_MAX_CONCURRENT` | No | Max parallel tasks (default: 2) |
| `NIGHTCODE_PORT` | No | Server port (default: 3777) |

### Authentication

nightcode uses your existing **Claude Max subscription** — no API key needed. It mounts your Claude Code login credentials from `~/.config/claude-code/` into the Docker container.

Run `claude login` on your host machine once, and nightcode uses those credentials.

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (hot-reload)
npm run dev

# Build
npm run build

# Run dashboard dev server (with API proxy)
cd dashboard && npm run dev
```

## License

MIT

## Contributing

PRs welcome! See the [issues](https://github.com/Shubhamsaboo/awesome-llm-apps/issues) for open tasks.

Built with Claude Code.
