-- designflow-tracking#127 production editor proof (owner: "you do all the tests", 2026-11-25).
-- TEMPORARY: lets the live AI tester login (dflow user 74) edit the Licensing stage list so the
-- Stage Lists editor can be proven in production without staff passwords. A follow-up migration
-- removes 74 again. Data-only; idempotent; no-op where the list is absent.
UPDATE plm.stage_list
   SET maintainers = array_append(maintainers, 74)
 WHERE key = 'licensing'
   AND NOT (74 = ANY (maintainers));
