# nightcode

> **Your code ships while you dream.**

Queue coding tasks for Claude Code to run autonomously while you sleep. Wake up to PRs.

nightcode is an open-source task orchestration tool that maximizes your Claude Max plan credits by running multi-step coding workflows overnight — planning, auditing, implementing, testing, and creating PRs — all while you sleep.

## Use Cases

### Overnight batch coding
Queue 10 tasks before bed. nightcode runs them sequentially through plan → implement → PR workflows. Wake up to 10 pull requests ready for review.

### Bug triage from chat
Your team reports a bug in Lark: "login page crashes on empty password." The Lark bot picks it up, creates a task, and nightcode investigates, fixes, and PRs — all before you check your messages.

### Iterative refinement
nightcode creates a PR. You review it and type "the topup section should reuse the existing CreditPack component" in the task detail page. nightcode creates a refinement subtask, pushes to the same branch, and the PR updates automatically.

### Nightly code maintenance
Set a schedule: every night between 10 PM and 6 AM, run any pending tasks. Queue dependency updates, TODO sweeps, or migration tasks during the day — they run overnight.

### Team knowledge injection
Connect [Kavela](https://kavela.ai) and every task automatically loads your team's coding standards, architecture patterns, and best practices before writing a single line of code. The PR body shows which knowledge files were consulted.

### Remote agent
Expose nightcode via Tailscale Funnel. Now it's callable from anywhere — your phone, another desktop, CI/CD pipelines, or a Lark bot. Send natural language: "create a task to add dark mode to the frontend repo" and nightcode does the rest.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/kavela-app/nightcode.git
cd nightcode

# 2. Build
npm install && npm run build

# 3. Configure (optional)
cp .env.example .env
# Edit .env — set your timezone

# 4. Launch
docker compose up -d --build

# 5. Open dashboard
open http://localhost:3777
```

The first-run wizard walks you through:
1. **Claude Max login** — OAuth in-browser (works inside Docker, no TTY needed)
2. **GitHub token** — fine-grained PAT for PR creation (scoped to specific repos)
3. **Kavela MCP** — optional team knowledge integration
4. **First repo** — add a Git URL and you're ready to create tasks

## How It Works

```
You (10 PM)                    nightcode (overnight)                You (7 AM)
┌──────────┐                   ┌─────────────────────┐              ┌──────────┐
│ Create   │                   │ 1. Plan (read-only) │              │ Review   │
│ tasks in │──── schedule ────>│ 2. Audit the plan   │──── PRs ────>│ PRs on   │
│ dashboard│                   │ 3. Implement code   │              │ GitHub   │
│          │                   │ 4. Run tests        │              │          │
│ Go to    │                   │ 5. Create PR        │              │ Merge or │
│ sleep    │                   │                     │              │ refine   │
└──────────┘                   └─────────────────────┘              └──────────┘
                                                                         │
                                                              "fix the import"
                                                                         │
                                                                    Subtask ──> same branch ──> PR updates
```

## Workflows

| Workflow | Steps | Best For |
|----------|-------|----------|
| `implement-pr` | implement → PR | Quick fixes, one-file changes |
| `plan-implement-pr` | plan → implement → PR | Standard feature work |
| `plan-audit-implement-pr` | plan → audit → implement → test → PR | Complex changes, critical systems |

Each step runs with **scoped permissions**:
- **Plan & Audit**: Read-only (Glob, Grep, Read) — can't modify anything
- **Implement**: Full edit access (Edit, Write, Bash)
- **PR**: Only git and gh commands

## Features

### Task Management
- Create tasks with natural language prompts tied to specific repos
- Inline repo creation — add a new repo right from the task creation form
- Priority queue (P1-P10) — highest priority tasks run first
- Pause, resume, and cancel running tasks
- Live streaming logs — watch Claude work in real-time
- Activity log persists after completion for review

### Refinement Loop
- Review a completed task's PR and send feedback from the dashboard
- Creates a subtask on the same branch — PR updates automatically
- Chain multiple refinements: parent → refine → refine again
- Each refinement inherits repo, branch, and session context

### Scheduling
- Interval-based: every 30min, 1h, 2h, 4h, 8h, 12h, or 24h
- Time windows — only run between 10 PM and 6 AM (overnight window support)
- Timezone-aware — set your local timezone
- Tasks auto-assign to active schedules
- Toggle schedules on/off from the dashboard

### Agent API (Natural Language)
Send natural language commands and nightcode figures out what to do:

```bash
curl -X POST https://your-nightcode.ts.net/api/agent \
  -H "Authorization: Bearer nc_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a task to fix the login bug on the frontend repo"}'
```

The agent uses Claude (Sonnet, via your Max plan) to parse intent — no extra API key needed. Also available as a chat UI in the dashboard at `/agent`.

### Lark Integration
Connect nightcode to Lark so your team can interact via chat:

1. Create a Lark bot at [open.larksuite.com](https://open.larksuite.com)
2. Set the webhook URL to `https://your-nightcode.ts.net/api/lark/webhook`
3. Add `lark_app_id` and `lark_app_secret` in nightcode Settings
4. Your team can now message the bot: "create a task to add dark mode to the frontend"

### Dashboard
- Real-time task status via SSE streaming
- Live terminal-style log view — tool calls, results, Claude's reasoning
- Step-by-step workflow progress
- PR links with rich bodies (summary, changes, key decisions, plan)
- Agent chat UI for natural language commands
- Token rotation with one-click reveal + copy

### Take Control
Every completed task includes a `claude --from-pr` command in both the dashboard and the PR body:
```bash
claude --from-pr https://github.com/org/repo/pull/42
```
This resumes the session on your local machine with full PR context.

### Screenshots (Optional)
Enable Playwright for headless Chromium screenshots of UI changes:

```bash
# Build with Playwright support (adds ~400MB to image)
docker compose build --build-arg INSTALL_PLAYWRIGHT=true
```

When enabled, Claude can take screenshots of Next.js pages during the implement step to include visual diffs in PRs. This is opt-in — Claude decides when screenshots are useful (UI changes, not backend fixes).

### Kavela MCP Integration (Optional)
Connect [Kavela](https://kavela.ai) to inject team knowledge into every task:
- Claude calls `check_context` before each step with a task breakdown
- Loads relevant coding standards, patterns, and architecture decisions via `get_skill`
- PR body shows which knowledge files were consulted
- After completing work, suggests updates to the team knowledge base

## Remote Access with Tailscale

nightcode runs on `localhost:3777` by default. To access it from other machines, your phone, or connect it to Lark/Slack bots, use [Tailscale](https://tailscale.com) (free):

### Option 1: Private access (your devices only)

```bash
# Install Tailscale (one-time)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Expose nightcode to your tailnet
tailscale serve --bg 3777
```

Access from any device on your Tailscale network at `https://<machine-name>.<tailnet>.ts.net`. Invisible to the internet.

### Option 2: Public access (for Lark bots, team access)

```bash
tailscale funnel 3777
```

Stable public HTTPS URL. Your team accesses via Lark bot — they never see the URL or token directly.

**Security**: Bearer token auth protects every endpoint. Auto-generated on first run. Rotate anytime from Settings.

### Docker + Tailscale (VPS deployment)

```yaml
# docker-compose.override.yml
services:
  tailscale:
    image: tailscale/tailscale:latest
    hostname: nightcode
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_EXTRA_ARGS=--advertise-tags=tag:server
      - TS_SERVE_CONFIG=/config/serve.json
    volumes:
      - tailscale-state:/var/lib/tailscale
      - ./tailscale-config:/config
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    restart: unless-stopped

volumes:
  tailscale-state:
```

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
│  Mounted: Claude auth, SSH keys, gh CLI       │
└───────────────────────────────────────────────┘
         │
         │  Tailscale Funnel (optional)
         v
    Public HTTPS ──> Lark bot / agent API / remote access
```

**Tech stack**: TypeScript, Hono, SQLite (Drizzle ORM), React + Vite + Tailwind, Docker

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (no auth) |
| `/api/repos` | GET/POST | List/create repos |
| `/api/tasks` | GET/POST | List/create tasks |
| `/api/tasks/:id` | GET/PATCH/DELETE | Task details with steps + subtasks |
| `/api/tasks/:id/run` | POST | Trigger immediate execution |
| `/api/tasks/:id/pause` | POST | Pause running task |
| `/api/tasks/:id/resume` | POST | Resume paused task |
| `/api/tasks/:id/refine` | POST | Create refinement subtask from feedback |
| `/api/tasks/:id/stream` | GET (SSE) | Live task output stream |
| `/api/tasks/:id/export` | GET | Export chat as Markdown |
| `/api/schedules` | GET/POST | List/create schedules |
| `/api/schedules/:id` | PATCH | Update/toggle schedule |
| `/api/schedules/:id/trigger` | POST | Manual trigger |
| `/api/agent` | POST | Natural language commands |
| `/api/lark/webhook` | POST | Lark bot webhook (no auth) |
| `/api/settings` | GET/PATCH | Manage settings |
| `/api/settings/rotate-token` | POST | Rotate API auth token |
| `/api/dashboard/stats` | GET | Dashboard statistics |

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TZ` | No | Timezone (default: UTC) |
| `NIGHTCODE_AUTH_TOKEN` | No | API auth token (auto-generated if unset) |
| `NIGHTCODE_URL` | No | Public URL for PR backlinks (default: http://localhost:3777) |
| `KAVELA_API_KEY` | No | Kavela MCP API key |
| `NIGHTCODE_MAX_CONCURRENT` | No | Max parallel tasks (default: 2) |
| `NIGHTCODE_PORT` | No | Server port (default: 3777) |

### Build Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `INSTALL_PLAYWRIGHT` | `false` | Install headless Chromium for screenshots |

```bash
# Standard build
docker compose up -d --build

# With Playwright screenshots
docker compose build --build-arg INSTALL_PLAYWRIGHT=true
docker compose up -d
```

### Authentication

nightcode uses your existing **Claude Max subscription** — no API key needed. The dashboard has a built-in OAuth login flow (PKCE, works inside Docker without a TTY).

For GitHub, create a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to specific repos (Contents + Pull requests R/W). For collaborator repos, use a [classic PAT](https://github.com/settings/tokens/new?scopes=repo,read:org&description=nightcode) with `repo` + `read:org`.

### Skill File

nightcode ships with a `nightcode.md` skill file for managing it from any Claude Code session:

```bash
# Copy to your Claude config
cp nightcode.md ~/.claude/

# Then from any project:
# "add my-api repo to nightcode and create a task to fix the login bug"
```

## Development

```bash
npm install          # Install dependencies
npm run dev          # Dev mode (hot-reload)
npm run build        # Build server + dashboard
cd dashboard && npm run dev  # Dashboard dev server
```

## License

MIT

## Contributing

PRs welcome! See the [issues](https://github.com/kavela-app/nightcode/issues) for open tasks.

Built with Claude Code.
