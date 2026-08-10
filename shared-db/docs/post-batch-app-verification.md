# Post-batch application verification — the runnable half of §7

**Issue:** [#711](https://github.com/u2giants/shared-db/issues/711) — owner ruling **D7**.
**Script:** `scripts/post_batch_app_verification.py`
**Tests:** `scripts/test_post_batch_app_verification.py` (105 tests, no network, no database).
**Contract it implements:** `docs/production-promotion-app-tolerance-contract.md`, §3, §5, §6, §7.

---

## 1. Why this exists

§7 of the tolerance contract is a manual checklist: a person with logins to three applications and
SSH to the PopCRM worker host, run **nine times**, once after every batch. §8/D7 asked who that
person is. Nobody was ever named, and **the checks were never run after batch B1 — which is already
applied to production**.

The owner ruled that an AI agent does these checks instead of a human. That ruling means nothing
unless the check is a **runnable artifact**. "An agent clicks around three apps" is not a check, it
is a hope. This is the artifact.

**It does not replace §7.1's five-minute smoke test.** It replaces the part of §7 that a database
can answer, which is most of it, and it says plainly which part it cannot answer (§6 below).

---

## 2. How to run it

After a batch lands, from a checkout of `main`, with a Supabase Management API PAT in the
environment:

```bash
export SUPABASE_ACCESS_TOKEN='<PAT from 1Password vault vibe_coding, item 3t2xoqk5luyz7ffgdhj24gvtpq, field credential>'

python scripts/post_batch_app_verification.py \
  --batch B8 \
  --project-ref qsllyeztdwjgirsysgai \
  --output-dir artifacts/post-batch
```

On PowerShell:

```powershell
$env:SUPABASE_ACCESS_TOKEN = '<PAT>'
$env:PYTHONIOENCODING = 'utf-8'
python scripts/post_batch_app_verification.py --batch B8 --project-ref qsllyeztdwjgirsysgai --output-dir artifacts\post-batch
```

Instead of `--batch` you may pass the exact versions that were applied, which is the safer form
because it makes the script check that you are actually at a legal resting point:

```bash
python scripts/post_batch_app_verification.py \
  --versions 20260809170000,20260809170100,20260809170200,20260809170300,20260809170400,20260809170500 \
  --project-ref qsllyeztdwjgirsysgai \
  --output-dir artifacts/post-batch
```

**The token is read from the environment, never from `argv`** — process arguments are visible in OS
process listings. Do not pass it as a flag; there is no flag for it.

### What you get

- **Exit code 0** — all three applications PASS.
- **Exit code 1** — at least one hard failure, printed to stderr, one line each.
- `artifacts/post-batch/post-batch-app-verification.md` — the human-readable report.
- `artifacts/post-batch/post-batch-app-verification.json` — the raw catalog evidence.

Keep the artifact. The job log gets scrolled past; the artifact is the evidence.

---

## 3. What it checks

For **PopPIM**, **PopDAM** and **PopCRM** — the three applications the contract §2.3 proves are
exposed to the shared production project — it asks the catalog, not the migration ledger:

| Check | Primitive | Why |
|---|---|---|
| The relation exists | `to_regclass` | "It applied successfully" proves nothing |
| It is the right kind | `pg_class.relkind` | A view where the app reads a table is a different bug, still a bug |
| The role can use it | `has_table_privilege` | A lost grant breaks an app with every object intact |
| The function exists | `pg_proc` overload count | An applied `create or replace` whose routine is not there is a catastrophe |
| The role can execute it | `has_function_privilege` | Same |
| Filter columns exist | `information_schema.columns` | A missing filter column is a 400 or a **silently empty result** |
| Embed FKs exist | `pg_constraint` | PostgREST resolves `.select('contact:contact_id(...)')` through the FK; drop it and the request 400s |
| Schemas are exposed | `pg_db_role_setting` | The apps reach the database THROUGH PostgREST |
| The clock agrees | `TimeZone` + a midday-UTC pin | This database runs `America/New_York` |
| Batch-specific facts | §7.2 | See below |

Plus the **batch-specific** assertions §7.2 names — one query each, and **cumulative**: a run for B<n>
re-checks every assertion from B0 through B<n>, because these are invariants about the state each
batch established, not one-shot "did the SQL run" checks. A later migration or a manual fix can
regress any of them, and §6's exposed states are defined by exactly these properties.

| Batch | Asserted automatically |
|---|---|
| **B0** | `plm.production_lane_canary` exists, holds **exactly one** row, has RLS on with **zero** policies |
| **B1** | `sync_coldlion_licensors_properties` is 3-arg; the 2-arg overload is **gone** from both `plm` and `public` |
| **B2** | The tree function still resolves at its exact 4-arg signature; its body reaches `plm."divisionCode"`; that table exists |
| **B3** | `plm.promote_coldlion_source_owned` exists and its body carries the **advisory lock** that distinguishes the eighth body from the earlier unsafe ones |
| **B4** | `core.licensor_alias` exists and `normalized_alias` is `GENERATED ALWAYS` |
| **B5** | The ack-authority function resolves from `current_user` and **not** `session_user`, and rejects a NULL effective role |
| **B6** | The 8-argument `trip_taxonomy_circuit_breaker` is gone from both schemas |
| **B7** | `api.opa_property_reconciliation` survived its drop-and-recreate and has a readable definition |
| **B8** | `core.product_size` holds **exactly 538 rows / 530 active / 8 inactive**, `core.product_depth` **exactly 121** — the constants the seed migrations assert against |
| **B9** | `api.dam_order_list` has `security_invoker=true` (#653); **all eight** Warner tables carry the `app.has_any_role` gate with a non-null qual; `service_role` holds no TRUNCATE on `plm.pmt_*`, and the 23 tables are actually present |

**Every batch also has a manual checklist** printed in the report, for what §7.2 requires that no
query can answer — most importantly **B3's ColdLion promotion dry pass**, because §7.2 states
incomplete provenance is *unrecoverable after the fact*. The report never says "there is nothing to
check"; where this tool has no automated check it says so and names what a human still owes.

It refuses to certify an illegal state: if the last version applied is on §6's never-rest list, or is
the retired `20260729120000`, or is one of the two §6.5-held versions, the run **fails** and tells you
to complete the batch rather than verify and wait.

### It also checks that you named the right batch

The batch identifier is a claim by the operator, and an agent that applies B9 and types `--batch B5`
would get B5's extras, skip every B9 security assertion, and see green. So the run reads
`supabase_migrations.schema_migrations` and **fails** if the claimed batch's resting point is missing,
or if a later batch has also landed.

**This is the only place the ledger is read**, and only for the one thing it is authoritative about —
*which migrations ran*. It is never treated as evidence of what they left behind.

It also asks whether any of the 53 §6 **never-rest** versions is applied, so it can spot a batch that
is **half applied**: resting point absent, interior versions present. That state is not a pause, it is
an exposure — between `20260810030000` and `20260810110000` it means the eight Warner tables are
readable by every authenticated account in the shared project.

> **Two traps worth knowing, both found by running this thing.**
>
> The batches are **not** applied in version order. B0 is the canary `20260810140000`, which sorts
> numerically *above* every version in B1–B8. A `max(version)` check therefore reports "you are at B0"
> on a database where B1 has landed — this tool did exactly that on its first live run. The check is
> presence-per-resting-point, not maximum.
>
> And presence-per-resting-point **alone** is still not enough. Claim B8 with B9 half applied: B8's
> resting point is present, B9's is absent, nothing is "ahead", green run — while production sits in a
> never-rest state. That is why the never-rest list is asked about directly.

---

## 4. Where the object list came from

Derived on 2026-08-10 from **fresh shallow clones of `origin/main`** of `poppim-web`, `popdam3` and
`popcrm-web` — not from the stale local checkouts, which contract §2.3 records as having produced
four confidently wrong answers. Every entry traces to a real `.rpc()`, `.schema().from()` or
realtime call site, and each carries its file and line in the `why` field.

Two things are **inferred, not observed**, and the script says so in its own docstring:

1. **Privileges** are the verbs the code needs, derived by scanning each `.from('x')` call site for
   the `.select` / `.insert` / `.update` / `.delete` that follows it. They are not a copy of
   production's grant matrix — if they were, the check could never detect a lost grant.
2. **Role attribution** is by file location: `src/` is `authenticated`, `workers/` and
   `apps/worker/` are `service_role`.

### The heuristic's failure direction — read this before trusting a green run

The privilege scan uses a **~260-character proximity window**, and **a miss produces a FALSE PASS**.
That is the dangerous direction.

It misses a write more than 260 characters from its `.from()` — a long chained builder, an interleaved
comment block, or the split form `const q = pim().from('x')` with `await q.delete()` fifty lines
later. It also misses any computed table name not hand-caught the way PopDAM's
`.schema('core').from(table)` was. When it misses, the privilege never enters the manifest, so this
tool never asserts it, so **a batch that revokes it goes green while the app 403s in front of a user**.

An over-match fails the other way: a privilege the app does not need is asserted, the run goes red, a
human investigates. Loud and self-correcting.

**The tuning history points the wrong way and you should know it.** The first draft assumed any table
an app touches is a table an app writes; that over-assumed and produced eighteen false failures on the
first live run. Correcting it moved the manifest toward **under**-detection — the right call for a
tool anyone will actually run, the wrong one for a safety net, and the trade was made knowingly.

So: treat a green run as *"no regression was detected in what the manifest knows about"*, never as
*"the applications are fine"*. When a batch touches grants on a schema an app uses, re-derive that
app's entries from a fresh `origin/main` clone instead of trusting this file.

---

## 5. Three findings the first live run produced

The first run against production (batch B1 applied, nothing since) exited 0 with all three
applications PASS — **the B1 check that D7 says should have happened and never did**. It also
surfaced three things worth their own tickets:

1. **PopPIM writes that cannot work.** `authenticated` holds **SELECT and nothing else** on
   `pim.checklist_item`, `pim.product_assignee`, `pim.product_sample`, `pim.product_submission` and
   `pim.revision_request`, while PopPIM's code inserts, updates and deletes against all five. Those
   writes 403 today. It predates every batch, so it is recorded as a **baseline gap** — reported in
   every run, never suppressed, and never counted as batch damage.
2. **PopDAM's size picker is already on its hardcoded fallback.** `core.product_size` does not exist
   yet; B8 creates it. `StylesPage.tsx` swallows the error and shows `COMMON_SIZE_OPTIONS`. This is
   exactly the silent failure §3.2 warns about, happening now, and nobody has noticed.
3. **Two contract claims did not reproduce** against today's `origin/main`: `core.product_material`
   has no reader at all (and **already exists on production** — it is not something B8 creates), and
   `dam_character_catalog` is read from `public`, not `api`. Filed as **#721**.
4. **PopDAM's worker calls a schema PostgREST does not expose.**
   `apps/worker/src/handlers/ai-tagging-shared.ts:269` does
   `.schema("dam").from("sku_human_description")`. The relation exists and `service_role` can read
   it, but `dam` is absent from `pgrst.db_schemas`, so that call path 404s today. Reported in every
   run as an exposure gap, not a missing object.

The PopPIM privilege gap is **#720**; the contract drift is **#721**. Neither is fixed in this PR.

---

## 6. What it does NOT cover — read this before trusting a green run

- **It does not open the applications.** A white page, a React render crash, a broken build or a
  wrong-looking picker is invisible to a catalog query. §7.1's five-minute smoke test still stands,
  and for PopPIM a blank screen is the *expected* symptom of a break.
- **It does not read the PopCRM worker journal.** Worker failures appear only in systemd, and the
  worker's `/health` is a hardcoded `{ok:true}` that would stay green through a total schema break.
- **It does not evaluate RLS semantics.** It reads catalog grants, not what a given end user can
  actually see through a policy.
- **It does not compare function bodies, argument names, argument defaults or return shapes.**
  PostgREST resolves overloads **by argument name**; a renamed argument makes a function unfindable
  while `pg_proc` still shows an overload, and this check would pass. Renames are the dominant
  failure mode in §3.4 — the reason batching is defensible at all is that there are none in the
  backlog, not that this script would catch one.
- **It does not exercise DesignFlow non-production**, the free rehearsal of §7.0.
- **It does not check performance.** A batch that is logically safe can still hold a lock long
  enough for a live app to time out (§9.4).
- **The manifest is a snapshot.** A deploy of any of the three applications invalidates it.

### DesignFlow PLM — explicitly out of scope, and why

Contract §2.1 proves DesignFlow **production runs on Cloud SQL and cannot connect to Supabase**: the
provider, port, SSL setting, network path and username shape are all forced, and the Supabase pooler
username form is rejected outright. It therefore imposes no constraint on any batch and is not
checked here.

Its **non-production** environments (develop, staging, sandbox) are contractually bound to the shared
Supabase pooler and receive every batch instantly with no redeploy. That is a genuine exposure and a
genuine free rehearsal — but exercising a running application is not something a catalog query can
do. It stays a human step (§7.0), and the report says so in every run.

---

## 7. Design rules a future edit must not relax

1. **Absence of evidence is never a pass.** An empty result, a NULL aggregate, a failed query, an
   empty manifest — every one of them is a failure. A guard that silently admits the call is worse
   than no guard, because it reads as safety.
2. **Every verdict goes through `is_explicit_true()`.** A pass requires a non-null value AND a
   positive match. Never write `if not is_false(...)`; that is the null-permissive bug this repo has
   already shipped once.
3. **Dates are pinned to midday UTC and asserted in both zones.** The server is `America/New_York`;
   a midnight-UTC timestamp reads back through `::date` as the previous day.
4. **`plm` is not exposed via PostgREST, and that is correct.** A check that expects it there fails
   for a configuration reason, not because an application is broken.
5. **There is no record-only mode.** §7 is the entire safety net; a safety net with a soft setting is
   a decoration. The one narrow exception — recorded baseline gaps — is documented at
   `BASELINE_GAP_POLICY` in the script and is exactly one privilege wide per entry.
6. **The non-default `User-Agent` is load-bearing.** Cloudflare answers HTTP 403 (error 1010) to
   `Python-urllib`, and the run then looks like an auth failure it is not.
7. **One query set per application, never one flattened query.** Three relations — `core.licensor`,
   `core.customer`, `core.contact_company` — appear in two applications each with different roles and
   privileges. Keying shared evidence by relation name lets one app's row overwrite another's, and
   the first version of this tool printed "all three applications PASS" on a database where PopPIM's
   collab pane and PopDAM's customer picker were both dead. Per-app queries make that structurally
   impossible. `CrossAppRelationCollisionTests` is the regression guard; do not merge the queries
   back together for speed.
8. **Two-zone date checks must actually use two zones.** `timestamptz::date` already converts through
   `TimeZone`, so `(ts at time zone 'UTC')::date` is the *server* date, not the UTC one. The UTC leg
   needs a second `at time zone 'UTC'`. The first version was a tautology that could never fire.
9. **Privileges come from `has_table_privilege`, never `information_schema.role_table_grants`.** The
   latter only reports grants involving currently-enabled roles, and from the Management API
   connection it returns nothing for `service_role` — so a `not exists` check on it passes forever.
