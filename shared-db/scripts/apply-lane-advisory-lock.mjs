#!/usr/bin/env node
// Apply-lane advisory lock (Step 6, issue #1366).
//
// GitHub fencing cannot reach inside the database. A lane recovered at the GitHub
// layer says nothing about whether the previous holder's SQL has finished, so this
// takes a Postgres advisory lock for the duration of an apply and FAILS CLOSED if
// somebody already holds it.
//
// READ THE LIMIT, IT IS NOT A FOOTNOTE. This prevents two LIVE applies overlapping
// on one target. It does NOT close the dying-backend window: a lock held on the
// applier's own connection is released the instant that connection dies, which is
// exactly when the race opens. That window is bounded by the 10-minute recovery
// grace in scripts/lib/exclusive-lease.mjs, not eliminated. Closing it properly
// needs a session-pinned applier around `supabase db push`; see
// docs/advisory-lock-registry.md and plan Step 6. Never describe this lock as more
// than it is.
//
// Key 620260823 is registered in docs/advisory-lock-registry.md. It is
// SESSION-scoped by explicit exception to that file's rule 2, because the lock must
// span an apply whose internal transactions this code does not control.

export const APPLY_LANE_LOCK_KEY = 620260823

export class ApplyLockError extends Error {}

/**
 * Take the lock. `client` is anything with `query(sql)` returning `{ rows }`, so
 * the caller owns the connection and its lifetime — which is the point: dropping
 * that connection is what releases the lock if the job dies.
 */
export async function acquireApplyLock(client, { target } = {}) {
  if (!client?.query) throw new ApplyLockError('acquireApplyLock needs a database client')
  if (!target) throw new ApplyLockError('acquireApplyLock needs the target it is protecting, so a refusal can name it')
  const result = await client.query(`SELECT pg_try_advisory_lock(${APPLY_LANE_LOCK_KEY}) AS acquired`)
  const acquired = result?.rows?.[0]?.acquired
  if (acquired !== true) {
    // FAIL CLOSED, and never as a silent no-op: advisory-lock registry rule 4.
    throw new ApplyLockError(
      `another apply already holds the apply lane lock (${APPLY_LANE_LOCK_KEY}) against ${target}. ` +
      'Refusing rather than running two applies at once. If no apply is running, a previous connection ' +
      'has not yet closed; wait rather than forcing it.',
    )
  }
  return { key: APPLY_LANE_LOCK_KEY, target }
}

/** Release explicitly. Dropping the connection also releases it; this is the tidy path. */
export async function releaseApplyLock(client) {
  if (!client?.query) throw new ApplyLockError('releaseApplyLock needs a database client')
  await client.query(`SELECT pg_advisory_unlock(${APPLY_LANE_LOCK_KEY})`)
}
