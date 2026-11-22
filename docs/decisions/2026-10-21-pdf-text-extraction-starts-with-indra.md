---
summary: Every PDF text-extraction path starts with Indra; ScaleDown Summarize is selectable; agents run latest images and check Indra at startup.
kind: decision
status: current
read-when: changing PDF text extraction, the bridge or Windows agent startup, or issue 453
---

# PDF text extraction starts with Indra (2026-10-20/21)

**Decided by:** Albert (owner), 2026-10-20/21, recorded in the Indra lock-hardening handoff (retired; in git history as `HANDOFF.d/2026-10-21T1150Z-edge-dev-mimo-453-indra-lock-hardening.md`).

- Every PDF text-extraction path starts with Indra.
- ScaleDown Summarize is a selectable option for PDF Text Extraction.
- The bridge agent runs the latest image; the Windows agent checks for Indra at startup.
- Issue #453 was parked, then closed.

**Rejected:** extraction paths that bypass Indra.
