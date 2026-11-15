-- Fix-forward copy of 20261113174422 (PR #6263), which never reached production (merge-freeze refusals). Idempotent.
-- Issue popcre/shared-db#6194. Albert, 2026-11-13 12:43 PM EST (verbatim):
-- "“Standard Characters” should have a property nickname (in our database, not coldlion's) of 'Mickey Group'"
-- POP-owned nickname only; the ColdLion name and the daily ColdLion sync are untouched.
update core.property set nickname = 'Mickey Group'
 where code = 'MM' and name = 'Standard Characters' and nickname is distinct from 'Mickey Group';
