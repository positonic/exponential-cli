# Exponential CLI

CLI tool to interact with the Exponential productivity app. Pull actions, projects, and workspaces from your Exponential account for use with LLMs and automation.

## Installation

```bash
npm install -g exponential-cli
```

Or run directly with npx:

```bash
npx exponential-cli --help
```

## Quick Start

### 1. Generate an API Token

1. Log into Exponential
2. Navigate to `/tokens`
3. Create a new API key with type "JWT"
4. Copy the generated token

### 2. Configure the CLI

```bash
exponential auth login --token <your-jwt-token> --api-url https://app.exponential.so
```

### 3. Verify Authentication

```bash
exponential auth whoami
```

## Commands

### Authentication

```bash
# Login with token
exponential auth login --token <jwt> --api-url <url>

# Check authentication status
exponential auth whoami
exponential auth status

# Logout
exponential auth logout
```

### Actions

```bash
# List all active actions
exponential actions list

# List actions for a specific project
exponential actions list --project <project-id>

# List actions with a specific kanban status
exponential actions list --status IN_PROGRESS

# Create an action
exponential actions create -n "Task name" -d "Description" -p <project-id> --priority "1st Priority"

# Update an action
exponential actions update --id <action-id> --kanban DONE
exponential actions update --id <action-id> -n "New name" --priority "2nd Priority" --due 2026-03-15

# Set the do-date (when you plan to work on it). This is what `today` partitions on,
# and it takes precedence over --due.
exponential actions update --id <action-id> --scheduled-start 2026-08-05T09:00
exponential actions update --id <action-id> --scheduled-start null   # clear it

# What's actually on your plate: overdue + today + inbox
exponential actions today

# Just the actions whose dueDate is today (excludes overdue — see note below)
exponential actions today --due-only

# Get actions in a date range
exponential actions range --start 2024-01-01 --end 2024-01-31

# Get kanban board view
exponential actions kanban --project <project-id>
```

#### Triaging an overdue pile

A large overdue count is usually not a large number of missed commitments — it's
a few bulk writes (a generated project plan, an import) that stamped every row
with one identical timestamp. `actions overdue` separates the two:

```bash
exponential actions overdue
```

```
Overdue: 43

21 of these were bulk-created — stamped with one identical timestamp,
so almost certainly never individually due.

  17 actions stamped 2026-07-25T08:29:55.483Z (10d overdue)
    Projects: Entity Money Map, Net Worth Baseline, Tax Reserve System, …
    Amnesty: exponential actions defer --ids cmqcgvtlh…,cmqcgvtnn…,…

19 individually dated — real debt, oldest first.
   12d  Send out the job description for the data engineering role [Hiring]
```

Then pick a disposition:

```bash
# Amnesty: clear the dates, back to the project backlog untimed.
# For work that was never really due on the date it carries.
exponential actions defer --ids id1,id2,id3

# Reschedule: still due, just later.
exponential actions reschedule --ids id1,id2 --to today
exponential actions reschedule --ids id1,id2 --to 2026-08-10
```

> **Note on `actions today`:** as of v1.9.0 this returns the same
> overdue/today/inbox partition the `/today` page renders, rather than a
> due-date-only list. The old behaviour silently omitted the overdue pile — it
> would report 6 actions while 43 sat overdue. Pass `--due-only` for the
> previous output shape.

### Goals and OKRs

Objectives are goals; they carry **integer** ids. Their key results carry CUIDs
and live under `goals kr`.

```bash
# List a workspace's objectives, or the annual → quarterly cascade
exponential goals list --workspace clear --period Q3-2026
exponential goals list --workspace clear --tree
exponential goals list --all-workspaces       # "what am I neglecting" is cross-workspace

exponential goals get 46
exponential goals create --workspace clear --title "Ship the CLI" --period Q3-2026

# Close a quarter. set-status/close write ONLY the status column.
exponential goals close --id 46                       # → completed
exponential goals set-status --id 46 --status on-hold

# Everything else is a partial update: fields you don't pass are left alone,
# and "none" is how you clear one.
exponential goals update --id 46 --title "Ship the CLI, properly"
exponential goals update --id 46 --workspace none     # make it personal
exponential goals reparent --id 47 --parent 46        # or --parent none
exponential goals delete --id 46                      # refuses if it has key results

exponential goals periods
exponential goals stats --workspace clear --period Q3-2026

# The quarter at a glance: objectives with their key results nested
exponential okrs list --workspace clear
```

Key results:

```bash
exponential goals kr list --goal 46
exponential goals kr list --workspace clear --status at-risk
exponential goals kr create --goal 46 --title "Weekly active agents" --target 500 --unit count
exponential goals kr checkin --id <cuid> --value 120 --note "post-launch bump"
exponential goals kr update --id <cuid> --target 600
exponential goals kr link --id <cuid> --feature <feature-cuid>   # or --project <cuid>
exponential goals kr unlink --id <cuid> --project <cuid>
exponential goals kr delete --id <cuid>
```

### Projects

```bash
# List all projects
exponential projects list

# List projects in a workspace (slug or CUID)
exponential projects list --workspace clear

# One project, with its objectives, key results, DRI and actions
exponential projects get <cuid|slug>

# Partial update — unnamed fields are preserved
exponential projects update --id <cuid> --name "KR support" --status COMPLETED
exponential projects update --id <cuid> --product none

# Refuses while the project still has actions or OKR links
exponential projects delete --id <cuid> [--force]
```

### Workspaces

```bash
# List all workspaces
exponential workspaces list

# Set default workspace
exponential workspaces set-default <workspace-slug>

# List members — each row carries the mention markup for that person
exponential workspaces members --search andi
```

### Comments and @mentions

Features, tickets, actions, pages, and goals all take comments:

```bash
exponential features comment list --feature <feature-id>
exponential features comment add  --feature <feature-id> -m "Looks good to me"
exponential tickets  comment add  --id <ticket-id>       -m "Reproduced on staging"
exponential pages    comment add  --page <page-id>       -m "Needs a diagram"
exponential goals    comment add  --goal 42              -m "On track for Q3"
```

A mention is the literal markup `@[Display Name](userId)` — writing plain `@andi`
notifies nobody. `--mention` expands a name, email, or user id into that markup:

```bash
exponential features comment add --feature <feature-id> \
  --mention andi \
  -m "@andi — could you sanity-check the scope here?"
```

`@andi` is substituted in place so the sentence still reads. If the body has no
matching `@handle` the mention is prepended instead. `--mention` is repeatable,
and an ambiguous name is an error rather than a guess.

Editing and deleting are author-only. Find ids with `exponential search "<text>"`.

## Output Formats

### JSON Output (for LLMs and automation)

By default, output is JSON when piped. Force JSON output:

```bash
exponential actions list --json
```

Example output:

```json
{
  "actions": [
    {
      "id": "clx123abc",
      "name": "Fix authentication bug",
      "description": "JWT tokens expiring too early",
      "status": "ACTIVE",
      "priority": "1st Priority",
      "kanbanStatus": "IN_PROGRESS",
      "dueDate": "2024-01-15T00:00:00.000Z",
      "project": {
        "id": "clx456def",
        "name": "Exponential App"
      },
      "assignees": []
    }
  ],
  "total": 1,
  "filters": {}
}
```

### Pretty Output (for humans)

Force human-readable output:

```bash
exponential actions list --pretty
```

## Works with OpenClaw

If you use [OpenClaw](https://github.com/openclaw/openclaw), install the Exponential skill to give your AI agent full access to actions, projects, and kanban boards:

```bash
npx clawhub install exponential
```

Your agent can then create tasks, update statuses, and manage projects through natural conversation.

## LLM Integration

### Python Example

```python
import subprocess
import json

def get_exponential_actions(project_id=None):
    cmd = ['exponential', 'actions', 'list', '--json']
    if project_id:
        cmd.extend(['--project', project_id])

    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

# Get all actions
actions = get_exponential_actions()

# Get actions for a specific project
project_actions = get_exponential_actions('clx456def')
```

### Shell Example

```bash
# Get actions and pipe to jq
exponential actions list --json | jq '.actions[] | {name, priority, status: .kanbanStatus}'

# Count actions by status
exponential actions kanban --json | jq '.actions | group_by(.kanbanStatus) | map({status: .[0].kanbanStatus, count: length})'
```

### Claude/LLM Prompt Example

```
I have access to the Exponential CLI. Here are my current actions:

$(exponential actions list --json)

Based on these actions, what should I work on next considering priority and due dates?
```

## Configuration

Configuration is stored in:
- macOS: `~/Library/Preferences/exponential-cli-nodejs/config.json`
- Linux: `~/.config/exponential-cli-nodejs/config.json`
- Windows: `%APPDATA%\exponential-cli-nodejs\config.json`

## Kanban Status Values

- `BACKLOG` - In backlog
- `TODO` - Ready to work on
- `IN_PROGRESS` - Currently being worked on
- `IN_REVIEW` - In review
- `DONE` - Completed
- `CANCELLED` - Cancelled

## Priority Values

- `1st Priority` through `5th Priority`
- `Quick` - Quick tasks
- `Scheduled` - Scheduled tasks
- `Errand` - Errands
- `Remember` - Things to remember
- `Watch` - Items to watch
- `Someday Maybe` - Future possibilities

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node bin/exponential.js --help

# Link for local testing
npm link
```

## License

MIT
