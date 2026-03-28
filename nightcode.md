# Nightcode Skill

Manage your nightcode instance — create repos, tasks, schedules, and monitor execution from any Claude Code session.

## Configuration

Set these environment variables or pass them inline:

```bash
export NIGHTCODE_URL="http://localhost:3777"       # or your Tailscale Funnel URL
export NIGHTCODE_AUTH_TOKEN="nc_..."                # from nightcode startup logs or data/.auth-token
```

## Quick Start

```bash
# Check if nightcode is running
curl -s "$NIGHTCODE_URL/api/health" | jq .

# Get dashboard stats
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/dashboard/stats" | jq .
```

## Repos

```bash
# List repos
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/repos" | jq .data

# Add a repo
curl -s -X POST "$NIGHTCODE_URL/api/repos" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-api","url":"git@github.com:org/my-api.git","branch":"main"}' | jq .data

# Delete a repo
curl -s -X DELETE -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/repos/1"
```

## Tasks

```bash
# List all tasks
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks" | jq .data

# List running tasks
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks?status=running" | jq .data

# Create a task
curl -s -X POST "$NIGHTCODE_URL/api/tasks" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repoId":1,"title":"Fix login bug","prompt":"The login form crashes on empty password. Investigate and fix.","workflow":"plan-implement-pr","priority":3}' | jq .data

# Run a task immediately
curl -s -X POST -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/run" | jq .

# Pause / Resume / Cancel
curl -s -X POST -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/pause"
curl -s -X POST -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/resume"
curl -s -X POST -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/cancel"

# Get task details + steps
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1" | jq .data

# Export task as markdown
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/export" | jq -r .data.markdown
```

### Workflow Types

| Workflow | Steps | Use When |
|----------|-------|----------|
| `implement-pr` | implement → PR | Quick fixes, small changes |
| `plan-implement-pr` | plan → implement → PR | Standard tasks (default) |
| `plan-audit-implement-pr` | plan → audit → implement → test → PR | Complex changes needing review |

### Priority

1 (highest) to 10 (lowest). Default: 5. Tasks execute in priority order.

## Schedules

```bash
# List schedules
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/schedules" | jq .data

# Create a schedule (run every 2 hours between 10pm-6am SGT)
curl -s -X POST "$NIGHTCODE_URL/api/schedules" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Nightly","intervalMinutes":120,"windowStart":"22:00","windowEnd":"06:00","timezone":"Asia/Singapore"}' | jq .data

# Toggle schedule on/off
curl -s -X PATCH "$NIGHTCODE_URL/api/schedules/1" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' | jq .data

# Trigger schedule manually
curl -s -X POST -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/schedules/1/trigger" | jq .data
```

## Agent API (Natural Language)

```bash
# Send a natural language command
curl -s -X POST "$NIGHTCODE_URL/api/agent" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a task to fix the login bug on the frontend repo"}' | jq .data
```

The agent understands: creating repos, creating/running/pausing tasks, listing status, getting stats, creating schedules.

## Common Workflows

### Add a repo and create a task
```bash
# 1. Add repo
REPO=$(curl -s -X POST "$NIGHTCODE_URL/api/repos" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"frontend","url":"git@github.com:myorg/frontend.git"}' | jq -r .data.id)

# 2. Create and run task
curl -s -X POST "$NIGHTCODE_URL/api/tasks" \
  -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"repoId\":$REPO,\"title\":\"Add dark mode\",\"prompt\":\"Implement dark mode toggle...\"}" | jq .data

curl -s -X POST -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/run"
```

### Monitor a running task
```bash
# Check status
curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1" | jq '{status:.data.status, step:.data.currentStep, pr:.data.prUrl}'

# Stream live (SSE)
curl -N -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1/stream"
```

### Continue a completed task locally
```bash
# Get the PR URL
PR=$(curl -s -H "Authorization: Bearer $NIGHTCODE_AUTH_TOKEN" "$NIGHTCODE_URL/api/tasks/1" | jq -r .data.prUrl)

# Resume on your machine
claude --from-pr "$PR"
```
