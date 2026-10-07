---
issue: 3947
status: OPEN
owner: mimo/3947-scraped-dedupe
---

# Issue #3947 — remaining obligations tracker

This tracker records obligations that remain open after the code delivery in
PR #3957. Retire this file only when issue #3947 is fully complete.

## Remaining obligations

- [ ] Two exact-head governed reviews (APPROVE) on the final PR head after
      Lucasfilm/Disney display dedupe lands. Prior verdicts on earlier heads
      do not transfer.
- [ ] Governed preview, guarded merge, and automatic production promotion of
      the migration version reserved by claim #3955.
- [ ] Authenticated production live proof of all three display patterns:
      1. Warner: no natural_key_fallback row whose label has a source_id twin
         in the same namespace.
      2. Sesame: exactly one row per value_key preferring field_generation
         current.
      3. Lucasfilm/Disney: no Lucasfilm display row whose exact source_id has
         a Disney dcp_property twin; unique Lucasfilm identities preserved;
         all saved matching decisions (DCP resolution/member associations,
         conflicts, exclusions) and source captures preserved.
- [ ] Application-owned live artifact (u2giants/popdam3
      `shared-db-live-proof-3947-<application_sha>`) validating the live
      assertion. The existing app workflow allow-list and service-role
      producer cannot execute this authenticated-only reader; design a
      legitimate least-privileged read-only producer.
- [ ] Tick the issue checkboxes and publish the supported final outcome.

## Constraints

- Prerequisite #3897 (migration 20261002193034) is applied in production.
  Do not redo it.
- Claim #3955 holds the exclusive object lock on
  `function api.db_data_admin_scraped_source_inventory`.
- Preserve all matching decisions and source data. Character and
  style_guide arms stay unchanged. Security posture (security definer,
  search_path pin, licensing-gate-first, grants) stays unchanged.
- Do not infer or change canonical licensor ownership from display
  deduplication.
- Do not close issue #3947 until every obligation above is done.

Posted by MiMo chat unknown on edge-dev
