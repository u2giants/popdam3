

## Diagnosis: Confirmed and Root Cause Identified

Your diagnosis is correct. Here is the full picture:

1. **The `agent_registrations` table has a UNIQUE constraint on `agent_key_hash` but NOT on `agent_name`** (confirmed by querying the database constraints directly).

2. **The upsert calls in `handleGenerateAgentKey` and `handleRegister` use `onConflict: "agent_name"`**, which requires a unique index on that column to work as an upsert. Without it, PostgreSQL silently falls back to a plain INSERT, creating duplicate rows.

3. **The `handlePair` function (line 1613) still uses `.insert()` instead of `.upsert()`**, which means pairing a new agent with the same name also creates duplicates.

4. **Current state**: The database currently has no duplicates (1 bridge agent, 1 windows agent), but every time you generate a new key or re-register, it creates a new row with a different `agent_key_hash`. The old row's hash no longer matches, causing 401s.

**Good news**: Since there are currently no duplicate rows, the migration is safe to apply immediately.

---

## Plan

### Step 1: Database Migration

Create a migration that:

1. **Deduplicates safely** — handles NULL `last_heartbeat` and tied timestamps by using `created_at` as a tiebreaker, keeping only the newest row per `agent_name`:

```sql
-- Remove duplicates, keeping the row with the latest heartbeat (ties broken by created_at)
DELETE FROM public.agent_registrations a
USING public.agent_registrations b
WHERE a.agent_name = b.agent_name
  AND a.id != b.id
  AND (
    a.last_heartbeat IS NULL AND b.last_heartbeat IS NOT NULL
    OR (a.last_heartbeat IS NOT NULL AND b.last_heartbeat IS NOT NULL AND a.last_heartbeat < b.last_heartbeat)
    OR (a.last_heartbeat = b.last_heartbeat AND a.created_at < b.created_at)
    OR (a.last_heartbeat IS NULL AND b.last_heartbeat IS NULL AND a.created_at < b.created_at)
  );

-- Add unique constraint on agent_name
ALTER TABLE public.agent_registrations
ADD CONSTRAINT agent_registrations_agent_name_key UNIQUE (agent_name);
```

### Step 2: Fix `handlePair` in `agent-api/index.ts`

The pairing handler (line 1613) still uses `.insert()` instead of `.upsert()`. If an agent with the same name is re-paired, it will fail with a unique constraint violation (which is actually good — it prevents accidental overwrites). But to be consistent with the key rotation pattern, change it to upsert:

```typescript
// Line 1613-1622: Change .insert() to .upsert()
const { data: agentData, error: regError } = await db
  .from("agent_registrations")
  .upsert(
    {
      agent_name: finalName,
      agent_type: pairing.agent_type,
      agent_key_hash: hashHex,
      last_heartbeat: new Date().toISOString(),
    },
    { onConflict: "agent_name", ignoreDuplicates: false },
  )
  .select("id")
  .single();
```

### After Migration

Once the constraint is in place:
- Generate a fresh agent key from Settings → Agents
- Update the Bridge Agent's `.env` / `agent-config.json` with the new key (or re-pair using a pairing code)
- The scan will authenticate successfully on every heartbeat and progress report

