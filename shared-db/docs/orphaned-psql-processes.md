# Orphaned `psql` processes — what was actually wrong, and how to diagnose it (#550, backlog B12)

**Re-counted live on `al8960ofc`, 2026-08-11.** Issue #550 recorded a count discrepancy — one
document said **four** orphaned processes, a later report said **six** — and instructed the next
person not to believe either figure without re-counting.

## The re-count: **ZERO**

```
tasklist | grep -iE "psql|wsl|postgres"     -> no matches
wsl.exe -l -v                               -> no distributions installed
```

There are **no orphaned `psql` processes on this machine today**, and there is **no WSL
installation on it at all**. Whether Albert ran the `Stop-Process` commands he was given in July
is still unverified and now unanswerable — but it no longer matters, because the count is zero
either way.

## The bigger correction: there is no WSL `psql` wrapper in this repository

The issue is titled "the WSL `psql` wrapper leaks orphaned processes". **No such wrapper exists in
`shared-db`.** The only committed code that runs `psql` is `runSql` in
`tools/coldlion-sync-common.mjs`, and it spawns `psql` **natively** through `spawnSync` — no WSL,
no shell, no wrapper script.

So the July orphans were almost certainly **ad-hoc commands typed by a session**, not a defect in
committed tooling. That matters, because "fix the wrapper" was never going to work: there was
nothing to fix.

## Two of the three requested fixes were already in place

The issue asked for a timeout, guaranteed cleanup of temporary SQL and password files, and a
documented diagnostic recipe.

| Asked for | State when checked |
|---|---|
| Cleanup of the temporary SQL file | ✅ **Already guaranteed.** The temp directory is removed in a `finally` block (`rmSync(dir, { recursive: true, force: true })`), so it goes even when the query throws. |
| Cleanup of the password file | ✅ **Moot — no password file is ever written.** The connection URL is passed in `argv`. There is nothing on disk to leak. |
| An explicit timeout | ❌ **Genuinely missing. Now fixed.** |

## What was fixed (#550)

`SPAWN_TIMEOUT_MS` (90 minutes) is now applied, with `killSignal: "SIGKILL"`, to **both** child
processes `runSql` spawns — the `psql` branch and the `supabase db query` branch.

**Why 90 minutes and not something aggressive.** A real ClickUp importer run took **52 minutes**
the same day the orphans were found. A ceiling at or below that kills legitimate work, which is
strictly worse than the leak it prevents. 90 minutes can only fire on something genuinely wedged.
**Do not lower it to "fail fast".**

**Why both branches.** Every asymmetry between those two spawn paths has so far become a defect —
the `maxBuffer` fix (PR #362) landed on one branch only and left the 1 MiB `ENOBUFS` cliff fully
intact on the other. Two tests now assert the timeout and the kill signal are present at **both**
sites and come from **one constant**, so they cannot drift apart again.

A timeout arrives as `error.code === 'ETIMEDOUT'` with `status` null, which
`clientSpawnFaultError` already classifies as a **client-side tooling fault** — so a hung child is
never recorded as a durable database failure and can never trip the circuit breaker.

---

## The diagnostic recipe — how to tell a wedged process from a working one

This is the part the issue really wanted written down. **A stuck process is indistinguishable at a
glance from a legitimate long-running one.** Do not kill on age alone. Ask the database.

### Step 1 — is anything actually running, and for how long?

**Read-only.** Run against the target project.

```sql
select pid,
       state,
       now() - query_start as running_for,
       now() - state_change as idle_for,
       wait_event_type,
       wait_event,
       left(query, 120) as query
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
order by query_start;
```

Read it like this:

- **`state = 'active'` with a moving `wait_event`** — it is working. Leave it. This is what the
  52-minute importer run looks like.
- **`state = 'idle in transaction'` for a long `idle_for`** — this is the dangerous one. It holds
  locks while doing nothing, and it is what an abandoned session leaves behind.
- **`state = 'active'` with `wait_event_type = 'Lock'`** — it is not stuck, it is *blocked*. Go to
  step 2; killing this one fixes nothing, because the thing in front of it is the problem.

### Step 2 — if it is waiting on a lock, find what is in front of it

**Read-only.**

```sql
select blocked.pid          as blocked_pid,
       left(blocked.query, 80)  as blocked_query,
       blocking.pid         as blocking_pid,
       blocking.state       as blocking_state,
       now() - blocking.state_change as blocking_idle_for,
       left(blocking.query, 80) as blocking_query
from pg_stat_activity blocked
join lateral unnest(pg_blocking_pids(blocked.pid)) as b(pid) on true
join pg_stat_activity blocking on blocking.pid = b.pid
where cardinality(pg_blocking_pids(blocked.pid)) > 0;
```

**The blocker is the one to deal with, never the victim.**

### Step 3 — the local process side

```powershell
# Windows
Get-CimInstance Win32_Process -Filter "Name='psql.exe'" |
  Select-Object ProcessId, CreationDate, CommandLine
```

```bash
# Linux / WSL
ps -eo pid,lstart,etime,cmd | grep -E '[p]sql'
```

Cross-reference the start time against step 1. A local `psql` with **no matching active backend**
in `pg_stat_activity` is an orphan: its server side is already gone and it is waiting on nothing.
**That is the only case where killing on sight is clearly right.**

### Step 4 — terminating, if it comes to that

Prefer the **local** process. Killing the client releases the server side cleanly.

```powershell
Stop-Process -Id <pid>          # Windows, from step 3
```

Only reach for the server side when the backend itself is the problem, and try the gentle one
first:

```sql
select pg_cancel_backend(<pid>);      -- cancels the query, keeps the connection
select pg_terminate_backend(<pid>);   -- drops the connection. Last resort.
```

> ⚠️ **`pg_terminate_backend` on production is a production write action.** It is not covered by
> read-only inspection. Do not run it against `qsllyeztdwjgirsysgai` on your own judgement — ask
> Albert, and name the exact pid and the exact query you intend to kill.
