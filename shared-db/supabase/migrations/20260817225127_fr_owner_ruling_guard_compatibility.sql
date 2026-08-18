-- #1090 / #1140: narrowly authorize the already-held 20260802171000 owner
-- ruling when it later ships inside the complete AGENTS.md section 6.5 bundle.

alter table plm.licensing_write_authorization
  drop constraint licensing_write_authorization_write_kind_check;

alter table plm.licensing_write_authorization
  add constraint licensing_write_authorization_write_kind_check
  check (write_kind in (
    'scrape_consolidation',
    'licensing_review_create',
    'coldlion_status',
    'canonical_merge',
    'owner_ruling_fr_inactivation'
  ));
