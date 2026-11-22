---
summary: "Every PR to main merges through GitHub's merge queue via plain gh pr merge; never use --admin or --squash."
kind: decision
status: current
read-when: merging any pull request (including docs-only PRs) into popcre/shared-db main
---

# All PRs to main merge through the GitHub merge queue

**Decided by:** Established 2026-11-12 (PRs #6112, #6116, #6122)

## Decision

Every pull request to `main`, including prose/docs-only PRs, merges through GitHub's merge queue using plain `gh pr merge <pr>`. Never pass `--admin` or `--squash`; both are refused by the queue ruleset.

Supersedes the older prose-merge teaching (`gh pr merge --squash --admin`).

## Why

The `main merge queue` ruleset owns the merge strategy and enforces required checks consistently.

## Rejected

Attempting `--admin` or `--squash` merges on `popcre/shared-db`.

## Source

Original record (left in place): [`docs/agents/merge-protocol.md` §5](../agents/merge-protocol.md#5-the-shared-db-merge-protocol-the-checklist-the-ai-runs)
