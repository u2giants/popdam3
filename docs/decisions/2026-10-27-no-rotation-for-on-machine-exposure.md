---
summary: A credential exposed only on this computer is redacted where it appeared, never rotated (owner ruling 2026-10-27).
kind: decision
status: current
read-when: a secret appeared in a local transcript or output and rotation is being considered
---

# Redact on-machine exposure; do not rotate

**Decided by:** Albert, owner ruling, 2026-10-27, quoted in the cancelled plan:

> "if the keys were not published outside of this computer then no need to rotate, just redact them from where they appeared."

**Decision:** rotation of the leaked Supabase `sb_secret` key was cancelled. The exposure was confined to the local session transcript on hetz; all occurrences were redacted in place the same day. A value published off this computer is still treated as compromised and rotated.

**Why:** exposure confined to this computer is not a compromise.

**Rejected:** executing the rotation plan (v7). It is kept as reference for the next real rotation. The ruling is also recorded in `ai-devops docs/owner-rulings.md`.

## Source

- [plan_credential_rotation_20261027.md](../../plan_credential_rotation_20261027.md)
