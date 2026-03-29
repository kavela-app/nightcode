# nightcode

> **Your code ships while you dream.**

An open-source autonomous coding agent that runs Claude Code tasks overnight — planning, implementing, testing, and creating PRs while you sleep. Maximize your Claude Max credits by putting the unused hours to work.

## Use Cases

### Overnight batch coding
Queue 10 tasks before bed. nightcode runs them through plan → implement → PR workflows. Wake up to pull requests ready for review.

### Bug triage from chat
Your team reports a bug in Lark: "login page crashes on empty password." The Lark bot picks it up, nightcode investigates, fixes, and PRs — before anyone checks messages.

### Iterative refinement
nightcode creates a PR. You review it and send feedback: "reuse the existing CreditPack component." nightcode creates a refinement subtask, pushes to the same branch, and the PR updates automatically. Repeat until it's right.

### Recurring audits
Set a task as recurring — nightcode re-runs it after every completion. Use for daily dependency audits, code quality sweeps, security checks, or TODO cleanup across your repos.

### Cross-repo features
A feature touches both frontend and backend? Select multiple repos for one task. Claude sees all codebases simultaneously via `--add-dir`, makes coordinated changes, and creates PRs in each repo.

### Nightly maintenance
Set a schedule with a time window (10 PM – 6 AM). Queue tasks during the day — they run overnight within the window, using your idle Claude Max credits.

### Natural language agent
Talk to nightcode in plain English — from the dashboard chat, the API, or a Lark bot: "create a task to add dark mode to the frontend repo and run it." nightcode parses intent and executes.

### Team knowledge injection
Connect [Kavela](https://kavela.ai) and every task automatically loads your team's coding standards and architecture patterns before writing code. PRs show which knowledge files were consulted.

### Remote control
Expose nightcode via Tailscale. Access the dashboard from your phone, call the agent API from another machine, or let a Lark bot manage tasks — all secured with bearer token auth.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/kavela-app/nightcode.git
cd nightcode

# 2. Build
npm install && npm run build

# 3. Launch
docker compose up -d --build

# 4. Open dashboard
open http://localhost:3777
```

The setup wizard walks you through: Claude Max OAuth login → GitHub token → optional Kavela + Tailscale → first repo.

## How It Works

```
You (10 PM)                    nightcode (overnight)                You (7 AM)
┌──────────┐                   ┌─────────────────────┐              ┌──────────┐
│ Queue    │                   │ 1. Plan (read-only) │              │ Review   │
│ tasks +  │──── schedule ────>│ 2. Audit the plan   │──── PRs ────>│ PRs on   │
│ go to    │                   │ 3. Implement code   │              │ GitHub   │
│ sleep    │                   │ 4. Run tests        │              │          │
│          │                   │ 5. Create PR        │              │ Refine   │
│          │                   │    (per repo)       │              │ or merge │
└──────────┘                   └─────────────────────┘              └──────────┘
```

## Features

### Workflows
| Workflow | Steps | Best For |
|----------|-------|----------|
| `implement-pr` | implement → PR | Quick fixes, one-file changes |
| `plan-implement-pr` | plan → implement → PR | Standard feature work |
| `plan-audit-implement-pr` | plan → audit → implement → test → PR | Complex or critical changes |

Each step runs with scoped permissions: plan/audit are read-only, implement has full edit access, PR only does git operations.

### Task Management
- Natural language prompts tied to one or multiple repos
- Priority queue (P1–P10) — highest priority runs first
- Recurring tasks — auto-recreate after completion for daily audits/sweeps
- Pause, resume, cancel running tasks
- Delete tasks, filter by status (pending/running/completed/failed)
- Inline repo creation from the task form
- Repo names shown on every task

### Multi-Repo Support
- Select a primary repo + additional repos per task
- Claude sees all repos via `--add-dir` — full cross-repo context
- PRs created in each repo that has changes
- All PR links shown in task detail

### Refinement Loop
- Send feedback on a completed task from the dashboard
- Creates a subtask on the same branch — PR updates automatically
- Chain refinements: parent → refine → refine again
- Each subtask inherits repo, branch, and session context

### Live Streaming
- Watch Claude work in real-time via SSE
- Terminal-style log: tool calls, file edits, reasoning
- Fixed-height container — page doesn't jump
- Activity log persists after task completion

### Scheduling
- Interval-based: every 30min to daily
- Time windows — only run between 10 PM and 6 AM
- Overnight window support (e.g., 22:00–06:00)
- Tasks auto-assign to active schedules
- Toggle on/off from the dashboard

### Agent API
Full natural language interface — available as dashboard chat UI, REST API, and Lark bot:

```bash
curl -X POST https://your-nightcode.ts.net/api/agent \
  -H "Authorization: Bearer nc_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"message": "what tasks are pending?"}'
```

The agent can: create/delete repos, create/run/pause/cancel/delete tasks, refine tasks, manage schedules, show stats — everything the dashboard can do.

### Lark Integration
1. Create a Lark bot at [open.larksuite.com](https://open.larksuite.com)
2. Set webhook URL to `https://your-nightcode.ts.net/api/lark/webhook`
3. Add `lark_app_id` and `lark_app_secret` in Settings
4. Team messages the bot → agent handles everything

### Rich PRs
Every PR nightcode creates includes:
- Summary of changes with key decisions and tradeoffs
- Collapsed implementation plan (from the plan step)
- Kavela knowledge files consulted (if connected)
- Backlink to nightcode task detail page
- `claude --from-pr` command for session takeover

### Take Control
Pause nightcode and continue on your machine:
```bash
claude --from-pr https://github.com/org/repo/pull/42
```

### Dashboard
- Status filter bar with counts
- Real-time SSE streaming during execution
- Step progress visualization
- Refinement chat input
- Subtask thread timeline
- Agent chat page
- Integration status alerts (Claude/GitHub/Tailscale)
- Token rotation
- Custom system prompt (global CLAUDE.md equivalent)

### Remote Access (Tailscale)
One-click setup from the dashboard when Tailscale is installed:

```bash
# Built-in (recommended for VPS)
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build
# Then paste Tailscale auth key in Settings → Remote Access → Connect

# Or host-level (local machine)
tailscale funnel 3777
```

Login gate protects the dashboard when accessed remotely. Bearer token auth on all API endpoints.

### Optional Add-ons
- **Playwright screenshots**: `--build-arg INSTALL_PLAYWRIGHT=true` — headless Chromium for UI change screenshots in PRs
- **Kavela MCP**: team knowledge injection with `detect_workspace` → `check_context` → `get_skill` workflow
- **Custom system prompt**: global instructions prepended to every task (Settings)
- **nightcode.md skill file**: manage nightcode from any Claude Code session

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
│  Optional: Tailscale, Playwright              │
└───────────────────────────────────────────────┘
         │
         │  Tailscale Funnel (optional)
         v
    Public HTTPS ──> Lark bot / agent API / remote access
```

**Stack**: TypeScript, Hono, SQLite (Drizzle ORM), React + Vite + Tailwind, Docker

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (no auth) |
| `/api/repos` | GET/POST/DELETE | Repo CRUD |
| `/api/tasks` | GET/POST | List/create tasks (filter by status, repo) |
| `/api/tasks/:id` | GET/PATCH/DELETE | Task details with steps, subtasks, Kavela skills |
| `/api/tasks/:id/run` | POST | Queue task for execution |
| `/api/tasks/:id/pause` | POST | Pause running task |
| `/api/tasks/:id/resume` | POST | Resume paused/failed task |
| `/api/tasks/:id/refine` | POST | Create refinement subtask |
| `/api/tasks/:id/stream` | GET (SSE) | Live execution stream |
| `/api/tasks/:id/export` | GET | Export as Markdown |
| `/api/schedules` | GET/POST | List/create schedules |
| `/api/schedules/:id` | PATCH/DELETE | Update/toggle/delete schedule |
| `/api/schedules/:id/trigger` | POST | Manual trigger |
| `/api/agent` | POST | Natural language commands |
| `/api/auth/login` | POST | Validate token (for remote access) |
| `/api/lark/webhook` | POST | Lark bot webhook |
| `/api/settings` | GET/PATCH | Settings + integrations |
| `/api/settings/rotate-token` | POST | Rotate bearer token |
| `/api/dashboard/stats` | GET | Dashboard statistics |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TZ` | UTC | Timezone |
| `NIGHTCODE_AUTH_TOKEN` | auto-generated | API bearer token |
| `NIGHTCODE_URL` | localhost:3777 | Public URL for PR backlinks |
| `KAVELA_API_KEY` | — | Kavela MCP integration |
| `NIGHTCODE_MAX_CONCURRENT` | 2 | Max parallel tasks |
| `NIGHTCODE_PORT` | 3777 | Server port |

### Build Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `INSTALL_PLAYWRIGHT` | false | Headless Chromium for screenshots |
| `INSTALL_TAILSCALE` | false | Built-in Tailscale for remote access |

### Authentication

- **Claude**: Max subscription via built-in OAuth PKCE flow (no API key needed)
- **GitHub**: [Fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to repos (Contents + PRs R/W). [Classic PAT](https://github.com/settings/tokens/new?scopes=repo,read:org&description=nightcode) for collaborator repos.
- **Dashboard**: Bearer token — auto-generated, rotatable from Settings, login gate for remote access

## Development

```bash
npm install && npm run dev     # Server with hot-reload
cd dashboard && npm run dev    # Dashboard dev server
npm run build                  # Production build
```

## License

MIT

## Contributing

PRs welcome! See [issues](https://github.com/kavela-app/nightcode/issues).

Built with Claude Code.
