---
summary: The legacy ai-tag edge function was deleted and must not be recreated; batch tagging belongs in the Railway worker.
kind: decision
status: current
read-when: tempted to add an edge function for batch tagging
---

# Legacy ai-tag edge function stays removed

**Decided:** 2026-07-14, recorded in `docs/MODEL_RULES.md`.

**Decision:** `supabase/functions/ai-tag/` was deleted from source and from the Supabase project. Do not recreate it. Batch tagging is the Railway worker (OpenRouter `:batch` models, or the direct Gemini Batch route).

**Why:** it was a direct-Gemini batch path with no remaining callers. Its old claim that it backed PDF text extraction was wrong.

**Rejected:** keeping or reviving it.

## Source

- [docs/MODEL_RULES.md, Legacy ai-tag Edge Function (REMOVED 2026-07-14)](../MODEL_RULES.md)
