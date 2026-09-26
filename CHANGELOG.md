# Changelog

Versions before 1.19.0 are recorded in the git history (each release commit carries its version in the title).

## 1.19.0 — 2026-09-26 (on exponential-sdk 1.21.0)

- **Action dependencies** (app ADR-0062, `ActionDependency` join table).
  - `actions show <id>` / `actions get <id>`: one action with a "Blocked by"
    block (name, short id, status; finished blockers struck through).
  - `actions list` and `actions kanban` rows show a red `[BLOCKED]` marker,
    `[BLOCKED ×N]` when more than one blocker is open.
  - `actions update <id> --blocked-by <id,id>` replaces the blocker set,
    `--clear-blocked-by` empties it; `actions create ... --blocked-by <ids>`.
    The positional `<id>` on `update` is new; `--id <id>` still works.
  - `actions deps search <query> [--workspace <slug|id>] [--exclude <id>] [--limit <n>]`
    lists blocker candidates (`action.searchForDependencies`).
  - JSON output passes `depsOut`, `openBlockerCount` and `isBlocked` through
    unchanged; the server's `BAD_REQUEST` message (self-link, cycle) is shown verbatim.
- Ids are action CUIDs, not titles.
