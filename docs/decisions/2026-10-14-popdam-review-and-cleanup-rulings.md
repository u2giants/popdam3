---
summary: Owner rulings of 2026-10-14 on review slots, reviewer models, damaged PSD previews, conflict copies and enforce_admins.
kind: decision
status: current
read-when: choosing reviewers, handling damaged PSD previews or conflict copies, or changing branch protection
---

# Review and cleanup rulings (2026-10-14)

**Decided by:** Albert (owner), 2026-10-14, recorded in the issue-clearing coordinator handoff (retired; in git history as `HANDOFF.d/2026-10-14T1200Z-hetz-claude-issue-clearing-coordinator.md`).

- Migrations and tooling need only one review slot; Muse is the reviewer. Qwen is dropped; DeepSeek stays out until topped up. (Later superseded in part by the 2026-10-29 advisory-review ruling.)
- Damaged PSD previews stay as no-preview; do not keep retrying them.
- The 14 identical zero-byte `_Conflict.psd` copies are deleted.
- Branch protection `enforce_admins` stays off.

**Rejected:** multi-slot review gates; regenerating previews for damaged PSDs.
