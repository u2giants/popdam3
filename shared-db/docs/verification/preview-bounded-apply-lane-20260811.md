# Preview bounded apply lane — build and static proof (2026-08-11)

Issue #739. Author: sub-agent of orchestrator session d152a272.
File changed: `.github/workflows/shared-supabase-migrations.yml` and nothing else.

**No database was written, read or linked by the agent that built this.** Every
result below comes from running the guard's own functions offline, against a
MODELLED preview ledger, on this machine. The lane has never been dispatched.

## 1. The problem this fixes

Preview (`rjyboqwcdzcocqgmsyel`) was missing exactly four migrations:

| version | file | workstream |
| --- | --- | --- |
| 20260810140000 | `production_lane_canary.sql` | production lane canary |
| 20260810180000 | `plm_default_privilege_hole_and_pg17_maintain_revokes.sql` | security (#649/#664) |
| 20260810190000 | `dcp_vault_source_landing.sql` | DCP Vault |
| 20260810190100 | `dcp_vault_chunked_loader.sql` | DCP Vault |

`20260810140000` sorts BELOW preview's ledger head (`20260810170000`, already
applied there), so a bare `supabase db push` refuses the whole queue with
"Found local migration files to be inserted before the last migration on remote
database" and exits 1. The old preview job ran exactly that bare push, so the
lane could apply **nothing at all**.

The only escape was `--include-all`, which applies all four at once — three
unrelated workstreams, including a security migration, in one unreviewed sweep.
One agent worked around it by temporarily moving other people's migration files
out of its worktree. That worked, and it is not a lane.

## 2. What was built

The preview job now mirrors the PRODUCTION lane's mechanism rather than
inventing a second one. It reuses `scripts/production_migration_guard.py`
unchanged (`preflight`, `prepare`, `assert-bounded`, `verify-dry-run`), pointed
at **preview's own ledger** via `--remote-ledger`. That script is
target-agnostic in everything that matters: it takes a repo, an allowlist and a
ledger file, and prunes a detached checkout to exactly `remote-ledger |
allowlist`. The bound that makes `--include-all` safe is the FILESYSTEM, not the
flag — identical to production.

New dispatch input: `preview_allowlist` (comma-separated 14-digit versions).
**Required for BOTH modes.** The old dry-run reported on the whole pending
queue, which no subsequent apply would have matched; an honest rehearsal has to
rehearse the bounded set.

Step order: assert project ref → checkout → resolve SHA → capture ledger before
→ announce apply/skip lists → preflight → build bounded checkout → bounded
dry-run **or** bounded apply → capture ledger after → print row delta → upload
evidence.

### Preview and production have diverged in BOTH directions

Verified by object on 2026-08-11: preview holds all 23 `plm.pmt_*` tables and
production holds zero, while `20260810140000` is applied on production and not
on preview. Nothing in this job assumes preview is "production minus N". It
reads preview's ledger every run and judges the allowlist against that alone.

## 3. Proof

### 3.1 YAML parses; job shape is right

`yaml.safe_load` succeeds. Jobs unchanged in count and name. Inputs are
`target, mode, production_allowlist, preview_allowlist, commit_sha,
confirmation` — `preview_allowlist` added, nothing renamed or removed. The
preview job carries no `environment:` key (unchanged; preview is the safe
target, and per #646 a gate that fires on harmless events trains the approver to
click through).

### 3.2 Guard behaviour against a modelled preview ledger

Ledger modelled as: all 429 local migration versions **minus** the four missing
ones = 425 rows. Ran `preflight()` directly:

```
PASS  all four named                 -> PREFLIGHT OK: 4 migrations
PASS  only the DCP Vault pair        -> PREFLIGHT OK: 2 migrations
PASS  only the canary                -> PREFLIGHT OK: 1 migrations
BLOCK empty allowlist                -> allowlist is empty
BLOCK nonexistent version            -> unknown migration version: 29990101000000
BLOCK already applied (20260810170000) -> already applied
BLOCK out of order                   -> allowlist must be in migration order
BLOCK not 14 digits                  -> every entry must be an exact 14-digit version
```

That covers every refusal the issue asked for: empty, not on disk, already in
the preview ledger.

### 3.3 Bounded checkout and dry-run verification

```
prepare(...)        -> bounded checkout built at the resolved SHA
assert_bounded(...) -> BOUNDED OK: 429 migration files on disk, all within
                       remote-ledger | allowlist (4 allowlisted)
verify_dry_run(exact 4)      -> OK
verify_dry_run(4 + 1 extra)  -> BLOCKED: dry run did not exactly match
```

The last line is the requirement "fail if the resolved set differs from what was
named". The count is 429 only because the MODELLED ledger covers every local
file; against the real preview ledger `prepare` deletes everything outside
`remote | allowlist`.

### 3.4 The two inline Python blocks were executed, not just read

Extracted from the YAML and run with the step's real environment.

Announce step, allowlist = the DCP Vault pair:

```
### WILL APPLY (2 named)
- 20260810190000 20260810190000_dcp_vault_source_landing.sql
- 20260810190100 20260810190100_dcp_vault_chunked_loader.sql

### WILL SKIP (2 pending but not named)
- 20260810140000 20260810140000_production_lane_canary.sql
- 20260810180000 20260810180000_plm_default_privilege_hole_and_pg17_maintain_revokes.sql
```

Delta step, with a simulated "after" ledger:

```
- rows before: 425
- rows after:  427
- added: 20260810190000, 20260810190100
- removed: (none)
```

Delta step with a missing ledger file prints `NOT AVAILABLE` and exits 0, so an
early failure cannot mask itself as a red step of its own.

## 4. Things a reader will otherwise get wrong

- **The guard's failure text says "production".** `scripts/` is shared and this
  change does not own it, so "already applied on production" is emitted on the
  preview lane too. It means ALREADY APPLIED ON PREVIEW — `--remote-ledger` is
  preview's ledger. The check is correct; only the wording is inherited. A
  comment in the workflow says so at the point of failure.
- **Production's policy rules now bind preview too.** `parse_allowlist` carries
  `HARD_BLOCKED`, the AGENTS.md 6.8 ColdLion bundle rule, the 6.5 FR hold and
  the #660 security co-presence rules. Reusing the guard means preview inherits
  all of them. This is deliberate: preview is the rehearsal for production, and
  a rehearsal allowed to assemble a set production would refuse is not a
  rehearsal. None of the four currently-missing versions is affected by any of
  those rules.
- **`--include-all` is present in the preview job, twice, on purpose.** It is
  safe only because `prepare` already pruned the filesystem, and `assert-bounded`
  re-proves that after `supabase link` and immediately before the push. Never
  add the flag to a `db push` that runs in `$GITHUB_WORKSPACE`.
- **The advisory model-review step was NOT copied.** It reports "NOT RUN —
  ANTHROPIC_API_KEY is not configured on this repository" and is
  `continue-on-error`, i.e. a permanent silent no-op. This change does not touch
  it and does not reproduce it. Do not add it here.

## 5. Not done, on purpose

The lane has not been run. No migration was applied to preview by this change.
The operator decides when it runs and on which versions.
