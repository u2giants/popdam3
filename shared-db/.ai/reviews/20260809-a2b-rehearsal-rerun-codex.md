# Codex debate — the partial-promotion problem (A2b, 2026-08-09)

Transport: `codex-cli` MCP, thread `019fe7e3-a22e-7830-a32a-b523c98ab80c`.
`model_reasoning_effort` passed **explicitly as `medium`**, per the standing rule.
⚠️ The MCP returns only the assistant message, so the CLI run header (`reasoning effort: …`)
could **not** be read back to confirm. Explicit-pass is what is asserted; nothing more.
`gpt-5.6-codex` was refused by the account ("not supported when using Codex with a ChatGPT
account"), so the account default model was used.

Framing was adversarial by construction: Codex was told to **attack** Grok's mitigation, not
ratify it, and each round was capped for length after a previous large brief in this session
timed out. Two rounds, both returned.

---

## Round 1 — the brief

Facts supplied inline: production ref, 361 ledger rows / head `20260802194100` / 411 files /
50 missing / 47 promotable, the retirement and the two §6.5 holds, 30-of-47 below the head, the
bounded-checkout policy, the passing preflight, and today's dry-run failure text. Then the core
risk (per-file transactions, failure at file 45 of 47 → partial promotion, no undo), Grok's
five-point mitigation, and three questions: (A) is a throwaway clone necessary; (B) the concrete
2am resume procedure; (C) the weakest link neither Grok nor I named.

## Round 1 — Codex's answer, in brief

- **Opening position:** "The plan is not safe enough to approve. A rehearsal lowers risk, but it
  cannot make a 47-file, non-atomic production push recoverable."
- **(A)** A clone is **not** necessary. A consistent `pg_dump` restored to a disposable database
  is cheaper and proves the 47 run against today's data, that the assertions and seeded inserts
  pass, and that the ordering works. It cannot prove platform parity (PG version, extensions,
  roles, grants, settings, Supabase-managed features) if restored locally, cannot prove external
  sources return the same data at apply time, cannot prove data has not drifted, and **cannot
  prove any intermediate state is safe for the five applications.**
- **Unprompted attack on Grok's point 3:** "The proposed restore point is also being oversold.
  Point-in-time recovery is disaster recovery … It is not a clean rollback button."
- **(B)** A 13-step resume procedure and a 7-item must-not list (reproduced in
  `docs/verification/production-rehearsal-rerun-20260809.md` §4.6).
- **(C) weakest link:** "There is no declared safe intermediate-state contract for the five
  applications. … Without that, 'resume-safe' only describes the ledger, not production."

## Round 2 — the three challenges put back to it

1. **Your step 8 and Grok's point 4 rest on an unverified premise.** "Each file is transactional,
   therefore the ledger is trustworthy" is an assumption. A file may carry its own `commit`, or
   `create index concurrently`, or `alter type … add value`, or the connection may drop between
   the file's commit and the ledger insert. Any of those makes the ledger wrong and destroys
   step 6 — the most important step in your own procedure. Concede, or give the mechanism.
2. **Grok's sub-batching is actively harmful and you half-said so.** One push = one short partial
   window. Five sub-batches = five sanctioned resting points in a half-promoted state, hours or
   days apart, watched by five live apps. Will you say it should be **rejected** unless each
   boundary is proven app-compatible **first**?
3. **The dump is only faithful if it restores `supabase_migrations.schema_migrations` with all
   361 rows** — otherwise the ledger is empty, `db push` attempts all 411, and the rehearsal
   tests something else while appearing to pass. Right? What else must be preserved?

## Round 2 — Codex conceded all three

> "Yes. I concede all three points. The ledger is not authoritative until atomicity is proven,
> sub-batching is unsafe without prior app-compatibility proof, and a faithful rehearsal needs
> both schema and data plus the exact ledger."

1. **Atomicity.** "'Each file is transactional' does not prove that the migration SQL and ledger
   update share one transaction." Proof must come from reading the pinned CLI's source **and** a
   destructive canary on a disposable DB covering explicit `COMMIT`, `CREATE INDEX CONCURRENTLY`,
   other non-transactional statements, failure after successful DDL+DML, and connection loss
   between execution and ledger recording. Until then the applied set cannot be computed from a
   ledger diff and needs a per-file **effect manifest**. Its own corollary, volunteered: "If some
   data changes have no reliable postcondition, safe automated resume is impossible."
2. **Sub-batching.** "Reject sub-batching unless every proposed stopping boundary is proven
   compatible with all five deployed applications before production work begins. That proof is a
   precondition, not a follow-up task. … A single continuous push is safer than several pauses if
   the intermediate states have not been tested. Dependency boundaries and owner boundaries do not
   prove application safety."
3. **Faithful rehearsal.** "Correct. The restored database must contain the exact 361 production
   ledger rows. Otherwise `db push` tests a different migration history." Plus: object definitions,
   grants and ownership, extensions **and versions**, sequence/identity state, roles or faithful
   substitutes, settings and `search_path`, publications and large objects, the `auth`/`storage`
   objects the files reference, frozen external seed inputs, and the exact pruned checkout and CLI
   version. Closing: "cheaper evidence, not equivalent evidence."

## Verification against the code — required, because reviewers here have been confidently wrong

- **Codex's atomicity concession is correct, and this repo shares the flaw.**
  `docs/production-migration-lane-design-20260802.md` §3.3 asserts Supabase "applies each
  migration in its own transaction and records the ledger row on success", and §8 repeats it.
  Grep finds **no test, no CLI source reading, and no version pin** behind either sentence. The
  repo states the assumption as a property. **Verified as unevidenced.**
- **Codex's "30 out-of-order files" input was checked, not assumed.** 50 missing − 17 above head
  = 33 below; − 1 retired − 2 held = 30, and run `31330329244` listed exactly 30. The predecessor
  document's "31" is off by one.
- **The §6.5 co-presence rule was exercised, not read.** The 49-entry allowlist is refused with
  the §6.5 message; the 47 passes preflight. Both run live.
- **Nothing Codex said was taken on trust about the migration files themselves.** The one
  potential dependency break it could not see — `20260807030000` referencing both held objects —
  was read by hand and is `to_regclass`-guarded with a `raise notice` fallback.

## Net

| Claim | Origin | Outcome |
|---|---|---|
| Throwaway clone is necessary | Grok | **Rejected** by both; dump-restore is enough, if exact |
| PITR restore point = rollback | Grok | **Rejected** by Codex, endorsed by me; it is disaster recovery |
| Sub-batch on dependency/owner boundaries | Grok | **Downgraded** to conditional; boundary proof is a precondition |
| Ledger trustworthy on resume | Grok, and this repo | **Unproven assumption** — new work item |
| Never `repair --status reverted` | Grok | **Upheld**, and strengthened by the item above |
| No app intermediate-state contract | Codex | **Accepted as the weakest link** — nobody had named it |
| Rehearse on a temp Supabase project, not local PG | me | **Not converged** — Codex leaves it open, I hold the stronger line |
