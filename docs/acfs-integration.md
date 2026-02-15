# ACFS Integration Architecture

Exponential CLI is integrated into a server-based agent orchestration environment (ACFS) that uses tmux sessions to run AI coding agents autonomously.

**One-line summary:** An agent execution node that continuously pulls issues from Exponential via CLI and executes them using a tmux-based multi-agent runtime.

## High-Level Architecture

```
Exponential CLI -> Worker -> NTM -> tmux session -> AI agents -> Results -> Exponential
```

## Components

### Exponential (this system)
- Source of truth for issues
- Provides CLI + SDK
- Defines tasks and state
- Used to fetch open issues and map them to execution sessions

### Worker Loop (custom script on VPS)
- Polls Exponential CLI for open issues (~60s interval)
- Spawns sessions per issue
- Sends prompts to agents
- Prevents duplicate sessions
- Bridge between Exponential and ACFS

### ACFS (Agentic Coding Flywheel System)
- Agent tooling and runtime environment
- Orchestration primitives
- Think of it as the platform layer (analogous to Kubernetes)

### NTM (Named Tmux Manager)
- Orchestrates tmux sessions
- Handles session lifecycle, agent launch, prompt routing, monitoring
- Abstraction layer over tmux (analogous to a scheduler)

### tmux (runtime engine)
- Persistent execution environments
- Parallel processes
- Reconnectable sessions

### Agents (Claude / Codex)
- Reasoning and execution layer
- Interpret tasks, plan work, generate outputs

## Mental Model

| Concept | Analogy |
|---------|---------|
| Exponential | Jira |
| ACFS | Kubernetes |
| Agents | Pods |
| NTM | Scheduler |
| tmux | Runtime |
| Worker | Controller loop |

## Workflow

1. Worker polls Exponential CLI for open issues
2. Finds an open issue
3. Creates session `exp-<issueID>`
4. Sends prompt describing the issue to the agent
5. Agent executes the task
6. Worker later updates the issue with results

## Current Integration Approach

MVP using a polling worker model:
- CLI polling every ~60s
- One session per issue
- Prompt injection via NTM
- No webhooks (simplest first step)

### Benefits
- Simple to reason about
- Fault tolerant
- No direct coupling between systems
- Works with existing CLI
- Easy to debug
- Scales horizontally

## Known Issues

### Node runtime dependency
Exponential CLI requires Node.js (`#!/usr/bin/env node`). Node must be installed even when Bun is present on the VPS.

### Session initialization timing
Some NTM sessions start before agents attach, causing the shell to interpret prompts as commands. Restarting sessions resolves this.

### Optional tooling warnings
CASS / beads viewer warnings are non-blocking and can be ignored.

## What's Needed from Exponential Side

Areas for collaboration and improvement:
- **Stable CLI JSON output format** — agents parse this output; breaking changes disrupt the pipeline
- **Issue lifecycle hooks** — trigger events on status changes
- **Authentication handling** — streamlined auth for headless/server environments
- **Rate limits** — documented limits for polling
- **Webhook support** (future) — push-based alternative to polling
- **Execution metadata fields** — store agent session IDs, execution logs, etc. on issues

## Future Evolution

- Webhook triggers (replace polling)
- Richer state sync between Exponential and ACFS
- Execution result ingestion (auto-update issues with agent output)
- Priority queues
- Concurrency limits

## Long-Term Vision

Turn Exponential into a task orchestration layer where:
- Agents automatically execute issues
- Sessions map directly to tasks
- Outputs feed back into issue state
- Fully autonomous workflows

## Operational Context

Currently running on a dedicated VPS as a root-level experimentation node, not production infrastructure.
