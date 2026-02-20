\# MODEL \& EXECUTION RULES



\## 1. Primary Model

\- \*\*ALWAYS\*\* use \*\*GPT-5.2\*\* for all architectural decisions, database migrations, and complex logic.

\- Do NOT use Gemini Flash for backend or connectivity tasks.



\## 2. Chain of Thought (CoT)

\- Before implementing any change, summarize your understanding of the current state.

\- If a task involves more than 3 steps, output a PLAN first and wait for approval.



\## 3. Stability Guardrails

\- \*\*No Fix-on-Fix:\*\* If a bug persists after two attempts, STOP. Re-read SCHEMA.md and PATH\_UTILS.md before trying again.

\- \*\*Fail-Fast:\*\* Never return a success message if a file scan returns 0 results. Treat 0 results as a potential permission or path error.



\# EXECUTION RULES (Anti-Amnesia + Anti-Chaos)



This file exists to prevent “looping,” config drift, and fragile fix-on-fix behavior.



These rules apply to any AI builder working on this repo.



---



\## 1) Read Order (Every Session)

Before implementing changes:

1\) Read PROJECT\_BIBLE.md

2\) Read the relevant doc(s): SCHEMA.md, PATH\_UTILS.md, API\_CONTRACTS.md, DEPLOYMENT.md

3\) State which Non-Negotiables apply to the task



---



\## 2) Change Discipline (Stability)

\- One change per iteration.

\- Prefer small diffs over refactors.

\- If a task touches DB schema or API shapes, update the matching docs in the same commit.



After each change:

\- Show a diff summary (what files changed and why)

\- Confirm:

&nbsp; - no hardcoded host/share strings

&nbsp; - no client-side filtering of large asset lists

&nbsp; - timestamps come from filesystem (agent-supplied)

&nbsp; - pagination remains server-side



---



\## 3) “No Fix-on-Fix” Rule

If the same bug persists after two attempts:

\- STOP

\- Re-read PROJECT\_BIBLE.md + PATH\_UTILS.md + SCHEMA.md

\- Propose a different approach (or reduce scope)



---



\## 4) Fail-Fast Rule (Scanner)

If a scan reports:

\- `files\_checked = 0`

treat as an error unless roots were explicitly validated and truly contain zero files.



Never silently report success on a scan that processed nothing.



---



\## 5) Truthfulness Rule

Do not claim things were tested unless the tool actually ran them.

If tests exist, run them; otherwise say “not executed” explicitly.

