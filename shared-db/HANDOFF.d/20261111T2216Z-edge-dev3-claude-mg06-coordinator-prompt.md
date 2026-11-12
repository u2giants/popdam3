# Coordinator prompt — MG06 / AI licensor submissions (2026-11-11, 5:16 PM EST)

Paste the block below into a new session in `popcre/shared-db`.

---

You are the coordinator for POP Creations' "AI fills licensor submission forms" groundwork.
Read `AGENTS.md`, then these two files (on PR popcre/shared-db#6091 until merged):
`plan_mg06_licensor_site_path.md` and
`HANDOFF.d/20261111T2210Z-edge-dev3-claude-mg06-site-path-and-merchgroup-fix.md`.
Background in one paragraph: our item field MG06 (ColdLion merch group 06) is the licensed
Property. The AI must pick the matching option on each licensor's submission website
(Disney OPA first). MG06 keeps short display names. A backend record stores the exact site
path, e.g. MICKEY MOUSE → OPA "Mickey Mouse Family" > character "Mickey Mouse". The owner
(Albert, business owner, not a programmer) wants plain-English replies.

Start one nested session per task below. Brief each with the files named. Verify each
result yourself before reporting it done.

1. **Site-path store.** Execute `plan_mg06_licensor_site_path.md` steps 1–5 (table,
   function, tests, land through the normal shared-db pipeline). Step 6 (populate) waits
   for task 2's corrected list.
2. **Fix Jamielynn's spreadsheet.** Follow the handoff prompt in the HANDOFF.d file above.
   The first version (`~/Dropbox/ai/MG06 changes for AI submissions - for Jamielynn -
   2026-11-11.xlsx`) is wrong: BACK TO THE FUTURE got both "inactivate" and "add", RUGRATS
   was shown as active, and more. Deliver a new xlsx; the owner reviews it before it goes
   to Jamielynn. Then run plan step 6.
3. **Ilona email + missing Disney properties.** (a) After task 2, draft a short, specific
   email to Ilona (licensing) listing the decisions she must confirm. Each item says what
   she marked, the evidence (style counts since Jan 2025), and what we propose. Save it as
   a file; do not send it. (b) Find out why the scraped Disney OPA properties "Minnie",
   "Preschool CG Mickey (& Friends)" and "Standard Characters" never became
   `core.property` rows. The owner rule (`docs/owner-rulings.md`) says every scraped
   submission property must be created. They sit in `plm.opa_property` as
   resolution_status 'unresolved'. Find the step that should create them and why it
   stopped, then repair it (preserve the capability, don't bypass it).
4. **Three gaps in the auto-fill rules.** Using the owner's Chrome on edge-dev3 (already
   signed in to OPA; never enter credentials, never save or submit a form):
   (a) open each OPA "Create New Product" line Disney offers us (North America > Disney >
   Home > Standard/Range/Packaging/Line Sheet, and other lines/brands such as Lucas)
   and record how each one's property list differs;
   (b) find which Minnie program to pick for a Minnie-only design: check past submissions
   (`plm.licensor_submission_pdf`) and ask the owner only if the evidence is split;
   (c) record how the Style Guide field works and how the AI should choose it.
   Write the findings into `docs/` and add the needed rows to the plan.

Order: start 1, 2 and 4 together; start 3a after 2, and 3b any time. The owner asked for
the merch-group fix to happen in its own session because the earlier one got sloppy.
Report each finished task in one plain sentence, with the file or link.
