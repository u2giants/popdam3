-- Issue #1276: keep folder-derived Sega asset/property evidence strictly separate from
-- the source-declared relationship table. No licensed row values ship in this migration.

create table plm.sega_asset_property_inferred (
  capture_id           uuid         not null,
  asset_source_id      text         not null,
  property_source_id   text         not null,
  evidence_key         text         not null,
  catalog_source_id    text         not null,
  match_method         text         not null,
  matched_property_key text         not null,
  matched_catalog_key  text         not null,
  rule_version         text         not null,
  confidence           numeric(4,3) not null,
  relationship_truth   text         not null default 'inferred',
  raw                  jsonb        not null,

  constraint sega_asset_property_inferred_pkey
    primary key (capture_id, evidence_key),
  constraint sega_asset_property_inferred_pair_catalog_uk
    unique (capture_id, asset_source_id, property_source_id, catalog_source_id),
  constraint sega_asset_property_inferred_capture_fkey
    foreign key (capture_id) references plm.sega_capture(id) on delete restrict,
  constraint sega_asset_property_inferred_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.sega_asset(capture_id, asset_source_id) on delete restrict,
  constraint sega_asset_property_inferred_property_fkey
    foreign key (capture_id, property_source_id)
    references plm.sega_property(capture_id, property_source_id) on delete restrict,
  constraint sega_asset_property_inferred_catalog_fkey
    foreign key (capture_id, catalog_source_id)
    references plm.sega_catalog(capture_id, catalog_source_id) on delete restrict,
  constraint sega_asset_property_inferred_truth_chk
    check (relationship_truth = 'inferred'),
  constraint sega_asset_property_inferred_confidence_chk
    check (confidence between 0 and 1),
  constraint sega_asset_property_inferred_method_chk
    check (match_method in ('exact_label','normalized_label','subtree_of_match')),
  constraint sega_asset_property_inferred_asset_nonblank_chk
    check (btrim(asset_source_id) <> ''),
  constraint sega_asset_property_inferred_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint sega_asset_property_inferred_evidence_nonblank_chk
    check (btrim(evidence_key) <> ''),
  constraint sega_asset_property_inferred_catalog_nonblank_chk
    check (btrim(catalog_source_id) <> ''),
  constraint sega_asset_property_inferred_method_nonblank_chk
    check (btrim(match_method) <> ''),
  constraint sega_asset_property_inferred_property_key_nonblank_chk
    check (btrim(matched_property_key) <> ''),
  constraint sega_asset_property_inferred_catalog_key_nonblank_chk
    check (btrim(matched_catalog_key) <> ''),
  constraint sega_asset_property_inferred_rule_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint sega_asset_property_inferred_truth_nonblank_chk
    check (btrim(relationship_truth) <> ''),
  constraint sega_asset_property_inferred_raw_obj_chk
    check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_asset_property_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. Folder-containment-derived Sega asset-to-property '
  'links for one capture. Every row retains its catalog evidence, normalized match keys, '
  'rule version and confidence. This table never represents a portal-declared link and '
  'never resolves directly to core.property. One asset may legitimately link to multiple '
  'properties; no asset-only uniqueness constraint exists.';

comment on column plm.sega_asset_property_inferred.relationship_truth is
  'Pinned by CHECK to inferred. Direct portal truth remains exclusively in '
  'plm.sega_asset_property, whose direct-only CHECK is unchanged.';

create index idx_sega_asset_property_inferred_asset
  on plm.sega_asset_property_inferred(capture_id, asset_source_id);
create index idx_sega_asset_property_inferred_property
  on plm.sega_asset_property_inferred(capture_id, property_source_id);

-- Explicit ACL/RLS statements: do not hide this truth boundary behind a dynamic loop.
alter table plm.sega_asset_property_inferred enable row level security;
revoke all on plm.sega_asset_property_inferred from public;
revoke all on plm.sega_asset_property_inferred from anon;
revoke all on plm.sega_asset_property_inferred from authenticated;
revoke all on plm.sega_asset_property_inferred from service_role;
grant select, insert on plm.sega_asset_property_inferred to service_role;
grant select on plm.sega_asset_property_inferred to authenticated;

create policy sega_asset_property_inferred_service_read
  on plm.sega_asset_property_inferred for select to service_role using (true);
create policy sega_asset_property_inferred_plm_read
  on plm.sega_asset_property_inferred for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales','licensing']::app.app_role[]));

-- Preserve the exact current finalize body and make two bounded, asserted edits: add the
-- twelfth count/table pair and add the inferred relationship endpoint gate. This avoids
-- replacing later hardening in the long publication function with a stale copied body.
do $migration$
declare
  v_before text;
  v_after  text;
begin
  select pg_get_functiondef('plm.finalize_sega_capture(uuid,jsonb,jsonb)'::regprocedure)
    into v_before;

  v_after := replace(
    v_before,
    $needle$['asset_tags',            'sega_asset_tag'],
    ['asset_properties',      'sega_asset_property']$needle$,
    $replacement$['asset_tags',                'sega_asset_tag'],
    ['asset_properties',          'sega_asset_property'],
    ['asset_properties_inferred', 'sega_asset_property_inferred']$replacement$
  );
  if v_after = v_before then
    raise exception 'finalize_sega_capture count-pair anchor did not match current main';
  end if;
  v_before := v_after;

  v_after := replace(
    v_before,
    $needle$  select count(*) into v_n
    from plm.sega_property_licensor l$needle$,
    $replacement$  select count(*) into v_n
    from plm.sega_asset_property_inferred l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_property p
                       where p.capture_id = l.capture_id
                         and p.property_source_id = l.property_source_id)
       or not exists (select 1 from plm.sega_catalog c
                       where c.capture_id = l.capture_id
                         and c.catalog_source_id = l.catalog_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object(
      'code','orphan_asset_property_inferred_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_property_licensor l$replacement$
  );
  if v_after = v_before then
    raise exception 'finalize_sega_capture orphan-gate anchor did not match current main';
  end if;
  if (length(v_after) - length(replace(v_after, 'asset_properties_inferred', '')))
       / length('asset_properties_inferred') <> 1 then
    raise exception 'finalize_sega_capture inferred count key was not added exactly once';
  end if;
  if (length(v_after) - length(replace(v_after, 'orphan_asset_property_inferred_link', '')))
       / length('orphan_asset_property_inferred_link') <> 1 then
    raise exception 'finalize_sega_capture inferred orphan gate was not added exactly once';
  end if;
  v_before := v_after;

  -- The inherited body described the original eleven count-pair entities. Correct every
  -- anchored instance now that this migration makes the list twelve, and refuse to apply
  -- if current main no longer contains the expected wording.
  v_after := replace(v_before, 'eleven entity keys', 'twelve entity keys');
  v_after := replace(v_after, 'outside the eleven is', 'outside the twelve is');
  if v_after = v_before or position('eleven entity keys' in v_after) <> 0
     or position('outside the eleven is' in v_after) <> 0 then
    raise exception 'finalize_sega_capture entity-count comment anchor did not update cleanly';
  end if;

  execute v_after;
end;
$migration$;

comment on function plm.finalize_sega_capture(uuid,jsonb,jsonb) is
  'The publication gate for a Sega capture. It validates twelve expected/reported/table '
  'count pairs, including asset_properties_inferred, and rejects orphaned endpoints in '
  'both the direct and inferred asset-property tables. Rejections persist status and '
  'structured errors; callers must read back plm.sega_capture.status. service_role only.';

-- CREATE OR REPLACE resets neither ACL nor security-definer properties, but pin the
-- callable contract explicitly so future default privileges cannot broaden it.
revoke all on function plm.finalize_sega_capture(uuid,jsonb,jsonb) from public;
revoke all on function plm.finalize_sega_capture(uuid,jsonb,jsonb) from anon;
revoke all on function plm.finalize_sega_capture(uuid,jsonb,jsonb) from authenticated;
grant execute on function plm.finalize_sega_capture(uuid,jsonb,jsonb) to service_role;

-- api.source_capture_inventory already classifies every capture-scoped plm.sega_* table
-- additively. Assert the new table uses that stable contract without replacing the view.
do $$
begin
  if (select source_system from api.source_capture_inventory
       where table_name = 'sega_asset_property_inferred') is distinct from 'sega' then
    raise exception 'source_capture_inventory did not classify inferred table as Sega';
  end if;
  if (select count_basis from api.source_capture_inventory
       where table_name = 'sega_asset_property_inferred')
       is distinct from 'latest_complete' then
    raise exception 'source_capture_inventory lost latest-complete Sega classification';
  end if;
  if not exists (
    select 1 from pg_get_constraintdef(
      (select oid from pg_constraint where conname='sega_asset_property_evidence_type_chk')
    ) d(definition)
    where definition like '%source_asset_ip_association%'
  ) then
    raise exception 'direct Sega asset-property truth constraint changed or disappeared';
  end if;
end;
$$;
