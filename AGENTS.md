# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Exponential CLI: action dependencies

When an agent needs to say "this action cannot start until that one is done":

```bash
exponential actions deps search "<query>" --workspace <slug>   # find blocker CUIDs
exponential actions update <id> --blocked-by <id>,<id>         # REPLACES the set
exponential actions update <id> --clear-blocked-by             # removes all blockers
exponential actions create -n "..." --blocked-by <id>
exponential actions show <id>                                  # "Blocked by" block
```

Ids are action CUIDs, not titles. `actions list --json` rows carry `isBlocked`,
`openBlockerCount` and `depsOut`; an action is blocked while it is ACTIVE with at
least one blocker still ACTIVE. Cycles and self-links are refused by the server.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

