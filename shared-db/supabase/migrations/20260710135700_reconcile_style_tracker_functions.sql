-- Reconcile production style-tracker functions that were skipped on preview.
-- CREATE OR REPLACE is non-destructive and preserves callers.

CREATE OR REPLACE FUNCTION plm.apply_style_tracker_designer_resolutions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm', 'core'
AS $function$
declare
  v_updated integer;
begin
  with row_values as (
    select
      b.id as bridge_id,
      lower(regexp_replace(btrim(r.designer), '\s+', ' ', 'g')) as designer_norm
    from plm.style_tracker_item_bridge b
    join public.style_tracker_rows r on r.id = b.style_tracker_row_id
    where nullif(btrim(r.designer), '') is not null
  ),
  unique_first_names as (
    select split_part(normalized_name, ' ', 1) as first_name
    from core.creative_designer
    where status = 'active'
    group by split_part(normalized_name, ' ', 1)
    having count(*) = 1
  ),
  automatic_matches as (
    select distinct on (rv.bridge_id)
      rv.bridge_id,
      cd.id,
      cd.name
    from row_values rv
    join core.creative_designer cd
      on cd.status = 'active'
     and (
       cd.normalized_name = rv.designer_norm
       or (
         rv.designer_norm = split_part(cd.normalized_name, ' ', 1)
         and exists (
           select 1
           from unique_first_names u
           where u.first_name = rv.designer_norm
         )
       )
     )
    order by rv.bridge_id, cd.name
  ),
  resolved as (
    select
      rv.bridge_id,
      res.resolution_type,
      res.target_schema,
      res.target_table,
      res.target_id,
      res.target_label,
      res.local_value,
      case
        when res.resolution_type = 'canonical'
          and res.target_schema = 'core'
          and res.target_table = 'creative_designer'
          then res.target_id
        when res.id is null then am.id
        else null
      end as creative_designer_id,
      case
        when res.resolution_type = 'canonical'
          and res.target_schema = 'core'
          and res.target_table = 'creative_designer'
          then res.target_label
        when res.id is null then am.name
        else null
      end as creative_designer_name
    from row_values rv
    left join plm.style_tracker_value_resolution res
      on res.field_key = 'designer'
     and res.normalized_value = rv.designer_norm
    left join automatic_matches am
      on am.bridge_id = rv.bridge_id
  )
  update plm.style_tracker_item_bridge b
  set
    creative_designer_id = resolved.creative_designer_id,
    match_notes = case
      when resolved.resolution_type is null then
        case
          when b.match_notes->'manual_resolution'->>'field_key' = 'designer'
            then (coalesce(b.match_notes, '{}'::jsonb) - 'manual_resolution') #- '{manual_resolutions,designer}'
          else coalesce(b.match_notes, '{}'::jsonb) #- '{manual_resolutions,designer}'
        end
      else
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(b.match_notes, '{}'::jsonb),
              '{manual_resolutions}',
              coalesce(b.match_notes->'manual_resolutions', '{}'::jsonb),
              true
            ),
            '{manual_resolutions,designer}',
            jsonb_strip_nulls(jsonb_build_object(
              'field_key', 'designer',
              'resolution_type', resolved.resolution_type,
              'target_schema', resolved.target_schema,
              'target_table', resolved.target_table,
              'target_id', resolved.target_id,
              'target_label', resolved.target_label,
              'local_value', resolved.local_value
            )),
            true
          ),
          '{manual_resolution}',
          jsonb_strip_nulls(jsonb_build_object(
            'field_key', 'designer',
            'resolution_type', resolved.resolution_type,
            'target_schema', resolved.target_schema,
            'target_table', resolved.target_table,
            'target_id', resolved.target_id,
            'target_label', resolved.target_label,
            'local_value', resolved.local_value
          )),
          true
        )
    end,
    match_status = case
      when resolved.creative_designer_id is not null and b.match_status = 'unmatched' then 'partial'
      when resolved.resolution_type = 'master_data' and b.match_status = 'unmatched' then 'partial'
      else b.match_status
    end,
    match_confidence = case
      when resolved.creative_designer_id is not null and b.match_confidence = 'possible' then 'verified'
      when resolved.resolution_type = 'master_data' and b.match_confidence = 'possible' then 'verified'
      else b.match_confidence
    end,
    last_matched_at = case
      when b.creative_designer_id is distinct from resolved.creative_designer_id then now()
      else b.last_matched_at
    end
  from resolved
  where b.id = resolved.bridge_id
    and (
      b.creative_designer_id is distinct from resolved.creative_designer_id
      or (
        resolved.resolution_type is not null
        and coalesce(b.match_notes->'manual_resolutions'->'designer', '{}'::jsonb) is distinct from jsonb_strip_nulls(jsonb_build_object(
          'field_key', 'designer',
          'resolution_type', resolved.resolution_type,
          'target_schema', resolved.target_schema,
          'target_table', resolved.target_table,
          'target_id', resolved.target_id,
          'target_label', resolved.target_label,
          'local_value', resolved.local_value
        ))
      )
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION plm.normalize_style_tracker_value(p_field_key text, p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN p_field_key = 'sku' THEN upper(trim(p_value))
    ELSE lower(regexp_replace(trim(p_value), '\s+', ' ', 'g'))
  END;
$function$;

CREATE OR REPLACE FUNCTION plm.refresh_style_tracker_item_bridge()
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm', 'core', 'extensions'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM plm.style_tracker_item_bridge;

  WITH erp_matches AS (
    SELECT upper(trim(style_number)) AS normalized_sku, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.erp_items_current
    WHERE style_number IS NOT NULL AND trim(style_number) <> ''
    GROUP BY upper(trim(style_number))
  ),
  style_group_matches AS (
    SELECT upper(trim(sku)) AS normalized_sku, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.style_groups
    WHERE sku IS NOT NULL AND trim(sku) <> ''
    GROUP BY upper(trim(sku))
  ),
  company_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.customer
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  public_licensor_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM public.licensors
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  core_licensor_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.licensor
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  factory_matches AS (
    SELECT lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS normalized_name, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM core.factory
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ),
  plm_item_matches AS (
    SELECT upper(trim(coalesce(style_number, item_number))) AS normalized_sku, min(id::text)::uuid AS id, count(*) AS candidate_count
    FROM plm.item
    WHERE coalesce(style_number, item_number) IS NOT NULL AND trim(coalesce(style_number, item_number)) <> ''
    GROUP BY upper(trim(coalesce(style_number, item_number)))
  ),
  row_values AS (
    SELECT
      r.*,
      plm.normalize_style_tracker_value('sku', r.sku) AS sku_norm,
      plm.normalize_style_tracker_value('customer', r.customer) AS customer_norm,
      plm.normalize_style_tracker_value('licensor', r.licensor) AS licensor_norm,
      plm.normalize_style_tracker_value('factory', r.default_vendor) AS factory_norm
    FROM public.style_tracker_rows r
    WHERE r.source_sheet IN ('License.Style', 'Generic.Style')
  ),
  customer_values AS (
    SELECT DISTINCT customer_norm, customer
    FROM row_values
    WHERE customer_norm IS NOT NULL
  ),
  licensor_values AS (
    SELECT DISTINCT licensor_norm, licensor
    FROM row_values
    WHERE licensor_norm IS NOT NULL
  ),
  factory_values AS (
    SELECT DISTINCT factory_norm, default_vendor
    FROM row_values
    WHERE factory_norm IS NOT NULL
  ),
  fuzzy_customers AS (
    SELECT DISTINCT ON (v.customer_norm)
      v.customer_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM customer_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('customer', v.customer, 1) c
    ORDER BY v.customer_norm, c.score DESC
  ),
  fuzzy_licensors AS (
    SELECT DISTINCT ON (v.licensor_norm)
      v.licensor_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM licensor_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('licensor', v.licensor, 1) c
    ORDER BY v.licensor_norm, c.score DESC
  ),
  fuzzy_factories AS (
    SELECT DISTINCT ON (v.factory_norm)
      v.factory_norm,
      jsonb_build_object('target_schema', c.target_schema, 'target_table', c.target_table, 'target_id', c.target_id, 'target_label', c.target_label, 'score', c.score) AS suggestion
    FROM factory_values v
    CROSS JOIN LATERAL public.search_style_tracker_link_candidates('factory', v.default_vendor, 1) c
    ORDER BY v.factory_norm, c.score DESC
  ),
  resolved AS (
    SELECT
      r.*,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'public' AND sku_res.target_table = 'erp_items_current' THEN sku_res.target_id ELSE erp.id END AS erp_item_id,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'public' AND sku_res.target_table = 'style_groups' THEN sku_res.target_id ELSE sg.id END AS style_group_id,
      CASE WHEN customer_res.resolution_type = 'canonical' AND customer_res.target_schema = 'core' AND customer_res.target_table = 'customer' THEN customer_res.target_id ELSE company.id END AS company_id,
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'public' AND licensor_res.target_table = 'licensors' THEN licensor_res.target_id ELSE public_lic.id END AS public_licensor_id,
      CASE WHEN licensor_res.resolution_type = 'canonical' AND licensor_res.target_schema = 'core' AND licensor_res.target_table = 'licensor' THEN licensor_res.target_id ELSE core_lic.id END AS core_licensor_id,
      CASE WHEN factory_res.resolution_type = 'canonical' AND factory_res.target_schema = 'core' AND factory_res.target_table = 'factory' THEN factory_res.target_id ELSE factory.id END AS factory_id,
      CASE WHEN sku_res.resolution_type = 'canonical' AND sku_res.target_schema = 'plm' AND sku_res.target_table = 'item' THEN sku_res.target_id ELSE plm_item.id END AS plm_item_id,
      sku_res.local_value AS local_sku_value,
      customer_res.local_value AS local_customer_value,
      licensor_res.local_value AS local_licensor_value,
      factory_res.local_value AS local_factory_value,
      coalesce(erp.candidate_count, 0) AS erp_candidates,
      coalesce(sg.candidate_count, 0) AS style_group_candidates,
      coalesce(company.candidate_count, 0) AS company_candidates,
      coalesce(public_lic.candidate_count, 0) AS public_licensor_candidates,
      coalesce(core_lic.candidate_count, 0) AS core_licensor_candidates,
      coalesce(factory.candidate_count, 0) AS factory_candidates,
      coalesce(plm_item.candidate_count, 0) AS plm_item_candidates,
      fuzzy_customer.suggestion AS fuzzy_customer_suggestion,
      fuzzy_licensor.suggestion AS fuzzy_licensor_suggestion,
      fuzzy_factory.suggestion AS fuzzy_factory_suggestion
    FROM row_values r
    LEFT JOIN erp_matches erp ON erp.normalized_sku = r.sku_norm
    LEFT JOIN style_group_matches sg ON sg.normalized_sku = r.sku_norm
    LEFT JOIN company_matches company ON company.normalized_name = r.customer_norm
    LEFT JOIN public_licensor_matches public_lic ON public_lic.normalized_name = r.licensor_norm
    LEFT JOIN core_licensor_matches core_lic ON core_lic.normalized_name = r.licensor_norm
    LEFT JOIN factory_matches factory ON factory.normalized_name = r.factory_norm
    LEFT JOIN plm_item_matches plm_item ON plm_item.normalized_sku = r.sku_norm
    LEFT JOIN plm.style_tracker_value_resolution sku_res ON sku_res.field_key = 'sku' AND sku_res.normalized_value = r.sku_norm
    LEFT JOIN plm.style_tracker_value_resolution customer_res ON customer_res.field_key = 'customer' AND customer_res.normalized_value = r.customer_norm
    LEFT JOIN plm.style_tracker_value_resolution licensor_res ON licensor_res.field_key = 'licensor' AND licensor_res.normalized_value = r.licensor_norm
    LEFT JOIN plm.style_tracker_value_resolution factory_res ON factory_res.field_key = 'factory' AND factory_res.normalized_value = r.factory_norm
    LEFT JOIN fuzzy_customers fuzzy_customer ON fuzzy_customer.customer_norm = r.customer_norm AND company.id IS NULL AND customer_res.id IS NULL
    LEFT JOIN fuzzy_licensors fuzzy_licensor ON fuzzy_licensor.licensor_norm = r.licensor_norm AND public_lic.id IS NULL AND core_lic.id IS NULL AND licensor_res.id IS NULL
    LEFT JOIN fuzzy_factories fuzzy_factory ON fuzzy_factory.factory_norm = r.factory_norm AND factory.id IS NULL AND factory_res.id IS NULL
  ),
  upserted AS (
    INSERT INTO plm.style_tracker_item_bridge (
      style_tracker_row_id,
      source_workbook_id,
      source_sheet,
      source_row_number,
      tracker_type,
      sku,
      description,
      customer_name,
      designer_name,
      commissioned,
      upc,
      customer_sku,
      licensor_name,
      license_status,
      royalty,
      concept_status,
      pre_production_status,
      production_status,
      default_vendor_name,
      discontinued,
      notes,
      erp_item_id,
      style_group_id,
      company_id,
      public_licensor_id,
      core_licensor_id,
      factory_id,
      plm_item_id,
      match_status,
      match_confidence,
      match_notes,
      raw_row_data,
      last_matched_at
    )
    SELECT
      id,
      source_workbook_id,
      source_sheet,
      source_row_number,
      tracker_type,
      sku,
      description,
      customer,
      designer,
      commissioned,
      upc,
      customer_sku,
      licensor,
      license_status,
      royalty,
      concept_status,
      pre_production_status,
      production_status,
      default_vendor,
      discontinued,
      notes,
      erp_item_id,
      style_group_id,
      company_id,
      public_licensor_id,
      core_licensor_id,
      factory_id,
      plm_item_id,
      CASE
        WHEN greatest(erp_candidates, style_group_candidates, company_candidates, public_licensor_candidates, core_licensor_candidates, factory_candidates, plm_item_candidates) > 1
          THEN 'needs_review'
        WHEN fuzzy_customer_suggestion IS NOT NULL OR fuzzy_licensor_suggestion IS NOT NULL OR fuzzy_factory_suggestion IS NOT NULL
          THEN 'needs_review'
        WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR company_id IS NOT NULL OR public_licensor_id IS NOT NULL OR core_licensor_id IS NOT NULL OR factory_id IS NOT NULL OR plm_item_id IS NOT NULL
          THEN CASE WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR plm_item_id IS NOT NULL THEN 'matched' ELSE 'partial' END
        WHEN local_sku_value IS NOT NULL OR local_customer_value IS NOT NULL OR local_licensor_value IS NOT NULL OR local_factory_value IS NOT NULL
          THEN 'partial'
        ELSE 'unmatched'
      END,
      CASE
        WHEN greatest(erp_candidates, style_group_candidates, company_candidates, public_licensor_candidates, core_licensor_candidates, factory_candidates, plm_item_candidates) > 1
          THEN 'conflict'
        WHEN fuzzy_customer_suggestion IS NOT NULL OR fuzzy_licensor_suggestion IS NOT NULL OR fuzzy_factory_suggestion IS NOT NULL
          THEN 'possible'
        WHEN erp_item_id IS NOT NULL OR style_group_id IS NOT NULL OR plm_item_id IS NOT NULL
          THEN 'probable'
        WHEN company_id IS NOT NULL OR public_licensor_id IS NOT NULL OR core_licensor_id IS NOT NULL OR factory_id IS NOT NULL
          THEN 'possible'
        ELSE 'possible'
      END,
      jsonb_strip_nulls(jsonb_build_object(
        'erp_candidates', erp_candidates,
        'style_group_candidates', style_group_candidates,
        'company_candidates', company_candidates,
        'public_licensor_candidates', public_licensor_candidates,
        'core_licensor_candidates', core_licensor_candidates,
        'factory_candidates', factory_candidates,
        'plm_item_candidates', plm_item_candidates,
        'fuzzy', jsonb_strip_nulls(jsonb_build_object(
          'customer', fuzzy_customer_suggestion,
          'licensor', fuzzy_licensor_suggestion,
          'factory', fuzzy_factory_suggestion
        )),
        'master_data_values', jsonb_strip_nulls(jsonb_build_object(
          'sku', local_sku_value,
          'customer', local_customer_value,
          'licensor', local_licensor_value,
          'factory', local_factory_value
        ))
      )),
      row_data,
      now()
    FROM resolved
    ON CONFLICT (style_tracker_row_id) DO UPDATE SET
      source_workbook_id = EXCLUDED.source_workbook_id,
      source_sheet = EXCLUDED.source_sheet,
      source_row_number = EXCLUDED.source_row_number,
      tracker_type = EXCLUDED.tracker_type,
      sku = EXCLUDED.sku,
      description = EXCLUDED.description,
      customer_name = EXCLUDED.customer_name,
      designer_name = EXCLUDED.designer_name,
      commissioned = EXCLUDED.commissioned,
      upc = EXCLUDED.upc,
      customer_sku = EXCLUDED.customer_sku,
      licensor_name = EXCLUDED.licensor_name,
      license_status = EXCLUDED.license_status,
      royalty = EXCLUDED.royalty,
      concept_status = EXCLUDED.concept_status,
      pre_production_status = EXCLUDED.pre_production_status,
      production_status = EXCLUDED.production_status,
      default_vendor_name = EXCLUDED.default_vendor_name,
      discontinued = EXCLUDED.discontinued,
      notes = EXCLUDED.notes,
      erp_item_id = EXCLUDED.erp_item_id,
      style_group_id = EXCLUDED.style_group_id,
      company_id = EXCLUDED.company_id,
      public_licensor_id = EXCLUDED.public_licensor_id,
      core_licensor_id = EXCLUDED.core_licensor_id,
      factory_id = EXCLUDED.factory_id,
      plm_item_id = EXCLUDED.plm_item_id,
      match_status = EXCLUDED.match_status,
      match_confidence = EXCLUDED.match_confidence,
      match_notes = EXCLUDED.match_notes,
      raw_row_data = EXCLUDED.raw_row_data,
      last_matched_at = EXCLUDED.last_matched_at
    RETURNING (xmax = 0)::integer AS inserted_flag
  )
  SELECT
    coalesce(sum(inserted_flag), 0)::integer,
    (count(*) - coalesce(sum(inserted_flag), 0))::integer,
    count(*)::integer
  INTO inserted_count, updated_count, total_count
  FROM upserted;

  SELECT count(*) INTO v_after FROM plm.style_tracker_item_bridge;
  inserted_count := greatest(v_after - v_before, 0);

  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION plm.set_style_tracker_bridge_audit_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION plm.set_style_tracker_value_resolution_audit_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'public'
AS $function$
BEGIN
  NEW.normalized_value = plm.normalize_style_tracker_value(NEW.field_key, NEW.raw_value);
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_style_tracker_rows(p_source_sheet text, p_tracker_type text, p_count integer DEFAULT 1)
 RETURNS SETOF style_tracker_rows
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm'
AS $function$
DECLARE
  v_count integer;
  v_start_row integer;
BEGIN
  IF p_source_sheet NOT IN ('License.Style', 'Generic.Style') THEN
    RAISE EXCEPTION 'Unsupported source_sheet: %', p_source_sheet;
  END IF;

  IF p_tracker_type NOT IN ('licensed', 'generic', 'vendor', 'project', 'order', 'other') THEN
    RAISE EXCEPTION 'Unsupported tracker_type: %', p_tracker_type;
  END IF;

  v_count := greatest(1, least(coalesce(p_count, 1), 25));

  SELECT coalesce(max(source_row_number), 2) + 1
  INTO v_start_row
  FROM public.style_tracker_rows
  WHERE source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    AND source_sheet = p_source_sheet;

  RETURN QUERY
  INSERT INTO public.style_tracker_rows (
    source_workbook_id,
    source_sheet,
    source_row_number,
    tracker_type,
    row_data
  )
  SELECT
    '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214',
    p_source_sheet,
    v_start_row + offset_value,
    p_tracker_type,
    '{}'::jsonb
  FROM generate_series(0, v_count - 1) AS offset_value
  RETURNING *;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_style_tracker_row_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_key text;
begin
  if tg_op = 'INSERT' then
    insert into public.style_tracker_audit_log (
      event_type,
      style_tracker_row_id,
      source_sheet,
      source_row_number,
      metadata,
      changed_by
    )
    values (
      'row_added',
      new.id,
      new.source_sheet,
      new.source_row_number,
      jsonb_build_object('tracker_type', new.tracker_type),
      auth.uid()
    );

    return new;
  end if;

  for v_key in
    select distinct key
    from (
      select jsonb_object_keys(coalesce(old.row_data, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(new.row_data, '{}'::jsonb)) as key
    ) keys
    where key ~ '^[A-Z]{1,2}$'
    order by key
  loop
    if (old.row_data -> v_key) is distinct from (new.row_data -> v_key) then
      insert into public.style_tracker_audit_log (
        event_type,
        style_tracker_row_id,
        source_sheet,
        source_row_number,
        column_letter,
        old_value,
        new_value,
        metadata,
        changed_by
      )
      values (
        'cell_update',
        new.id,
        new.source_sheet,
        new.source_row_number,
        v_key,
        old.row_data -> v_key,
        new.row_data -> v_key,
        jsonb_build_object('tracker_type', new.tracker_type),
        auth.uid()
      );
    end if;
  end loop;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_tracker_item_bridge()
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm'
AS $function$
declare
  v_result record;
  v_designer_updated integer;
begin
  select * into v_result from plm.refresh_style_tracker_item_bridge();
  v_designer_updated := plm.apply_style_tracker_designer_resolutions();

  inserted_count := v_result.inserted_count;
  updated_count := v_result.updated_count + v_designer_updated;
  total_count := v_result.total_count;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_style_tracker_link_candidates(p_field_key text, p_query text, p_limit integer DEFAULT 20, p_match_mode text DEFAULT 'fuzzy'::text)
 RETURNS TABLE(target_schema text, target_table text, target_id uuid, target_label text, score real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'core', 'plm', 'extensions', 'pg_catalog'
AS $function$
declare
  q text := lower(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  max_rows integer := greatest(1, least(coalesce(p_limit, 20), 500));
  use_all boolean := coalesce(p_match_mode, 'fuzzy') = 'all';
  min_score real := 0.35;
begin
  if nullif(q, '') is null then
    return;
  end if;

  if p_field_key = 'customer' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'customer'::text as target_table,
        c.id as target_id,
        coalesce(nullif(csr.source_name, ''), c.name) as target_label,
        greatest(
          similarity(lower(c.name), q),
          similarity(lower(coalesce(csr.source_name, '')), q),
          similarity(lower(coalesce(csr.source_code, '')), q),
          case
            when lower(c.name) = q or lower(coalesce(csr.source_name, '')) = q then 1::real
            when length(c.name) >= 4 and q like '%' || lower(c.name) || '%' then 0.9::real
            when length(coalesce(csr.source_name, '')) >= 4 and q like '%' || lower(csr.source_name) || '%' then 0.9::real
            when lower(c.name) like '%' || q || '%' or lower(coalesce(csr.source_name, '')) like '%' || q || '%' then 0.85::real
            when lower(coalesce(csr.source_code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        c.status
      from core.customer c
      join core.company_source_ref csr on csr.company_id = c.id
      where csr.source_system = 'designflow_plm'
        and csr.source_table = 'customers'
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'licensor' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'licensor'::text as target_table,
        l.id as target_id,
        coalesce(nullif(tsr.source_name, ''), l.name) as target_label,
        greatest(
          similarity(lower(l.name), q),
          similarity(lower(coalesce(tsr.source_name, '')), q),
          similarity(lower(coalesce(tsr.source_code, '')), q),
          case
            when lower(l.name) = q or lower(coalesce(tsr.source_name, '')) = q then 1::real
            when length(l.name) >= 4 and q like '%' || lower(l.name) || '%' then 0.9::real
            when length(coalesce(tsr.source_name, '')) >= 4 and q like '%' || lower(tsr.source_name) || '%' then 0.9::real
            when lower(l.name) like '%' || q || '%' or lower(coalesce(tsr.source_name, '')) like '%' || q || '%' then 0.85::real
            when lower(coalesce(tsr.source_code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        l.status
      from core.licensor l
      join core.taxonomy_source_ref tsr on tsr.entity_id = l.id
      where tsr.entity_schema = 'core'
        and tsr.entity_table = 'licensor'
        and tsr.source_system = 'designflow_plm'
        and tsr.source_table = 'merchGroup'
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'property' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'property'::text as target_table,
        p.id as target_id,
        concat_ws(' / ', nullif(l.name, ''), coalesce(nullif(tsr.source_name, ''), p.name)) as target_label,
        greatest(
          similarity(lower(p.name), q),
          similarity(lower(coalesce(tsr.source_name, '')), q),
          similarity(lower(coalesce(tsr.source_code, '')), q),
          case
            when lower(p.name) = q or lower(coalesce(tsr.source_name, '')) = q then 1::real
            when length(p.name) >= 4 and q like '%' || lower(p.name) || '%' then 0.9::real
            when length(coalesce(tsr.source_name, '')) >= 4 and q like '%' || lower(tsr.source_name) || '%' then 0.9::real
            when lower(p.name) like '%' || q || '%' or lower(coalesce(tsr.source_name, '')) like '%' || q || '%' then 0.85::real
            when lower(coalesce(tsr.source_code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        p.status
      from core.property p
      join core.licensor l on l.id = p.licensor_id
      join core.taxonomy_source_ref tsr on tsr.entity_id = p.id
      where tsr.entity_schema = 'core'
        and tsr.entity_table = 'property'
        and tsr.source_system = 'designflow_plm'
        and tsr.source_table = 'merchGroup'
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'factory' then
    return query
    with candidates as (
      select
        'core'::text as target_schema,
        'factory'::text as target_table,
        f.id as target_id,
        f.name as target_label,
        greatest(
          similarity(lower(f.name), q),
          similarity(lower(coalesce(f.code, '')), q),
          case
            when lower(f.name) = q then 1::real
            when length(f.name) >= 4 and q like '%' || lower(f.name) || '%' then 0.9::real
            when lower(f.name) like '%' || q || '%' then 0.85::real
            when lower(coalesce(f.code, '')) = q then 0.8::real
            else 0::real
          end
        )::real as score,
        f.status
      from core.factory f
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by
      (r.status = 'active') desc,
      r.score desc,
      r.target_label
    limit max_rows;
    return;
  end if;

  if p_field_key = 'sku' then
    return query
    with candidates as (
      select
        'public'::text as target_schema,
        'style_groups'::text as target_table,
        sg.id as target_id,
        sg.sku as target_label,
        greatest(
          similarity(lower(sg.sku), q),
          case
            when lower(sg.sku) = q then 1::real
            when length(sg.sku) >= 4 and q like '%' || lower(sg.sku) || '%' then 0.9::real
            when lower(sg.sku) like '%' || q || '%' then 0.85::real
            else 0::real
          end
        )::real as score
      from public.style_groups sg
      where sg.sku is not null
    )
    , ranked as (
      select c.*, row_number() over (partition by c.target_schema, c.target_table, c.target_id order by c.score desc, c.target_label) as rn
      from candidates c
      where use_all
         or c.score >= min_score
    )
    select r.target_schema, r.target_table, r.target_id, r.target_label, r.score
    from ranked r
    where r.rn = 1
    order by r.score desc, r.target_label
    limit max_rows;
    return;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_style_tracker_row_audit_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_style_tracker_value_resolution(p_field_key text, p_raw_value text, p_resolution_type text, p_target_schema text DEFAULT NULL::text, p_target_table text DEFAULT NULL::text, p_target_id uuid DEFAULT NULL::uuid, p_target_label text DEFAULT NULL::text, p_local_value text DEFAULT NULL::text)
 RETURNS plm.style_tracker_value_resolution
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'plm'
AS $function$
declare
  v_resolution plm.style_tracker_value_resolution;
  v_previous jsonb;
  v_normalized text;
  v_manual jsonb;
  v_affected_rows integer := 0;
begin
  if p_field_key not in ('sku', 'customer', 'licensor', 'designer', 'factory') then
    raise exception 'Unsupported field_key: %', p_field_key;
  end if;

  if nullif(trim(coalesce(p_raw_value, '')), '') is null then
    raise exception 'raw_value is required';
  end if;

  v_normalized := plm.normalize_style_tracker_value(p_field_key, p_raw_value);

  select to_jsonb(existing)
  into v_previous
  from plm.style_tracker_value_resolution existing
  where existing.field_key = p_field_key
    and existing.normalized_value = v_normalized;

  v_manual := jsonb_strip_nulls(jsonb_build_object(
    'field_key', p_field_key,
    'resolution_type', p_resolution_type,
    'target_schema', p_target_schema,
    'target_table', p_target_table,
    'target_id', p_target_id,
    'target_label', p_target_label,
    'local_value', case when p_resolution_type = 'master_data' then trim(coalesce(p_local_value, p_raw_value)) else null end
  ));

  insert into plm.style_tracker_value_resolution (
    field_key,
    raw_value,
    normalized_value,
    resolution_type,
    target_schema,
    target_table,
    target_id,
    target_label,
    local_value,
    confidence
  )
  values (
    p_field_key,
    trim(p_raw_value),
    v_normalized,
    p_resolution_type,
    p_target_schema,
    p_target_table,
    p_target_id,
    p_target_label,
    case when p_resolution_type = 'master_data' then trim(coalesce(p_local_value, p_raw_value)) else null end,
    'verified'
  )
  on conflict (field_key, normalized_value) do update set
    raw_value = excluded.raw_value,
    resolution_type = excluded.resolution_type,
    target_schema = excluded.target_schema,
    target_table = excluded.target_table,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    local_value = excluded.local_value,
    confidence = excluded.confidence
  returning * into v_resolution;

  update plm.style_tracker_item_bridge b
  set
    creative_designer_id = case
      when p_field_key = 'designer'
        and p_resolution_type = 'canonical'
        and p_target_schema = 'core'
        and p_target_table = 'creative_designer'
        then p_target_id
      when p_field_key = 'designer' then null
      else b.creative_designer_id
    end,
    match_notes = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(b.match_notes, '{}'::jsonb),
          '{manual_resolutions}',
          coalesce(b.match_notes->'manual_resolutions', '{}'::jsonb),
          true
        ),
        array['manual_resolutions', p_field_key],
        v_manual,
        true
      ),
      '{manual_resolution}',
      v_manual,
      true
    ),
    match_status = case
      when p_resolution_type = 'canonical' then
        case when p_field_key = 'designer' and b.match_status = 'unmatched' then 'partial' else 'matched' end
      else 'partial'
    end,
    match_confidence = 'verified',
    last_matched_at = now()
  from public.style_tracker_rows r
  where b.style_tracker_row_id = r.id
    and case p_field_key
      when 'sku' then plm.normalize_style_tracker_value('sku', r.sku)
      when 'customer' then plm.normalize_style_tracker_value('customer', r.customer)
      when 'licensor' then plm.normalize_style_tracker_value('licensor', r.licensor)
      when 'designer' then plm.normalize_style_tracker_value('designer', r.designer)
      when 'factory' then plm.normalize_style_tracker_value('factory', r.default_vendor)
    end = v_normalized;

  get diagnostics v_affected_rows = row_count;

  insert into public.style_tracker_audit_log (
    event_type,
    field_key,
    old_value,
    new_value,
    metadata,
    changed_by
  )
  values (
    'value_resolution',
    p_field_key,
    v_previous,
    to_jsonb(v_resolution),
    jsonb_build_object(
      'raw_value', trim(p_raw_value),
      'normalized_value', v_normalized,
      'resolution_type', p_resolution_type,
      'affected_rows', v_affected_rows
    ),
    auth.uid()
  );

  return v_resolution;
end;
$function$;
