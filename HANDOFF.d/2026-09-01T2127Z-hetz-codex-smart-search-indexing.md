---
issue: 97
status: OPEN
owner: codex/smart-search-indexing-97
---

# HANDOFF — Smart Search indexing and direct Muse tagging (2026-09-01 21:27Z, hetz/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

No new owner decision is currently required.

Already settled — do NOT re-ask:

- On 2026-09-01 Albert chose Supabase `gte-small` for Smart Search vector conversion and explicitly told this session to continue the backfill. Continue from the saved operation state; do not substitute Muse or another embedding model.
- On 2026-09-01 Albert chose `meta-direct/muse-spark-1.2-contributor` through POP's direct Meta API for both file-specific tagging and Style Group-wide profiling. Fallback and OpenRouter provider pinning were deliberately disabled.
- On 2026-09-01 Albert stopped the earlier Smart Search run, then later explicitly authorized resuming it after the pricing and purpose were explained. The latest instruction to continue supersedes the earlier stop.

If a genuinely new choice appears, put every choice to Albert in one message before acting. Nothing in sections 1–9 presently needs his judgement.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager at `https://dam.designflow.app`. Employees browse licensed artwork stored from the NAS, organize files into Style Groups, add searchable metadata, and find artwork. The application repository is `u2giants/popdam3` in `/worksp/popdam`; the React frontend runs through Coolify, the persistent worker runs on Railway, and the shared PostgreSQL database plus Edge Functions run in Supabase project `qsllyeztdwjgirsysgai`.

Two separate AI systems matter here:

- Image tagging describes each individual image and also creates a separately stored Style Group profile. It now uses Muse Spark 1.2 Contributor through Meta's direct API.
- Smart Search indexing converts existing text—names, descriptions, active tags, characters, product facts, and PDF text—into 384-number vectors. It uses Supabase's built-in `gte-small`; it does not analyze images and does not use Muse.

## 2. What we set out to do this session, and why

The session began by untangling several handoffs and issues, then focused on two owner requests:

1. Ensure issue #96's two metadata scopes remain separate: file-only visual tags/descriptions versus Style Group-wide shared tags/description, with both inference paths using POP's direct Muse API.
2. Explain issue #97 Smart Search indexing, confirm its cost and model, then resume the production vector backfill with `gte-small` after Albert approved it.

The intended business outcome is richer search without mixing file-specific facts into the whole product group, while retaining a visible and stoppable indexing process in the DAM admin UI.

## 3. Current state — what is true right now

### Direct Muse tagging — implemented and deployed

- Commit `0a3432a27b3d394bf7e641dd46fabaec7c61e0af` is on `main`, pushed to `origin/main`, and Railway reports deployment context `popdam - popdam3: success`.
- CI, Shared DB Guard, and Forbid Shared DB Bypass all passed for that SHA.
- File-level tagging already used `metaChatCompletion`; this session fixed Style Group profiling so `callStyleGroupModel` selects the same direct Meta route at `apps/worker/src/handlers/ai-style-group-profile.ts:389-425`.
- Production `admin_config.AI_TASK_MODELS` was authenticated-read-back verified as `vision_tagging=meta-direct/muse-spark-1.2-contributor`, blank `vision_tagging_fallback`, and blank `vision_tagging_provider`.
- No image-tagging or Style Group-profiling bulk run was started by this session. Only the model selection and missing group route were changed.
- The worker suite passed all 140 tests and TypeScript build before commit. A new test proves the group request targets `https://api.meta.ai/v1/chat/completions`, strips the `meta-direct/` prefix, and includes no OpenRouter provider.

### Smart Search indexing — OPEN and running

- GitHub issue `u2giants/popdam3#97`, “Finish and safely enable PopDAM hybrid search,” remains OPEN.
- The normal persistent operation key is `embed-dam-search`. The Railway worker claims three text documents at a time (`apps/worker/src/handlers/embed-search.ts:6-10,40-80`) and asks the deployed `dam-search-ai` Edge Function to generate `gte-small` vectors.
- At the final authenticated production read after resuming, operation status was `running`, cursor `2912`, with 8,826 embedded, 136,425 pending, 2 leased, 0 ordinary errors, and 0 terminal/exhausted rows. Counts are expected to change continuously.
- The status and Start/Stop/Resume controls are visible to admins at DAM → Settings → AI Tagging → Smart Search Index; the card polls every three seconds while active (`src/components/settings/SearchIndexCard.tsx:19-72`).
- `SEARCH_AUTO_EMBED_ENABLED` remains `false`. This is the owner-started controlled backlog operation, not unattended maintenance.
- Keyword search remains available independently. Hybrid rollout must not be declared complete merely because vector generation is running.

### Repository state

- Branch: `main`, synchronized with `origin/main` before this handoff commit.
- Unrelated untracked `.claude/` belongs to another tool/session and was deliberately not opened, staged, edited, or removed.
- This handoff is the only new repository file owned by this closeout.

## 4. Everything we tried that did NOT work

1. A first Muse review run from the live checkout failed its repository inventory because unrelated `.claude/worktrees/*` directories were untracked. It produced no valid verdict. The review was rerun from a clean temporary clone and returned “READY WITH CONDITIONS,” identifying the Style Group direct-route gap. Do not remove `.claude/` to make reviewers pass; use a clean isolated checkout.
2. The original full Smart Search backfill estimate was roughly 27–30 hours because hosted Edge inference timed out at larger batches. Albert rejected letting an unexplained long job continue and ordered it stopped. The operation was stopped safely with no leased rows, then resumed only after its purpose, model, UI, and likely cost were explained.
3. Production samples already proved batches of 25, 10, and even 5 documents can exceed the hosted Edge runtime. The code therefore uses three documents per call (`apps/worker/src/handlers/embed-search.ts:6-9`). Raising the batch size is a known failed direction, not an optimization opportunity.
4. During this closeout the resumed backfill reached 8,822 embedded rows, then the Edge Function returned HTTP 546 with no useful response body. Automatic recovery exhausted six retries and left the operation `interrupted`, cursor `2911`, with zero leased/error/exhausted database rows. This session resumed from that saved cursor; it immediately progressed to 8,826 embedded. The 546 is an intermittent runtime failure, not evidence of corrupt vectors or a reason to restart at zero.
5. An attempted targeted npm test command passed `--test-name-pattern` through the package script incorrectly, so the runner treated it as a path. The session recovered by running the complete worker suite; all 140 tests passed.

## 5. Root causes and key findings

- File tagging and Style Group profiling are genuinely separate writers. The group writer stores only group-scoped categories through the governed profile RPC; the code change only aligned its provider route with the already-direct file path. The provider choice is at `apps/worker/src/handlers/ai-style-group-profile.ts:395-423`; the group write still begins at `profileOneStyleGroup` immediately below.
- `gte-small` is fixed inside `supabase/functions/dam-search-ai/index.ts`; the database vector column is 384 dimensions. It is not exposed in the AI model selector because changing embedding models requires regenerating the full vector corpus and possibly changing the schema dimension.
- Supabase documents no separate per-token charge for built-in `gte-small`; this workload consumes ordinary Edge Function invocations. With three documents per call, the 143,379-document pending backlog initially implied about 47,793 calls, below the Pro plan's two-million monthly included invocation allowance unless unrelated usage consumes that allowance.
- The worker owns leasing and restart-safe progress. It claims through `claim_dam_search_embedding_documents` and records results only through the lease/hash-checked write path (`apps/worker/src/handlers/embed-search.ts:40-80`). Supabase hosts inference and storage, but the DAM operation starts/stops it and displays coverage.
- HTTP 546 can still occur even at the conservative batch size. Saved numeric cursors and leases make resumption safe. Never launch a second shell loop or direct database loop; resume the one `embed-dam-search` operation.
- Meta's Contributor tier may use submitted prompts, thumbnails, and outputs for training. Albert was explicitly told this before the model was finalized.

## 6. Exact next steps

1. Monitor DAM → Settings → AI Tagging → Smart Search Index and the authenticated `embedding-status` action. You will know it is progressing when `embedded_documents` rises and `pending_documents` falls while errors and exhausted remain zero.
2. If `embed-dam-search` becomes `interrupted` again with HTTP 546 and has no leased documents, resume the existing operation through the DAM button; preserve its numeric cursor and progress. You will know recovery worked when status returns to `running` and at least one additional document becomes embedded.
3. If repeated 546 interruptions make manual resumes operationally unreasonable, diagnose Edge-runtime duration with privacy-safe timing only. Keep batch size at three unless production evidence proves a safer change. You will know diagnosis is sufficient when the exact stage/duration is known without exposing search text or row values.
4. Let the controlled initial backlog finish. You will know vector generation is complete when status reports pending `0`, leased `0`, errors `0`, exhausted `0`, and embedded equals total.
5. After completion, execute issue #97's remaining production acceptance gates from `plan_hybrid_search_rollout.md`: authenticated authorization isolation, filtered ranked pagination/count/facet parity, Style Group rollup, and cold runtime below eight seconds with headroom. You will know acceptance passes when exact sanitized timings/counts are recorded on issue #97 and unauthorized users cannot infer restricted results.
6. Enable `SEARCH_AUTO_EMBED_ENABLED` only after the initial backlog and acceptance gates pass, then observe at least two maintenance intervals. You will know maintenance is safe when new/changed documents are embedded automatically without overlapping leases, errors, or search regression.
7. Close issue #97 only after the full acceptance evidence exists, then delete this handoff in the same finishing commit under the successor rule. You will know cleanup is correct when the issue is closed, this file is absent from `main`, and Git history retains it.

## 7. Constraints and gotchas in force

- Production and shared infrastructure are read-only by default except for the already-authorized normal DAM operation/config actions. Do not run direct SQL or bypass the admin operation workflow.
- Any shared schema/RPC/permission change belongs first in `/worksp/shared-db` using its branch, PR, preview, merge, and production-proof workflow. Never add a migration under this app repository.
- Keep the scopes separate: individual visual facts belong to asset rows; shared product/artwork facts belong to Style Group rows. Never copy asset tags across every member of a group.
- Do not mix embedding models in one corpus. Query and document vectors must use the same model.
- Do not increase the Edge batch size to reduce wall time; larger sizes are a proven timeout path.
- Do not enable unattended automatic indexing before the initial backlog and acceptance gates pass.
- Preserve unrelated `.claude/` and all other sessions' handoffs. Stage only owned paths.
- The direct Muse key remains in Railway/1Password; never print, log, commit, or place it in a handoff.

## 8. Access and environment

- Working copy: `/worksp/popdam`, branch `main`, GitHub repo `u2giants/popdam3`.
- Production app: `https://dam.designflow.app`; admin status path is Settings → AI Tagging → Smart Search Index.
- Production Supabase project: `qsllyeztdwjgirsysgai`. Do not use the decommissioned old project.
- `gh` is authenticated for `u2giants`; CI, issue, commit-status, and deployment evidence were read successfully.
- Production admin verification used the established protected login and Supabase runtime references from 1Password vault `vibe_coding`, items `popdam admin tester` (`7s5uzpbjenka4fpvrqogh44bre`) and runtime keys (`3hhxwrljnaq2tykxi7hplq5ryi`). Values were injected with `op run`, never displayed or committed.
- Temporary reference-only environment/script files under `/tmp` were moved to trash before closeout.
- Valid Muse review ran through the protected `ai-muse` wrapper as required; direct Meta credentials were never obtained by this session.

## 9. Open questions and risks

- The initial vector backfill is incomplete and may encounter further HTTP 546 Edge-runtime interruptions. Recovery is safe, but repeated manual resumes could extend elapsed time.
- Automatic freshness is deliberately off, so documents changed after their initial embedding may remain pending until the controlled backlog and acceptance are complete.
- Smart Search must remain dark until issue #97's authorization, ranking, facet/count parity, Style Group rollup, and cold-runtime gates pass. Coverage alone is not production acceptance.
- Contributor-tier data use is a known accepted tradeoff for tagging, not for Smart Search: `gte-small` runs inside Supabase and does not send the corpus to Meta.
- No new owner judgement is hidden here; the section-0 sweep found only the three already-settled decisions listed in section 0.

## Final self-audit

1. **Yes, a brand-new developer can continue without asking a question.** Sections 1–3 define the app, both AI systems, exact production state, repository/deploy state, and live counts; sections 6 and 8 provide the executable route and access locations.
2. **Yes, they can continue as effectively as this session.** Sections 4–5 preserve the failed review, unsafe batch sizes, HTTP 546 behavior, cursor-safe recovery, provider separation, cost finding, and exact source references.
3. **Yes, every execution detail is present.** Background and goal are in sections 1–2; current evidence in 3; failures in 4; findings in 5; ordered actions and verification gates in 6; constraints/access/risks in 7–9; commit, CI, deployment, secret locations, and current counts are explicit.
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of sections 1–9 found three owner decisions: use direct Muse for both tagging scopes, use `gte-small` for vectors, and resume after the earlier stop. All three appear in section 0 as already settled; no blocking, recoverable, or out-of-scope decision remains.
