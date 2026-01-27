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

# Get today's actions
exponential actions today

# Get actions in a date range
exponential actions range --start 2024-01-01 --end 2024-01-31

# Get kanban board view
exponential actions kanban --project <project-id>
```

### Projects

```bash
# List all projects
exponential projects list

# List projects in a workspace
exponential projects list --workspace <workspace-id>
```

### Workspaces

```bash
# List all workspaces
exponential workspaces list

# Set default workspace
exponential workspaces set-default <workspace-slug>
```

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
