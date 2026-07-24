with snapshot as (
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'database', current_database(),
    'server_address', inet_server_addr(),
    'canonical', jsonb_build_object(
      'licensor_count', (select count(*) from core.licensor),
      'property_count', (select count(*) from core.property),
      'licensor_uuid_hash', (
        select md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
        from core.licensor
      ),
      'property_uuid_hash', (
        select md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
        from core.property
      ),
      'status_hash', (
        select md5(coalesce(string_agg(v, '|' order by v), ''))
        from (
          select 'licensor|' || id || '|' || status as v from core.licensor
          union all
          select 'property|' || id || '|' || status as v from core.property
        ) s
      ),
      'parent_edge_hash', (
        select md5(coalesce(string_agg(id || '|' || licensor_id, '|' order by id::text), ''))
        from core.property
      ),
      'null_parent_count', (
        select count(*) from core.property where licensor_id is null
      )
    ),
    'source_refs', jsonb_build_object(
      'count', (select count(*) from core.taxonomy_source_ref),
      'hash', (
        select md5(coalesce(string_agg(
          concat_ws('|', source_system, source_table, source_id, source_code,
                    entity_schema, entity_table, entity_id::text),
          '|' order by source_system, source_table, source_id, entity_table, entity_id::text
        ), ''))
        from core.taxonomy_source_ref
      ),
      'coldlion_count', (
        select count(*) from core.taxonomy_source_ref where source_system = 'coldlion'
      )
    ),
    'mirrors', jsonb_build_object(
      'licensor_count', (select count(*) from plm.erp_licensor),
      'property_count', (select count(*) from plm.erp_property),
      'licensor_key_hash', (
        select md5(coalesce(string_agg(
          concat_ws('|', company_code, division_code, mg_type_code, mg_code),
          '|' order by company_code, division_code, mg_type_code, mg_code
        ), ''))
        from plm.erp_licensor
      ),
      'property_key_hash', (
        select md5(coalesce(string_agg(
          concat_ws('|', company_code, division_code, mg_type_code, mg_code),
          '|' order by company_code, division_code, mg_type_code, mg_code
        ), ''))
        from plm.erp_property
      ),
      'licensor_source_hash', (
        select md5(coalesce(string_agg(source_hash, '|' order by company_code, division_code, mg_type_code, mg_code), ''))
        from plm.erp_licensor
      ),
      'property_source_hash', (
        select md5(coalesce(string_agg(source_hash, '|' order by company_code, division_code, mg_type_code, mg_code), ''))
        from plm.erp_property
      ),
      'linked_licensors', (select count(*) from plm.erp_licensor where licensor_id is not null),
      'linked_properties', (select count(*) from plm.erp_property where property_id is not null)
    ),
    'reviews', jsonb_build_object(
      'count', (select count(*) from plm.taxonomy_resolution_review),
      'active_count', (
        select count(*) from plm.taxonomy_resolution_review
        where status in ('open', 'quarantined', 'conflict')
      ),
      'by_category', (
        select coalesce(jsonb_object_agg(category, n order by category), '{}'::jsonb)
        from (
          select concat_ws('/', entity_type, finding_scope, coalesce(resolution, status)) category,
                 count(*) n
          from plm.taxonomy_resolution_review
          group by entity_type, finding_scope, coalesce(resolution, status)
        ) c
      )
    ),
    'runs', jsonb_build_object(
      'phase2_count', (
        select count(*) from ingest.sync_run
        where source_name = 'coldlion_licensors_properties_api'
      ),
      'latest', (
        select to_jsonb(r)
        from (
          select id, status, started_at, finished_at, rows_seen, rows_inserted,
                 rows_updated, error, metadata
          from ingest.sync_run
          where source_name = 'coldlion_licensors_properties_api'
          order by started_at desc nulls last
          limit 1
        ) r
      ),
      'designflow_latest', (
        select to_jsonb(r)
        from (
          select id, status, started_at, finished_at, rows_seen, rows_inserted,
                 rows_updated, error, metadata
          from ingest.sync_run
          where source_system = 'designflow_plm'
          order by started_at desc nulls last
          limit 1
        ) r
      )
    ),
    'designflow_staging', jsonb_build_object(
      'licensor_rows', (select count(*) from plm.licensor_import),
      'licensor_distinct_codes', (select count(distinct mg_code) from plm.licensor_import),
      'property_rows', (select count(*) from plm.property_import),
      'property_distinct_codes', (select count(distinct mg_code) from plm.property_import)
    ),
    'named_cases', jsonb_build_object(
      'canonical_licensors', (
        select coalesce(jsonb_agg(to_jsonb(x) order by code, name), '[]'::jsonb)
        from (
          select id, code, name, status
          from core.licensor
          where upper(coalesce(code, '')) in ('NA', 'X-NASA', 'ZG', 'FK', 'FR')
             or upper(name) in ('NASA', 'ZAG', 'FRIDA KAHLO', 'FRIENDS TV')
        ) x
      ),
      'canonical_properties', (
        select coalesce(jsonb_agg(to_jsonb(x) order by code, name), '[]'::jsonb)
        from (
          select id, licensor_id, code, name, status
          from core.property
          where upper(coalesce(code, '')) in ('NA', 'X-NASA', 'ZG', 'FK', 'FR')
             or upper(name) like '%NASA%'
             or upper(name) like '%ZAG%'
             or upper(name) like '%FRIDA%'
             or upper(name) like '%FRIEND%'
             or upper(name) = '1ST ORDER TROOPER'
        ) x
      )
    ),
    'schedules', jsonb_build_object(
      'matching_cron_jobs', (
        select count(*)
        from cron.job
        where command ilike '%coldlion%licensor%'
           or command ilike '%coldlion%property%'
           or jobname ilike '%coldlion%licensor%'
           or jobname ilike '%coldlion%property%'
      )
    )
  ) value
)
select value from snapshot;
