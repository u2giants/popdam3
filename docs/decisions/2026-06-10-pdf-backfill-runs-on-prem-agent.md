---
summary: PDF and .ai text backfill runs on the on-prem Windows agent (bridge agent as fallback), never in the cloud.
kind: decision
status: current
read-when: changing where PDF text extraction or its backfill runs
---

# PDF text backfill runs on the on-prem agent

**Decided:** routing set 2026-06-10.

**Decision:** the full-library PDF/.ai text backfill is processed by the Windows render agent on the office LAN, with the bridge agent as fallback. The settings button only flips `admin_config.PDF_BACKFILL.status`; the agent self-drives a claim loop.

**Why:** source `.ai`/`.pdf` files live only on the NAS, the cloud holds only thumbnails, and the OCR cascade should keep CPU off the Synology.

**Rejected:** cloud-side processing.

## Source

- [docs/idiosyncrasies.md, PDF text backfill runs on the Windows agent](../idiosyncrasies.md#pdf-text-backfill-runs-on-the-windows-agent-not-the-bridge-agent)
- private memory note project_pdf_backfill_processor (outside this repo)
