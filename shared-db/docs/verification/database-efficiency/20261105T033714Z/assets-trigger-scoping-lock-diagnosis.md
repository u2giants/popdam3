# Issue #5609 production lock diagnosis

The first two automatic production attempts (`41966565466` and `41971024212`) refused at the first trigger drop after the intended five-second lock timeout. The migration remained absent. No production writer or maintenance worker was canceled, no timeout raised, no merged migration changed, and no manual production apply performed.

## Isolated lock-mode proof

Two PostgreSQL 17.6 sessions in the task-owned synthetic container held a reader, writer, or maintenance-equivalent table lock while requesting the exact trigger DDL class. The holding session queried `pg_locks` to observe the second session's granted/waiting lock. A local-only 1.5-second timeout bounded each deliberate collision. Each test rolled back and the original trigger remained present.

| Holder | DROP TRIGGER requests | CREATE OR REPLACE TRIGGER requests | Result |
|---|---|---|---|
| AccessShare reader | AccessExclusive | ShareRowExclusive | DROP waits; replacement succeeds |
| RowExclusive writer | AccessExclusive | ShareRowExclusive | Both wait |
| ShareUpdateExclusive maintenance | AccessExclusive | ShareRowExclusive | Both wait |

Replacing rather than dropping a trigger would reduce reader blocking; it **does not** resolve the observed maintenance/writer conflict. The coordinator therefore rejected a new replacement/retirement migration for this incident. The original immutable migration and all capabilities are preserved. A future DDL-method improvement can use this evidence without misrepresenting it as the present repair.

```json
{
  "server": "PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit",
  "cases": [
    {
      "holder": "reader",
      "ddl": "DROP",
      "ddl_backend": 19252,
      "locks": [
        {
          "pid": 19251,
          "mode": "AccessShareLock",
          "granted": true
        },
        {
          "pid": 19252,
          "mode": "AccessExclusiveLock",
          "granted": false
        },
        {
          "pid": 19252,
          "mode": "AccessShareLock",
          "granted": true
        }
      ],
      "outcome": "lock_timeout",
      "elapsed_ms": 1517.83,
      "error": "ERROR:  canceling statement due to lock timeout"
    },
    {
      "holder": "reader",
      "ddl": "CREATE OR REPLACE",
      "ddl_backend": 19265,
      "locks": [
        {
          "pid": 19265,
          "mode": "ShareRowExclusiveLock",
          "granted": true
        },
        {
          "pid": 19266,
          "mode": "AccessShareLock",
          "granted": true
        }
      ],
      "outcome": "succeeded",
      "elapsed_ms": 204.82,
      "error": ""
    },
    {
      "holder": "writer",
      "ddl": "DROP",
      "ddl_backend": 19280,
      "locks": [
        {
          "pid": 19279,
          "mode": "RowExclusiveLock",
          "granted": true
        },
        {
          "pid": 19280,
          "mode": "AccessExclusiveLock",
          "granted": false
        },
        {
          "pid": 19280,
          "mode": "AccessShareLock",
          "granted": true
        }
      ],
      "outcome": "lock_timeout",
      "elapsed_ms": 1517.31,
      "error": "ERROR:  canceling statement due to lock timeout"
    },
    {
      "holder": "writer",
      "ddl": "CREATE OR REPLACE",
      "ddl_backend": 19301,
      "locks": [
        {
          "pid": 19300,
          "mode": "RowExclusiveLock",
          "granted": true
        },
        {
          "pid": 19301,
          "mode": "ShareRowExclusiveLock",
          "granted": false
        }
      ],
      "outcome": "lock_timeout",
      "elapsed_ms": 1517.59,
      "error": "ERROR:  canceling statement due to lock timeout"
    },
    {
      "holder": "maintenance",
      "ddl": "DROP",
      "ddl_backend": 19321,
      "locks": [
        {
          "pid": 19321,
          "mode": "AccessExclusiveLock",
          "granted": false
        },
        {
          "pid": 19321,
          "mode": "AccessShareLock",
          "granted": true
        },
        {
          "pid": 19322,
          "mode": "ShareUpdateExclusiveLock",
          "granted": true
        }
      ],
      "outcome": "lock_timeout",
      "elapsed_ms": 1517.7,
      "error": "ERROR:  canceling statement due to lock timeout"
    },
    {
      "holder": "maintenance",
      "ddl": "CREATE OR REPLACE",
      "ddl_backend": 19343,
      "locks": [
        {
          "pid": 19342,
          "mode": "ShareUpdateExclusiveLock",
          "granted": true
        },
        {
          "pid": 19343,
          "mode": "ShareRowExclusiveLock",
          "granted": false
        }
      ],
      "outcome": "lock_timeout",
      "elapsed_ms": 1522.24,
      "error": "ERROR:  canceling statement due to lock timeout"
    }
  ],
  "original_trigger_present": "1"
}
```

## Live read-only diagnosis

At November 5, 2026, 12:05:26 AM EST, production held a `ShareUpdateExclusiveLock` on assets for an I/O-active transaction, plus normal asset writers/readers. Only query IDs/fingerprints/ages were exported, not SQL text or licensed values. At 12:06:39 AM EST the maintenance holder was positively identified as an autovacuum worker, approximately 298 seconds old, in `vacuuming indexes`; all 259,072 heap blocks had been scanned.

At 12:08:28 AM EST its explicit progress was 15 of 46 indexes processed, with 31 remaining; heap vacuuming had not yet begun. The worker was performing DataFileWrite I/O. Index sizes/work differ, so these counters do not support a trustworthy completion estimate. A retry should follow meaningful maintenance completion and a fresh normal target/lease/promotion qualification, preserving active scanners and the five-second bound. No new scheduler or manual promotion route was introduced.

Read-only progress query (prove the current production target immediately before execution):

```sql
select now() as observed_at,to_jsonb(v)-'datid'-'datname'-'relid' as vacuum_progress,
 (select count(*) from pg_index where indrelid='public.assets'::regclass) as index_inventory_count,
 extract(epoch from now()-a.xact_start) as transaction_age_seconds,
 a.wait_event_type,a.wait_event
from pg_stat_progress_vacuum v join pg_stat_activity a on a.pid=v.pid
where v.relid='public.assets'::regclass;
```

## Exact isolated reproducer

The container/database below belong only to this synthetic test. Do not point this reproducer at production, shared preview, or another session's local stack.

```python
import subprocess,json,time,selectors
from pathlib import Path
args=['docker','exec','-i','shared-db-5609-test','psql','-X','-qAt','-U','supabase_admin','-d','asset_scoping','-v','ON_ERROR_STOP=1']
def once(sql):return subprocess.run(args,input=sql,text=True,capture_output=True,check=True).stdout.strip()
setup="""create schema if not exists diag5609;
create table if not exists diag5609.t(id integer primary key,v integer);
insert into diag5609.t values(1,0) on conflict do nothing;
create or replace function diag5609.f() returns trigger language plpgsql as $$begin return new;end$$;
drop trigger if exists trg_probe on diag5609.t;
create trigger trg_probe after update on diag5609.t for each row execute function diag5609.f();
"""
once(setup)
def send(p,s):p.stdin.write(s+'\n');p.stdin.flush()
def line(p,timeout=5):
 sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ)
 if not sel.select(timeout):raise RuntimeError('psql response timeout')
 s=p.stdout.readline().strip();sel.close();return s
results=[]
for holder,hold_sql in [('reader','lock table diag5609.t in access share mode;'),('writer','update diag5609.t set v=v where id=1;'),('maintenance','lock table diag5609.t in share update exclusive mode;')]:
 for action,ddl in [('DROP','drop trigger trg_probe on diag5609.t;'),('CREATE OR REPLACE','create or replace trigger trg_probe after update on diag5609.t for each row execute function diag5609.f();')]:
  a=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  b=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   send(a,'begin; '+hold_sql+" select 'ready:'||pg_backend_pid();")
   apid=int(line(a).split(':')[1])
   send(b,"begin; select 'pid:'||pg_backend_pid();")
   bpid=int(line(b).split(':')[1])
   started=time.monotonic();send(b,"set local lock_timeout='1500ms'; "+ddl+" select 'ddl_succeeded';")
   time.sleep(.2)
   send(a,"select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from(select pid,mode,granted from pg_locks where relation='diag5609.t'::regclass and pid in("+str(apid)+','+str(bpid)+") order by pid,mode)s;")
   locks=json.loads(line(a));blocked=any(x['pid']==bpid and not x['granted']for x in locks)
   if blocked:
    b.wait(timeout=4);err=b.stderr.read().strip();outcome='lock_timeout' if 'lock timeout'in err else 'unexpected_failure'
   else:
    msg=line(b);outcome='succeeded'if msg=='ddl_succeeded'else msg
    send(b,'rollback;\n\\q');b.wait(timeout=4);err=b.stderr.read().strip()
   results.append({'holder':holder,'ddl':action,'ddl_backend':bpid,'locks':locks,'outcome':outcome,'elapsed_ms':round((time.monotonic()-started)*1000,2),'error':err})
  finally:
   if a.poll()is None:send(a,'rollback;\n\\q');a.wait(timeout=4)
   if b.poll()is None:b.stdin.close();b.wait(timeout=4)
print(json.dumps({'server':once('select version();'),'cases':results,'original_trigger_present':once("select count(*) from pg_trigger where tgrelid='diag5609.t'::regclass and tgname='trg_probe';")},indent=2))
Path('/tmp/5609-trigger-lock-modes.json').write_text(json.dumps({'cases':results},indent=2)+'\n')
```
