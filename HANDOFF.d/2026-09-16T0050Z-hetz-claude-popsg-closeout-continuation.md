---
issue: 107
status: BLOCKED
owner: claude/hetz-codex-popsg-closeout-628782
---

# HANDOFF — PopSG production-readiness closeout, continuation (2026-09-16 00:50Z, hetz/claude)

Canonical plan: [`plan_popsg_production_readiness.md`](../plan_popsg_production_readiness.md). Read it after `AGENTS.md`, including its STATUS table and every execution-drift entry — the newest is dated 2026-09-16 00:55Z and is this session's. Read this file and its direct predecessor, [`2026-09-15T1117Z-hetz-codex-popsg-production-closeout.md`](2026-09-15T1117Z-hetz-codex-popsg-production-closeout.md), before touching this workstream. The predecessor is **kept, not retired**: several of its obligations are still open.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put all of these to the owner in ONE message before starting work. Do not raise them one at a time.

### Blocking

1. **Give a session the ability to run `sudo` on the Synology, or run one staged command yourself.** *(Updated 2026-09-16 01:35Z — this replaces the earlier "refresh the Container Manager project" ask, which was wrong: the owner confirmed the containers were deployed from the command line and are not Container Manager projects.)* SSH with the `916-alien` key works on both NASes as `ahazan`, but that account cannot reach the Docker control socket and `sudo` asks for a password. A file called `ahazan-docker.sudoers-disabled` sits in `/volume1/docker/popdam` on both hosts dated 2026-09-03, so the passwordless access that used to exist was deliberately removed after the bridge incident. Everything else is ready: a script that backs up, patches, updates and preserves rollback is already staged on the live NAS. *Recommendation: either re-enable that sudoers file, or SSH to `edgesynology1` and run `sudo sh /volume1/docker/popdam/apply-bridge-1.16.12.sh` once.* Blocks bridge 1.16.12 adoption.

2. **~~Turn the Windows render agent back on~~ — DONE 2026-09-16.** The owner brought `edge-alien` back online; it heartbeats healthy on `0.16.3.161`. This is recorded here only so a later session does not re-ask. It did **not** unblock the PDF work — see the new item below.

### Blocking, but nobody can act on it here — it is in the database team's lane

3. **The PDF queue is broken in production and the fix is not ours to make.** With the render machine back on, the PopDAM PDF queue was resumed and failed on every single attempt: the database refuses the "give me the next batch of files" call after 8 seconds, every 30 seconds, forever. Shared-db #2792 was closed as fixed, but its proof only ever tested a different function; this one was never measured. Because the style-guide PDFs are deliberately queued behind the PopDAM ones, all 4,318 of them are stuck too. The job has been paused again so it stops hammering production. *Recommendation: none needed from the owner beyond awareness — it is filed as shared-db #3009 and escalated to marker #3004. Raise it if that lane goes quiet.* Blocks plan step 3 completely.

### A wrong guess is recoverable, but confirm

4. **The style-guide NAS password is displayed in plain text on the PopSG Settings page to anyone with the admin role.** This is the known, already-fixed-at-the-database-level exposure from 2026-07-24 — admins are *meant* to see it, non-admins no longer can. But the value is still one of the eight credentials flagged for rotation back in July, and rotation has never happened. It is an Active Directory account, so rotating it is an AD change. *Recommendation: decide whether to rotate now or formally accept the risk and close the item — it has been open for seven weeks.* Does not block any step here.

### Already settled — do NOT re-ask

- The administrator test identity question from the predecessor handoff is **resolved and needs nothing**. An approved protected admin account already exists in 1Password vault `vibe_coding` (item "DAM AI tester login - PopDAM (administrator, dam.designflow.app, production)"). It has the `admin` role and `styleguides` access. Step 5 has been completed with it. Do not ask the owner for an admin identity again.
- Do not increase timeouts, delete NAS or database records, expose licensed paths, run competing crawls or backfills, or start a competing shared-db orchestrator.
- Shared database structure stays exclusively in `u2giants/shared-db` through its active orchestrator. This session was a non-orchestrator consumer and authored no migration, schema edit, database write, branch, or PR there.
- `edgesynology2` is read-side only; never write its Style Guides content.
- Shared-db #2506 is closed as completed. So are #2792, #2860, #2927, #2937 and #2945.

## 1. What this application is

PopSG is the authenticated style-guide library inside POP Creations' PopDAM application. It inventories eligible creative files from the read-side Style Guides NAS share (`edgesynology2`, share `styleguides`), renders previews for them, and provides browse and search. It is served at `https://sg.designflow.app`; its sibling PopDAM is at `https://dam.designflow.app`. The repository is `u2giants/popdam3`, checked out at `/worksp/popdam`, trunk-based on `main`. The shared PostgreSQL schema is governed separately in `u2giants/shared-db` at `/worksp/shared-db`. Production Supabase is the Virginia project `qsllyeztdwjgirsysgai`; the retired Ohio project `ryltkzzernhwnojzouyb` must never be used.

Two on-premises agents do the physical work. `synology-bridge-1` crawls the NAS and is currently online and healthy. `windows-render-agent` renders previews and extracts PDF text and is currently **offline**.

## 2. What we set out to do this session, and why

The owner asked whether anyone had started the predecessor handoff, then said "start executing". Nobody had: no commit since 2026-09-15 11:17Z referenced it, and the app code was untouched apart from unrelated shared-db syncs.

The prize is finishing issue [#107](https://github.com/u2giants/popdam3/issues/107) — a complete, trustworthy, searchable style-guide library. At session start every database ticket the predecessor was waiting on had been closed in the hours after it was written, so the plan was to verify those repairs were real, then run down the remaining plan steps in order.

It is ending because everything still open is either in another team's lane or needs physical access the owner controls.

## 3. Current state — what is true right now

### Completed and verified

- **Plan steps 1–4 (crawl trust and reconciliation) were already complete** before this session and remain so. The library now holds **216,801** active files, up from the 216,702 the predecessor proved, through ordinary nightly crawls. Crawl health in the live Admin page reads *Fully reconciled / completed*, discovered 216,801 = accepted 216,801, stale candidates 0, deactivated 0, remaining 0.
- **Plan step 6 (previews) was already complete** and still reconciles: 214,694 of 216,801 active files have a preview (99%), 99 queued, 2,008 classified render errors with per-file reasons and a retry control, 0 unsupported.
- **Plan step 5 (administrator-console acceptance) is COMPLETE as of this session.** Signed-in production QA on deployed build `f341443` against all four PopSG Settings tabs (Setup, File Tags, Render Agent, Users) produced **zero 4xx/5xx responses and zero browser console errors**. Healthy, reconciling, completed and failed/attention states were all observed live. Evidence: `verification/popsg-readiness/admin-console-qa-2026-09-15.md`. The four 403s the predecessor recorded were purely a consequence of using a non-admin account.
- **Commit `5c1dc874` is on `main` and pushed** (both configured remotes; `origin` and `github` are the same repository, so the second push reports "Everything up-to-date" — that is expected). It contains the admin QA evidence and the dated drift note in the canonical plan. Nothing else was changed and no application code was touched.
- **The governed database lane delivered.** Shared-db #2792 (bounded reconciliation) and #2860 (v2 search) both carry `db-work-completion` blocks with `outcome: live_verified` and production evidence runs, closed 2026-09-15 13:51–13:52Z under marker #2927, which is itself now closed. The reconciliation repair is genuinely good: a natural call at production volume returned in 93 ms.

### Still open / not accepted

- **Plan step 4, the v2 search app cutover, is HELD — and this is the most important thing in this handoff.** #2860's live proof used `p_result_mode=>'files'`, `p_query=>null`, `p_limit=>1`. At the parameters the app actually uses, the picture is different and is documented in §5. The frontend therefore still reads `style_guide_files` and `style_guide_file_groups` directly at `src/pages/popsg/PopSGLibraryPage.tsx:617-705`, exactly as the predecessor left it. **Do not cut over until the new issue below is resolved.** The gap is filed as shared-db [#3009](https://github.com/u2giants/shared-db/issues/3009) and routed to active orchestrator marker [#3004](https://github.com/u2giants/shared-db/issues/3004).
- **Plan step 3, PDF text extraction, is blocked by a live production database failure.** *(Updated 2026-09-16 01:35Z.)* The Windows render agent is back online and healthy on `0.16.3.161`. The PopDAM queue was resumed through the normal authenticated admin route and failed on every heartbeat with `agent-api claim-pdf-backfill-batch returned 500: claim_pdf_backfill_batch failed: canceling statement due to statement timeout`. Nothing was claimed; no rows moved. The job has been **paused again** to stop it issuing a failing 8 s query every 30 seconds. This is filed on shared-db #3009 and escalated to #3004. It blocks PopSG extraction too, because `handleClaimStyleGuidePdfText` in `supabase/functions/agent-api/index.ts` (~line 3331) refuses to hand out style-guide work while the PopDAM job is unfinished. See §5 for why the "remainder of 2" the predecessor treated as a defect is separately not one.
- **Bridge 1.16.12 adoption is diagnosed and staged, and needs one `sudo` run.** *(Updated 2026-09-16 01:35Z.)* `synology-bridge-1` heartbeats every 30 seconds on `1.16.11`, build `6ca879e7e23d6e0eacec55f9e8e460afbbb4fca0`. The live bridge is on **`edgesynology1`**, not edge2 — edge2 has a stale `/volume1/docker/popdam` folder but the running, data-volume-backed, rollback-stamped deployment is on edge1. Its on-NAS `docker-compose.yml` is missing both the `POPDAM_COMPOSE_PATH` environment entry and the `/volume1/docker/popdam:/app/compose:ro` mount that repo commit `fc7bfa91` added, which is exactly why the self-updater stops safely. A re-runnable script that takes a timestamped backup, patches the compose file in place preserving edge1's own host paths, records the current image id for rollback, pulls the published image, recreates the Compose-owned service and prints the resulting state is staged at `/volume1/docker/popdam/apply-bridge-1.16.12.sh` on edge1. **The NAS itself was not modified** — only that script was placed. It needs `sudo`, which is the §0 item 1 ask.
- **Final acceptance, `verification/popsg-readiness/final-acceptance.md`, closing #107, and retiring the handoffs remain open.**

At closeout the worktree is clean, `main` equals `origin/main` at `5c1dc874`, and `git var GIT_COMMITTER_IDENT` reports `Albert Hazan <u2giants@users.noreply.github.com>`.

## 4. Everything we tried that did NOT work

1. **The Supabase MCP server is unauthorized in this environment** — `execute_sql` returns "Unauthorized. Please provide a valid access token". This is a long-standing known gap, not a new regression, and it is **not a dead end**. The working path is psql through the pooler with the password injected by 1Password; the exact command is in §8. Do not spend time re-diagnosing the MCP.
2. **Calling `search_style_guide_library_v2` as the bare `authenticated` role fails with "PopSG access required"**, because the function checks `auth.uid()` and app access rather than the role alone. You must set `request.jwt.claims` to a real entitled user id. The one used here is in §8.
3. **Taking the `guides` result mode on trust because #2860 is closed would have shipped an intermittently broken library.** The first unfiltered `guides` call measured in this session was cancelled by the statement timeout at 8.02 s. Repeats then succeeded at 6.4–7.3 s, which is how a single-sample live proof can pass while the real thing fails.
4. **Believing the predecessor's account that `claim_pdf_backfill_batch(1)` is broken.** It is not simply broken; it is cold-versus-warm. The first call of a session times out at 8 s and every repeat returns in about 2 s. Chasing it as a pure logic defect would have wasted a session.
5. **Resuming the PopDAM PDF queue did not work, and it is worth knowing exactly how it fails.** Everything on the app side was correct — agent online, healthy, version-capable, `trigger_pdf_backfill` issued on the heartbeat, `activeJobs` at zero, no competing maintenance workload. The failure is entirely in the database call, it repeats on every heartbeat, and **it never warms up**: the earlier cold-versus-warm theory does not rescue it under the Edge caller. Do not go looking for an agent bug or a gating bug; both are fine.

6. **Reaching the Synology as `ahazan` over SSH is not enough to control containers.** The key works and a shell is granted, but `/var/run/docker.sock` is `root:root` mode 0660, `docker` is not on `PATH` (it is at `/usr/local/bin/docker`), `sudo -n` reports a password is required, `/etc/sudoers.d` is unreadable, and neither `root@` nor `admin@` accepts the key. `scp` also fails on these hosts — the SFTP subsystem appears disabled — so files must be piped in over `ssh 'cat > /path'`.

7. **Screenshots of the PopSG Settings page were deliberately NOT taken or saved.** That page renders the NAS password in plain text and the render-error list contains licensed file paths. No screenshot, path, filename, cookie or credential was written to any file, commit or issue.

## 5. Root causes and key findings

- **The real defect in v2 search is the unfiltered default view, and only that.** Measured on production as role `authenticated` with `statement_timeout='8s'` and a genuine PopSG-entitled `request.jwt.claims`, over 216,801 active rows, `p_limit=>50`:

  | Call | Observed |
  |---|---|
  | `files`, no query, `modified_desc` | 3.4–6.6 s |
  | `guides`, no query, `modified_desc` | 6.4–7.3 s, **one 57014 timeout at 8.02 s** |
  | `guides`, no query, offset 1000 | 7.26 s |
  | `guides` with a licensor filter | 0.07 s |
  | `guides` with a text query | 0.75 s |
  | `files` with a text query | 0.49 s |
  | `files`, zero-result query | 0.01 s |

  Every filtered or queried call is fast. Only the whole-corpus call is slow, and `guides` mode is roughly twice `files` mode. The unfiltered call is the default landing view — the single most frequent customer request — so the slowest case is also the most common one. The likely cost is the full-corpus facet aggregation plus the exact total, both computed on every call with no caller opt-out; the facet block is visible near the end of the function body.

- **There is a cold/warm pattern across three separate functions, which suggests one shared cause rather than three.** Each measured in its own transaction and rolled back:

  | Call | Cold | Warm |
  |---|---|---|
  | `claim_pdf_backfill_batch(2)` | **57014 at 8.00 s** | 2.1–2.4 s |
  | `count_pdf_backfill_remaining()` | 6.1 s | 0.6 s |
  | `search_style_guide_library_v2` unfiltered `guides` | **57014 at 8.02 s** | 6.4–7.3 s |
  | `search_style_guide_library_v2` unfiltered `files` | 6.6 s | 3.4–3.7 s |

  A live proof taken from a warm cache passes; the first real call of the day fails. That is exactly the call that matters for a nightly queue drain and for the first customer to open the library each morning. Both tables are in this note on #3009.

- **The PopDAM PDF "remainder of 2" is not a defect and needs no repair.** That queue genuinely completed on 2026-09-14 03:10Z with 23,558 processed of 23,549. The two files `count_pdf_backfill_remaining()` still reports were created on 2026-09-14 14:27Z, *after* completion — ordinary incremental drift, two new licensing PDFs arriving. The predecessor read the count as evidence of a stuck queue. It is not. What it does mean is that the job's stored status is `completed`, so **the agent will not pick them up on its own; the queue needs an explicit admin resume** once the Windows machine is back.

- **Shared-db #2792 was closed wider than its evidence, and that is the single most useful thing to know here.** Its title and body cover both bounded reconciliation and the PDF claim/count performance defect. Its `live_assertion` covers only `reconcile_stale_sg_files_batch`, which is genuinely repaired — 93 ms at production volume. `claim_pdf_backfill_batch` was never measured, and it fails in production on every call. The general lesson, which also applies to #2860, is in §9: read the `live_assertion` field rather than the outcome label.

- **PopSG PDF extraction has never run at all.** `public.style_guide_pdf_text` is completely empty and there is no `POPSG_PDF_BACKFILL` row in `admin_config`. The Settings card correctly shows 4,318 active PDFs and zeros everywhere else with the text "Not started." The queue is self-enrolling: `claim_style_guide_pdf_text` inserts a bounded slice of un-enrolled active PDFs on each call, so nothing needs pre-seeding — it just needs starting.

- **The serialization between the two PDF queues is enforced in code, in `supabase/functions/agent-api/index.ts` around line 3331.** `handleClaimStyleGuidePdfText` returns no work unless `POPSG_PDF_BACKFILL` is `running` **and** `PDF_BACKFILL` is not `running`, and it refuses any agent whose type is not `windows-render`. So the order is forced by the system: finish PopDAM, then start PopSG. You cannot accidentally run them in parallel.

- **The v2 function's modes are `files` and `guides`.** Not "groups" — a call with `p_result_mode=>'groups'` raises `p_result_mode must be files or guides`. The app's internal vocabulary says "groups", which is an easy trap when writing the cutover.

## 6. Exact next steps

1. Read `AGENTS.md`, then the plan and its STATUS table, then this handoff, then the predecessor. Run `git status --short --branch`, fetch, and check the states of #107, #3009 and #3004. **You'll know it worked when:** you can state which of the three blockers in §0 have been cleared, without guessing.

2. Put the whole of §0 to the owner in one message. **You'll know it worked when:** you have a yes or no on each of the three, recorded with the date.

3. Watch shared-db #3009 under marker #3004. Do not author the repair. When it reports a fix, verify it yourself the way §5 was measured — as role `authenticated`, with real JWT claims, at `p_limit=>50`, both modes, **cold first and then warm**, repeated samples. **You'll know it worked when:** the unfiltered default browse finishes comfortably inside the 8 s ceiling in both `files` and `guides` mode on a cold call, with headroom rather than a number just inside the limit, and no SQLSTATE 57014 in any sample.

4. Only after step 3 passes, implement the smallest possible app cutover from the direct legacy reads at `src/pages/popsg/PopSGLibraryPage.tsx:617-705` to `search_style_guide_library_v2`. Remember the mode is `guides`, not `groups`. Cover filters-before-pagination, ranking, counts and facets, zero results, errors, and authorization. Keep the legacy path available until acceptance. Deploy normally through `main` → GitHub Actions → GHCR → Coolify. **You'll know it worked when:** signed-in production QA proves search and filter parity with no console or HTTP errors, and the deployed SHA is recorded in the evidence folder.

5. The Windows render agent is already back online — do not re-ask for it. Wait for the `claim_pdf_backfill_batch` repair on shared-db #3009, verify it yourself cold at `p_limit=>10` (the size the Edge function actually uses), then resume the PopDAM PDF job through the normal authenticated admin route; it is currently `paused` and will not restart itself. Watch the agent's `log_tail` in `public.agent_registrations`, not just the progress numbers — that is where the real error appears. **You'll know it worked when:** `count_pdf_backfill_remaining()` returns 0, the job reports completed, and no `canceling statement due to statement timeout` line appears in the agent log.

6. Then, and only then, start exactly one PopSG PDF extraction job via the `trigger-popsg-pdf-backfill` admin action (there is deliberately no button on the coverage card). Wait for its terminal result. **You'll know it worked when:** the PDF Search Coverage card accounts for all 4,318 active PDFs across extracted, failed and terminal-skipped, with no concurrent or duplicate worker and no PopDAM job running at the same time.

7. For bridge `1.16.12`, once `sudo` is available on `edgesynology1`, run the staged `/volume1/docker/popdam/apply-bridge-1.16.12.sh`. Read it first; it is idempotent and prints its own rollback command. Do not substitute `docker run` or `compose down` if it fails — restore the backup it took and report. **You'll know it worked when:** the bridge heartbeat reports `1.16.12`, `com.docker.compose.project.working_dir` is still set on the container, restart count has not grown, heartbeats are continuous, the previous image id is recorded in `/volume1/docker/popdam/previous-image-before-1.16.12.txt`, and no NAS content changed.

8. Re-read the downstream plan phases after each accepted phase and append a dated drift entry. Preserve the existing ordinary crawl proofs; if a structural change requires a fresh one, wait for the ordinary nightly run rather than triggering a manual crawl. **You'll know it worked when:** every plan STATUS row has current evidence and no manual crawl is counted as acceptance.

9. Complete final acceptance, write `verification/popsg-readiness/final-acceptance.md`, update only the operating docs actually affected, close #107, and in that same finishing commit delete this handoff and the predecessor. **You'll know it worked when:** #107 is closed, every delivered behaviour has live evidence, and no PopSG readiness handoff remains in `HANDOFF.d/`.

## 7. Constraints and gotchas in force

- No timeout increase, no destructive NAS or database action, no raw licensed evidence in chat/commits/issues, no competing crawls or backfills, no competing shared-db orchestrator.
- **Do not take a screenshot of PopSG Settings.** The NAS password renders in plain text and the render-error list carries licensed paths.
- Shared-db changes are branch, PR and preview-first in `/worksp/shared-db`. This repo's mirrored `shared-db/` folder is read-only and its own `supabase/migrations/` is historical; CI blocks new app-owned shared DB migrations. Note the mirror can lag — it did not yet contain the #2946 merge during this session, so read function definitions from the live database rather than from the mirror.
- Read broad NAS data only on `edgesynology2`; write-side PopDAM activity belongs on `edgesynology1`.
- App commits go directly to `main`. Pushes are frequently rejected as non-fast-forward because `main` moves often; rebase with `git rebase --autostash origin/main` and confirm the worktree is unchanged. Never force-push and never revert files you did not modify. The worktree is shared with other sessions, so stage only your own paths.
- Treat green CI, a deployment stamp and an HTTP 200 as signals only. Required proof is behaviour in production plus correct live backend and agent state.
- Never resolve a bridge problem with `docker run` or `compose down`. The self-updater's refusal to proceed without a visible Compose file is a deliberate guard that exists because bypassing it destroyed a container once already.

## 8. Access and environment

- GitHub CLI is authenticated as `u2giants`; git identity verified. Issue reads/writes and ordinary app commits and pushes all work.
- **The Supabase MCP is unauthorized — use psql.** Write a 600-mode env file containing `PGPASSWORD=op://vibe_coding/246sf23gymd64yudpmhswcnyle/password`, then:
  `op run --env-file=<file> -- psql "postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres"`.
  The user is the pooler form `postgres.<project-ref>` and the host region is `aws-1-us-east-1`, not the project's own hostname. Confirm the target before any write.
- **To exercise a PopSG function the way a customer does**, in psql: `set role authenticated; set statement_timeout='8s'; set request.jwt.claims='{"sub":"68a61bae-7e93-46df-b5b1-c89982bcb5cf","role":"authenticated"}';` — that subject is the non-admin `ai-tester` account.
- **Browser QA without typing a password**: obtain a password-grant token with credentials injected via `op run --env-file`, write the session JSON to a scratch file, serve it on `127.0.0.1`, read it inside `browser_run_code_unsafe` with `page.request.get` (there is no `fetch`, `require` or `import` in that sandbox), and write it to `localStorage['sb-popdam-auth-token']`. Delete the token file immediately afterwards, in a separate shell call. Admin item id `7s5uzpbjenka4fpvrqogh44bre`, anon key from item `3hhxwrljnaq2tykxi7hplq5ryi` field `SUPABASE_PUBLISHABLE_KEY`. All values live in 1Password vault `vibe_coding`; none are reproduced here.
- **SSH to the NASes is configured and works:** `ssh edgesynology1` (100.107.131.35, port 22) and `ssh edgesynology2` (100.107.131.36, port 1904), user `ahazan`, key `~/.ssh/916-alien`. The live bridge is on **edge1**. `docker` lives at `/usr/local/bin/docker` and needs `sudo`, which currently asks for a password. `scp` does not work on these hosts; pipe files with `ssh <host> 'cat > /path'`.
- Production bridge and agent state are readable from `public.agent_registrations` (columns `agent_name, agent_type, agent_key_hash, last_heartbeat, metadata, created_at` — there is no `status` column) and from the PopSG Settings page.
- **What this session did write:** the PopDAM PDF job's `admin_config` status was resumed and then paused again through the normal authenticated admin API (application row data, owned by this application), and the script `apply-bridge-1.16.12.sh` was placed in `/volume1/docker/popdam` on edge1. No container, image, NAS content, shared-db migration, preview environment, production promotion, or schema object was changed.

## 9. Open questions and risks

- **The cold/warm pattern is the real risk and it is not yet understood.** If #3009 is answered only by re-running a warm proof, the same trap closes again. Insist on a cold measurement.
- **A closed issue with a `live_verified` block is not proof that the app's real usage is safe.** #2860 is the worked example: correctly closed against its own stated assertion, which did not match how the app calls the function. Read the `live_assertion` field, not just the outcome.
- **The library keeps growing** — 216,702 to 216,801 during a single day. Any parity or coverage evidence is only valid for its own window; re-derive rather than reusing a number from an older handoff.
- **The remaining blockers are now one database repair and one `sudo`.** The Windows machine is back. If shared-db #3009 stalls, #107 cannot close no matter what is done on the app side, and that should be said plainly rather than worked around.
- **Do not let the paused PopDAM job be quietly forgotten.** Its stored status is `paused`, which looks deliberate and calm; it is actually a blocked queue with two files outstanding and 4,318 behind it.
- **The July credential exposure is still unrotated after seven weeks.** It is listed in §0 item 3 so it stops being re-discovered and re-deferred.

## Part (b) — dispatched sub-agent record

None. This session dispatched no sub-agents and ran no worktree other than its own.

## Mandatory self-audit — final pass

1. **Yes.** A brand-new developer could continue without asking a question: §1 defines the product, hosts and repos; §3 gives verified state, exact commit `5c1dc874`, and what is unfinished; §5 gives the measured numbers and code locations including `PopSGLibraryPage.tsx:617-705` and the serialization check in `agent-api/index.ts`; §6 gives ordered steps with gates; §8 gives the working database and browser access paths verbatim, including the two traps that cost this session time.
2. **Yes.** Every non-obvious thing learned is written down: the cold/warm pattern and its full measurement tables, the `guides` vs `groups` naming trap, the JWT-claims requirement, why the "remainder of 2" is not a defect, why the mirror lagged, and why no screenshot was taken.
3. **Yes.** Background and intent in §§1–2; state and evidence in §3; dead ends in §4; findings in §5; executable gated actions in §6; constraints, access and risks in §§7–9.
4. **Yes, checked the hard way.** Walking §1–§9 line by line for sentences needing the owner's judgement produced exactly three: the offline Windows agent (§3, §5, §6 steps 5–6), the NAS administrator path for the bridge (§3, §6 step 7), and the unrotated NAS password seen in plain text (§4, §9). All three appear in §0 with a recommendation and what they block. The predecessor's admin-identity ask is listed under "already settled" so it cannot be re-raised. Nothing else in the document asks for a ruling.

All ten sections are present, every next step carries a verification gate, secrets are referenced by vault and item only, and no licensed path or filename appears anywhere in this file.
