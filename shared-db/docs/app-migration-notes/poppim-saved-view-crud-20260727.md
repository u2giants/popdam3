# Poppim saved-view CRUD correction — 2026-07-27

## Trigger

The authenticated production release smoke used the dedicated PM production
tester and reproduced `POST /rest/v1/saved_view` as HTTP 403:
`authenticated` had `SELECT` only on `pim.saved_view`. The frontend's
`createView`, `renameView`, and `deleteView` callers therefore could not work.

The existing generic `pm_write` RLS policy was not sufficient because Postgres
table privileges are checked before RLS. It was also broader than Poppim's
durable owner/shared rule: any PM write role could target any saved-view row if
table privileges were later granted.

## Correction

Migration
`20260727213000_poppim_saved_view_crud_grants.sql`:

- grants authenticated `SELECT`, `INSERT`, `UPDATE`, and `DELETE`;
- allows reads only for shared views or the current profile's own views;
- requires the current profile to own inserted, updated, and deleted rows;
- permits shared scope only for administrators;
- leaves seeded shared rows with no owner immutable;
- does not change `pim.view_pref`; preference writes continue through
  `api.pm_upsert_view_pref`.

## Preview proof

Applied to persistent rehearsal preview `rjyboqwcdzcocqgmsyel` only.
Production was not changed.

- static SQL checks: pass;
- duplicate migration timestamps: zero;
- rollback SQL: owner create/update/delete pass and foreign-owner insert is
  rejected;
- genuine preview JWT: create/read/update/delete and preference RPC pass;
- service-role cleanup assertion: zero test views and zero test preferences.

The preference scope is text rather than a foreign key, so deleting a saved
view does not cascade a `view_pref`. The application already removes/hides
preferences separately; verification explicitly cleaned the rollback fixture.

## Promotion gate

This migration requires a new exact production approval after PR review. Do not
include it in an unrelated `--include-all` run or edit an already-applied
migration.
