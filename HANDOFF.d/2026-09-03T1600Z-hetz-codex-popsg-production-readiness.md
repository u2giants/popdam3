---
issue: 107
status: OPEN
owner: codex/popsg-production-readiness-107
---

# PopSG production readiness implementation plan

Canonical plan: [plan_popsg_production_readiness.md](../plan_popsg_production_readiness.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

No decision is needed before implementation starts. Already settled on 2026-09-03: PopSG represents the eligible creative-file subset of the canonical Style Guides share; stale rows are inactivated, never deleted; NAS files are never changed; cleanup must be bounded rather than increasing timeouts; crawl completion must be truthful; archival is outside this plan. Do not re-ask these.

Before the first production data cleanup or shared-database production promotion, consolidate the exact candidate-count/rollback proof and request any approval required by `/worksp/shared-db/AGENTS.md` in one message. The recommendation is to proceed only after preview tests and a same-window fresh crawl show exact candidates.

## 1. What this application is

PopSG is the style-guide mode of `u2giants/popdam3`, locally `/worksp/popdam`, served at `https://sg.designflow.app`. It indexes eligible creative files from the read-side NAS `edgesynology2:/volume1/styleguides` through a bridge crawler, shared Supabase project `qsllyeztdwjgirsysgai`, a Windows preview/PDF agent, and a React UI. Shared schema is canonical in `u2giants/shared-db` at `/worksp/shared-db`.

## 2. What this session set out to do

Albert asked for a standalone implementation plan to fix every gap found in the production-readiness review: ghost rows, ongoing crawl reconciliation, false-green status, missing/failed previews, incomplete PDF/source coverage, and non-comprehensive search/filtering. The plan must let a new session implement without this chat.

## 3. Current state

Planning only; no implementation or production data change occurred. Issue [#107](https://github.com/u2giants/popdam3/issues/107) tracks completion. The plan’s STATUS table is entirely open. App `main` was `f76c91ed0ded318afe4de3a9c01516b6a9f5d4ec`; production frontend application source was `f82089bd71605b6a788146ebec0f7fa443622ba7` (the only later commit generated types). Recheck before work.

Confirmed 2026-09-03 against production Virginia Supabase and edge2: 226,390 active DB rows versus 218,081 current eligible NAS files; 8,428 active rows were not in the latest crawl and 119 NAS files were created after it, yielding 8,309 net ghosts. Production logs prove cleanup and aggregate refresh timed out, yet the crawl was marked complete. There were 7,677 render errors, one queued no-preview file, 23,353 PDF backfill items, 87 unresolved source rows, and 92 active files without tag search text.

## 4. What did not work

- Raw NAS `find` included Synology metadata and hit an `@eaDir` permission error; it is not the eligible-set oracle. The corrected crawler-equivalent read completed without errors.
- The existing one-shot `deactivate_stale_sg_files` RPC timed out in the ordinary nightly run.
- The aggregate refresh timed out in the same Edge completion request.
- Current code logs both errors but still writes completed. Re-running it, raising timeouts, deleting rows, or trusting `files_found` would repeat or conceal the failure.

## 5. Root causes and key findings

- `supabase/functions/agent-api/index.ts:2913-2955` marks complete before an unbounded cleanup and treats cleanup/refresh failure as best effort.
- The live cleanup function performs one large update of every stale active row.
- Bridge-discovered count differs from server-accepted count because server filtering drops records; those counts must be separate.
- Search in `src/pages/popsg/PopSGLibraryPage.tsx:615-703` uses guide/path `ILIKE`, not unified path/metadata/tag/PDF text.
- Exact source, code references, acceptance rules, and dated findings are in plan §§3, 5, and 6.

## 6. Exact next steps

1. Read `AGENTS.md`, `docs/POPSG.md`, the plan STATUS, and plan §§1–8. Re-baseline using plan §9.1. **Worked when:** a saved, re-runnable artifact confirms live target and exact same-window eligible path parity/mismatch.
2. Route a fresh `db-work` issue to the single shared-db orchestrator for the objects named in plan §9.2. **Worked when:** preview-tested migration PR is merged and production ledger is verified under its gate.
3. Implement plan Phase B: bounded cleanup, truthful stages, restart-safe orchestration, low-count guard. **Worked when:** forced timeouts/drops cannot produce completed and retries resume.
4. Run the reversible one-time cleanup in plan §9.6 after a fresh crawl. **Worked when:** zero unexplained path differences and ghosts remain recoverable as inactive.
5. Implement Admin health/alerts and preview classification. **Worked when:** UI clearly distinguishes healthy/partial/failed states and every active file has preview, queue/retry, or terminal exception.
6. Finish the existing PDF backfill/resolver without parallel loops. **Worked when:** zero actionable remaining and unresolved rows are reviewed safely.
7. Implement governed comprehensive search/filters per plan §9.10. **Worked when:** path, metadata, tags, and extracted text all work with authorization/filter/paging parity.
8. Pass plan §9.11 across three ordinary nightly crawls, land docs/deployments, close #107, and delete this handoff. **Worked when:** the final acceptance artifact proves every gate and live SHAs match.

## 7. Constraints and gotchas

Do not modify NAS files, delete DB rows, increase timeouts, run parallel crawl/backfill/render loops, use retired Supabase project `ryltkzzernhwnojzouyb`, place migrations in PopDAM, or expose licensed filenames/secrets publicly. Use edge2 for reads. Shared structure routes through shared-db; application-created row cleanup belongs to PopSG only after immediate target proof. Preserve unrelated `.claude/` work. Full constraints are plan §11.

## 8. Access and environment

At planning time GitHub CLI and Supabase access worked; MCP `get_project_url` returned `https://qsllyeztdwjgirsysgai.supabase.co`; SSH alias `edgesynology2` returned hostname `edgesynology2`. Secrets remain in 1Password vault `vibe_coding`; no values belong in commands/logs/docs. Signed-in QA needs a `styleguides`-entitled administrator. Reverify all access and current branches; `/worksp/shared-db` was clean but 545 commits behind its remote and must not be casually pulled through concurrent work.

## 9. Open questions and risks

Implementer judgment remains for batch size, historical drop threshold, search implementation shape, alert transport, and terminal preview categories; plan §§8 and 13 give decision criteria. Main risks are false mass inactivation, a moving NAS during comparison, Edge limits, search/backfill load, Windows-agent capacity contention, licensed-data exposure, and cross-app DB impact. The rollback is reversible inactivation/export, bounded stop/resume, and retaining existing search as visible fallback. No sub-agents were used.
