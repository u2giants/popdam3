---
issue: 97
status: OPEN
owner: mimo/issue97-dam-semantic
---

# PopDAM #97 semantic search — session closeout and handoff

## 0. Business decisions only the owner can make

None outstanding. Albert authorized DAM #97 independently of PopSG, authorized taking over #96 ("you take control of #96 and do it yourself with a subagent"), and authorized spinning up subagents for blockers. No technical permission is owed to him. The one business-meaning question that could arise later: whether to accept designer grades that still fail the paraphrase NDCG gate — not reached.

## 1. What this application is

[PopDAM](https://dam.designflow.app) is the internal licensed-artwork Library. Repository [u2giants/popdam3](https://github.com/u2giants/popdam3). Production Supabase `qsllyeztdwjgirsysgai`. Shared database shape belongs only in [popcre/shared-db](https://github.com/popcre/shared-db). PopSG shares source/runtime but has its own corpus and is out of scope for #97.

## 2. This session's objective and scope

Complete [#97](https://github.com/u2giants/popdam3/issues/97) DAM semantic search: metadata prerequisite (#96), query-shape contract, indexing, relevance gates, then activation. Do not wait on PopSG. Do not change SG settings/corpus/claims.

## 3. Current source, live state and ownership

### Done and verified
- **#96 CLOSED** (2026-10-20 10:11 PM EDT): 8,663/8,663 tagging complete. Dated artifact on [#96](https://github.com/u2giants/popdam3/issues/96#issuecomment-6302926233). Original Muse runs and Meta key preserved.
- **popdam3 PR #446 MERGED**: summary-safe search mapping, 40 synthetic fixtures, step-1/relevance baselines under `docs/verification/`.
- **shared-db PR #4510 MERGED** (`ef9f8789`): query-shape contract (exact totals, summary envelope, model/dims predicate, alnum substring guard, LIKE escape, semantic tiebreak). Migration `20261020230556` **applied to production** (run 39547208359) and catalog-proven.
- **Scoring harness frozen** at `C:\Users\ahazan\.local\share\mimocode\evidence\issue97-scoring\` (private). Deployed-edge gates: paraphrase NDCG **PASS** (mean +0.389); wrong-property PASS; exact-ID **FAIL** (high-DF 8s timeout); no-match **FAIL** (needs floor ~0.85).

### In flight at wrap-up
- **Embedding** run `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb`: 36,073/150,677 (23.9%), style-group vectors 0/11,161 (queued behind assets), batch 2, durable auto-resume loop at `C:\Users\ahazan\.local\share\mimocode\evidence\issue97-embedding\durable-embed-loop.mjs`. HTTP 546 root cause: long `search_text` blows the Supabase edge CPU budget. Batch 2 cut failures to ~5 min. To stop loop: create `STOP-DURABLE-LOOP` in that directory.
- **shared-db PR #4531 PARKED** (high-DF timeout fix). Claim #4530 released. Work issue [#4529](https://github.com/popcre/shared-db/issues/4529). Branch `mimo/dam-search-hdf-timeout`, worktree `D:\repos\shared-db-worktrees\dam-search-hdf-timeout` (clean). Handover comment posted on #4529.

### Ownership
- popdam3 branch `mimo/issue97-dam-semantic-20261019` — keep (PR #446 merged; later docs-only commits unpushed at wrap-up, see below).
- shared-db claim #4509 released; claim #4530 released with `--park`.
- No owned preview/merge/production stages at closeout (verify with `ai-shared-db-closeout-check`).

## 4. Failed approaches and attempts

- Pre-visibility LIMIT on keyword candidates broke exact `total_count`/facets. Unbounded keyword path restored totals but reintroduced the high-DF 8s timeout — now owned by #4529.
- Evidence-pair churn across generations 1–7: contract `db_writes` must equal issue `writes` exactly and the migration's parsed objects; `Refs #N` satisfies the open-PR binding but the merged-PR binding wants `Work issue #N`; after `report.head_sha` every commit must touch both evidence files.
- `check-dispatch-collision --claim-body-file` omits `db-author-lease` — use `manage-migration-author-lanes --claim`.
- Windows wrappers: `ai-glm` fails repository-top-level check (`C:/` vs `/c/`); `ai-muse` lifecycle report path fails; `ai-review` child processes die under the bash tool — run detached via `Start-Process` + `.cmd` and set `ProgramFiles`.
- DeepSeek final-check falsely REJECTED (missed revokes at migration :252-255).
- Embedding HTTP 546 at batch 3/5 from long `search_text`; batch 2 + durable loop is the working mitigation.

## 5. Findings and implemented increment

See §3. Key constants frozen: ordinary-change burst **N=50**; nightly Style Group replacement **9,026**. Freshness keyed on `content_sha256`, not `indexed_at`. Recommended semantic floor **0.85** (clears no-match false neighbors at ≤0.838, keeps stitch at 0.873).

## 6. Exact next steps and gates

1. Let the embedding durable loop reach terminal coverage (assets then style groups). Resume point if it stops: same run_id, current cursor, batch 2.
2. Resume shared-db PR #4531 from the handover on [#4529](https://github.com/popcre/shared-db/issues/4529): two exact-head APPROVE reviews → Guarded Merge → preview → production-risk APPROVE → production apply → prove spider-man/stitch under 8s and exact-ID top5.
3. Re-score with full coverage + deployed-edge query vectors + floor 0.85. Designer grades replace proxy labels.
4. Activation only when: full coverage, floor set (`SEARCH_MIN_SEMANTIC_SCORE=0.85`), paraphrase NDCG pass, no-match pass, exact-ID pass, latency pass. Then DAM-only `SEARCH_MODE=hybrid` with rollback + 24h observation.
5. Close #97 only after live administrator/designer/viewer semantic journeys and the observation window.

## 7. Constraints and custody

No SG settings/corpus/claims. No app DDL. Original Muse runs/key preserved. No SEARCH_MODE write was made. Evidence pairs and version reservations are permanent — never reuse `20261020230556` or `20261021063716`.

## 8. Access

1Password vault `vibe_coding` (id `pimcaogmxxzoafh7lsluj6uxkq`) works. Supabase management read-only PAT and service-role key referenced as `op://` URIs only. Role logins (admin/designer/viewer) used for search-modes and keyword baselines. Durable private evidence under `C:\Users\ahazan\.local\share\mimocode\evidence\issue97-*`.

## 9. Open risks and continuation prompt

Risks: embedding 546 rate may rise as `search_text` grows; style-group vectors are 0 until asset backlog drains; high-DF timeout still live in production (blocks exact-ID gate); paraphrase gate passed only on proxy labels.

**Continuation:** see the fenced prompt in the closing report.
