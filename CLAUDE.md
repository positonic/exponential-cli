# Exponential CLI

TypeScript CLI for the Exponential platform. Provides commands for managing actions (issues), projects, workspaces, and authentication.

## Commands

```bash
npm run build      # Compile TypeScript (tsup)
npm run dev        # Watch mode
npm run typecheck  # Type check only
```

## Project Structure

```
src/
├── index.ts              # CLI entry point (Commander.js)
├── client/index.ts       # ExponentialClient singleton
├── commands/             # auth, actions, projects, workspaces
├── config/index.ts       # Config management (via exponential-sdk)
└── utils/                # output formatting, error handling
```

- ESM-only, Node >= 18, strict TypeScript
- Uses `exponential-sdk` for API client and config
- Uses `commander` for CLI, `chalk` for terminal output
- Output auto-detects JSON (piped) vs pretty-printed (terminal)

## Integration Contexts

This CLI is used across several AI-assisted workflows:

- **Claude Code** — developers use the CLI directly within Claude Code sessions to manage issues and tasks
- **Claude Desktop** — used as a tool/integration for conversational task management
- **ACFS (server deployment)** — automated agent orchestration on a VPS, where a worker loop polls for open issues and dispatches them to AI agents running in tmux sessions

The CLI's JSON output mode and pipeable design make it a natural fit for all of these contexts.

### ACFS Integration (detailed)

**Architecture:** `Exponential CLI -> Worker -> NTM -> tmux -> AI agents -> Results -> Exponential`

- **Worker** = polling loop (~60s) that fetches open issues and spawns agent sessions
- **NTM** = tmux session manager / scheduler
- **Agents** = Claude, Codex, etc. executing tasks in tmux sessions

See [docs/acfs-integration.md](docs/acfs-integration.md) for full architecture details.

### Key considerations for CLI development
- Stable JSON output format is critical — agents and tools parse CLI output
- Issue lifecycle hooks and webhook support are future goals
- Node.js runtime is required (even when Bun is available on the VPS)
