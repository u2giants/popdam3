---
summary: When a tool or connection is missing, fix the root cause or say so; never silently substitute a lesser check.
kind: decision
status: current
read-when: a needed tool, credential or connection is unavailable mid-task
---

# No workarounds: fix the root cause

**Decided by:** Albert, 2026-07-08: "why not? connect them. no workarounds or best-effort. do it right and ask me for the tools you need to do it right if you don't have that."

**Decision:** before reporting a task done, check whether a missing tool silently narrowed the scope. Either fix the cause (for example the `supabase` MCP entry needed its own `env` block) or state plainly that it is blocked.

**Why:** a log review was done from code only and reported as complete while several MCP servers were not connected.

**Rejected:** best-effort substitutes presented as complete work.

## Source

- [docs/idiosyncrasies.md, supabase MCP server env block](../idiosyncrasies.md#supabase-mcp-server-needs-its-own-explicit-env-block-unlike-the-http-type-servers)
- private memory note feedback_no_workarounds (outside this repo)
