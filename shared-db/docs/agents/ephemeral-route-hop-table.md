# The #2758 ephemeral route hop table — merge to production (issue #3199 Phase C1)

**Purpose.** Every hop between "the guarded merge completed" and "production apply finished" on
the low-risk (#2758) route, naming who or what performs it, what evidence it consumes, and — if
manual — exactly why it stays manual. This table is the Phase C2 audit: C2's conclusion
(**no code change**) is recorded on the plan's STATUS row with this file as its artifact.

**The route in one line.** A migration whose every statement the production classifier
(`ALLOWLIST` in `scripts/production_business_risk_gate.py`, applied by `preview_required_reasons`)
recognizes as low-risk may substitute the source PR head's successful
`supabase/tests against an ephemeral database` check run for the shared-preview apply evidence:
`--ephemeral-check-run-id` instead of `--preview-run-id`/`--preview-artifact-digest`
(AGENTS.md §4 rule 2, exception #2758). Anything the classifier does not recognize still
previews — that rule is unchanged by this table.

**Standing automation already covering part of the chain.** AGENTS.md §5's automatic promotion
job (`Automatic production qualification and dispatch` in `shared-supabase-migrations.yml`)
already dispatches production with zero session turns whenever a preview apply of merged main
succeeds for one source PR — and, since issue #3039, its `Qualify the evidence route the
production gate accepts` step substitutes the ephemeral route by itself when the gate's
producer pin refuses (`scripts/test_automatic_qualification_route.py` proves both routes).
That path is triggered BY a preview apply. The hops below are what remains on the
no-preview-at-all ephemeral route.

## The hops

| # | Hop | Actor | Manual? | Evidence consumed | Why it is (or is not) automated |
|---|-----|-------|---------|-------------------|--------------------------------|
| 1 | Ephemeral-database CI on the PR head (`supabase/tests against an ephemeral database`) | CI, on every pull request | No | The migration bytes | Already automatic; its JOB ID becomes the route's evidence. |
| 2 | Draw reviewer(s) and run the governed review to a durable verdict | A session: `node scripts/manage-migration-author-lanes.mjs --assign-reviewer …`, then `node scripts/run-governed-review.mjs …` | **Yes — mechanics, but deliberately session-driven** | Exact PR head SHA; the wrapper the draw returns | The draw is a guarded command, and the REVIEW itself is judgment (a model reading the diff). Automating verdict production would be a reviewer, not a hop. Not a #3199 candidate. |
| 3 | Dispatch the guarded merge | Any write-authenticated session (plan §8, locked 2026-09-17): `gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<sha>` | **Yes — one command, deliberately** | PR number + the exact reviewed head SHA | The workflow re-proves required checks, exact-head approval, lease and admission itself under its own lock; the dispatch is an authorization act (a human-visible decision that THESE bytes merge now). Pre-#3199 this waited on the orchestrator's attention — the fix was publishing the dispatch right (B3), not automating the dispatch. |
| 4 | Assemble the production dispatch inputs (versions, review evidence run ID, ephemeral check-run job ID, source PR, work issue) | A session, through `node scripts/dispatch-production-apply.mjs` (no `--dispatch` prints the plan) | **Yes — but the transcription is already automated** | Run listings via `scripts/gh-read.mjs`; the script refuses any non-success evidence run and checks every input name against the workflow | Pure mechanics were ALREADY removed: the script gathers digests, normalizes them and refuses mismatches (popcre/ai-devops#507). What remains manual is naming the run IDs — which is the same deliberate act as hop 3. |
| 5 | Dispatch the production apply | A session: `dispatch-production-apply.mjs … --ephemeral-check-run-id <job> --mode apply --dispatch` | **Yes — deliberately** | Everything hop 4 assembled; the production lane's exclusive lock | The single highest-consequence act in the chain. AGENTS.md §5 pins that this narrow path "authorizes no manual production command … or bypass" *outside* the governed script — the script's dispatch is the sanctioned form, and automating it away (e.g. a push-triggered production dispatch) would remove the last human-visible go/no-go before production changes. The workflow itself re-proves target identity, dry-run, risk conclusions, locks and post-apply state. |
| 6 | Production apply workflow re-proofs (target proof, allowlist derivation pin, fresh dry-run, business-risk gate, exclusive lock, post-apply ledger/catalog verification) | CI (`production` job of `shared-supabase-migrations.yml`) | No | The dispatch inputs + live GitHub/database state | Already automatic and fail-closed; the risk gate refuses the ephemeral route for anything its classifier does not positively recognize as low-risk. |
| 7 | Record the outcome and release the claim (the issue carries an outcome stage, so complete it with `--complete-outcome` — the outcome lifecycle accepts BOTH structural routes — or `--complete-work` where no outcome stage applies, then close the issue; `--release-claim` if the claim's objects are done) | A session | **Yes — judgment, deliberately** | The post-apply verification artifact | "Outcome" is a claim about the world (applied AND verified AND behaving), not a transcription; §4's full text requires the doing session to own it. Automating closure on a green run is exactly the "closure alone is not success" trap the dependency rules exist to prevent. |

## C2 conclusion — no code change

Every remaining manual hop is one of: a **review judgment** (2), a **deliberate authorization
act** (3, 5), an **already-automated transcription step** whose residue is the same deliberate
act (4), or an **outcome claim that must be owned** (7). No pure-mechanics hop remains
unautomated: hop 4's lookup was the only candidate and `dispatch-production-apply.mjs` already
does it. Adding a no-preview auto-dispatch of production (the only conceivable new automation)
would create a second production path — explicitly refused by AGENTS.md §5 and plan §7.
Recorded on the plan STATUS row for C2 with this table as the artifact.

*Counts and states above name the commands and files that produce them (owner ruling §4.3);
re-derive rather than trusting any number in this document.*

## The ADD COLUMN lock, stated plainly (round-2 review, Medium)

`ALTER TABLE … ADD COLUMN` is the only object-mutating lane shape with no
created-here precondition, and it takes an ACCESS EXCLUSIVE lock on the target —
heavier than the non-concurrent `CREATE INDEX` the lane refuses. That is
deliberate: `{crm,pim,dam}` are app-owned schemas (the §4.1 per-app extension
table pattern), so the lock's blast radius is the app that authored the change,
never a shared-schema consumer. A nullable additive column on an existing
app-owned table is the lane's core use case. A shared-schema `ADD COLUMN` never
matches the boundary-qualified shape and refuses.
