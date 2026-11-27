# Close-nested handoff — PopDAM AI tagging tree

## Tree closed
- Coordinator session "tagging throughput" (edge-dev, worktree kind-moore-f64164). Wrapped up; all its PRs merged.
- Child "Fix GLM missing tag name in AI tagging". Wrapped up, and its branches are deleted. Its worktree is ecstatic-mcnulty-6c87fa.

## Landed (verified merged)
- #1395: worker pool.
- #1397: missing-tag fix.
- #1400: Straitly share.
- #1404: throughput handoff.
- #1405, #1407, #1411 (48 at once), #1415 (kill switch fires only on a burst), #1420, #1440, #1442.
- The worker is at sha bd2c5b6, tagging about 45 files a minute at 6:40 PM EST on 2026-11-26.

## Open tasks
### 1. Finish the whole-library tagging run
- The run is BULK_OPERATIONS `ai-tag-parallel`, run_id `untagged-20261125`.
- Next action: check its status, tagged rate and failure rate. Restart it only with the recipe in the child's handoff.
- Done when the status is completed and the final numbers are reported to Albert in EST.
- Track it on PR https://github.com/u2giants/popdam3/pull/1440, starting fresh from main.

### 2. Backup-model question (Albert's business decision; do not change anything without it)
- Albert ruled the tagging model is GLM 5.3 Flash.
- The live config has `AI_TASK_MODELS.vision_tagging_fallback = openai/gpt-6-luna`.
- The tagging code then falls back to `meta-direct/muse-spark-1.3-contributor`.
- So files whose GLM calls fail twice are tagged by other models.
- Next action: ask Albert whether the fallback should stay or be GLM-only. Then apply the change through a branch and a PR.

### 3. Tag PopSG files (after task 1, or in parallel if Albert wants)
- Albert starts this with the PopSG prompt he was already given.
- Done when PopSG files are tagged and proven live over 15 minutes. Start fresh from main.

## Child handoffs
- https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-27T0015Z-edge-dev-claude-popdam-tagging-run-monitor.md
- https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-26T0403Z-edge-dev-claude-tagging-throughput.md. Its bottleneck is largely resolved: about 45 a minute, up from 14.
