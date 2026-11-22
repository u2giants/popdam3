---
summary: OpenRouter calls default to Exacto routing, and structured output follows advertised capabilities, never model-name matching.
kind: decision
status: current
read-when: changing model routing, structured-output handling, or adding model-name special cases
---

# Exacto routing and capability-driven structured output

**Decided:** engineering decision recorded in `docs/MODEL_RULES.md` (Exacto routing as of July 2026).

**Decision:** every OpenRouter call is sent with the `:exacto` variant unless the slug carries an explicit variant. Structured output uses the account-filtered model catalog plus `AI_MODEL_CAPABILITY_OVERRIDES`: strict schema when advertised, then JSON object, then tool modes, each attempted once with one JSON repair. Do not add model-name matching code; record unpublished provider facts in the override setting. The bake-off is intentionally not pinned so it can observe natural routing. The `tag_asset` response ceiling stays at 4,000 tokens.

**Why:** Exacto fixes cross-provider tool-calling failures without fallback ladders. It is not safe for every model (it regressed `minimax/minimax-m3`), which is why a hard-pin override exists.

**Rejected:** per-model name guesses and premature structured-output failures (the active reliability plan replaces them).

## Source

- [docs/MODEL_RULES.md](../MODEL_RULES.md)
- [plan_ai_model_interaction_reliability.md](../../plan_ai_model_interaction_reliability.md)
