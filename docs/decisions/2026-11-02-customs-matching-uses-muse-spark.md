---
summary: Customs PO-to-HTS line description matching uses Muse Spark 1.3 Contributor, chosen by Albert for cost (2026-11-02).
kind: decision
status: current
read-when: changing the model or method for customs PO item to HTS description matching
---

# Customs matching uses Muse Spark 1.3 Contributor

**Decided by:** Albert, 2026-11-02.

**Decision:** use `meta/muse-spark-1.3-contributor` for customs PO item to HTS line description matching. Treat Muse blanks as unmatched; never fill them by guessing. Leave ScaleDown out of this step.

**Why:** about 5.6x cheaper than Gemini 3.8 Flash on the 31-line known-answer test. Muse: 21 right, 0 wrong, 10 blank, $0.0053. Gemini: 28 right, 0 wrong, 3 blank, $0.0297.

**Rejected:** Gemini 3.8 Flash (more matches, much higher cost); ScaleDown (lowered matching accuracy in testing).

## Source

- private memory note feedback_customs_matching_model (outside this repo)
