-- Correction to 20260727221500 (APPLIED and therefore immutable).
--
-- THE BUG, found by its own contract test on 2026-07-27
-- ----------------------------------------------------
-- plm.verify_coldlion_approved_mapping_identity built its blocking-reason list as
-- `v_reasons := v_reasons || '<literal>'`. Most appends used format(), which
-- returns text, so text[] || text appended correctly. Two of them appended a BARE
-- quoted literal. A bare literal is unknown-typed, and Postgres resolves
-- `text[] || unknown` as array-to-array concatenation — so it tried to parse the
-- sentence as an array literal and threw:
--
--     22P02 malformed array literal: "the approved mapping input contains
--     duplicate composite source keys"
--
-- The failure mode mattered: those two branches are the DUPLICATE / AMBIGUOUS
-- detectors. They only run when something is already wrong, so the verifier would
-- have crashed with a type error precisely when it had found a real ambiguity —
-- looking like a broken tool rather than a caught defect. Both literals are now
-- explicitly ::text. Everything else in the function is byte-identical.

create or replace function plm.verify_coldlion_approved_mapping_identity(
  p_input jsonb,
  p_expected jsonb default null,
  p_sample_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = plm, core, public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_sample_limit, 25), 200));
  v_maps jsonb;
  v_bad_shape integer;
  v_count integer;
  v_distinct integer;
  v_hash text;
  v_dup_keys jsonb;
  v_actual_refs integer;
  v_missing jsonb;
  v_extra jsonb;
  v_cross jsonb;
  v_changed jsonb;
  v_dup_refs jsonb;
  v_link_mismatch jsonb;
  v_canonical_missing jsonb;
  v_counts jsonb;
  v_reasons text[] := array[]::text[];
  v_contract_ok boolean := true;
  v_exp_hash text;
  v_exp_count integer;
  v_exp_distinct integer;
  v_pass boolean;
begin
  if p_input is null or jsonb_typeof(p_input->'mappings') <> 'array' then
    raise exception 'verify_coldlion_approved_mapping_identity requires { "mappings": [...] }'
      using errcode = 'P0001';
  end if;
  v_maps := p_input->'mappings';

  -- ---- shape: reject before anything else so a malformed file cannot "pass" ----
  select count(*) into v_bad_shape
  from jsonb_array_elements(v_maps) e
  where coalesce(e->>'entity_type', '') not in ('licensor', 'property')
     or coalesce(btrim(e->>'company_code'), '') = ''
     or coalesce(btrim(e->>'division_code'), '') = ''
     or coalesce(e->>'mg_type_code', '') !~ '^[0-9]{2}$'
     or coalesce(btrim(e->>'mg_code'), '') = ''
     or coalesce(e->>'canonical_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  if v_bad_shape > 0 then
    return jsonb_build_object(
      'pass', false,
      'checked_at', timezone('utc', now()),
      'blocking_reasons', to_jsonb(array[
        format('%s approved mapping row(s) are structurally invalid; identity cannot be proven', v_bad_shape)]),
      'difference_counts', jsonb_build_object('invalid_shape', v_bad_shape));
  end if;

  -- One read-only CTE pass. No temp table: this function must stay STABLE so it
  -- can be run immediately before a production write with zero side effects.
  with m as (
    select e->>'entity_type' as entity_type,
           e->>'company_code' as company_code,
           e->>'division_code' as division_code,
           e->>'mg_type_code' as mg_type_code,
           e->>'mg_code' as mg_code,
           (e->>'canonical_id')::uuid as canonical_id,
           concat_ws('/', e->>'company_code', e->>'division_code',
                          e->>'mg_type_code', e->>'mg_code') as source_id
    from jsonb_array_elements(v_maps) e
  ),
  refs as (
    select r.source_id, r.entity_table, r.entity_id
    from core.taxonomy_source_ref r
    where r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails'
  ),
  joined as (
    select m.source_id, m.entity_type, m.canonical_id,
           r.entity_table, r.entity_id
    from m join refs r on r.source_id = m.source_id
  ),
  missing as (
    select m.entity_type, m.source_id, m.canonical_id
    from m where not exists (select 1 from refs r where r.source_id = m.source_id)
  ),
  extra as (
    select r.entity_table, r.source_id, r.entity_id
    from refs r where not exists (select 1 from m where m.source_id = r.source_id)
  ),
  cross_typed as (
    select source_id, entity_type as approved_type, entity_table as actual_type
    from joined where entity_table is distinct from entity_type
  ),
  changed as (
    select source_id, entity_type, canonical_id as approved_id, entity_id as actual_id
    from joined
    where entity_table is not distinct from entity_type
      and entity_id is distinct from canonical_id
  ),
  dup_input as (
    select source_id, count(*) as n from m group by source_id having count(*) > 1
  ),
  dup_refs as (
    select source_id, count(*) as n from refs group by source_id having count(*) > 1
  ),
  link_mismatch as (
    select m.source_id, m.entity_type, m.canonical_id as approved_id,
           e.licensor_id as mirror_id
    from m join plm.erp_licensor e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'licensor' and e.licensor_id is distinct from m.canonical_id
    union all
    select m.source_id, m.entity_type, m.canonical_id, e.property_id
    from m join plm.erp_property e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'property' and e.property_id is distinct from m.canonical_id
  ),
  canonical_missing as (
    select m.source_id, m.entity_type, m.canonical_id
    from m
    where (m.entity_type = 'licensor'
             and not exists (select 1 from core.licensor l where l.id = m.canonical_id))
       or (m.entity_type = 'property'
             and not exists (select 1 from core.property p where p.id = m.canonical_id))
  )
  select
    (select count(*)::integer from m),
    (select count(distinct canonical_id)::integer from m),
    -- Frozen Phase 4 encoding: sort by composite key in code-unit (C) order,
    -- '<entity_type>|<composite>|<canonical_id>' joined by newline, md5 utf8 hex.
    (select md5(coalesce(string_agg(entity_type || '|' || source_id || '|' || canonical_id::text,
                                    E'\n' order by source_id collate "C"), '')) from m),
    (select count(*)::integer from refs),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'entity_type', entity_type, 'source_id', source_id,
              'expected_canonical_id', canonical_id) order by source_id), '[]'::jsonb)
       from (select * from missing order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'entity_table', entity_table, 'source_id', source_id,
              'entity_id', entity_id) order by source_id), '[]'::jsonb)
       from (select * from extra order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'approved_entity_type', approved_type,
              'actual_entity_table', actual_type) order by source_id), '[]'::jsonb)
       from (select * from cross_typed order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'entity_type', entity_type,
              'approved_canonical_id', approved_id, 'actual_entity_id', actual_id)
              order by source_id), '[]'::jsonb)
       from (select * from changed order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object('source_id', source_id, 'occurrences', n)
              order by source_id), '[]'::jsonb)
       from (select * from dup_input order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object('source_id', source_id, 'occurrences', n)
              order by source_id), '[]'::jsonb)
       from (select * from dup_refs order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'entity_type', entity_type,
              'approved_canonical_id', approved_id, 'mirror_link', mirror_id)
              order by source_id), '[]'::jsonb)
       from (select * from link_mismatch order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'entity_type', entity_type,
              'canonical_id', canonical_id) order by source_id), '[]'::jsonb)
       from (select * from canonical_missing order by source_id limit v_limit) s),
    jsonb_build_object(
      'missing', (select count(*) from missing),
      'extra', (select count(*) from extra),
      'cross_typed', (select count(*) from cross_typed),
      'changed_uuid', (select count(*) from changed),
      'duplicate_input_key', (select count(*) from dup_input),
      'duplicate_source_ref', (select count(*) from dup_refs),
      'link_mismatch', (select count(*) from link_mismatch),
      'canonical_missing', (select count(*) from canonical_missing))
  into v_count, v_distinct, v_hash, v_actual_refs,
       v_missing, v_extra, v_cross, v_changed,
       v_dup_keys, v_dup_refs, v_link_mismatch, v_canonical_missing, v_counts;

  -- ---- expected contract (hash / count / distinct), when supplied ----
  if p_expected is not null and jsonb_typeof(p_expected) = 'object' then
    v_exp_hash := p_expected->>'hash';
    v_exp_count := nullif(p_expected->>'count', '')::integer;
    v_exp_distinct := nullif(p_expected->>'distinct_canonical', '')::integer;

    if v_exp_hash is distinct from v_hash then
      v_contract_ok := false;
      v_reasons := v_reasons || format('approved mapping hash mismatch: recomputed %s, expected %s',
                                       v_hash, coalesce(v_exp_hash, 'null'));
    end if;
    if v_exp_count is not null and v_exp_count is distinct from v_count then
      v_contract_ok := false;
      v_reasons := v_reasons || format('approved mapping count mismatch: recomputed %s, expected %s',
                                       v_count, v_exp_count);
    end if;
    if v_exp_distinct is not null and v_exp_distinct is distinct from v_distinct then
      v_contract_ok := false;
      v_reasons := v_reasons || format('approved distinct canonical mismatch: recomputed %s, expected %s',
                                       v_distinct, v_exp_distinct);
    end if;
  end if;

  if (v_counts->>'missing')::integer > 0 then
    v_reasons := v_reasons || format('%s approved mapping(s) have NO ColdLion source ref', v_counts->>'missing');
  end if;
  if (v_counts->>'extra')::integer > 0 then
    v_reasons := v_reasons || format('%s ColdLion source ref(s) are outside the approved set', v_counts->>'extra');
  end if;
  if (v_counts->>'cross_typed')::integer > 0 then
    v_reasons := v_reasons || format('%s mapping(s) resolve to the WRONG entity type (cross-typed)', v_counts->>'cross_typed');
  end if;
  if (v_counts->>'changed_uuid')::integer > 0 then
    v_reasons := v_reasons || format('%s mapping(s) resolve to a DIFFERENT canonical UUID', v_counts->>'changed_uuid');
  end if;
  if (v_counts->>'duplicate_input_key')::integer > 0 then
    v_reasons := v_reasons || 'the approved mapping input contains duplicate composite source keys'::text;
  end if;
  if (v_counts->>'duplicate_source_ref')::integer > 0 then
    v_reasons := v_reasons || 'a ColdLion source identity resolves ambiguously to more than one ref row'::text;
  end if;
  if (v_counts->>'link_mismatch')::integer > 0 then
    v_reasons := v_reasons || format('%s typed mirror link(s) disagree with the approved canonical UUID', v_counts->>'link_mismatch');
  end if;
  if (v_counts->>'canonical_missing')::integer > 0 then
    v_reasons := v_reasons || format('%s approved canonical row(s) no longer exist in the typed table', v_counts->>'canonical_missing');
  end if;

  v_pass := v_contract_ok and array_length(v_reasons, 1) is null;

  return jsonb_build_object(
    'pass', v_pass,
    'checked_at', timezone('utc', now()),
    'approved_count', v_count,
    'approved_distinct_canonical', v_distinct,
    'recomputed_mapping_hash', v_hash,
    'expected_contract', p_expected,
    'expected_contract_ok', v_contract_ok,
    'actual_coldlion_source_refs', v_actual_refs,
    'difference_counts', v_counts,
    'differences', jsonb_build_object(
      'missing', v_missing,
      'extra', v_extra,
      'cross_typed', v_cross,
      'changed_uuid', v_changed,
      'duplicate_input_key', v_dup_keys,
      'duplicate_source_ref', v_dup_refs,
      'link_mismatch', v_link_mismatch,
      'canonical_missing', v_canonical_missing),
    'sample_limit', v_limit,
    'blocking_reasons', to_jsonb(v_reasons),
    'human_response_owner', 'Albert Hazan');
end;
$$;

