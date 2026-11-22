---
summary: High-volume LLM batches with a repeated prompt prefix use the provider's direct API, not OpenRouter; rich-PDF extraction uses DeepSeek direct.
kind: decision
status: current
read-when: routing a repeated-prefix LLM batch, or changing the rich-pdf-extract model path
---

# Cacheable batches use the direct provider API

**Decided by:** Albert, with the rule recorded 2026-07-15. His words: "is there repeated submissions that can be cached to save money? if so we never want to use OpenRouter for that."

**Decision:** the `rich-pdf-extract` operation calls DeepSeek directly (`apps/worker/src/deepseek.ts`). For any future cacheable, high-volume batch, check for a repeated prefix first; if present, use the direct provider API with the stable instructions and schema first and the variable content last.

**Why:** about 19k calls share an identical prefix, and DeepSeek automatic prefix caching bills hits at roughly one tenth. OpenRouter adds a margin, does not reliably pass caching through, and account guardrails have blocked models mid-task.

**Rejected:** routing this batch through OpenRouter.

## Source

- [docs/idiosyncrasies.md, Rich-PDF extraction uses DeepSeek direct](../idiosyncrasies.md#rich-pdf-extraction-uses-deepseeks-direct-api-not-openrouter-2026-07-15)
- [docs/MODEL_RULES.md, Rich PDF Extraction](../MODEL_RULES.md)
- private memory note feedback_caching_direct_api (outside this repo)
