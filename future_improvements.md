# Future Improvements: PopDAM-Assisted File Safety

## Context

The design team works as one team across NYC, Bogota, and Sao Paulo while the primary Synology NAS sits in the NYC office. The current workflow relies heavily on Synology Drive Client and, in some cases, SMB over Tailscale. Both approaches have serious tradeoffs for large PSD, AI, TIFF, and related source files.

Synology Drive Client is convenient because users can save locally and let uploads happen in the background, but it introduces timing ambiguity. A designer can close a file locally while the updated bytes are still uploading from their machine to the NYC NAS. Another designer can then open what appears to be the same file from their own local cache before that update has propagated. This creates exactly the kind of conflict window that has caused file conflicts, stale versions, missing files, and mistaken reverts.

SMB over Tailscale avoids some local-cache ambiguity by working directly against the NYC NAS, but it is painfully slow for large design files. Designers must wait on remote saves instead of saving locally and moving on.

The recent Synology incident report in `u2giants/synology-monitor/docs/synology-incident-2026-06.md` shows that the problem is broader than simple simultaneous editing. The incidents include true file discrepancies, local permission and ownership problems, ShareSync or Drive instability, and multi-way save collisions. A PopDAM lock system can prevent a major class of workflow conflicts, but it will not repair Synology Drive corruption by itself.

## Existing PopDAM Foundation

PopDAM already has most of the right foundation for a safer workflow:

- `asset_checkouts` tracks active checkouts and check-ins.
- A unique partial index enforces one active checkout lifecycle per asset.
- `helper_tokens` generate short-lived `popdam://` URLs.
- `helper-api` coordinates checkout, prepare-checkin, complete-checkin, discard, heartbeat, and admin force-discard actions.
- POP DAM Helper is an Electron app that can copy files to a local workspace, watch them, snapshot them, and upload checked-in files back to Synology.
- The web UI already exposes checkout status through `CheckoutBar` and `useAssetCheckout`.

Because of this, PopDAM should not add a separate, parallel `file_locks` table unless there is a specific need to lock files that do not exist as PopDAM assets. The better path is to harden and extend the existing checkout system into the official editing workflow.

## Recommended Direction

PopDAM should become the controlled gateway for editing source files.

The safe workflow should be:

1. A designer clicks **Check Out & Open** in PopDAM.
2. Supabase atomically creates an active checkout for that asset.
3. POP DAM Helper downloads the current file from the NYC NAS through a controlled server-side path such as Synology File Station or WebDAV.
4. The Helper saves the file into a private local workspace.
5. The Helper opens the local workspace copy in Photoshop, Illustrator, or the relevant native app.
6. The designer edits and saves locally.
7. On check-in, the Helper waits until the file is stable, snapshots it, uploads to a temporary name on Synology, and then renames it into place.
8. PopDAM records the final hash, size, check-in user, check-in time, and unlocks the asset.

This gives designers the practical benefit of local editing and background upload while removing Synology Drive Client from the critical correctness path.

## What To Do

### 1. Harden `asset_checkouts` instead of creating `file_locks`

Add the missing fields and behaviors to `asset_checkouts`:

- `expires_at`
- `last_heartbeat_at`
- `office_location`
- `device_id`
- `machine_name`
- `helper_version`
- `source_modified_at`
- `source_quick_hash`
- `checkin_started_at`
- `checkin_completed_at`
- `failure_reason`

The active checkout row should be the lock. It should describe who has the file, where they are, what machine is holding it, and whether the Helper is still alive.

### 2. Keep the partial unique index as the database backstop

The database must enforce one active checkout lifecycle per asset. Frontend disabled buttons and application-level "check then insert" logic are helpful, but they are not correctness mechanisms.

The existing migration already creates this kind of partial unique index:

```sql
CREATE UNIQUE INDEX asset_checkouts_one_active_per_asset
  ON asset_checkouts(asset_id)
  WHERE status IN ('active', 'checkin_queued', 'uploading', 'verifying');
```

Keep the broader status set. An index that only covers `status = 'active'` would allow another checkout while the first user is checking in, uploading, or verifying. The file must remain locked until the check-in has either completed, failed into a recoverable state, conflicted, or been discarded.

If two users click checkout at the same instant, PostgreSQL should reject the second active lifecycle insert with a unique-constraint violation. The API should catch that error and return a clear `409 Conflict`.

### 3. Move lock acquisition into a PostgreSQL RPC

Create a database function such as `start_asset_checkout(...)` or `acquire_asset_checkout(...)` that performs the lock check and checkout insert atomically.

The function should rely on `auth.uid()` for the user identity instead of accepting a caller-supplied `user_id`. A `security definer` RPC that trusts a user-provided UUID would be dangerous because a client could attempt to acquire locks as another user.

The unique partial index on `asset_checkouts(asset_id)` for active statuses should remain the final line of defense against races.

### 4. Stop opening source files from local Synology Drive cache

The current Helper can resolve a local mapped path and copy from that path into the workspace. That preserves a dangerous failure mode: the local mapped path may be stale.

For checkout, the Helper should fetch the source file from the NAS through Synology File Station or WebDAV at checkout time. The file used for editing must be the NAS current version, not the user's local Drive cache.

Local Drive mappings can still be useful for browsing or diagnostics, but they should not be trusted as the source of truth for checkout.

### 5. Verify source version before check-in overwrite

Before overwriting the NAS file, the Helper or `helper-api` should verify that the source file on the NAS still matches the `source_hash`, `source_size`, or source version captured at checkout.

If the NAS file changed underneath the checkout, the check-in should stop and enter a `conflict` state rather than overwriting.

This protects against direct NAS edits, admin interventions, sync repairs, and any non-PopDAM write that happened while the checkout was active.

### 6. Make check-in atomic on the NAS

The Helper must never upload directly over the production file. If a network connection drops at 85% of a PSD upload, the production file would be corrupted or unusable.

The Helper should upload into a temporary NAS location first, such as `.popdam_tmp/<checkout_id>/<filename>`, or a temporary filename in a dedicated hidden temp directory on the same Synology volume. After the NAS-side upload reports complete and the expected size/hash is verified where possible, the Helper should use the native Synology File Station move/rename operation to replace the production file.

On BTRFS, an intra-volume rename or move is atomic and effectively instantaneous. This only holds when the temp file and production file are on the same volume/share boundary where Synology can perform a rename rather than a copy.

The check-in sequence should be:

1. Wait for local file stability.
2. Snapshot the local workspace file.
3. Hash the snapshot.
4. Upload the snapshot to a hidden temporary directory or temporary filename on the same NAS volume.
5. Verify the uploaded file's size and, if feasible, hash.
6. Confirm the original NAS file still matches the checkout source version.
7. Move or rename the uploaded temp file over the production file atomically.
8. Mark checkout complete.
9. Trigger or request a PopDAM rescan/metadata refresh for that asset.

### 7. Add stale checkout recovery, not casual auto-unlock

Design files can stay open for hours. A simple 30-minute expiration would create new data-loss risk.

Expired or stale checkouts should be treated as a recovery state:

- Show that the Helper heartbeat is stale.
- Allow the original user to resume, check in, or discard.
- Allow admins to force-discard with a clear warning.
- Preserve audit history of who forced the unlock and why.

Automatic unlock should be used very cautiously, if at all.

### 8. Add Realtime for lock visibility

Supabase Realtime is useful for user experience. The UI should update quickly when someone checks out or checks in a file.

Realtime should not be responsible for correctness. Correctness belongs to PostgreSQL constraints and RPCs. Realtime is only the fast notification layer.

### 9. Expand the UI beyond a small lock badge

The UI should make the workflow obvious:

- Show who has the file checked out.
- Show office location and machine name.
- Show checkout age and last Helper heartbeat.
- Show whether the file is being uploaded or verified.
- Disable checkout for locked files.
- Provide admin force-unlock only where appropriate.
- Show a clear recovery state for stale Helper sessions.

### 10. Reduce direct write access over time

PopDAM cannot fully enforce file safety if designers can keep opening and saving the same source files directly through Synology Drive or SMB.

The long-term goal should be:

- Normal designers edit through PopDAM Helper.
- Project directories are read-only for normal designer SMB/Drive accounts.
- Direct NAS write access is limited to admins, emergency repair, or exceptional workflows.
- The PopDAM system or service account is the only routine writer to controlled project source directories.
- Shared folders remain browseable where needed, but source-file overwrite paths are controlled.

This is an operational change as much as a technical one.

Use Synology Permission Inspector during rollout to verify the effective permissions on project directories. If designers can still save directly into the sync folder, they will eventually bypass PopDAM, even with good training. The operating system should enforce the workflow by blocking direct writes for normal users.

## What Not To Do

### Do not build a separate `file_locks` system first

A separate `file_locks` table would duplicate `asset_checkouts` and risk two sources of truth. The system already has checkout semantics, statuses, tokens, a Helper app, and a uniqueness constraint. Improve that.

Only add a separate table if PopDAM must lock files that are outside the `assets` table.

### Do not trust Synology Drive local cache for checkout correctness

Checking a Supabase lock and then opening a stale local file still causes stale-version edits. The lock answers "who is allowed to edit"; it does not answer "which bytes did they open?"

The checkout source must come from the NAS current version.

### Do not rely on frontend checks to prevent races

The UI can warn and disable buttons, but two users can still click at nearly the same time or bypass the UI. Race prevention must live in PostgreSQL through an atomic function and the existing unique partial index.

Do not weaken the unique partial index to only `status = 'active'`. The lock must remain active during `checkin_queued`, `uploading`, and `verifying` too.

### Do not pass `user_id` from the client into a privileged lock function

Use `auth.uid()` inside the database function or verify the caller server-side. Client-supplied user identity is not trustworthy.

### Do not unlock automatically just because a timer expired

An expired lock might mean the designer's laptop slept, the Helper crashed, the internet dropped, or the designer is still actively editing a huge file offline. Auto-unlock can allow a second person to overwrite work that still exists locally.

Stale locks need recovery UX, not silent release.

### Do not treat SMB-over-Tailscale as the normal fix

Direct SMB access reduces sync ambiguity but makes large-file editing slow and frustrating. It also does not provide workflow-level locking, check-in audit, or atomic transfer state.

SMB should remain an emergency or special-case path, not the primary cross-city editing workflow.

### Do not preserve direct write permissions indefinitely

Training alone will not hold once people are under deadline pressure. If direct writes remain possible through Synology Drive or SMB, users will eventually bypass the checkout system. Permission changes are part of the product design, not merely an IT cleanup task.

### Do not assume PopDAM can fix existing Synology corruption retroactively

PopDAM can prevent future workflow conflicts if all edits go through it. It cannot automatically repair prior ShareSync/Drive corruption, permission drift, missing files, or divergent folder trees without dedicated reconciliation tooling.

## Why This Approach Fits PopDAM

PopDAM is already the system that knows:

- The canonical asset path.
- The current indexed file hash and size.
- The current user.
- The source file's style group and metadata.
- The Helper device state.
- The audit trail for checkouts and check-ins.

Synology Drive Client is a file sync tool. It does not understand licensing deadlines, project ownership, style groups, who is supposed to edit next, or whether a local copy is stale relative to another office.

PopDAM can provide that missing workflow layer.

The goal is not to make the NAS smarter. The goal is to stop asking the NAS sync layer to make workflow decisions it was never designed to make.

## Suggested Implementation Phases

### Phase 1: Safety hardening

- Add missing checkout fields.
- Add atomic checkout RPC.
- Preserve or migrate the partial unique index that covers `active`, `checkin_queued`, `uploading`, and `verifying`.
- Add source-version verification before check-in overwrite.
- Improve stale checkout states.
- Add admin force-unlock audit fields.

### Phase 2: Helper transfer correctness

- Change checkout source download to use NAS File Station/WebDAV, not local Drive cache.
- Keep private workspace editing.
- Keep snapshot-before-upload.
- Upload to a hidden temporary NAS directory or temp filename on the same volume.
- Verify uploaded temp file before rename where possible.
- Replace the production file through native Synology move/rename, not direct overwrite upload.
- Improve upload progress and failure recovery.

### Phase 3: UI and Realtime

- Add Realtime subscription for active checkout changes.
- Improve lock display in library cards, detail panels, and folders.
- Show office, machine, age, heartbeat, and transfer status.
- Add clear conflict and stale-session messages.

### Phase 4: Operational rollout

- Pilot with a small cross-city group.
- Train users to use **Check Out & Open** instead of direct Drive editing.
- Monitor conflicts and stale locks.
- Use Synology Permission Inspector to verify effective permissions.
- Make controlled project folders read-only for normal designer SMB/Drive accounts.
- Leave routine write permission only with the PopDAM system account and tightly scoped admin accounts.

### Phase 5: Reconciliation and incident support

- Build reports for files modified outside PopDAM checkouts.
- Detect files whose NAS hash changed while no checkout was active.
- Surface suspected Synology Drive conflicts or unexpected reverts.
- Add admin tools for comparing PopDAM indexed state to NAS current state.

## Bottom Line

An explicit lock-state machine is the right idea, but the lock alone is not enough. The real fix is a controlled checkout/check-in system where PopDAM owns the edit lifecycle and the Helper owns reliable file transfer.

Use Supabase PostgreSQL for atomic state, Supabase Realtime for visibility, and POP DAM Helper for fresh download, local editing, queued upload, atomic check-in, and recovery. That combination addresses the real cross-city timing problem without forcing designers to save giant files directly over a slow remote SMB connection.
