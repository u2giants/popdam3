-- =====================================================================================
-- COMMENT CORRECTIONS (and two small contract improvements) from the re-review of PR #497.
--
-- Migration:  20260807200000_opa_comment_corrections.sql
-- Corrects:   20260807190000_opa_security_and_view_corrections.sql
-- Build note: docs/verification/opa-source-of-truth-20260807/BUILD-NOTE-20260807.md
--
-- Depends on (exact 14-digit versions):
--   20260807170000  opa_property_character_landing
--   20260807170100  opa_property_character_importer
--   20260807180000  opa_sync_reentrancy_fix
--   20260807190000  opa_security_and_view_corrections   -- the comments corrected here
--
-- FORWARD-ONLY. 20260807190000 is applied to preview, so its comments cannot be edited
-- in place: editing an applied migration desynchronises the file from the ledger while
-- changing nothing in any database. Comments are database objects, so they are simply
-- re-issued here and the later COMMENT ON wins.
--
-- WHY A WHOLE MIGRATION FOR COMMENTS. A wrong comment is what produced the HIGH finding
-- in the previous round: 20260807170000 claimed its RLS posture matched
-- plm.erp_property while writing `using (true)`, and the claim is what stopped anyone
-- looking. Both corrections below are the same failure one severity down -- a comment
-- that overstates a guarantee. That is worth a version to kill.
--
-- THREE CORRECTIONS
-- -----------------
-- 1. The table comment said "vendor and viewer are excluded" ABSOLUTELY. They are
--    excluded BY ROLE, but app.has_app_access('plm') is an INDEPENDENT allow path in
--    the policy, so a profile holding the vendor role AND PLM app access DOES read the
--    mirror. The predicate is correct and unchanged; only the description was wrong.
--
-- 2. The view comment promised suppressed name arrays "come back EMPTY". They came back
--    **NULL**: `array_agg(...) filter (...)` over zero matching rows returns NULL, not
--    '{}'. A consumer testing `= '{}'` would have misread RLS suppression as "no data".
--    Rather than document the NULL, the view now genuinely returns an empty array via
--    coalesce -- the promise the comment already made -- and the arrays get a stable
--    ORDER BY so two identical queries cannot return different element orders.
--
-- 3. min(captured_at) was undocumented. min(property_name) carried a justification;
--    this did not. After a PARTIAL refresh a node can hold mixed capture dates and the
--    view silently reports the OLDEST. Now stated in the comment.
--
-- No policy, table, constraint, index, grant or function is changed. The view keeps the
-- same column names, types and order, so `create or replace view` suffices and existing
-- grants are preserved. Still resolves nothing, still deletes nothing.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. The table comment: state the restriction ACCURATELY.
-- -------------------------------------------------------------------------------------
comment on table plm.opa_property_character is
  'RAW Disney OPA (opa.disney.com) property->character picker extract. '
  'READ IS RESTRICTED (migration 20260807190000) to principals satisfying ANY ONE of: '
  'the administrator role, PLM app access (app.has_app_access(''plm'')), or the sales '
  'or licensing roles -- matching plm.erp_licensor / plm.erp_property. It is NOT '
  'readable by every authenticated account. NOTE (corrected in 20260807200000): the '
  'vendor and viewer ROLES do not grant read on their own, but PLM APP ACCESS IS AN '
  'INDEPENDENT ALLOW PATH, so a profile holding the vendor or viewer role TOGETHER WITH '
  'PLM app access CAN read this table. Do not describe the restriction as "vendor and '
  'viewer are excluded" -- that overstates it, and an overstated comment is exactly what '
  'let the original wide-open policy survive review. '
  'SCOPE WARNING: Home line of business ONLY (lobName=Option.Lob.Home), and '
  'ONLY the properties POP Creations'' licensee account is entitled to see. '
  'This is NOT all of Disney and NOT all lines of business. Point-in-time '
  'snapshot, no change feed; refresh is a full manual re-extract requiring '
  'Albert to complete MFA in his own browser. AUTHORITY (owner ruling '
  '2026-08-07): authoritative for what it ASSERTS, SILENT about what it OMITS. '
  'Presence adds and corrects; ABSENCE NEVER REMOVES. Disney''s strings are '
  'stored verbatim; interpretation belongs in api.opa_property_character. '
  'Business-confidential Disney data under a commercial licensing relationship '
  '- do not publish, do not send to any third-party service, and NEVER commit a '
  'row of it to this PUBLIC repository. Rows are loaded at runtime by '
  'plm.sync_opa_property_character, never by a seed.';

-- -------------------------------------------------------------------------------------
-- 2. The reconciliation view: make the arrays genuinely empty and deterministically
--    ordered, so the comment's promise is true rather than merely documented.
--
--    Column names, types and order are UNCHANGED, so create or replace view is valid
--    and grants are preserved.
-- -------------------------------------------------------------------------------------
create or replace view api.opa_property_reconciliation
with (security_invoker = true) as
select
  o.licensed_property_id,

  -- Constant within a licensed_property_id in every extract seen so far, but NOT
  -- enforced by any constraint, so it is aggregated rather than grouped on. Grouping
  -- on it is what split nodes into multiple rows before 20260807190000.
  min(o.property_name)                                   as opa_property_name,

  count(*)                                               as opa_character_count,
  count(*) filter (where o.resolution_status = 'unresolved')
                                                         as unresolved_character_count,

  -- A node CAN legitimately resolve to more than one core.property while work is in
  -- progress. Reported as a set, not collapsed to one value that would be a guess.
  -- coalesce + ORDER BY (20260807200000): an EMPTY array, never NULL, and a stable
  -- element order so two identical queries cannot disagree.
  count(distinct o.property_id)                          as matched_core_property_count,
  coalesce(
    array_agg(distinct o.property_id order by o.property_id)
      filter (where o.property_id is not null),
    '{}'::uuid[])                                        as matched_core_property_ids,
  coalesce(
    array_agg(distinct p.name order by p.name) filter (where p.name is not null),
    '{}'::text[])                                        as core_property_names,
  coalesce(
    array_agg(distinct l.code order by l.code) filter (where l.code is not null),
    '{}'::text[])                                        as core_licensor_codes,

  -- 'mixed' when a node disagrees with itself. Before 20260807190000 this disagreement
  -- silently became extra rows with the character count divided between them.
  case
    when count(distinct o.resolution_status) = 1 then min(o.resolution_status)
    else 'mixed'
  end                                                    as resolution_status,
  max(o.resolved_at)                                     as last_resolved_at,

  -- min(), not "the" capture date: see the comment below. A partial refresh can leave
  -- one node holding rows from two different snapshots.
  min(o.captured_at)                                     as captured_at,
  min(o.line_of_business)                                as line_of_business,
  min(o.entitlement_scope)                               as entitlement_scope
from plm.opa_property_character o
left join core.property p on p.id = o.property_id
left join core.licensor l on l.id = p.licensor_id
group by o.licensed_property_id;

comment on view api.opa_property_reconciliation is
  'EXACTLY one row per Disney OPA property node (grouped on licensed_property_id '
  'alone) with its reconciliation state against core.property. Corrected by migration '
  '20260807190000: the original grouped on the PER-ROW resolution columns, so a '
  'partially resolved node returned several rows with its character count divided '
  'between them. Per-row resolution_reason and resolved_by were dropped as meaningless '
  'at node grain; resolution_status reports ''mixed'' when a node disagrees with itself. '
  'ARRAYS (corrected in 20260807200000): matched_core_property_ids, core_property_names '
  'and core_licensor_codes are ALWAYS non-null -- an EMPTY array means no match, and '
  'element order is stable. The earlier comment promised "empty" while the view actually '
  'returned NULL, so a consumer testing = ''{}'' would have misread the result. '
  'CAPTURED_AT IS min() (documented in 20260807200000): a refresh REPLACES rather than '
  'merges, but after a PARTIAL or interrupted refresh one node can hold rows from two '
  'snapshots, and this column then reports the OLDEST of them. It is the conservative '
  'answer, not necessarily "the" capture date; check plm.opa_property_character '
  'directly if a node''s freshness matters. '
  'CAVEAT ON THE LEFT JOINS: core.property and core.licensor carry their own RLS '
  '(shared_read, gated on app.has_any_role of administrator/sales/licensing/designer/'
  'viewer/vendor). A principal that reads this view via app.has_app_access(''plm'') but '
  'holds NO app_role passes the mirror''s policy and FAILS core.property''s, so '
  'core_property_names and core_licensor_codes come back EMPTY (''{}'') rather than '
  'raising. An empty name array beside a NON-EMPTY matched_core_property_ids means RLS '
  'suppression, NOT an unresolved node -- the ids come from the mirror row and survive, '
  'while the joined names do not. '
  'EXPECT A LOW MATCH RATE generally and do not treat it as an error: core.property '
  'mirrors ColdLion (what POP produces or holds a code for) while OPA carries Disney''s '
  'licensable title catalogue for the Home line of business. '
  'Resolution NEVER mutates core.property.';
