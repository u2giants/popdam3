# GLM review — pr608-blocker2-neutralize-vs-gate

| field | value |
|---|---|
| model | zai-coding-plan/glm-5.2 |
| opencode | 1.18.12 (pinned) |
| session | pr608-blocker2-neutralize-vs-gate |
| session id | `ses_01828d89fffeSB8nFZ29W3Cr8k` |
| repository | C:/repos/shared-db/.claude/worktrees/agent-a4f89e731556e6bed |
| branch | worktree-agent-a4f89e731556e6bed |
| caller | claude |
| requested | 2026-08-09T18:45:38Z |
| tokens | `{"input":4283,"output":721,"reasoning":3334,"cache":{"read":34112,"write":0}}` |

---

## Answer

**1. Yes — rule 4 covers preview.**

Rule 4's word is "anywhere," and that word was chosen deliberately. Preview is a live database with its own `supabase_migrations.schema_migrations` ledger; version `20260729120000` is recorded there as applied. The rationale attached to the rule — "that is how two sessions silently clobber each other" — is exactly the preview case: any later session that reads the on-disk file to learn "what does preview actually have for the lockdown trigger?" must get the truth, or two sessions diverge silently. §6.3 confirms the reading: applied migrations are not edited because "editing changes nothing in the database and desynchronises file from ledger." That holds for preview's ledger as much as production's. Reviewer A's last sentence is wrong on the facts (it ran on preview), and wrong on the rule regardless: "not production" is not "not applied."

**2. Refuse at the gate. Do not neutralize the body.**

Neutralizing the file is the wrong control, for two reasons. First, it manufactures the precise file/ledger desynchronization that rule 4 and §6.3 exist to prevent — and yes, it matters: the preview ledger row `20260729120000` would point at on-disk text that did not run, so the next session auditing preview's security posture reads a lie. That is a silent corruption of the audit record, paid for nothing. Second, the threat neutralizing claims to address — "an unguarded full-tree push executes the harmful body" — is an operation §5.1 already bans outright (`--include-all` on the full repo set). A control that only helps when someone is already violating a harder rule is weak cover, and it costs a real desync. Gate refusal is both lighter and stronger: the guard already encodes the reason (it sorts below the applied `20260729180000`, so the broad body never re-runs to repair), and it leaves the audit trail intact.

**3. The correct forward-only control is a new superseding migration, timestamped above `20260729180000`, that re-establishes the broad lockdown (procedure coverage, `revoke ... on routine`).**

This is the expand/contract, forward-only answer rule 4 mandates: new file, no edit. It converts the failure from "only one code path refuses the harmful body" into "the harmful body is inert on every path." On the sanctioned bounded promote, only the new file runs and production keeps the broad body without `20260729120000` ever touching it. On a disaster-recovery full replay, `20260729120000` (narrow) runs, then `20260729180000` (broad) runs, then the new file (broad) wins — net correct, transient narrow state unobservable. On an unsanctioned `--include-all` push, the new file still sorts last and overrides. Keep the `HARD_BLOCKED` entry too — that is the gate defense; the superseding migration is the path-independent defense. Defense in depth, with zero desync. Reviewer A identified a real gap ("one code path"); its remedy was wrong. Reviewer B was right to refuse the edit but incomplete: refusing is necessary, not sufficient — the forward migration is what closes the gap.
