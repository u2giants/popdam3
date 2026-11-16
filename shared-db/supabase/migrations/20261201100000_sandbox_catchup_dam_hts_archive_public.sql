-- Sandbox catch-up batch 16 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Owner decision 2026-11-16 (relayed by the coordinator, Albert's words): "the sandbox should also get the asset
-- library, tariff lookup, archive, and general shared tables". Copies production's STRUCTURE (no rows) for the
-- dam, hts_rag, archive and public groups plus api.dam_order_* views, from a schema-only pg_dump of production
-- taken 2026-11-16. Still excluded (coordinator, #6356): production service logins (no grants or policies for
-- them), Nov 15 retired backups, temp_status_watch, the packaging rule naming a person.
-- derived-from: none

set check_function_bodies = off;

alter table dam.asset add column if not exists first_seen_at timestamp with time zone default now();
alter table dam.asset add column if not exists last_seen_at timestamp with time zone default now();
alter table dam.asset add column if not exists missing_since timestamp with time zone;
alter table dam.asset_character add column if not exists is_current boolean default true not null;
alter table dam.asset_character add column if not exists retired_at timestamp with time zone;
alter table dam.asset_character add column if not exists retired_reason text;
alter table dam.style_guide_file add column if not exists has_talent_likeness boolean;
alter table public.assets add column if not exists style_group_changed_at timestamp with time zone default now() not null;
alter table public.dam_search_documents add column if not exists has_default_visible_member boolean;
alter table public.dam_search_documents add column if not exists default_visible_min_date timestamp with time zone;
alter table public.dam_search_documents add column if not exists default_visible_member_count integer;
alter table public.hts_rag_precedents add column if not exists promotion_basis text default 'legacy_unspecified'::text not null;
alter table public.hts_rag_precedents add column if not exists promotion_policy_version text;
alter table public.hts_rag_precedents add column if not exists promotion_source_determination_id uuid;
alter table public.hts_rag_precedents add column if not exists promotion_debate_run_id uuid;
alter table public.hts_rag_precedents add column if not exists promotion_gate_result jsonb;
alter table public.pdf_text_samples add column if not exists ocr_engine text;
alter table public.pdf_text_samples add column if not exists extracted_fields jsonb;
alter table public.pdf_text_samples add column if not exists indra_rescan_at timestamp with time zone;
alter table public.pdf_text_samples add column if not exists indra_rescan_outcome text;
alter table public.pdf_text_samples add column if not exists indra_rescan_error text;
alter table public.pdf_text_samples add column if not exists declared_style_guide_label text;
alter table public.pdf_text_samples add column if not exists declared_style_guide_key text;
alter table public.product_category_predictions add column if not exists plm_item_id uuid;
alter table public.product_category_predictions add column if not exists item_identity_status text default 'unresolved'::text not null;
alter table public.style_groups add column if not exists item_short_description text;
alter table public.style_groups add column if not exists item_short_description_source text;
alter table public.style_groups add column if not exists item_short_description_input text;
alter table public.style_groups add column if not exists item_short_description_model text;
alter table public.style_groups add column if not exists item_short_description_at timestamp with time zone;
alter table public.style_groups add column if not exists style_group_changed_at timestamp with time zone default now() not null;
alter table public.style_guide_crawl_runs add column if not exists lifecycle_state text default 'pending'::text not null;
alter table public.style_guide_crawl_runs add column if not exists ingest_completed_at timestamp with time zone;
alter table public.style_guide_crawl_runs add column if not exists reconcile_started_at timestamp with time zone;
alter table public.style_guide_crawl_runs add column if not exists reconcile_completed_at timestamp with time zone;
alter table public.style_guide_crawl_runs add column if not exists refresh_started_at timestamp with time zone;
alter table public.style_guide_crawl_runs add column if not exists refresh_completed_at timestamp with time zone;
alter table public.style_guide_crawl_runs add column if not exists accepted_for_reconcile boolean default false not null;
alter table public.style_guide_crawl_runs add column if not exists files_upserted integer default 0 not null;
alter table public.style_guide_crawl_runs add column if not exists files_deactivated integer default 0 not null;
alter table public.style_guide_crawl_runs add column if not exists files_reactivated integer default 0 not null;
alter table public.style_guide_crawl_runs add column if not exists reconcile_batches integer default 0 not null;
alter table public.style_guide_crawl_runs add column if not exists stale_candidates_at_start integer;
alter table public.style_guide_crawl_runs add column if not exists stale_remaining integer;
alter table public.style_guide_crawl_runs add column if not exists active_before_reconcile integer;
alter table public.style_guide_crawl_runs add column if not exists guard_state text;
alter table public.style_guide_crawl_runs add column if not exists guard_reason text;
alter table public.style_guide_crawl_runs add column if not exists attention_reason text;
alter table public.style_guide_crawl_runs add column if not exists search_documents_synced integer default 0 not null;
alter table public.style_guide_files add column if not exists has_talent_likeness boolean;
alter table public.assets alter column primary_sort_tier set default 13;

-- SCHEMA -.archive
CREATE SCHEMA IF NOT EXISTS archive;

-- SCHEMA -.dam

-- SCHEMA -.hts_rag
CREATE SCHEMA IF NOT EXISTS hts_rag;

-- FUNCTION dam.assets_enqueue_image_embed_trg_fn()
CREATE OR REPLACE FUNCTION dam.assets_enqueue_image_embed_trg_fn() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam', 'public'
    AS $_$
begin
  begin
    if new.thumbnail_url is not null
       and new.thumbnail_url is distinct from old.thumbnail_url
       and new.thumbnail_url ~* '\.(jpe?g|png|webp)([?#].*)?$'
       and dam.image_embed_enabled()
    then
      perform dam.enqueue_image_embed_index_job(new.id);
    end if;
  exception when others then
    null; -- enqueue failure must not fail ingest
  end;
  return null; -- AFTER trigger
end;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- TABLE dam.image_embed_jobs
CREATE TABLE dam.image_embed_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    asset_id uuid,
    payload bytea,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    result_dino extensions.halfvec(768),
    result_siglip extensions.halfvec(768),
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT image_embed_jobs_attempts_chk CHECK ((attempts >= 0)),
    CONSTRAINT image_embed_jobs_index_needs_asset_chk CHECK (((kind <> 'index'::text) OR (asset_id IS NOT NULL))),
    CONSTRAINT image_embed_jobs_kind_chk CHECK ((kind = ANY (ARRAY['index'::text, 'query'::text]))),
    CONSTRAINT image_embed_jobs_lease_active_chk CHECK (((status <> 'leased'::text) OR ((lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL)))),
    CONSTRAINT image_embed_jobs_lease_pair_chk CHECK (((lease_owner IS NULL) = (lease_expires_at IS NULL))),
    CONSTRAINT image_embed_jobs_payload_kind_chk CHECK (((payload IS NULL) OR (kind = 'query'::text))),
    CONSTRAINT image_embed_jobs_query_needs_payload_chk CHECK (((kind <> 'query'::text) OR (payload IS NOT NULL) OR (status = ANY (ARRAY['done'::text, 'failed'::text])))),
    CONSTRAINT image_embed_jobs_results_query_only_chk CHECK (((kind = 'query'::text) OR ((result_dino IS NULL) AND (result_siglip IS NULL)))),
    CONSTRAINT image_embed_jobs_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'leased'::text, 'done'::text, 'failed'::text])))
);

-- FUNCTION dam.claim_image_embed_jobs(text, integer, text, integer)
CREATE OR REPLACE FUNCTION dam.claim_image_embed_jobs(p_kind text, p_limit integer, p_worker_id text, p_lease_seconds integer) RETURNS SETOF dam.image_embed_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam', 'public'
    AS $$
declare
  v_kind  text    := case p_kind when 'query' then 'query' else 'index' end;
  v_limit int     := case when v_kind = 'query' then 1
                          else greatest(1, least(coalesce(p_limit, 32), 64)) end;
  v_lease int     := greatest(5, least(coalesce(p_lease_seconds,
                          case when v_kind = 'query' then 30 else 300 end), 3600));
  v_worker text   := nullif(btrim(coalesce(p_worker_id, '')), '');
begin
  if v_worker is null then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_WORKER_ID_REQUIRED';
  end if;

  return query
  with candidates as (
    select j.id
    from dam.image_embed_jobs j
    where j.kind = v_kind
      and (j.status = 'pending'
           or (j.status = 'leased' and j.lease_expires_at < now()))
    order by j.created_at
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update dam.image_embed_jobs j
    set status           = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then 'failed' else 'leased' end,
        attempts         = case when j.status = 'leased' then j.attempts + 1
                                else j.attempts end,
        lease_owner      = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then null else v_worker end,
        lease_expires_at = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then null
                                else now() + make_interval(secs => v_lease) end,
        error            = case when j.status = 'leased' and j.attempts + 1 >= 5
                                then left('reclaim poison: attempts >= 5'
                                          || coalesce(': ' || j.error, ''), 1000)
                                else j.error end,
        updated_at       = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from claimed
  where status = 'leased';
end;
$$;

-- FUNCTION dam.complete_image_embed_job(uuid, extensions.halfvec, extensions.halfvec, text, boolean, text)
CREATE OR REPLACE FUNCTION dam.complete_image_embed_job(p_id uuid, p_result_dino extensions.halfvec, p_result_siglip extensions.halfvec, p_embedding_model text, p_border_cropped boolean, p_thumbnail_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam', 'public'
    AS $$
declare
  v_job dam.image_embed_jobs%rowtype;
begin
  if p_result_dino is null or p_result_siglip is null then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_BOTH_LEGS_REQUIRED';
  end if;

  select * into v_job from dam.image_embed_jobs where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DAM_IMAGE_EMBED_JOB_NOT_FOUND';
  end if;
  if v_job.status <> 'leased' then
    raise exception using errcode = '42501', message = 'DAM_IMAGE_EMBED_JOB_NOT_LEASED';
  end if;

  if v_job.kind = 'query' then
    update dam.image_embed_jobs
    set status = 'done',
        result_dino = p_result_dino,
        result_siglip = p_result_siglip,
        payload = null,
        error = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_id;
  else
    if nullif(btrim(coalesce(p_embedding_model, '')), '') is null then
      raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_MODEL_STAMP_REQUIRED';
    end if;

    update dam.image_embed_jobs
    set status = 'done',
        error = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_id;

    perform dam.upsert_dam_asset_image_vectors(
      v_job.asset_id, p_result_dino, p_result_siglip,
      p_embedding_model, p_border_cropped, p_thumbnail_url);

    if exists (select 1 from public.assets a
                where a.id = v_job.asset_id
                  and a.thumbnail_url is distinct from p_thumbnail_url) then
      perform dam.enqueue_image_embed_index_job(v_job.asset_id);
    end if;
  end if;
end;
$$;

-- FUNCTION dam.enforce_asset_freshness()
CREATE OR REPLACE FUNCTION dam.enforce_asset_freshness() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.first_seen_at is null or new.last_seen_at is null then
      raise check_violation using message = 'new Asset requires first_seen_at and last_seen_at';
    end if;
  else
    if (old.first_seen_at is not null and new.first_seen_at is null)
       or (old.last_seen_at is not null and new.last_seen_at is null) then
      raise check_violation using message = 'recorded Asset freshness cannot become unknown';
    end if;
  end if;
  return new;
end;
$$;

-- FUNCTION dam.enqueue_image_embed_index_job(uuid)
CREATE OR REPLACE FUNCTION dam.enqueue_image_embed_index_job(p_asset_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam', 'public'
    AS $$
begin
  insert into dam.image_embed_jobs (kind, asset_id)
  values ('index', p_asset_id)
  on conflict (asset_id) where kind = 'index' and status in ('pending', 'leased')
  do nothing;
end;
$$;

-- FUNCTION dam.fail_image_embed_job(uuid, text, boolean)
CREATE OR REPLACE FUNCTION dam.fail_image_embed_job(p_id uuid, p_error text, p_permanent boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
begin
  update dam.image_embed_jobs
  set attempts = attempts + 1,
      status = case when p_permanent or attempts + 1 >= 5 then 'failed' else 'pending' end,
      lease_owner = null,
      lease_expires_at = null,
      payload = case when p_permanent or attempts + 1 >= 5 then null else payload end,
      error = left(coalesce(nullif(btrim(p_error), ''), 'unknown image-embed error'), 1000),
      updated_at = now()
  where id = p_id
    and status = 'leased';

  if not found then
    raise exception using errcode = '42501', message = 'DAM_IMAGE_EMBED_JOB_NOT_LEASED';
  end if;
end;
$$;

-- FUNCTION dam.get_image_embed_asset_thumbnails(uuid[])
CREATE OR REPLACE FUNCTION dam.get_image_embed_asset_thumbnails(p_asset_ids uuid[]) RETURNS TABLE(asset_id uuid, thumbnail_url text, is_deleted boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.id, a.thumbnail_url, a.is_deleted
  from public.assets a
  where a.id = any (coalesce(p_asset_ids, '{}'::uuid[]))
    and a.thumbnail_url is not null;
$$;

-- FUNCTION dam.image_embed_enabled()
CREATE OR REPLACE FUNCTION dam.image_embed_enabled() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select c.value #>> '{}' ilike 'true'
       from public.admin_config c
      where c.key = 'IMAGE_EMBED_ENABLED'),
    false);
$$;

-- FUNCTION dam.image_embed_purge_jobs()
CREATE OR REPLACE FUNCTION dam.image_embed_purge_jobs() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
declare
  v_deleted integer;
begin
  delete from dam.image_embed_jobs
  where status in ('done', 'failed')
    and updated_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- FUNCTION dam.image_embed_worker_heartbeat(text)
CREATE OR REPLACE FUNCTION dam.image_embed_worker_heartbeat(p_worker_id text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
  insert into dam.image_embed_worker_heartbeat (worker_id, seen_at)
  values (nullif(btrim(p_worker_id), ''), now())
  on conflict (worker_id) do update
  set seen_at = now();
$$;

-- FUNCTION dam.image_embed_workers_fresh(integer)
CREATE OR REPLACE FUNCTION dam.image_embed_workers_fresh(p_stale_seconds integer DEFAULT 90) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
  select exists (
    select 1 from dam.image_embed_worker_heartbeat
    where seen_at > now() - make_interval(secs => least(greatest(coalesce(p_stale_seconds, 90), 1), 86400))
  );
$$;

-- FUNCTION dam.orderlist_cargo_forecast(text, text, date)
CREATE OR REPLACE FUNCTION dam.orderlist_cargo_forecast(p_type text, p_ship_to text, p_start date) RETURNS date
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case when nullif(btrim(p_type),'') is null or p_start is null then null
    when p_type = 'FOB' then p_start - 7
    when p_type = 'C Stock' and upper(btrim(p_ship_to)) = 'NJ' then p_start - 37
    when upper(btrim(p_ship_to)) in ('NY','NJ') then p_start - 44
    when upper(btrim(p_ship_to)) in ('LA','CA') then p_start - 23
    when upper(btrim(p_ship_to)) = 'NC' then p_start - 46
    else null end;
$$;

-- FUNCTION dam.orderlist_license_status(jsonb, boolean)
CREATE OR REPLACE FUNCTION dam.orderlist_license_status(p_row jsonb, p_discontinued boolean) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case when p_discontinued is true then 'Discontinue'
    when nullif(btrim(case when p_row ? 'production_approval' then p_row->>'production_approval' else p_row->>'AC' end), '') is not null then 'Production Approved'
    when nullif(btrim(case when p_row ? 'pre_production_approval' then p_row->>'pre_production_approval' else p_row->>'AB' end), '') is not null then 'Pre-Pro Approved'
    when nullif(btrim(case when p_row ? 'pre_production_approved_comment' then p_row->>'pre_production_approved_comment' else p_row->>'AA' end), '') is not null then 'Pre Production approved w/comment'
    when nullif(btrim(case when p_row ? 'pre_production_resubmitted' then p_row->>'pre_production_resubmitted' else p_row->>'Z' end), '') is not null then 'Pre-Pro Resubmitted'
    when nullif(btrim(case when p_row ? 'pre_production_resubmit' then p_row->>'pre_production_resubmit' else p_row->>'Y' end), '') is not null then 'Pre-Pro Resubmit'
    when nullif(btrim(case when p_row ? 'pre_production_sent' then p_row->>'pre_production_sent' else p_row->>'X' end), '') is not null then 'Sample Submitted'
    when nullif(btrim(case when p_row ? 'sample_photos_received' then p_row->>'sample_photos_received' else p_row->>'W' end), '') is not null then 'Sample Received'
    when nullif(btrim(case when p_row ? 'request_pre_production_sample' then p_row->>'request_pre_production_sample' else p_row->>'T' end), '') is not null then 'Requested Sample'
    when nullif(btrim(case when p_row ? 'concept_approved_with_comments' then p_row->>'concept_approved_with_comments' else p_row->>'S' end), '') is not null then 'Concept Approved with Comments'
    when nullif(btrim(case when p_row ? 'concept_approval' then p_row->>'concept_approval' else p_row->>'R' end), '') is not null then 'Concept Approved'
    when nullif(btrim(case when p_row ? 'concept_resubmitted' then p_row->>'concept_resubmitted' else p_row->>'Q' end), '') is not null then 'Concept Resubmitted'
    when nullif(btrim(case when p_row ? 'concept_resubmit' then p_row->>'concept_resubmit' else p_row->>'P' end), '') is not null then 'Concept Resubmit'
    when nullif(btrim(case when p_row ? 'concept_sent' then p_row->>'concept_sent' else p_row->>'O' end), '') is not null then 'Concept Requested'
    else 'No Info' end;
$$;

-- FUNCTION dam.orderlist_parse_boolean(text)
CREATE OR REPLACE FUNCTION dam.orderlist_parse_boolean(p_value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case lower(btrim(p_value))
    when 'true' then true when 'yes' then true when '1' then true when '☑️' then true
    when 'false' then false when 'no' then false when '0' then false
    else null end;
$$;

-- FUNCTION dam.orderlist_parse_number(text)
CREATE OR REPLACE FUNCTION dam.orderlist_parse_number(p_value text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare v numeric;
begin
  if nullif(btrim(p_value),'') is null then return null; end if;
  v:=p_value::numeric;
  if v::text in ('NaN','Infinity','-Infinity') then return null; end if;
  return v;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$$;

-- FUNCTION dam.orderlist_po_status(text, text, text, numeric, numeric, boolean, text, date, date, date, text)
CREATE OR REPLACE FUNCTION dam.orderlist_po_status(p_type text, p_style text, p_assortment text, p_qty numeric, p_pack numeric, p_closed boolean, p_booking text, p_etd date, p_delivery date, p_sent date, p_po text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case
    when nullif(btrim(p_type),'') is null and nullif(btrim(p_style),'') is null and nullif(btrim(p_assortment),'') is null then null
    when nullif(btrim(p_type),'') is null or p_qty is null or p_pack is null then 'Not Enough Line Info'
    when p_closed is true then 'Close tracking'
    when p_type = 'FOB' and p_booking = 'Booked' then 'Booked FOB'
    when p_type <> 'FOB' and p_etd is not null then 'Confirmed Booking'
    when p_type <> 'FOB' and p_booking = 'Booked' then 'Requesting Booking'
    when p_delivery is not null then 'Confirmed CRD'
    when p_sent is not null then 'Sent PO'
    when nullif(btrim(p_po),'') is null then 'PO Not Create'
    else 'Creating PO' end;
$$;

-- FUNCTION dam.orderlist_product_facts(uuid, text)
CREATE OR REPLACE FUNCTION dam.orderlist_product_facts(p_item_id uuid, p_catalog text) RETURNS TABLE(facts jsonb)
    LANGUAGE sql STABLE ROWS 1
    BEGIN ATOMIC
 WITH exact_links AS MATERIALIZED (
          SELECT b.id AS bridge_id,
             b.style_tracker_row_id AS tracker_id
            FROM plm.style_tracker_item_bridge b
           WHERE ((b.plm_item_id = orderlist_product_facts.p_item_id) AND ((orderlist_product_facts.p_catalog IS NULL) OR (b.tracker_type = orderlist_product_facts.p_catalog)))
         ), fallback_links AS MATERIALIZED (
          SELECT b.id AS bridge_id,
             s.id AS tracker_id
            FROM (((plm.item target
              JOIN public.style_tracker_rows s ON (((lower(btrim(s.sku)) = lower(btrim(COALESCE(NULLIF(btrim(target.style_number), ''::text), NULLIF(btrim(target.item_number), ''::text))))) AND (s.tracker_type = orderlist_product_facts.p_catalog))))
              JOIN plm.style_tracker_item_bridge b ON (((b.style_tracker_row_id = s.id) AND (b.tracker_type = orderlist_product_facts.p_catalog))))
              JOIN plm.item linked ON ((linked.id = b.plm_item_id)))
           WHERE ((target.id = orderlist_product_facts.p_item_id) AND (target.source_system = 'coldlion'::text) AND (linked.source_system = 'coldlion'::text) AND (orderlist_product_facts.p_catalog = ANY (ARRAY['licensed'::text, 'generic'::text])) AND (NULLIF(btrim((target.raw ->> 'companyCode'::text)), ''::text) IS NOT NULL) AND (btrim((linked.raw ->> 'companyCode'::text)) = btrim((target.raw ->> 'companyCode'::text))) AND (NOT (EXISTS ( SELECT 1
                    FROM exact_links))))
         ), links AS (
          SELECT exact_links.bridge_id,
             exact_links.tracker_id,
             false AS is_fallback
            FROM exact_links
         UNION ALL
          SELECT fallback_links.bridge_id,
             fallback_links.tracker_id,
             true
            FROM fallback_links
         ), candidates AS (
          SELECT b.id AS bridge_id,
             s.id AS tracker_id,
             s.tracker_type,
             links.is_fallback,
             jsonb_build_object('license_status',
                 CASE
                     WHEN (s.tracker_type = 'generic'::text) THEN 'Generic Item'::text
                     WHEN (s.tracker_type = 'licensed'::text) THEN dam.orderlist_license_status(s.row_data, s.discontinued)
                     ELSE s.license_status
                 END, 'licensor', s.licensor, 'customer', s.customer, 'default_vendor', s.default_vendor, 'sample_vendor',
                 CASE
                     WHEN (s.row_data ? 'sample_vendor'::text) THEN (s.row_data ->> 'sample_vendor'::text)
                     ELSE (s.row_data ->>
                     CASE
                         WHEN (s.tracker_type = 'licensed'::text) THEN 'U'::text
                         ELSE 'S'::text
                     END)
                 END, 'test_report', dam.orderlist_parse_boolean(
                 CASE
                     WHEN (s.row_data ? 'test_report'::text) THEN (s.row_data ->> 'test_report'::text)
                     ELSE (s.row_data ->>
                     CASE
                         WHEN (s.tracker_type = 'licensed'::text) THEN 'AI'::text
                         ELSE 'AE'::text
                     END)
                 END), 'professional_photos', dam.orderlist_parse_boolean(
                 CASE
                     WHEN (s.row_data ? 'professional_photos'::text) THEN (s.row_data ->> 'professional_photos'::text)
                     ELSE (s.row_data ->>
                     CASE
                         WHEN (s.tracker_type = 'licensed'::text) THEN 'AH'::text
                         ELSE 'AD'::text
                     END)
                 END), 'contractual_sample_reorder',
                 CASE
                     WHEN (s.tracker_type = 'licensed'::text) THEN dam.orderlist_parse_boolean(
                     CASE
                         WHEN (s.row_data ? 'contractual_samples_reorder'::text) THEN (s.row_data ->> 'contractual_samples_reorder'::text)
                         ELSE (s.row_data ->> 'AO'::text)
                     END)
                     ELSE NULL::boolean
                 END) AS facts
            FROM ((links
              JOIN plm.style_tracker_item_bridge b ON ((b.id = links.bridge_id)))
              JOIN public.style_tracker_rows s ON ((s.id = links.tracker_id)))
         ), summary AS (
          SELECT count(*) AS row_count,
             count(DISTINCT candidates.facts) AS distinct_facts,
             (bool_or(candidates.is_fallback) AND (count(DISTINCT candidates.tracker_id) > 1)) AS fallback_ambiguous,
             (array_agg(candidates.facts))[1] AS facts,
                 CASE
                     WHEN (count(*) = 1) THEN (array_agg(candidates.bridge_id))[1]
                     ELSE NULL::uuid
                 END AS bridge_id,
                 CASE
                     WHEN (count(*) = 1) THEN (array_agg(candidates.tracker_id))[1]
                     ELSE NULL::uuid
                 END AS tracker_id,
                 CASE
                     WHEN (count(DISTINCT candidates.tracker_type) = 1) THEN min(candidates.tracker_type)
                     ELSE NULL::text
                 END AS tracker_type
            FROM candidates
         )
  SELECT (
         CASE
             WHEN ((summary.distinct_facts = 1) AND (NOT summary.fallback_ambiguous)) THEN summary.facts
             ELSE '{}'::jsonb
         END || jsonb_build_object('source',
         CASE
             WHEN (summary.row_count = 0) THEN 'unavailable'::text
             WHEN ((summary.distinct_facts > 1) OR summary.fallback_ambiguous) THEN 'ambiguous'::text
             ELSE 'master_data'::text
         END, 'bridge_id', summary.bridge_id, 'tracker_id', summary.tracker_id, 'tracker_type', summary.tracker_type))
    FROM summary;
END;

-- FUNCTION dam.orderlist_sales_order_received_date(text)
CREATE OR REPLACE FUNCTION dam.orderlist_sales_order_received_date(p_coldlion_source_id text) RETURNS date
    LANGUAGE sql STABLE STRICT SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
  select case when count(*) = count(h.created_time)
    and count(distinct h.created_time) = 1
    and min(h.created_time) > timestamptz '2000-01-01 00:00:00+00'
  then (min(h.created_time) at time zone 'America/New_York')::date end
  from coldlion.order_history_line h
  where h.company_code = 'EDGEHOME'
    and h.sales_order_no = case
      when p_coldlion_source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,10}:component:[1-9][0-9]{0,9}$'
      then split_part(p_coldlion_source_id, ':', 3)::bigint end
$_$;

-- FUNCTION dam.path_as_of(text, text, timestamp with time zone)
CREATE OR REPLACE FUNCTION dam.path_as_of(p_share text, p_path text, p_at timestamp with time zone) RETURNS text
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  r record;
  v text := p_path;
begin
  if v is null or p_at is null then
    return null;
  end if;
  -- Events after p_at, newest first. A rename moved old->new at renamed_at;
  -- a revert moved new->old at reverted_at. Undo each: map "to" back to "from".
  for r in
    select e.from_path, e.to_path
    from (
      select l.old_path as from_path, l.new_path as to_path, l.renamed_at as at, l.id, 0 as kind
      from dam.folder_rename_log l
      where l.share = p_share and l.renamed_at > p_at
      union all
      select l.new_path, l.old_path, l.reverted_at, l.id, 1
      from dam.folder_rename_log l
      where l.share = p_share and l.reverted_at is not null and l.reverted_at > p_at
    ) e
    order by e.at desc, e.id desc, e.kind desc
  loop
    if v = r.to_path then
      v := r.from_path;
    elsif left(v, length(r.to_path) + 1) = r.to_path || '/' then
      v := r.from_path || substr(v, length(r.to_path) + 1);
    end if;
  end loop;
  return v;
end;
$$;

-- FUNCTION dam.path_candidates(text, uuid)
CREATE OR REPLACE FUNCTION dam.path_candidates(p_share text, p_asset_id uuid) RETURNS SETOF text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with recursive seeds as (
    select a.relative_path as p from public.assets a where a.id = p_asset_id
    union
    select h.old_relative_path from public.asset_path_history h where h.asset_id = p_asset_id
    union
    select h.new_relative_path from public.asset_path_history h where h.asset_id = p_asset_id
  ),
  -- every folder pair that was ever swapped, in either direction (a reverted
  -- rename means the file sat under new_path for a while, then under old_path)
  edges as (
    select l.new_path as to_path, l.old_path as from_path
    from dam.folder_rename_log l where l.share = p_share
    union
    select l.old_path, l.new_path
    from dam.folder_rename_log l where l.share = p_share and l.reverted_at is not null
  ),
  walk(p, depth) as (
    select p, 0 from seeds where p is not null
    union
    select case when w.p = e.to_path then e.from_path
                else e.from_path || substr(w.p, length(e.to_path) + 1) end,
           w.depth + 1
    from walk w
    join edges e on (w.p = e.to_path or left(w.p, length(e.to_path) + 1) = e.to_path || '/')
    where w.depth < 50
  )
  select distinct p from walk;
$$;

-- FUNCTION dam.rollup_moved_pdf_rich_extraction_groups()
CREATE OR REPLACE FUNCTION dam.rollup_moved_pdf_rich_extraction_groups() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam', 'pg_temp'
    AS $$
declare
  v_gids uuid[];
  v_gid uuid;
begin
  if pg_catalog.to_regclass('pg_temp.pdf_rich_extraction_moved_groups') is null then
    return null;
  end if;

  with drained as (
    delete from pg_temp.pdf_rich_extraction_moved_groups returning style_group_id
  )
  select array_agg(distinct style_group_id) into v_gids from drained
  where style_group_id is not null;

  foreach v_gid in array coalesce(v_gids, '{}'::uuid[]) loop
    perform public.refresh_style_group_rich_metadata(v_gid);
    perform public.refresh_dam_search_style_group_document(v_gid);
  end loop;

  return null;
end;
$$;

-- FUNCTION dam.search_embedding_image_provenance(uuid, text, jsonb)
CREATE OR REPLACE FUNCTION dam.search_embedding_image_provenance(p_asset_id uuid, p_thumbnail_url text, p_previous jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
declare a record; v_render timestamptz; v_cached jsonb; v_input jsonb; v_invalid_previous boolean:=false;
begin
  if p_asset_id is null or nullif(btrim(p_thumbnail_url),'') is null then return null; end if;
  select modified_at,file_size,thumbnail_url into a from public.assets where id=p_asset_id and not is_deleted;
  if not found or a.thumbnail_url is distinct from p_thumbnail_url then return null; end if;
  select metadata->'_embedding_input' into v_cached from public.dam_search_documents
    where document_type='asset' and entity_id=p_asset_id;
  select q.completed_at into v_render from public.render_queue q
    where q.asset_id=p_asset_id and q.status='completed' and q.completed_at is not null
    order by q.completed_at desc limit 1;
  -- Keep the last observed successful render after queue retention removes it.
  if p_previous->>'asset_id'=p_asset_id::text then
    begin
      v_render:=greatest(v_render,(p_previous->>'render_completed_at')::timestamptz);
    exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
      v_invalid_previous:=true;
    end;
  end if;
  if v_cached->>'asset_id'=p_asset_id::text then
    begin
      v_render:=greatest(v_render,(v_cached->>'render_completed_at')::timestamptz);
    exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
      v_invalid_previous:=true;
    end;
  end if;
  if a.modified_at is null and v_render is null and not v_invalid_previous then return null; end if;
  v_input:=jsonb_strip_nulls(jsonb_build_object('version',1,'model','google/siglip2-base-patch16-naflex',
    'image_transform','uncropped-thumbnail','asset_id',p_asset_id,'thumbnail_url',p_thumbnail_url,
    'source_modified_at',a.modified_at,'source_file_size',a.file_size,'render_completed_at',v_render,
    'invalid_previous',case when v_invalid_previous then true end));
  return v_input||jsonb_build_object('sha256',encode(digest(v_input::text,'sha256'),'hex'));
end $$;

-- FUNCTION dam.search_embedding_inputs_match(jsonb, jsonb, text, text, text, timestamp with time zone, timestamp with time zone)
CREATE OR REPLACE FUNCTION dam.search_embedding_inputs_match(p_old jsonb, p_new jsonb, p_old_text_hash text, p_new_text_hash text, p_model text, p_vector_at timestamp with time zone, p_indexed_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare v_source timestamptz; v_render timestamptz;
begin
 -- Validate JSON dates even on the equal-hash path. Corruption must abstain,
 -- never abort an ordinary tagging/source transaction.
 v_source:=(p_new->'_embedding_input'->>'source_modified_at')::timestamptz;
 v_render:=(p_new->'_embedding_input'->>'render_completed_at')::timestamptz;
 if p_new->'_embedding_input'->>'invalid_previous'='true' then return false; end if;
 return coalesce(case
 when p_new->'_embedding_input'->>'sha256' is not null and p_old->'_embedding_input'->>'sha256' is not null
 then p_new->'_embedding_input'->>'sha256'=p_old->'_embedding_input'->>'sha256'
   and (p_model='google/siglip2-base-patch16-naflex' or (p_model is null and p_vector_at is null))
 when p_new->'_embedding_input'->>'sha256' is not null then
   -- Bootstrap only a proven same-image canonical vector or an existing job
   -- newer than the authoritative source/render revision; never library reset.
   p_old->>'thumbnail_url'=p_new->>'thumbnail_url'
   -- The size trigger identifies only the asset whose source actually changed.
   and current_setting('dam.search_image_size_changed_asset',true) is distinct from p_new->'_embedding_input'->>'asset_id'
   and (p_model='google/siglip2-base-patch16-naflex' or (p_model is null and p_vector_at is null))
   and coalesce(p_vector_at,p_indexed_at)>=greatest(v_source,v_render)
 when p_old->'_embedding_input'->>'sha256' is not null then false
 else p_old_text_hash=p_new_text_hash and p_old->>'thumbnail_url' is not distinct from p_new->>'thumbnail_url'
 end,false);
exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
 return false;
end $$;

-- FUNCTION dam.sync_pdf_rich_extraction_style_group()
CREATE OR REPLACE FUNCTION dam.sync_pdf_rich_extraction_style_group() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam', 'pg_temp'
    AS $$
begin
  update dam.pdf_rich_extraction e
  set style_group_id = new.style_group_id
  where e.asset_id = new.id
    and e.style_group_id is distinct from new.style_group_id;

  if found then
    create temporary table if not exists pg_temp.pdf_rich_extraction_moved_groups (
      style_group_id uuid primary key
    ) on commit drop;
    insert into pg_temp.pdf_rich_extraction_moved_groups (style_group_id)
    select g from unnest(array[old.style_group_id, new.style_group_id]) g
    where g is not null
    on conflict do nothing;
  end if;

  return null;
end;
$$;

-- FUNCTION dam.sync_search_group_vectors()
CREATE OR REPLACE FUNCTION dam.sync_search_group_vectors() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'dam', 'extensions'
    AS $$
begin
  if TG_OP <> 'INSERT' and OLD.document_type = 'style_group' then
    if TG_OP = 'DELETE' then
      delete from dam.search_group_vectors where entity_id = OLD.entity_id;
      return OLD;
    end if;
    if NEW.document_type <> 'style_group' or NEW.embedding is null or NEW.entity_id <> OLD.entity_id then
      delete from dam.search_group_vectors where entity_id = OLD.entity_id;
    end if;
  end if;
  if TG_OP <> 'DELETE' and NEW.document_type = 'style_group' and NEW.embedding is not null then
    insert into dam.search_group_vectors(entity_id,document_type,asset_id,style_group_id,embedding,embedding_model)
    values (NEW.entity_id,NEW.document_type,NEW.asset_id,NEW.style_group_id,NEW.embedding,NEW.embedding_model)
    on conflict(entity_id) do update set
      asset_id=excluded.asset_id,style_group_id=excluded.style_group_id,
      embedding=excluded.embedding,embedding_model=excluded.embedding_model
    where (search_group_vectors.asset_id,search_group_vectors.style_group_id,search_group_vectors.embedding,search_group_vectors.embedding_model)
      is distinct from (excluded.asset_id,excluded.style_group_id,excluded.embedding,excluded.embedding_model);
  end if;
  return NEW;
end;
$$;

-- FUNCTION dam.upsert_dam_asset_image_vectors(uuid, extensions.halfvec, extensions.halfvec, text, boolean, text)
CREATE OR REPLACE FUNCTION dam.upsert_dam_asset_image_vectors(p_asset_id uuid, p_vec_dino extensions.halfvec, p_vec_siglip extensions.halfvec, p_embedding_model text, p_border_cropped boolean, p_last_embedded_thumbnail_url text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
  insert into dam.dam_asset_image_vectors (
    asset_id, vec_dino, vec_siglip, embedding_model,
    border_cropped, last_embedded_thumbnail_url, computed_at
  )
  values (
    p_asset_id, p_vec_dino, p_vec_siglip, btrim(p_embedding_model),
    coalesce(p_border_cropped, false), p_last_embedded_thumbnail_url, now()
  )
  on conflict (asset_id) do update
  set vec_dino                    = excluded.vec_dino,
      vec_siglip                  = excluded.vec_siglip,
      embedding_model             = excluded.embedding_model,
      border_cropped              = excluded.border_cropped,
      last_embedded_thumbnail_url = excluded.last_embedded_thumbnail_url,
      computed_at                 = now();
$$;

-- FUNCTION hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable()
CREATE OR REPLACE FUNCTION hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.promotion_gate_result is not null
     and new.promotion_gate_result is distinct from old.promotion_gate_result then
    raise exception using
      errcode = '23514',
      message = 'hts_rag_precedents.promotion_gate_result is immutable once set';
  end if;
  return new;
end
$$;

-- FUNCTION hts_rag.hts_rag_refresh_fault_lines()
CREATE OR REPLACE FUNCTION hts_rag.hts_rag_refresh_fault_lines() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '5min'
    AS $$
begin
  if exists (select 1 from pg_matviews where schemaname = 'hts_rag' and matviewname = 'hts_rag_fault_lines' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_fault_lines;
  else
    refresh materialized view hts_rag.hts_rag_fault_lines;
  end if;
  if exists (select 1 from pg_matviews where schemaname = 'hts_rag' and matviewname = 'hts_rag_fault_lines_any_type' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_fault_lines_any_type;
  else
    refresh materialized view hts_rag.hts_rag_fault_lines_any_type;
  end if;
end;
$$;

-- FUNCTION hts_rag.hts_rag_refresh_type_heading_stats()
CREATE OR REPLACE FUNCTION hts_rag.hts_rag_refresh_type_heading_stats() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists (select 1 from pg_matviews
              where schemaname = 'hts_rag' and matviewname = 'hts_rag_type_heading_stats' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_type_heading_stats;
  else
    refresh materialized view hts_rag.hts_rag_type_heading_stats;
  end if;
end;
$$;

-- FUNCTION hts_rag.hts_rag_search_rulings(text, text[], integer, extensions.halfvec, integer)
CREATE OR REPLACE FUNCTION hts_rag.hts_rag_search_rulings(p_query text, p_chapters text[] DEFAULT NULL::text[], p_limit integer DEFAULT 20, p_query_embedding extensions.halfvec DEFAULT NULL::extensions.halfvec, p_min_pass1 integer DEFAULT 5) RETURNS TABLE(ruling_number text, subject text, ruling_date date, held_codes text[], score double precision, fts_rank integer, trgm_rank integer, vector_rank integer, in_candidate_chapters boolean, pass smallint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  with params as materialized (
    select btrim(coalesce(p_query, '')) as q,
           -- OR of the query's words: a product phrase rarely matches with AND; cover-density
           -- ranking still puts rulings that contain more of the words, and in the subject, first.
           nullif(replace(plainto_tsquery('english'::regconfig, btrim(coalesce(p_query, '')))::text, ' & ', ' | '), '')::tsquery as tsq,
           (select array_agg(distinct c) from unnest(p_chapters) c where c ~ '^[0-9]{2}$') as chapters,
           least(greatest(coalesce(p_limit, 20), 1), 100) as lim
  ),
  pass1_params as materialized (
    select * from params p
    where p.chapters is not null and (p.q <> '' or p_query_embedding is not null)
  ),
  pass1 as materialized (
    select h.*, 1::smallint as pass
    from pass1_params p
    cross join lateral hts_rag.hts_rag_search_rulings_pass(p.q, p.tsq, p_query_embedding, p.chapters) h
  ),
  pass2_params as materialized (
    select * from params p
    where (p.q <> '' or p_query_embedding is not null)
      and (p.chapters is null or (select count(*) from pass1) < least(coalesce(p_min_pass1, 5), p.lim))
  ),
  pass2 as materialized (
    select h.*, 2::smallint as pass
    from pass2_params p
    cross join lateral hts_rag.hts_rag_search_rulings_pass(p.q, p.tsq, p_query_embedding, null) h
  ),
  hits as (
    select * from pass1
    union all
    select * from pass2 where pass2.ruling_number not in (select pass1.ruling_number from pass1)
  ),
  scored as (
    select h.*,
           h.pass = 1 or exists (
             select 1 from params p, hts_rag.hts_rag_ruling_codes c
             where p.chapters is not null and c.ruling_number = h.ruling_number
               and c.role = 'held' and left(c.code, 2) = any (p.chapters)) as in_chapter
    from hits h
  )
  select r.ruling_number, r.subject, r.ruling_date,
         coalesce((select array_agg(distinct c.code order by c.code)
                   from hts_rag.hts_rag_ruling_codes c
                   where c.ruling_number = r.ruling_number and c.role = 'held'), '{}'::text[]),
         coalesce(1.0 / (60 + s.fts_rank), 0) + coalesce(1.0 / (60 + s.trgm_rank), 0)
           + coalesce(1.0 / (60 + s.vector_rank), 0)
           + case when s.in_chapter and s.pass = 2 then 1.0 / (60 + 1) else 0 end,
         s.fts_rank, s.trgm_rank, s.vector_rank, s.in_chapter, s.pass
  from scored s
  join hts_rag.hts_rag_rulings r on r.ruling_number = s.ruling_number
  order by 5 desc, r.ruling_date desc nulls last, r.ruling_number
  limit (select lim from params)
$_$;

-- FUNCTION hts_rag.hts_rag_search_rulings_pass(text, tsquery, extensions.halfvec, text[])
CREATE OR REPLACE FUNCTION hts_rag.hts_rag_search_rulings_pass(p_query text, p_tsquery tsquery, p_query_embedding extensions.halfvec, p_scope_chapters text[]) RETURNS TABLE(ruling_number text, fts_rank integer, trgm_rank integer, vector_rank integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    SET "pg_trgm.word_similarity_threshold" TO '0.4'
    AS $$
  with recursive scope as materialized (
    select distinct c.ruling_number
    from hts_rag.hts_rag_ruling_codes c
    where p_scope_chapters is not null and c.role = 'held' and left(c.code, 2) = any (p_scope_chapters)
  ),
  -- The query's distinct stems (at most 8). The full-text pass matches rulings that
  -- contain all of them, or at least half of them, instead of any one of them: an OR of
  -- every word matched ~16k rulings for a 4-word query, and ranking that many read
  -- thousands of pages from disk once the cache was cold (98-120 s per call, #5305).
  lex as materialized (
    select w, row_number() over (order by w) as i
    from (select w from unnest(tsvector_to_array(to_tsvector('english'::regconfig, coalesce(p_query, '')))) w
          where p_tsquery is not null order by w limit 8) x
  ),
  need as materialized (
    select greatest(1, ceil(count(*) / 2.0))::integer as k, count(*)::integer as n from lex
  ),
  combo (last_i, n, expr) as (
    select l.i, 1, quote_literal(l.w) from lex l
    union all
    select l.i, c.n + 1, c.expr || ' & ' || quote_literal(l.w)
    from combo c join lex l on l.i > c.last_i
    where c.n < (select k from need)
  ),
  ftsq as materialized (
    select (select string_agg(quote_literal(l.w), ' & ')::tsquery from lex l) as all_q,
           (select string_agg('(' || c.expr || ')', ' | ')::tsquery from combo c where c.n = (select k from need)) as most_q
  ),
  -- Every candidate costs one heap page, and on a cold cache each page is a disk
  -- read, so the pass reads at most 300 rulings: those holding every stem first,
  -- then rulings holding half the stems only to fill the remainder (#5305).
  all_hits as materialized (
    select r.ruling_number, r.subject, r.ruling_date, true as all_words
    from hts_rag.hts_rag_rulings r
    where r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and r.search_tsv @@ (select all_q from ftsq)
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
    limit 300
  ),
  most_hits as (
    select r.ruling_number, r.subject, r.ruling_date, false as all_words
    from hts_rag.hts_rag_rulings r
    where (select count(*) from all_hits) < 300
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and r.search_tsv @@ (select most_q from ftsq)
      and r.ruling_number not in (select a.ruling_number from all_hits a)
      and (p_scope_chapters is null or r.ruling_number in (select s.ruling_number from scope s))
    limit (select 300 - count(*) from all_hits)
  ),
  fts_hits as (
    select * from all_hits
    union all
    select * from most_hits
  ),
  -- Rank by the subject line, not the TOASTed full-text vector: rulings holding every
  -- word first, then subject relevance, then the newest.
  fts as (
    select f.ruling_number,
           row_number() over (order by f.all_words desc,
                                       ts_rank(to_tsvector('english'::regconfig, coalesce(f.subject, '')), p_tsquery) desc,
                                       f.ruling_date desc nulls last, f.ruling_number)::integer as rnk
    from fts_hits f
    order by rnk
    limit 200
  ),
  -- The trigram candidates are materialized WITHOUT the chapter scope first, so
  -- the planner uses hts_rag_rulings_subject_trgm_active_idx instead of probing
  -- the scope list and re-checking the similarity filter per row (the measured
  -- 5.6s/3.8s scope-driven shape, #5283).
  trgm_candidates as materialized (
    select r.ruling_number, r.subject, r.ruling_date
    from hts_rag.hts_rag_rulings r
    where p_query <> ''
      and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
      and lower(p_query) operator(extensions.<%) lower(r.subject)
  ),
  trgm as (
    select c.ruling_number,
           row_number() over (order by extensions.word_similarity(lower(p_query), lower(c.subject)) desc, c.ruling_date desc nulls last, c.ruling_number)::integer as rnk
    from trgm_candidates c
    where (p_scope_chapters is null or c.ruling_number in (select s.ruling_number from scope s))
    order by rnk
    limit 200
  ),
  vec as (
    select n.ruling_number, row_number() over (order by min(n.distance), n.ruling_number)::integer as rnk
    from (
      select rp.ruling_number, rp.phrase_embedding operator(extensions.<=>) p_query_embedding as distance
      from hts_rag.hts_rag_ruling_products rp
      join hts_rag.hts_rag_rulings r on r.ruling_number = rp.ruling_number
      where p_query_embedding is not null
        and rp.phrase_embedding is not null
        and rp.effective_status = 'active' and rp.review_state = 'trusted'
        and r.effective_status = 'active' and not coalesce(r.operationally_revoked, false)
        and (p_scope_chapters is null or rp.held_chapter = any (p_scope_chapters))
      order by rp.phrase_embedding operator(extensions.<=>) p_query_embedding
      limit 200
    ) n
    group by n.ruling_number
  )
  select coalesce(f.ruling_number, t.ruling_number, v.ruling_number), f.rnk, t.rnk, v.rnk
  from fts f
  full join trgm t on t.ruling_number = f.ruling_number
  full join vec v on v.ruling_number = coalesce(f.ruling_number, t.ruling_number)
$$;

-- FUNCTION hts_rag.prune_ruling_ingest_jobs(boolean)
CREATE OR REPLACE FUNCTION hts_rag.prune_ruling_ingest_jobs(p_dry_run boolean DEFAULT true) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'hts_rag'
    SET lock_timeout TO '2s'
    AS $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
  v_total bigint := 0;
  v_batch bigint;
begin
  if p_dry_run then
    select count(*) into v_total
      from hts_rag.hts_rag_ruling_ingest_jobs
     where status = 'done' and completed_at < v_cutoff;
    return v_total;
  end if;
  loop
    delete from hts_rag.hts_rag_ruling_ingest_jobs j
     where j.id in (select id from hts_rag.hts_rag_ruling_ingest_jobs
                     where status = 'done' and completed_at < v_cutoff
                     limit 20000);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch = 0;
  end loop;
  return v_total;
end;
$$;

-- FUNCTION hts_rag.validate_affected_product_ids()
CREATE OR REPLACE FUNCTION hts_rag.validate_affected_product_ids() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  if new.affected_product_ids is not null then
    foreach v_id in array new.affected_product_ids loop
      if not exists (select 1 from hts_rag.hts_rag_ruling_products where id = v_id) then
        raise exception 'affected_product_ids contains unknown product %', v_id;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- FUNCTION hts_rag.validate_sentence_provenance()
CREATE OR REPLACE FUNCTION hts_rag.validate_sentence_provenance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_ruling text;
  v_seq integer;
begin
  if tg_table_name = 'hts_rag_heading_decisions' then
    v_seq := new.sentence_seq;
    if v_seq is not null then
      select p.ruling_number into v_ruling
        from hts_rag.hts_rag_ruling_products p where p.id = new.product_id;
    end if;
  elsif tg_table_name = 'hts_rag_product_attributes' then
    v_seq := new.sentence_seq;
    if v_seq is not null then
      select p.ruling_number into v_ruling
        from hts_rag.hts_rag_ruling_products p where p.id = new.product_id;
    end if;
  elsif tg_table_name = 'hts_rag_decision_tests' then
    v_seq := new.reason_sentence_seq;
    if v_seq is not null then
      select p.ruling_number into v_ruling
        from hts_rag.hts_rag_heading_decisions hd
        join hts_rag.hts_rag_ruling_products p on p.id = hd.product_id
       where hd.id = new.decision_id;
    end if;
  elsif tg_table_name = 'hts_rag_decision_facts' then
    v_seq := new.sentence_seq;
    select p.ruling_number into v_ruling
      from hts_rag.hts_rag_decision_tests dt
      join hts_rag.hts_rag_heading_decisions hd on hd.id = dt.decision_id
      join hts_rag.hts_rag_ruling_products p on p.id = hd.product_id
     where dt.id = new.decision_test_id;
  elsif tg_table_name = 'hts_rag_decision_authorities' then
    v_seq := new.sentence_seq;
    select p.ruling_number into v_ruling
      from hts_rag.hts_rag_heading_decisions hd
      join hts_rag.hts_rag_ruling_products p on p.id = hd.product_id
     where hd.id = new.decision_id;
  elsif tg_table_name = 'hts_rag_counterfactuals' then
    v_seq := new.sentence_seq;
    select p.ruling_number into v_ruling
      from hts_rag.hts_rag_ruling_products p where p.id = new.product_id;
  end if;
  if v_seq is not null then
    if v_ruling is null or not exists (
      select 1 from hts_rag.hts_rag_ruling_sentences
       where ruling_number = v_ruling and seq = v_seq
    ) then
      raise exception 'sentence provenance (%, %) not found in hts_rag_ruling_sentences', v_ruling, v_seq;
    end if;
  end if;
  return new;
end;
$$;

-- FUNCTION public.add_style_tracker_rows(text, text, integer)
CREATE OR REPLACE FUNCTION public.add_style_tracker_rows(p_source_sheet text, p_tracker_type text, p_count integer DEFAULT 1) RETURNS SETOF public.style_tracker_rows
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'plm'
    AS $$
declare
  v_count integer;
  v_start_row integer;
begin
  if p_source_sheet not in ('License.Style', 'Generic.Style') then
    raise exception 'Unsupported source_sheet: %', p_source_sheet;
  end if;

  if p_tracker_type not in ('licensed', 'generic', 'vendor', 'project', 'order', 'other') then
    raise exception 'Unsupported tracker_type: %', p_tracker_type;
  end if;

  v_count := greatest(1, least(coalesce(p_count, 1), 25));

  select coalesce(max(source_row_number), 2) + 1
  into v_start_row
  from public.style_tracker_rows
  where source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    and source_sheet = p_source_sheet;

  return query
  insert into public.style_tracker_rows (
    source_workbook_id,
    source_sheet,
    source_row_number,
    tracker_type,
    row_data
  )
  select
    '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214',
    p_source_sheet,
    v_start_row + offset_value,
    p_tracker_type,
    jsonb_build_object('origin', 'user_added')
  from generate_series(0, v_count - 1) as offset_value
  returning *;
end;
$$;

-- FUNCTION public.admin_config_apply_counters(text, jsonb, jsonb)
CREATE OR REPLACE FUNCTION public.admin_config_apply_counters(p_key text, p_increments jsonb DEFAULT '{}'::jsonb, p_set jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_value jsonb;
  v_inc record;
  v_sub record;
  v_nested jsonb;
  v_cur jsonb;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'admin_config_apply_counters: p_key is required';
  end if;
  p_increments := coalesce(p_increments, '{}'::jsonb);
  p_set := coalesce(p_set, '{}'::jsonb);
  if jsonb_typeof(p_increments) <> 'object' or jsonb_typeof(p_set) <> 'object' then
    raise exception 'admin_config_apply_counters: p_increments and p_set must be JSON objects';
  end if;

  insert into public.admin_config (key, value)
  values (p_key, '{}'::jsonb)
  on conflict (key) do nothing;

  select ac.value into v_value
  from public.admin_config ac
  where ac.key = p_key
  for update;

  if v_value is null or jsonb_typeof(v_value) <> 'object' then
    raise exception 'admin_config_apply_counters: stored value for % is not a JSON object', p_key;
  end if;

  for v_inc in select * from jsonb_each(p_increments) loop
    if jsonb_typeof(v_inc.value) = 'number' then
      v_cur := v_value -> v_inc.key;
      if coalesce(jsonb_typeof(v_cur), 'null') not in ('number', 'null') then
        raise exception 'admin_config_apply_counters: stored % is not a number', v_inc.key;
      end if;
      v_value := jsonb_set(v_value, array[v_inc.key], to_jsonb(
        (case when jsonb_typeof(v_cur) = 'number' then v_cur::text::numeric else 0 end)
        + v_inc.value::text::numeric));
    elsif jsonb_typeof(v_inc.value) = 'object' then
      if coalesce(jsonb_typeof(v_value -> v_inc.key), 'null') not in ('object', 'null') then
        raise exception 'admin_config_apply_counters: stored % is not a JSON object', v_inc.key;
      end if;
      v_nested := case when jsonb_typeof(v_value -> v_inc.key) = 'object'
                       then v_value -> v_inc.key else '{}'::jsonb end;
      for v_sub in select * from jsonb_each(v_inc.value) loop
        if jsonb_typeof(v_sub.value) <> 'number' then
          raise exception 'admin_config_apply_counters: %.% is not a number', v_inc.key, v_sub.key;
        end if;
        v_cur := v_nested -> v_sub.key;
        if coalesce(jsonb_typeof(v_cur), 'null') not in ('number', 'null') then
          raise exception 'admin_config_apply_counters: stored %.% is not a number', v_inc.key, v_sub.key;
        end if;
        v_nested := jsonb_set(v_nested, array[v_sub.key], to_jsonb(
          (case when jsonb_typeof(v_cur) = 'number' then v_cur::text::numeric else 0 end)
          + v_sub.value::text::numeric));
      end loop;
      v_value := jsonb_set(v_value, array[v_inc.key], v_nested);
    else
      raise exception 'admin_config_apply_counters: increment % must be a number or object', v_inc.key;
    end if;
  end loop;

  v_value := v_value || p_set;

  update public.admin_config ac
  set value = v_value, updated_at = now()
  where ac.key = p_key;
  if not found then
    raise exception 'admin_config_apply_counters: row % vanished before update', p_key;
  end if;

  return v_value;
end;
$$;

-- FUNCTION public.apply_erp_item_updates(jsonb)
CREATE OR REPLACE FUNCTION public.apply_erp_item_updates(p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    SET lock_timeout TO '10s'
    AS $_$
declare
  c_allowed constant text[] := array[
    'mg01_code','mg02_code','mg03_code','size_code','licensor_code',
    'property_code','division_code','product_category','cover_description'];
  v_item     jsonb;
  v_u        jsonb;
  v_sku      text;
  v_div      text;
  v_bad      text;
  v_a_ids    uuid[];
  v_g_ids    uuid[];
  v_set      text;
  v_results  jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'p_items has % items; the limit is 500', jsonb_array_length(p_items)
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each item must be a JSON object' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'sku') is distinct from 'string' or v_item ->> 'sku' = '' then
      raise exception 'item sku is required and must be a non-empty string' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'division_code') not in ('string', 'null') then
      raise exception 'item % division_code must be a string or null', v_item ->> 'sku' using errcode = '22023';
    end if;
    v_sku := v_item ->> 'sku';
    v_div := v_item ->> 'division_code';
    v_u   := v_item -> 'updates';
    if v_u is null or jsonb_typeof(v_u) <> 'object' or v_u = '{}'::jsonb then
      raise exception 'item % updates must be a non-empty JSON object', v_sku using errcode = '22023';
    end if;
    select k into v_bad from jsonb_object_keys(v_u) as k where k <> all (c_allowed) limit 1;
    if v_bad is not null then
      raise exception 'item % updates field % is not allowed', v_sku, v_bad using errcode = '22023';
    end if;
    select k into v_bad from jsonb_each(v_u) as e(k, v)
     where jsonb_typeof(v) not in ('string', 'null') limit 1;
    if v_bad is not null then
      raise exception 'item % updates field % must be a string or null', v_sku, v_bad using errcode = '22023';
    end if;

    -- SET names only the keys this item carries (H1, issue #4167 review): column-list
    -- triggers such as trg_sync_cover_description_to_style_group and the search
    -- refresh then fire exactly as they did for the worker's per-key PATCH. Keys are
    -- whitelisted above, quoted with %I, and values bound through $3.
    select string_agg(format('%I = ($3 ->> %L)', k, k), ', ' order by k)
      into v_set
      from jsonb_object_keys(v_u) as k;

    execute format(
      'with upd as (update public.assets a set %s
                     where a.sku = $1 and a.division_code = $2 and a.is_deleted = false
                     returning a.id)
       select coalesce(array_agg(id order by id), ''{}''::uuid[]) from upd', v_set)
      into v_a_ids
      using v_sku, v_div, v_u;

    execute format(
      'with upd as (update public.style_groups g set %s
                     where g.sku = $1 and g.division_code = $2
                     returning g.id)
       select coalesce(array_agg(id order by id), ''{}''::uuid[]) from upd', v_set)
      into v_g_ids
      using v_sku, v_div, v_u;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'asset_count', cardinality(v_a_ids),
      'group_count', cardinality(v_g_ids),
      'asset_id',    v_a_ids[1],
      'group_id',    v_g_ids[1]));
  end loop;

  return v_results;
end;
$_$;

-- FUNCTION public.apply_pdf_sheet_style_tags()
CREATE OR REPLACE FUNCTION public.apply_pdf_sheet_style_tags() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_group uuid;
  v_field text;
  v_tag text;
  v_customer text;
  v_retailer text;
BEGIN
  IF NEW.extracted_fields IS NULL THEN RETURN NEW; END IF;
  SELECT a.style_group_id INTO v_group FROM public.assets a
    WHERE a.id = NEW.asset_id AND a.is_deleted = false;
  IF v_group IS NULL THEN RETURN NEW; END IF;

  FOREACH v_field IN ARRAY ARRAY['product_type', 'packaging_type'] LOOP
    v_tag := lower(regexp_replace(btrim(NEW.extracted_fields ->> v_field), '\s+', ' ', 'g'));
    CONTINUE WHEN v_tag IS NULL OR length(v_tag) NOT BETWEEN 3 AND 40
      OR v_tag !~ '^[[:alpha:]][[:alnum:] &''./-]*$'
      OR v_tag ~ '(prop 65|tsca|warning|example|batter|view|close-up|front|included|^tbd$|&$)'
      OR v_tag = ANY (ARRAY['legal line on sewn-in','canvas packaged with','clock mechanism','clock m','to avoid scratching','try-me sticker','tower','reference picture','leg corners','pvc backing','packaged with protective cardboard','bottom right corner','please put this sticker next to','label','box'])
      OR (v_field = 'packaging_type' AND v_tag !~ '(corner|sticker|label|hang ?tag|j-?card|box|shrink|belly|header|swift|polybag|sleeve)')
      OR EXISTS (SELECT 1 FROM core.customer c WHERE v_tag = lower(btrim(c.name)) OR starts_with(v_tag, lower(btrim(c.name)) || ' '));

    -- A value already in use just applies here, with no scan.
    IF EXISTS (SELECT 1 FROM public.style_group_tags t WHERE t.tag = v_tag AND t.source = 'pdf_sheet') THEN
      INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status, confidence, evidence)
      VALUES (v_group, v_tag, CASE WHEN v_field = 'product_type' THEN 'product_type' ELSE 'other' END,
        'pdf_sheet', 'active', 1, jsonb_build_array('sheet ' || replace(v_field, '_type', '')))
      ON CONFLICT (style_group_id, tag) DO NOTHING;
      CONTINUE;
    END IF;

    -- Every style with this value, including this one, tagged once three exist.
    WITH matching AS (
      SELECT DISTINCT a.style_group_id AS g
      FROM public.pdf_text_samples s
      JOIN public.assets a ON a.id = s.asset_id AND a.is_deleted = false AND a.style_group_id IS NOT NULL
      WHERE lower(regexp_replace(btrim(s.extracted_fields ->> v_field), '\s+', ' ', 'g')) = v_tag
      UNION SELECT v_group
    )
    INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status, confidence, evidence)
    SELECT m.g, v_tag, CASE WHEN v_field = 'product_type' THEN 'product_type' ELSE 'other' END,
      'pdf_sheet', 'active', 1, jsonb_build_array('sheet ' || replace(v_field, '_type', ''))
    FROM matching m
    WHERE (SELECT count(*) FROM matching) >= 3
    ON CONFLICT (style_group_id, tag) DO NOTHING;
  END LOOP;

  v_retailer := lower(btrim(NEW.extracted_fields ->> 'retailer'));
  SELECT lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) INTO v_customer FROM core.customer c
    WHERE btrim(c.name) <> ''
      AND (v_retailer = lower(btrim(c.name)) OR starts_with(v_retailer, lower(btrim(c.name)) || ' '))
    ORDER BY length(btrim(c.name)) DESC LIMIT 1;
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status, confidence, evidence)
    VALUES (v_group, v_customer, 'other', 'pdf_sheet', 'active', 1, '["sheet original customer"]'::jsonb)
    ON CONFLICT (style_group_id, tag) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_pdf_sheet_style_tags failed for %: %', NEW.asset_id, SQLERRM;
  RETURN NEW;
END;
$_$;

-- FUNCTION public.assets_refresh_default_visible_flags()
CREATE OR REPLACE FUNCTION public.assets_refresh_default_visible_flags() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_min timestamptz; old_vis boolean; new_vis boolean;
begin
  v_min := public.assets_thumbnail_min_date();
  if tg_op in ('UPDATE','DELETE') then
    old_vis := not old.is_deleted and (old.modified_at >= v_min or old.file_created_at >= v_min or old.thumbnail_url is not null);
  end if;
  if tg_op in ('UPDATE','INSERT') then
    new_vis := not new.is_deleted and (new.modified_at >= v_min or new.file_created_at >= v_min or new.thumbnail_url is not null);
  end if;
  if tg_op = 'UPDATE' and old_vis is not distinct from new_vis
     and old.style_group_id is not distinct from new.style_group_id and old.id = new.id then
    return null;
  end if;
  -- Asset documents first (their rows are this statement's own), then groups
  -- in uuid order so two movers between the same groups cannot deadlock.
  if tg_op in ('UPDATE','DELETE') then
    perform public.dam_refresh_default_visible_flag('asset', old.id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.id <> old.id) then
    perform public.dam_refresh_default_visible_flag('asset', new.id);
  end if;
  perform public.dam_refresh_default_visible_flag('style_group', g)
    from (select distinct g from unnest(array[
            case when tg_op in ('UPDATE','DELETE') then old.style_group_id end,
            case when tg_op in ('UPDATE','INSERT') then new.style_group_id end]) g
          where g is not null order by g) gs;
  return null;
end
$$;

-- FUNCTION public.await_style_guide_matview_refresh(uuid)
CREATE OR REPLACE FUNCTION public.await_style_guide_matview_refresh(p_run_id uuid) RETURNS TABLE(ready boolean, refreshed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
  v_start timestamptz;
  v_ingest timestamptz;
  v_state text;
  v_job bigint;
  v_wait_minutes integer;
  v_finished timestamptz;
  v_inflight boolean;
begin
  if p_run_id is null then
    raise exception 'A crawl run is required';
  end if;
  select r.refresh_started_at, r.ingest_completed_at, r.lifecycle_state
    into v_start, v_ingest, v_state
    from public.style_guide_crawl_runs r where r.id = p_run_id for update;
  if not found or v_ingest is null or v_state not in ('reconciling', 'refreshing') then
    raise exception 'Crawl must have finished ingestion and reconciliation before awaiting refresh';
  end if;
  select j.jobid, case j.schedule when '*/15 * * * *' then 20 else 65 end
    into v_job, v_wait_minutes from cron.job j
   where j.jobname = 'refresh-style-guide-matviews' and j.active
     and j.schedule in ('*/15 * * * *', '7 * * * *')
     and j.username = 'postgres' and j.database = current_database()
     and regexp_replace(lower(regexp_replace(j.command, '[[:space:]]', '', 'g')), ';$', '')
         = 'setlocalstatement_timeout=''10min'';selectpublic.refresh_style_guide_matviews_job()';
  if v_job is null then
    raise exception 'The existing PopSG refresh scheduler is unavailable or its command changed';
  end if;
  -- Pin the live, reviewed bodies so future drift cannot silently weaken what a
  -- successful cron run proves. The job body refreshes whenever a recent crawl is open.
  if to_regprocedure('public.refresh_style_guide_matviews()') is not null
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
         and p.prosecdef and p.pronargdefaults = 2
         and md5(p.prosrc) = '044a40244377bb9b64dc65efbc7ccf6a')
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews_job()')
         and p.prosecdef
         and md5(p.prosrc) = '6b8b6a3459e103e22996afd84b6abede') then
    raise exception 'The scheduled PopSG refresh contract changed';
  end if;
  if v_start is null then
    v_start := clock_timestamp();
    update public.style_guide_crawl_runs
       set refresh_started_at = v_start, lifecycle_state = 'refreshing'
     where id = p_run_id;
  end if;
  -- A refresh started before this crawl entered refresh is never evidence.
  select max(d.end_time) into v_finished from cron.job_run_details d
   where d.jobid = v_job and d.status = 'succeeded'
     and d.start_time >= greatest(v_start, v_ingest)
     and d.end_time >= d.start_time;
  if v_finished is null and clock_timestamp() - v_start > make_interval(mins => v_wait_minutes) then
    select exists (select 1 from cron.job_run_details d
      where d.jobid = v_job and d.status in ('starting', 'connecting', 'sending', 'running')
        and d.end_time is null and d.start_time >= greatest(v_start, v_ingest)
        and d.start_time >= clock_timestamp() - interval '10 minutes') into v_inflight;
    if not v_inflight or clock_timestamp() - v_start > make_interval(mins => v_wait_minutes + 10) then
      raise exception 'No successful scheduled PopSG refresh within the bounded wait window';
    end if;
  end if;
  -- Never stamp refresh_completed_at here: the existing search-only step must
  -- drain search synchronization before the caller can complete the crawl.
  return query select v_finished is not null, v_finished;
end;
$_$;

-- FUNCTION public.backfill_pdf_files_used()
CREATE OR REPLACE FUNCTION public.backfill_pdf_files_used() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  return public.backfill_pdf_files_used_v2();
end;
$$;

-- FUNCTION public.backfill_pdf_files_used_v2()
CREATE OR REPLACE FUNCTION public.backfill_pdf_files_used_v2() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    SET statement_timeout TO '30min'
    AS $$
declare
  v_id    uuid;
  v_total int := 0;
begin
  for v_id in (
    select distinct asset_id
    from pdf_text_samples
    where asset_id is not null
      and extracted_text is not null
      and char_count > 100
  ) loop
    v_total := v_total + public.parse_pdf_files_used_v2(v_id);
    perform public.parse_pdf_declared_style_guide(v_id);
  end loop;
  return v_total;
end;
$$;

-- FUNCTION public.backfill_pdf_sheet_designers(uuid, integer)
CREATE OR REPLACE FUNCTION public.backfill_pdf_sheet_designers(p_after uuid, p_limit integer DEFAULT 500) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  r record;
  v_c int; v_t int;
  v_examined int := 0; v_creative int := 0; v_technical int := 0;
  v_last uuid := p_after;
BEGIN
  FOR r IN
    SELECT p.asset_id, p.extracted_fields f
    FROM public.pdf_text_samples p
    WHERE p.indra_rescan_outcome = 'replaced'
      AND p.extracted_fields IS NOT NULL
      AND (p_after IS NULL OR p.asset_id > p_after)
    ORDER BY p.asset_id
    LIMIT p_limit
  LOOP
    SELECT c, t INTO v_c, v_t FROM public.apply_sheet_designers(
      r.asset_id, r.f->>'creative_designer', r.f->>'technical_designer');
    v_creative := v_creative + v_c;
    v_technical := v_technical + v_t;
    v_examined := v_examined + 1;
    v_last := r.asset_id;
  END LOOP;
  RETURN jsonb_build_object('examined', v_examined, 'creative_changed', v_creative, 'technical_changed', v_technical, 'last_asset_id', v_last);
END;
$$;

-- FUNCTION public.backfill_sku_style_guide_key_batch(integer)
CREATE OR REPLACE FUNCTION public.backfill_sku_style_guide_key_batch(p_batch_size integer DEFAULT 1000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare r record; n integer;
begin
  if p_batch_size < 1 or p_batch_size > 10000 then raise exception 'Invalid key batch size'; end if;
  perform pg_advisory_xact_lock(5608, 1);
  for r in select * from (values
    ('public.pdf_text_samples','extracted_text','declared_style_guide_key'),
    ('plm.dcp_asset','file_name','sku_sg_file_key'),
    ('plm.lucasfilm_dcp_asset','file_name','sku_sg_file_key'),
    ('plm.marvel_dcp_asset','file_name','sku_sg_file_key'),
    ('plm.marvel_asgard_node_asset_observation','exact_filename','sku_sg_file_key'),
    ('plm.nbcu_asset','file_name','sku_sg_file_key'),
    ('plm.wb_asset_normalized','file_name','sku_sg_file_key'),
    ('plm.peanuts_asset','file_name','sku_sg_file_key'),
    ('plm.sesame_asset','original_file_name','sku_sg_file_key'),
    ('plm.dcp_style_guide','folder_name','sku_sg_label_key'),
    ('plm.lucasfilm_dcp_style_guide','folder_name','sku_sg_label_key'),
    ('plm.marvel_dcp_style_guide','folder_name','sku_sg_label_key'),
    ('plm.marvel_asgard_style_guide','exact_label','sku_sg_label_key'),
    ('plm.nbcu_style_guide','style_guide_label','sku_sg_label_key'),
    ('plm.wb_style_guide_normalized','label','sku_sg_label_key'),
    ('plm.peanuts_style_guide','value_label','sku_sg_label_key'),
    ('plm.sesame_style_guide','value_label','sku_sg_label_key')) as sources(table_name, source_column, key_column)
  loop
    -- Reassign only our key: do not fire unrelated UPDATE OF source triggers.
    execute format('with batch as (select ctid from %s where %I is null limit $1 for update) '
      'update %s t set %I = t.%I from batch where t.ctid = batch.ctid',
      r.table_name,r.key_column,r.table_name,r.key_column,r.key_column) using p_batch_size;
    get diagnostics n = row_count;
    if n > 0 then return n; end if;
  end loop;
  return 0;
end;
$_$;

-- FUNCTION public.bulk_insert_pdf_text_samples(jsonb)
CREATE OR REPLACE FUNCTION public.bulk_insert_pdf_text_samples(p_rows jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_count int;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  INSERT INTO pdf_text_samples (
    asset_id, filename, relative_path, extraction_method,
    extracted_text, page_count, char_count, extraction_error,
    thumbnail_url, sampled_at, ocr_engine
  )
  SELECT
    NULLIF(elem->>'asset_id', '')::uuid,
    elem->>'filename',
    elem->>'relative_path',
    elem->>'extraction_method',
    NULLIF(elem->>'extracted_text', ''),
    (elem->>'page_count')::int,
    COALESCE((elem->>'char_count')::int, 0),
    NULLIF(elem->>'extraction_error', ''),
    NULLIF(elem->>'thumbnail_url', ''),
    now(),
    NULLIF(elem->>'ocr_engine', '')
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (asset_id) DO UPDATE SET
    filename          = EXCLUDED.filename,
    relative_path     = EXCLUDED.relative_path,
    extraction_method = EXCLUDED.extraction_method,
    extracted_text    = EXCLUDED.extracted_text,
    page_count        = EXCLUDED.page_count,
    char_count        = EXCLUDED.char_count,
    extraction_error  = EXCLUDED.extraction_error,
    thumbnail_url     = EXCLUDED.thumbnail_url,
    sampled_at        = EXCLUDED.sampled_at,
    ocr_engine        = EXCLUDED.ocr_engine;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- FUNCTION public.claim_dam_search_embedding_documents(integer, text, integer)
CREATE OR REPLACE FUNCTION public.claim_dam_search_embedding_documents(p_limit integer DEFAULT 100, p_worker_id text DEFAULT NULL::text, p_lease_seconds integer DEFAULT 300) RETURNS TABLE(document_type text, entity_id uuid, search_text text, thumbnail_url text, content_sha256 text, lease_token uuid, lease_expires_at timestamp with time zone, attempt integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (coalesce((select auth.role()) = 'service_role', false) or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true or nullif(btrim(p_worker_id),'') is null then raise exception 'authorized embedding actor and worker id required' using errcode='42501'; end if;
  return query with candidates as (
    select d.document_type,d.entity_id from public.dam_search_documents d
    where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
      and (d.embedding_next_retry_at is null or d.embedding_next_retry_at<=now())
      and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at<=now())
      and d.embedding_error_category is distinct from 'permanent'
      and nullif(d.metadata->>'thumbnail_url','') is not null
    order by (d.document_type = 'style_group') desc, d.indexed_at, d.document_type, d.entity_id for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ), claimed as (update public.dam_search_documents d set embedding_lease_token=gen_random_uuid(),
    embedding_lease_owner=p_worker_id,embedding_lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,300),3600))),
    metadata=d.metadata||jsonb_build_object('_embedding_lease_input_sha256',coalesce(d.metadata->'_embedding_input'->>'sha256',d.content_sha256)),
    embedding_attempts=d.embedding_attempts+1 from candidates c where d.document_type=c.document_type and d.entity_id=c.entity_id
    returning d.*)
  select c.document_type,c.entity_id,left(c.search_text,8000),
    c.metadata->>'thumbnail_url',
    c.metadata->>'_embedding_lease_input_sha256',c.embedding_lease_token,c.embedding_lease_expires_at,c.embedding_attempts from claimed c;
end
$$;

-- FUNCTION public.claim_pdf_backfill_batch(integer)
CREATE OR REPLACE FUNCTION public.claim_pdf_backfill_batch(p_limit integer DEFAULT 25) RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT a.id, a.filename, a.relative_path, (a.thumbnail_url IS NULL)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM public.pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.id
  LIMIT p_limit;
$$;

-- FUNCTION public.claim_pdf_rescan_batch(integer)
CREATE OR REPLACE FUNCTION public.claim_pdf_rescan_batch(p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.filename, a.relative_path, (a.thumbnail_url IS NULL)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', a.filename)
    AND NOT EXISTS (SELECT 1 FROM public.pdf_text_samples p
                    WHERE p.asset_id = a.id AND p.indra_rescan_at IS NOT NULL)
  ORDER BY a.id LIMIT p_limit;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT a.id, a.filename, a.relative_path, (a.thumbnail_url IS NULL)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND NOT EXISTS (SELECT 1 FROM public.pdf_text_samples p
                    WHERE p.asset_id = a.id AND p.indra_rescan_at IS NOT NULL)
  ORDER BY a.id LIMIT p_limit;
END;
$$;

-- FUNCTION public.claim_sg_search_embedding_documents(integer, text, integer)
CREATE OR REPLACE FUNCTION public.claim_sg_search_embedding_documents(p_limit integer DEFAULT 100, p_worker_id text DEFAULT NULL::text, p_lease_seconds integer DEFAULT 300) RETURNS TABLE(style_guide_file_id uuid, search_text text, thumbnail_url text, content_sha256 text, lease_token uuid, lease_expires_at timestamp with time zone, attempt integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    SET enable_hashjoin TO 'off'
    SET enable_mergejoin TO 'off'
    SET enable_sort TO 'off'
    AS $$
begin
  if (select auth.role()) <> 'service_role' or nullif(btrim(p_worker_id), '') is null then
    raise exception 'service_role and worker id required' using errcode = '42501';
  end if;
  -- The worker must embed the LIVE thumbnail the content identity names
  -- (snapshot equals live URL); documents without a thumbnail are not claimable.
  return query with candidates as (
    select d.style_guide_file_id, d.content_sha256
      from public.style_guide_search_documents d
      join public.style_guide_files f on f.id = d.style_guide_file_id
      left join public.style_guide_search_embedding_jobs j
        on j.style_guide_file_id = d.style_guide_file_id
       and j.content_sha256 = d.content_sha256
     where d.is_active and f.is_active
       and d.thumbnail_url is not distinct from f.thumbnail_url
       and f.thumbnail_url is not null
       and d.content_sha256 is not null
       and d.embedding is null
       and coalesce(j.attempt_count, 0) < coalesce(j.max_attempts, 5)
       and (j.next_retry_at is null or j.next_retry_at <= now())
       and (j.lease_expires_at is null or j.lease_expires_at <= now())
       and j.error_category is distinct from 'permanent'
     order by d.document_updated_at, d.style_guide_file_id
     for update of d skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 1000))
  ), claimed as (
    insert into public.style_guide_search_embedding_jobs as j
      (style_guide_file_id, content_sha256, lease_token, claimed_by, lease_expires_at,
       attempt_count, max_attempts, updated_at)
    select c.style_guide_file_id, c.content_sha256, gen_random_uuid(), p_worker_id,
           now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600))),
           1, 5, now()
      from candidates c
    on conflict on constraint style_guide_search_embedding_jobs_pkey do update
       set lease_token = excluded.lease_token,
           claimed_by = excluded.claimed_by,
           lease_expires_at = excluded.lease_expires_at,
           attempt_count = case when j.content_sha256 = excluded.content_sha256
                                then j.attempt_count + 1 else 1 end,
           max_attempts = case when j.content_sha256 = excluded.content_sha256
                               then j.max_attempts else 5 end,
           error = case when j.content_sha256 = excluded.content_sha256 then j.error end,
           error_category = case when j.content_sha256 = excluded.content_sha256 then j.error_category end,
           next_retry_at = case when j.content_sha256 = excluded.content_sha256 then j.next_retry_at end,
           content_sha256 = excluded.content_sha256,
           updated_at = now()
    returning j.style_guide_file_id, j.content_sha256, j.lease_token, j.lease_expires_at, j.attempt_count)
  select d.style_guide_file_id,
         left(d.filename || ' ' || d.style_guide_name || ' ' || coalesce(d.property_folder, '') || ' ' ||
              coalesce(d.licensor_name, ''), 8000),
         d.thumbnail_url, c.content_sha256, c.lease_token, c.lease_expires_at, c.attempt_count
    from claimed c
    join public.style_guide_search_documents d on d.style_guide_file_id = c.style_guide_file_id;
end;
$$;

-- FUNCTION public.claim_style_guide_pdf_text(text, integer, interval, integer)
CREATE OR REPLACE FUNCTION public.claim_style_guide_pdf_text(p_worker_id text, p_batch_size integer DEFAULT 10, p_claim_ttl interval DEFAULT '00:15:00'::interval, p_max_attempts integer DEFAULT 3) RETURNS TABLE(style_guide_file_id uuid, root_label text, relative_path text, content_identity text, attempts integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
-- The RETURNS TABLE output parameters share their names with the columns this
-- body reads, so an unqualified name -- `on conflict (style_guide_file_id)` in
-- particular, where the inference list cannot be qualified -- is ambiguous.
-- Columns win; every variable here is either `p_`- or `v_`-prefixed.
#variable_conflict use_column
declare
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 10), 500));
begin
  if p_worker_id is null or p_worker_id = '' then
    raise exception 'claim_style_guide_pdf_text requires a worker id';
  end if;

  -- Enrol a BOUNDED slice of active PDFs that have no extraction row yet. This is
  -- how the table fills: incrementally, never by a migration backfill.
  insert into public.style_guide_pdf_text (style_guide_file_id, content_identity, status)
  select f.id,
         md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')),
         'pending'
    from public.style_guide_files f
    left join public.style_guide_pdf_text t on t.style_guide_file_id = f.id
   where f.is_active
     and lower(coalesce(f.file_extension, '')) in ('pdf', '.pdf')
     and t.style_guide_file_id is null
   order by f.id
   limit v_batch
  on conflict (style_guide_file_id) do nothing;

  return query
  with eligible as (
    select t.style_guide_file_id as file_id,
           f.root_label as root,
           f.relative_path as rel_path,
           md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')) as identity_now
      from public.style_guide_pdf_text t
      join public.style_guide_files f on f.id = t.style_guide_file_id
     where f.is_active
       and (
             t.status = 'pending'
             -- Restart safety: an expired claim is reclaimable, so a worker that
             -- died mid-extraction never strands a file.
             or (t.status = 'claimed' and coalesce(t.claim_expires_at, '-infinity'::timestamptz) < now())
             or (t.status = 'failed' and t.attempts < coalesce(p_max_attempts, 3))
             -- Content identity moved underneath a stored extraction.
             or t.content_identity is distinct from
                md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, ''))
           )
     order by t.style_guide_file_id
     limit v_batch
     for update of t skip locked
  )
  update public.style_guide_pdf_text t
     set status = 'claimed',
         claimed_by = p_worker_id,
         claimed_at = now(),
         claim_expires_at = now() + coalesce(p_claim_ttl, interval '15 minutes'),
         attempts = case when t.content_identity is distinct from e.identity_now then 1 else t.attempts + 1 end,
         extracted_text = case when t.content_identity is distinct from e.identity_now then null else t.extracted_text end,
         page_count = case when t.content_identity is distinct from e.identity_now then null else t.page_count end,
         extracted_at = case when t.content_identity is distinct from e.identity_now then null else t.extracted_at end,
         error_message = null,
         content_identity = e.identity_now,
         updated_at = now()
    from eligible e
   where t.style_guide_file_id = e.file_id
  returning t.style_guide_file_id, e.root, e.rel_path, t.content_identity, t.attempts;
end;
$$;

-- FUNCTION public.cleanup_mega_group_tags_batch(uuid, integer, integer)
CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 5, p_min_group_size integer DEFAULT 50) RETURNS TABLE(next_cursor uuid, groups_processed integer, tags_deleted integer, characters_deleted integer, metadata_cleared integer, done boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
DECLARE
  v_group record;
  v_groups_processed int := 0;
  v_tags_deleted int := 0;
  v_chars_deleted int := 0;
  v_meta_cleared int := 0;
  v_last_id uuid;
  v_group_count int := 0;
  v_batch_tags int;
  v_batch_chars int;
  v_batch_meta int;
BEGIN
  FOR v_group IN
    SELECT sg.id
    FROM style_groups sg
    WHERE sg.asset_count >= p_min_group_size
      AND (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;
    v_last_id := v_group.id;

    -- 1) Delete contaminated tags from NON-directly-tagged assets (ai_tagged_at IS NULL)
    --    These assets only have propagated tags — delete all AI tags.
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_tags_null AS (
      DELETE FROM asset_tags at
      USING non_tagged_assets nta
      WHERE at.asset_id = nta.id
        AND at.source = 'ai'
      RETURNING 1
    ),
    -- 2) Delete contaminated tags from DIRECTLY-tagged assets
    --    Keep tags created within 5 min of ai_tagged_at; delete the rest.
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    ),
    del_tags_late AS (
      DELETE FROM asset_tags at
      USING tagged_assets ta
      WHERE at.asset_id = ta.id
        AND at.source = 'ai'
        AND at.created_at > ta.ai_tagged_at + interval '5 minutes'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM del_tags_null) + (SELECT count(*) FROM del_tags_late)
    INTO v_batch_tags;

    v_tags_deleted := v_tags_deleted + COALESCE(v_batch_tags, 0);

    -- 3) Delete contaminated asset_characters (same logic)
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_chars_null AS (
      DELETE FROM asset_characters ac
      USING non_tagged_assets nta
      WHERE ac.asset_id = nta.id
      RETURNING 1
    ),
    del_licensor_chars_null AS (
      DELETE FROM asset_licensor_characters alc
      USING non_tagged_assets nta
      WHERE alc.asset_id = nta.id
      RETURNING 1
    ),
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    )
    SELECT (SELECT count(*) FROM del_chars_null) + (SELECT count(*) FROM del_licensor_chars_null)
    INTO v_batch_chars;

    v_chars_deleted := v_chars_deleted + COALESCE(v_batch_chars, 0);

    -- 4) Clear propagated metadata on non-tagged assets
    WITH cleared AS (
      UPDATE assets a
      SET
        big_theme = NULL,
        little_theme = NULL,
        design_style = NULL,
        cover_description = NULL
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
        AND (a.big_theme IS NOT NULL OR a.little_theme IS NOT NULL
             OR a.design_style IS NOT NULL OR a.cover_description IS NOT NULL)
      RETURNING 1
    )
    SELECT count(*) INTO v_batch_meta FROM cleared;

    v_meta_cleared := v_meta_cleared + COALESCE(v_batch_meta, 0);
    v_groups_processed := v_groups_processed + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_last_id,
    v_groups_processed,
    v_tags_deleted,
    v_chars_deleted,
    v_meta_cleared,
    (v_group_count < p_batch_size);
END;
$$;

-- FUNCTION public.clear_dam_buy_sheet_import(uuid, boolean)
CREATE OR REPLACE FUNCTION public.clear_dam_buy_sheet_import(p_import_id uuid DEFAULT NULL::uuid, p_apply boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'plm', 'public', 'core', 'dam', 'pg_temp'
    AS $$
declare
  v_actor    uuid := auth.uid();
  v_imp      dam.order_buy_sheet_import%rowtype;
  v_created  uuid[];
  v_updated  jsonb;
  v_orders   uuid[];
  v_empty    uuid[];
  v_r        jsonb;
begin
  if v_actor is null then
    raise exception 'clear_dam_buy_sheet_import: authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_dam_buy_sheet'));
  if p_import_id is null then
    select * into v_imp from dam.order_buy_sheet_import
     where imported_by = v_actor order by imported_at desc, id desc limit 1;
  else
    select * into v_imp from dam.order_buy_sheet_import where id = p_import_id;
  end if;
  if v_imp.id is null then
    raise exception 'clear_dam_buy_sheet_import: no buy-sheet import to clear' using errcode = 'P0002';
  end if;
  if v_imp.imported_by is distinct from v_actor then
    raise exception 'clear_dam_buy_sheet_import: only the person who uploaded this buy sheet can clear it' using errcode = '42501';
  end if;

  -- Lines this import created: still carrying its own popdam_buy_sheet ref.
  select coalesce(array_agg(distinct l.id), '{}') into v_created
    from jsonb_array_elements(v_imp.result) r
    join plm.production_order_line l on l.id = (r ->> 'line_id')::uuid
   where r ->> 'outcome' = 'new' and l.source_system = 'popdam_buy_sheet'
     and exists (select 1 from plm.production_order_line_source_ref s
                  where s.production_order_line_id = l.id and s.source_system = 'popdam_buy_sheet'
                    and s.source_id = coalesce(r ->> 'source_ref', l.source_id));
  -- Lines this import updated, with what to restore.
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_updated
    from jsonb_array_elements(v_imp.result) r
   where r ->> 'outcome' = 'updated' and r ->> 'line_id' is not null
     and exists (select 1 from plm.production_order_line l where l.id = (r ->> 'line_id')::uuid);
  select coalesce(array_agg(distinct production_order_id), '{}') into v_orders
    from plm.production_order_line where id = any (v_created);
  -- Orders the import created that would be left with no lines.
  select coalesce(array_agg(o.id), '{}') into v_empty
    from plm.production_order o
   where o.id = any (v_orders) and o.source_system = 'popdam_buy_sheet'
     and o.metadata ->> 'created_via' = 'popdam_buy_sheet'
     and not exists (select 1 from plm.production_order_line l
                      where l.production_order_id = o.id and not (l.id = any (v_created)));

  if exists (select 1 from plm.production_order_line_source_ref s
              where s.source_system = 'coldlion'
                and (s.production_order_line_id = any (v_created)
                     or s.production_order_line_id in (select (u ->> 'line_id')::uuid from jsonb_array_elements(v_updated) u))) then
    raise exception 'clear_dam_buy_sheet_import: a line from this buy sheet is now linked to ColdLion; nothing was cleared' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(v_imp.result) r
               join plm.production_order_line l on l.id = (r ->> 'line_id')::uuid
               join plm.production_order o on o.id = l.production_order_id
              where l.id = any (v_created) and nullif(btrim(coalesce(r ->> 'order_number', '')), '') is null
                and btrim(o.production_order_number) <> '') then
    raise exception 'clear_dam_buy_sheet_import: a real PO number has since been put on an order from this buy sheet; nothing was cleared' using errcode = 'P0001';
  end if;

  if p_apply then
    delete from plm.production_order_line_source_ref where production_order_line_id = any (v_created);
    delete from dam.production_order_snapshot where production_order_line_id = any (v_created);
    delete from plm.production_order_line where id = any (v_created);
    for v_r in select * from jsonb_array_elements(v_updated)
    loop
      update plm.production_order_line
         set quantity_ordered = (v_r ->> 'previous_quantity')::numeric,
             metadata = coalesce(metadata, '{}'::jsonb) - 'buy_sheet',
             assortment_id = case when coalesce((v_r ->> 'assortment_set')::boolean, false)
                                  then v_r ->> 'previous_assortment_id' else assortment_id end,
             updated_at = now()
       where id = (v_r ->> 'line_id')::uuid;
      delete from plm.production_order_line_source_ref
       where production_order_line_id = (v_r ->> 'line_id')::uuid and source_system = 'popdam_buy_sheet'
         and (v_r ->> 'source_ref' is null or source_id = v_r ->> 'source_ref');
    end loop;
    delete from plm.production_order_source_ref where production_order_id = any (v_empty);
    delete from dam.order_tracking_ext where order_id = any (v_empty);
    delete from plm.production_order where id = any (v_empty);
    delete from dam.order_buy_sheet_import where id = v_imp.id;
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'import_id', v_imp.id, 'file_name', v_imp.file_name,
    'imported_at', v_imp.imported_at,
    'lines_to_delete', cardinality(v_created),
    'lines_to_restore', jsonb_array_length(v_updated),
    'orders_to_delete', cardinality(v_empty));
end;
$$;

-- FUNCTION public.commit_pdf_rescan_batch(jsonb)
CREATE OR REPLACE FUNCTION public.commit_pdf_rescan_batch(p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  r record;
  v_asset_id uuid;
  v_page_count integer;
  v_old public.pdf_text_samples%ROWTYPE;
  v_text text;
  v_len int;
  v_old_len int;
  v_replace boolean;
  v_outcome text;
  v_replaced int := 0; v_kept int := 0; v_failed int := 0;
  v_creative int := 0; v_technical int := 0; v_files int := 0; v_n int; v_m int;
  v_sku text; v_ftype text; v_fname text; v_file text;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  FOR r IN
    SELECT e FROM jsonb_array_elements(p_rows) e
  LOOP
    -- Reject malformed identifiers/counts before any backup or row mutation.
    BEGIN
      v_asset_id := NULLIF(r.e->>'asset_id', '')::uuid;
      v_page_count := NULLIF(r.e->>'page_count', '')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END;
    IF v_asset_id IS NULL THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;
    v_old := NULL;
    SELECT * INTO v_old FROM public.pdf_text_samples p WHERE p.asset_id = v_asset_id;

    IF v_old.asset_id IS NOT NULL THEN
      INSERT INTO public.pdf_text_samples_backup (
        asset_id, filename, relative_path, extraction_method, extracted_text,
        page_count, char_count, extraction_error, thumbnail_url, sampled_at)
      VALUES (v_old.asset_id, v_old.filename, v_old.relative_path, v_old.extraction_method,
        v_old.extracted_text, v_old.page_count, v_old.char_count, v_old.extraction_error,
        v_old.thumbnail_url, v_old.sampled_at)
      ON CONFLICT (asset_id) DO NOTHING;
    END IF;

    v_text := NULLIF(btrim(r.e->>'extracted_text'), '');
    v_len := COALESCE(length(v_text), 0);
    v_old_len := COALESCE(length(v_old.extracted_text), 0);
    v_replace := v_len > 0 AND NOT (
      (v_len < 100 AND v_old_len >= 100) OR (v_old_len >= 500 AND v_len < v_old_len / 4));
    v_outcome := CASE WHEN v_replace THEN 'replaced'
                      WHEN NULLIF(r.e->>'error', '') IS NOT NULL THEN 'failed'
                      ELSE 'kept_existing' END;

    IF v_old.asset_id IS NULL THEN
      INSERT INTO public.pdf_text_samples (
        asset_id, filename, relative_path, extraction_method, extracted_text, page_count,
        char_count, extraction_error, thumbnail_url, sampled_at, ocr_engine, extracted_fields,
        indra_rescan_at, indra_rescan_outcome, indra_rescan_error)
      VALUES (v_asset_id, r.e->>'filename', r.e->>'relative_path',
        CASE WHEN v_replace THEN 'ocr_text' ELSE 'failed' END,
        CASE WHEN v_replace THEN v_text END, v_page_count,
        CASE WHEN v_replace THEN v_len ELSE 0 END, NULLIF(r.e->>'error', ''),
        NULLIF(r.e->>'thumbnail_url', ''), now(), CASE WHEN v_replace THEN 'indra' END,
        CASE WHEN v_replace THEN r.e->'fields' END,
        now(), v_outcome, NULLIF(r.e->>'error', ''));
    ELSIF v_replace THEN
      UPDATE public.pdf_text_samples p SET
        filename = COALESCE(NULLIF(r.e->>'filename', ''), p.filename),
        relative_path = COALESCE(NULLIF(r.e->>'relative_path', ''), p.relative_path),
        extraction_method = 'ocr_text',
        extracted_text = v_text,
        page_count = COALESCE(v_page_count, p.page_count),
        char_count = v_len,
        extraction_error = NULL,
        thumbnail_url = COALESCE(NULLIF(r.e->>'thumbnail_url', ''), p.thumbnail_url),
        sampled_at = now(),
        ocr_engine = 'indra',
        extracted_fields = r.e->'fields',
        indra_rescan_at = now(),
        indra_rescan_outcome = v_outcome,
        indra_rescan_error = NULL
      WHERE p.asset_id = v_asset_id;
    ELSE
      -- Stored text is untouched, so the search-document trigger does not fire.
      UPDATE public.pdf_text_samples p SET
        indra_rescan_at = now(),
        indra_rescan_outcome = v_outcome,
        indra_rescan_error = NULLIF(r.e->>'error', '')
      WHERE p.asset_id = v_asset_id;
    END IF;

    IF v_outcome = 'replaced' THEN v_replaced := v_replaced + 1;
    ELSIF v_outcome = 'failed' THEN v_failed := v_failed + 1;
    ELSE v_kept := v_kept + 1; END IF;

    CONTINUE WHEN NOT v_replace;

    SELECT a.sku, a.file_type::text, a.filename INTO v_sku, v_ftype, v_fname
    FROM public.assets a WHERE a.id = v_asset_id;
    CONTINUE WHEN NOT public.is_style_guide_source_pdf(v_ftype, v_fname);

    SELECT c, t INTO v_n, v_m FROM public.apply_sheet_designers(
      v_asset_id, r.e->'fields'->>'creative_designer', r.e->'fields'->>'technical_designer');
    v_creative := v_creative + v_n;
    v_technical := v_technical + v_m;

    IF NULLIF(btrim(v_sku), '') IS NOT NULL
       AND jsonb_typeof(r.e->'fields'->'files_used') = 'array' THEN
      FOR v_file IN SELECT jsonb_array_elements_text(r.e->'fields'->'files_used') LOOP
        CONTINUE WHEN NOT public.is_plausible_source_file_name(v_file);
        INSERT INTO public.sku_files_used (sku, file_name, source)
        VALUES (v_sku, v_file, 'pdf_text')
        ON CONFLICT (sku, file_name) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT; v_files := v_files + v_n;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('replaced', v_replaced, 'kept_existing', v_kept, 'failed', v_failed,
    'designers_filled', v_creative, 'technical_designers_filled', v_technical, 'files_used_added', v_files);
END;
$$;

-- FUNCTION public.complete_style_guide_pdf_text(uuid, text, text, integer, text)
CREATE OR REPLACE FUNCTION public.complete_style_guide_pdf_text(p_style_guide_file_id uuid, p_content_identity text, p_text text DEFAULT NULL::text, p_page_count integer DEFAULT NULL::integer, p_error text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated integer;
begin
  -- The identity match is the invalidation guard: a result computed against a
  -- file version that has since changed, or against a file that is no longer
  -- active, is REFUSED rather than stored as current.
  update public.style_guide_pdf_text t
     set status = case when p_error is not null then 'failed' else 'extracted' end,
         extracted_text = case when p_error is not null then null else p_text end,
         page_count = case when p_error is not null then null else p_page_count end,
         error_message = p_error,
         extracted_at = case when p_error is not null then null else now() end,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = now()
    from public.style_guide_files f
   where t.style_guide_file_id = p_style_guide_file_id
     and f.id = t.style_guide_file_id
     and f.is_active
     and t.content_identity = p_content_identity
     and t.status = 'claimed';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  -- Keep the search document for this one file current. Bounded to a single row.
  update public.style_guide_search_documents d
     set pdf_text_status = t.status,
         pdf_text_length = coalesce(t.text_length, 0),
         search_vector =
           setweight(to_tsvector('simple', coalesce(d.filename, '')), 'A')
           || setweight(to_tsvector('simple', coalesce(d.style_guide_name, '') || ' ' ||
                                              coalesce(d.property_folder, '') || ' ' ||
                                              coalesce(d.licensor_name, '')), 'B')
           || setweight(to_tsvector('simple', coalesce(d.relative_path, '') || ' ' ||
                                              array_to_string(d.tag_names, ' ')), 'C')
           || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
         document_updated_at = now()
    from public.style_guide_pdf_text t
   where d.style_guide_file_id = p_style_guide_file_id
     and t.style_guide_file_id = d.style_guide_file_id;

  return true;
end;
$$;

-- FUNCTION public.complete_style_guide_pdf_text_v2(uuid, text, text, text, integer, text, text)
CREATE OR REPLACE FUNCTION public.complete_style_guide_pdf_text_v2(p_style_guide_file_id uuid, p_content_identity text, p_status text, p_method text DEFAULT NULL::text, p_page_count integer DEFAULT NULL::integer, p_text text DEFAULT NULL::text, p_reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_method text := nullif(btrim(p_method), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_updated integer;
begin
  if v_status not in ('extracted', 'failed', 'skipped') then
    raise exception 'complete_style_guide_pdf_text_v2 status must be extracted, failed, or skipped';
  end if;

  if v_status = 'extracted' and nullif(btrim(p_text), '') is null then
    raise exception 'complete_style_guide_pdf_text_v2 requires non-empty text for extracted';
  end if;

  if v_status in ('failed', 'skipped') and v_reason is null then
    raise exception 'complete_style_guide_pdf_text_v2 requires a reason for failed or skipped';
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'complete_style_guide_pdf_text_v2 reason exceeds 2000 characters';
  end if;

  if char_length(v_method) > 100 then
    raise exception 'complete_style_guide_pdf_text_v2 method exceeds 100 characters';
  end if;

  if p_page_count is not null and p_page_count < 0 then
    raise exception 'complete_style_guide_pdf_text_v2 page count cannot be negative';
  end if;

  -- Refuse inactive files, spent claims, stale worker identities, and files whose
  -- current content identity moved after the claim was issued.
  update public.style_guide_pdf_text t
     set status = v_status,
         extraction_method = v_method,
         terminal_reason = case when v_status in ('failed', 'skipped') then v_reason else null end,
         extracted_text = case when v_status = 'extracted' then p_text else null end,
         page_count = p_page_count,
         error_message = case when v_status in ('failed', 'skipped') then v_reason else null end,
         extracted_at = case when v_status = 'extracted' then now() else null end,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = now()
    from public.style_guide_files f
   where t.style_guide_file_id = p_style_guide_file_id
     and f.id = t.style_guide_file_id
     and f.is_active
     and t.status = 'claimed'
     and t.content_identity = p_content_identity
     and t.content_identity = md5(
       f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')
     );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  -- Match the v1 completion path: refresh only this file's existing document.
  update public.style_guide_search_documents d
     set pdf_text_status = t.status,
         pdf_text_length = coalesce(t.text_length, 0),
         search_vector =
           setweight(to_tsvector('simple', coalesce(d.filename, '')), 'A')
           || setweight(to_tsvector('simple', coalesce(d.style_guide_name, '') || ' ' ||
                                              coalesce(d.property_folder, '') || ' ' ||
                                              coalesce(d.licensor_name, '')), 'B')
           || setweight(to_tsvector('simple', coalesce(d.relative_path, '') || ' ' ||
                                              array_to_string(d.tag_names, ' ')), 'C')
           || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
         document_updated_at = now()
    from public.style_guide_pdf_text t
   where d.style_guide_file_id = p_style_guide_file_id
     and t.style_guide_file_id = d.style_guide_file_id;

  return true;
end;
$$;

-- FUNCTION public.compute_primary_sort_tier()
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  fn text := lower(NEW.filename);
  base_name text := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34 boolean := (base_name LIKE '%3-4%');
  is_mockup boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_comp boolean := (fn ~ '(^|[^a-z])comp([-_ ]?view)?([^a-z]|$)');
  is_art boolean := (fn LIKE '%art%');
  is_techpack boolean := (fn LIKE '%tech pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech_pack%');
  is_pkg boolean := (fn LIKE '%packaging%');
  is_artwork_file boolean := (NEW.file_type <> 'pdf');
begin
  IF is_photo34 THEN NEW.primary_sort_tier := 1;
  ELSIF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF is_comp AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF is_techpack AND has_thumb THEN NEW.primary_sort_tier := 5;
  ELSIF NOT is_mockup AND NOT is_comp AND NOT is_art AND NOT is_techpack AND NOT is_pkg
    AND has_thumb AND is_artwork_file THEN NEW.primary_sort_tier := 6;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 7;
  ELSIF NOT is_mockup AND NOT is_comp AND NOT is_art AND NOT is_techpack AND NOT is_pkg
    AND has_thumb THEN NEW.primary_sort_tier := 8;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 9;
  ELSIF is_comp THEN NEW.primary_sort_tier := 10;
  ELSIF is_art THEN NEW.primary_sort_tier := 11;
  ELSIF is_techpack THEN NEW.primary_sort_tier := 12;
  ELSIF NOT is_mockup AND NOT is_comp AND NOT is_art AND NOT is_techpack AND NOT is_pkg THEN NEW.primary_sort_tier := 13;
  ELSE NEW.primary_sort_tier := 14;
  END IF;
  RETURN NEW;
END; $_$;

-- FUNCTION public.count_pdf_backfill_remaining()
CREATE OR REPLACE FUNCTION public.count_pdf_backfill_remaining() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT count(*)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM public.pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$$;

-- FUNCTION public.count_pdf_rescan_remaining()
CREATE OR REPLACE FUNCTION public.count_pdf_rescan_remaining() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT count(*)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND NOT EXISTS (SELECT 1 FROM public.pdf_text_samples p
                    WHERE p.asset_id = a.id AND p.indra_rescan_at IS NOT NULL);
$$;

-- FUNCTION public.count_style_guide_crawl_seen(text, uuid)
CREATE OR REPLACE FUNCTION public.count_style_guide_crawl_seen(p_root_label text, p_run_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(*)
    from public.style_guide_file_crawl_seen s
    join public.style_guide_files f on f.id = s.style_guide_file_id
   where s.root_label = p_root_label
     and s.crawl_run_id = p_run_id
     and f.is_active;
$$;

-- FUNCTION public.dam_asset_path_candidates(uuid)
CREATE OR REPLACE FUNCTION public.dam_asset_path_candidates(p_asset_id uuid) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select dam.path_candidates('mac', p_asset_id);
$$;

-- FUNCTION public.dam_catalog_code_format_exists(text)
CREATE OR REPLACE FUNCTION public.dam_catalog_code_format_exists(p_format text) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'public'
    SET statement_timeout TO '1000ms'
    AS $_$
begin
  if p_format is null
     or p_format collate "C" !~ '^[A9]{7,64}$'
     or pg_catalog.strpos(p_format, 'A') = 0
     or pg_catalog.strpos(p_format, '9') = 0 then
    raise exception using errcode = '22023', message = 'Invalid complete code format';
  end if;
  return exists (
    select 1 from public.style_groups g
    where g.sku collate "C" ~ '^[A-Za-z0-9]{7,64}$'
      and pg_catalog.translate(g.sku,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999') = p_format
  );
end;
$_$;

-- FUNCTION public.dam_default_visible_member(text, uuid, uuid, timestamp with time zone)
CREATE OR REPLACE FUNCTION public.dam_default_visible_member(p_document_type text, p_asset_id uuid, p_style_group_id uuid, p_min_date timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select public.dam_default_visible_member_count(p_document_type, p_asset_id, p_style_group_id, p_min_date) > 0
$$;

-- FUNCTION public.dam_default_visible_member_count(text, uuid, uuid, timestamp with time zone)
CREATE OR REPLACE FUNCTION public.dam_default_visible_member_count(p_document_type text, p_asset_id uuid, p_style_group_id uuid, p_min_date timestamp with time zone) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select case
    when p_document_type = 'asset' and p_asset_id is not null then (
      select count(*)::integer from public.assets a where a.id = p_asset_id and not a.is_deleted
        and (a.modified_at >= p_min_date or a.file_created_at >= p_min_date or a.thumbnail_url is not null))
    when p_document_type = 'style_group' and p_style_group_id is not null then (
      select count(*)::integer from public.assets a where a.style_group_id = p_style_group_id and not a.is_deleted
        and (a.modified_at >= p_min_date or a.file_created_at >= p_min_date or a.thumbnail_url is not null))
    else 0 end
$$;

-- FUNCTION public.dam_lock_default_visible_owner(text, uuid)
CREATE OR REPLACE FUNCTION public.dam_lock_default_visible_owner(p_document_type text, p_entity_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if p_entity_id is null then return; end if;
  if p_document_type = 'asset' then
    perform 1 from public.assets where id = p_entity_id for no key update;
  elsif p_document_type = 'style_group' then
    perform 1 from public.style_groups where id = p_entity_id for no key update;
  end if;
end
$$;

-- FUNCTION public.dam_refresh_default_visible_flag(text, uuid)
CREATE OR REPLACE FUNCTION public.dam_refresh_default_visible_flag(p_document_type text, p_entity_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_min timestamptz; v_asset uuid; v_sg uuid; v_count integer;
begin
  if p_entity_id is null then return; end if;
  perform public.dam_lock_default_visible_owner(p_document_type, p_entity_id);
  select d.asset_id, d.style_group_id into v_asset, v_sg
    from public.dam_search_documents d
   where d.document_type = p_document_type and d.entity_id = p_entity_id;
  if not found then return; end if;
  v_min := public.assets_thumbnail_min_date();
  v_count := public.dam_default_visible_member_count(p_document_type, v_asset, v_sg, v_min);
  update public.dam_search_documents d
     set has_default_visible_member = v_count > 0, default_visible_min_date = v_min,
         default_visible_member_count = v_count
   where d.document_type = p_document_type and d.entity_id = p_entity_id
     and (d.has_default_visible_member is distinct from (v_count > 0)
          or d.default_visible_min_date is distinct from v_min
          or d.default_visible_member_count is distinct from v_count);
end
$$;

-- FUNCTION public.dam_search_documents_set_default_visible()
CREATE OR REPLACE FUNCTION public.dam_search_documents_set_default_visible() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.dam_lock_default_visible_owner(new.document_type, new.entity_id);
  new.default_visible_min_date := public.assets_thumbnail_min_date();
  new.default_visible_member_count := public.dam_default_visible_member_count(new.document_type, new.asset_id, new.style_group_id, new.default_visible_min_date);
  new.has_default_visible_member := new.default_visible_member_count > 0;
  return new;
end
$$;

-- FUNCTION public.dam_search_semantic_anchor(extensions.vector, text[])
CREATE OR REPLACE FUNCTION public.dam_search_semantic_anchor(p_query_embedding extensions.vector, p_document_types text[] DEFAULT NULL::text[]) RETURNS real
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    SET statement_timeout TO '5s'
    AS $$
  select set_config('hnsw.ef_search', '100', true);
  select set_config('hnsw.iterative_scan', 'relaxed_order', true);
  select set_config('hnsw.max_scan_tuples', '20000', true);
  with params as materialized (
    select (p_query_embedding is not null) has_embedding
    where public.require_dam_access()
  ), semantic_ann as materialized (
    select greatest(0, 1 - (d.embedding <=> p_query_embedding))::real score
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where (p_document_types is null
        or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group'))
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> p_query_embedding
    limit 1
  ), semantic_exact as materialized (
    select greatest(0, 1 - (d.embedding <=> p_query_embedding))::real score
    from params p
    join dam.search_group_vectors d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset' = any(p_document_types))
      and 'style_group' = any(p_document_types)
      and d.document_type = 'style_group'  -- literal: a parameter here makes the planner seq-scan
    order by (d.embedding <=> p_query_embedding) + 0
    limit 1
  )
  select max(s.score)::real
  from (select score from semantic_ann union all select score from semantic_exact) s;
$$;

-- FUNCTION public.dam_search_semantic_anchor_scoped(extensions.vector, text[], uuid[])
CREATE OR REPLACE FUNCTION public.dam_search_semantic_anchor_scoped(p_query_embedding extensions.vector, p_document_types text[] DEFAULT NULL::text[], p_licensor_ids uuid[] DEFAULT NULL::uuid[]) RETURNS real
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET statement_timeout TO '5s'
    AS $$
declare
  v_ids uuid[];
  v_score real;
begin
  if not coalesce(public.require_dam_access(), false) then
    return null;
  end if;
  v_ids := array(select distinct x from unnest(p_licensor_ids) x where x is not null);
  if p_query_embedding is null or cardinality(v_ids) = 0 then
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;

  perform pg_catalog.set_config('hnsw.ef_search', '100', true);
  perform pg_catalog.set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform pg_catalog.set_config('hnsw.max_scan_tuples', '2000', true);

  if p_document_types is not null and not ('asset' = any(p_document_types))
     and 'style_group' = any(p_document_types) then
    -- style-group-only: exact leg, as in search_dam_documents.
    select greatest(0, 1 - min(d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from dam.search_group_vectors d
    join public.style_groups g on g.id = d.style_group_id
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and d.document_type = 'style_group'
      and g.licensor_id = any(v_ids)
    having count(*) > 0;
  elsif p_document_types is null
     or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group') then
    select greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding))::real
    into v_score
    from public.dam_search_documents d
    where d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
      and (p_document_types is null or d.document_type = any(p_document_types))
      and case when d.style_group_id is not null
            then exists (select 1 from public.style_groups g
                         where g.id = d.style_group_id and g.licensor_id = any(v_ids))
            else exists (select 1 from public.assets a
                         where a.id = d.asset_id and a.licensor_id = any(v_ids)) end
    order by d.embedding operator(extensions.<=>) p_query_embedding
    limit 1;
  end if;

  if v_score is null then
    perform pg_catalog.set_config('hnsw.max_scan_tuples', '20000', true);
    return public.dam_search_semantic_anchor(p_query_embedding, p_document_types);
  end if;
  return v_score;
end;
$$;

-- FUNCTION public.dam_search_semantic_anchors(extensions.vector, extensions.vector, text[])
CREATE OR REPLACE FUNCTION public.dam_search_semantic_anchors(p_first_embedding extensions.vector, p_second_embedding extensions.vector DEFAULT NULL::extensions.vector, p_document_types text[] DEFAULT NULL::text[]) RETURNS TABLE(query_index integer, score real)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET statement_timeout TO '5s'
    AS $$
declare
  v_authorized boolean;
begin
  -- Evaluate the same access helper exactly once, before input/data work.
  -- A false/NULL result still prevents both data legs; it is never ignored.
  v_authorized := public.require_dam_access();
  if p_first_embedding is null
     or extensions.vector_dims(p_first_embedding) <> 768
     or (p_second_embedding is not null and extensions.vector_dims(p_second_embedding) <> 768) then
    raise exception using errcode='22023', message='Expected one or two 768-dimensional query vectors';
  end if;

  perform pg_catalog.set_config('hnsw.ef_search','100',true);
  perform pg_catalog.set_config('hnsw.iterative_scan','relaxed_order',true);
  perform pg_catalog.set_config('hnsw.max_scan_tuples','20000',true);

  return query
  with params as materialized (
    select p_first_embedding first_embedding, p_second_embedding second_embedding
    where v_authorized
  ), inputs as materialized (
    select q.n, q.embedding
    from (values (1,p_first_embedding),(2,p_second_embedding)) q(n,embedding)
    where q.n=1 or p_second_embedding is not null
  ), semantic_ann as materialized (
    select q.n, a.score
    from params p cross join inputs q
    cross join lateral (
      select greatest(0,1-(d.embedding operator(extensions.<=>) q.embedding))::real score
      from public.dam_search_documents d
      where d.embedding is not null
        and d.embedding_model='google/siglip2-base-patch16-naflex'
        and (p_document_types is null or d.document_type=any(p_document_types))
      order by d.embedding operator(extensions.<=>) q.embedding
      limit 1
    ) a
    where p_document_types is null
       or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group')
  ), semantic_exact as materialized (
    -- MIN(distance) matches the old ascending ORDER BY, including NaN ordering.
    -- MAX(score) would let one zero-vector NaN dominate otherwise valid scores.
    select case when count(*)=0 then null
                else greatest(0,1-min(d.embedding operator(extensions.<=>) p.first_embedding))::real end first_score,
           case when count(*)=0 then null
                else greatest(0,1-min(d.embedding operator(extensions.<=>) p.second_embedding))::real end second_score
    from params p join dam.search_group_vectors d
      on d.embedding is not null
      and d.embedding_model='google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset'=any(p_document_types))
      and 'style_group'=any(p_document_types)
      and d.document_type='style_group'
  ), exact_scores as (
    select q.n, case when q.n=1 then e.first_score else e.second_score end score
    from inputs q cross join semantic_exact e
  ), combined as (
    select a.n,a.score from semantic_ann a
    union all
    select e.n,e.score from exact_scores e
  )
  select q.n,max(s.score)::real
  from inputs q left join combined s on s.n=q.n
  group by q.n
  order by q.n;
end;
$$;

-- FUNCTION public.dam_sweep_default_visible_flags(integer)
CREATE OR REPLACE FUNCTION public.dam_sweep_default_visible_flags(p_limit integer DEFAULT 5000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET statement_timeout TO '120s'
    AS $$
declare v_min timestamptz := public.assets_thumbnail_min_date(); r record; n integer := 0;
begin
  for r in
    select d.document_type, d.entity_id from public.dam_search_documents d
     where d.has_default_visible_member is null or d.default_visible_member_count is null
        or d.default_visible_min_date is distinct from v_min
     limit greatest(p_limit, 0)
  loop
    perform public.dam_refresh_default_visible_flag(r.document_type, r.entity_id);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- PROCEDURE public.dam_sweep_default_visible_flags_batched(integer)
CREATE OR REPLACE PROCEDURE public.dam_sweep_default_visible_flags_batched(IN p_limit integer DEFAULT 5000)
    LANGUAGE plpgsql
    AS $$
-- #804 indexed sweep: each branch is answered by an index, never a full scan.
declare v_min timestamptz := public.assets_thumbnail_min_date(); r record;
begin
  for r in
    select s.document_type, s.entity_id from (
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.has_default_visible_member is null or d.default_visible_member_count is null
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.default_visible_min_date is null
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.default_visible_min_date < v_min
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.default_visible_min_date > v_min
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where v_min is null and d.default_visible_min_date is not null
    ) s
     limit greatest(p_limit, 0)
  loop
    perform public.dam_refresh_default_visible_flag(r.document_type, r.entity_id);
    commit;
  end loop;
end
$$;

-- FUNCTION public.delete_style_tracker_rows(uuid[])
CREATE OR REPLACE FUNCTION public.delete_style_tracker_rows(p_row_ids uuid[]) RETURNS TABLE(deleted_count integer, skipped_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'plm'
    AS $$
declare
  v_deleted integer;
  v_skipped integer;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'delete_style_tracker_rows requires the admin role'
      using errcode = '42501';
  end if;

  -- Audit BEFORE delete: the audit FK on style_tracker_row_id is ON DELETE SET
  -- NULL, so history survives the row itself.
  insert into public.style_tracker_audit_log (
    event_type,
    style_tracker_row_id,
    source_sheet,
    source_row_number,
    column_letter,
    field_key,
    metadata,
    changed_by
  )
  select
    'row_deleted',
    r.id,
    r.source_sheet,
    r.source_row_number,
    null,
    null,
    jsonb_build_object(
      'tracker_type', r.tracker_type,
      'sku', r.sku,
      'origin', r.row_data ->> 'origin',
      'row_data', r.row_data
    ),
    auth.uid()
  from public.style_tracker_rows r
  where r.id = any(p_row_ids)
    and r.row_data ->> 'origin' = 'user_added';

  delete from public.style_tracker_rows r
  where r.id = any(p_row_ids)
    and r.row_data ->> 'origin' = 'user_added';

  get diagnostics v_deleted = row_count;
  select greatest(coalesce(cardinality(p_row_ids), 0) - v_deleted, 0)
  into v_skipped;

  return query select v_deleted, v_skipped;
end;
$$;

-- FUNCTION public.enforce_hts_rag_precedent_promotion_gate_immutable()
CREATE OR REPLACE FUNCTION public.enforce_hts_rag_precedent_promotion_gate_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.promotion_gate_result is not null
     and new.promotion_gate_result is distinct from old.promotion_gate_result then
    raise exception using
      errcode = '23514',
      message = 'hts_rag_precedents.promotion_gate_result is immutable once set';
  end if;
  return new;
end
$$;

-- FUNCTION public.expand_dam_search_queries(text)
CREATE OR REPLACE FUNCTION public.expand_dam_search_queries(p_query text) RETURNS TABLE(query_text text)
    LANGUAGE sql STABLE SECURITY DEFINER ROWS 4
    SET search_path TO 'public'
    SET enable_seqscan TO 'off'
    SET jit TO 'off'
    AS $_$
  with normalized as (
    select nullif(
      btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')),
      ''
    ) as raw_query
    where public.require_dam_access()
  ),
  words as (
    select t.w, t.ord
    from normalized n
    cross join lateral regexp_split_to_table(
      btrim(lower(regexp_replace(n.raw_query, '[-_/[:space:]]+', ' ', 'g'))), ' '
    ) with ordinality as t(w, ord)
    where n.raw_query is not null
      and t.w <> ''
  ),
  word_count as (
    select count(*) as n from words
  ),
  -- Split: "spiderman" -> "spider man" only when the corpus really writes it
  -- apart ("Spider-Man", "spider man"). Trigram-indexed regex; generic, no list.
  split_candidates as (
    select w.ord, substr(w.w, 1, k) as a, substr(w.w, k + 1) as b
    from words w
    cross join word_count c
    cross join lateral generate_series(3, length(w.w) - 3) as k
    where c.n <= 6
      and w.w ~ '^[[:alpha:]]{6,20}$'
    order by w.ord, k
    limit 40
  ),
  split_ok as (
    select distinct on (s.ord) s.ord, s.a || ' ' || s.b as repl
    from split_candidates s
    where exists (
      select 1
      from public.dam_search_keys k
      -- #804: the word-array test is implied by the regex (both parts are whole
      -- words), so it only narrows the rows the regex must check.
      where (regexp_split_to_array(lower(k.title), '[^[:alnum:]]+') @> array[s.a]
             and regexp_split_to_array(lower(k.title), '[^[:alnum:]]+') && array[s.b, s.b || 's']
             and k.title ~* ('(^|[^[:alnum:]])' || s.a || '[^[:alnum:]]+' || s.b || 's?([^[:alnum:]]|$)'))
         or (regexp_split_to_array(lower(k.path), '[^[:alnum:]]+') @> array[s.a]
             and regexp_split_to_array(lower(k.path), '[^[:alnum:]]+') && array[s.b, s.b || 's']
             and k.path ~* ('(^|[^[:alnum:]])' || s.a || '[^[:alnum:]]+' || s.b || 's?([^[:alnum:]]|$)'))
    )
    order by s.ord, abs(length(s.a) - length(s.b)), length(s.a) desc
  ),
  -- Join: "door mat" -> "doormat" only when the corpus writes it joined.
  join_ok as (
    select w1.ord, w1.w || w2.w as joined
    from words w1
    join words w2 on w2.ord = w1.ord + 1
    cross join word_count c
    where c.n <= 6
      and w1.w ~ '^[[:alnum:]]+$'
      and w2.w ~ '^[[:alnum:]]+$'
      and length(w1.w || w2.w) between 5 and 30
      and exists (
        select 1
        from public.dam_search_keys k
        where (regexp_split_to_array(lower(k.title), '[^[:alnum:]]+') && array[w1.w || w2.w, w1.w || w2.w || 's']
               and k.title ~* ('(^|[^[:alnum:]])' || w1.w || w2.w || 's?([^[:alnum:]]|$)'))
           or (regexp_split_to_array(lower(k.path), '[^[:alnum:]]+') && array[w1.w || w2.w, w1.w || w2.w || 's']
               and k.path ~* ('(^|[^[:alnum:]])' || w1.w || w2.w || 's?([^[:alnum:]]|$)'))
      )
  ),
  compound_variants as (
    -- every verified split applied at once
    select string_agg(coalesce(s.repl, w.w), ' ' order by w.ord) as query_text
    from words w
    left join split_ok s on s.ord = w.ord
    where exists (select 1 from split_ok)
    union
    -- each verified split alone
    select string_agg(case when w.ord = s.ord then s.repl else w.w end, ' ' order by w.ord)
    from split_ok s
    cross join words w
    group by s.ord
    union
    -- each verified join alone
    select string_agg(x.word, ' ' order by x.ord)
    from (
      select j.ord as jord, w.ord,
        case when w.ord = j.ord then j.joined else w.w end as word
      from join_ok j
      cross join words w
      where w.ord <> j.ord + 1
    ) x
    group by x.jord
  ),
  base_variants as (
    select raw_query as query_text
    from normalized
    where raw_query is not null

    union

    select nullif(
      btrim(
        regexp_replace(
          regexp_replace(raw_query, '[-_/]+', ' ', 'g'),
          '\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as query_text
    from normalized
    where raw_query is not null

    union

    select query_text from compound_variants
  ),
  synonym_pass_1 as (
    select distinct nullif(
      btrim(
        regexp_replace(
          b.query_text,
          '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)',
          E'\\1' || s.expansion || E'\\2',
          'gi'
        )
      ),
      ''
    ) as query_text
    from base_variants b
    join public.dam_search_synonyms s
      on s.is_active
     and lower(b.query_text) ~ (
       '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)'
     )
  ),
  synonym_pass_2 as (
    select distinct nullif(
      btrim(
        regexp_replace(
          p.query_text,
          '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)',
          E'\\1' || s.expansion || E'\\2',
          'gi'
        )
      ),
      ''
    ) as query_text
    from synonym_pass_1 p
    join public.dam_search_synonyms s
      on s.is_active
     and lower(p.query_text) ~ (
       '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)'
     )
  ),
  synonym_variants as (
    select query_text from synonym_pass_1
    union
    select query_text from synonym_pass_2
  )
  select distinct query_text
  from (
    select query_text from base_variants
    union all
    select query_text from synonym_variants
  ) variants
  where query_text is not null;
$_$;

-- FUNCTION public.filter_effective_assets(jsonb)
CREATE OR REPLACE FUNCTION public.filter_effective_assets(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS SETOF public.assets
    LANGUAGE sql STABLE
    AS $$
  select a.* from (
    -- Simple tag requests have no optional wide-column reads even in a generic plan.
    select a.*
    from (select distinct e.asset_id from public.asset_effective_tags e
          where e.tag = p_filters ->> 'tagFilter') t
    join public.assets a on a.id=t.asset_id
    where nullif(p_filters ->> 'tagFilter', '') is not null and (coalesce(p_filters, '{}'::jsonb) - array['tagFilter','fileType','status','workflowStatus','stage','isLicensed']::text[]) = '{}'::jsonb
      and a.is_deleted=false
      and a.thumbnail_url is not null
      and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
      and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
      and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
      and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
      and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    union all
    select a.*
    from (select distinct e.asset_id from public.asset_effective_tags e
          where e.tag = p_filters ->> 'tagFilter') t
    join public.assets a on a.id=t.asset_id
    where nullif(p_filters ->> 'tagFilter', '') is not null and (coalesce(p_filters, '{}'::jsonb) - array['tagFilter','fileType','status','workflowStatus','stage','isLicensed']::text[]) = '{}'::jsonb
      and a.is_deleted=false
      and a.thumbnail_url is null
      and (a.modified_at >= (select public.assets_thumbnail_min_date())
        or a.file_created_at >= (select public.assets_thumbnail_min_date()))
      and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
      and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
      and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
      and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
      and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    union all
    -- Preserve the full existing filter path for every other request.
  select a.*
  from (
    -- No identity or tag filter: preserve the simple active-assets path.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is null
      and nullif(p_filters ->> 'tagFilter', '') is null
    union all
    -- No identity filter and a tag filter: let (tag, asset_id) drive the plan.
    -- DISTINCT preserves EXISTS semantics when one asset has the tag at both
    -- asset and style-group scope.
    select a.*
    from (
      select distinct e.asset_id
      from public.asset_effective_tags e
      where nullif(p_filters ->> 'tagFilter', '') is not null
        and e.tag = p_filters ->> 'tagFilter'
    ) t
    join public.assets a on a.id = t.asset_id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is null
    union all
    -- Licensor is the leading key when supplied; property/customer still narrow.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is not null
      and a.style_group_id is null
      and a.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or a.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is not null
      and sg.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or sg.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Property leads only when licensor is absent.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and a.style_group_id is null
      and a.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and sg.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Customer leads only when neither taxonomy key is supplied.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and a.style_group_id is null
      and a.customer_id = (p_filters ->> 'customerId')::uuid
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and sg.customer_id = (p_filters ->> 'customerId')::uuid
  ) a
  where not coalesce((nullif(p_filters ->> 'tagFilter', '') is not null and (coalesce(p_filters, '{}'::jsonb) - array['tagFilter','fileType','status','workflowStatus','stage','isLicensed']::text[]) = '{}'::jsonb), false)
    and a.is_deleted = false
    and (a.modified_at >= public.assets_thumbnail_min_date()
      or a.file_created_at >= public.assets_thumbnail_min_date() or a.thumbnail_url is not null)
    and (nullif(p_filters ->> 'search','') is null or a.filename ilike '%' || (p_filters ->> 'search') || '%')
    and (nullif(p_filters ->> 'tagFilter','') is null or exists (
      select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = p_filters ->> 'tagFilter'))
    and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
    and (jsonb_array_length(coalesce(p_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(p_filters -> 'contentType')))
    and (jsonb_array_length(coalesce(p_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(p_filters -> 'productMaterial')))
    and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
    and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
    and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
    and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    and (jsonb_array_length(coalesce(p_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(p_filters -> 'assetType')))
    and (jsonb_array_length(coalesce(p_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(p_filters -> 'artSource')))
    and (jsonb_array_length(coalesce(p_filters -> 'fileStatus','[]')) = 0 or exists (
      select 1 from jsonb_array_elements_text(p_filters -> 'fileStatus') fs where
        (fs = 'has_preview' and a.thumbnail_url is not null) or
        (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
        (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
        (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
    and (jsonb_array_length(coalesce(p_filters -> 'productCategory','[]')) = 0 or
      a.product_category in (select jsonb_array_elements_text(p_filters -> 'productCategory')) or
      ('Wall' in (select jsonb_array_elements_text(p_filters -> 'productCategory')) and
        (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
    and (nullif(p_filters ->> 'customer','') is null or a.customer = p_filters ->> 'customer')
    and (nullif(p_filters ->> 'program','') is null or a.program = p_filters ->> 'program')
  ) a where public.require_dam_access()
$$;

-- FUNCTION public.find_dam_order_list_row(text, jsonb, jsonb, integer)
CREATE OR REPLACE FUNCTION public.find_dam_order_list_row(p_search text, p_filters jsonb DEFAULT '[]'::jsonb, p_sort jsonb DEFAULT '[]'::jsonb, p_occurrence integer DEFAULT 1) RETURNS TABLE(order_line_id uuid, row_index bigint, match_count bigint)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'auth'
    AS $_$
declare
  allowed_columns constant text[] := array[
    'order_line_id','order_status','production_order_number','vendor_name',
    'order_date','sent_po_date','customer_name','customer_po_number','sku',
    'master_data_match_status','master_data_description','master_data_license_status',
    'master_data_licensor','source_style_type','quantity_ordered','case_pack',
    'start_ship_date','cancel_date','requested_ship_date','actual_ship_date','etd',
    'eta','warehouse_date','container_booking_group','mbl','close_tracking',
    'line_number','order_person','order_type','customer_suffix','ordering_company',
    'assortment_id','assortment_component_ordinal','quantity_shipped','unit_cost',
    'order_depth_inches','cases_reported','ship_to','cargo_forecast_date',
    'start_ship_raw','cancel_raw','cargo_forecast_raw','seal_container_date',
    'vendor_delivery_date','booking_state','test_report','professional_photos',
    'contractual_sample_reorder','line_status','master_data_default_vendor',
    'master_data_customer','item_number','item_style_number','snapshot_description',
    'snapshot_license_status','snapshot_sku','snapshot_source_row','google_source_id',
    'coldlion_source_id','order_void_reason','line_void_reason',
    'order_voided_at','line_voided_at'
  ];
  sort_only_columns constant text[] := array['sales_order_received_date'];
  spec jsonb;
  col text;
  op text;
  sql_op text;
  predicates text := 'true';
  ordering text := '';
  pattern text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise insufficient_privilege using message = 'Authenticated access required';
  end if;
  if p_occurrence is null or p_occurrence < 1 then
    raise invalid_parameter_value using message = 'Occurrence must be a positive integer';
  end if;
  p_filters := coalesce(p_filters, '[]'::jsonb);
  p_sort := coalesce(p_sort, '[]'::jsonb);
  if jsonb_typeof(p_filters) <> 'array' or jsonb_typeof(p_sort) <> 'array' then
    raise invalid_parameter_value using message = 'Filters and sort must be normalized arrays';
  end if;
  for spec in select value from jsonb_array_elements(p_filters) loop
    if jsonb_typeof(spec) <> 'object' then
      raise invalid_parameter_value using message = 'Invalid normalized filter';
    end if;
    col := spec->>'column'; op := spec->>'operator';
    if col is null or not (col = any(allowed_columns))
       or op is null or op not in ('eq','neq','gt','gte','lt','lte','ilike','not.ilike','is','not.is')
       or not (spec ? 'value')
       or exists(select 1 from jsonb_object_keys(spec) k where k not in ('column','operator','value')) then
      raise invalid_parameter_value using message = 'Unsupported normalized filter';
    end if;
    if op in ('is','not.is') then
      if spec->'value' <> 'null'::jsonb then
        raise invalid_parameter_value using message = 'Null filter requires a null value';
      end if;
      predicates := predicates || format(' and d.%I is %snull', col, case when op='not.is' then 'not ' else '' end);
    else
      if jsonb_typeof(spec->'value') not in ('string','number','boolean') then
        raise invalid_parameter_value using message = 'Comparison filter requires a scalar value';
      end if;
      sql_op := case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
        when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<='
        when 'ilike' then 'ilike' when 'not.ilike' then 'not ilike' end;
      -- %I quotes an allowlisted identifier; %L quotes a value. The unknown SQL
      -- literal is coerced to the view column's native type, as PostgREST does.
      -- Normalized ilike values already contain PopDAM's literal escaping.
      predicates := predicates || format(' and d.%I %s %L', col, sql_op, spec->>'value');
    end if;
  end loop;
  for spec in select value from jsonb_array_elements(p_sort) loop
    if jsonb_typeof(spec) <> 'object' then
      raise invalid_parameter_value using message = 'Unsupported normalized sort';
    end if;
    col := spec->>'column';
    if col is null or not (col = any(allowed_columns) or col = any(sort_only_columns))
       or jsonb_typeof(spec->'ascending') is distinct from 'boolean'
       or exists(select 1 from jsonb_object_keys(spec) k where k not in ('column','ascending')) then
      raise invalid_parameter_value using message = 'Unsupported normalized sort';
    end if;
    ordering := ordering || format('d.%I %s nulls last, ', col,
      case when (spec->>'ascending')::boolean then 'asc' else 'desc' end);
  end loop;
  if ordering = '' then ordering := 'd.order_date desc nulls last, '; end if;
  ordering := ordering || 'd.order_line_id asc nulls last';
  -- ECMAScript String.trim whitespace, matching PopDAM rather than just ASCII space.
  p_search := btrim(p_search, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if p_search is null or p_search = '' then return; end if;
  pattern := '%' || replace(replace(replace(p_search, chr(92), chr(92)||chr(92)),
    '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
  return query execute format($query$
    with ranked as materialized (
      select d.order_line_id, row_number() over(order by %s) - 1 as row_index,
        (d.production_order_number ilike $1 or d.order_status ilike $1
         or d.customer_po_number ilike $1 or d.sku ilike $1
         or d.vendor_name ilike $1 or d.customer_name ilike $1
         or d.container_booking_group ilike $1 or d.mbl ilike $1
         or d.snapshot_description ilike $1) as matches
      from api.dam_order_list d where %s
    ),
    matched as (
      select r.order_line_id, r.row_index,
        row_number() over (order by r.row_index) as match_ordinal,
        count(*) over () as match_count
      from ranked r
      where r.matches
    )
    select m.order_line_id, m.row_index, m.match_count
    from matched m
    where m.match_ordinal = $2
  $query$, ordering, predicates) using pattern, p_occurrence;
end;
$_$;

-- FUNCTION public.finish_sku_style_guide_catchup()
CREATE OR REPLACE FUNCTION public.finish_sku_style_guide_catchup() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if exists(select 1 from pg_temp.sku_sg_pending) then
    raise exception 'Cannot finish SKU catch-up with pending work';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname='sku-style-guide-links-catchup-5608';
end $$;

-- FUNCTION public.get_ai_tag_candidates(text, integer, integer, uuid, uuid[])
CREATE OR REPLACE FUNCTION public.get_ai_tag_candidates(p_mode text, p_limit integer, p_after_tier integer DEFAULT NULL::integer, p_after_id uuid DEFAULT NULL::uuid, p_group_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(id uuid, thumbnail_url text, filename text, relative_path text, style_group_id uuid, primary_sort_tier integer)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_has_cursor boolean := p_after_tier is not null and p_after_id is not null;
  v_group_scoped boolean := coalesce(cardinality(p_group_ids), 0) > 0;
begin
  if p_mode is null or p_mode not in ('untagged', 'all') then
    raise exception 'invalid AI tag candidate mode: %', coalesce(p_mode, '<null>')
      using errcode = '22023';
  end if;

  if (p_after_tier is null) <> (p_after_id is null) then
    raise exception 'AI tag candidate cursor requires both tier and asset ID'
      using errcode = '22023';
  end if;

  if p_mode = 'untagged' then
    return query
    select
      candidate.id,
      candidate.thumbnail_url,
      candidate.filename,
      candidate.relative_path,
      candidate.style_group_id,
      candidate.primary_sort_tier::integer
    from public.assets candidate
    where candidate.is_deleted = false
      and candidate.thumbnail_url is not null
      and candidate.primary_sort_tier not in (5, 9)
      and candidate.status <> 'tagged'
      and (not v_group_scoped or candidate.style_group_id = any(p_group_ids))
      and (
        v_group_scoped
        or candidate.style_group_id is null
        or not exists (
          select 1
          from public.assets tagged
          where tagged.style_group_id = candidate.style_group_id
            and tagged.is_deleted = false
            and tagged.status = 'tagged'
            and tagged.ai_tagged_at is not null
        )
      )
      and (
        not v_has_cursor
        or (candidate.primary_sort_tier, candidate.id) > (p_after_tier, p_after_id)
      )
    order by candidate.primary_sort_tier, candidate.id
    limit v_limit;
  else
    return query
    select
      candidate.id,
      candidate.thumbnail_url,
      candidate.filename,
      candidate.relative_path,
      candidate.style_group_id,
      candidate.primary_sort_tier::integer
    from public.assets candidate
    where candidate.is_deleted = false
      and candidate.thumbnail_url is not null
      and candidate.primary_sort_tier not in (5, 9)
      and (not v_group_scoped or candidate.style_group_id = any(p_group_ids))
      and (
        not v_has_cursor
        or (candidate.primary_sort_tier, candidate.id) > (p_after_tier, p_after_id)
      )
    order by candidate.primary_sort_tier, candidate.id
    limit v_limit;
  end if;
end;
$$;

-- FUNCTION public.get_dam_asset_taxonomy_counts()
CREATE OR REPLACE FUNCTION public.get_dam_asset_taxonomy_counts() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '8s'
    AS $$
declare result jsonb;
begin
  perform public.require_dam_access();
  with base as materialized (select licensor_id, property_id from public.assets where not is_deleted),
  licensors as (select licensor_id, count(*) n from base where licensor_id is not null group by licensor_id),
  properties as (select property_id, count(*) n from base where property_id is not null group by property_id)
  select jsonb_build_object('licensors',coalesce((select jsonb_object_agg(licensor_id,n) from licensors),'{}'::jsonb),
    'properties',coalesce((select jsonb_object_agg(property_id,n) from properties),'{}'::jsonb)) into result;
  return result;
end $$;

-- FUNCTION public.get_dam_order_assortment_quantities(uuid[])
CREATE OR REPLACE FUNCTION public.get_dam_order_assortment_quantities(p_line_ids uuid[]) RETURNS TABLE(order_line_id uuid, assortment_sku_quantity numeric, quantity_source text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
begin
  -- OrderList is deliberately readable by every authenticated staff member.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_line_ids is null or cardinality(p_line_ids) > 1500
     or array_position(p_line_ids, null::uuid) is not null then
    raise exception 'Provide at most 1500 non-null OrderList line IDs' using errcode = '22023';
  end if;
  return query
  with lines as materialized (
    select l.id as order_line_id, l.assortment_id,
      case when r.metadata->'orderlist_source_correction'->>'version'='1'
          and r.metadata->'orderlist_source_correction'->>'source_id'=r.source_id
          and r.metadata->'orderlist_source_correction'->>'canonical_sku'=l.sku
          and r.metadata->'orderlist_source_correction'->>'canonical_customer_po' is not distinct from l.customer_po_number
          and r.metadata->'orderlist_source_correction'->>'original_sku'=r.metadata->>'sub_item_no'
          and nullif(btrim(r.metadata->'orderlist_source_correction'->>'evidence_ref'),'') is not null
        then r.metadata->'orderlist_source_correction'->>'original_sku' else l.sku end as sku,
      r.metadata->'orderlist_source_correction' as source_correction,
      r.source_id as coldlion_source_id,
      coalesce(nullif(l.metadata->>'component_source_hash',''),
        case when l.metadata->'coldlion_linked_from'->>'source_id'=r.source_id
          and l.metadata->'coldlion_linked_from'->>'sku'=l.sku
          and l.metadata->'coldlion_linked_from'->>'assortment_id'=l.assortment_id
          then l.metadata#>>'{coldlion_linked_from,metadata,component_source_hash}' end) as component_hash,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
        then split_part(r.source_id, ':', 3)::bigint end as so_number,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
        then split_part(r.source_id, ':', 5)::integer end as so_line
    from plm.production_order_line l
    left join plm.production_order_line_source_ref r on r.production_order_line_id = l.id
      and r.source_system = 'coldlion' and r.is_primary
    where l.id = any(p_line_ids)
  ), order_recipe as materialized (
    select l.order_line_id,
      case when count(*) = count(c.quantity) and count(distinct c.quantity) = 1
        and min(c.quantity) > 0 then min(c.quantity) end as qty
    from lines l
    join coldlion.intake_order_line h on h.company_code = 'EDGEHOME'
      and h.sales_order_no = l.so_number and h.sales_order_line_no = l.so_line
      and h.master_item_no = l.assortment_id
      and (l.source_correction is null or l.source_correction->>'canonical_sku'=l.sku
        or (l.source_correction->>'original_sku'=l.sku
          and l.source_correction->>'original_customer_po' is not distinct from h.po_number))
    join coldlion.intake_order_component c on c.line_id = h.id
      and c.sub_item_no = l.sku and c.component_source_hash = l.component_hash
    group by l.order_line_id
  ), catalog_items as materialized (
    -- The source index orders division before item number. Scan the company
    -- once instead of repeating a partial-index scan for every requested SKU.
    select i.item_no, i.company_code, i.division_code, i.pre_pack_code
    from coldlion.item_detail i
    where i.company_code = 'EDGEHOME' and nullif(btrim(i.pre_pack_code), '') is not null
  ), heads as materialized (
    -- Resolve the whole manifest first. Multiple pack codes or divisions abstain,
    -- even when just one of those recipes happens to contain the requested SKU.
    select distinct i.item_no, i.company_code, i.division_code, i.pre_pack_code
    from catalog_items i
    where i.item_no in (select l.assortment_id from lines l where l.coldlion_source_id is null)
  ), unique_heads as materialized (
    select h.item_no, min(h.company_code) as company_code,
      min(h.division_code) as division_code, min(h.pre_pack_code) as pre_pack_code
    from heads h group by h.item_no having count(*) = 1
  ), catalog_recipe as materialized (
    select l.order_line_id,
      case when count(*) = 1 and min(p.quantity) > 0
        and bool_and(nullif(btrim(p.detail_prepack), '') is null)
        then min(p.quantity)::numeric end as qty
    from lines l
    join unique_heads h on h.item_no = l.assortment_id
    join coldlion.prepack_detail p on p.company_code = h.company_code
      and p.prepack_code = h.pre_pack_code and p.division_code = h.division_code
      and p.item_no = l.sku
    where l.coldlion_source_id is null
    group by l.order_line_id
  )
  select l.order_line_id,
    case when l.coldlion_source_id is not null then r.qty else c.qty end,
    case when l.coldlion_source_id is not null and r.qty is not null then 'order_recipe'
      when l.coldlion_source_id is null and c.qty is not null then 'current_recipe' end
  from lines l
  left join order_recipe r on r.order_line_id = l.order_line_id
  left join catalog_recipe c on c.order_line_id = l.order_line_id;
end;
$_$;

-- FUNCTION public.get_dam_order_list_status_counts()
CREATE OR REPLACE FUNCTION public.get_dam_order_list_status_counts() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    SET statement_timeout TO '8s'
    AS $$
declare result jsonb;
begin
  perform public.require_dam_access();
  select jsonb_build_object('total',count(*),'linked',count(*) filter(where item_id is not null),
    'ambiguous',count(*) filter(where master_data_match_status='ambiguous'),
    'unmatched',count(*) filter(where item_id is null and master_data_match_status not in ('not_applicable','ambiguous')))
  into result from api.dam_order_list;
  return result;
end $$;

-- FUNCTION public.get_dam_order_sales_order_dates(uuid[])
CREATE OR REPLACE FUNCTION public.get_dam_order_sales_order_dates(p_line_ids uuid[]) RETURNS TABLE(order_line_id uuid, sales_order_date date)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
begin
  -- Matches today's authenticated-wide OrderList read policies. If those
  -- policies narrow, this definer reader's authorization must change with them.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_line_ids is null or cardinality(p_line_ids) > 1500
     or array_position(p_line_ids, null::uuid) is not null then
    raise exception 'Provide at most 1500 non-null OrderList line IDs' using errcode = '22023';
  end if;

  return query
  with visible_lines as materialized (
    select distinct o.order_line_id, o.coldlion_source_id
    from api.dam_order_list o
    where o.order_line_id = any(p_line_ids)
  ), linked as materialized (
    select v.order_line_id,
      case when v.coldlion_source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,10}:component:[1-9][0-9]{0,9}$'
        then split_part(v.coldlion_source_id, ':', 3)::bigint end as so_number
    from visible_lines v
  ), source_dates as materialized (
    select h.sales_order_no,
      case when count(*) = count(h.created_time)
        and count(distinct h.created_time) = 1
        and min(h.created_time) > timestamptz '2000-01-01 00:00:00+00'
      then (min(h.created_time) at time zone 'America/New_York')::date end as so_date
    from coldlion.order_history_line h
    where h.company_code = 'EDGEHOME'
      and h.sales_order_no in (select distinct l.so_number from linked l where l.so_number is not null)
    group by h.sales_order_no
  )
  select l.order_line_id, d.so_date
  from linked l left join source_dates d on d.sales_order_no = l.so_number;
end;
$_$;

-- VIEW dam.dam_order_list_customer_directory
CREATE OR REPLACE VIEW dam.dam_order_list_customer_directory WITH (security_invoker='false') AS
 SELECT id AS customer_id,
    name AS customer_name
   FROM core.customer c;

-- VIEW dam.dam_order_list_vendor_directory
CREATE OR REPLACE VIEW dam.dam_order_list_vendor_directory WITH (security_invoker='false') AS
 SELECT id AS vendor_id,
    name AS vendor_name
   FROM core.factory f;

-- TABLE dam.order_tracking_ext
CREATE TABLE dam.order_tracking_ext (
    order_id uuid NOT NULL,
    crd_override_set boolean DEFAULT false NOT NULL,
    eta_override_set boolean DEFAULT false NOT NULL,
    agent text,
    cbm numeric,
    comment text,
    vessel text,
    sent_to_coldlion boolean,
    worksheet_done boolean,
    inspection_passed date,
    inspection_note text,
    document_invoice boolean,
    document_packing_list boolean,
    document_bill_of_lading boolean,
    document_tsca boolean,
    document_lacey_act boolean,
    document_telex boolean,
    request_wire boolean,
    payment_note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT order_tracking_ext_cbm_check CHECK (((cbm >= (0)::numeric) AND (cbm < 'Infinity'::numeric)))
);

-- TABLE dam.orderlist_customer_settings
CREATE TABLE dam.orderlist_customer_settings (
    customer_normalized text NOT NULL,
    suffix text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT orderlist_customer_settings_customer_normalized_check CHECK (((customer_normalized = lower(btrim(customer_normalized))) AND (customer_normalized <> ''::text))),
    CONSTRAINT orderlist_customer_settings_suffix_check CHECK (((length(suffix) >= 1) AND (length(suffix) <= 50)))
);

-- TABLE dam.orderlist_sample_depth
CREATE TABLE dam.orderlist_sample_depth (
    sku_normalized text NOT NULL,
    customer_normalized text NOT NULL,
    depth_inches numeric,
    depth_raw text,
    source_workbook_id text,
    source_row_number integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT orderlist_sample_depth_customer_normalized_check CHECK (((customer_normalized = lower(btrim(customer_normalized))) AND (customer_normalized <> ''::text))),
    CONSTRAINT orderlist_sample_depth_depth_inches_check CHECK (((depth_inches > (0)::numeric) AND (depth_inches < 'Infinity'::numeric))),
    CONSTRAINT orderlist_sample_depth_sku_normalized_check CHECK (((sku_normalized = lower(btrim(sku_normalized))) AND (sku_normalized <> ''::text))),
    CONSTRAINT orderlist_sample_depth_source_row_number_check CHECK ((source_row_number > 0))
);

-- VIEW api.dam_order_list
CREATE OR REPLACE VIEW api.dam_order_list WITH (security_invoker='true') AS
 SELECT pol.id AS order_line_id,
    po.id AS order_id,
    po.production_order_number,
        CASE
            WHEN ((po.source_system = 'coldlion'::text) AND (po.production_order_number ~~ 'coldlion/%'::text)) THEN po.status
            ELSE dam.orderlist_po_status(pol.order_type, pol.sku, pol.assortment_id, COALESCE(pol.quantity_ordered,
            CASE
                WHEN ((pol.source_system = 'coldlion'::text) AND (pol.assortment_component_ordinal IS NOT NULL) AND (NOT (pol.metadata ? 'order_list_source'::text)) AND (pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$'::text)) THEN NULL::numeric
                ELSE parent.quantity
            END), pol.case_pack, po.close_tracking, po.booking_state, po.etd,
            CASE
                WHEN ext.crd_override_set THEN po.vendor_delivery_date
                ELSE COALESCE(po.vendor_delivery_date, po.seal_container_date)
            END, po.sent_po_date, po.production_order_number)
        END AS order_status,
    po.company_id,
    COALESCE(cust.customer_name, NULLIF((po.metadata ->> 'customer_name'::text), ''::text)) AS customer_name,
    po.factory_id,
    COALESCE(fact.vendor_name, NULLIF((po.metadata ->> 'order_vendor_name'::text), ''::text)) AS vendor_name,
    (po.metadata ->> 'ordering_company'::text) AS ordering_company,
    po.order_date,
    po.sent_po_date,
        CASE
            WHEN ext.crd_override_set THEN po.vendor_delivery_date
            ELSE COALESCE(po.vendor_delivery_date, po.seal_container_date)
        END AS seal_container_date,
    po.vendor_delivery_date,
    po.requested_ship_date,
    po.actual_ship_date,
    po.booking_state,
    po.etd,
    po.eta,
        CASE
            WHEN ext.eta_override_set THEN (po.eta + 5)
            ELSE COALESCE((po.eta + 5), po.warehouse_date)
        END AS warehouse_date,
    po.container_booking_group,
    po.mbl,
    po.close_tracking,
    po.voided_at AS order_voided_at,
    po.void_reason AS order_void_reason,
    pol.line_number,
    pol.order_person,
    pol.order_type,
        CASE
            WHEN (pol.order_type = 'David Sample'::text) THEN 'David'::text
            WHEN (pol.order_type = 'Contractual Sample'::text) THEN 'CONT'::text
            ELSE COALESCE(customer_settings.suffix, pol.customer_suffix)
        END AS customer_suffix,
    pol.customer_po_number,
    pol.assortment_id,
    pol.assortment_component_ordinal,
    pol.sku,
    pol.sku_normalized,
    pol.quantity_ordered,
    pol.quantity_shipped,
    pol.unit_cost,
    pol.order_depth_inches,
    pol.case_pack,
        CASE
            WHEN ((pol.source_system = 'coldlion'::text) AND (pol.assortment_component_ordinal IS NOT NULL) AND (NOT (pol.metadata ? 'order_list_source'::text)) AND (pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$'::text)) THEN NULL::numeric
            ELSE
            CASE
                WHEN ((pol.case_pack > (0)::numeric) AND (pol.quantity_ordered IS NOT NULL) AND (pol.quantity_ordered >= pol.case_pack)) THEN (pol.quantity_ordered / pol.case_pack)
                ELSE NULL::numeric
            END
        END AS cases_reported,
    pol.ship_to,
    pol.start_ship_date,
    pol.start_ship_raw,
    pol.cancel_date,
    pol.cancel_raw,
    dam.orderlist_cargo_forecast(pol.order_type, pol.ship_to, pol.start_ship_date) AS cargo_forecast_date,
        CASE
            WHEN (NULLIF(btrim(pol.order_type), ''::text) IS NULL) THEN NULL::text
            WHEN (pol.start_ship_date IS NULL) THEN 'NoDate'::text
            WHEN (dam.orderlist_cargo_forecast(pol.order_type, pol.ship_to, pol.start_ship_date) IS NULL) THEN 'N/A'::text
            ELSE NULL::text
        END AS cargo_forecast_raw,
        CASE
            WHEN ((product.facts ->> 'source'::text) = 'master_data'::text) THEN (product.facts ->> 'test_report'::text)
            WHEN (pol.item_id IS NULL) THEN pol.test_report
            ELSE NULL::text
        END AS test_report,
        CASE
            WHEN ((product.facts ->> 'source'::text) = 'master_data'::text) THEN (product.facts ->> 'professional_photos'::text)
            WHEN (pol.item_id IS NULL) THEN pol.professional_photos
            ELSE NULL::text
        END AS professional_photos,
        CASE
            WHEN ((product.facts ->> 'source'::text) = 'master_data'::text) THEN ((product.facts ->> 'contractual_sample_reorder'::text))::boolean
            WHEN (pol.item_id IS NULL) THEN pol.contractual_sample_reorder
            ELSE NULL::boolean
        END AS contractual_sample_reorder,
    pol.status AS line_status,
    pol.voided_at AS line_voided_at,
    pol.void_reason AS line_void_reason,
    pol.source_style_type,
    pol.master_data_match_status,
    pol.item_id,
    item.item_number,
    item.style_number AS item_style_number,
    item.name AS item_name,
    item.description AS item_description,
    ((product.facts ->> 'bridge_id'::text))::uuid AS style_tracker_bridge_id,
    ((product.facts ->> 'tracker_id'::text))::uuid AS style_tracker_row_id,
    (product.facts ->> 'tracker_type'::text) AS master_data_tracker_type,
    item.description AS master_data_description,
    (product.facts ->> 'license_status'::text) AS master_data_license_status,
    (product.facts ->> 'licensor'::text) AS master_data_licensor,
    (product.facts ->> 'default_vendor'::text) AS master_data_default_vendor,
    (product.facts ->> 'customer'::text) AS master_data_customer,
    (pol.metadata #>> '{order_list_snapshot,sku}'::text[]) AS snapshot_sku,
    (pol.metadata #>> '{order_list_snapshot,description}'::text[]) AS snapshot_description,
    (pol.metadata #>> '{order_list_snapshot,license_status}'::text[]) AS snapshot_license_status,
    (pol.metadata #>> '{order_list_snapshot,style_type}'::text[]) AS snapshot_style_type,
    COALESCE((pol.metadata #>> '{order_list_source,sheet_row}'::text[]), (pol.metadata #>> '{order_list_snapshot,source_row}'::text[])) AS snapshot_source_row,
    (pol.item_id IS NULL) AS item_link_missing,
    ((pol.item_id IS NOT NULL) AND (pol.source_style_type IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM plm.style_tracker_item_bridge b
          WHERE ((b.plm_item_id = pol.item_id) AND (b.tracker_type = pol.source_style_type))))) AND (EXISTS ( SELECT 1
           FROM plm.style_tracker_item_bridge b
          WHERE (b.plm_item_id = pol.item_id)))) AS item_link_type_mismatch,
    google_ref.source_id AS google_source_id,
    coldlion_ref.source_id AS coldlion_source_id,
    pol.created_at AS line_created_at,
    pol.updated_at AS line_updated_at,
        CASE
            WHEN (pol.item_id IS NULL) THEN 'at_import'::text
            ELSE (product.facts ->> 'source'::text)
        END AS product_workflow_source,
    (product.facts ->> 'sample_vendor'::text) AS master_data_sample_vendor,
    sample.depth_inches AS sample_depth_inches,
        CASE
            WHEN (pol.case_pack = (0)::numeric) THEN 'Wrong Input'::text
            WHEN (pol.case_pack < (0)::numeric) THEN 'Wrong Input'::text
            WHEN ((pol.source_system = 'coldlion'::text) AND (pol.assortment_component_ordinal IS NOT NULL) AND (NOT (pol.metadata ? 'order_list_source'::text)) AND (pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$'::text)) THEN
            CASE
                WHEN ((parent.quantity IS NOT NULL) AND (pol.case_pack > parent.quantity)) THEN 'Wrong QTY'::text
                ELSE NULL::text
            END
            WHEN ((COALESCE(pol.quantity_ordered, parent.quantity) IS NOT NULL) AND (pol.case_pack > COALESCE(pol.quantity_ordered, parent.quantity))) THEN 'Wrong QTY'::text
            ELSE NULL::text
        END AS cases_error,
    parent.quantity AS assortment_parent_quantity,
        CASE
            WHEN ((parent.physical_key IS NOT NULL) AND (parent.quantity >= pol.case_pack) AND (pol.case_pack > (0)::numeric)) THEN (parent.quantity / pol.case_pack)
            ELSE NULL::numeric
        END AS assortment_parent_cases,
    parent.physical_key AS assortment_parent_key,
    sample.depth_raw AS sample_depth_raw,
    sample.source_row_number AS sample_depth_source_row,
    pol.test_report AS snapshot_test_report,
    pol.professional_photos AS snapshot_professional_photos,
    pol.contractual_sample_reorder AS snapshot_contractual_sample_reorder,
    so_date.sales_order_received_date,
    COALESCE(so_date.sales_order_received_date, po.sent_po_date, pol.start_ship_date, po.order_date) AS order_window_date,
        CASE
            WHEN ((jsonb_typeof((pol.metadata #> '{coldlion_values,quantity_ordered}'::text[])) = 'number'::text) AND (((pol.metadata #>> '{coldlion_values,quantity_ordered}'::text[]))::numeric IS DISTINCT FROM pol.quantity_ordered) AND ((pol.metadata #> '{coldlion_reviewed,quantity_ordered}'::text[]) IS DISTINCT FROM (pol.metadata #> '{coldlion_values,quantity_ordered}'::text[]))) THEN ((pol.metadata #>> '{coldlion_values,quantity_ordered}'::text[]))::numeric
            ELSE NULL::numeric
        END AS coldlion_quantity_ordered,
        CASE
            WHEN ((NULLIF(btrim((pol.metadata #>> '{coldlion_values,import_po}'::text[])), ''::text) IS NOT NULL) AND (lower(btrim((pol.metadata #>> '{coldlion_values,import_po}'::text[]))) IS DISTINCT FROM lower(btrim(po.production_order_number))) AND ((pol.metadata #> '{coldlion_reviewed,import_po}'::text[]) IS DISTINCT FROM (pol.metadata #> '{coldlion_values,import_po}'::text[]))) THEN btrim((pol.metadata #>> '{coldlion_values,import_po}'::text[]))
            ELSE NULL::text
        END AS coldlion_import_po,
    (((po.metadata ->> 'production_order_number_origin'::text) = 'coldlion_intake_placeholder'::text) AND (po.production_order_number ~ '^COLDLION-SO-[0-9]+$'::text) AND (pol.voided_at IS NULL) AND (po.voided_at IS NULL) AND (coldlion_ref.id IS NOT NULL) AND (google_ref.id IS NULL) AND (COALESCE((pol.metadata ->> 'coldlion_kept_separate'::text), ''::text) <> 'true'::text)) AS coldlion_unmatched
   FROM ((((((((((((plm.production_order_line pol
     JOIN plm.production_order po ON ((po.id = pol.production_order_id)))
     LEFT JOIN dam.dam_order_list_customer_directory cust ON ((cust.customer_id = po.company_id)))
     LEFT JOIN dam.dam_order_list_vendor_directory fact ON ((fact.vendor_id = po.factory_id)))
     LEFT JOIN dam.order_tracking_ext ext ON ((ext.order_id = po.id)))
     LEFT JOIN plm.item item ON ((item.id = pol.item_id)))
     LEFT JOIN LATERAL ( SELECT ( SELECT f.facts
                   FROM dam.orderlist_product_facts(pol.item_id, pol.source_style_type) f(facts)) AS facts
         OFFSET 0) product ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN ((pol.source_system = 'coldlion'::text) AND (pol.assortment_component_ordinal IS NOT NULL) AND (NOT (pol.metadata ? 'order_list_source'::text)) AND (pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$'::text)) THEN dam.orderlist_parse_number((pol.metadata ->> 'line_qty'::text))
                    WHEN ((pol.assortment_component_ordinal IS NOT NULL) AND ((pol.metadata #>> '{order_list_snapshot,component_quantity_source}'::text[]) = 'absent_never_guessed'::text)) THEN dam.orderlist_parse_number((pol.metadata #>> '{order_list_snapshot,assortment_parent_quantity}'::text[]))
                    ELSE NULL::numeric
                END AS quantity,
                CASE
                    WHEN ((pol.source_system = 'coldlion'::text) AND (pol.assortment_component_ordinal IS NOT NULL) AND (NOT (pol.metadata ? 'order_list_source'::text)) AND (pol.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$'::text)) THEN (jsonb_build_array('coldlion', split_part(pol.source_id, ':'::text, 3), split_part(pol.source_id, ':'::text, 5), (pol.metadata ->> 'master_item_no'::text)))::text
                    WHEN ((pol.assortment_component_ordinal IS NOT NULL) AND ((pol.metadata #>> '{order_list_snapshot,component_quantity_source}'::text[]) = 'absent_never_guessed'::text) AND (NULLIF((pol.metadata #>> '{order_list_source,spreadsheet_id}'::text[]), ''::text) IS NOT NULL) AND (NULLIF((pol.metadata #>> '{order_list_source,tab}'::text[]), ''::text) IS NOT NULL) AND (NULLIF((pol.metadata #>> '{order_list_source,sheet_row}'::text[]), ''::text) IS NOT NULL)) THEN (jsonb_build_array((pol.metadata #>> '{order_list_source,spreadsheet_id}'::text[]), (pol.metadata #>> '{order_list_source,tab}'::text[]), (pol.metadata #>> '{order_list_source,sheet_row}'::text[])))::text
                    ELSE NULL::text
                END AS physical_key) parent ON (true))
     LEFT JOIN dam.orderlist_sample_depth sample ON (((sample.sku_normalized = pol.sku_normalized) AND (sample.customer_normalized = lower(btrim(COALESCE(cust.customer_name, NULLIF((po.metadata ->> 'customer_name'::text), ''::text))))))))
     LEFT JOIN dam.orderlist_customer_settings customer_settings ON ((customer_settings.customer_normalized = lower(btrim(COALESCE(cust.customer_name, NULLIF((po.metadata ->> 'customer_name'::text), ''::text)))))))
     LEFT JOIN plm.production_order_line_source_ref google_ref ON (((google_ref.production_order_line_id = pol.id) AND (google_ref.source_system = 'google_order_list'::text) AND google_ref.is_primary)))
     LEFT JOIN plm.production_order_line_source_ref coldlion_ref ON (((coldlion_ref.production_order_line_id = pol.id) AND (coldlion_ref.source_system = 'coldlion'::text) AND coldlion_ref.is_primary)))
     LEFT JOIN LATERAL ( SELECT dam.orderlist_sales_order_received_date(coldlion_ref.source_id) AS sales_order_received_date) so_date ON (true));

-- VIEW dam.dam_order_tracking
CREATE OR REPLACE VIEW dam.dam_order_tracking WITH (security_invoker='true') AS
 SELECT po.id AS order_id,
    po.production_order_number,
    po.order_date,
    po.voided_at AS order_voided_at,
    COALESCE(cust.customer_name, NULLIF((po.metadata ->> 'customer_name'::text), ''::text)) AS customer_name,
    COALESCE(fact.vendor_name, NULLIF((po.metadata ->> 'order_vendor_name'::text), ''::text)) AS vendor_name,
    po.factory_id,
    po.company_id,
    lines.line_count,
    lines.total_cases,
    lines.invalid_case_lines,
    lines.missing_test_reports,
    lines.missing_photos,
    lines.unresolved_product_lines,
    lines.order_type,
    lines.start_ship_date,
    lines.cancel_date,
    lines.cargo_forecast_date,
    lines.customer_po_number,
    lines.customer_suffix,
    lines.components,
    po.sent_po_date,
        CASE
            WHEN ext.crd_override_set THEN po.vendor_delivery_date
            ELSE COALESCE(po.vendor_delivery_date, po.seal_container_date)
        END AS vendor_delivery_date,
        CASE
            WHEN (
            CASE
                WHEN ext.crd_override_set THEN po.vendor_delivery_date
                ELSE COALESCE(po.vendor_delivery_date, po.seal_container_date)
            END IS NOT NULL) THEN (
            CASE
                WHEN ext.crd_override_set THEN po.vendor_delivery_date
                ELSE COALESCE(po.vendor_delivery_date, po.seal_container_date)
            END +
            CASE lines.order_type
                WHEN 'FOB'::text THEN 5
                WHEN 'POE'::text THEN 21
                WHEN 'C Stock'::text THEN 27
                ELSE NULL::integer
            END)
            ELSE NULL::date
        END AS seal_container_forecast,
    po.booking_state,
    po.etd,
    po.eta,
        CASE
            WHEN ext.eta_override_set THEN (po.eta + 5)
            ELSE COALESCE((po.eta + 5), po.warehouse_date)
        END AS warehouse_date,
        CASE
            WHEN (lines.order_type = 'FOB'::text) THEN NULL::integer
            WHEN (lines.order_type = 'POE'::text) THEN (po.eta - lines.cancel_date)
            ELSE (
            CASE
                WHEN ext.eta_override_set THEN (po.eta + 5)
                ELSE COALESCE((po.eta + 5), po.warehouse_date)
            END - lines.cancel_date)
        END AS days_delay,
        CASE
            WHEN ((lines.order_type = 'POE'::text) AND (COALESCE(cust.customer_name, NULLIF((po.metadata ->> 'customer_name'::text), ''::text)) = 'Burlington'::text) AND (ext.worksheet_done IS NOT TRUE)) THEN ((po.eta - CURRENT_DATE) - 5)
            ELSE NULL::integer
        END AS worksheet_days_remaining,
    po.container_booking_group,
    po.mbl,
    po.close_tracking,
    ext.agent,
    ext.cbm,
    ext.comment,
    ext.vessel,
    ext.sent_to_coldlion,
    ext.worksheet_done,
    ext.inspection_passed,
    ext.inspection_note,
    ext.document_invoice,
    ext.document_packing_list,
    ext.document_bill_of_lading,
    ext.document_tsca,
    ext.document_lacey_act,
    ext.document_telex,
    ext.request_wire,
    ext.payment_note,
    ext.updated_at AS tracking_updated_at,
        CASE
            WHEN (ext.inspection_passed IS NOT NULL) THEN ((('S'::text || ((ext.inspection_passed - '1899-12-30'::date))::text) || '-'::text) || SUBSTRING(po.production_order_number FROM 2))
            ELSE NULL::text
        END AS svn_number,
        CASE
            WHEN ("left"(po.container_booking_group, 2) = 'BN'::text) THEN ((po.container_booking_group || ','::text) || po.production_order_number)
            ELSE NULL::text
        END AS booking_string,
        CASE
            WHEN (lines.order_type = 'FOB'::text) THEN 'FOB'::text
            WHEN ((lines.order_type = 'POE'::text) AND (po.eta IS NULL)) THEN 'no ETA'::text
            WHEN ((lines.order_type IS NOT NULL) AND (lines.cancel_date IS NULL)) THEN 'no cancel date'::text
            WHEN ((lines.order_type IS NOT NULL) AND (po.eta IS NULL)) THEN 'no WHS Date'::text
            ELSE NULL::text
        END AS days_delay_status,
        CASE
            WHEN (lines.line_count = 0) THEN 'No order lines'::text
            WHEN (lines.order_type IS NULL) THEN 'Mixed or sample order types'::text
            WHEN (
            CASE
                WHEN ext.crd_override_set THEN po.vendor_delivery_date
                ELSE COALESCE(po.vendor_delivery_date, po.seal_container_date)
            END IS NULL) THEN 'No date'::text
            WHEN (lines.order_type <> ALL (ARRAY['FOB'::text, 'POE'::text, 'C Stock'::text])) THEN 'N/A'::text
            ELSE NULL::text
        END AS seal_container_forecast_status,
    lines.unknown_case_groups
   FROM ((((plm.production_order po
     LEFT JOIN LATERAL ( WITH scoped AS MATERIALIZED (
                 SELECT l.order_line_id,
                    l.order_id,
                    l.production_order_number,
                    l.order_status,
                    l.company_id,
                    l.customer_name,
                    l.factory_id,
                    l.vendor_name,
                    l.ordering_company,
                    l.order_date,
                    l.sent_po_date,
                    l.seal_container_date,
                    l.vendor_delivery_date,
                    l.requested_ship_date,
                    l.actual_ship_date,
                    l.booking_state,
                    l.etd,
                    l.eta,
                    l.warehouse_date,
                    l.container_booking_group,
                    l.mbl,
                    l.close_tracking,
                    l.order_voided_at,
                    l.order_void_reason,
                    l.line_number,
                    l.order_person,
                    l.order_type,
                    l.customer_suffix,
                    l.customer_po_number,
                    l.assortment_id,
                    l.assortment_component_ordinal,
                    l.sku,
                    l.sku_normalized,
                    l.quantity_ordered,
                    l.quantity_shipped,
                    l.unit_cost,
                    l.order_depth_inches,
                    l.case_pack,
                    l.cases_reported,
                    l.ship_to,
                    l.start_ship_date,
                    l.start_ship_raw,
                    l.cancel_date,
                    l.cancel_raw,
                    l.cargo_forecast_date,
                    l.cargo_forecast_raw,
                    l.test_report,
                    l.professional_photos,
                    l.contractual_sample_reorder,
                    l.line_status,
                    l.line_voided_at,
                    l.line_void_reason,
                    l.source_style_type,
                    l.master_data_match_status,
                    l.item_id,
                    l.item_number,
                    l.item_style_number,
                    l.item_name,
                    l.item_description,
                    l.style_tracker_bridge_id,
                    l.style_tracker_row_id,
                    l.master_data_tracker_type,
                    l.master_data_description,
                    l.master_data_license_status,
                    l.master_data_licensor,
                    l.master_data_default_vendor,
                    l.master_data_customer,
                    l.snapshot_sku,
                    l.snapshot_description,
                    l.snapshot_license_status,
                    l.snapshot_style_type,
                    l.snapshot_source_row,
                    l.item_link_missing,
                    l.item_link_type_mismatch,
                    l.google_source_id,
                    l.coldlion_source_id,
                    l.line_created_at,
                    l.line_updated_at,
                    l.product_workflow_source,
                    l.master_data_sample_vendor,
                    l.sample_depth_inches,
                    l.cases_error,
                    l.assortment_parent_quantity,
                    l.assortment_parent_cases,
                    l.assortment_parent_key,
                    l.sample_depth_raw,
                    l.sample_depth_source_row,
                    l.snapshot_test_report,
                    l.snapshot_professional_photos,
                    l.snapshot_contractual_sample_reorder,
                    l.sales_order_received_date,
                    l.order_window_date
                   FROM api.dam_order_list l
                  WHERE ((l.order_id = po.id) AND (l.order_voided_at IS NULL) AND (l.line_voided_at IS NULL))
                ), physical AS MATERIALIZED (
                 SELECT
                        CASE
                            WHEN ((count(DISTINCT scoped_1.case_pack) = 1) AND (count(scoped_1.case_pack) = count(*)) AND (count(DISTINCT scoped_1.assortment_parent_quantity) = 1) AND (count(scoped_1.assortment_parent_quantity) = count(*)) AND (min(scoped_1.case_pack) > (0)::numeric) AND (min(scoped_1.assortment_parent_quantity) >= min(scoped_1.case_pack))) THEN (min(scoped_1.assortment_parent_quantity) / min(scoped_1.case_pack))
                            ELSE NULL::numeric
                        END AS cases
                   FROM scoped scoped_1
                  WHERE ((scoped_1.assortment_parent_key IS NOT NULL) AND (scoped_1.order_type IS DISTINCT FROM 'Contractual Sample'::text) AND (scoped_1.order_type IS DISTINCT FROM 'David Sample'::text))
                  GROUP BY scoped_1.assortment_parent_key
                UNION ALL
                 SELECT scoped_1.cases_reported
                   FROM scoped scoped_1
                  WHERE ((scoped_1.assortment_parent_key IS NULL) AND (scoped_1.order_type IS DISTINCT FROM 'Contractual Sample'::text) AND (scoped_1.order_type IS DISTINCT FROM 'David Sample'::text))
                )
         SELECT count(*) AS line_count,
            ( SELECT
                        CASE
                            WHEN (count(physical.cases) = count(*)) THEN COALESCE(sum(physical.cases), (0)::numeric)
                            ELSE NULL::numeric
                        END AS "case"
                   FROM physical) AS total_cases,
            ( SELECT count(*) AS count
                   FROM physical
                  WHERE (physical.cases IS NULL)) AS unknown_case_groups,
            count(*) FILTER (WHERE (scoped.cases_error IS NOT NULL)) AS invalid_case_lines,
            count(*) FILTER (WHERE (dam.orderlist_parse_boolean(scoped.test_report) IS NOT TRUE)) AS missing_test_reports,
            count(*) FILTER (WHERE (dam.orderlist_parse_boolean(scoped.professional_photos) IS NOT TRUE)) AS missing_photos,
            count(*) FILTER (WHERE (scoped.product_workflow_source IS DISTINCT FROM 'master_data'::text)) AS unresolved_product_lines,
                CASE
                    WHEN (count(DISTINCT scoped.order_type) FILTER (WHERE (scoped.order_type <> ALL (ARRAY['Contractual Sample'::text, 'David Sample'::text]))) = 1) THEN min(scoped.order_type) FILTER (WHERE (scoped.order_type <> ALL (ARRAY['Contractual Sample'::text, 'David Sample'::text])))
                    ELSE NULL::text
                END AS order_type,
            min(scoped.start_ship_date) AS start_ship_date,
            min(scoped.cancel_date) AS cancel_date,
            min(scoped.cargo_forecast_date) AS cargo_forecast_date,
            string_agg(DISTINCT scoped.customer_po_number, '
'::text ORDER BY scoped.customer_po_number) AS customer_po_number,
            string_agg(DISTINCT scoped.customer_suffix, '
'::text ORDER BY scoped.customer_suffix) AS customer_suffix,
            jsonb_agg(jsonb_build_object('line_id', scoped.order_line_id, 'sku', scoped.sku, 'assortment', scoped.assortment_id, 'quantity', scoped.quantity_ordered, 'case_pack', scoped.case_pack, 'cases', scoped.cases_reported, 'order_depth_inches', scoped.order_depth_inches, 'ship_to', scoped.ship_to, 'start_ship_date', scoped.start_ship_date, 'cancel_date', scoped.cancel_date, 'customer_po_number', scoped.customer_po_number, 'cases_error', scoped.cases_error, 'description', scoped.item_description, 'license_status', scoped.master_data_license_status, 'workflow_source', scoped.product_workflow_source, 'test_report', scoped.test_report, 'professional_photos', scoped.professional_photos, 'parent_cases', scoped.assortment_parent_cases, 'parent_quantity', scoped.assortment_parent_quantity, 'sample_depth_raw', scoped.sample_depth_raw, 'sample_depth_source_row', scoped.sample_depth_source_row, 'contractual_sample_reorder', scoped.contractual_sample_reorder, 'snapshot_test_report', scoped.snapshot_test_report, 'snapshot_professional_photos', scoped.snapshot_professional_photos, 'snapshot_contractual_sample_reorder', scoped.snapshot_contractual_sample_reorder, 'sample_depth_inches', scoped.sample_depth_inches, 'default_vendor', scoped.master_data_default_vendor, 'sample_vendor', scoped.master_data_sample_vendor) ORDER BY scoped.assortment_id, scoped.assortment_component_ordinal, scoped.line_number, scoped.order_line_id) AS components
           FROM scoped) lines ON (true))
     LEFT JOIN dam.dam_order_list_customer_directory cust ON ((cust.customer_id = po.company_id)))
     LEFT JOIN dam.dam_order_list_vendor_directory fact ON ((fact.vendor_id = po.factory_id)))
     LEFT JOIN dam.order_tracking_ext ext ON ((ext.order_id = po.id)))
  WHERE (NOT (COALESCE((po.source_system = 'coldlion'::text), false) AND COALESCE((po.production_order_number ~~ 'coldlion/%'::text), false)));

-- FUNCTION public.get_dam_order_tracking(integer, integer, text, boolean)
CREATE OR REPLACE FUNCTION public.get_dam_order_tracking(p_offset integer DEFAULT 0, p_limit integer DEFAULT 100, p_search text DEFAULT NULL::text, p_only_open boolean DEFAULT false) RETURNS SETOF dam.dam_order_tracking
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare pattern text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Tracking requests require a nonnegative offset and 1 to 200 orders' using errcode='22023';
  end if;
  if length(p_search)>200 then raise exception 'Search is limited to 200 characters' using errcode='22023'; end if;
  pattern := '%' || replace(replace(replace(btrim(p_search),chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%';
  return query with page as materialized (
    select po.id,po.sent_po_date,po.production_order_number from plm.production_order po
    where not(coalesce(po.source_system='coldlion',false) and coalesce(po.production_order_number like 'coldlion/%',false))
      and (p_only_open is not true or (po.close_tracking is not true and po.voided_at is null))
      and (nullif(btrim(p_search),'') is null or po.production_order_number ilike pattern
        or po.metadata->>'customer_name' ilike pattern or po.metadata->>'order_vendor_name' ilike pattern)
    order by po.sent_po_date desc nulls last,po.production_order_number,po.id limit p_limit offset p_offset
  ) select t.* from page p cross join lateral (select * from dam.dam_order_tracking t where t.order_id=p.id offset 0) t
    order by p.sent_po_date desc nulls last,p.production_order_number,p.id;
end;
$$;

-- FUNCTION public.get_dam_order_vendor_ids(uuid[])
CREATE OR REPLACE FUNCTION public.get_dam_order_vendor_ids(p_line_ids uuid[]) RETURNS TABLE(order_line_id uuid, vendor_code text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_line_ids is null or cardinality(p_line_ids)>1500 or array_position(p_line_ids,null::uuid) is not null then
    raise exception 'Provide at most 1500 non-null OrderList line IDs' using errcode='22023';
  end if;
  return query
  with lines as materialized (
    select l.id,l.sku,l.assortment_id,r.source_id,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}(:component:[1-9][0-9]{0,9})?$'
        then split_part(r.source_id,':',3)::bigint end as so,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}(:component:[1-9][0-9]{0,9})?$'
        then split_part(r.source_id,':',5)::integer end as ln
    from plm.production_order_line l
    left join plm.production_order_line_source_ref r on r.production_order_line_id=l.id and r.source_system='coldlion' and r.is_primary
    where l.id=any(p_line_ids)
  ), intake_candidates as materialized (
    select l.*,h.company_code,h.prod_reference_no,h.master_item_no,run.started_at as seen_at,
      max(run.started_at) over(partition by l.id) as latest_run
    from lines l join coldlion.intake_order_line h on h.company_code='EDGEHOME'
      and h.sales_order_no=l.so and h.sales_order_line_no=l.ln
      and h.master_item_no=coalesce(nullif(l.assortment_id,''),l.sku)
    join coldlion.sync_run run on run.id=h.last_seen_run and run.started_at is not null
  ), intake as materialized (
    select i.id,min(i.sku) as sku,min(i.assortment_id) as assortment_id,min(i.so) as so,
      min(i.company_code) as company_code,min(i.master_item_no) as master_item_no,
      min(nullif(btrim(i.prod_reference_no),'')) as prod_reference_no
    from intake_candidates i where i.seen_at=i.latest_run
    group by i.id having count(*)=count(nullif(btrim(i.prod_reference_no),''))
      and count(distinct nullif(btrim(i.prod_reference_no),''))=1
  ), history as materialized (
    select p.company_code,p.sales_order_no,p.prod_reference_no,p.item_no,p.sub_item_no,p.component_id,p.vendor_code,p.line_id
    from plm.coldlion_prod_history p
    where p.company_code='EDGEHOME' and p.sales_order_no>0 and p.sales_order_no in(select i.so from intake i)
  ), codes as (
    select i.id,case when count(p.line_id)>0 and count(p.line_id)=count(nullif(btrim(p.vendor_code),''))
      and count(distinct nullif(btrim(p.vendor_code),''))=1 then min(nullif(btrim(p.vendor_code),'')) end as code
    from intake i left join history p on p.company_code=i.company_code and p.sales_order_no=i.so
      and nullif(btrim(p.prod_reference_no),'')=i.prod_reference_no and p.item_no=i.master_item_no
      and ((nullif(i.assortment_id,'') is null and (p.sub_item_no=i.sku or p.component_id is null))
        or (nullif(i.assortment_id,'') is not null and p.sub_item_no=i.sku))
    group by i.id
  ) select l.id,c.code from lines l left join codes c on c.id=l.id;
end;
$_$;

-- FUNCTION public.get_dam_search_embedding_status()
CREATE OR REPLACE FUNCTION public.get_dam_search_embedding_status() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
select jsonb_build_object('total_documents',count(*),'embedded_documents',count(*) filter(where embedding is not null),
 'pending_documents',count(*) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent' and nullif(metadata->>'thumbnail_url','') is not null),
 'waiting_for_thumbnail_documents',count(*) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent' and nullif(metadata->>'thumbnail_url','') is null),
 'leased_documents',count(*) filter(where embedding_lease_expires_at>now()),'errored_documents',count(*) filter(where embedding_error is not null),
 'exhausted_documents',count(*) filter(where embedding is null and (embedding_attempts>=embedding_max_attempts or embedding_error_category='permanent')),
 'asset_documents',count(*) filter(where document_type='asset'),'style_group_documents',count(*) filter(where document_type='style_group'),
 'oldest_pending_indexed_at',min(indexed_at) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent' and nullif(metadata->>'thumbnail_url','') is not null),'newest_indexed_at',max(indexed_at)) from public.dam_search_documents;
$$;

-- FUNCTION public.get_dam_style_group_asset_count(jsonb, timestamp with time zone, uuid[], text[])
CREATE OR REPLACE FUNCTION public.get_dam_style_group_asset_count(p_filters jsonb DEFAULT '{}'::jsonb, p_min_date timestamp with time zone DEFAULT '2020-01-01 00:00:00-05'::timestamp with time zone, p_search_ids uuid[] DEFAULT NULL::uuid[], p_fallback_terms text[] DEFAULT NULL::text[]) RETURNS bigint
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    SET statement_timeout TO '8s'
    AS $$
declare result bigint; f jsonb := coalesce(p_filters,'{}'::jsonb);
begin
  perform public.require_dam_access();
  select coalesce(sum(g.asset_count),0) into result from public.style_groups g
  where (g.latest_file_date>=p_min_date or (g.latest_file_date is null and g.asset_count>0))
  and (p_search_ids is null or g.id=any(p_search_ids))
  and (p_fallback_terms is null or exists(select 1 from unnest(p_fallback_terms) term
    cross join unnest(array[g.sku,g.cover_description,g.folder_path,g.licensor_name,g.property_name,g.product_category,g.customer,g.program]) value
    where value ilike '%'||term||'%'))
  and (coalesce(jsonb_array_length(f->'stage'),0)=0 or g.stage in (select jsonb_array_elements_text(f->'stage')))
  and (nullif(f->>'customer','') is null or g.customer_id=(f->>'customer')::uuid)
  and (nullif(f->>'program','') is null or g.program=f->>'program')
  and (f->>'isLicensed' is null or g.is_licensed=(f->>'isLicensed')::boolean)
  and (coalesce(jsonb_array_length(f->'workflowStatus'),0)=0 or g.workflow_status::text in (select jsonb_array_elements_text(f->'workflowStatus')))
  and (nullif(f->>'licensorId','') is null or g.licensor_id=(f->>'licensorId')::uuid)
  and (nullif(f->>'propertyId','') is null or g.property_id=(f->>'propertyId')::uuid)
  and (coalesce(jsonb_array_length(f->'assetType'),0)=0 or g.primary_asset_type::text in (select jsonb_array_elements_text(f->'assetType')))
  and (coalesce(jsonb_array_length(f->'fileStatus'),0)=0 or exists(select 1 from jsonb_array_elements_text(f->'fileStatus') status where
    case status when 'has_preview' then g.primary_thumbnail_url is not null
      when 'no_preview_renderable' then g.primary_thumbnail_url is null and g.primary_thumbnail_error is null
      when 'no_pdf_compat' then g.primary_thumbnail_url is null and g.primary_thumbnail_error='no_pdf_compat'
      when 'no_preview_unsupported' then g.primary_thumbnail_url is null and g.primary_thumbnail_error is not null and g.primary_thumbnail_error<>'no_pdf_compat'
      else false end))
  and (not exists(select 1 from jsonb_array_elements_text(coalesce(f->'productCategory','[]'::jsonb)) c where c in ('Wall','Tabletop','Clock','Storage','Workspace','Floor','Garden'))
    or g.product_category in (select jsonb_array_elements_text(f->'productCategory'))
    or (f->'productCategory' ? 'Wall' and (g.folder_path ilike '%WALL ART%' or g.folder_path ilike '%3FZ%')));
  return result;
end $$;

-- FUNCTION public.get_dam_style_tracker_license_status(uuid[])
CREATE OR REPLACE FUNCTION public.get_dam_style_tracker_license_status(p_row_ids uuid[]) RETURNS TABLE(id uuid, license_status text)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Authentication required' using errcode='42501'; end if;
  if cardinality(p_row_ids)>1000 then raise exception 'At most 1000 rows per request' using errcode='22023'; end if;
  return query select r.id,case when r.tracker_type='licensed'
    then dam.orderlist_license_status(r.row_data,r.discontinued) when r.tracker_type='generic' then 'Generic Item' else r.license_status end
    from public.style_tracker_rows r where r.id=any(p_row_ids);
end;
$$;

-- FUNCTION public.get_effective_filter_counts(jsonb)
CREATE OR REPLACE FUNCTION public.get_effective_filter_counts(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '8s'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
begin
  perform public.require_dam_access();
  return public.get_effective_filter_counts_unchecked_1703(
    jsonb_set(
      coalesce(p_filters, '{}'::jsonb) - '__includeOwnFacets2054',
      '{__includeOwnFacets2054}', 'true'::jsonb, true
    )
  );
end;
$$;

-- FUNCTION public.get_effective_filter_counts_unchecked_1703(jsonb)
CREATE OR REPLACE FUNCTION public.get_effective_filter_counts_unchecked_1703(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_include_own_facets boolean := coalesce(
    (p_filters ->> '__includeOwnFacets2054')::boolean, false
  );
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb) - '__includeOwnFacets2054';
  v_base_filters jsonb;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_stages text[];
  v_is_licensed boolean;
  v_result jsonb;
begin
  -- Legacy facet contract: total applies every filter, while each of these five
  -- facet maps excludes its own selection and applies the other four.
  v_base_filters := v_filters
    - array['fileType', 'status', 'workflowStatus', 'stage', 'isLicensed']::text[];
  if v_filters ? 'fileType' and jsonb_array_length(v_filters -> 'fileType') > 0 then
    select array_agg(x) into v_file_types from jsonb_array_elements_text(v_filters -> 'fileType') x;
  end if;
  if v_filters ? 'status' and jsonb_array_length(v_filters -> 'status') > 0 then
    select array_agg(x) into v_statuses from jsonb_array_elements_text(v_filters -> 'status') x;
  end if;
  if v_filters ? 'workflowStatus' and jsonb_array_length(v_filters -> 'workflowStatus') > 0 then
    select array_agg(x) into v_workflow_statuses from jsonb_array_elements_text(v_filters -> 'workflowStatus') x;
  end if;
  if v_filters ? 'stage' and jsonb_array_length(v_filters -> 'stage') > 0 then
    select array_agg(x) into v_stages from jsonb_array_elements_text(v_filters -> 'stage') x;
  end if;
  if v_filters ? 'isLicensed' then
    v_is_licensed := (v_filters ->> 'isLicensed')::boolean;
  end if;

  with bounds as materialized (
    select public.assets_thumbnail_min_date() thumbnail_min_date
  ), identity_asset_ids as (
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is not null
      and a.style_group_id is null
      and a.licensor_id = (v_base_filters ->> 'licensorId')::uuid
      and (nullif(v_base_filters ->> 'propertyId', '') is null or a.property_id = (v_base_filters ->> 'propertyId')::uuid)
      and (nullif(v_base_filters ->> 'customerId', '') is null or a.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(v_base_filters ->> 'licensorId', '') is not null
      and sg.licensor_id = (v_base_filters ->> 'licensorId')::uuid
      and (nullif(v_base_filters ->> 'propertyId', '') is null or sg.property_id = (v_base_filters ->> 'propertyId')::uuid)
      and (nullif(v_base_filters ->> 'customerId', '') is null or sg.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is not null
      and a.style_group_id is null
      and a.property_id = (v_base_filters ->> 'propertyId')::uuid
      and (nullif(v_base_filters ->> 'customerId', '') is null or a.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is not null
      and sg.property_id = (v_base_filters ->> 'propertyId')::uuid
      and (nullif(v_base_filters ->> 'customerId', '') is null or sg.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is not null
      and a.style_group_id is null
      and a.customer_id = (v_base_filters ->> 'customerId')::uuid
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is not null
      and sg.customer_id = (v_base_filters ->> 'customerId')::uuid
  ), matched as materialized (
    -- Arm 1: no identity filter and no tag filter. Scanning public.assets
    -- directly keeps the covering facet index available as an index-only
    -- scan; routing this case through the identity candidates forces a
    -- whole-table self-join instead. The tag predicate is gone from this arm
    -- because it is unreachable here, and leaving it as a disjunction is what
    -- cost the index-only path.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from public.assets a
    cross join bounds b
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is null
      and nullif(v_base_filters ->> 'tagFilter', '') is null
      and a.is_deleted = false
      and (a.modified_at >= b.thumbnail_min_date
        or a.file_created_at >= b.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
      and (jsonb_array_length(coalesce(v_base_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(v_base_filters -> 'contentType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(v_base_filters -> 'productMaterial')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(v_base_filters -> 'assetType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(v_base_filters -> 'artSource')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'fileStatus','[]')) = 0 or exists (
        select 1 from jsonb_array_elements_text(v_base_filters -> 'fileStatus') fs where
          (fs = 'has_preview' and a.thumbnail_url is not null) or
          (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
          (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
          (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productCategory','[]')) = 0 or
        a.product_category in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) or
        ('Wall' in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) and
          (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v_base_filters ->> 'customer','') is null or a.customer = v_base_filters ->> 'customer')
      and (nullif(v_base_filters ->> 'program','') is null or a.program = v_base_filters ->> 'program')
    union all
    -- Arm 1T: no identity filter, tag filter present. Driving from
    -- public.asset_effective_tags makes the tag an index condition instead of
    -- one side of an OR, so the arm reads only the rows carrying that tag and
    -- then looks each asset up by primary key. DISTINCT is required, not
    -- decorative: the projection is keyed (asset_id, tag, scope), so one asset
    -- may legitimately carry the same tag at both 'asset' and 'style_group'
    -- scope and would otherwise be counted twice. The EXISTS this replaces
    -- deduplicated implicitly.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from (
      select distinct e.asset_id
      from public.asset_effective_tags e
      where nullif(v_base_filters ->> 'tagFilter','') is not null
        and e.tag = v_base_filters ->> 'tagFilter'
    ) t
    join public.assets a on a.id = t.asset_id
    cross join bounds b
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is null
      and nullif(v_base_filters ->> 'tagFilter', '') is not null
      and a.is_deleted = false
      and a.thumbnail_url is not null
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
      and (jsonb_array_length(coalesce(v_base_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(v_base_filters -> 'contentType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(v_base_filters -> 'productMaterial')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(v_base_filters -> 'assetType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(v_base_filters -> 'artSource')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'fileStatus','[]')) = 0 or exists (
        select 1 from jsonb_array_elements_text(v_base_filters -> 'fileStatus') fs where
          (fs = 'has_preview' and a.thumbnail_url is not null) or
          (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
          (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
          (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productCategory','[]')) = 0 or
        a.product_category in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) or
        ('Wall' in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) and
          (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v_base_filters ->> 'customer','') is null or a.customer = v_base_filters ->> 'customer')
      and (nullif(v_base_filters ->> 'program','') is null or a.program = v_base_filters ->> 'program')
    union all
    -- Arm 1T pending: no identity filter, tag filter present. Driving from
    -- public.asset_effective_tags makes the tag an index condition instead of
    -- one side of an OR, so the arm reads only the rows carrying that tag and
    -- then looks each asset up by primary key. DISTINCT is required, not
    -- decorative: the projection is keyed (asset_id, tag, scope), so one asset
    -- may legitimately carry the same tag at both 'asset' and 'style_group'
    -- scope and would otherwise be counted twice. The EXISTS this replaces
    -- deduplicated implicitly.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from (
      select distinct e.asset_id
      from public.asset_effective_tags e
      where nullif(v_base_filters ->> 'tagFilter','') is not null
        and e.tag = v_base_filters ->> 'tagFilter'
    ) t
    join public.assets a on a.id = t.asset_id
    cross join bounds b
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is null
      and nullif(v_base_filters ->> 'tagFilter', '') is not null
      and a.is_deleted = false
      and a.thumbnail_url is null
      and (a.modified_at >= b.thumbnail_min_date or a.file_created_at >= b.thumbnail_min_date)
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
      and (jsonb_array_length(coalesce(v_base_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(v_base_filters -> 'contentType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(v_base_filters -> 'productMaterial')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(v_base_filters -> 'assetType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(v_base_filters -> 'artSource')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'fileStatus','[]')) = 0 or exists (
        select 1 from jsonb_array_elements_text(v_base_filters -> 'fileStatus') fs where
          (fs = 'has_preview' and a.thumbnail_url is not null) or
          (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
          (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
          (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productCategory','[]')) = 0 or
        a.product_category in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) or
        ('Wall' in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) and
          (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v_base_filters ->> 'customer','') is null or a.customer = v_base_filters ->> 'customer')
      and (nullif(v_base_filters ->> 'program','') is null or a.program = v_base_filters ->> 'program')
    union all
    -- Arm 2: an identity filter is present. The UNION candidate ids are the
    -- index-leading path, so join them back for the remaining predicates.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from identity_asset_ids i
    join public.assets a on a.id = i.id
    cross join bounds b
    where (nullif(v_base_filters ->> 'licensorId', '') is not null
        or nullif(v_base_filters ->> 'propertyId', '') is not null
        or nullif(v_base_filters ->> 'customerId', '') is not null)
      and a.is_deleted = false
      and (a.modified_at >= b.thumbnail_min_date
        or a.file_created_at >= b.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
      and (nullif(v_base_filters ->> 'tagFilter','') is null or exists (
        select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = v_base_filters ->> 'tagFilter'))
      and (jsonb_array_length(coalesce(v_base_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(v_base_filters -> 'contentType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(v_base_filters -> 'productMaterial')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(v_base_filters -> 'assetType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(v_base_filters -> 'artSource')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'fileStatus','[]')) = 0 or exists (
        select 1 from jsonb_array_elements_text(v_base_filters -> 'fileStatus') fs where
          (fs = 'has_preview' and a.thumbnail_url is not null) or
          (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
          (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
          (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productCategory','[]')) = 0 or
        a.product_category in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) or
        ('Wall' in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) and
          (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v_base_filters ->> 'customer','') is null or a.customer = v_base_filters ->> 'customer')
      and (nullif(v_base_filters ->> 'program','') is null or a.program = v_base_filters ->> 'program')
  )
  select jsonb_build_object(
    'total', (select count(*) from matched where
      (v_file_types is null or file_type::text = any(v_file_types)) and
      (v_statuses is null or status::text = any(v_statuses)) and
      (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
      (v_stages is null or stage = any(v_stages)) and
      (v_is_licensed is null or is_licensed = v_is_licensed)),
    'fileType', coalesce((select jsonb_object_agg(file_type::text, cnt) from (
      select file_type, count(*) cnt from matched where
        (v_include_own_facets is false or v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by file_type) s), '{}'::jsonb),
    'status', coalesce((select jsonb_object_agg(status::text, cnt) from (
      select status, count(*) cnt from matched where
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_include_own_facets is false or v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by status) s), '{}'::jsonb),
    'workflowStatus', coalesce((select jsonb_object_agg(workflow_status::text, cnt) from (
      select workflow_status, count(*) cnt from matched where workflow_status is not null and
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_include_own_facets is false or v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by workflow_status) s), '{}'::jsonb),
    'stage', coalesce((select jsonb_object_agg(stage, cnt) from (
      select stage, count(*) cnt from matched where stage is not null and
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_include_own_facets is false or v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by stage) s), '{}'::jsonb),
    'isLicensed', (select jsonb_build_object(
      'true', coalesce(sum(case when is_licensed is true then 1 else 0 end), 0),
      'false', coalesce(sum(case when is_licensed is not true then 1 else 0 end), 0))
      from matched where (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_include_own_facets is false or v_is_licensed is null or is_licensed = v_is_licensed))
  ) into v_result;
  return v_result;
end;
$$;

-- FUNCTION public.get_filter_counts(jsonb)
CREATE OR REPLACE FUNCTION public.get_filter_counts(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '8s'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_result jsonb;
begin
  perform public.require_dam_access();
  v_result := public.get_effective_filter_counts_unchecked_1703(
    v_filters - '__includeOwnFacets2054'
  );
  if v_filters = '{}'::jsonb then
    return v_result - 'total';
  end if;
  return v_result;
end;
$$;

-- FUNCTION public.get_pdf_rich_extraction_hashes(uuid[])
CREATE OR REPLACE FUNCTION public.get_pdf_rich_extraction_hashes(p_asset_ids uuid[]) RETURNS TABLE(asset_id uuid, source_text_sha256 text, parse_error text, extracted_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select e.asset_id, e.source_text_sha256, e.parse_error, e.extracted_at
  from dam.pdf_rich_extraction e
  where e.asset_id = any (p_asset_ids);
$$;

-- FUNCTION public.get_render_z_nas_password()
CREATE OR REPLACE FUNCTION public.get_render_z_nas_password() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    (select ds.decrypted_secret
       from vault.decrypted_secrets ds
      where ds.name = 'popdam_render_z_nas_password'
      limit 1),
    '');
$$;

-- FUNCTION public.get_search_embedding_health()
CREATE OR REPLACE FUNCTION public.get_search_embedding_health() RETURNS TABLE(corpus text, pending bigint, errored bigint, last_write timestamp with time zone, minutes_since_last_write numeric, stale boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role'
     and not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'admin required' using errcode='42501';
  end if;
  return query
  with sg_jobs as (
    select j.*
      from public.style_guide_search_embedding_jobs j
      join public.style_guide_search_documents d
        on d.style_guide_file_id = j.style_guide_file_id
       and d.content_sha256 = j.content_sha256
       and d.embedding is null
  ), counts as (
    select 'dam'::text name,
      (select count(*) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) pending_count,
      (select count(*) from public.dam_search_documents d where d.embedding_error is not null) error_count,
      (select max(d.embedding_updated_at) from public.dam_search_documents d where d.embedding_updated_at is not null) written,
      (select min(d.indexed_at) from public.dam_search_documents d
       where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
         and d.embedding_error_category is distinct from 'permanent'
         and nullif(d.metadata->>'thumbnail_url','') is not null) oldest
    union all
    select 'popsg',
      (select count(*) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null)),
      (select count(*) from sg_jobs j where j.error is not null),
      (select max(d.embedding_updated_at) from public.style_guide_search_documents d where d.is_active and d.embedding_updated_at is not null),
      (select min(d.document_updated_at) from public.style_guide_search_documents d
       where d.is_active and d.content_sha256 is not null and d.embedding is null
         and not exists (select 1 from sg_jobs j where j.style_guide_file_id = d.style_guide_file_id
                            and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
         and exists(select 1 from public.style_guide_files f where f.id=d.style_guide_file_id and f.thumbnail_url is not null))
  )
  select name,pending_count,error_count,written,extract(epoch from(now()-written))/60,
    pending_count>0 and (coalesce(written,oldest) is null or coalesce(written,oldest)<=now()-interval '120 minutes')
  from counts;
end;
$$;

-- FUNCTION public.get_sg_nas_password()
CREATE OR REPLACE FUNCTION public.get_sg_nas_password() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    (select ds.decrypted_secret
       from vault.decrypted_secrets ds
      where ds.name = 'popdam_sg_nas_password'
      limit 1),
    '');
$$;

-- FUNCTION public.get_sg_preview_stats()
CREATE OR REPLACE FUNCTION public.get_sg_preview_stats() RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with category_counts as materialized (
    select preview_category, count(*)::bigint as row_count
    from (
      select case
        when f.thumbnail_url is not null then 'has_preview'
        when lower(f.file_extension) not in
          ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'unsupported'
        when f.thumbnail_error is null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_no_preview'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'renderable_terminal'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_recoverable'
        when f.thumbnail_error is not null
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'other_terminal'
        when f.thumbnail_error is not null then 'other_recoverable'
        else 'other_unexplained'
      end as preview_category
      from public.style_guide_files f
      where f.is_active
    ) classified
    group by preview_category
  ),
  file_stats as (
    select
      coalesce(sum(row_count), 0)::bigint as total_active,
      coalesce(sum(row_count) filter
        (where preview_category = 'has_preview'), 0)::bigint as has_preview,
      coalesce(sum(row_count) filter
        (where preview_category = 'renderable_no_preview'), 0)::bigint
        as renderable_no_preview,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_terminal', 'renderable_recoverable')), 0)::bigint
        as render_errored,
      coalesce(sum(row_count) filter
        (where preview_category = 'unsupported'), 0)::bigint as unsupported,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_recoverable', 'other_recoverable')), 0)::bigint
        as recoverable_error,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_terminal', 'other_terminal', 'unsupported')), 0)::bigint
        as reviewed_terminal_exception,
      coalesce(sum(row_count) filter
        (where preview_category in ('renderable_no_preview', 'other_unexplained')), 0)::bigint
        as unexplained
    from category_counts
  ),
  live_queue_files as materialized (
    select distinct q.style_guide_file_id
    from public.style_guide_render_queue q
    where q.status in ('pending', 'claimed', 'processing')
  ),
  queued_file_stats as (
    select
      count(*)::bigint as waiting_queued,
      count(*) filter (where queued.preview_category in
        ('renderable_recoverable', 'other_recoverable'))::bigint as queued_recoverable,
      count(*) filter (where queued.preview_category in
        ('renderable_terminal', 'other_terminal', 'unsupported'))::bigint as queued_terminal,
      count(*) filter (where queued.preview_category in
        ('renderable_no_preview', 'other_unexplained'))::bigint as queued_unexplained
    from (
      select case
        when lower(f.file_extension) not in
          ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'unsupported'
        when f.thumbnail_error is null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_no_preview'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'renderable_terminal'
        when f.thumbnail_error is not null
          and lower(f.file_extension) in
            ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
          then 'renderable_recoverable'
        when f.thumbnail_error is not null
          and (
            lower(f.thumbnail_error) in
              ('no_pdf_compat', 'no_preview_or_render_failed', 'blank_render')
            or lower(f.thumbnail_error) like '%enoent%'
            or lower(f.thumbnail_error) like '%not found%'
            or lower(f.thumbnail_error) like '%missing%'
            or lower(f.thumbnail_error) like '%unsupported%'
            or lower(f.thumbnail_error) like '%corrupt%'
          ) then 'other_terminal'
        when f.thumbnail_error is not null then 'other_recoverable'
        else 'other_unexplained'
      end as preview_category
      from live_queue_files lq
      join public.style_guide_files f on f.id = lq.style_guide_file_id
      where f.is_active and f.thumbnail_url is null
    ) queued
  ),
  legacy_queue_stats as (
    select count(*)::bigint as queued_now
    from public.style_guide_render_queue
    where status in ('pending', 'claimed')
  )
  select json_build_object(
    'total_active', fs.total_active,
    'has_preview', fs.has_preview,
    'renderable_no_preview', fs.renderable_no_preview,
    'render_errored', fs.render_errored,
    'unsupported', fs.unsupported,
    'queued_now', lqs.queued_now,
    'waiting_queued', qfs.waiting_queued,
    'recoverable_error', fs.recoverable_error - qfs.queued_recoverable,
    'reviewed_terminal_exception',
      fs.reviewed_terminal_exception - qfs.queued_terminal,
    'unexplained', fs.unexplained - qfs.queued_unexplained
  )
  from file_stats fs
  cross join queued_file_stats qfs
  cross join legacy_queue_stats lqs;
$$;

-- FUNCTION public.get_sg_search_embedding_status()
CREATE OR REPLACE FUNCTION public.get_sg_search_embedding_status() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
with jobs as (
  select j.*
    from public.style_guide_search_embedding_jobs j
    join public.style_guide_search_documents d
      on d.style_guide_file_id = j.style_guide_file_id
     and d.content_sha256 = j.content_sha256
     and d.embedding is null
)
select jsonb_build_object(
  'total_documents', (select count(*) from public.style_guide_search_documents),
  'embedded_documents', (select count(*) from public.style_guide_search_documents where embedding is not null),
  'pending_documents', (
    select count(*) from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and not exists (select 1 from jobs j where j.style_guide_file_id = d.style_guide_file_id
                          and (j.attempt_count >= j.max_attempts or j.error_category = 'permanent'))
       and exists (select 1 from public.style_guide_files f
                    where f.id = d.style_guide_file_id and f.thumbnail_url is not null)),
  'waiting_for_thumbnail_documents', (
    select count(*) from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and not exists (select 1 from public.style_guide_files f
                        where f.id = d.style_guide_file_id and f.thumbnail_url is not null)),
  'unidentified_documents', (select count(*) from public.style_guide_search_documents where content_sha256 is null),
  'leased_documents', (select count(*) from jobs where lease_expires_at > now()),
  'errored_documents', (select count(*) from jobs where error is not null),
  'exhausted_documents', (select count(*) from jobs where attempt_count >= max_attempts or error_category = 'permanent'),
  'oldest_pending_updated_at', (
    select d.document_updated_at from public.style_guide_search_documents d
     where d.is_active and d.content_sha256 is not null and d.embedding is null
       and exists (select 1 from public.style_guide_files f
                    where f.id = d.style_guide_file_id and f.thumbnail_url is not null)
     order by d.document_updated_at
     limit 1),
  'newest_updated_at', (select max(document_updated_at) from public.style_guide_search_documents)
)
$$;

-- FUNCTION public.hts_rag_fold_text(text)
CREATE OR REPLACE FUNCTION public.hts_rag_fold_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select lower(regexp_replace(
    regexp_replace(normalize(value, NFD), '[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7-\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u0897-\u089f\u08ca-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0981-\u0983\u09bc\u09be-\u09c4\u09c7-\u09c8\u09cb-\u09cd\u09d7\u09e2-\u09e3\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47-\u0a48\u0a4b-\u0a4d\u0a51\u0a70-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47-\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b62-\u0b63\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0c00-\u0c04\u0c3c\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55-\u0c56\u0c62-\u0c63\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5-\u0cd6\u0ce2-\u0ce3\u0cf3\u0d00-\u0d03\u0d3b-\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62-\u0d63\u0d81-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2-\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ece\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f3f\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f\u109a-\u109d\u135d-\u135f\u1712-\u1715\u1732-\u1734\u1752-\u1753\u1772-\u1773\u17b4-\u17d3\u17dd\u180b-\u180d\u180f\u1885-\u1886\u18a9\u1920-\u192b\u1930-\u193b\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f\u1ab0-\u1add\u1ae0-\u1aeb\u1b00-\u1b04\u1b34-\u1b44\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1be6-\u1bf3\u1c24-\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1dff\u20d0-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099-\u309a\ua66f-\ua672\ua674-\ua67d\ua69e-\ua69f\ua6f0-\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua82c\ua880-\ua881\ua8b4-\ua8c5\ua8e0-\ua8f1\ua8ff\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9e5\uaa29-\uaa36\uaa43\uaa4c-\uaa4d\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7-\uaab8\uaabe-\uaabf\uaac1\uaaeb-\uaaef\uaaf5-\uaaf6\uabe3-\uabea\uabec-\uabed\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\U000101fd\U000102e0\U00010376-\U0001037a\U00010a01-\U00010a03\U00010a05-\U00010a06\U00010a0c-\U00010a0f\U00010a38-\U00010a3a\U00010a3f\U00010ae5-\U00010ae6\U00010d24-\U00010d27\U00010d69-\U00010d6d\U00010eab-\U00010eac\U00010efa-\U00010eff\U00010f46-\U00010f50\U00010f82-\U00010f85\U00011000-\U00011002\U00011038-\U00011046\U00011070\U00011073-\U00011074\U0001107f-\U00011082\U000110b0-\U000110ba\U000110c2\U00011100-\U00011102\U00011127-\U00011134\U00011145-\U00011146\U00011173\U00011180-\U00011182\U000111b3-\U000111c0\U000111c9-\U000111cc\U000111ce-\U000111cf\U0001122c-\U00011237\U0001123e\U00011241\U000112df-\U000112ea\U00011300-\U00011303\U0001133b-\U0001133c\U0001133e-\U00011344\U00011347-\U00011348\U0001134b-\U0001134d\U00011357\U00011362-\U00011363\U00011366-\U0001136c\U00011370-\U00011374\U000113b8-\U000113c0\U000113c2\U000113c5\U000113c7-\U000113ca\U000113cc-\U000113d0\U000113d2\U000113e1-\U000113e2\U00011435-\U00011446\U0001145e\U000114b0-\U000114c3\U000115af-\U000115b5\U000115b8-\U000115c0\U000115dc-\U000115dd\U00011630-\U00011640\U000116ab-\U000116b7\U0001171d-\U0001172b\U0001182c-\U0001183a\U00011930-\U00011935\U00011937-\U00011938\U0001193b-\U0001193e\U00011940\U00011942-\U00011943\U000119d1-\U000119d7\U000119da-\U000119e0\U000119e4\U00011a01-\U00011a0a\U00011a33-\U00011a39\U00011a3b-\U00011a3e\U00011a47\U00011a51-\U00011a5b\U00011a8a-\U00011a99\U00011b60-\U00011b67\U00011c2f-\U00011c36\U00011c38-\U00011c3f\U00011c92-\U00011ca7\U00011ca9-\U00011cb6\U00011d31-\U00011d36\U00011d3a\U00011d3c-\U00011d3d\U00011d3f-\U00011d45\U00011d47\U00011d8a-\U00011d8e\U00011d90-\U00011d91\U00011d93-\U00011d97\U00011ef3-\U00011ef6\U00011f00-\U00011f01\U00011f03\U00011f34-\U00011f3a\U00011f3e-\U00011f42\U00011f5a\U00013440\U00013447-\U00013455\U0001611e-\U0001612f\U00016af0-\U00016af4\U00016b30-\U00016b36\U00016f4f\U00016f51-\U00016f87\U00016f8f-\U00016f92\U00016fe4\U00016ff0-\U00016ff1\U0001bc9d-\U0001bc9e\U0001cf00-\U0001cf2d\U0001cf30-\U0001cf46\U0001d165-\U0001d169\U0001d16d-\U0001d172\U0001d17b-\U0001d182\U0001d185-\U0001d18b\U0001d1aa-\U0001d1ad\U0001d242-\U0001d244\U0001da00-\U0001da36\U0001da3b-\U0001da6c\U0001da75\U0001da84\U0001da9b-\U0001da9f\U0001daa1-\U0001daaf\U0001e000-\U0001e006\U0001e008-\U0001e018\U0001e01b-\U0001e021\U0001e023-\U0001e024\U0001e026-\U0001e02a\U0001e08f\U0001e130-\U0001e136\U0001e2ae\U0001e2ec-\U0001e2ef\U0001e4ec-\U0001e4ef\U0001e5ee-\U0001e5ef\U0001e6e3\U0001e6e6\U0001e6ee-\U0001e6ef\U0001e6f5\U0001e8d0-\U0001e8d6\U0001e944-\U0001e94a\U000e0100-\U000e01ef]', '', 'g'),
    '[^\x01-\x7f]', ' ', 'g'))
$$;

-- FUNCTION public.hts_rag_tariff_subheadings(jsonb)
CREATE OR REPLACE FUNCTION public.hts_rag_tariff_subheadings(tariffs jsonb) RETURNS text[]
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select coalesce(array_agg(distinct left(digits, 6) order by left(digits, 6)), '{}'::text[])
  from (
    select regexp_replace(element, '[^0-9]', '', 'g') as digits
    from jsonb_array_elements_text(
      case when jsonb_typeof(tariffs) = 'array' then tariffs else '[]'::jsonb end
    ) as element
  ) as tariff
  where length(digits) >= 6
$$;

-- FUNCTION public.image_embed_enqueue_index(uuid)
CREATE OR REPLACE FUNCTION public.image_embed_enqueue_index(p_asset_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam', 'public'
    AS $$
begin
  if not exists (select 1 from public.assets a where a.id = p_asset_id) then
    return false;
  end if;
  if exists (select 1 from dam.image_embed_jobs j
              where j.kind = 'index' and j.asset_id = p_asset_id
                and j.status in ('pending', 'leased')) then
    return true;
  end if;
  perform dam.enqueue_image_embed_index_job(p_asset_id);
  return true;
end;
$$;

-- FUNCTION public.image_embed_enqueue_query(bytea)
CREATE OR REPLACE FUNCTION public.image_embed_enqueue_query(p_payload bytea) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
declare
  v_id uuid;
begin
  if p_payload is null or octet_length(p_payload) = 0 then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_PAYLOAD_REQUIRED';
  end if;
  if octet_length(p_payload) > 16 * 1024 * 1024 then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_PAYLOAD_TOO_LARGE';
  end if;

  insert into dam.image_embed_jobs (kind, payload)
  values ('query', p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

-- FUNCTION public.image_embed_query_status(uuid)
CREATE OR REPLACE FUNCTION public.image_embed_query_status(p_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
  select jsonb_build_object(
    'status', j.status,
    'reason', j.error,
    'dino', case when j.status = 'done' then j.result_dino::text end,
    'siglip', case when j.status = 'done' then j.result_siglip::text end,
    'embedding_model', null
  )
  from dam.image_embed_jobs j
  where j.id = p_id and j.kind = 'query';
$$;

-- FUNCTION public.image_embed_stale_assets(uuid, integer)
CREATE OR REPLACE FUNCTION public.image_embed_stale_assets(p_after_asset_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5000) RETURNS SETOF uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'dam'
    SET statement_timeout TO '120s'
    AS $_$
declare
  v_stamps text[];
  v_limit  int := greatest(1, least(coalesce(p_limit, 5000), 5000));
begin
  select array_agg(distinct s) into v_stamps
  from (
    select (select c.value #>> '{}'
              from public.admin_config c
             where c.key = 'IMAGE_SIM_EMBEDDING_MODEL') as s
    union
    select case when coalesce((select c.value #>> '{}'
                                  from public.admin_config c
                                 where c.key = 'IMAGE_SIM_REEMBED_IN_PROGRESS'), 'false') ilike 'true'
                then (select c.value #>> '{}'
                        from public.admin_config c
                       where c.key = 'IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS')
           end
  ) t
  where nullif(btrim(s), '') is not null;

  if v_stamps is null or cardinality(v_stamps) = 0 then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_STAMP_UNCONFIGURED';
  end if;

  return query
  select a.id
  from public.assets a
  left join dam.dam_asset_image_vectors v on v.asset_id = a.id
  where a.is_deleted = false
    and a.thumbnail_url is not null
    and a.thumbnail_url ~* '\.(jpe?g|png|webp)([?#].*)?$'
    and a.id > coalesce(p_after_asset_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (v.asset_id is null
         or v.last_embedded_thumbnail_url is distinct from a.thumbnail_url
         or v.embedding_model <> all (v_stamps))
  order by a.id
  limit v_limit;
end;
$_$;

-- FUNCTION public.image_embed_status()
CREATE OR REPLACE FUNCTION public.image_embed_status() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'dam'
    AS $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'leased', count(*) filter (where status = 'leased'),
    'failed', count(*) filter (where status = 'failed'),
    'done', count(*) filter (where status = 'done'),
    'workers_fresh', dam.image_embed_workers_fresh(90),
    'stale_after_seconds', 90
  )
  from dam.image_embed_jobs;
$$;

-- FUNCTION public.import_dam_buy_sheet(uuid, text, text, jsonb, jsonb, jsonb, boolean, jsonb)
CREATE OR REPLACE FUNCTION public.import_dam_buy_sheet(p_customer_id uuid, p_file_name text, p_file_sha256 text, p_raw_sheet jsonb, p_lines jsonb, p_order_numbers jsonb DEFAULT '{}'::jsonb, p_apply boolean DEFAULT false, p_master_skus jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'plm', 'public', 'core', 'dam', 'pg_temp'
    AS $_$
declare
  v_actor      uuid := auth.uid();
  v_customer   text;
  v_line       jsonb;
  v_sku        text;
  v_date       date;
  v_qty        numeric;
  v_case_pack  numeric;
  v_group      text;
  v_ref        text;
  v_line_id    uuid;
  v_order_id   uuid;
  v_n          integer;
  v_item       uuid;
  v_skus       text[];
  v_cands      jsonb;
  v_items      jsonb;
  v_type       text;
  v_status     text;
  v_old        record;
  v_prev       numeric;
  v_number     text;
  v_meta       jsonb;
  v_results    jsonb := '[]'::jsonb;
  v_outcome    text;
  v_reason     text;
  v_import_id  uuid;
  v_claimed    boolean;
  v_prior      uuid[];
  v_line_order uuid;
  v_master     text;
  v_prev_asst  text;
  v_order_new  boolean;
  v_order_src  text;
begin
  if v_actor is null then
    raise exception 'import_dam_buy_sheet: authentication required' using errcode = '42501';
  end if;
  select name into v_customer from core.customer where id = p_customer_id;
  if v_customer is null then
    raise exception 'import_dam_buy_sheet: unknown customer' using errcode = '23503';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 2000 then
    raise exception 'import_dam_buy_sheet: p_lines must be a non-empty array of at most 2000 lines' using errcode = '22023';
  end if;
  if coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'import_dam_buy_sheet: file_sha256 must be a lowercase sha-256' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_order_numbers, '{}'::jsonb)) <> 'object' then
    raise exception 'import_dam_buy_sheet: p_order_numbers must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_master_skus, '{}'::jsonb)) <> 'object' then
    raise exception 'import_dam_buy_sheet: p_master_skus must be an object' using errcode = '22023';
  end if;

  -- One import at a time across customers, so two uploads can never both
  -- create the same new order number; a concurrent upload waits.
  perform pg_advisory_xact_lock(hashtext('import_dam_buy_sheet'));

  -- Set-based lookups, once per call (a per-line scan of the order and
  -- style-tracker tables ran ~0.1 s per line and broke the 8 s API limit).
  select array_agg(distinct upper(btrim(x ->> 'sku'))) into v_skus
    from jsonb_array_elements(p_lines) x;
  select coalesce(jsonb_object_agg(k, ids), '{}'::jsonb) into v_cands from (
    select upper(btrim(l.sku)) || '|' || l.start_ship_date::text as k, jsonb_agg(l.id) as ids
      from plm.production_order o
      join plm.production_order_line l on l.production_order_id = o.id
     where l.voided_at is null and o.voided_at is null
       and l.status is distinct from 'cancelled'
       and l.start_ship_date is not null
       and upper(btrim(l.sku)) = any (v_skus)
       and (o.company_id = p_customer_id
            or (o.company_id is null and lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer)))
     group by 1) c;
  select coalesce(jsonb_object_agg(sku, pairs), '{}'::jsonb) into v_items from (
    select upper(btrim(t.sku)) as sku,
           jsonb_agg(distinct jsonb_build_object('type', b.tracker_type, 'item', b.plm_item_id)) as pairs
      from public.style_tracker_rows t
      join plm.style_tracker_item_bridge b on b.style_tracker_row_id = t.id and b.tracker_type = t.tracker_type
     where b.plm_item_id is not null and upper(btrim(t.sku)) = any (v_skus)
     group by 1) i;

  -- Orders an earlier buy-sheet import already wrote to (taken before this
  -- call writes anything, so its own lines never count).
  select coalesce(array_agg(distinct l.production_order_id), '{}') into v_prior
    from plm.production_order_line_source_ref r
    join plm.production_order_line l on l.id = r.production_order_line_id
   where r.source_system = 'popdam_buy_sheet';

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sku := upper(btrim(coalesce(v_line ->> 'sku', '')));
    v_date := (v_line ->> 'delivery_date')::date;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_case_pack := nullif(v_line ->> 'case_pack', '')::numeric;
    v_group := coalesce(v_line ->> 'group', '');
    if v_sku = '' or v_date is null or v_qty is null or v_qty < 0 then
      raise exception 'import_dam_buy_sheet: every line needs sku, delivery_date and a non-negative quantity' using errcode = '22023';
    end if;
    v_ref := 'buysheet:' || p_customer_id::text || ':' || lower(v_sku) || ':' || to_char(v_date, 'YYYY-MM-DD');
    v_line_id := null; v_outcome := null; v_reason := null; v_number := null; v_prev := null;
    v_claimed := false; v_line_order := null; v_prev_asst := null; v_order_new := false;
    v_master := nullif(upper(btrim(coalesce(p_master_skus ->> v_group, ''))), '');
    v_order_src := 'buysheet:order:' || p_file_sha256 || ':' || v_group;

    -- 1. A line this import created or claimed before.
    select r.production_order_line_id into v_line_id
      from plm.production_order_line_source_ref r
     where r.source_system = 'popdam_buy_sheet' and r.source_id = v_ref;
    v_claimed := v_line_id is not null;

    -- 2. Exactly one active line of this customer, style and start ship date.
    if v_line_id is null then
      v_n := coalesce(jsonb_array_length(v_cands -> (v_sku || '|' || v_date::text)), 0);
      v_line_id := (v_cands -> (v_sku || '|' || v_date::text) ->> 0)::uuid;
      if v_n > 1 then
        v_line_id := null; v_outcome := 'held'; v_reason := 'several OrderList lines share this customer, style and ship date';
      end if;
    end if;

    if v_outcome is null and v_line_id is not null then
      select l.id, l.production_order_id, l.quantity_ordered, l.case_pack, coalesce(l.voided_at, o.voided_at) as voided_at, l.item_id, o.production_order_number, l.assortment_id
        into v_old
        from plm.production_order_line l join plm.production_order o on o.id = l.production_order_id
       where l.id = v_line_id;
      v_number := v_old.production_order_number;
      v_line_order := v_old.production_order_id;
      v_prev := v_old.quantity_ordered;
      v_prev_asst := v_old.assortment_id;
      if v_old.voided_at is not null then
        v_outcome := 'held'; v_reason := 'the line this sheet created earlier, or its order, was voided';
      elsif exists (select 1 from plm.production_order_line_source_ref r
                     where r.production_order_line_id = v_line_id and r.source_system = 'coldlion'
                       and r.source_id ~ '^coldlion:so:') then
        v_outcome := 'held'; v_reason := 'the official PO is already on this line (ColdLion)';
      elsif v_old.quantity_ordered is not distinct from v_qty
            and (v_case_pack is null or v_old.case_pack is not distinct from v_case_pack)
            and (v_master is null or v_old.assortment_id is not distinct from v_master)
            and exists (select 1 from plm.production_order_line_source_ref r
                         where r.production_order_line_id = v_line_id
                           and r.source_system = 'popdam_buy_sheet' and r.source_id = v_ref) then
        v_outcome := 'unchanged';
      else
        v_outcome := 'updated';
      end if;
    elsif v_outcome is null and v_qty = 0 then
      v_outcome := 'skipped'; v_reason := 'no quantity for this delivery';
    elsif v_outcome is null then
      v_number := nullif(btrim(coalesce(p_order_numbers ->> v_group, '')), '');
      if v_number is null then
        -- Owner rule 2026-11-16: buy-sheet lines go in under the master SKU
        -- (assortment #) without a production PO; the D-number comes later.
        if v_master is null then
          v_outcome := 'held'; v_reason := 'type the master SKU (assortment #) from JamieLynn for this pack';
        else
          v_outcome := 'new';
        end if;
      elsif (select count(*) from plm.production_order o
              where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null) > 1 then
        v_outcome := 'held'; v_reason := 'several OrderList orders are numbered ' || v_number;
      elsif exists (select 1 from plm.production_order o
                     where upper(btrim(o.production_order_number)) = upper(v_number)
                       and (o.voided_at is not null
                            or not (coalesce(o.company_id = p_customer_id, false)
                                    or (o.company_id is null
                                        and coalesce(lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer), false))))) then
        v_outcome := 'held'; v_reason := 'order number ' || v_number || ' belongs to another customer or is voided';
      else
        v_outcome := 'new';
      end if;
    end if;

    -- Revision of an already-imported sheet (owner rule 2026-11-10).
    if v_outcome in ('updated', 'new') then
      if v_outcome = 'new' and v_number is not null then
        select o.id into v_line_order from plm.production_order o
         where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null;
      elsif v_outcome = 'new' then
        select o.id into v_line_order from plm.production_order o
         where o.source_system = 'popdam_buy_sheet' and o.source_id = v_order_src;
      end if;
      if v_claimed or v_line_order = any(v_prior) then
        v_outcome := 'revision';
        v_reason := 'this sheet changes order ' || coalesce(nullif(btrim(v_number), ''), '(no PO yet)')
                    || ', which an earlier buy-sheet upload already filled; revised buy sheets are not supported yet';
      end if;
    end if;

    -- Item link: exact SKU, unique item, never fuzzy. update_dam_order also
    -- qualifies by catalog; a buy sheet names none, so the catalog applies only
    -- when the line carries source_style_type, and a style whose two catalogs
    -- resolve to different items is reported ambiguous (not linked).
    v_type := nullif(btrim(lower(coalesce(v_line ->> 'source_style_type', ''))), '');
    select count(distinct p ->> 'item'), (array_agg(distinct (p ->> 'item')::uuid))[1] into v_n, v_item
      from jsonb_array_elements(coalesce(v_items -> v_sku, '[]'::jsonb)) p
     where v_type is null or p ->> 'type' = v_type;
    v_status := case when v_n = 1 then 'matched' when v_n > 1 then 'ambiguous' else 'unmatched' end;
    if v_n <> 1 then v_item := null; end if;

    v_meta := jsonb_build_object('buy_sheet', jsonb_build_object(
      'customer_id', p_customer_id, 'file_name', p_file_name, 'file_sha256', p_file_sha256,
      'delivery_date', v_date, 'quantity', v_qty, 'case_pack', v_case_pack,
      'source', v_line - 'sku' - 'delivery_date' - 'quantity' - 'case_pack',
      'imported_by', v_actor, 'imported_at', now()));

    if p_apply and v_outcome = 'updated' then
      update plm.production_order_line
         set quantity_ordered = v_qty,
             case_pack = coalesce(v_case_pack, case_pack),
             metadata = coalesce(metadata, '{}'::jsonb) || v_meta,
             item_id = coalesce(item_id, v_item),
             assortment_id = coalesce(v_master, assortment_id),
             master_data_match_status = case when item_id is null then v_status else master_data_match_status end,
             updated_at = now()
       where id = v_line_id;
      insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_id, 'popdam_buy_sheet', v_ref, false)
      on conflict (source_system, source_id) do nothing;
    elsif p_apply and v_outcome = 'new' and v_number is null then
      -- One blank-numbered order per customer + file + pack group, reused on re-run.
      v_order_id := null;
      select o.id into v_order_id from plm.production_order o
       where o.source_system = 'popdam_buy_sheet' and o.source_id = v_order_src;
      if v_order_id is null then
        v_order_id := gen_random_uuid();
        v_order_new := true;
        insert into plm.production_order (id, production_order_number, company_id, metadata, source_system, source_id)
        values (v_order_id, '', p_customer_id,
                jsonb_build_object('customer_name', v_customer, 'created_by', v_actor,
                                   'created_via', 'popdam_buy_sheet'),
                'popdam_buy_sheet', v_order_src);
        insert into plm.production_order_source_ref (production_order_id, source_system, source_id, is_primary)
        values (v_order_id, 'popdam_buy_sheet', v_order_src, true);
      end if;
    elsif p_apply and v_outcome = 'new' then
      select o.id into v_order_id from plm.production_order o
       where upper(btrim(o.production_order_number)) = upper(v_number) and o.voided_at is null
         and (o.company_id = p_customer_id
              or (o.company_id is null and lower(btrim(o.metadata ->> 'customer_name')) = lower(v_customer)));
      if v_order_id is null then
        v_order_new := true;
        v_order_id := gen_random_uuid();
        insert into plm.production_order (id, production_order_number, company_id, metadata, source_system, source_id)
        values (v_order_id, v_number, p_customer_id,
                jsonb_build_object('customer_name', v_customer, 'created_by', v_actor,
                                   'created_via', 'popdam_buy_sheet'),
                'popdam_buy_sheet', 'buysheet:order:' || v_order_id::text);
        insert into plm.production_order_source_ref (production_order_id, source_system, source_id, is_primary)
        values (v_order_id, 'popdam_buy_sheet', 'buysheet:order:' || v_order_id::text, true);
      end if;
    end if;
    if p_apply and v_outcome = 'new' then
      v_line_id := gen_random_uuid();
      insert into plm.production_order_line (
        id, production_order_id, line_number, sku, quantity_ordered, case_pack, order_type,
        start_ship_date, item_id, master_data_match_status, assortment_id, metadata, source_system, source_id)
      values (
        v_line_id, v_order_id,
        (select coalesce(max(nullif(regexp_replace(line_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
           from plm.production_order_line where production_order_id = v_order_id)::text,
        v_sku, v_qty, v_case_pack, 'FOB', v_date, v_item, v_status, v_master,
        v_meta || jsonb_build_object('created_by', v_actor, 'created_via', 'popdam_buy_sheet'),
        'popdam_buy_sheet', v_ref);
      insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_id, 'popdam_buy_sheet', v_ref, true);
    end if;

    v_results := v_results || jsonb_build_object(
      'sku', v_sku, 'delivery_date', v_date, 'quantity', v_qty, 'group', v_group,
      'outcome', v_outcome, 'reason', v_reason, 'order_number', v_number,
      'previous_quantity', v_prev,
      'master_sku', v_master, 'previous_assortment_id', v_prev_asst,
      'assortment_set', v_master is not null and v_outcome in ('new', 'updated'),
      'source_ref', v_ref, 'order_created', v_order_new,
      'line_id', case when v_outcome in ('updated', 'unchanged', 'held') or p_apply then v_line_id end,
      'item_match', v_status);
  end loop;

  if p_apply and exists (select 1 from jsonb_array_elements(v_results) r where r ->> 'outcome' = 'revision') then
    raise exception 'import_dam_buy_sheet: this sheet revises a buy sheet that was already imported; revised buy sheets are not supported yet, nothing was imported'
      using errcode = 'P0001', hint = 'Do not enter the changes by hand. Report the revised sheet so revision handling can be built.';
  end if;

  if p_apply then
    insert into dam.order_buy_sheet_import
      (customer_id, file_name, file_sha256, raw_sheet, parsed_lines, order_numbers, result, imported_by)
    values (p_customer_id, p_file_name, p_file_sha256, p_raw_sheet, p_lines,
            coalesce(p_order_numbers, '{}'::jsonb), v_results, v_actor)
    returning id into v_import_id;
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'import_id', v_import_id, 'customer', v_customer,
    'counts', (select jsonb_object_agg(k, n) from (
                 select r ->> 'outcome' as k, count(*) as n from jsonb_array_elements(v_results) r group by 1) c),
    'unmatched_styles', (select coalesce(jsonb_agg(distinct r ->> 'sku'), '[]'::jsonb)
                           from jsonb_array_elements(v_results) r where r ->> 'item_match' <> 'matched'),
    'lines', v_results);
end;
$_$;

-- FUNCTION public.infer_path_attrs(text)
CREATE OR REPLACE FUNCTION public.infer_path_attrs(p_path text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
  segs text[];
  idx  int;
  s    text;
  c1   text;
  cust text := NULL;
  prog text := NULL;
  pidx int  := NULL;
  yr   text := NULL;
BEGIN
  IF p_path IS NULL OR p_path = '' THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  segs := string_to_array(p_path, '/');
  idx  := array_position(segs, '____New Structure');
  IF idx IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  s := NULLIF(segs[idx + 1], '');
  IF s IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;
  -- Folder name is an input; stored stage is the canonical business term.
  IF s = 'In Dev' THEN
    s := 'In Development';
  ELSIF s IN ('Concept Approved', 'Concept_Approved') THEN
    s := 'Concept Approved Designs';
  END IF;

  IF s = 'In Development' AND segs[idx + 2] IN ('Customer Adopted', 'Cust Adopted') THEN
    c1 := NULLIF(segs[idx + 3], '');
    IF c1 IS NULL THEN
      cust := NULL; prog := NULL;
    ELSIF c1 = '_FINISHED' THEN
      -- wrapper bucket: _FINISHED / <Customer>_finished / <Program> / <SKU>
      cust := NULLIF(regexp_replace(COALESCE(segs[idx + 4], ''), '_finished$', '', 'i'), '');
      pidx := idx + 5;
    ELSIF left(c1, 1) = '_' THEN
      -- status buckets (_NOT APPROVED, _REJECTED, _No Customer, _NOT SUBMITTED): no real customer
      cust := NULL; prog := NULL;
    ELSE
      cust := c1;
      pidx := idx + 4;
    END IF;

    IF pidx IS NOT NULL THEN
      prog := NULLIF(segs[pidx], '');
      -- Year folder (<Customer>/2026/<Program>/...): program is the next folder.
      IF prog ~ '^20[0-9]{2}$' THEN
        yr   := prog;
        prog := NULLIF(segs[pidx + 1], '');
      END IF;
    END IF;

    -- Guard: the program slot must be a real program folder, not the SKU folder or a file.
    IF prog IS NOT NULL THEN
      IF prog ~ '\.[A-Za-z0-9]+$' THEN
        prog := NULL;  -- looks like a filename
      ELSIF prog !~ '[[:space:]]' AND prog ~ '^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$' AND length(prog) >= 8 THEN
        prog := NULL;  -- looks like a SKU code (no program folder present)
      END IF;
    END IF;
    -- Keep the year searchable: a program under a year folder whose own name
    -- lacks that year gets it appended ("Dollar General Harvest Coir 2027").
    IF yr IS NOT NULL AND prog IS NOT NULL AND position(yr in prog) = 0 THEN
      prog := prog || ' ' || yr;
    END IF;
  END IF;

  RETURN jsonb_build_object('stage', s, 'customer', cust, 'program', prog);
END;
$_$;

-- FUNCTION public.is_known_designer_value(text)
CREATE OR REPLACE FUNCTION public.is_known_designer_value(p_value text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT COALESCE(bool_and(EXISTS (
    SELECT 1 FROM public.known_designer_first_name k
    WHERE k.first_name = upper(split_part(btrim(part), ' ', 1))
  )), false)
  FROM regexp_split_to_table(p_value, '[/,&]') part;
$$;

-- FUNCTION public.is_plausible_source_file_name(text)
CREATE OR REPLACE FUNCTION public.is_plausible_source_file_name(p_name text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  select length(btrim(p_name)) between 2 and 200
     and btrim(p_name) ~ '[A-Za-z0-9._-]'
     and btrim(p_name) ~ '[A-Za-z]'
     and btrim(p_name) !~ '^[0-9]+$'
     and lower(btrim(p_name)) not in (
       'none','n/a','na','tbd','see attached','see attachment','various','multiple',
       'page','mockup','quick reference','item dimensions','licensor info'
     )
$_$;

-- FUNCTION public.link_dam_order_lines_scoped(uuid[])
CREATE OR REPLACE FUNCTION public.link_dam_order_lines_scoped(p_line_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
declare
  v_ids uuid[];
  v_count integer;
  v_result jsonb;
begin
  if p_line_ids is null or cardinality(p_line_ids) < 1
     or cardinality(p_line_ids) > 500 or array_position(p_line_ids, null) is not null then
    raise exception 'link_dam_order_lines_scoped requires 1..500 non-null line IDs'
      using errcode = '22023';
  end if;
  select array_agg(distinct id order by id) into v_ids from unnest(p_line_ids) id;

  -- Stable order prevents reciprocal caller batches from taking reversed locks.
  perform l.id from plm.production_order_line l
  where l.id = any(v_ids) order by l.id for update;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then
    raise exception 'link_dam_order_lines_scoped: one or more scoped lines no longer exist'
      using errcode = 'P0002';
  end if;

  with base as materialized (
    select l.id, l.sku_normalized, l.source_style_type, l.item_id,
      l.master_data_match_status as prior_status
    from plm.production_order_line l where l.id = any(v_ids)
  ), candidates as materialized (
    -- Exactly the user's linking contract: trim+case-fold SKU and explicit
    -- catalog, count distinct items across ALL matching bridge rows.
    select l.id, count(distinct b.plm_item_id)::integer as candidate_count,
      (array_agg(distinct b.plm_item_id order by b.plm_item_id)
        filter (where b.plm_item_id is not null))[1] as item_id
    from base l
    left join public.style_tracker_rows r
      on nullif(btrim(lower(r.sku)), '') = l.sku_normalized
    left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
      and b.tracker_type = l.source_style_type
    where l.item_id is null and l.prior_status not in ('manual', 'not_applicable')
      and l.source_style_type is not null
    group by l.id
  ), eligible as materialized (
    select c.*, (select f.facts->>'source'
      from dam.orderlist_product_facts(c.item_id, l.source_style_type) f) as workflow_source
    from candidates c join base l on l.id = c.id where c.candidate_count = 1
  ), changed as (
    update plm.production_order_line l
      set item_id = e.item_id, master_data_match_status = 'matched',
          metadata = coalesce(l.metadata, '{}'::jsonb) || jsonb_build_object(
            'last_relinked_by', 'system:coldlion_intake',
            'last_relinked_at', now(), 'link_candidate_item_count', e.candidate_count,
            'pre_intake_relink_match_status', l.master_data_match_status),
          updated_at = now()
    from eligible e
    where l.id = e.id and e.workflow_source = 'master_data'
      and l.item_id is null and l.master_data_match_status not in ('manual', 'not_applicable')
    returning l.id
  )
  select jsonb_build_object(
    'considered', (select count(*) from base),
    'linked', (select count(*) from changed),
    'existing_preserved', (select count(*) from base where item_id is not null),
    'manual_or_not_applicable_preserved', (select count(*) from base where item_id is null and prior_status in ('manual', 'not_applicable')),
    'missing_catalog', (select count(*) from base where item_id is null and prior_status not in ('manual', 'not_applicable') and source_style_type is null),
    'ambiguous', (select count(*) from candidates where candidate_count > 1),
    'no_candidate', (select count(*) from candidates where candidate_count = 0),
    'conflicting_workflow', (select count(*) from eligible where workflow_source is distinct from 'master_data')
  ) into v_result;
  return v_result;
end;
$$;

-- FUNCTION public.mark_dam_search_embedding_error(text, uuid, text, uuid, text, text)
CREATE OR REPLACE FUNCTION public.mark_dam_search_embedding_error(p_document_type text, p_entity_id uuid, p_content_sha256 text, p_lease_token uuid, p_error text, p_category text DEFAULT 'transient'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (coalesce((select auth.role()) = 'service_role', false) or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then raise exception 'authorized embedding actor required' using errcode='42501'; end if;
  if p_category is null or p_category not in ('transient','permanent') then raise exception 'invalid embedding error category' using errcode='22023'; end if;
  update public.dam_search_documents set embedding_error=left(coalesce(p_error,'unknown embedding error'),1000),
    embedding_error_category=case when p_category='permanent' or embedding_attempts>=embedding_max_attempts then 'permanent' else 'transient' end,
    embedding_next_retry_at=case when p_category='transient' and embedding_attempts<embedding_max_attempts
      then now()+make_interval(secs=>least(3600,30*(2^greatest(0,embedding_attempts-1))::int)) end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null
  where document_type=p_document_type and entity_id=p_entity_id and coalesce(metadata->>'_embedding_lease_input_sha256',content_sha256)=p_content_sha256
    and embedding_lease_token=p_lease_token and embedding_lease_expires_at>now(); return found;
end $$;

-- FUNCTION public.mark_sg_search_embedding_error(uuid, text, uuid, text, text)
CREATE OR REPLACE FUNCTION public.mark_sg_search_embedding_error(p_style_guide_file_id uuid, p_content_sha256 text, p_lease_token uuid, p_error text, p_category text DEFAULT 'transient'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_category not in ('transient', 'permanent') then
    raise exception 'invalid embedding error category' using errcode = '22023';
  end if;
  update public.style_guide_search_embedding_jobs j
     set error = left(coalesce(p_error, 'unknown embedding error'), 1000),
         error_category = case when p_category = 'permanent' or j.attempt_count >= j.max_attempts
                               then 'permanent' else 'transient' end,
         next_retry_at = case when p_category = 'transient' and j.attempt_count < j.max_attempts
                              then now() + make_interval(secs => least(3600, 30 * power(2, greatest(0, j.attempt_count - 1))::int)) end,
         lease_token = null,
         claimed_by = null,
         lease_expires_at = null,
         updated_at = now()
   where j.style_guide_file_id = p_style_guide_file_id
     and j.content_sha256 = p_content_sha256
     and j.lease_token = p_lease_token
     and j.lease_expires_at > now()
     and exists (select 1 from public.style_guide_search_documents d
                  where d.style_guide_file_id = p_style_guide_file_id
                    and d.content_sha256 = p_content_sha256);
  return found;
end;
$$;

-- FUNCTION public.parse_pdf_declared_style_guide(uuid)
CREATE OR REPLACE FUNCTION public.parse_pdf_declared_style_guide(p_asset_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_sku   text;
  v_ftype text;
  v_fname text;
  v_text  text;
  v_label text;
  v_key   text;
begin
  select sku, file_type::text, filename into v_sku, v_ftype, v_fname
  from assets where id = p_asset_id;
  if v_sku is null or btrim(v_sku) = '' then return 0; end if;
  if not public.is_style_guide_source_pdf(v_ftype, v_fname) then return 0; end if;

  select extracted_text into v_text
  from pdf_text_samples
  where asset_id = p_asset_id and extracted_text is not null
  order by sampled_at desc limit 1;
  if v_text is null then return 0; end if;

  v_label := btrim((regexp_match(v_text,
    '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]);
  if v_label is null then return 0; end if;
  v_label := btrim(v_label, E' \t.,;:');
  if not public.is_plausible_source_file_name(v_label) then
    return 0;
  end if;

  v_key := public.style_guide_label_norm(v_label);
  if v_key is null or v_key = '' then return 0; end if;

  insert into sku_style_guide_links
    (sku, file_name, source_system, source_style_guide_key, style_guide_label,
     match_method, match_confidence, matched_asset_count)
  values
    (v_sku, null, 'sheet_declared', v_key, v_label, 'sheet_declared', 1.0, 1)
  on conflict on constraint sku_style_guide_links_identity_key
  do update set last_seen_at = now(), style_guide_label = excluded.style_guide_label;
  return 1;
end;
$$;

-- FUNCTION public.parse_pdf_files_used(uuid)
CREATE OR REPLACE FUNCTION public.parse_pdf_files_used(p_asset_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  return public.parse_pdf_files_used_v2(p_asset_id);
end;
$$;

-- FUNCTION public.parse_pdf_files_used_v2(uuid)
CREATE OR REPLACE FUNCTION public.parse_pdf_files_used_v2(p_asset_id uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_sku     text;
  v_ftype   text;
  v_fname   text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
  v_entry   text;
  v_inline  text;
begin
  select sku, file_type::text, filename into v_sku, v_ftype, v_fname
  from assets where id = p_asset_id;
  if v_sku is null or btrim(v_sku) = '' then return 0; end if;

  -- Style Guide Sources are parsed ONLY from licensing-sheet / tech-pack PDFs.
  if not public.is_style_guide_source_pdf(v_ftype, v_fname) then return 0; end if;

  select extracted_text into v_text
  from pdf_text_samples
  where asset_id = p_asset_id and extracted_text is not null
  order by sampled_at desc limit 1;
  if v_text is null then return 0; end if;

  v_lines := string_to_array(v_text, E'\n');
  foreach v_line in array v_lines loop
    v_trimmed := btrim(v_line);

    if v_trimmed ~* '^(files?\s+used|source\s+files?|art\s+files?|artwork\s+files?|design\s+files?|source\s+art(work)?)\s*:' then
      v_in_sect := true;
      v_inline := btrim(regexp_replace(v_trimmed,
        '(?i)^(files?\s+used|source\s+files?|art\s+files?|artwork\s+files?|design\s+files?|source\s+art(work)?)\s*:\s*', ''));
      v_inline := btrim(v_inline, E' \t.,;:');
      if v_inline <> '' then
        foreach v_entry in array regexp_split_to_array(v_inline, '[,;|]') loop
          v_entry := btrim(btrim(v_entry), E' \t.,;:');
          if public.is_plausible_source_file_name(v_entry) then
            insert into sku_files_used (sku, file_name, source)
            values (v_sku, v_entry, 'pdf_text')
            on conflict (sku, file_name) do nothing;
            v_count := v_count + 1;
          end if;
        end loop;
        v_in_sect := false;
      end if;
      continue;
    end if;

    if v_in_sect then
      if v_trimmed = '' or v_trimmed ~ '^\S[^:]*:\s*$' then
        v_in_sect := false;
        continue;
      end if;
      v_entry := btrim(v_trimmed, E' \t.,;:');
      if public.is_plausible_source_file_name(v_entry) then
        insert into sku_files_used (sku, file_name, source)
        values (v_sku, v_entry, 'pdf_text')
        on conflict (sku, file_name) do nothing;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$_$;

-- FUNCTION public.prepare_sku_style_guide_resolution(boolean)
CREATE OR REPLACE FUNCTION public.prepare_sku_style_guide_resolution(p_full boolean DEFAULT false) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_portal_hash text;
  v_count integer;
begin
  if exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='v') then
    drop view pg_temp.sku_sg_inputs;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='m') then
    drop materialized view pg_temp.sku_sg_inputs;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='f') then
    drop foreign table pg_temp.sku_sg_inputs;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='S') then
    drop sequence pg_temp.sku_sg_inputs;
  else
    drop table if exists pg_temp.sku_sg_inputs;
  end if;
  if exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='v') then
    drop view pg_temp.sku_sg_portal;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='m') then
    drop materialized view pg_temp.sku_sg_portal;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='f') then
    drop foreign table pg_temp.sku_sg_portal;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='S') then
    drop sequence pg_temp.sku_sg_portal;
  else
    drop table if exists pg_temp.sku_sg_portal;
  end if;
  if exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='v') then
    drop view pg_temp.sku_sg_pending;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='m') then
    drop materialized view pg_temp.sku_sg_pending;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='f') then
    drop foreign table pg_temp.sku_sg_pending;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='S') then
    drop sequence pg_temp.sku_sg_pending;
  else
    drop table if exists pg_temp.sku_sg_pending;
  end if;
  -- Freeze every observation once; duplicates and NULL filename keys remain significant.
  create temporary table pg_temp.sku_sg_portal on commit preserve rows as
  with portal as (
select * from plm.asset_file_style_guide_keys
  ) select i.*,pg_catalog.hash_record_extended(row(i.source_system COLLATE "C",i.file_name_norm COLLATE "C",i.source_style_guide_key COLLATE "C",
     i.style_guide_label COLLATE "C",i.core_style_guide_id,i.matched_file_name COLLATE "C"),5608) as portal_hash_1,
     pg_catalog.hash_record_extended(row(i.source_system COLLATE "C",i.file_name_norm COLLATE "C",i.source_style_guide_key COLLATE "C",
     i.style_guide_label COLLATE "C",i.core_style_guide_id,i.matched_file_name COLLATE "C"),5609) as portal_hash_2
  from portal i;
  select 'v4:'||md5(concat_ws(':',count(*),sum(portal_hash_1::numeric),sum(portal_hash_2::numeric)))
  into v_portal_hash from pg_temp.sku_sg_portal;
  create temporary table pg_temp.sku_sg_pending (
    sku text primary key,input_hash text not null,portal_hash text not null,output_hash text
  ) on commit preserve rows;
  -- One UNION ALL statement freezes the same input multiset used by hashing
  -- and all batches. Keep raw duplicates and the original eligibility predicates.
  create temporary table pg_temp.sku_sg_inputs on commit preserve rows as
    select u.sku, 'file'::text as input_kind, u.file_name,
      null::text as file_name_norm,
      null::text as declared_label, null::text as declared_key,
      null::text as label_key, md5(row('file', u.file_name)::text) as row_hash
    from public.sku_files_used u
    where u.sku is not null and u.file_name is not null and btrim(u.file_name) <> ''
    union all
    select a.sku, 'sheet'::text, null::text, null::text,
      p.declared_style_guide_label, p.declared_style_guide_key,
      null::text,
      md5(row('sheet', p.declared_style_guide_label,p.declared_style_guide_key)::text)
    from public.pdf_text_samples p join public.assets a on a.id=p.asset_id
    where a.sku is not null and btrim(a.sku) <> ''
      and public.is_style_guide_source_pdf(a.file_type::text,a.filename)
      and nullif(p.declared_style_guide_key,'') is not null;
  insert into pg_temp.sku_sg_pending(sku,input_hash,portal_hash)
  select sku,md5(string_agg(row_hash,'' order by row_hash)),v_portal_hash
  from pg_temp.sku_sg_inputs group by sku;

  -- Re-derive if an independent parser/service changed the semantic output.
  update pg_temp.sku_sg_pending q set output_hash = (
    select md5(coalesce(string_agg(row(l.id,l.sku,l.file_name,l.source_system,l.source_style_guide_key,l.style_guide_label,l.match_method,l.match_confidence,l.matched_asset_count,l.core_style_guide_id)::text, E'\n' order by l.id), '')) from public.sku_style_guide_links l
      where l.id = any(p.active_link_ids))
    from public.sku_style_guide_resolver_progress p where p.sku = q.sku;
  if not p_full then
    -- Exact observed membership preserves quarantined history while allowing
    -- independent parsers to touch currently valid evidence between nightly runs.
    update public.sku_style_guide_links l set last_seen_at = now()
    from public.sku_style_guide_resolver_progress p, pg_temp.sku_sg_pending q
    where l.sku = p.sku and p.sku = q.sku
      and p.input_hash = q.input_hash and p.portal_hash = q.portal_hash
      and p.output_hash = q.output_hash and l.id = any(p.active_link_ids);
    update public.sku_style_guide_resolver_progress p set resolved_at = now()
    from pg_temp.sku_sg_pending q where p.sku = q.sku
      and p.input_hash = q.input_hash and p.portal_hash = q.portal_hash and p.output_hash = q.output_hash;
    delete from pg_temp.sku_sg_pending q using public.sku_style_guide_resolver_progress p
      where p.sku = q.sku and p.input_hash = q.input_hash and p.portal_hash = q.portal_hash and p.output_hash = q.output_hash;
  end if;
  select count(*) into v_count from pg_temp.sku_sg_pending;
  if v_count > 0 then
    create index on pg_temp.sku_sg_portal(file_name_norm);
    create index on pg_temp.sku_sg_portal(style_guide_label_key);
    analyze pg_temp.sku_sg_portal;
    create index on pg_temp.sku_sg_inputs(input_kind,sku);
    update pg_temp.sku_sg_inputs i set file_name_norm=public.file_name_norm(i.file_name)
      from pg_temp.sku_sg_pending q where q.sku=i.sku and i.input_kind='file';
    update pg_temp.sku_sg_inputs i set label_key=public.style_guide_label_norm(i.declared_label)
      from pg_temp.sku_sg_pending q where q.sku=i.sku and i.input_kind='sheet';
    analyze pg_temp.sku_sg_inputs;
  end if;
  return v_count;
end;
$$;

-- FUNCTION public.preview_stale_sg_files(text, uuid, numeric)
CREATE OR REPLACE FUNCTION public.preview_stale_sg_files(p_root_label text, p_run_id uuid, p_min_ratio numeric DEFAULT 0.5) RETURNS TABLE(root_label text, run_id uuid, active_total bigint, run_active_total bigint, stale_candidates bigint, run_files_found integer, root_inaccessible boolean, guard_state text, guard_reason text, safe_to_reconcile boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_active bigint;
  v_run_active bigint;
  v_stale bigint;
  v_found integer;
  v_inaccessible boolean;
  v_state text;
  v_reason text;
  v_ratio numeric;
begin
  if p_root_label is null or p_run_id is null then
    raise exception 'preview_stale_sg_files requires a root label and a run id';
  end if;

  -- popdam3#804: one pass over idx_sg_file_crawl_seen_root_run (active files
  -- only); the file row confirms is_active.
  select count(*),
         count(*) filter (where s.crawl_run_id = p_run_id)
    into v_active, v_run_active
    from public.style_guide_file_crawl_seen s
    join public.style_guide_files f on f.id = s.style_guide_file_id
   where s.root_label = p_root_label
     and f.is_active;

  v_stale := v_active - v_run_active;

  select r.files_found,
         coalesce(p_root_label = any (coalesce(r.inaccessible_roots, array[]::text[])), false)
    into v_found, v_inaccessible
    from public.style_guide_crawl_runs r
   where r.id = p_run_id;

  if not found then
    v_state := 'empty_crawl';
    v_reason := format('crawl run %s does not exist', p_run_id);
  elsif v_inaccessible then
    v_state := 'inaccessible_roots';
    v_reason := format('root %L is listed in the run''s inaccessible_roots; current rows are left active', p_root_label);
  elsif coalesce(v_found, 0) = 0 or v_run_active = 0 then
    v_state := 'empty_crawl';
    v_reason := format('run reported files_found=%s and %s active rows for this root; refusing to inactivate %s current rows',
                       coalesce(v_found, 0), v_run_active, v_active);
  else
    v_ratio := case when v_active > 0 then v_run_active::numeric / v_active::numeric else 1 end;
    if v_active > 0 and v_ratio < coalesce(p_min_ratio, 0.5) then
      v_state := 'low_nonzero';
      v_reason := format('run saw %s of %s active rows (ratio %s < %s); suspicious partial crawl, current rows left active',
                         v_run_active, v_active, round(v_ratio, 4), coalesce(p_min_ratio, 0.5));
    else
      v_state := 'ok';
      v_reason := null;
    end if;
  end if;

  root_label        := p_root_label;
  run_id            := p_run_id;
  active_total      := v_active;
  run_active_total  := v_run_active;
  stale_candidates  := v_stale;
  run_files_found   := v_found;
  root_inaccessible := coalesce(v_inaccessible, false);
  guard_state       := v_state;
  guard_reason      := v_reason;
  safe_to_reconcile := (v_state = 'ok');
  return next;
end;
$$;

-- FUNCTION public.prewarm_style_guide_search()
CREATE OR REPLACE FUNCTION public.prewarm_style_guide_search() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  perform extensions.pg_prewarm('public.style_guide_search_documents'::regclass, 'read');
  perform extensions.pg_prewarm('public.idx_sg_search_documents_search_vector'::regclass, 'read');
  perform extensions.pg_prewarm('public.style_guide_file_preview_state'::regclass, 'read');
  perform extensions.pg_prewarm('public.style_guide_file_preview_state_pkey'::regclass, 'read');
end
$$;

-- FUNCTION public.propagate_group_tags_batch(uuid, integer)
CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 100) RETURNS TABLE(next_cursor uuid, propagated integer, skipped integer, done boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    SET lock_timeout TO '0'
    AS $$
declare
  v_next_cursor uuid;
  v_total_propagated integer := 0;
  v_group_count integer := 0;
  v_batch_propagated integer;
  v_file_specific_tags text[] := array[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
begin
  for v_next_cursor in
    select sg.id
    from public.style_groups sg
    where (p_cursor is null or sg.id > p_cursor)
    order by sg.id
    limit p_batch_size
  loop
    v_group_count := v_group_count + 1;

    with source_asset as (
      select a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      from public.assets a
      where a.style_group_id = v_next_cursor
        and a.is_deleted = false
        and a.ai_tagged_at is not null
      order by a.primary_sort_tier asc, a.ai_tagged_at asc
      limit 1
    ),
    source_tags as (
      select at2.tag
      from public.asset_tags at2
      join source_asset sa on sa.id = at2.asset_id
      where at2.source = 'ai'
        and at2.category = 'legacy_unscoped'
        and at2.status = 'active'
        and lower(trim(at2.tag)) != all(v_file_specific_tags)
    ),
    source_chars as (
      select ac.character_id
      from public.asset_characters ac
      join source_asset sa on sa.id = ac.asset_id
    ),
    source_licensor_chars as (
      select alc.character_id, alc.source, alc.model
      from public.asset_licensor_characters alc
      join source_asset sa on sa.id = alc.asset_id
    ),
    siblings as (
      select a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      from public.assets a
      cross join source_asset sa
      where a.style_group_id = v_next_cursor
        and a.is_deleted = false
        and a.id != sa.id
    ),
    inserted_tags as (
      insert into public.asset_tags (asset_id, tag, source, category, status)
      select s.id, st.tag, 'ai', 'legacy_unscoped', 'active'
      from siblings s
      cross join source_tags st
      on conflict (asset_id, tag) do nothing
      returning 1
    ),
    inserted_chars as (
      insert into public.asset_characters (asset_id, character_id)
      select s.id, sc.character_id
      from siblings s
      cross join source_chars sc
      on conflict (asset_id, character_id) do nothing
      returning 1
    ),
    inserted_licensor_chars as (
      insert into public.asset_licensor_characters (asset_id, character_id, source, model)
      select s.id, slc.character_id, slc.source, slc.model
      from siblings s
      cross join source_licensor_chars slc
      on conflict (asset_id, character_id) do nothing
      returning 1
    ),
    meta_updates as (
      update public.assets a
      set
        licensor_id = coalesce(a.licensor_id, sa.licensor_id),
        property_id = coalesce(a.property_id, sa.property_id),
        is_licensed = case when a.is_licensed = true then true else coalesce(sa.is_licensed, a.is_licensed) end,
        big_theme = coalesce(a.big_theme, sa.big_theme),
        little_theme = coalesce(a.little_theme, sa.little_theme),
        design_style = coalesce(a.design_style, sa.design_style),
        cover_description = coalesce(a.cover_description, sa.cover_description)
      from source_asset sa, siblings s
      where a.id = s.id
        and (
          (a.licensor_id is null and sa.licensor_id is not null) or
          (a.property_id is null and sa.property_id is not null) or
          (a.is_licensed is not true and sa.is_licensed = true) or
          (a.big_theme is null and sa.big_theme is not null) or
          (a.little_theme is null and sa.little_theme is not null) or
          (a.design_style is null and sa.design_style is not null) or
          (a.cover_description is null and sa.cover_description is not null)
        )
      returning 1
    )
    select
      (select count(*)::integer from inserted_tags)
      + (select count(*)::integer from inserted_chars)
      + (select count(*)::integer from inserted_licensor_chars)
    into v_batch_propagated;

    v_total_propagated := v_total_propagated + coalesce(v_batch_propagated, 0);
  end loop;

  return query select
    v_next_cursor,
    v_total_propagated,
    0::integer,
    (v_group_count < p_batch_size);
end;
$$;

-- FUNCTION public.queue_nightly_rebuild_style_groups()
CREATE OR REPLACE FUNCTION public.queue_nightly_rebuild_style_groups() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  -- The BULK_OPERATIONS key the PopDAM worker owns. This function never invents its
  -- shape; it writes exactly the enqueue state the baseline body wrote.
  c_op            constant text := 'rebuild-style-groups';

  -- This function's own key, which no other writer touches. See the header.
  c_marker        constant text := 'style-group-counts-reconcile';
  c_watermark     constant text := 'style-group-change-watermark';

  -- 06:00 UTC, the hour the retired `0 6 * * *` schedule fired.
  c_enqueue_hour  constant integer := 6;

  -- The floor. Requirement 3 on #2440: bound the silence this change introduces.
  c_floor_days    constant integer := 7;

  -- Reconcile chunk and per-pass budget, measured from the top-level statement start
  -- so that time spent waiting for the locks below counts against the 120 s timeout.
  c_chunk         constant integer := 200;
  c_pass_budget   constant interval := interval '60 seconds';

  v_current         jsonb;
  v_op              jsonb;
  v_marker          jsonb;
  v_status          text;
  v_run_id          text;
  v_last_enqueued   timestamptz;
  v_last_reconciled timestamptz;
  v_last_run        text;
  v_op_seen_at      timestamptz;
  v_in_flight       boolean;
  v_reason          text;
  v_now             timestamptz := now();
  v_state           jsonb;
  v_chunk_ids       uuid[];
  v_written         bigint := 0;
  v_watermark       jsonb;
  v_cutoff          timestamptz;
  v_since           timestamptz;
  v_full            boolean;
  v_change_locked   boolean := false;
  v_walk            jsonb;
  v_after           uuid;
  v_walk_started    text;
  v_walk_done       boolean := false;
begin
  -- Serialize every BULK_OPERATIONS writer, exactly as the baseline body did. This is
  -- also what makes the run_id marker safe against two overlapping poll invocations.
  -- Acquire before BULK_OPERATIONS: never invert a writer which first stamps
  -- its change and then updates operation state in the same transaction.
  SELECT true INTO v_change_locked
  FROM pg_advisory_lock(hashtext('style-group-change-clock-2421'));
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  v_cutoff := clock_timestamp();

  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_watermark := coalesce(v_current -> c_watermark, '{}'::jsonb);

  v_op := case when jsonb_typeof(v_current -> c_op) = 'object'
               then v_current -> c_op end;
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  v_status          := v_op ->> 'status';
  v_run_id          := nullif(btrim(coalesce(v_op ->> 'run_id', '')), '');
  v_last_enqueued   := nullif(btrim(coalesce(v_marker ->> 'last_enqueued_at', '')), '')::timestamptz;
  v_last_reconciled := nullif(btrim(coalesce(v_marker ->> 'last_reconciled_at', '')), '')::timestamptz;
  v_last_run        := nullif(btrim(coalesce(v_marker ->> 'last_reconciled_run_id', '')), '');

  -- Only a matching successful worker run acknowledges the captured cutoff.
  -- Failed/interrupted/partial/manual runs never advance it. Older workers may
  -- still do a full walk, which is a safe superset during staged application rollout.
  if v_status = 'completed'
     and v_run_id = v_watermark ->> 'pending_run_id'
     and v_op -> 'params' ->> 'watermark_protocol' = '1'
     and (v_op -> 'params' ->> 'changed_cutoff')::timestamptz
         = (v_watermark ->> 'pending_cutoff')::timestamptz
     and v_run_id is distinct from v_watermark ->> 'last_successful_run_id'
  then
    v_watermark := v_watermark || jsonb_build_object(
      'last_successful_cutoff', v_watermark ->> 'pending_cutoff',
      'last_successful_run_id', v_run_id,
      'last_full_cutoff', case when v_watermark ->> 'pending_mode' = 'full'
        then v_watermark ->> 'pending_cutoff' else v_watermark ->> 'last_full_cutoff' end);
  end if;

  -- The last moment anything claimed this operation was alive. The worker stamps
  -- 'updated_at' on every progress write and 'started_at' on the enqueue; if the object
  -- carries neither, ARM 1's own 'last_enqueued_at' is the fallback.
  v_op_seen_at := coalesce(
    nullif(btrim(coalesce(v_op ->> 'updated_at', '')), '')::timestamptz,
    nullif(btrim(coalesce(v_op ->> 'started_at', '')), '')::timestamptz,
    v_last_enqueued
  );

  -- A rebuild is IN FLIGHT only if it says 'running'/'queued' AND something has touched it
  -- inside the floor window. An operation stuck at 'queued' for longer than the floor is a
  -- dead worker, not a running rebuild, and must not suppress ARM 3 forever.
  v_in_flight := coalesce(v_status, '') in ('running', 'queued')
                 and v_op_seen_at is not null
                 and v_op_seen_at >= v_now - make_interval(days => c_floor_days);

  -- ======================================================================
  -- ARM 2 - CHAINED RECONCILE, evaluated FIRST. An unreconciled completed run must be
  -- reconciled before ARM 1 is allowed to overwrite the operation object with a fresh
  -- 'queued' state and a new run_id.
  -- ======================================================================
  if v_status = 'completed'
     and v_run_id is not null
     and v_run_id is distinct from v_last_run
  then
    v_reason := 'rebuild_completed';
  end if;

  -- ======================================================================
  -- ARM 1 - ENQUEUE. The retired `0 6 * * *` behaviour, expressed as state.
  -- ======================================================================
  if v_reason is null
     and coalesce(v_status, '') not in ('running', 'queued')
     and extract(hour from (v_now at time zone 'UTC')) >= c_enqueue_hour
     and (
       v_last_enqueued is null
       or (v_last_enqueued at time zone 'UTC')::date < (v_now at time zone 'UTC')::date
     )
  then
    -- First run and every successful seven-day interval retain full convergence.
    v_full := v_watermark ->> 'last_full_cutoff' is null
      or (v_watermark ->> 'last_full_cutoff')::timestamptz <= v_cutoff - interval '7 days';
    v_since := case when v_full then null
      else (v_watermark ->> 'last_successful_cutoff')::timestamptz end;
    v_state := jsonb_build_object(
      'status',         'queued',
      'cursor',         0,
      'params',         jsonb_build_object('force_restart', true,
        'watermark_protocol', 1, 'changed_since', v_since,
        'changed_cutoff', v_cutoff, 'rebuild_mode', case when v_full then 'full' else 'incremental' end),
      'started_at',     v_now::text,
      'updated_at',     v_now::text,
      'progress',       '{}'::jsonb,
      'run_id',         gen_random_uuid()::text,
      'queue_position', (extract(epoch from v_now) * 1000)::bigint,
      'requested_by',   'pg_cron'
    );

    v_watermark := v_watermark || jsonb_build_object(
      'pending_run_id', v_state ->> 'run_id', 'pending_cutoff', v_cutoff,
      'pending_mode', case when v_full then 'full' else 'incremental' end);
    v_current := jsonb_set(v_current, array[c_watermark], v_watermark, true);
    v_current := jsonb_set(v_current, array[c_op], v_state, true);
    v_current := jsonb_set(
      v_current,
      array[c_marker],
      v_marker || jsonb_build_object('last_enqueued_at', v_now::text),
      true
    );

    insert into admin_config (key, value, updated_at)
    values ('BULK_OPERATIONS', v_current, v_now)
    on conflict (key) do update
      set value      = excluded.value,
          updated_at = excluded.updated_at;

    -- A run has just been queued; there is nothing to reconcile on this pass.
    perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
    v_change_locked := false;
    return;
  end if;

  -- The counts-only work retains its old BULK lock but never holds this new
  -- exclusive change-clock lock during its potentially long scan.
  perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
  v_change_locked := false;

  -- ======================================================================
  -- ARM 3 - THE FLOOR. Never while the rebuild is in flight: the recompute is
  -- justified only against membership the rebuild has finished changing.
  -- ======================================================================
  if v_reason is null
     and not v_in_flight
     and (
       v_last_reconciled is null
       or v_last_reconciled < v_now - make_interval(days => c_floor_days)
     )
  then
    v_reason := 'floor';
  end if;

  if v_reason is null then
    return;
  end if;

  -- Resume only a walk begun under this exact operation state. Any other state (a new
  -- run, a resumed run, a different arm) may have changed membership behind the cursor.
  v_walk := v_marker -> 'reconcile_walk';
  if jsonb_typeof(v_walk) = 'object'
     and v_walk ->> 'reason' = v_reason
     and v_walk ->> 'run_id' is not distinct from v_run_id
     and v_walk ->> 'trigger_status' is not distinct from v_status
     and (v_walk ->> 'op_seen_at')::timestamptz is not distinct from v_op_seen_at
  then
    v_after        := (v_walk ->> 'after_id')::uuid;
    v_written      := coalesce((v_walk ->> 'rows_written')::bigint, 0);
    v_walk_started := v_walk ->> 'started_at';
  else
    v_walk_started := v_now::text;
  end if;

  -- Ordered primary-key chunks, never one array of every group.
  loop
    exit when clock_timestamp() - statement_timestamp() >= c_pass_budget;

    select array_agg(s.id order by s.id)
      into v_chunk_ids
    from (
      select sg.id
      from public.style_groups sg
      where v_after is null or sg.id > v_after
      order by sg.id
      limit c_chunk
    ) s;

    if v_chunk_ids is null then
      v_walk_done := true;
      exit;
    end if;

    v_written := v_written + coalesce(public.refresh_style_group_counts_batch(v_chunk_ids), 0);
    v_after   := v_chunk_ids[array_length(v_chunk_ids, 1)];
  end loop;

  -- Re-read under the same advisory lock before stamping. The reconcile above can run for
  -- a long time; writing back the object read before it would discard any concurrent
  -- change made by a writer that does not take this lock.
  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  if v_walk_done then
    v_marker := (v_marker - 'reconcile_walk') || jsonb_build_object(
      -- When the walk began, so a change during a multi-pass walk stays inside the floor.
      'last_reconciled_at',            v_walk_started,
      -- On a floor pass there is no completed run to attribute, so the previously
      -- reconciled run_id is carried forward unchanged. Overwriting it with the current
      -- (failed or interrupted) run would make ARM 2 skip that run once it finally
      -- succeeds.
      'last_reconciled_run_id',        case when v_reason = 'rebuild_completed'
                                            then to_jsonb(v_run_id)
                                            else coalesce(to_jsonb(v_last_run), 'null'::jsonb) end,
      'last_reconcile_reason',         v_reason,
      'last_reconcile_rows_written',   v_written,
      'last_reconcile_trigger_status', coalesce(v_status, 'unknown')
    );
  else
    v_marker := v_marker || jsonb_build_object('reconcile_walk', jsonb_build_object(
      'reason',         v_reason,
      'run_id',         v_run_id,
      'trigger_status', v_status,
      'op_seen_at',     v_op_seen_at,
      'after_id',       v_after,
      'rows_written',   v_written,
      'started_at',     v_walk_started
    ));
  end if;

  v_current := jsonb_set(v_current, array[c_marker], v_marker, true);

  -- Other callers of this queue serialize through the transaction-scoped BULK
  -- lock, which remains held during counts. Preserve a new pending run even if
  -- an external state writer does not use that lock.
  if v_current -> c_watermark ->> 'pending_run_id'
       is not distinct from v_watermark ->> 'pending_run_id' then
    v_current := jsonb_set(v_current, array[c_watermark], v_watermark, true);
  end if;
  insert into admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_current, now())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;
exception
  when query_canceled or assert_failure or others then
    if v_change_locked then
      perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
    end if;
    raise;
end;
$$;

-- FUNCTION public.rebuild_style_groups_batch(uuid, integer)
CREATE OR REPLACE FUNCTION public.rebuild_style_groups_batch(p_last_asset_id uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 500) RETURNS TABLE(next_cursor uuid, groups_created integer, assets_assigned integer, assets_ungrouped integer, done boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    SET lock_timeout TO '0'
    AS $$
DECLARE
  v_last_id uuid;
  v_groups_created int := 0;
  v_assets_assigned int := 0;
  v_ungrouped int := 0;
  v_done boolean;
BEGIN
  WITH asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM public.assets a
    WHERE a.is_deleted = false
      AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
    ORDER BY a.id
    LIMIT p_batch_size
  ),
  asset_skus AS (
    SELECT ab.*,
      public.style_group_key_for_sku(ab.relative_path) AS sku
    FROM asset_batch ab
  ),
  batch_stats AS (
    SELECT count(*)::int AS total_fetched,
           (SELECT s.id FROM asset_skus s ORDER BY s.id DESC LIMIT 1) AS last_id
    FROM asset_skus
  ),
  grouped_assets AS (
    SELECT * FROM asset_skus WHERE sku IS NOT NULL
  ),
  -- Issue #2408 change 2: the complementary half of the batch. These are the assets
  -- whose path no longer yields a SKU; if one still carries a style group, that group
  -- is stale and is resolving the wrong licensor for it in the DAM libraries.
  ungroupable_assets AS (
    SELECT id FROM asset_skus WHERE sku IS NULL
  ),
  sku_representatives AS (
    SELECT DISTINCT ON (sku)
      sku,
      relative_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM grouped_assets
    ORDER BY sku, id
  ),
  sku_with_folder AS (
    SELECT sr.*,
      (
        SELECT string_agg(seg, '/' ORDER BY ord)
        FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE ord <= (
          SELECT min(t2.ord)
          FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t2(seg, ord)
          WHERE t2.seg = sr.sku
        )
      ) AS folder_path
    FROM sku_representatives sr
  ),
  upserted_groups AS (
    INSERT INTO public.style_groups (
      sku, folder_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    )
    SELECT
      sku, COALESCE(folder_path, sku), COALESCE(is_licensed, false), licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM sku_with_folder
    ON CONFLICT (sku) DO UPDATE SET
      folder_path = COALESCE(EXCLUDED.folder_path, style_groups.folder_path),
      is_licensed = COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed),
      licensor_id = COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id),
      licensor_code = COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code),
      licensor_name = COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name),
      property_id = COALESCE(EXCLUDED.property_id, style_groups.property_id),
      property_code = COALESCE(EXCLUDED.property_code, style_groups.property_code),
      property_name = COALESCE(EXCLUDED.property_name, style_groups.property_name),
      product_category = COALESCE(EXCLUDED.product_category, style_groups.product_category),
      division_code = COALESCE(EXCLUDED.division_code, style_groups.division_code),
      division_name = COALESCE(EXCLUDED.division_name, style_groups.division_name),
      mg01_code = COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code),
      mg01_name = COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name),
      mg02_code = COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code),
      mg02_name = COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name),
      mg03_code = COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code),
      mg03_name = COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name),
      size_code = COALESCE(EXCLUDED.size_code, style_groups.size_code),
      size_name = COALESCE(EXCLUDED.size_name, style_groups.size_name),
      updated_at = now()
    -- Issue #2408 change 3: write the group only when the SET list would actually
    -- change one of its values. Derived mechanically from the SET list above, one
    -- clause per assigned column, in the same order. `updated_at` is intentionally
    -- absent - see the header.
    WHERE (
         style_groups.folder_path      IS DISTINCT FROM COALESCE(EXCLUDED.folder_path, style_groups.folder_path)
      OR style_groups.is_licensed      IS DISTINCT FROM COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed)
      OR style_groups.licensor_id      IS DISTINCT FROM COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id)
      OR style_groups.licensor_code    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code)
      OR style_groups.licensor_name    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name)
      OR style_groups.property_id      IS DISTINCT FROM COALESCE(EXCLUDED.property_id, style_groups.property_id)
      OR style_groups.property_code    IS DISTINCT FROM COALESCE(EXCLUDED.property_code, style_groups.property_code)
      OR style_groups.property_name    IS DISTINCT FROM COALESCE(EXCLUDED.property_name, style_groups.property_name)
      OR style_groups.product_category IS DISTINCT FROM COALESCE(EXCLUDED.product_category, style_groups.product_category)
      OR style_groups.division_code    IS DISTINCT FROM COALESCE(EXCLUDED.division_code, style_groups.division_code)
      OR style_groups.division_name    IS DISTINCT FROM COALESCE(EXCLUDED.division_name, style_groups.division_name)
      OR style_groups.mg01_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code)
      OR style_groups.mg01_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name)
      OR style_groups.mg02_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code)
      OR style_groups.mg02_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name)
      OR style_groups.mg03_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code)
      OR style_groups.mg03_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name)
      OR style_groups.size_code        IS DISTINCT FROM COALESCE(EXCLUDED.size_code, style_groups.size_code)
      OR style_groups.size_name        IS DISTINCT FROM COALESCE(EXCLUDED.size_name, style_groups.size_name)
    )
    RETURNING id, sku
  ),
  -- Issue #2408: the assignment target set. `upserted_groups` alone is NO LONGER a
  -- complete list of this batch's groups, because the WHERE guard above suppresses the
  -- RETURNING row for every group that did not need writing. Reading style_groups alone
  -- is not complete either: this statement's own INSERTs are invisible to a sibling
  -- CTE's snapshot. The UNION of the two is complete and duplicate-free - see header.
  batch_groups AS (
    SELECT ug.id, ug.sku FROM upserted_groups ug
    UNION
    SELECT sg.id, sg.sku
    FROM public.style_groups sg
    JOIN sku_with_folder swf ON swf.sku = sg.sku
  ),
  assigned AS (
    UPDATE public.assets a
    SET style_group_id = bg.id
    FROM grouped_assets ga
    JOIN batch_groups bg ON bg.sku = ga.sku
    WHERE a.id = ga.id
      -- Issue #2408 change 1: never re-stamp an asset that already holds this group.
      -- IS DISTINCT FROM, not `<>`: style_group_id is nullable and `<>` would return
      -- NULL for the NULL-to-value transition, silently skipping every new assignment.
      AND a.style_group_id IS DISTINCT FROM bg.id
    RETURNING 1
  ),
  -- Issue #2408 change 2: the ungroup arm. Disjoint from `assigned` by construction
  -- (sku IS NULL vs sku IS NOT NULL over the same asset_skus rows). The
  -- `style_group_id IS NOT NULL` guard keeps the ~37,593 legitimately ungrouped assets
  -- from being rewritten every night.
  ungrouped_assets AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM ungroupable_assets ua
    WHERE a.id = ua.id
      AND a.style_group_id IS NOT NULL
    RETURNING 1
  )
  SELECT
    (SELECT bs.last_id FROM batch_stats bs),
    (SELECT count(*)::int FROM upserted_groups),
    (SELECT count(*)::int FROM assigned),
    (SELECT count(*)::int FROM ungrouped_assets),
    (SELECT bs.total_fetched FROM batch_stats bs) < p_batch_size
  INTO v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, v_done;

  RETURN QUERY SELECT v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, COALESCE(v_done, true);
END;
$$;

-- FUNCTION public.rebuild_style_groups_batch(uuid, integer, timestamp with time zone)
CREATE OR REPLACE FUNCTION public.rebuild_style_groups_batch(p_last_asset_id uuid, p_batch_size integer, p_changed_since timestamp with time zone) RETURNS TABLE(next_cursor uuid, groups_created integer, assets_assigned integer, assets_ungrouped integer, done boolean, rows_examined integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    SET lock_timeout TO '0'
    AS $$
DECLARE
  v_last_id uuid;
  v_groups_created int := 0;
  v_assets_assigned int := 0;
  v_ungrouped int := 0;
  v_done boolean;
  v_examined int := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'a positive bounded batch size is required' USING ERRCODE = '22023';
  END IF;
  WITH changed_groups AS MATERIALIZED (
    SELECT id FROM public.style_groups
    WHERE p_changed_since IS NOT NULL AND style_group_changed_at > p_changed_since
  ), candidate_ids AS (
    -- The full arm uses the existing UUID primary key with an active filter.
    -- The changed-clock index filters changed rows; UUID ordering may sort that
    -- changed set. Changed-group cardinality is not capped by the output limit:
    -- mass edits can require many lateral probes and hit statement_timeout.
    -- The weekly full arm remains the convergence path after such a failed run.
    -- Each indexed arm contributes at most a batch; the global union deduplicates
    -- overlap before selecting the first batch in UUID order. No arm skips a
    -- candidate below the global cursor, even when membership overlaps clocks.
    SELECT id FROM (
      (SELECT a.id FROM public.assets a
       WHERE p_changed_since IS NULL AND a.is_deleted = false
         AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
       ORDER BY a.id LIMIT p_batch_size)
      UNION
      (SELECT a.id FROM public.assets a
       WHERE p_changed_since IS NOT NULL AND a.is_deleted = false
         AND a.style_group_id IS NULL
         AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
       ORDER BY a.id LIMIT p_batch_size)
      UNION
      (SELECT a.id FROM public.assets a
       WHERE p_changed_since IS NOT NULL AND a.is_deleted = false
         AND a.style_group_changed_at > p_changed_since
         AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
       ORDER BY a.id LIMIT p_batch_size)
      UNION
      (SELECT member.id FROM changed_groups sg
       CROSS JOIN LATERAL (
         SELECT a.id FROM public.assets a
         WHERE a.style_group_id = sg.id AND a.is_deleted = false
           AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
         ORDER BY a.id LIMIT p_batch_size
       ) member
       ORDER BY member.id LIMIT p_batch_size)
    ) candidates ORDER BY id LIMIT p_batch_size
  ),
  asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM candidate_ids selected
    CROSS JOIN LATERAL (SELECT a.* FROM public.assets a WHERE a.id = selected.id LIMIT 1) a
  ),
  asset_skus AS (
    SELECT ab.*,
      public.style_group_key_for_sku(ab.relative_path) AS sku
    FROM asset_batch ab
  ),
  batch_stats AS (
    SELECT count(*)::int AS total_fetched,
           (SELECT s.id FROM asset_skus s ORDER BY s.id DESC LIMIT 1) AS last_id
    FROM asset_skus
  ),
  grouped_assets AS (
    SELECT * FROM asset_skus WHERE sku IS NOT NULL
  ),
  -- Issue #2408 change 2: the complementary half of the batch. These are the assets
  -- whose path no longer yields a SKU; if one still carries a style group, that group
  -- is stale and is resolving the wrong licensor for it in the DAM libraries.
  ungroupable_assets AS (
    SELECT id FROM asset_skus WHERE sku IS NULL
  ),
  sku_representatives AS (
    SELECT DISTINCT ON (sku)
      sku,
      relative_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM grouped_assets
    ORDER BY sku, id
  ),
  sku_with_folder AS (
    SELECT sr.*,
      (
        SELECT string_agg(seg, '/' ORDER BY ord)
        FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE ord <= (
          SELECT min(t2.ord)
          FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t2(seg, ord)
          WHERE t2.seg = sr.sku
        )
      ) AS folder_path
    FROM sku_representatives sr
  ),
  upserted_groups AS (
    INSERT INTO public.style_groups (
      sku, folder_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    )
    SELECT
      sku, COALESCE(folder_path, sku), COALESCE(is_licensed, false), licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM sku_with_folder
    ON CONFLICT (sku) DO UPDATE SET
      folder_path = COALESCE(EXCLUDED.folder_path, style_groups.folder_path),
      is_licensed = COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed),
      licensor_id = COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id),
      licensor_code = COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code),
      licensor_name = COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name),
      property_id = COALESCE(EXCLUDED.property_id, style_groups.property_id),
      property_code = COALESCE(EXCLUDED.property_code, style_groups.property_code),
      property_name = COALESCE(EXCLUDED.property_name, style_groups.property_name),
      product_category = COALESCE(EXCLUDED.product_category, style_groups.product_category),
      division_code = COALESCE(EXCLUDED.division_code, style_groups.division_code),
      division_name = COALESCE(EXCLUDED.division_name, style_groups.division_name),
      mg01_code = COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code),
      mg01_name = COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name),
      mg02_code = COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code),
      mg02_name = COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name),
      mg03_code = COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code),
      mg03_name = COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name),
      size_code = COALESCE(EXCLUDED.size_code, style_groups.size_code),
      size_name = COALESCE(EXCLUDED.size_name, style_groups.size_name),
      updated_at = now()
    -- Issue #2408 change 3: write the group only when the SET list would actually
    -- change one of its values. Derived mechanically from the SET list above, one
    -- clause per assigned column, in the same order. `updated_at` is intentionally
    -- absent - see the header.
    WHERE (
         style_groups.folder_path      IS DISTINCT FROM COALESCE(EXCLUDED.folder_path, style_groups.folder_path)
      OR style_groups.is_licensed      IS DISTINCT FROM COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed)
      OR style_groups.licensor_id      IS DISTINCT FROM COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id)
      OR style_groups.licensor_code    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code)
      OR style_groups.licensor_name    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name)
      OR style_groups.property_id      IS DISTINCT FROM COALESCE(EXCLUDED.property_id, style_groups.property_id)
      OR style_groups.property_code    IS DISTINCT FROM COALESCE(EXCLUDED.property_code, style_groups.property_code)
      OR style_groups.property_name    IS DISTINCT FROM COALESCE(EXCLUDED.property_name, style_groups.property_name)
      OR style_groups.product_category IS DISTINCT FROM COALESCE(EXCLUDED.product_category, style_groups.product_category)
      OR style_groups.division_code    IS DISTINCT FROM COALESCE(EXCLUDED.division_code, style_groups.division_code)
      OR style_groups.division_name    IS DISTINCT FROM COALESCE(EXCLUDED.division_name, style_groups.division_name)
      OR style_groups.mg01_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code)
      OR style_groups.mg01_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name)
      OR style_groups.mg02_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code)
      OR style_groups.mg02_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name)
      OR style_groups.mg03_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code)
      OR style_groups.mg03_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name)
      OR style_groups.size_code        IS DISTINCT FROM COALESCE(EXCLUDED.size_code, style_groups.size_code)
      OR style_groups.size_name        IS DISTINCT FROM COALESCE(EXCLUDED.size_name, style_groups.size_name)
    )
    RETURNING id, sku
  ),
  -- Issue #2408: the assignment target set. `upserted_groups` alone is NO LONGER a
  -- complete list of this batch's groups, because the WHERE guard above suppresses the
  -- RETURNING row for every group that did not need writing. Reading style_groups alone
  -- is not complete either: this statement's own INSERTs are invisible to a sibling
  -- CTE's snapshot. The UNION of the two is complete and duplicate-free - see header.
  batch_groups AS (
    SELECT ug.id, ug.sku FROM upserted_groups ug
    UNION
    SELECT sg.id, sg.sku
    FROM public.style_groups sg
    JOIN sku_with_folder swf ON swf.sku = sg.sku
  ),
  assigned AS (
    UPDATE public.assets a
    SET style_group_id = bg.id
    FROM grouped_assets ga
    JOIN batch_groups bg ON bg.sku = ga.sku
    WHERE a.id = ga.id
      -- Issue #2408 change 1: never re-stamp an asset that already holds this group.
      -- IS DISTINCT FROM, not `<>`: style_group_id is nullable and `<>` would return
      -- NULL for the NULL-to-value transition, silently skipping every new assignment.
      AND a.style_group_id IS DISTINCT FROM bg.id
    RETURNING 1
  ),
  -- Issue #2408 change 2: the ungroup arm. Disjoint from `assigned` by construction
  -- (sku IS NULL vs sku IS NOT NULL over the same asset_skus rows). The
  -- `style_group_id IS NOT NULL` guard keeps the ~37,593 legitimately ungrouped assets
  -- from being rewritten every night.
  ungrouped_assets AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM ungroupable_assets ua
    WHERE a.id = ua.id
      AND a.style_group_id IS NOT NULL
    RETURNING 1
  )
  SELECT
    (SELECT bs.last_id FROM batch_stats bs),
    (SELECT count(*)::int FROM upserted_groups),
    (SELECT count(*)::int FROM assigned),
    (SELECT count(*)::int FROM ungrouped_assets),
    (SELECT bs.total_fetched FROM batch_stats bs) < p_batch_size,
    (SELECT bs.total_fetched FROM batch_stats bs)
  INTO v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, v_done, v_examined;

  -- rows_examined is selected candidate cardinality, summed across batches by
  -- the worker. It is not physical index/heap I/O; measure that with EXPLAIN.
  RETURN QUERY SELECT v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, COALESCE(v_done, true), v_examined;
END;
$$;

-- FUNCTION public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric)
CREATE OR REPLACE FUNCTION public.reconcile_stale_sg_files_batch(p_root_label text, p_run_id uuid, p_batch_size integer DEFAULT 5000, p_min_ratio numeric DEFAULT 0.5) RETURNS TABLE(deactivated integer, remaining bigint, done boolean, guard_state text, guard_reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_preview record;
  -- #2792: at most 500 rows are written per call so every call stays well
  -- under the 8s statement ceiling. Larger requests continue via done=false.
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 500), 500));
  v_deactivated integer := 0;
  v_remaining bigint;
  v_ids uuid[] := array[]::uuid[];
  v_run_exists boolean := false;
  v_found integer;
  v_inaccessible boolean;
  v_start_stale integer;
  v_start_active integer;
  v_ratio numeric := coalesce(p_min_ratio, 0.5);
  v_stale bigint;
  v_active bigint;
  v_need bigint;
  v_run_seen bigint;
  v_fast_ok boolean := false;
begin
  -- Serialize every reconciliation of a single root (two half-root runs must
  -- never each treat the other's rows as stale). Transaction-scoped.
  perform pg_advisory_xact_lock(hashtext(p_root_label));

  -- popdam3#804: the run stamp is read from style_guide_file_crawl_seen, which
  -- holds one row per active file (trigger-maintained). Three stale index
  -- ranges of idx_sg_file_crawl_seen_root_run; the run's own rows are skipped.
  select (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id < p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id > p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id is null)
    into v_stale;

  select true, r.files_found,
         coalesce(p_root_label = any (coalesce(r.inaccessible_roots, array[]::text[])), false),
         r.stale_candidates_at_start, r.active_before_reconcile
    into v_run_exists, v_found, v_inaccessible, v_start_stale, v_start_active
    from public.style_guide_crawl_runs r
   where r.id = p_run_id;

  -- Fast guard (#2792), used only once this run's start counters exist.
  if coalesce(v_run_exists, false)
     and not coalesce(v_inaccessible, false)
     and coalesce(v_found, 0) > 0
     and v_ratio < 1
     and v_start_stale is not null
     and v_start_active is not null then
    v_need := greatest(1, ceil(v_ratio * v_stale / (1 - v_ratio)))::bigint;
    select count(*) into v_run_seen
      from (select 1
              from public.style_guide_file_crawl_seen s
             where s.root_label = p_root_label
               and s.crawl_run_id = p_run_id
             limit v_need) x;
    v_fast_ok := (v_run_seen >= v_need);
  end if;

  if not v_fast_ok then
    select * into v_preview
      from public.preview_stale_sg_files(p_root_label, p_run_id, p_min_ratio);

    if not v_preview.safe_to_reconcile then
      -- NO row is inactivated. The run is parked for a human.
      update public.style_guide_crawl_runs
         set lifecycle_state = 'attention_required',
             guard_state = v_preview.guard_state,
             guard_reason = v_preview.guard_reason,
             attention_reason = v_preview.guard_reason,
             accepted_for_reconcile = false
       where id = p_run_id;

      deactivated  := 0;
      remaining    := v_preview.stale_candidates;
      done         := false;
      guard_state  := v_preview.guard_state;
      guard_reason := v_preview.guard_reason;
      return next;
      return;
    end if;

    v_stale  := v_preview.stale_candidates;
    v_active := v_preview.active_total;
  end if;

  update public.style_guide_crawl_runs
     set lifecycle_state = case when lifecycle_state in ('completed','failed')
                                then lifecycle_state else 'reconciling' end,
         accepted_for_reconcile = true,
         guard_state = 'ok',
         guard_reason = null,
         attention_reason = null,
         reconcile_started_at = coalesce(reconcile_started_at, now()),
         stale_candidates_at_start = coalesce(stale_candidates_at_start, v_stale::integer),
         active_before_reconcile = coalesce(active_before_reconcile, v_active::integer)
   where id = p_run_id;

  -- Bounded in rows read and written: three ordered range scans, overall order
  -- (crawl_run_id asc nulls last, id); an interrupted run resumes in place.
  select coalesce(array_agg(x.id), array[]::uuid[])
    into v_ids
    from (select s.style_guide_file_id as id
            from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label
             and s.crawl_run_id < p_run_id
           order by s.crawl_run_id, s.style_guide_file_id
           limit v_batch
             for update of s skip locked) x;

  if cardinality(v_ids) < v_batch then
    select v_ids || coalesce(array_agg(x.id), array[]::uuid[])
      into v_ids
      from (select s.style_guide_file_id as id
              from public.style_guide_file_crawl_seen s
             where s.root_label = p_root_label
               and s.crawl_run_id > p_run_id
             order by s.crawl_run_id, s.style_guide_file_id
             limit v_batch - cardinality(v_ids)
               for update of s skip locked) x;
  end if;

  if cardinality(v_ids) < v_batch then
    select v_ids || coalesce(array_agg(x.id), array[]::uuid[])
      into v_ids
      from (select s.style_guide_file_id as id
              from public.style_guide_file_crawl_seen s
             where s.root_label = p_root_label
               and s.crawl_run_id is null
             order by s.style_guide_file_id
             limit v_batch - cardinality(v_ids)
               for update of s skip locked) x;
  end if;

  -- Deactivating a file removes its side-table row through the trigger.
  with deactivated_rows as (
    update public.style_guide_files f
       set is_active = false
     where f.id = any (v_ids)
       and f.is_active
     returning f.id
  ), document_rows as (
    update public.style_guide_search_documents d
       set is_active = false,
           document_updated_at = now()
      from deactivated_rows dr
     where d.style_guide_file_id = dr.id
     returning d.style_guide_file_id
  )
  select count(*)::integer into v_deactivated from deactivated_rows;

  -- A selected side-table row whose file was already inactive is stale
  -- bookkeeping; drop it so it is never selected again.
  delete from public.style_guide_file_crawl_seen s
   where s.style_guide_file_id = any (v_ids)
     and not exists (select 1 from public.style_guide_files f
                      where f.id = s.style_guide_file_id and f.is_active);

  select (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id < p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id > p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id is null)
    into v_remaining;

  update public.style_guide_crawl_runs
     set files_deactivated = files_deactivated + v_deactivated,
         reconcile_batches = reconcile_batches + 1,
         stale_remaining = v_remaining::integer,
         reconcile_completed_at = case when v_remaining = 0 then coalesce(reconcile_completed_at, now())
                                       else reconcile_completed_at end
   where id = p_run_id;

  deactivated  := v_deactivated;
  remaining    := v_remaining;
  done         := (v_remaining = 0);
  guard_state  := 'ok';
  guard_reason := null;
  return next;
end;
$$;

-- FUNCTION public.reconcile_style_group_drift(integer)
CREATE OR REPLACE FUNCTION public.reconcile_style_group_drift(p_effective_tag_sample integer DEFAULT 5000) RETURNS TABLE(observed_at timestamp with time zone, live_assets bigint, grouped_assets bigint, ungrouped_assets bigint, style_group_rows bigint, effective_tag_rows bigint, assets_missing_or_wrong_group bigint, assets_with_unexpected_group bigint, orphan_group_references bigint, effective_tag_sample_assets bigint, effective_tag_missing_rows bigint, effective_tag_extra_rows bigint, effective_tag_drifted_assets bigint, effective_tag_drift_rate numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET statement_timeout TO '600s'
    SET lock_timeout TO '5s'
    AS $$
with live as (
  select
    a.id,
    a.style_group_id,
    -- Shared with the rebuild; the detector never repairs rows.
    public.style_group_key_for_sku(a.relative_path) AS sku
  from public.assets a
  where a.is_deleted = false
),
resolved as (
  select
    l.id,
    l.style_group_id,
    l.sku,
    expected.id as expected_group_id,
    (held.id is not null) as held_group_exists
  from live l
  -- The group the SKU rule says this asset belongs in. NULL when the path yields no
  -- SKU, and also NULL when it yields one for which no style_groups row exists yet.
  left join public.style_groups expected on expected.sku = l.sku
  -- The group the asset actually points at. A NULL here with a non-null
  -- style_group_id is an orphan reference.
  left join public.style_groups held on held.id = l.style_group_id
),
group_drift as (
  select
    count(*) as live_assets,
    count(*) filter (where style_group_id is not null) as grouped_assets,
    count(*) filter (where style_group_id is null) as ungrouped_assets,
    -- 1a. Should be grouped; is not, or is in the wrong group. `expected_group_id is
    -- null` is included on purpose: a SKU with no style_groups row is an asset the
    -- rebuild would group on its next pass, so it is drift now.
    count(*) filter (
      where sku is not null
        and (expected_group_id is null or style_group_id is distinct from expected_group_id)
    ) as assets_missing_or_wrong_group,
    -- 1b. Carries a group but should not.
    count(*) filter (where sku is null and style_group_id is not null)
      as assets_with_unexpected_group,
    -- 2. Points at a style_groups row that does not exist.
    count(*) filter (where style_group_id is not null and not held_group_exists)
      as orphan_group_references
  from resolved
),
tag_sample as (
  select r.id, r.style_group_id
  from resolved r
  order by random()
  limit greatest(coalesce(p_effective_tag_sample, 0), 0)
),
desired_tags as (
  select s.id as asset_id, t.tag, 'asset'::text as scope
  from tag_sample s
  join public.asset_tags t
    on t.asset_id = s.id
   and t.status = 'active'
  union
  select s.id, gt.tag, 'style_group'::text
  from tag_sample s
  join public.style_group_tags gt
    on gt.style_group_id = s.style_group_id
   and gt.status = 'active'
),
actual_tags as (
  select e.asset_id, e.tag, e.scope
  from tag_sample s
  join public.asset_effective_tags e on e.asset_id = s.id
),
missing_tags as (
  select asset_id, tag, scope from desired_tags
  except
  select asset_id, tag, scope from actual_tags
),
extra_tags as (
  select asset_id, tag, scope from actual_tags
  except
  select asset_id, tag, scope from desired_tags
),
tag_drift as (
  select
    (select count(*) from tag_sample) as sample_assets,
    (select count(*) from missing_tags) as missing_rows,
    (select count(*) from extra_tags) as extra_rows,
    (
      select count(*)
      from (
        select asset_id from missing_tags
        union
        select asset_id from extra_tags
      ) drifted
    ) as drifted_assets
)
select
  now(),
  g.live_assets,
  g.grouped_assets,
  g.ungrouped_assets,
  (select count(*) from public.style_groups),
  (select count(*) from public.asset_effective_tags),
  g.assets_missing_or_wrong_group,
  g.assets_with_unexpected_group,
  g.orphan_group_references,
  t.sample_assets,
  t.missing_rows,
  t.extra_rows,
  t.drifted_assets,
  case
    when t.sample_assets = 0 then null
    else round(t.drifted_assets::numeric / t.sample_assets::numeric, 6)
  end
from group_drift g
cross join tag_drift t;
$$;

-- FUNCTION public.refresh_dam_search_after_render_completion()
CREATE OR REPLACE FUNCTION public.refresh_dam_search_after_render_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_group uuid;
begin
  if new.status='completed' and new.completed_at is not null
     and (old.status is distinct from new.status or old.completed_at is distinct from new.completed_at) then
    perform public.refresh_dam_search_asset_document(new.asset_id);
    select style_group_id into v_group from public.assets where id=new.asset_id;
    if v_group is not null then perform public.refresh_dam_search_style_group_document(v_group); end if;
  end if;
  return new;
end $$;

-- FUNCTION public.refresh_dam_search_after_source_size_change()
CREATE OR REPLACE FUNCTION public.refresh_dam_search_after_source_size_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_group uuid; v_previous text;
begin
  -- Scope legacy invalidation to this genuine source-size revision. Preserve
  -- outer trigger context for nested writes; this marker is never authority.
  v_previous:=current_setting('dam.search_image_size_changed_asset',true);
  perform set_config('dam.search_image_size_changed_asset',new.id::text,true);
  begin
    perform public.refresh_dam_search_asset_document(new.id);
    v_group:=new.style_group_id;
    if v_group is not null then perform public.refresh_dam_search_style_group_document(v_group); end if;
  exception when others then
    perform set_config('dam.search_image_size_changed_asset',coalesce(v_previous,''),true);
    raise;
  end;
  perform set_config('dam.search_image_size_changed_asset',coalesce(v_previous,''),true);
  return new;
end $$;

-- FUNCTION public.refresh_dam_search_asset_document(uuid)
CREATE OR REPLACE FUNCTION public.refresh_dam_search_asset_document(p_asset_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam', 'extensions'
    AS $$
declare v_text text; v_hash text; v_input jsonb; v_old_group uuid; v_new_group uuid;
begin
  select style_group_id into v_old_group from public.dam_search_documents
  where document_type='asset' and entity_id=p_asset_id;
  if not exists (select 1 from public.assets where id=p_asset_id and is_deleted=false) then
    delete from public.dam_search_documents where document_type='asset' and entity_id=p_asset_id;
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    return;
  end if;
  select coalesce(concat_ws(' ', a.filename,a.relative_path,a.content_type,sg.item_description,
    sg.group_ai_description,a.cover_description,a.ai_description,a.scene_description,a.customer,a.program,
    case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
    case when a.style_group_id is null then a.property_name else sg.property_name end,
    a.product_category,array_to_string(a.product_material,' '),a.product_dimensions,
    dam.jsonb_leaf_text(sg.rich_metadata),pdf.txt,atg.tags,gtg.tags,chars.names), '')
  into v_text
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id
  left join lateral (select string_agg(p.extracted_text,' ' order by p.sampled_at desc) txt
    from public.pdf_text_samples p where p.asset_id=a.id and p.extracted_text is not null) pdf on true
  left join lateral (select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags
    from public.asset_tags t where t.asset_id=a.id and t.status='active') atg on true
  left join lateral (select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags
    from public.style_group_tags t where t.style_group_id=a.style_group_id and t.status='active') gtg on true
  left join lateral (select string_agg(c.name,' ' order by lower(c.name),c.id) names
    from (select c.id,c.name from public.asset_characters ac join public.characters c on c.id=ac.character_id where ac.asset_id=a.id
      union all select lc.id,lc.name from public.asset_licensor_characters alc join core.character lc on lc.id=alc.character_id
      where alc.asset_id=a.id) c) chars on true
  where a.id=p_asset_id;
  v_hash := encode(digest(v_text,'sha256'),'hex');
  select dam.search_embedding_image_provenance(a.id,a.thumbnail_url,d.metadata->'_embedding_input') into v_input
  from public.assets a left join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id where a.id=p_asset_id;
  insert into public.dam_search_documents(document_type,entity_id,asset_id,style_group_id,title,path,customer,program,
    search_text,content_sha256,metadata,source_updated_at,indexed_at)
  select 'asset',a.id,a.id,a.style_group_id,coalesce(a.filename,''),coalesce(a.relative_path,''),a.customer,a.program,
    v_text,v_hash,jsonb_strip_nulls(jsonb_build_object('file_type',a.file_type,'asset_type',a.asset_type,
      'content_type',a.content_type,'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
      'product_material',a.product_material,'product_dimensions',a.product_dimensions,'workflow_status',a.workflow_status,
      'is_licensed',a.is_licensed,'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
      'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
      'product_category',a.product_category,'thumbnail_url',a.thumbnail_url,'_embedding_input',v_input)),
    greatest(coalesce(a.updated_at,'-infinity'),coalesce(a.modified_at,'-infinity')),now()
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id where a.id=p_asset_id and not a.is_deleted
  on conflict(document_type,entity_id) do update set asset_id=excluded.asset_id,style_group_id=excluded.style_group_id,
    title=excluded.title,path=excluded.path,customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,
    content_sha256=excluded.content_sha256,metadata=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) and dam_search_documents.embedding_lease_token is not null then excluded.metadata||jsonb_build_object('_embedding_lease_input_sha256',coalesce(dam_search_documents.metadata->>'_embedding_lease_input_sha256',dam_search_documents.content_sha256)) else excluded.metadata end,source_updated_at=excluded.source_updated_at,indexed_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.indexed_at else now() end,
    embedding=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding end,
    embedding_model=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_model end,
    embedding_updated_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_updated_at end,
    embedding_error=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_token end,embedding_lease_owner=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_owner end,embedding_lease_expires_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_expires_at end,embedding_next_retry_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_next_retry_at end
  where row(dam_search_documents.asset_id,dam_search_documents.style_group_id,dam_search_documents.title,dam_search_documents.path,dam_search_documents.customer,dam_search_documents.program,dam_search_documents.search_text,dam_search_documents.content_sha256,dam_search_documents.metadata-'_embedding_lease_input_sha256')
    is distinct from row(excluded.asset_id,excluded.style_group_id,excluded.title,excluded.path,excluded.customer,excluded.program,excluded.search_text,excluded.content_sha256,excluded.metadata)
    or dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) is not true;
  select style_group_id into v_new_group from public.assets where id=p_asset_id;
  if v_old_group is distinct from v_new_group then
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    if v_new_group is not null then perform public.refresh_dam_search_style_group_document(v_new_group); end if;
  end if;
end $$;

-- FUNCTION public.refresh_dam_search_documents_batch(uuid[], uuid[], integer)
CREATE OR REPLACE FUNCTION public.refresh_dam_search_documents_batch(p_asset_ids uuid[] DEFAULT '{}'::uuid[], p_style_group_ids uuid[] DEFAULT '{}'::uuid[], p_limit integer DEFAULT 500) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid; v_a int:=0; v_g int:=0; v_budget int:=greatest(1,coalesce(p_limit,500));
begin
  for v_id in select distinct x from unnest(coalesce(p_asset_ids,'{}')) x order by x limit v_budget loop
    perform public.refresh_dam_search_asset_document(v_id); v_a:=v_a+1;
  end loop;
  for v_id in select distinct x from unnest(coalesce(p_style_group_ids,'{}')) x order by x limit v_budget loop
    perform public.refresh_dam_search_style_group_document(v_id); v_g:=v_g+1;
  end loop;
  return jsonb_build_object('asset_documents',v_a,'style_group_documents',v_g,'bounded_limit',v_budget);
end $$;

-- FUNCTION public.refresh_dam_search_style_group_document(uuid)
CREATE OR REPLACE FUNCTION public.refresh_dam_search_style_group_document(p_style_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam', 'extensions'
    AS $$
declare v_text text; v_hash text; v_input jsonb;
begin
  if not exists(select 1 from public.style_groups where id=p_style_group_id) then
    delete from public.dam_search_documents where document_type='style_group' and entity_id=p_style_group_id; return;
  end if;
  select coalesce(concat_ws(' ',sg.sku,sg.folder_path,sg.cover_description,sg.item_description,sg.group_ai_description,
    dam.jsonb_leaf_text(sg.rich_metadata),sg.customer,sg.program,sg.licensor_name,sg.property_name,sg.product_category,
    sg.division_name,sg.mg01_name,sg.mg02_name,sg.mg03_name,sg.size_name,gtg.tags,chars.names),'') into v_text
  from public.style_groups sg
  left join lateral(select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags from public.style_group_tags t
    where t.style_group_id=sg.id and t.status='active') gtg on true
  left join lateral(select string_agg(c.name,' ' order by lower(c.name),c.id) names from (select c.id,c.name from public.assets a
    join public.asset_characters ac on ac.asset_id=a.id join public.characters c on c.id=ac.character_id
    where a.style_group_id=sg.id and not a.is_deleted
    union all select lc.id,lc.name from public.assets a
    join public.asset_licensor_characters alc on alc.asset_id=a.id join core.character lc on lc.id=alc.character_id
    where a.style_group_id=sg.id and not a.is_deleted) c) chars on true where sg.id=p_style_group_id;
  v_hash:=encode(digest(v_text,'sha256'),'hex');
  select dam.search_embedding_image_provenance(sg.primary_asset_id,sg.primary_thumbnail_url,d.metadata->'_embedding_input') into v_input
  from public.style_groups sg left join public.dam_search_documents d on d.document_type='style_group' and d.entity_id=sg.id where sg.id=p_style_group_id;
  insert into public.dam_search_documents(document_type,entity_id,style_group_id,title,path,customer,program,search_text,
    content_sha256,metadata,source_updated_at,indexed_at,embedding,embedding_model,embedding_updated_at)
  select 'style_group',sg.id,sg.id,coalesce(sg.sku,''),coalesce(sg.folder_path,''),sg.customer,sg.program,v_text,v_hash,
    jsonb_strip_nulls(jsonb_build_object('asset_count',sg.asset_count,'workflow_status',sg.workflow_status,
      'is_licensed',sg.is_licensed,'licensor_name',sg.licensor_name,'property_name',sg.property_name,
      'product_category',sg.product_category,'item_description_source',sg.item_description_source,
      'group_ai_description_source',sg.group_ai_description_source,'group_ai_description_model',sg.group_ai_description_model,
      'rich_metadata_source',sg.rich_metadata_source,'thumbnail_url',sg.primary_thumbnail_url,'_embedding_input',v_input)),
    greatest(coalesce(sg.updated_at,'-infinity'),coalesce(sg.latest_file_date,'-infinity')),now(),
    case when reuse.ok then ad.embedding end,case when reuse.ok then ad.embedding_model end,case when reuse.ok then ad.embedding_updated_at end
  from public.style_groups sg
  left join public.dam_search_documents ad on ad.document_type='asset' and ad.entity_id=sg.primary_asset_id
  left join lateral(select ad.embedding is not null and ad.embedding_model='google/siglip2-base-patch16-naflex' and v_input is not null
    and dam.search_embedding_inputs_match(ad.metadata,jsonb_build_object('thumbnail_url',sg.primary_thumbnail_url,'_embedding_input',v_input),
      ad.content_sha256,v_hash,ad.embedding_model,ad.embedding_updated_at,ad.indexed_at) ok) reuse on true
  where sg.id=p_style_group_id
  on conflict(document_type,entity_id) do update set style_group_id=excluded.style_group_id,title=excluded.title,path=excluded.path,
    customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,content_sha256=excluded.content_sha256,
    metadata=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) and dam_search_documents.embedding_lease_token is not null then excluded.metadata||jsonb_build_object('_embedding_lease_input_sha256',coalesce(dam_search_documents.metadata->>'_embedding_lease_input_sha256',dam_search_documents.content_sha256)) else excluded.metadata end,source_updated_at=excluded.source_updated_at,indexed_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.indexed_at else now() end,
    embedding=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding else excluded.embedding end,
    embedding_model=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_model else excluded.embedding_model end,
    embedding_updated_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_updated_at else excluded.embedding_updated_at end,
    embedding_error=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_token end,embedding_lease_owner=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_owner end,embedding_lease_expires_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_lease_expires_at end,embedding_next_retry_at=case when dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) then dam_search_documents.embedding_next_retry_at end
  where row(dam_search_documents.style_group_id,dam_search_documents.title,dam_search_documents.path,dam_search_documents.customer,dam_search_documents.program,dam_search_documents.search_text,dam_search_documents.content_sha256,dam_search_documents.metadata-'_embedding_lease_input_sha256')
    is distinct from row(excluded.style_group_id,excluded.title,excluded.path,excluded.customer,excluded.program,excluded.search_text,excluded.content_sha256,excluded.metadata)
    or dam.search_embedding_inputs_match(dam_search_documents.metadata,excluded.metadata,dam_search_documents.content_sha256,excluded.content_sha256,dam_search_documents.embedding_model,dam_search_documents.embedding_updated_at,dam_search_documents.indexed_at) is not true;
end $$;

-- FUNCTION public.refresh_sku_human_description()
CREATE OR REPLACE FUNCTION public.refresh_sku_human_description() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam'
    AS $$
declare
  v_row_count bigint;
  v_current   jsonb;
  v_status    text;
  v_now       timestamptz := now();
  v_can_enqueue boolean;
begin
  -- Ask for the BULK_OPERATIONS advisory lock FIRST and never wait for it.
  -- queue_nightly_rebuild_style_groups holds it while updating style_groups, so
  -- waiting for it after taking our own style_groups row locks would invert lock
  -- order, and waiting for it up front would stall this refresh behind that
  -- reconcile. If it is busy, the refresh still runs and only the enqueue is
  -- skipped; the next night enqueues while short descriptions remain stale.
  v_can_enqueue := pg_try_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  truncate table dam.sku_human_description;

  -- Item Master (ColdLion) first; the Google Sheet import only fills SKUs the
  -- Item Master has no description for.
  insert into dam.sku_human_description (
    sku, description, tracker_type, source_row_id, source_updated_at, refreshed_at
  )
  select distinct on (upper(trim(i.item_number)))
    trim(i.item_number),
    trim(i.description),
    'coldlion',
    i.id,
    i.updated_at,
    v_now
  from plm.item i
  where i.item_number is not null
    and length(trim(i.item_number)) > 0
    and i.description is not null
    and length(trim(i.description)) > 0
  order by upper(trim(i.item_number)), i.updated_at desc nulls last, i.id;

  insert into dam.sku_human_description (
    sku, description, tracker_type, source_row_id, source_updated_at, refreshed_at
  )
  select distinct on (upper(trim(r.sku)))
    trim(r.sku),
    trim(r.description),
    r.tracker_type,
    r.id,
    r.updated_at,
    v_now
  from public.style_tracker_rows r
  where r.sku is not null
    and length(trim(r.sku)) > 0
    and r.description is not null
    and length(trim(r.description)) > 0
    and not exists (
      select 1 from dam.sku_human_description d where upper(d.sku) = upper(trim(r.sku))
    )
  order by upper(trim(r.sku)), r.updated_at desc nulls last, r.id;

  select count(*) into v_row_count from dam.sku_human_description;

  update public.style_groups sg
  set item_description = d.description,
      item_description_source = case when d.tracker_type = 'coldlion' then 'coldlion' else 'master_data' end
  from dam.sku_human_description d
  where upper(trim(sg.sku)) = upper(d.sku)
    and (sg.item_description is null or sg.item_description_source in ('master_data', 'coldlion'))
    and (sg.item_description, sg.item_description_source)
        is distinct from (d.description, case when d.tracker_type = 'coldlion' then 'coldlion' else 'master_data' end);

  -- Hand stale short descriptions to the PopDAM worker.
  if v_can_enqueue and exists (
    select 1 from public.style_groups sg
    where sg.item_description_source = 'coldlion'
      and sg.item_description is not null
      and coalesce(sg.item_short_description_source, '') <> 'manual'
      and sg.item_short_description_input is distinct from sg.item_description
  ) then
    select value into v_current from public.admin_config where key = 'BULK_OPERATIONS';
    v_current := coalesce(v_current, '{}'::jsonb);
    v_status := v_current -> 'shorten-item-descriptions' ->> 'status';
    if coalesce(v_status, '') not in ('queued', 'running') then
      v_current := jsonb_set(
        v_current,
        array['shorten-item-descriptions'],
        jsonb_build_object(
          'status',         'queued',
          'cursor',         0,
          'params',         '{}'::jsonb,
          'started_at',     v_now::text,
          'updated_at',     v_now::text,
          'progress',       '{}'::jsonb,
          'run_id',         gen_random_uuid()::text,
          'queue_position', (extract(epoch from v_now) * 1000)::bigint,
          'requested_by',   'pg_cron'
        ),
        true
      );
      insert into public.admin_config (key, value, updated_at)
      values ('BULK_OPERATIONS', v_current, v_now)
      on conflict (key) do update
        set value = excluded.value, updated_at = excluded.updated_at;
    end if;
  end if;

  return v_row_count;
end;
$$;

-- FUNCTION public.refresh_style_group_counts_batch(uuid[])
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[]) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '30s'
    SET lock_timeout TO '0'
    AS $$
  WITH agg AS (
    SELECT
      sg.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id
      AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      -- Clear primary fields for empty groups so they disappear from the library
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
      -- Issue #2214: write only rows whose stored values actually differ from the
      -- recomputed aggregate. See the header for why removing `updated_at = now()`
      -- instead would achieve nothing.
      AND (
           sg.asset_count      IS DISTINCT FROM agg.asset_count
        OR sg.latest_file_date IS DISTINCT FROM agg.latest_file_date
        OR (agg.asset_count = 0
            AND (   sg.primary_asset_id        IS NOT NULL
                 OR sg.primary_asset_type      IS NOT NULL
                 OR sg.primary_thumbnail_url   IS NOT NULL
                 OR sg.primary_thumbnail_error IS NOT NULL))
      )
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

-- FUNCTION public.refresh_style_group_counts_serialized(uuid[])
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_serialized(p_group_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '15s'
    SET lock_timeout TO '5s'
    AS $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(distinct g order by g), '{}'::uuid[])
    into v_ids
  from unnest(p_group_ids) as g
  where g is not null;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  return coalesce(public.refresh_style_group_counts_batch(v_ids), 0);
end;
$$;

-- FUNCTION public.refresh_style_guide_library_default_snapshot()
CREATE OR REPLACE FUNCTION public.refresh_style_guide_library_default_snapshot() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_primary text := public.style_guide_refresh_source_signature(
    array['public.style_guide_files', 'public.style_guide_render_queue']::regclass[]);
  v_documents text := public.style_guide_refresh_source_signature(
    array['public.style_guide_search_documents']::regclass[]);
  v_state jsonb;
  v_last timestamptz;
begin
  select a.value -> 'library-default-snapshot' into v_state
    from public.admin_config a where a.key = 'STYLE_GUIDE_REFRESH_STATE';
  v_last := (v_state ->> 'refreshed_at')::timestamptz;

  if v_last is not null
     and v_state ->> 'primary_signature' = v_primary
     and (v_state ->> 'documents_signature' = v_documents
          or v_last >= now() - interval '1 hour') then
    return;
  end if;

  refresh materialized view concurrently public.style_guide_library_default_guides;
  refresh materialized view concurrently public.style_guide_library_default_summary;

  insert into public.admin_config as a (key, value, updated_at)
  values ('STYLE_GUIDE_REFRESH_STATE',
          jsonb_build_object('library-default-snapshot', jsonb_build_object(
            'refreshed_at', now(), 'primary_signature', v_primary,
            'documents_signature', v_documents)),
          now())
  on conflict (key) do update
    set value = a.value || excluded.value, updated_at = excluded.updated_at;
end
$$;

-- FUNCTION public.refresh_style_guide_matviews(uuid, integer)
CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews(p_run_id uuid DEFAULT NULL::uuid, p_search_batch_size integer DEFAULT 5000) RETURNS TABLE(refreshed_at timestamp with time zone, search_documents_synced integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- #4437 review round 2, B1: the scheduler's no-argument command lands here.
  -- Delegating to the stepping overload with p_step 'all' reproduces the
  -- historical two-argument behavior (both matviews concurrently, then the
  -- bounded search-document sync and run stamping) while carrying the
  -- content_sha256 maintenance and embedding invalidation everywhere.
  return query
  select * from public.refresh_style_guide_matviews(
    p_run_id => p_run_id,
    p_search_batch_size => p_search_batch_size,
    p_step => 'all');
end;
$$;

-- FUNCTION public.refresh_style_guide_matviews(uuid, integer, text)
CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size integer, p_step text) RETURNS TABLE(refreshed_at timestamp with time zone, search_documents_synced integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_batch integer := greatest(0, least(coalesce(p_search_batch_size, 5000), 50000));
  v_synced integer := 0;
  v_now timestamptz;
  v_started timestamptz := clock_timestamp();
  v_step text := coalesce(p_step, '');
begin
  if v_step not in ('all', 'file_groups', 'folders', 'search') then
    raise exception
      'refresh_style_guide_matviews: unknown p_step %, expected all|file_groups|folders|search',
      p_step;
  end if;

  if p_run_id is not null then
    update public.style_guide_crawl_runs
       set lifecycle_state = case when lifecycle_state in ('completed','failed','attention_required')
                                  then lifecycle_state else 'refreshing' end,
           refresh_started_at = coalesce(refresh_started_at, now())
     where id = p_run_id;
  end if;

  if v_step in ('all', 'file_groups') then
    refresh materialized view concurrently public.style_guide_file_groups;
  end if;

  if v_step in ('all', 'folders') then
    refresh materialized view concurrently public.style_guide_folders;
  end if;

  if v_step in ('all', 'search') and v_batch > 0 then
    with candidates as (
      select f.id,
             f.root_label,
             f.licensor_name,
             f.property_folder,
             f.style_guide_folder,
             coalesce(nullif(f.style_guide_folder, ''), nullif(f.property_folder, ''),
                      f.licensor_name, 'Unfiled') as style_guide_name,
             f.directory_path,
             f.relative_path,
             f.filename,
             f.file_extension,
             f.tag_names,
             f.size_bytes,
             f.modified_at,
             f.thumbnail_url,
             f.is_active,
             md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                 coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                 coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                 coalesce(f.licensor_name, '') || '|' || f.is_active::text) as source_identity
        from public.style_guide_search_sync_queue q
        join public.style_guide_files f on f.id = q.style_guide_file_id
        left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
       where (p_run_id is null or f.crawl_run_id = p_run_id)
         and f.is_active
         and (d.style_guide_file_id is null
              -- A file that went stale and later came back unchanged keeps its
              -- stored source_identity, but reconcile_stale_sg_files_batch left
              -- the document is_active = false. Without this clause the row is
              -- never re-selected and stays invisible to unified search forever.
              or d.is_active is distinct from f.is_active
              -- #4437 review B1: thumbnail-only changes must re-sync too; they
              -- change content_sha256 and must invalidate the stored vector.
              or d.thumbnail_url is distinct from f.thumbnail_url
              or d.source_identity is distinct from
                 md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                     coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                     coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                     coalesce(f.licensor_name, '') || '|' || f.is_active::text))
       order by q.style_guide_file_id
       limit v_batch
    ), upserted as (
      insert into public.style_guide_search_documents as d (
        style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
        style_guide_name, directory_path, relative_path, filename, file_extension,
        tag_names, size_bytes, modified_at, thumbnail_url, is_active,
        pdf_text_status, pdf_text_length, source_identity, content_sha256, search_vector,
        document_updated_at)
      select c.id, c.root_label, c.licensor_name, c.property_folder, c.style_guide_folder,
             c.style_guide_name, c.directory_path, c.relative_path, c.filename, c.file_extension,
             c.tag_names, c.size_bytes, c.modified_at, c.thumbnail_url, c.is_active,
             t.status, coalesce(t.text_length, 0), c.source_identity,
             encode(extensions.digest(c.source_identity || '|' || coalesce(c.thumbnail_url, ''), 'sha256'), 'hex'),
             setweight(to_tsvector('simple', coalesce(c.filename, '')), 'A')
             || setweight(to_tsvector('simple', coalesce(c.style_guide_name, '') || ' ' ||
                                                coalesce(c.property_folder, '') || ' ' ||
                                                coalesce(c.licensor_name, '')), 'B')
             || setweight(to_tsvector('simple', coalesce(c.relative_path, '') || ' ' ||
                                                array_to_string(c.tag_names, ' ')), 'C')
             || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
             now()
        from candidates c
        left join public.style_guide_pdf_text t on t.style_guide_file_id = c.id
      on conflict (style_guide_file_id) do update
        set root_label = excluded.root_label,
            licensor_name = excluded.licensor_name,
            property_folder = excluded.property_folder,
            style_guide_folder = excluded.style_guide_folder,
            style_guide_name = excluded.style_guide_name,
            directory_path = excluded.directory_path,
            relative_path = excluded.relative_path,
            filename = excluded.filename,
            file_extension = excluded.file_extension,
            tag_names = excluded.tag_names,
            size_bytes = excluded.size_bytes,
            modified_at = excluded.modified_at,
            thumbnail_url = excluded.thumbnail_url,
            is_active = excluded.is_active,
            pdf_text_status = excluded.pdf_text_status,
            pdf_text_length = excluded.pdf_text_length,
            source_identity = excluded.source_identity,
            content_sha256 = excluded.content_sha256,
            -- #4437: a changed content identity invalidates the embedding and
            -- requeues it; unchanged content keeps vector, stamp and retry state.
            embedding = case when d.content_sha256
                                  = excluded.content_sha256
                        then d.embedding end,
            embedding_model = case when d.content_sha256
                                        = excluded.content_sha256
                              then d.embedding_model end,
            embedding_updated_at = case when d.content_sha256
                                              = excluded.content_sha256
                                  then d.embedding_updated_at end,
            embedding_error = case when d.content_sha256
                                        = excluded.content_sha256
                              then d.embedding_error end,
            embedding_error_category = case when d.content_sha256
                                                  = excluded.content_sha256
                                        then d.embedding_error_category end,
            embedding_next_retry_at = case when d.content_sha256
                                                  = excluded.content_sha256
                                        then d.embedding_next_retry_at end,
            embedding_attempts = case when d.content_sha256
                                            = excluded.content_sha256
                                then d.embedding_attempts else 0 end,
            embedding_max_attempts = case when d.content_sha256
                                                = excluded.content_sha256
                                    then d.embedding_max_attempts
                                    else 5 end,
            embedding_lease_token = case when d.content_sha256
                                                = excluded.content_sha256
                                        then d.embedding_lease_token end,
            embedding_lease_owner = case when d.content_sha256
                                                = excluded.content_sha256
                                        then d.embedding_lease_owner end,
            embedding_lease_expires_at = case when d.content_sha256
                                                    = excluded.content_sha256
                                            then d.embedding_lease_expires_at end,
            search_vector = excluded.search_vector,
            document_updated_at = now()
      returning d.style_guide_file_id
    )
    select count(*)::integer into v_synced from upserted;

    -- Retire queue entries that are satisfied: the file is gone or inactive
    -- (reconcile deactivates file and document together, and reactivation
    -- requeues), or its document already matches the file's current identity.
    -- Only entries queued before this call started are retired. The trigger
    -- re-stamps queued_at on every change, which locks the entry, so a change
    -- that races this call is re-checked and kept for the next call.
    delete from public.style_guide_search_sync_queue q
     where q.queued_at < v_started
       and not exists (
       select 1
         from public.style_guide_files f
         left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
        where f.id = q.style_guide_file_id
          and f.is_active
          and (d.style_guide_file_id is null
               or d.is_active is distinct from f.is_active
               or d.thumbnail_url is distinct from f.thumbnail_url
               or d.source_identity is distinct from
                 md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                     coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                     coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                     coalesce(f.licensor_name, '') || '|' || f.is_active::text)));
  end if;

  v_now := now();

  -- Completion stamp only on the step that can finish the refresh work.
  -- Matview-only steps leave the run in 'refreshing' with refresh_completed_at
  -- untouched so a later 'search' call (or a caller that knows no search is
  -- needed) closes the run. 'search' and 'all' accumulate the synced count the
  -- existing popdam3 loop already reads.
  if p_run_id is not null and v_step in ('all', 'search') and v_batch > 0 then
    update public.style_guide_crawl_runs
       set refresh_completed_at = v_now,
           -- qualified: `search_documents_synced` is also this function's output
           -- parameter, so the bare name would be ambiguous
           search_documents_synced = style_guide_crawl_runs.search_documents_synced + v_synced
     where id = p_run_id;
  end if;

  refreshed_at := v_now;
  search_documents_synced := v_synced;
  return next;
end;
$$;

-- FUNCTION public.refresh_style_guide_matviews_job()
CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews_job() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_signature text := public.style_guide_refresh_source_signature(
    array['public.style_guide_files']::regclass[]);
  v_state jsonb;
  v_last timestamptz;
begin
  select a.value -> 'matviews' into v_state
    from public.admin_config a where a.key = 'STYLE_GUIDE_REFRESH_STATE';
  v_last := (v_state ->> 'refreshed_at')::timestamptz;

  -- A crawl waiting in await_style_guide_matview_refresh treats a successful run of
  -- this job as proof its data is in the matviews, so a recent crawl always refreshes.
  if v_last >= now() - interval '6 hours'
     and v_state ->> 'signature' = v_signature
     and not exists (
       select 1 from public.style_guide_crawl_runs r
        where r.lifecycle_state in ('reconciling', 'refreshing')
          and r.refresh_completed_at is null
          and greatest(r.ingest_completed_at, r.refresh_started_at) >= now() - interval '2 hours') then
    -- Unchanged matviews; the search-document sync is independent and always runs.
    perform public.refresh_style_guide_matviews(
      p_run_id => null, p_search_batch_size => 5000, p_step => 'search');
    return;
  end if;

  perform public.refresh_style_guide_matviews(
    p_run_id => null, p_search_batch_size => 5000, p_step => 'all');

  insert into public.admin_config as a (key, value, updated_at)
  values ('STYLE_GUIDE_REFRESH_STATE',
          jsonb_build_object('matviews', jsonb_build_object(
            'refreshed_at', now(), 'signature', v_signature)),
          now())
  on conflict (key) do update
    set value = a.value || excluded.value, updated_at = excluded.updated_at;
end
$$;

-- FUNCTION public.replace_asset_ai_tag_result(uuid, text, text, jsonb)
CREATE OR REPLACE FUNCTION public.replace_asset_ai_tag_result(p_asset_id uuid, p_source text, p_model text, p_tags jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
  v_source text := btrim(p_source);
  v_model text := btrim(p_model);
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_asset_id is null
     or nullif(v_source, '') is null
     or lower(v_source) = 'manual'
     or nullif(v_model, '') is null
     or jsonb_typeof(p_tags) <> 'array'
     or not exists (select 1 from public.assets where id = p_asset_id) then
    raise exception 'invalid asset AI result';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_tags) as t(r)
    where coalesce(r->>'category', '') not in
            ('file_type', 'view', 'scene', 'color', 'visible_content', 'technique', 'other')
       or coalesce(r->>'status', '') not in ('active', 'candidate', 'rejected')
       or nullif(btrim(r->>'tag'), '') is null
       or (r ? 'confidence' and
           ((r->>'confidence')::numeric < 0 or (r->>'confidence')::numeric > 1))
  ) then
    raise exception 'invalid asset tag';
  end if;

  -- A new result supersedes this source's prior active/candidate output across
  -- model versions, including historical NULL-model legacy rows. Rejected
  -- tombstones and every manually-owned row are durable authority.
  delete from public.asset_tags
  where asset_id = p_asset_id
    and source = v_source
    and status in ('active', 'candidate')
    and created_by is null;

  insert into public.asset_tags(
    asset_id, tag, category, source, status, confidence, model, evidence, rejected_at
  )
  select distinct on (btrim(r->>'tag'))
    p_asset_id,
    btrim(r->>'tag'),
    r->>'category',
    v_source,
    r->>'status',
    (r->>'confidence')::numeric,
    v_model,
    coalesce(r->'evidence', '{}'),
    case when r->>'status' = 'rejected' then now() end
  from jsonb_array_elements(p_tags) with ordinality as t(r, n)
  order by btrim(r->>'tag'), n desc
  on conflict (asset_id, tag) do update
  set category = excluded.category,
      source = excluded.source,
      status = excluded.status,
      confidence = excluded.confidence,
      model = excluded.model,
      evidence = excluded.evidence,
      rejected_at = excluded.rejected_at,
      updated_at = now()
  where public.asset_tags.created_by is null
    and public.asset_tags.source = excluded.source
    and public.asset_tags.status in ('active', 'candidate');

  select count(*) into v_count
  from public.asset_tags
  where asset_id = p_asset_id
    and source = v_source
    and model = v_model;

  return jsonb_build_object('asset_id', p_asset_id, 'tag_count', v_count);
end
$$;

-- FUNCTION public.reset_bulk_operation_submission_lease(text, bigint, text, text, text, integer, jsonb)
CREATE OR REPLACE FUNCTION public.reset_bulk_operation_submission_lease(p_op_key text, p_expected_revision bigint, p_submission_owner text, p_lease_token text, p_reason text, p_http_status integer, p_provider_error jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_operations jsonb;
  v_operation jsonb;
  v_job jsonb;
  v_reset_job jsonb;
  v_reset_operation jsonb;
  v_revision bigint;
  v_lease_expires timestamptz;
  v_now timestamptz;
begin
  if p_op_key is null or btrim(p_op_key) = ''
     or p_expected_revision is null or p_expected_revision < 0
     or p_submission_owner is null or btrim(p_submission_owner) = ''
     or p_lease_token is null or btrim(p_lease_token) = '' then
    raise exception 'reset_bulk_operation_submission_lease: key, current revision, owner and receipt are required'
      using errcode = '22023';
  end if;

  -- Two accepted reasons, each with its own evidence contract.
  --
  -- not_submitted: the worker failed before any provider POST, so there is no
  --   HTTP response. Requires NULL p_http_status and p_provider_error carrying
  --   the fixed reason category {"category":"not_submitted"}. This is a
  --   caller-supplied statement of the worker's own local failure, not a claim
  --   about an external HTTP response.
  --
  -- provider_definitive_rejection: the provider answered the POST with a
  --   parsed definitive 4xx rejection. Requires p_http_status in the widened
  --   set 400/401/402/403/422/429 and a nonempty JSON object p_provider_error.
  --   The caller must authenticate the provider response; SQL cannot
  --   distinguish a provider response from a proxy response based on status
  --   and body alone.
  --
  -- Every other reason stays refused. Timeout, disconnect and 5xx remain on
  -- the existing ambiguous-submission path.
  if p_reason = 'not_submitted' then
    if p_http_status is not null
       or jsonb_typeof(p_provider_error) is distinct from 'object'
       or p_provider_error ->> 'category' is distinct from 'not_submitted' then
      raise exception 'reset_bulk_operation_submission_lease: not_submitted requires NULL http status and fixed provider_error category'
        using errcode = '22023';
    end if;
  elsif p_reason = 'provider_definitive_rejection' then
    if p_http_status is null
       or p_http_status <> all(array[400, 401, 402, 403, 422, 429])
       or jsonb_typeof(p_provider_error) is distinct from 'object'
       or p_provider_error = '{}'::jsonb then
      raise exception 'reset_bulk_operation_submission_lease: parsed definitive 4xx rejection evidence is required'
        using errcode = '22023';
    end if;
  else
    raise exception 'reset_bulk_operation_submission_lease: reason must be not_submitted or provider_definitive_rejection'
      using errcode = '22023';
  end if;

  -- Exactly the lock used by update_bulk_operation: validation and the reset
  -- serialize with every ordinary lease claim, provider binding and state write.
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  v_now := clock_timestamp();
  select value into v_operations
  from public.admin_config
  where key = 'BULK_OPERATIONS';
  v_operations := coalesce(v_operations, '{}'::jsonb);
  v_operation := case when jsonb_typeof(v_operations -> p_op_key) = 'object'
                      then v_operations -> p_op_key end;
  v_job := case when jsonb_typeof(v_operation -> 'external_job') = 'object'
                then v_operation -> 'external_job' end;
  v_revision := coalesce(nullif(v_operation ->> 'state_revision', '')::bigint, 0);
  v_lease_expires := nullif(v_job ->> 'lease_expires_at', '')::timestamptz;

  -- A bare owner name or readable revision is never authority. The original
  -- one-time receipt, still-live lease and exact current revision are all
  -- required. No bound or ambiguous provider job can be reset through here.
  if v_operation is null or v_job is null
     or v_revision is distinct from p_expected_revision
     or v_operation ->> 'status' is distinct from 'running'
     or v_job ->> 'phase' is distinct from 'submitting'
     or nullif(v_job ->> 'provider_batch_id', '') is not null
     or nullif(v_job ->> 'submission_owner', '') is distinct from p_submission_owner
     or v_lease_expires is null or v_lease_expires <= v_now
     or nullif(v_job ->> 'lease_proof', '') is distinct from md5(p_lease_token)
     or v_job ?| array['ambiguous_since', 'ambiguous_reason',
                       'ambiguous_prior_phase', 'ambiguous_prior_owner'] then
    raise exception 'reset_bulk_operation_submission_lease: current live unbound submission receipt was not proven'
      using errcode = '55000';
  end if;

  -- Consume the old receipt. No receipt is returned or reissued here. The
  -- ordinary guarded writer may mint a new receipt only on a later fresh
  -- revision claim; its stop, ambiguity and provider-pointer guards remain in
  -- force. The parsed provider error body is neither stored nor returned.
  v_reset_job := (v_job - 'submission_owner' - 'lease_expires_at'
                       - 'lease_claimed_at' - 'lease_proof' - 'lease_token'
                       - 'submitted_at' - 'next_poll_at')
                 || jsonb_build_object(
                      'phase', 'prepared',
                      'last_definitive_rejection_status', p_http_status,
                      'last_definitive_rejection_reason', p_reason,
                      'last_definitive_rejection_at', v_now);
  v_reset_operation := jsonb_set(v_operation, array['external_job'], v_reset_job)
                       || jsonb_build_object('state_revision', v_revision + 1);
  v_operations := jsonb_set(v_operations, array[p_op_key], v_reset_operation);

  insert into public.admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_operations, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'reason', p_reason,
    'op_key', p_op_key,
    'state_revision', v_revision + 1,
    'lease_receipt_issued', false,
    'lease_token', null,
    'operation', v_reset_operation);
end;
$$;

-- FUNCTION public.reset_sg_search_embedding_errors(uuid[])
CREATE OR REPLACE FUNCTION public.reset_sg_search_embedding_errors(p_style_guide_file_ids uuid[] DEFAULT NULL::uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_count int;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  delete from public.style_guide_search_embedding_jobs j
   using public.style_guide_search_documents d
   where d.style_guide_file_id = j.style_guide_file_id
     and d.embedding is null
     and (p_style_guide_file_ids is null or j.style_guide_file_id = any (p_style_guide_file_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- FUNCTION public.resolve_coldlion_triage(uuid, text, uuid)
CREATE OR REPLACE FUNCTION public.resolve_coldlion_triage(p_line uuid, p_action text, p_target uuid DEFAULT NULL::uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'plm', 'public', 'pg_temp'
    AS $_$
declare
  v_actor uuid := auth.uid();
  v_line plm.production_order_line;
  v_order plm.production_order;
  v_target plm.production_order_line;
  v_cl jsonb;
  v_dest uuid;
  v_n int;
  v_stamp jsonb;
begin
  if v_actor is null then
    raise exception 'resolve_coldlion_triage: authentication required' using errcode = '42501';
  end if;
  select * into v_line from plm.production_order_line where id = p_line for update;
  if not found then
    raise exception 'This line no longer exists — refresh the list.' using errcode = 'P0002';
  end if;
  select * into v_order from plm.production_order where id = v_line.production_order_id;
  -- Only a line that really carries a ColdLion line can be reconciled:
  -- coldlion_values alone is metadata a user could have written.
  if not exists (select 1 from plm.production_order_line_source_ref r
                  where r.production_order_line_id = p_line and r.source_system = 'coldlion') then
    raise exception 'This line has no ColdLion line, so there is nothing to reconcile.' using errcode = '22023';
  end if;
  v_cl := v_line.metadata -> 'coldlion_values';
  v_stamp := jsonb_build_object('by', v_actor, 'at', now());

  if p_action in ('keep_google_quantity', 'use_coldlion_quantity') then
    if jsonb_typeof(v_cl -> 'quantity_ordered') <> 'number'
       or (v_cl ->> 'quantity_ordered')::numeric is not distinct from v_line.quantity_ordered
       or v_line.metadata #> '{coldlion_reviewed,quantity_ordered}' is not distinct from v_cl -> 'quantity_ordered' then
      raise exception 'This quantity no longer needs a decision — refresh the list.' using errcode = '22023';
    end if;
    if p_action = 'use_coldlion_quantity' then
      update plm.production_order_line set quantity_ordered = (v_cl ->> 'quantity_ordered')::numeric,
             metadata = metadata || jsonb_build_object('coldlion_resolved_quantity', v_stamp || jsonb_build_object('from', v_line.quantity_ordered)),
             updated_at = now()
       where id = p_line;
      return format('Quantity changed to %s.', v_cl ->> 'quantity_ordered');
    end if;
    update plm.production_order_line
       set metadata = jsonb_set(metadata || jsonb_build_object('coldlion_reviewed', coalesce(metadata -> 'coldlion_reviewed', '{}'::jsonb)),
                                '{coldlion_reviewed,quantity_ordered}', v_cl -> 'quantity_ordered')
                      || jsonb_build_object('coldlion_resolved_quantity', v_stamp),
           updated_at = now()
     where id = p_line;
    return format('Kept the Google quantity %s.', v_line.quantity_ordered);
  end if;

  if p_action in ('keep_google_import_po', 'use_coldlion_import_po') then
    if nullif(btrim(v_cl ->> 'import_po'), '') is null
       or lower(btrim(v_cl ->> 'import_po')) is not distinct from lower(btrim(v_order.production_order_number))
       or v_line.metadata #> '{coldlion_reviewed,import_po}' is not distinct from v_cl -> 'import_po' then
      raise exception 'This Import PO no longer needs a decision — refresh the list.' using errcode = '22023';
    end if;
    if p_action = 'use_coldlion_import_po' then
      -- The destination comes from ColdLion's own order history, never from
      -- metadata alone: the newest retained prod_reference_no of this line's
      -- ColdLion sales order line must still be the value on screen.
      if not exists (
        select 1
          from plm.production_order_line_source_ref r
          cross join lateral (
            select nullif(btrim(h.prod_reference_no), '') as import_po
              from coldlion.order_history_line h
             where r.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:'
               and h.sales_order_no = split_part(r.source_id, ':', 3)::bigint
               and h.sales_order_line_no = split_part(r.source_id, ':', 5)::integer
             order by h.fetched_at desc, h.created_at desc, h.id
             limit 1) oh
         where r.production_order_line_id = p_line and r.source_system = 'coldlion'
           and lower(oh.import_po) = lower(btrim(v_cl ->> 'import_po'))) then
        raise exception 'ColdLion no longer shows Import PO % for this line — refresh the list.', btrim(v_cl ->> 'import_po') using errcode = '22023';
      end if;
      -- Historical duplicate Import PO numbers are grandfathered, so the
      -- destination is the one open order with that number for THIS customer.
      select count(*), min(id::text)::uuid into v_n, v_dest from plm.production_order
       where lower(btrim(production_order_number)) = lower(btrim(v_cl ->> 'import_po')) and voided_at is null
         and company_id is not distinct from v_order.company_id;
      if v_n <> 1 then
        if v_n = 0 and exists (select 1 from plm.production_order
                                where lower(btrim(production_order_number)) = lower(btrim(v_cl ->> 'import_po')) and voided_at is null) then
          raise exception 'Order % belongs to a different customer, so this line was not moved. Check ColdLion.', btrim(v_cl ->> 'import_po') using errcode = '22023';
        end if;
        raise exception 'There is no single OrderList order % to move this line to. Create it first, or keep the Google Import PO.', btrim(v_cl ->> 'import_po') using errcode = '22023';
      end if;
      update plm.production_order_line set production_order_id = v_dest,
             metadata = metadata || jsonb_build_object('coldlion_resolved_import_po', v_stamp || jsonb_build_object('from', v_order.production_order_number)),
             updated_at = now()
       where id = p_line;
      return format('Line moved from %s to %s.', v_order.production_order_number, btrim(v_cl ->> 'import_po'));
    end if;
    update plm.production_order_line
       set metadata = jsonb_set(metadata || jsonb_build_object('coldlion_reviewed', coalesce(metadata -> 'coldlion_reviewed', '{}'::jsonb)),
                                '{coldlion_reviewed,import_po}', v_cl -> 'import_po')
                      || jsonb_build_object('coldlion_resolved_import_po', v_stamp),
           updated_at = now()
     where id = p_line;
    return format('Kept the Google Import PO %s.', v_order.production_order_number);
  end if;

  if p_action in ('link_google_line', 'keep_separate') then
    if coalesce(v_order.metadata ->> 'production_order_number_origin', '') <> 'coldlion_intake_placeholder'
       or v_order.production_order_number !~ '^COLDLION-SO-[0-9]+$'
       or v_line.voided_at is not null
       or coalesce(v_line.metadata ->> 'coldlion_kept_separate', '') = 'true'
       or not exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_line and r.source_system = 'coldlion')
       or exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_line and r.source_system <> 'coldlion') then
      raise exception 'This ColdLion line no longer needs a decision — refresh the list.' using errcode = '22023';
    end if;
    if p_action = 'keep_separate' then
      update plm.production_order_line
         set metadata = metadata || jsonb_build_object('coldlion_kept_separate', true, 'coldlion_resolved_separate', v_stamp),
             updated_at = now()
       where id = p_line;
      return 'Kept as its own ColdLion row.';
    end if;
    select * into v_target from plm.production_order_line where id = p_target for update;
    if not found
       or v_target.voided_at is not null
       or not exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_target and r.source_system = 'google_order_list')
       or exists (select 1 from plm.production_order_line_source_ref r where r.production_order_line_id = p_target and r.source_system = 'coldlion')
       or exists (select 1 from plm.production_order p where p.id = v_target.production_order_id and p.production_order_number ~ '^COLDLION-SO-') then
      raise exception 'That Google line cannot take a ColdLion line (it is gone, voided, or already linked). Pick another.' using errcode = '22023';
    end if;
    -- A Google line imported without a customer link is still the same line
    -- when its customer PO (unpadded, as the automatic merge compares it) and
    -- SKU match exactly (a blank PO or SKU never matches); any other
    -- customer difference is refused.
    if (select company_id from plm.production_order where id = v_target.production_order_id) is distinct from v_order.company_id
       and not coalesce((select company_id from plm.production_order where id = v_target.production_order_id) is null
                and nullif(btrim(v_line.sku), '') is not null
                and v_target.sku = v_line.sku
                and nullif(ltrim(btrim(v_line.customer_po_number), '0'), '') is not null
                and nullif(ltrim(btrim(v_target.customer_po_number), '0'), '') = nullif(ltrim(btrim(v_line.customer_po_number), '0'), ''), false) then
      raise exception 'That Google line is for a different customer, so it was not linked. Pick another.' using errcode = '22023';
    end if;
    update plm.production_order_line g
       set quantity_ordered = coalesce(g.quantity_ordered, v_line.quantity_ordered),
           metadata = coalesce(g.metadata, '{}'::jsonb)
                      || jsonb_build_object('coldlion_linked_from', to_jsonb(v_line) || jsonb_build_object('linked_by', v_actor, 'linked_at', now()))
                      || case when v_line.quantity_ordered is not null and g.metadata -> 'coldlion_values' is null
                              then jsonb_build_object('coldlion_values', jsonb_build_object('quantity_ordered', v_line.quantity_ordered, 'import_po', null))
                              else '{}'::jsonb end,
           updated_at = now()
     where g.id = p_target;
    update plm.production_order_line_source_ref set production_order_line_id = p_target
     where production_order_line_id = p_line and source_system = 'coldlion';
    update dam.production_order_snapshot set production_order_line_id = p_target
     where production_order_line_id = p_line;
    delete from plm.production_order_line where id = p_line;
    return 'Linked to the Google line.';
  end if;

  raise exception 'resolve_coldlion_triage: unknown action %', p_action using errcode = '22023';
end;
$_$;

-- FUNCTION public.resolve_product_category_prediction_item_identity()
CREATE OR REPLACE FUNCTION public.resolve_product_category_prediction_item_identity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'plm'
    AS $$
declare
  v_match_count integer;
  v_item_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.plm_item_id is not null
     and new.plm_item_id is null
     and new.external_id is not distinct from old.external_id
     and new.erp_item_id is not distinct from old.erp_item_id then
    new.item_identity_status := 'unresolved';
    return new;
  end if;

  if new.plm_item_id is not null then
    if not exists (
      select 1
      from plm.item item
      where item.id = new.plm_item_id
        and (
          length(new.external_id) - length(replace(new.external_id, '|', '')) <> 2
          or (
            item.source_system = split_part(new.external_id, '|', 1)
            and coalesce(item.raw ->> 'divisionCode', '') = split_part(new.external_id, '|', 2)
            and item.item_number = split_part(new.external_id, '|', 3)
          )
        )
    ) then
      raise exception 'plm_item_id does not identify a canonical item' using errcode = '23503';
    end if;
    new.item_identity_status := 'resolved';
    return new;
  end if;

  if length(new.external_id) - length(replace(new.external_id, '|', '')) = 2 then
    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from plm.item item
    where item.source_system = split_part(new.external_id, '|', 1)
      and coalesce(item.raw ->> 'divisionCode', '') = split_part(new.external_id, '|', 2)
      and item.item_number = split_part(new.external_id, '|', 3);

    if v_match_count <> 1 then
      raise exception 'canonical prediction identity must resolve exactly once: % (matches=%)',
        new.external_id, v_match_count using errcode = 'P0001';
    end if;

    new.plm_item_id := v_item_id;
    new.item_identity_status := 'resolved';
    return new;
  end if;

  if new.erp_item_id is not null then
    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from plm.legacy_erp_item_identity legacy
    join plm.item item
      on item.source_system = 'coldlion'
     and item.item_number = legacy.external_id
     and coalesce(item.raw ->> 'divisionCode', '') = coalesce(legacy.division_code, '')
    where legacy.id = new.erp_item_id;

    if v_match_count = 1 then
      new.plm_item_id := v_item_id;
      new.item_identity_status := 'resolved';
    else
      new.item_identity_status := 'unresolved';
    end if;
  else
    new.item_identity_status := 'unresolved';
  end if;

  return new;
end;
$$;

-- FUNCTION public.resolve_sku_style_guide_batch(integer)
CREATE OR REPLACE FUNCTION public.resolve_sku_style_guide_batch(p_batch_size integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_skus text[];
  v_file_ids uuid[]; v_declared_ids uuid[]; v_label_ids uuid[]; v_active_ids uuid[];
  v_filename_rows int := 0;
  v_declared_rows int := 0;
  v_label_rows    int := 0;
begin
  if p_batch_size < 1 or p_batch_size > 1000 then
    raise exception 'Batch size must be between 1 and 1000';
  end if;
  -- Catalog-only checks precede reading any caller-controlled temporary source.
  if not (select count(*)=3 and coalesce(bool_and(
      c.relkind='r' and c.relpersistence='t' and c.relowner=current_user::regrole::oid
      and not c.relrowsecurity and not c.relforcerowsecurity
      and coalesce((select jsonb_agg(jsonb_build_array(a.attname::text,a.atttypid::integer,a.atttypmod,a.attnum::integer) order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)=e.shape,false)
      and not exists(select from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and a.attisdropped)
      and not exists(select from pg_catalog.pg_trigger t where t.tgrelid=c.oid)
      and not exists(select from pg_catalog.pg_rewrite r where r.ev_class=c.oid)
    ),false)
    from (values
      ('sku_sg_inputs','[["sku",25,-1,1],["input_kind",25,-1,2],["file_name",25,-1,3],["file_name_norm",25,-1,4],["declared_label",25,-1,5],["declared_key",25,-1,6],["label_key",25,-1,7],["row_hash",25,-1,8]]'::jsonb),
      ('sku_sg_portal','[["source_system",25,-1,1],["file_name_norm",25,-1,2],["source_style_guide_key",25,-1,3],["style_guide_label",25,-1,4],["core_style_guide_id",2950,-1,5],["matched_file_name",25,-1,6],["style_guide_label_key",25,-1,7],["portal_hash_1",20,-1,8],["portal_hash_2",20,-1,9]]'::jsonb),
      ('sku_sg_pending','[["sku",25,-1,1],["input_hash",25,-1,2],["portal_hash",25,-1,3],["output_hash",25,-1,4]]'::jsonb)
    ) e(name,shape) join pg_catalog.pg_class c on c.relnamespace=pg_catalog.pg_my_temp_schema() and c.relname=e.name
  ) then
    raise exception using errcode='42501',message='Trusted SKU resolution temporary snapshot is missing or incompatible';
  end if;
  perform pg_advisory_xact_lock(5608, 1);
  select array_agg(sku) into v_skus from
    (select sku from pg_temp.sku_sg_pending order by sku limit p_batch_size) q;
  if v_skus is null then
    return jsonb_build_object('sku_rows', 0, 'filename_rows', 0, 'declared_rows', 0, 'label_match_rows', 0);
  end if;
  -- ARM 1 - extracted file name -> portal style guide.
  with src as (
    select distinct u.sku,u.file_name,u.file_name_norm as fn
    from pg_temp.sku_sg_inputs u
    where u.input_kind='file' and u.sku=any(v_skus)
  ),
  hits as (
    select s.sku, s.file_name, i.source_system, i.source_style_guide_key,
           min(i.style_guide_label) as style_guide_label,
           min(i.core_style_guide_id::text)::uuid as core_style_guide_id,
           bool_or(lower(btrim(s.file_name)) = lower(btrim(i.matched_file_name))) as exact_match,
           count(distinct i.matched_file_name)    as matched_asset_count
    from src s
    join pg_temp.sku_sg_portal i on i.file_name_norm = s.fn
    group by s.sku, s.file_name, i.source_system, i.source_style_guide_key
  ),
  scored as (
    -- How many distinct portal guides this one (sku, file_name) lands on. More than
    -- one means the file name is not decisive, so confidence is divided accordingly.
    select h.*, count(*) over (partition by h.sku, h.file_name) as guide_count
    from hits h
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count, core_style_guide_id)
    select s.sku, s.file_name, s.source_system, s.source_style_guide_key,
           s.style_guide_label,
           case when s.exact_match
                then 'filename_exact' else 'filename_normalized' end,
           1.0 / greatest(s.guide_count, 1)::real,
           s.matched_asset_count,
           s.core_style_guide_id
    from scored s
    on conflict on constraint sku_style_guide_links_identity_key
    do update
      set last_seen_at = now(),
          style_guide_label   = excluded.style_guide_label,
          match_method        = excluded.match_method,
          match_confidence    = excluded.match_confidence,
          matched_asset_count = excluded.matched_asset_count,
          core_style_guide_id = coalesce(excluded.core_style_guide_id,
                                        public.sku_style_guide_links.core_style_guide_id)
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_filename_rows,v_file_ids from ins;

  -- ARM 2 - the sheet's own declared style guide, verbatim.
  with raw_decl as (
    select i.sku,i.declared_label as label,i.label_key
    from pg_temp.sku_sg_inputs i
    where i.input_kind='sheet' and i.sku=any(v_skus)
  ),
  decl as (
    -- One proposal per result identity, including equivalent OCR spellings.
    select sku, label_key as label_key, min(label) as label
    from raw_decl
    where label <> ''
      and label_key is not null
      and public.is_plausible_source_file_name(label)
    group by sku, label_key
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count)
    select d.sku, null, 'sheet_declared', d.label_key,
           d.label, 'sheet_declared', 1.0, 1
    from decl d
    where d.label <> ''
      and d.label_key is not null
      and public.is_plausible_source_file_name(d.label)
    on conflict on constraint sku_style_guide_links_identity_key
    do update set last_seen_at = now(), style_guide_label = excluded.style_guide_label
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_declared_rows,v_declared_ids from ins;

  -- ARM 3 - declared label matched against a portal style-guide label.
  with decl as (
    select i.sku,i.declared_label as label,i.label_key
    from pg_temp.sku_sg_inputs i
    where i.input_kind='sheet' and i.sku=any(v_skus)
  ),
  guides as (
    select distinct i.source_system, i.source_style_guide_key, i.style_guide_label,
           i.core_style_guide_id,
           i.style_guide_label_key as ln
    from pg_temp.sku_sg_portal i
    where btrim(i.style_guide_label) <> ''
      and i.style_guide_label_key in (select label_key from decl)
  ),
  hits as (
    select d.sku, g.source_system, g.source_style_guide_key,
           min(g.style_guide_label) as style_guide_label
    from decl d
    join guides g on g.ln = d.label_key
    where d.label_key is not null
    group by d.sku, g.source_system, g.source_style_guide_key
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count)
    select h.sku, null, h.source_system, h.source_style_guide_key,
           h.style_guide_label, 'sheet_label_match', 1.0, 1
    from hits h
    on conflict on constraint sku_style_guide_links_identity_key
    do update set last_seen_at = now(),
                  style_guide_label   = excluded.style_guide_label,
                  core_style_guide_id = coalesce(excluded.core_style_guide_id,
                                                public.sku_style_guide_links.core_style_guide_id)
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_label_rows,v_label_ids from ins;

  v_active_ids := v_file_ids || v_declared_ids || v_label_ids;
  insert into public.sku_style_guide_resolver_progress(sku,input_hash,portal_hash,active_link_ids,output_hash,resolved_at)
    select q.sku,q.input_hash,q.portal_hash,
      coalesce((select array_agg(l.id order by l.id) from public.sku_style_guide_links l
        where l.sku=q.sku and l.id=any(v_active_ids)), '{}'::uuid[]),
      (select md5(coalesce(string_agg(row(l.id,l.sku,l.file_name,l.source_system,l.source_style_guide_key,l.style_guide_label,l.match_method,l.match_confidence,l.matched_asset_count,l.core_style_guide_id)::text, E'\n' order by l.id), '')) from public.sku_style_guide_links l
        where l.sku=q.sku and l.id=any(v_active_ids)),now()
    from pg_temp.sku_sg_pending q where q.sku = any(v_skus)
    on conflict(sku) do update set input_hash=excluded.input_hash,
      portal_hash=excluded.portal_hash,active_link_ids=excluded.active_link_ids,
      output_hash=excluded.output_hash,resolved_at=excluded.resolved_at;
  delete from pg_temp.sku_sg_pending where sku = any(v_skus);
  return jsonb_build_object(
    'sku_rows', cardinality(v_skus),
    'filename_rows', v_filename_rows,
    'declared_rows', v_declared_rows,
    'label_match_rows', v_label_rows
  );
end;
$$;

-- FUNCTION public.resolve_sku_style_guide_links()
CREATE OR REPLACE FUNCTION public.resolve_sku_style_guide_links() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  r jsonb;
  nf integer := 0; nd integer := 0; nl integer := 0;
begin
  if not pg_try_advisory_xact_lock(5608, 2) then
    raise exception 'SKU style-guide resolution already running';
  end if;
  while public.backfill_sku_style_guide_key_batch() > 0 loop null; end loop;
  perform public.prepare_sku_style_guide_resolution(true);
  loop
    r := public.resolve_sku_style_guide_batch();
    exit when (r->>'sku_rows')::integer = 0;
    nf := nf + (r->>'filename_rows')::integer;
    nd := nd + (r->>'declared_rows')::integer;
    nl := nl + (r->>'label_match_rows')::integer;
  end loop;
  return jsonb_build_object('filename_rows',nf,'declared_rows',nd,'label_match_rows',nl);
end;
$$;

-- PROCEDURE public.resolve_sku_style_guide_links_run(boolean)
CREATE OR REPLACE PROCEDURE public.resolve_sku_style_guide_links_run(IN p_full boolean DEFAULT false)
    LANGUAGE plpgsql
    AS $$
declare r jsonb; n integer;
begin
  -- Session lock survives COMMIT and prevents the catch-up and nightly jobs
  -- from doing duplicate work. pg_cron closes the connection on cancellation.
  -- Reject explicit-transaction CALL before taking a session-scoped lock.
  commit;
  if not pg_try_advisory_lock(5608, 2) then
    raise exception 'SKU style-guide resolution already running' using errcode='55P03';
  end if;
  loop
    begin
      n := public.backfill_sku_style_guide_key_batch();
    exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
      perform pg_advisory_unlock(5608, 2); raise;
    end;
    commit;
    exit when n = 0;
  end loop;
  begin
    perform public.prepare_sku_style_guide_resolution(p_full);
  exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
    perform pg_advisory_unlock(5608, 2); raise;
  end;
  commit;
  loop
    begin
      r := public.resolve_sku_style_guide_batch();
    exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
      perform pg_advisory_unlock(5608, 2); raise;
    end;
    commit;
    exit when (r->>'sku_rows')::integer = 0;
  end loop;
  begin
    perform public.finish_sku_style_guide_catchup();
  exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
    perform pg_advisory_unlock(5608, 2); raise;
  end;
  perform pg_advisory_unlock(5608, 2);
end;
$$;

-- FUNCTION public.search_dam_documents(text, jsonb, integer, integer, text[], extensions.vector, real, real)
CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real) RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    SET statement_timeout TO '30s'
    AS $_$
  select set_config('hnsw.ef_search', '100', true);
  select set_config('hnsw.iterative_scan', 'relaxed_order', true);
  select set_config('hnsw.max_scan_tuples', '20000', true);
  with params as materialized (
    select nullif(trim(p_query),'') query_text,
      greatest(1,least(coalesce(p_limit,100),20000)) page_limit,
      greatest(coalesce(p_offset,0),0) page_offset,
      greatest(coalesce(p_min_rank,0),0)::real min_rank,
      case when p_min_semantic_score is null then null
        else greatest(0,least(1,p_min_semantic_score))::real end min_semantic_score,
      case when p_query_embedding is null then false else true end has_embedding,
      1000 summary_probe_limit,
      -- popdam3#892: when a search names a licensor, the caller passes its id(s) here and a
      -- document matched by its picture ALONE must belong to one of them. Keyword matches,
      -- and the picture score of a document that also matched by keyword, are untouched.
      (select array_agg(x.id::uuid)
       from jsonb_array_elements_text(
         case when jsonb_typeof(p_filters->'semanticLicensorIds')='array'
           then p_filters->'semanticLicensorIds' else '[]'::jsonb end) x(id)) semantic_licensor_ids
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
      '%' || replace(replace(replace(q.query_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' like_pattern,
      (length(q.query_text) >= 3 and q.query_text ~ '[[:alnum:]]{3,}'
        and (length(q.query_text) >= 4 or q.query_text ~ '[0-9]')) allow_substring
    from params p cross join public.expand_dam_search_queries(p.query_text) q
    where p.query_text is not null
      and websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g'))::text <> ''
  ), distinct_queries as materialized (
    select distinct q.query_text, q.tsq, q.allow_substring, q.like_pattern,
      btrim(lower(regexp_replace(btrim(q.query_text), '[-_/[:space:]]+', ' ', 'g'))) normalized_query,
      regexp_replace(q.query_text, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') regex_literal
    from queries q
  ), substring_regex as materialized (
    select '(' || string_agg(distinct q.regex_literal, '|') || ')' rx
    from distinct_queries q where q.allow_substring
  ), rank_queries as materialized (
    select q.normalized_query, q.tsq,
      coalesce(array_agg(distinct q.like_pattern) filter (where q.allow_substring), '{}'::text[]) like_patterns
    from distinct_queries q
    group by q.normalized_query, q.tsq
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where (p_document_types is null or d.document_type = any(p_document_types))
  ), keyword_features as materialized (
    select m.document_type,m.entity_id,m.asset_id,m.style_group_id,m.in_substring,
      m.title,m.path,m.customer,m.program,
      m.title_key,m.title_tsv
    from (
      select f.document_type,f.entity_id,f.asset_id,f.style_group_id,f.title,f.title_key,f.title_tsv,
        s.path,s.customer,s.program,(s.entity_id is not null) in_substring
      from full_text_matches f
      left join substring_matches s
        on s.document_type = f.document_type and s.entity_id = f.entity_id
      union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.title,s.title_key,s.title_tsv,
        s.path,s.customer,s.program,true
      from substring_matches s
      where not exists (
        select 1 from full_text_matches f
        where f.document_type = s.document_type and f.entity_id = s.entity_id)
    ) m
  ), keyword_candidates as materialized (
    select k.document_type,k.entity_id,k.asset_id,k.style_group_id,
      (select max(
        case
          when k.title_key = q.normalized_query then 1.0
          when k.in_substring and k.title ilike any(q.like_patterns) then 0.6
          when k.title_tsv @@ q.tsq then 0.45
          when k.in_substring and k.path ilike any(q.like_patterns) then 0.3
          when k.in_substring and (k.customer ilike any(q.like_patterns) or k.program ilike any(q.like_patterns)) then 0.2
          else 0.1
        end
        + 0.09 * least(1.0, length(q.normalized_query)::numeric / greatest(length(k.title_key),1))
      ) from rank_queries q)::real keyword_rank
    from keyword_features k
  ), semantic_ann as materialized (
    -- HNSW leg: used whenever assets are searched. hnsw.iterative_scan=relaxed_order
    -- (set_config at the top of the body) keeps scanning past ef_search until the post-filtered
    -- LIMIT is met, instead of stopping at the ~100-row candidate list (#4664).
    -- HNSW returns distance order; do NOT add a secondary sort key here.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    -- also used for any requested type that has no exact leg (anything but style_group; #4664 M2).
    -- This constant test must stay in WHERE: it becomes a one-time filter that
    -- skips the scan. Behind only the params join, a keyword-only call (null
    -- embedding) walks ~24k HNSW tuples for nothing: 19 s, up to the 30 s limit.
    where p_query_embedding is not null
      and (p_document_types is null
        or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group'))
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> p_query_embedding
    limit 2000
  ), semantic_exact as materialized (
    -- Exact leg: when assets are NOT searched (style groups only, ~6k vectors; the
    -- only other document type),
    -- a filtered HNSW walk must cross ~25x more asset tuples than it keeps (15 s for
    -- 964 rows on production). An exact distance sort over the pkey range is ~0.1 s.
    -- "+ 0" keeps the planner off the HNSW index on purpose.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join dam.search_group_vectors d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset' = any(p_document_types))
      and 'style_group' = any(p_document_types)
      and d.document_type = 'style_group'  -- literal: a parameter here makes the planner seq-scan (3.5 s)
    order by (d.embedding <=> p_query_embedding) + 0
    limit 2000
  ), semantic_candidates as materialized (
    -- threshold applied after the legs so it never extends the HNSW walk (#4664 M1).
    select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.semantic_rank from (
      select * from semantic_ann
      union all
      select * from semantic_exact
    ) s
    cross join params p
    where p.min_semantic_score is null
       or s.semantic_rank >= p.min_semantic_score
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
      and ((select semantic_licensor_ids from params) is null
        or max(c.keyword_rank) is not null
        -- a grouped document takes its style group's licensor, an ungrouped asset its own
        or exists (select 1 from public.style_groups g
          where g.id = c.style_group_id
            and g.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))
        or (c.style_group_id is null and exists (select 1 from public.assets a
          where a.id = c.asset_id
            and a.licensor_id = any((select semantic_licensor_ids from params)::uuid[]))))
  ), ordered_candidates as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      row_number() over (order by c.rank desc, c.document_type, c.entity_id) rn
    from candidate_ranks c
  ), candidate_asset_ids as not materialized (
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      c.keyword_rank, c.semantic_rank, c.rank, x.id, c.rn
    from (select * from ordered_candidates order by rn) c
    join lateral (
      select c.asset_id id where c.document_type='asset' and c.asset_id is not null
      union all
      select m.id from public.assets m
      where c.document_type='style_group' and c.style_group_id is not null
        and m.style_group_id=c.style_group_id and not m.is_deleted
    ) x on true
  ), visibility_params as materialized (
    -- semanticLicensorIds is not a visibility filter: strip it so the unfiltered fast paths still apply.
    select coalesce(p_filters,'{}'::jsonb)-'search'-'semanticLicensorIds' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
  ), visible_assets as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed, c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      -- #5938: visible member assets summed over candidates. visible_assets has
      -- one row per (candidate, probe-visible member), so this sum is exactly
      -- its unlimited row count when every count is current.
      coalesce(sum(d.default_visible_member_count), 0) visible_member_rows,
      coalesce(bool_and(d.default_visible_member_count is not null), true) all_counts_current,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
  ), probe_state as materialized (
    -- #5747 stage profile (production, 2026-11-06): for broad queries the
    -- visibility probe below (member fan-out + one assets fetch per visible
    -- row) cost ~1.0 s of the 2.4 s function body, and every consumer of that
    -- probe either discards its output when it truncates (facets blank
    -- fallback) or is answered elsewhere (exact totals from the flag fast
    -- path above, page rows and has_more from page_documents). When the
    -- request is unfiltered and every candidate flag is current,
    -- flagged_visible is exactly the number of candidate documents with >= 1
    -- probe-visible member asset (same predicate, same min date), so
    -- flagged_visible > summary_probe_limit already proves the probe would
    -- truncate. Return truncated = true and never build visible_assets. Any
    -- doubt (filters present, stale flags) runs the original probe unchanged.
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
       and (coalesce((select flagged_visible from default_flag_state), 0)
              > (select summary_probe_limit from params)
         -- #5938 profile (production, 2026-11-08): broad queries with < 1,000
         -- candidate documents but > 1,000 member assets still built
         -- visible_assets (~1,000 assets heap fetches, 0.9-1.3 s, most of the
         -- slow tail) only to learn it truncates. The member-asset count
         -- proves the same thing without touching assets.
         or (coalesce((select all_counts_current from default_flag_state), true)
             and coalesce((select visible_member_rows from default_flag_state), 0)
                 > (select summary_probe_limit from params)))
      then true
      else (select count(*) > (select summary_probe_limit from params) from visible_assets)
    end truncated
  ), summary_assets as materialized (
    select a.document_type,a.entity_id,a.asset_id,a.style_group_id,a.keyword_rank,a.semantic_rank,a.rank,
      a.id,a.asset_style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed,a.rn
    from visible_assets a
    where not (select truncated from probe_state)
       or a.rn < (select max(x.rn) from visible_assets x)
  ), matched_assets as materialized (
    select distinct a.id,a.asset_style_group_id style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed from summary_assets a
  ), page_documents as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,
      c.keyword_rank,c.semantic_rank,c.rank,c.rn
    from (select * from ordered_candidates order by rn) c
    where coalesce((
      select true
      from (
        select c.asset_id id where c.document_type='asset' and c.asset_id is not null
        union all
        select m.id from public.assets m
        where c.document_type='style_group' and c.style_group_id is not null
          and m.style_group_id=c.style_group_id and not m.is_deleted
      ) x
      join public.assets a on a.id = x.id
      left join public.style_groups sg on sg.id=a.style_group_id
      cross join visibility_params v
      where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
      limit 1
    ), false)
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), exact_docs as materialized (
    -- Owner ask 2026-10-29 (issue #5053): totals must be exact, never lower
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
          select c.document_type, c.entity_id
          from ordered_candidates c
          where exists (
            select 1
            from (
              select c.asset_id id where c.document_type='asset' and c.asset_id is not null
              union all
              select m.id from public.assets m
              where c.document_type='style_group' and c.style_group_id is not null
                and m.style_group_id=c.style_group_id and not m.is_deleted
            ) x
            join public.assets a on a.id = x.id
            left join public.style_groups sg on sg.id=a.style_group_id
            cross join visibility_params v
            where public.dam_asset_matches_filters(
              a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
              a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
              a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
              a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
              a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
              v.f, v.thumbnail_min_date)
            limit 1
          )
        ) d
      )
    end total_count
  ), summary as materialized (
    select
      (select total_count from exact_docs) total_count,
      case when (select truncated from probe_state)
        -- Facet aggregates count assets, and the probe sees only the first
        -- 1,001; past the cap the per-key counts would be lower bounds, which
        -- the owner ruled out. Emit only the exactness flags; the filter
        -- sidebar shows blanks instead of under-counts (documented fallback
        -- shape, still exact totals).
        then jsonb_build_object(
          'fileType','{}'::jsonb,'status','{}'::jsonb,'workflowStatus','{}'::jsonb,'stage','{}'::jsonb,'isLicensed','{}'::jsonb,
          'totalExact',true,'totalKind','exact')
        else jsonb_build_object(
      'fileType',coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'status',coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'workflowStatus',coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1)x),'{}'::jsonb),
      'stage',coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1)x),'{}'::jsonb),
      'isLicensed',jsonb_build_object('true',(select count(*) from matched_assets where is_licensed is true),'false',(select count(*) from matched_assets where is_licensed is not true)),
      'totalExact',true,
      'totalKind','exact'
    ) end facets
    -- from (select 1): summary is ALWAYS exactly one row, including the
    -- no-match query (total 0). Every select-list item is a scalar
    -- subquery, so a constant anchor row yields the same values as any
    -- matched_assets row would.
    from (select 1) as summary_anchor
  ), page as materialized (
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$_$;

-- FUNCTION public.search_dam_image_similarity(extensions.halfvec, extensions.halfvec, numeric, numeric, integer, integer, text[])
CREATE OR REPLACE FUNCTION public.search_dam_image_similarity(p_query_dino extensions.halfvec, p_query_siglip extensions.halfvec, p_dino_weight numeric DEFAULT 0.60, p_floor numeric DEFAULT 0.90, p_top_k integer DEFAULT 200, p_limit integer DEFAULT 50, p_model_stamps text[] DEFAULT NULL::text[]) RETURNS TABLE(asset_id uuid, dino_pct numeric, siglip_pct numeric, combined_pct numeric, thumbnail_url text, filename text, relative_path text, sku text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'dam', 'extensions'
    SET statement_timeout TO '8s'
    AS $$
declare
  v_stamps text[];
  v_weight numeric := greatest(0, least(coalesce(p_dino_weight, 0.60), 1));
  v_floor  numeric := greatest(0, least(coalesce(p_floor, 0.90), 1));
  -- hnsw.ef_search is hard-capped at 1000 by pgvector; a larger p_top_k
  -- must clamp here or set_config raises at query time.
  v_top_k  int     := greatest(1, least(coalesce(p_top_k, 200), 1000));
  v_limit  int     := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if p_model_stamps is not null and cardinality(array_remove(p_model_stamps, null)) > 0 then
    v_stamps := p_model_stamps;
  else
    select array_agg(distinct s) into v_stamps
    from (
      select (select c.value #>> '{}'
                from public.admin_config c
               where c.key = 'IMAGE_SIM_EMBEDDING_MODEL') as s
      union
      select case when coalesce((select c.value #>> '{}'
                                   from public.admin_config c
                                  where c.key = 'IMAGE_SIM_REEMBED_IN_PROGRESS'), 'false') ilike 'true'
                  then (select c.value #>> '{}'
                          from public.admin_config c
                         where c.key = 'IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS')
             end
    ) t
    where nullif(btrim(s), '') is not null;
  end if;

  if v_stamps is null or cardinality(v_stamps) = 0 then
    return; -- no configured stamp and none supplied: nothing is indexed yet
  end if;

  perform set_config('hnsw.ef_search', greatest(v_top_k, 100)::text, true);

  return query
  with
  dino_ann as (
    select v.asset_id, (1 - (v.vec_dino <=> p_query_dino))::numeric as dino_sim
    from dam.dam_asset_image_vectors v
    where v.vec_dino is not null
      and v.embedding_model = any (v_stamps)
    order by v.vec_dino <=> p_query_dino
    limit v_top_k
  ),
  siglip_ann as (
    select v.asset_id, (1 - (v.vec_siglip <=> p_query_siglip))::numeric as siglip_sim
    from dam.dam_asset_image_vectors v
    where v.vec_siglip is not null
      and v.embedding_model = any (v_stamps)
    order by v.vec_siglip <=> p_query_siglip
    limit v_top_k
  ),
  legs as (
    select coalesce(d.asset_id, s.asset_id) as asset_id,
           d.dino_sim, s.siglip_sim
    from dino_ann d
    full outer join siglip_ann s on s.asset_id = d.asset_id
  ),
  filled as (
    -- exact lookup for the leg an ANN pass missed (Muse: top-K then blend)
    select l.asset_id,
           coalesce(l.dino_sim, (1 - (v.vec_dino <=> p_query_dino))::numeric) as dino_sim,
           coalesce(l.siglip_sim, (1 - (v.vec_siglip <=> p_query_siglip))::numeric) as siglip_sim
    from legs l
    left join dam.dam_asset_image_vectors v
      on v.asset_id = l.asset_id
     and (l.dino_sim is null or l.siglip_sim is null)
     and v.embedding_model = any (v_stamps)
  ),
  blended as (
    select f.asset_id, f.dino_sim, f.siglip_sim,
           (v_weight * f.dino_sim + (1 - v_weight) * f.siglip_sim) as combined
    from filled f
    where f.dino_sim is not null and f.siglip_sim is not null
  )
  select b.asset_id,
         round(b.dino_sim * 100, 1),
         round(b.siglip_sim * 100, 1),
         round(b.combined * 100, 1),
         a.thumbnail_url,
         a.filename,
         a.relative_path,
         a.sku
  from blended b
  join public.assets a
    on a.id = b.asset_id
   and a.is_deleted = false
  where b.combined >= v_floor
  order by b.combined desc
  limit v_limit;
end;
$$;

-- FUNCTION public.search_style_groups_full_text(text, integer)
CREATE OR REPLACE FUNCTION public.search_style_groups_full_text(p_query text, p_limit integer DEFAULT 10000) RETURNS TABLE(style_group_id uuid, rank real)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '8s'
    AS $$
  with ranked as materialized (
    select d.* from public.search_dam_documents(
      p_query,'{}'::jsonb,
      least(20000, greatest(1, least(coalesce(p_limit, 10000), 20000)) * 4),0,
      null::text[],null,0
    ) d
    where d.entity_id is not null
  ), direct_groups as (
    select d.style_group_id, max(d.rank) rank from ranked d
    where d.document_type = 'style_group' and d.style_group_id is not null
    group by d.style_group_id
  ), asset_groups as (
    select d.style_group_id,max(d.rank)*0.8 rank from ranked d
    where d.document_type = 'asset' and d.style_group_id is not null
    group by d.style_group_id
  ), combined as (
    select style_group_id, rank from direct_groups
    union all
    select style_group_id, rank from asset_groups
  )
  select c.style_group_id, max(c.rank)::real rank
  from combined c
  group by c.style_group_id
  order by 2 desc, 1
  limit greatest(1, least(coalesce(p_limit, 10000), 20000));
$$;

-- FUNCTION public.search_style_guide_library(text, text[], text[], text[], text[], text[], timestamp with time zone, timestamp with time zone, text, integer, integer)
CREATE OR REPLACE FUNCTION public.search_style_guide_library(p_query text DEFAULT NULL::text, p_licensors text[] DEFAULT NULL::text[], p_properties text[] DEFAULT NULL::text[], p_style_guides text[] DEFAULT NULL::text[], p_extensions text[] DEFAULT NULL::text[], p_tags text[] DEFAULT NULL::text[], p_modified_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_modified_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_sort text DEFAULT 'relevance'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
with params as (
  select nullif(btrim(coalesce(p_query, '')), '') as q,
         case when lower(coalesce(p_sort, 'relevance')) in ('relevance','modified_desc','modified_asc','name_asc')
              then lower(coalesce(p_sort, 'relevance')) else 'relevance' end as sort_key,
         greatest(1, least(coalesce(p_limit, 50), 200)) as lim,
         greatest(0, coalesce(p_offset, 0)) as off
), tsq as (
  select case when p.q is null then null
              else websearch_to_tsquery('simple', p.q) end as query
    from params p
), filtered as (
  select d.*,
         case when t.query is null then 0::real else ts_rank_cd(d.search_vector, t.query) end as rank
    from public.style_guide_search_documents d
    cross join tsq t
   where d.is_active
     and (t.query is null or d.search_vector @@ t.query)
     and (p_licensors is null or cardinality(p_licensors) = 0 or d.licensor_name = any (p_licensors))
     and (p_properties is null or cardinality(p_properties) = 0 or d.property_folder = any (p_properties))
     and (p_style_guides is null or cardinality(p_style_guides) = 0 or d.style_guide_name = any (p_style_guides))
     and (p_extensions is null or cardinality(p_extensions) = 0 or lower(coalesce(d.file_extension, '')) = any (select lower(x) from unnest(p_extensions) x))
     and (p_tags is null or cardinality(p_tags) = 0 or d.tag_names && p_tags)
     and (p_modified_after is null or d.modified_at >= p_modified_after)
     and (p_modified_before is null or d.modified_at <= p_modified_before)
), page as (
  -- STABLE PAGING. Every ordering ends in style_guide_file_id, which is the
  -- primary key, so the sort is a total order: no page can repeat or skip a row.
  select f.*
    from filtered f, params p
   order by
     case when p.sort_key = 'relevance' then f.rank end desc nulls last,
     case when p.sort_key in ('relevance','modified_desc') then f.modified_at end desc nulls last,
     case when p.sort_key = 'modified_asc' then f.modified_at end asc nulls last,
     case when p.sort_key = 'name_asc' then lower(f.filename) end asc nulls last,
     f.style_guide_file_id
   offset (select off from params)
   limit (select lim from params)
)
select jsonb_build_object(
  'total', (select count(*) from filtered),
  'limit', (select lim from params),
  'offset', (select off from params),
  'sort', (select sort_key from params),
  'query', (select q from params),
  'results', coalesce((
    select jsonb_agg(jsonb_build_object(
      'style_guide_file_id', pg.style_guide_file_id,
      'root_label', pg.root_label,
      'licensor_name', pg.licensor_name,
      'property_folder', pg.property_folder,
      'style_guide_name', pg.style_guide_name,
      'directory_path', pg.directory_path,
      'relative_path', pg.relative_path,
      'filename', pg.filename,
      'file_extension', pg.file_extension,
      'tag_names', to_jsonb(pg.tag_names),
      'size_bytes', pg.size_bytes,
      'modified_at', pg.modified_at,
      'thumbnail_url', pg.thumbnail_url,
      'pdf_text_status', pg.pdf_text_status,
      'pdf_text_length', pg.pdf_text_length,
      'rank', pg.rank
    ) order by pg.rn)
    from (select page.*, row_number() over () as rn from page) pg
  ), '[]'::jsonb),
  'facets', jsonb_build_object(
    'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select licensor_name as v, count(*) as c from filtered
                                  where licensor_name is not null group by 1) s), '[]'::jsonb),
    'properties', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select property_folder as v, count(*) as c from filtered
                                  where property_folder is not null group by 1) s), '[]'::jsonb),
    'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select style_guide_name as v, count(*) as c from filtered group by 1) s), '[]'::jsonb),
    'extensions', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select lower(file_extension) as v, count(*) as c from filtered
                                  where file_extension is not null group by 1) s), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select tag as v, count(*) as c from filtered, unnest(tag_names) tag group by 1) s), '[]'::jsonb)
  )
);
$$;

-- FUNCTION public.search_style_guide_library_v2(text, text, text[], text[], text[], text[], text[], text[], text[], text[], timestamp with time zone, timestamp with time zone, text, integer, integer, extensions.vector, real, text, boolean)
CREATE OR REPLACE FUNCTION public.search_style_guide_library_v2(p_result_mode text DEFAULT 'files'::text, p_query text DEFAULT NULL::text, p_licensors text[] DEFAULT NULL::text[], p_properties text[] DEFAULT NULL::text[], p_style_guides text[] DEFAULT NULL::text[], p_extensions text[] DEFAULT NULL::text[], p_tags text[] DEFAULT NULL::text[], p_preview_states text[] DEFAULT NULL::text[], p_render_exception_states text[] DEFAULT NULL::text[], p_pdf_content_states text[] DEFAULT NULL::text[], p_modified_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_modified_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_sort text DEFAULT 'relevance'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_semantic_score real DEFAULT NULL::real, p_fallback_query text DEFAULT NULL::text, p_include_facets boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'auth'
    SET work_mem TO '64MB'
    SET statement_timeout TO '30s'
    AS $_$
declare
  v_mode text := lower(coalesce(nullif(btrim(p_result_mode), ''), 'files'));
  v_sort text;
  v_lim integer;
  v_off integer;
  v_total bigint;
  v_facets jsonb;
  v_ids uuid[];
  v_result jsonb;
begin
  -- HNSW candidate list for the semantic leg (transaction-local; harmless on
  -- the keyword-only path). Mirrors the reviewed DAM leg.
  perform set_config('hnsw.ef_search', '100', true);

  -- SECURITY DEFINER is intentional: authorization is decided here before the
  -- result set is counted or paged, instead of depending on permissive legacy
  -- table policies.
  if coalesce(auth.role(), '') <> 'service_role'
     and (
       auth.uid() is null
       or not public.has_app_access(auth.uid(), 'styleguides'::public.app_name)
     ) then
    raise exception 'PopSG access required' using errcode = '42501';
  end if;

  if v_mode not in ('files', 'guides') then
    raise exception 'p_result_mode must be files or guides' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_preview_states, '{}'::text[])) as u(value)
     where lower(u.value) not in ('available', 'missing')
  ) then
    raise exception 'invalid preview state' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_render_exception_states, '{}'::text[])) as u(value)
     where lower(u.value) not in ('none', 'waiting', 'recoverable_error', 'terminal_exception', 'unclassified')
  ) then
    raise exception 'invalid render exception state' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_pdf_content_states, '{}'::text[])) as u(value)
     where lower(u.value) not in ('available', 'unavailable', 'not_applicable')
  ) then
    raise exception 'invalid PDF content state' using errcode = '22023';
  end if;

  -- Unfiltered default browse (#3009): no query and no filter of any kind.
  -- Totals, facets and Guides rows come from the refreshed snapshot; Files page
  -- rows stay live. Anything else, an absent snapshot, or the session setting
  -- popsg.library_snapshot_bypass = 'on' (used by equivalence tests) runs the
  -- full body below, unchanged.
  if nullif(btrim(coalesce(p_query, '')), '') is null
     and coalesce(cardinality(p_licensors), 0) = 0
     and coalesce(cardinality(p_properties), 0) = 0
     and coalesce(cardinality(p_style_guides), 0) = 0
     and coalesce(cardinality(p_extensions), 0) = 0
     and coalesce(cardinality(p_tags), 0) = 0
     and coalesce(cardinality(p_preview_states), 0) = 0
     and coalesce(cardinality(p_render_exception_states), 0) = 0
     and coalesce(cardinality(p_pdf_content_states), 0) = 0
     and p_modified_after is null
     and p_modified_before is null
     and p_query_embedding is null
     and coalesce(current_setting('popsg.library_snapshot_bypass', true), '') <> 'on' then
    select s.total, s.facets into v_total, v_facets
      from public.style_guide_library_default_summary s
     where s.result_mode = v_mode;
  end if;

  if v_facets is not null then
    v_sort := case
      when lower(coalesce(p_sort, 'relevance')) in ('relevance', 'modified_desc', 'modified_asc', 'name_asc')
        then lower(coalesce(p_sort, 'relevance'))
      else 'relevance'
    end;
    v_lim := greatest(1, least(coalesce(p_limit, 50), 200));
    v_off := greatest(0, coalesce(p_offset, 0));

    if v_mode = 'files' then
      -- With no query every rank is 0, so relevance equals modified_desc. The
      -- uuid tie-break orders exactly like its lowercase canonical text.
      if v_sort in ('relevance', 'modified_desc') then
        select array_agg(x.id order by x.ord) into v_ids from (
          select y.id, row_number() over () as ord from (
            select d.style_guide_file_id as id
              from public.style_guide_search_documents d
             where d.is_active
               and exists (select 1 from public.style_guide_files f
                            where f.id = d.style_guide_file_id and f.is_active)
             order by d.modified_at desc nulls last, d.style_guide_file_id
             limit v_lim offset v_off) y) x;
      elsif v_sort = 'modified_asc' then
        select array_agg(x.id order by x.ord) into v_ids from (
          select y.id, row_number() over () as ord from (
            select d.style_guide_file_id as id
              from public.style_guide_search_documents d
             where d.is_active
               and exists (select 1 from public.style_guide_files f
                            where f.id = d.style_guide_file_id and f.is_active)
             order by d.modified_at asc nulls last, d.style_guide_file_id
             limit v_lim offset v_off) y) x;
      else
        select array_agg(x.id order by x.ord) into v_ids from (
          select y.id, row_number() over () as ord from (
            select d.style_guide_file_id as id
              from public.style_guide_search_documents d
             where d.is_active
               and exists (select 1 from public.style_guide_files f
                            where f.id = d.style_guide_file_id and f.is_active)
             order by lower(d.filename) asc nulls last, d.style_guide_file_id
             limit v_lim offset v_off) y) x;
      end if;

      select coalesce(jsonb_agg(jsonb_build_object(
          'result_mode', 'files',
          'style_guide_file_id', d.style_guide_file_id,
          'root_label', d.root_label,
          'licensor_name', d.licensor_name,
          'property_folder', d.property_folder,
          'style_guide_folder', d.style_guide_folder,
          'style_guide_name', d.style_guide_name,
          'directory_path', d.directory_path,
          'relative_path', d.relative_path,
          'filename', d.filename,
          'file_extension', d.file_extension,
          'tag_names', to_jsonb(d.tag_names),
          'size_bytes', d.size_bytes,
          'modified_at', d.modified_at,
          'thumbnail_url', f.thumbnail_url,
          'preview_state', case when f.thumbnail_url is not null then 'available' else 'missing' end,
          'render_exception_state', case
             when f.thumbnail_url is not null then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.thumbnail_error is not null or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end,
          'pdf_content_state', case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end,
          'pdf_text_status', d.pdf_text_status,
          'pdf_text_length', d.pdf_text_length,
          'rank', 0::real
        ) order by ids.ord), '[]'::jsonb)
        into v_result
        from unnest(v_ids) with ordinality as ids(id, ord)
        join public.style_guide_search_documents d on d.style_guide_file_id = ids.id
        join public.style_guide_files f on f.id = ids.id
        left join lateral (
          select
            bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
            bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
            bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
          from public.style_guide_render_queue q
          where q.style_guide_file_id = ids.id
        ) r on true;
    else
      select coalesce(jsonb_agg(x.result order by x.ord), '[]'::jsonb) into v_result from (
        select y.result, row_number() over () as ord from (
          select g.result
            from public.style_guide_library_default_guides g
           order by
             case when v_sort in ('relevance', 'modified_desc') then g.modified_at end desc nulls last,
             case when v_sort = 'modified_asc' then g.modified_at end asc nulls last,
             case when v_sort = 'name_asc' then g.sort_name end asc nulls last,
             g.entity_key
           limit v_lim offset v_off) y) x;
    end if;

    return jsonb_build_object(
      'result_mode', v_mode,
      'total', v_total,
      'limit', v_lim,
      'offset', v_off,
      'sort', v_sort,
      'query', null,
      'results', v_result,
      'facets', case when coalesce(p_include_facets, true) then v_facets else '{}'::jsonb end
    );
  end if;

  if v_mode = 'files' then
with params as not materialized (
    select
      nullif(btrim(coalesce(p_query, '')), '') as q,
      case
        when lower(coalesce(p_sort, 'relevance')) in
          ('relevance', 'modified_desc', 'modified_asc', 'name_asc')
          then lower(coalesce(p_sort, 'relevance'))
        else 'relevance'
      end as sort_key,
      greatest(1, least(coalesce(p_limit, 50), 200)) as lim,
      greatest(0, coalesce(p_offset, 0)) as off,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest(p_preview_states) as u(value)), '{}'::text[]) as preview_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest(p_render_exception_states) as u(value)), '{}'::text[]) as render_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest(p_pdf_content_states) as u(value)), '{}'::text[]) as pdf_states,
      (p_query_embedding is not null) as has_embedding,
      case when p_min_semantic_score is null then null
           else greatest(0, least(1, p_min_semantic_score))::real end as min_semantic_score
  ), tsq as materialized (
    -- #887: rows matching only the optional fallback query are listed after every
    -- row matching the main query. Without a usable fallback, match_query = query.
    select x.query,
           case when x.usable then x.fallback end as fallback,
           case when x.usable then x.query || x.fallback else x.query end as match_query
      from (
        select w.query, w.fallback,
               coalesce(numnode(w.query) > 0 and numnode(w.fallback) > 0, false) as usable
          from (
            select case when p.q is null then null
                        else websearch_to_tsquery('simple', p.q) end as query,
                   case when nullif(btrim(coalesce(p_fallback_query, '')), '') is null then null
                        else websearch_to_tsquery('simple', btrim(p_fallback_query)) end as fallback
              from params p
          ) w
      ) x
  ), semantic_candidates as materialized (
    -- Semantic leg: authorization ran at function entry and every row below is
    -- re-filtered by the same active/facet predicates inside active_children.
    -- HNSW returns distance order only; no secondary sort key (20261025163006).
    -- ANN cap 2000 with ef_search 100 mirrors the reviewed DAM leg; PopSG's
    -- corpus is separated by table.
    select d.style_guide_file_id,
           greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding))::real as semantic_rank
      from params p
      join public.style_guide_search_documents d
        on p.has_embedding
       and d.is_active
       and d.embedding is not null
       and d.embedding_model = 'google/siglip2-base-patch16-naflex'
     where p.min_semantic_score is null
        or greatest(0, 1 - (d.embedding operator(extensions.<=>) p_query_embedding)) >= p.min_semantic_score
     order by d.embedding operator(extensions.<=>) p_query_embedding
     limit 2000
  ), render_rollup as materialized (
    select
      q.style_guide_file_id,
      bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
      bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
      bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
    from public.style_guide_render_queue q
    group by q.style_guide_file_id
  ), live_files as not materialized (
    select s.style_guide_file_id as id, s.has_preview, s.has_error
      from public.style_guide_file_preview_state s
     where s.is_active
  ), active_children as materialized (
    select
      d.style_guide_file_id, d.licensor_name, d.property_folder, d.style_guide_name,
      lower(d.file_extension) as extension, d.tag_names, d.modified_at,
      case when p.sort_key = 'name_asc' then lower(d.filename) end as sort_name,
      case when f.has_preview then 'available' else 'missing' end as preview_state,
      case
        when f.has_preview then 'none'
        when coalesce(r.has_open_work, false) then 'waiting'
        when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
        when f.has_error or coalesce(r.has_terminal_error, false) then 'terminal_exception'
        else 'unclassified'
      end as render_exception_state,
      case
        when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
        when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
        else 'unavailable'
      end as pdf_content_state,
      -- keyword parity when no embedding is supplied (semantic_candidates is
      -- empty then, so sc.semantic_rank is null and coalesce yields the bare
      -- keyword rank, byte-identical to the previous ordering)
      case when t.query is null then 0::real
           else ts_rank_cd('{0.005,0.2,0.4,1.0}'::real[], d.search_vector,
                           -- #887: a row that does not match every word in its names, folders or
                           -- tags is ranked as the fallback search would rank it
                           case when t.fallback is not null
                                 and not (ts_filter(d.search_vector, '{a,b,c}') @@ t.query)
                                then t.fallback else t.query end)
                -- With a query vector, words that match always outrank meaning-only rows.
                + case when p.has_embedding and d.search_vector @@ t.query then 0.35 else 0 end end
        + coalesce(sc.semantic_rank, 0) * 0.35 as rank,
      -- PDF body text (weight D) only breaks ties (20261105023331), so an all-word
      -- match found only there does not outrank the fallback's own name matches.
      (t.fallback is not null
       and not (ts_filter(d.search_vector, '{a,b,c}') @@ t.query)) as fallback_only
    from (
      -- Three disjoint index-driven arms: keyword matches (GIN), the whole
      -- active corpus when no query text (snapshot bypass / embedding-only
      -- browse), and semantic candidates the keyword leg missed (HNSW).
      select m.* from public.style_guide_search_documents m, tsq mt
       where mt.query is not null and m.is_active and m.search_vector @@ mt.match_query
      union all
      select a.* from public.style_guide_search_documents a, tsq at
       where at.query is null and a.is_active
      union all
      select s.* from public.style_guide_search_documents s
        join semantic_candidates sc0 on sc0.style_guide_file_id = s.style_guide_file_id
       where s.is_active
         and not exists (select 1 from tsq st where st.query is null or s.search_vector @@ st.match_query)
    ) d
    join live_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    left join semantic_candidates sc on sc.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where true
      and (p_licensors is null or cardinality(p_licensors) = 0 or d.licensor_name = any (p_licensors))
      and (p_properties is null or cardinality(p_properties) = 0 or d.property_folder = any (p_properties))
      and (p_style_guides is null or cardinality(p_style_guides) = 0 or d.style_guide_name = any (p_style_guides))
      and (p_extensions is null or cardinality(p_extensions) = 0
           or lower(coalesce(d.file_extension, '')) = any (
             select lower(u.value) from unnest(p_extensions) as u(value)
           ))
      and (p_tags is null or cardinality(p_tags) = 0 or d.tag_names && p_tags)
      and (p_modified_after is null or d.modified_at >= p_modified_after)
      and (p_modified_before is null or d.modified_at <= p_modified_before)
      and (cardinality(p.preview_states) = 0
           or (case when f.has_preview then 'available' else 'missing' end) = any (p.preview_states))
      and (cardinality(p.render_states) = 0 or case
             when f.has_preview then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.has_error or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end = any (p.render_states))
      and (cardinality(p.pdf_states) = 0 or case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end = any (p.pdf_states))
  ), page as materialized (select e.*,row_number() over(order by case when p.sort_key = 'relevance' then e.fallback_only end, case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key) as rn from (select c.style_guide_file_id::text as entity_key,c.style_guide_file_id,c.fallback_only,c.rank,c.modified_at,c.sort_name,c.preview_state,c.render_exception_state,c.pdf_content_state from active_children c cross join params p order by case when p.sort_key = 'relevance' then c.fallback_only end, case when p.sort_key = 'relevance' then c.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then c.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then c.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then c.sort_name end asc nulls last,
             c.style_guide_file_id::text limit (select lim from params) offset (select off from params)) e cross join params p
  )
  select jsonb_build_object(
    'result_mode', v_mode,
    'total', (select count(*) from active_children),
    'limit', p.lim,
    'offset', p.off,
    'sort', p.sort_key,
    'query', p.q,
    'results', coalesce((select jsonb_agg(jsonb_build_object(
        'result_mode', 'files',
        'style_guide_file_id', d.style_guide_file_id,
        'root_label', d.root_label,
        'licensor_name', d.licensor_name,
        'property_folder', d.property_folder,
        'style_guide_folder', d.style_guide_folder,
        'style_guide_name', d.style_guide_name,
        'directory_path', d.directory_path,
        'relative_path', d.relative_path,
        'filename', d.filename,
        'file_extension', d.file_extension,
        'tag_names', to_jsonb(d.tag_names),
        'size_bytes', d.size_bytes,
        'modified_at', d.modified_at,
        'thumbnail_url', live_payload.thumbnail_url,
        'preview_state', pg.preview_state,
        'render_exception_state', pg.render_exception_state,
        'pdf_content_state', pg.pdf_content_state,
        'pdf_text_status', d.pdf_text_status,
        'pdf_text_length', d.pdf_text_length,
        'rank', pg.rank
      ) order by pg.rn) from page pg join public.style_guide_search_documents d on d.style_guide_file_id=pg.style_guide_file_id left join public.style_guide_files live_payload on live_payload.id=pg.style_guide_file_id), '[]'::jsonb),
    'facets', case when coalesce(p_include_facets, true) then jsonb_build_object(
      'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select c.licensor_name value, count(*) count from active_children c
                                     where c.licensor_name is not null group by 1) facet), '[]'::jsonb),
      'properties', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select c.property_folder value, count(*) count from active_children c
                                     where c.property_folder is not null group by 1) facet), '[]'::jsonb),
      'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                from (select c.style_guide_name value, count(*) count from active_children c group by 1) facet), '[]'::jsonb),
      'extensions', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select c.extension value, count(*) count from active_children c
                                     where c.extension is not null group by 1) facet), '[]'::jsonb),
      'tags', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                        from (select t.value, count(*) count from active_children c
                               cross join lateral unnest(c.tag_names) t(value) group by 1) facet), '[]'::jsonb),
      'preview_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                  from (select c.preview_state value, count(*) count from active_children c group by 1) facet), '[]'::jsonb),
      'render_exception_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                           from (select c.render_exception_state value, count(*) count from active_children c group by 1) facet), '[]'::jsonb),
      'pdf_content_states', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                      from (select c.pdf_content_state value, count(*) count from active_children c group by 1) facet), '[]'::jsonb)
    ) else '{}'::jsonb end
  ) into v_result
  from params p;
  else
execute $guides_query$
with params as not materialized (
    select
      nullif(btrim(coalesce($2, '')), '') as q,
      case
        when lower(coalesce($13, 'relevance')) in
          ('relevance', 'modified_desc', 'modified_asc', 'name_asc')
          then lower(coalesce($13, 'relevance'))
        else 'relevance'
      end as sort_key,
      greatest(1, least(coalesce($14, 50), 200)) as lim,
      greatest(0, coalesce($15, 0)) as off,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest($8) as u(value)), '{}'::text[]) as preview_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest($9) as u(value)), '{}'::text[]) as render_states,
      coalesce((select array_agg(distinct lower(u.value))
                  from unnest($10) as u(value)), '{}'::text[]) as pdf_states,
      ($16 is not null) as has_embedding,
      case when $17 is null then null
           else greatest(0, least(1, $17))::real end as min_semantic_score
  ), tsq as materialized (
    -- #887: rows matching only the optional fallback query are listed after every
    -- row matching the main query. Without a usable fallback, match_query = query.
    select x.query,
           case when x.usable then x.fallback end as fallback,
           case when x.usable then x.query || x.fallback else x.query end as match_query
      from (
        select w.query, w.fallback,
               coalesce(numnode(w.query) > 0 and numnode(w.fallback) > 0, false) as usable
          from (
            select case when p.q is null then null
                        else websearch_to_tsquery('simple', p.q) end as query,
                   case when nullif(btrim(coalesce($18, '')), '') is null then null
                        else websearch_to_tsquery('simple', btrim($18)) end as fallback
              from params p
          ) w
      ) x
  ), semantic_candidates as materialized (
    -- see the files-mode copy: same ANN contract, positional binding
    select d.style_guide_file_id,
           greatest(0, 1 - (d.embedding operator(extensions.<=>) $16))::real as semantic_rank
      from params p
      join public.style_guide_search_documents d
        on p.has_embedding
       and d.is_active
       and d.embedding is not null
       and d.embedding_model = 'google/siglip2-base-patch16-naflex'
     where p.min_semantic_score is null
        or greatest(0, 1 - (d.embedding operator(extensions.<=>) $16)) >= p.min_semantic_score
     order by d.embedding operator(extensions.<=>) $16
     limit 2000
  ), render_rollup as materialized (
    select
      q.style_guide_file_id,
      bool_or(q.status in ('pending', 'claimed', 'processing')) as has_open_work,
      bool_or(q.status = 'failed' and q.attempts < 3) as has_recoverable_error,
      bool_or(q.status = 'failed' and q.attempts >= 3) as has_terminal_error
    from public.style_guide_render_queue q
    group by q.style_guide_file_id
  ), live_files as not materialized (
    select s.style_guide_file_id as id, s.has_preview, s.has_error
      from public.style_guide_file_preview_state s
     where s.is_active
  ), active_children as materialized (
    select
      d.style_guide_file_id, d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
      lower(d.file_extension) as extension, d.tag_names, d.modified_at,
      f.has_preview, f.has_error,
      coalesce(r.has_open_work, false) as has_open_work,
      coalesce(r.has_recoverable_error, false) as has_recoverable_error,
      coalesce(r.has_terminal_error, false) as has_terminal_error,
      ((d.pdf_text_status = 'extracted' and d.pdf_text_length > 0) is true) as pdf_text_available,
      -- keyword parity when no embedding is supplied (semantic_candidates is
      -- empty then, so sc.semantic_rank is null and coalesce yields the bare
      -- keyword rank, byte-identical to the previous ordering)
      case when t.query is null then 0::real
           else ts_rank_cd('{0.005,0.2,0.4,1.0}'::real[], d.search_vector,
                           -- #887: a row that does not match every word in its names, folders or
                           -- tags is ranked as the fallback search would rank it
                           case when t.fallback is not null
                                 and not (ts_filter(d.search_vector, '{a,b,c}') @@ t.query)
                                then t.fallback else t.query end)
                -- With a query vector, words that match always outrank meaning-only rows.
                + case when p.has_embedding and d.search_vector @@ t.query then 0.35 else 0 end end
        + coalesce(sc.semantic_rank, 0) * 0.35 as rank,
      -- PDF body text (weight D) only breaks ties (20261105023331), so an all-word
      -- match found only there does not outrank the fallback's own name matches.
      (t.fallback is not null
       and not (ts_filter(d.search_vector, '{a,b,c}') @@ t.query)) as fallback_only
    from (
      select m.* from public.style_guide_search_documents m, tsq mt
       where mt.query is not null and m.is_active and m.search_vector @@ mt.match_query
      union all
      select a.* from public.style_guide_search_documents a, tsq at
       where at.query is null and a.is_active
      union all
      select s.* from public.style_guide_search_documents s
        join semantic_candidates sc0 on sc0.style_guide_file_id = s.style_guide_file_id
       where s.is_active
         and not exists (select 1 from tsq st where st.query is null or s.search_vector @@ st.match_query)
    ) d
    join live_files f on f.id = d.style_guide_file_id
    left join render_rollup r on r.style_guide_file_id = d.style_guide_file_id
    left join semantic_candidates sc on sc.style_guide_file_id = d.style_guide_file_id
    cross join tsq t
    cross join params p
    where true
      and ($3 is null or cardinality($3) = 0 or d.licensor_name = any ($3))
      and ($4 is null or cardinality($4) = 0 or d.property_folder = any ($4))
      and ($5 is null or cardinality($5) = 0 or d.style_guide_name = any ($5))
      and ($6 is null or cardinality($6) = 0
           or lower(coalesce(d.file_extension, '')) = any (
             select lower(u.value) from unnest($6) as u(value)
           ))
      and ($7 is null or cardinality($7) = 0 or d.tag_names && $7)
      and ($11 is null or d.modified_at >= $11)
      and ($12 is null or d.modified_at <= $12)
      and (cardinality(p.preview_states) = 0
           or (case when f.has_preview then 'available' else 'missing' end) = any (p.preview_states))
      and (cardinality(p.render_states) = 0 or case
             when f.has_preview then 'none'
             when coalesce(r.has_open_work, false) then 'waiting'
             when coalesce(r.has_recoverable_error, false) then 'recoverable_error'
             when f.has_error or coalesce(r.has_terminal_error, false) then 'terminal_exception'
             else 'unclassified'
           end = any (p.render_states))
      and (cardinality(p.pdf_states) = 0 or case
             when lower(coalesce(d.file_extension, '')) <> 'pdf' then 'not_applicable'
             when d.pdf_text_status = 'extracted' and d.pdf_text_length > 0 then 'available'
             else 'unavailable'
           end = any (p.pdf_states))
  ), entities as materialized (
    select
      concat_ws(chr(31), g.root_label, coalesce(g.licensor_name,''), coalesce(g.property_folder,''), coalesce(g.style_guide_folder,''), g.style_guide_name) as entity_key,
      concat_ws(chr(31),
        coalesce(length(g.root_label)||':'||g.root_label, '-'),
        coalesce(length(g.licensor_name)||':'||g.licensor_name, '-'),
        coalesce(length(g.property_folder)||':'||g.property_folder, '-'),
        coalesce(length(g.style_guide_folder)||':'||g.style_guide_folder, '-'),
        coalesce(length(g.style_guide_name)||':'||g.style_guide_name, '-')) as group_id,
      g.fallback_only, g.rank, g.modified_at, lower(g.style_guide_name) as sort_name,
      g.root_label, g.licensor_name, g.property_folder, g.style_guide_folder, g.style_guide_name
    from (
      select
        d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
        bool_and(d.fallback_only) as fallback_only,
        coalesce(max(d.rank) filter (where not d.fallback_only), max(d.rank)) as rank,
        max(d.modified_at) as modified_at
      from active_children d
      group by d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name
    ) g
  ), guide_facets as materialized (
    select category,
           jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value) as facet_values
      from (
        select category, value, count(*) as count
          from (
            select distinct
              d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
              'tags'::text as category, tag.value
            from active_children d
            cross join lateral unnest(d.tag_names) tag(value)
            where tag.value is not null
            union all
            select
              d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
              f.category, f.value
            from (
              select distinct
                c.root_label, c.licensor_name, c.property_folder, c.style_guide_folder, c.style_guide_name,
                c.extension, c.has_preview, c.has_open_work, c.has_recoverable_error, c.has_error,
                c.has_terminal_error, c.pdf_text_available
              from active_children c
            ) d
            cross join lateral (
              select 'extensions'::text as category, d.extension as value
               where d.extension is not null
              union all
              select 'preview_states',
                     case when d.has_preview then 'available' else 'missing' end
              union all
              select 'render_exception_states',
                     case
                       when d.has_preview then 'none'
                       when d.has_open_work then 'waiting'
                       when d.has_recoverable_error then 'recoverable_error'
                       when d.has_error or d.has_terminal_error then 'terminal_exception'
                       else 'unclassified'
                     end
              union all
              select 'pdf_content_states',
                     case
                       when coalesce(d.extension, '') <> 'pdf' then 'not_applicable'
                       when d.pdf_text_available then 'available'
                       else 'unavailable'
                     end
            ) f(category, value)
            group by d.root_label, d.licensor_name, d.property_folder, d.style_guide_folder, d.style_guide_name,
                     f.category, f.value
          ) pairs
         group by category, value
      ) counts
     group by category
  ), page as materialized (select e.*,row_number() over(order by case when p.sort_key = 'relevance' then e.fallback_only end, case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key) as rn from (select e.* from entities e cross join params p order by case when p.sort_key = 'relevance' then e.fallback_only end, case when p.sort_key = 'relevance' then e.rank end desc nulls last,
             case when p.sort_key in ('relevance', 'modified_desc') then e.modified_at end desc nulls last,
             case when p.sort_key = 'modified_asc' then e.modified_at end asc nulls last,
             case when p.sort_key = 'name_asc' then e.sort_name end asc nulls last,
             e.entity_key limit (select lim from params) offset (select off from params)) e cross join params p
  ), page_children as materialized (
    select d.*, pg.group_id
    from active_children d
    join page pg
      on pg.group_id = concat_ws(chr(31),
        coalesce(length(d.root_label)||':'||d.root_label, '-'),
        coalesce(length(d.licensor_name)||':'||d.licensor_name, '-'),
        coalesce(length(d.property_folder)||':'||d.property_folder, '-'),
        coalesce(length(d.style_guide_folder)||':'||d.style_guide_folder, '-'),
        coalesce(length(d.style_guide_name)||':'||d.style_guide_name, '-'))
  ), page_thumb_ids as materialized (
    select d.group_id,
           (array_agg(d.style_guide_file_id
              order by d.modified_at desc nulls last, d.style_guide_file_id)
            filter (where d.has_preview))[1] as style_guide_file_id
      from page_children d
     group by d.group_id
  ), page_thumb as materialized (
    select t.group_id, f.thumbnail_url
      from page_thumb_ids t
      join public.style_guide_files f on f.id = t.style_guide_file_id
  ), page_metadata as materialized (
    select d.group_id,
           count(distinct d.style_guide_file_id) as matched_file_count,
           coalesce(array_agg(distinct d.extension) filter (where d.extension is not null), '{}'::text[]) as file_extensions,
           max(d.modified_at) as modified_at,
           array_agg(distinct
                      case when d.has_preview then 'available' else 'missing' end
                      order by case when d.has_preview then 'available' else 'missing' end
                    ) as preview_states,
           array_agg(distinct
                      case
                        when d.has_preview then 'none'
                        when d.has_open_work then 'waiting'
                        when d.has_recoverable_error then 'recoverable_error'
                        when d.has_error or d.has_terminal_error then 'terminal_exception'
                        else 'unclassified'
                      end
                      order by
                      case
                        when d.has_preview then 'none'
                        when d.has_open_work then 'waiting'
                        when d.has_recoverable_error then 'recoverable_error'
                        when d.has_error or d.has_terminal_error then 'terminal_exception'
                        else 'unclassified'
                      end
                    ) as render_exception_states,
           array_agg(distinct
                      case
                        when coalesce(d.extension, '') <> 'pdf' then 'not_applicable'
                        when d.pdf_text_available then 'available'
                        else 'unavailable'
                      end
                      order by
                      case
                        when coalesce(d.extension, '') <> 'pdf' then 'not_applicable'
                        when d.pdf_text_available then 'available'
                        else 'unavailable'
                      end
                    ) as pdf_content_states,
           max(d.rank) as rank
      from page_children d
     group by d.group_id
  ), page_tags as materialized (
    select d.group_id,
           coalesce(array_agg(distinct tag.value order by tag.value) filter (where tag.value is not null), '{}'::text[]) as tag_names
      from page_children d
      left join lateral unnest(d.tag_names) tag(value) on true
     group by d.group_id
  ), page_results as (
 select pg.rn,jsonb_build_object('result_mode','guides','guide_key',pg.entity_key,
 'root_label',pg.root_label,'licensor_name',pg.licensor_name,'property_folder',pg.property_folder,
 'style_guide_folder',pg.style_guide_folder,'style_guide_name',pg.style_guide_name,
 'matched_file_count',m.matched_file_count,'file_extensions',to_jsonb(m.file_extensions),'tag_names',to_jsonb(t.tag_names),
 'modified_at',m.modified_at,'thumbnail_url',th.thumbnail_url,'preview_states',to_jsonb(m.preview_states),
 'render_exception_states',to_jsonb(m.render_exception_states),'pdf_content_states',to_jsonb(m.pdf_content_states),'rank',m.rank) as result
 from page pg join page_metadata m on m.group_id=pg.group_id join page_tags t on t.group_id=pg.group_id
 left join page_thumb th on th.group_id=pg.group_id
)
  select jsonb_build_object(
    'result_mode', $1,
    'total', (select count(*) from entities),
    'limit', p.lim,
    'offset', p.off,
    'sort', p.sort_key,
    'query', p.q,
    'results', coalesce((select jsonb_agg(pg.result order by pg.rn) from page_results pg), '[]'::jsonb),
    'facets', case when coalesce($19, true) then jsonb_build_object(
      'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select licensor_name value, count(*) count from entities
                                     where licensor_name is not null group by 1) facet), '[]'::jsonb),
      'properties', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                              from (select property_folder value, count(*) count from entities
                                     where property_folder is not null group by 1) facet), '[]'::jsonb),
      'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'count', count) order by count desc, value)
                                from (select style_guide_name value, count(*) count from entities group by 1) facet), '[]'::jsonb),
      'extensions', coalesce((select facet_values from guide_facets where category='extensions'), '[]'::jsonb),
      'tags', coalesce((select facet_values from guide_facets where category='tags'), '[]'::jsonb),
      'preview_states', coalesce((select facet_values from guide_facets where category='preview_states'), '[]'::jsonb),
      'render_exception_states', coalesce((select facet_values from guide_facets where category='render_exception_states'), '[]'::jsonb),
      'pdf_content_states', coalesce((select facet_values from guide_facets where category='pdf_content_states'), '[]'::jsonb)
    ) else '{}'::jsonb end
  ) 
  from params p
$guides_query$ into v_result using v_mode, p_query, p_licensors, p_properties, p_style_guides, p_extensions, p_tags, p_preview_states, p_render_exception_states, p_pdf_content_states, p_modified_after, p_modified_before, p_sort, p_limit, p_offset, p_query_embedding, p_min_semantic_score, p_fallback_query, p_include_facets;
  end if;
  return v_result;
end
$_$;

-- FUNCTION public.sku_declared_style_guide_label(text)
CREATE OR REPLACE FUNCTION public.sku_declared_style_guide_label(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  select case when p_text ~* 'style\s+guide\s+used\s*:' then
    btrim(btrim((regexp_match(p_text,
      '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]), E' \t.,;:') end
$$;

-- FUNCTION public.sku_sg_file_exact_filename_key()
CREATE OR REPLACE FUNCTION public.sku_sg_file_exact_filename_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.exact_filename is distinct from old.exact_filename
     or new.sku_sg_file_key is null or new.sku_sg_file_key is distinct from old.sku_sg_file_key then
    new.sku_sg_file_key := coalesce(public.file_name_norm(new.exact_filename), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_file_file_name_key()
CREATE OR REPLACE FUNCTION public.sku_sg_file_file_name_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.file_name is distinct from old.file_name
     or new.sku_sg_file_key is null or new.sku_sg_file_key is distinct from old.sku_sg_file_key then
    new.sku_sg_file_key := coalesce(public.file_name_norm(new.file_name), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_file_original_file_name_key()
CREATE OR REPLACE FUNCTION public.sku_sg_file_original_file_name_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.original_file_name is distinct from old.original_file_name
     or new.sku_sg_file_key is null or new.sku_sg_file_key is distinct from old.sku_sg_file_key then
    new.sku_sg_file_key := coalesce(public.file_name_norm(new.original_file_name), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_label_exact_label_key()
CREATE OR REPLACE FUNCTION public.sku_sg_label_exact_label_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.exact_label is distinct from old.exact_label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.exact_label), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_label_folder_name_key()
CREATE OR REPLACE FUNCTION public.sku_sg_label_folder_name_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.folder_name is distinct from old.folder_name
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.folder_name), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_label_label_key()
CREATE OR REPLACE FUNCTION public.sku_sg_label_label_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.label is distinct from old.label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.label), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_label_style_guide_label_key()
CREATE OR REPLACE FUNCTION public.sku_sg_label_style_guide_label_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.style_guide_label is distinct from old.style_guide_label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.style_guide_label), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_label_value_label_key()
CREATE OR REPLACE FUNCTION public.sku_sg_label_value_label_key() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.value_label is distinct from old.value_label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.value_label), '');
  end if;
  return new;
end $$;

-- FUNCTION public.sku_sg_pdf_keys()
CREATE OR REPLACE FUNCTION public.sku_sg_pdf_keys() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.extracted_text is distinct from old.extracted_text
     or new.declared_style_guide_key is null
     or new.declared_style_guide_key is distinct from old.declared_style_guide_key
     or new.declared_style_guide_label is distinct from old.declared_style_guide_label then
    new.declared_style_guide_label := public.sku_declared_style_guide_label(new.extracted_text);
    new.declared_style_guide_key := coalesce(public.style_guide_label_norm(new.declared_style_guide_label), '');
  end if;
  return new;
end $$;

-- FUNCTION public.stamp_style_group_asset_change()
CREATE OR REPLACE FUNCTION public.stamp_style_group_asset_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR ROW(NEW.relative_path, NEW.filename, NEW.file_type, NEW.is_licensed, NEW.licensor_id, NEW.licensor_code, NEW.licensor_name, NEW.property_id, NEW.property_code, NEW.property_name, NEW.product_category, NEW.division_code, NEW.division_name, NEW.mg01_code, NEW.mg01_name, NEW.mg02_code, NEW.mg02_name, NEW.mg03_code, NEW.mg03_name, NEW.size_code, NEW.size_name, NEW.style_group_id, NEW.is_deleted) IS DISTINCT FROM ROW(OLD.relative_path, OLD.filename, OLD.file_type, OLD.is_licensed, OLD.licensor_id, OLD.licensor_code, OLD.licensor_name, OLD.property_id, OLD.property_code, OLD.property_name, OLD.product_category, OLD.division_code, OLD.division_name, OLD.mg01_code, OLD.mg01_name, OLD.mg02_code, OLD.mg02_name, OLD.mg03_code, OLD.mg03_name, OLD.size_code, OLD.size_name, OLD.style_group_id, OLD.is_deleted) THEN
    PERFORM pg_advisory_xact_lock_shared(hashtext('style-group-change-clock-2421'));
    NEW.style_group_changed_at := clock_timestamp();
  ELSE
    -- Never let a caller silently replace the processing clock.
    NEW.style_group_changed_at := OLD.style_group_changed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION public.stamp_style_group_definition_change()
CREATE OR REPLACE FUNCTION public.stamp_style_group_definition_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR ROW(NEW.sku, NEW.folder_path, NEW.is_licensed, NEW.licensor_id, NEW.licensor_code, NEW.licensor_name, NEW.property_id, NEW.property_code, NEW.property_name, NEW.product_category, NEW.division_code, NEW.division_name, NEW.mg01_code, NEW.mg01_name, NEW.mg02_code, NEW.mg02_name, NEW.mg03_code, NEW.mg03_name, NEW.size_code, NEW.size_name) IS DISTINCT FROM ROW(OLD.sku, OLD.folder_path, OLD.is_licensed, OLD.licensor_id, OLD.licensor_code, OLD.licensor_name, OLD.property_id, OLD.property_code, OLD.property_name, OLD.product_category, OLD.division_code, OLD.division_name, OLD.mg01_code, OLD.mg01_name, OLD.mg02_code, OLD.mg02_name, OLD.mg03_code, OLD.mg03_name, OLD.size_code, OLD.size_name) OR NEW.style_group_changed_at IS DISTINCT FROM OLD.style_group_changed_at THEN
    PERFORM pg_advisory_xact_lock_shared(hashtext('style-group-change-clock-2421'));
    NEW.style_group_changed_at := clock_timestamp();
  ELSE
    -- Never let a caller silently replace the processing clock.
    NEW.style_group_changed_at := OLD.style_group_changed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- FUNCTION public.style_group_key_for_sku(text)
CREATE OR REPLACE FUNCTION public.style_group_key_for_sku(p_relative_path text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  SELECT seg
  FROM pg_catalog.unnest(pg_catalog.string_to_array(p_relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
  WHERE seg ~ '^[A-Za-z0-9]+$'
    AND seg ~ '[A-Za-z]'
    AND seg ~ '[0-9]'
    AND pg_catalog.length(seg) >= 7
    AND ord < pg_catalog.array_length(pg_catalog.string_to_array(p_relative_path, '/'), 1)
  ORDER BY ord
  LIMIT 1
$_$;

-- FUNCTION public.style_guide_files_queue_search_sync()
CREATE OR REPLACE FUNCTION public.style_guide_files_queue_search_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE'
     and new.relative_path is not distinct from old.relative_path
     and new.size_bytes is not distinct from old.size_bytes
     and new.modified_at is not distinct from old.modified_at
     and new.tag_search_text is not distinct from old.tag_search_text
     and new.style_guide_folder is not distinct from old.style_guide_folder
     and new.property_folder is not distinct from old.property_folder
     and new.licensor_name is not distinct from old.licensor_name
     and new.thumbnail_url is not distinct from old.thumbnail_url
     and new.is_active is not distinct from old.is_active then
    return null;
  end if;

  if new.is_active then
    insert into public.style_guide_search_sync_queue (style_guide_file_id)
    values (new.id)
    on conflict (style_guide_file_id) do update
      set queued_at = excluded.queued_at;
  end if;

  return null;
end;
$$;

-- FUNCTION public.style_guide_files_sync_crawl_seen()
CREATE OR REPLACE FUNCTION public.style_guide_files_sync_crawl_seen() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.is_active then
    insert into public.style_guide_file_crawl_seen as s
           (style_guide_file_id, root_label, crawl_run_id, last_seen_at)
    values (new.id, new.root_label, new.crawl_run_id, coalesce(new.last_seen_at, now()))
    on conflict (style_guide_file_id) do update
       set root_label = excluded.root_label,
           crawl_run_id = excluded.crawl_run_id,
           last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at)
     where (s.root_label, s.crawl_run_id) is distinct from (excluded.root_label, excluded.crawl_run_id);
  else
    delete from public.style_guide_file_crawl_seen where style_guide_file_id = new.id;
  end if;
  return null;
end;
$$;

-- FUNCTION public.style_guide_refresh_source_signature(regclass[])
CREATE OR REPLACE FUNCTION public.style_guide_refresh_source_signature(p_sources regclass[]) RETURNS text
    LANGUAGE sql
    SET search_path TO 'pg_catalog'
    AS $$
  select md5(string_agg(
           concat_ws(':', s.oid::oid::text,
             pg_stat_get_tuples_inserted(s.oid),
             pg_stat_get_tuples_updated(s.oid),
             pg_stat_get_tuples_deleted(s.oid),
             pg_relation_filenode(s.oid)),
           '|' order by s.oid::oid)
         || '@' || pg_postmaster_start_time()::text)
  from unnest(p_sources) as s(oid);
$$;

-- FUNCTION public.sync_asset_effective_tags()
CREATE OR REPLACE FUNCTION public.sync_asset_effective_tags() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_lock_keys text[];
  v_lock_ids bigint[];
  v_lock_id bigint;
begin
  -- F2 (#1664 review): re-derivation reads a snapshot of the *other* source
  -- table, so a concurrent regroup and group-tag write can each omit the same
  -- (asset, tag, style_group) key with no unique conflict to force a retry.
  -- Each branch below serialises every writer touching the same asset or style
  -- group on a transaction-scoped advisory lock, acquired in sorted id order so
  -- two writers holding overlapping sets cannot deadlock against each other.
  if tg_table_name = 'asset_tags' then
    v_lock_keys := array['aet_asset:' || coalesce(new.asset_id, old.asset_id)::text];
  elsif tg_table_name = 'style_group_tags' then
    v_lock_keys := array['aet_group:' || new.style_group_id::text,
                         'aet_group:' || old.style_group_id::text];
  elsif tg_table_name = 'assets' then
    v_lock_keys := array['aet_asset:' || coalesce(new.id, old.id)::text,
                         'aet_group:' || new.style_group_id::text,
                         'aet_group:' || old.style_group_id::text];
  else
    raise exception 'sync_asset_effective_tags called from unsupported table %', tg_table_name;
  end if;

  select coalesce(
           array_agg(distinct hashtextextended(k, 0) order by hashtextextended(k, 0)),
           '{}'::bigint[]
         )
    into v_lock_ids
  from unnest(v_lock_keys) k
  where k is not null;

  foreach v_lock_id in array v_lock_ids loop
    perform pg_advisory_xact_lock(v_lock_id);
  end loop;

  if tg_table_name = 'asset_tags' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      where e.asset_id = old.asset_id
        and e.tag = old.tag
        and e.scope = 'asset';
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select new.asset_id, new.tag, 'asset'
      from public.assets a
      where a.id = new.asset_id
        and a.is_deleted = false
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'style_group_tags' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      using public.assets a
      where a.id = e.asset_id
        and a.style_group_id = old.style_group_id
        and e.tag = old.tag
        and e.scope = 'style_group';
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select a.id, new.tag, 'style_group'
      from public.assets a
      where a.style_group_id = new.style_group_id
        and a.is_deleted = false
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'assets' then
    -- #2213. The old body deleted every projection row for the asset and then
    -- reinserted the freshly derived set unconditionally. The delete is kept
    -- verbatim ONLY for the states whose derived set is empty by definition --
    -- the asset row is gone, or it is now soft-deleted -- because there is
    -- nothing to compare against.
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.is_deleted = true) then
      delete from public.asset_effective_tags e
      where e.asset_id = old.id;

      if tg_op = 'DELETE' then return old; else return new; end if;
    end if;

    -- An UPDATE that moves the primary key would otherwise strand the old id's
    -- rows, which the old delete-all-by-old.id covered incidentally. Keep that
    -- behaviour explicitly; the comparison below is keyed on new.id.
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      delete from public.asset_effective_tags e
      where e.asset_id = old.id;
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.is_deleted = false then
      -- The desired set is derived exactly as before. `union` rather than
      -- `union all` only removes duplicates that the unique index would have
      -- collapsed anyway, so the resulting set is identical.
      with desired as (
        select new.id as asset_id, t.tag, 'asset'::text as scope
        from public.asset_tags t
        where t.asset_id = new.id
          and t.status = 'active'
        union
        select new.id as asset_id, t.tag, 'style_group'::text as scope
        from public.style_group_tags t
        where t.style_group_id = new.style_group_id
          and t.status = 'active'
      ),
      -- Data-modifying CTEs always execute, referenced or not. This removes
      -- only rows that are no longer derived; an unchanged set deletes nothing.
      removed as (
        delete from public.asset_effective_tags e
        where e.asset_id = new.id
          and not exists (
            select 1 from desired d
            where d.tag = e.tag
              and d.scope = e.scope
          )
        returning 1
      )
      -- Every CTE reads the same statement snapshot, so this `not exists` sees
      -- the pre-delete image. That is correct: a row `removed` deletes is by
      -- definition absent from `desired` and can never be selected here.
      -- `on conflict do nothing` still covers a concurrent inserter, exactly as
      -- the previous body did.
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select d.asset_id, d.tag, d.scope
      from desired d
      where not exists (
        select 1
        from public.asset_effective_tags e
        where e.asset_id = d.asset_id
          and e.tag = d.tag
          and e.scope = d.scope
      )
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  raise exception 'sync_asset_effective_tags called from unsupported table %', tg_table_name;
end;
$$;

-- FUNCTION public.sync_asset_tags_to_array()
CREATE OR REPLACE FUNCTION public.sync_asset_tags_to_array() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ids uuid[];
begin
  -- A transition table exists only for the events its trigger declares.
  if tg_op = 'INSERT' then
    select array_agg(distinct asset_id) into v_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct asset_id) into v_ids from old_rows;
  else
    select array_agg(distinct asset_id) into v_ids
    from (select asset_id from new_rows union select asset_id from old_rows) u;
  end if;

  update public.assets a
  set tags = c.tags
  from (
    select x.id,
           coalesce((select array_agg(t.tag order by lower(t.tag), t.tag)
                     from public.asset_tags t
                     where t.asset_id = x.id and t.status = 'active'), '{}'::text[]) as tags
    from unnest(v_ids) as x(id)
  ) c
  where a.id = c.id
    and a.tags is distinct from c.tags;
  return null;
end
$$;

-- FUNCTION public.sync_style_guide_file_preview_state()
CREATE OR REPLACE FUNCTION public.sync_style_guide_file_preview_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
begin
  if tg_op = 'DELETE' then
    return null; -- the foreign key cascade removes the mirror row
  end if;
  insert into public.style_guide_file_preview_state as s
    (style_guide_file_id, is_active, has_preview, has_error)
  values (new.id, new.is_active, new.thumbnail_url is not null,
          new.thumbnail_url is null and new.thumbnail_error is not null)
  on conflict (style_guide_file_id) do update
    set is_active = excluded.is_active,
        has_preview = excluded.has_preview,
        has_error = excluded.has_error
    where (s.is_active, s.has_preview, s.has_error)
          is distinct from (excluded.is_active, excluded.has_preview, excluded.has_error);
  return null;
end
$$;

-- FUNCTION public.touch_style_group_tag_change()
CREATE OR REPLACE FUNCTION public.touch_style_group_tag_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('style-group-change-clock-2421'));
  -- Existing effective-tag triggers retain projection authority. This timestamp
  -- only includes their changed group in the next differential membership pass.
  UPDATE public.style_groups SET style_group_changed_at = clock_timestamp()
  WHERE id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.style_group_id END,
               CASE WHEN TG_OP <> 'DELETE' THEN NEW.style_group_id END);
  RETURN NULL;
END;
$$;

-- FUNCTION public.trg_refresh_dam_tag_or_character_stmt()
CREATE OR REPLACE FUNCTION public.trg_refresh_dam_tag_or_character_stmt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_assets uuid[] := '{}'; v_groups uuid[] := '{}';
begin
  if tg_table_name = 'style_group_tags' then
    if tg_op in ('INSERT', 'UPDATE') then
      select v_groups || coalesce(array_agg(distinct style_group_id), '{}') into v_groups from new_rows;
    end if;
    if tg_op in ('DELETE', 'UPDATE') then
      select v_groups || coalesce(array_agg(distinct style_group_id), '{}') into v_groups from old_rows;
    end if;
  else
    if tg_op in ('INSERT', 'UPDATE') then
      select v_assets || coalesce(array_agg(distinct asset_id), '{}') into v_assets from new_rows;
    end if;
    if tg_op in ('DELETE', 'UPDATE') then
      select v_assets || coalesce(array_agg(distinct asset_id), '{}') into v_assets from old_rows;
    end if;
    select coalesce(array_agg(distinct a.id), '{}'),
           coalesce(array_agg(distinct a.style_group_id) filter (where a.style_group_id is not null), '{}')
      into v_assets, v_groups
      from public.assets a where a.id = any(v_assets);
  end if;
  if cardinality(v_assets) > 0 or cardinality(v_groups) > 0 then
    perform public.refresh_dam_search_documents_batch(v_assets, v_groups, cardinality(v_assets) + cardinality(v_groups));
  end if;
  return null;
end $$;

-- FUNCTION public.update_dam_order(uuid, jsonb, jsonb)
CREATE OR REPLACE FUNCTION public.update_dam_order(p_order_id uuid, p_order_patch jsonb DEFAULT '{}'::jsonb, p_line_patches jsonb DEFAULT '[]'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'plm', 'public', 'core', 'app', 'pg_temp'
    AS $_$
declare
  v_actor uuid := auth.uid();
  v_patch jsonb;
  v_line_id uuid;
  v_hit int;
  v_old plm.production_order_line%rowtype;
  v_ref record;
  v_sku text;
  v_po text;
  v_source_count integer;
  v_source_sku text;
  v_source_po text;
  v_correction jsonb;
  v_google record;
  v_candidates integer;
  v_item uuid;
  v_catalog text;
begin
  if v_actor is null then
    raise exception 'update_dam_order: authentication required' using errcode = '42501';
  end if;

  if not exists (select 1 from plm.production_order where id = p_order_id) then
    raise exception 'update_dam_order: order % not found', p_order_id using errcode = 'P0002';
  end if;

  perform plm.assert_dam_order_keys(coalesce(p_order_patch, '{}'::jsonb),
                                    plm.dam_order_allowed_header_keys(), 'header');

  -- Only keys actually PRESENT in the patch are written, so a partial patch can never
  -- blank a field the caller did not mention.
  update plm.production_order po set
    company_id  = case when p_order_patch ? 'company_id'
                       then (p_order_patch ->> 'company_id')::uuid else po.company_id end,
    metadata    = case when p_order_patch ? 'metadata'
                       then po.metadata || (p_order_patch -> 'metadata') else po.metadata end,
    void_reason = case when p_order_patch ? 'void_reason'
                       then nullif(btrim(coalesce(p_order_patch ->> 'void_reason','')),'') else po.void_reason end,
    voided_at   = case when p_order_patch ? 'voided'
                       then case when (p_order_patch ->> 'voided')::boolean then now() else null end
                       else po.voided_at end,
    voided_by   = case when p_order_patch ? 'voided'
                       then case when (p_order_patch ->> 'voided')::boolean then v_actor else null end
                       else po.voided_by end,
    updated_at  = now()
  where po.id = p_order_id;

  if p_line_patches is not null and jsonb_typeof(p_line_patches) = 'array' then
    for v_patch in select * from jsonb_array_elements(p_line_patches)
    loop
      perform plm.assert_dam_order_keys(v_patch, plm.dam_order_allowed_line_keys(), 'line');

      v_line_id := (v_patch ->> 'id')::uuid;
      if v_line_id is null then
        raise exception 'update_dam_order: every line patch needs an id' using errcode = '22023';
      end if;

      select * into v_old from plm.production_order_line
        where id=v_line_id and production_order_id=p_order_id for update;
      if not found then
        raise exception 'update_dam_order: line does not belong to order' using errcode='P0002';
      end if;
      if coalesce(v_patch->'metadata','{}'::jsonb) ?| array[
        'orderlist_google_correction','orderlist_source_correction','orderlist_source_cancellation','orderlist_supersession'] then
        raise exception 'Source correction provenance is maintained by the editor' using errcode='22023';
      end if;
      v_sku := case when v_patch ? 'sku' then nullif(btrim(v_patch->>'sku'),'') else v_old.sku end;
      v_po := case when v_patch ? 'customer_po_number' then nullif(btrim(v_patch->>'customer_po_number'),'') else v_old.customer_po_number end;
      if v_sku is distinct from v_old.sku or v_po is distinct from v_old.customer_po_number then
        for v_ref in select r.* from plm.production_order_line_source_ref r
          where r.production_order_line_id=v_line_id and r.source_system='coldlion' and r.is_primary for update
        loop
          if v_sku is null or v_po is null then
            raise exception 'A source-linked identity correction requires a style and customer PO' using errcode='22023';
          end if;
          if v_ref.source_id !~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
             or nullif(v_ref.metadata->>'master_item_no','') is null then
            raise exception 'Exact source identity is unavailable; reconciliation required' using errcode='22023';
          end if;
          with versions as (
            select h.*,rank() over(order by run.started_at desc) as observation_rank
            from coldlion.intake_order_line h join coldlion.sync_run run on run.id=h.last_seen_run
            where h.company_code='EDGEHOME' and run.started_at is not null
              and h.sales_order_no=split_part(v_ref.source_id,':',3)::bigint
              and h.sales_order_line_no=split_part(v_ref.source_id,':',5)::integer
          ), source as (
            select distinct coalesce(nullif(btrim(c.sub_item_no),''),h.master_item_no) as sku,h.po_number
            from versions h join coldlion.intake_order_component c on c.line_id=h.id
            where h.observation_rank=1 and h.division_code is distinct from 'EP001'
              and h.master_item_no=v_ref.metadata->>'master_item_no'
              and nullif(c.sub_item_no,'') is not distinct from nullif(v_ref.metadata->>'sub_item_no','')
              and nullif(c.sub_label_code,'') is not distinct from nullif(v_ref.metadata->>'sub_label_code','')
          ) select count(*),min(sku),min(po_number) into v_source_count,v_source_sku,v_source_po from source;
          if v_source_count<>1 or v_source_sku is null then
            raise exception 'Source identity changed or is ambiguous; reconciliation required' using errcode='22023';
          end if;
          v_correction:=v_ref.metadata->'orderlist_source_correction';
          if v_correction is not null and (
            v_correction->>'version' is distinct from '1'
            or v_correction->>'source_id' is distinct from v_ref.source_id
            or v_correction->>'original_sku' is distinct from v_source_sku
            or v_correction->>'original_customer_po' is distinct from v_source_po
            or v_correction->>'canonical_sku' is distinct from v_old.sku
            or v_correction->>'canonical_customer_po' is distinct from v_old.customer_po_number) then
            raise exception 'Prior source correction is stale; reconciliation required' using errcode='22023';
          end if;
          update plm.production_order_line_source_ref set metadata=metadata || jsonb_build_object(
            'orderlist_source_correction',jsonb_build_object('version',1,'source_id',v_ref.source_id,
              'original_sku',v_source_sku,'original_customer_po',v_source_po,
              'canonical_sku',v_sku,'canonical_customer_po',v_po,
              'evidence_ref','OrderList editor actor '||v_actor::text)) where id=v_ref.id;
        end loop;
        select r.* into v_google from plm.production_order_line_source_ref r
          where r.production_order_line_id=v_line_id and r.source_system='google_order_list' and r.is_primary for update;
        if found then
          if v_sku is null or v_po is null then
            raise exception 'A source-linked identity correction requires a style and customer PO' using errcode='22023';
          end if;
          v_correction:=v_old.metadata->'orderlist_google_correction';
          if v_correction is not null and (
            v_correction->>'version' is distinct from '1'
            or v_correction->>'source_id' is distinct from v_google.source_id
            or v_correction->'corrected'->>'sku' is distinct from v_old.sku
            or v_correction->'corrected'->>'customer_po_number' is distinct from v_old.customer_po_number) then
            raise exception 'Prior Google correction is stale; reconciliation required' using errcode='22023';
          end if;
          v_patch:=v_patch || jsonb_build_object('metadata',coalesce(v_patch->'metadata','{}'::jsonb)
            || jsonb_build_object('orderlist_google_correction',jsonb_build_object('version',1,
              'source_id',v_google.source_id,'original',coalesce(v_correction->'original',jsonb_build_object(
                'sku',v_old.sku,'customer_po_number',v_old.customer_po_number)),
              'corrected',jsonb_build_object('sku',v_sku,'customer_po_number',v_po),
              'evidence_ref','OrderList editor actor '||v_actor::text)));
        end if;
      end if;

      update plm.production_order_line pol set
        sku                = case when v_patch ? 'sku' then nullif(btrim(coalesce(v_patch->>'sku','')),'') else pol.sku end,
        quantity_ordered   = case when v_patch ? 'quantity_ordered' then (v_patch->>'quantity_ordered')::numeric else pol.quantity_ordered end,
        order_person       = case when v_patch ? 'order_person' then nullif(btrim(coalesce(v_patch->>'order_person','')),'') else pol.order_person end,
        order_type         = case when v_patch ? 'order_type' then nullif(btrim(coalesce(v_patch->>'order_type','')),'') else pol.order_type end,
        customer_po_number = case when v_patch ? 'customer_po_number' then nullif(btrim(coalesce(v_patch->>'customer_po_number','')),'') else pol.customer_po_number end,
        assortment_id      = case when v_patch ? 'assortment_id' then nullif(btrim(coalesce(v_patch->>'assortment_id','')),'') else pol.assortment_id end,
        order_depth_inches = case when v_patch ? 'order_depth_inches' then (v_patch->>'order_depth_inches')::numeric else pol.order_depth_inches end,
        case_pack          = case when v_patch ? 'case_pack' then (v_patch->>'case_pack')::numeric else pol.case_pack end,
        ship_to            = case when v_patch ? 'ship_to' then nullif(btrim(coalesce(v_patch->>'ship_to','')),'') else pol.ship_to end,
        start_ship_date    = case when v_patch ? 'start_ship_date' then (v_patch->>'start_ship_date')::date else pol.start_ship_date end,
        cancel_date        = case when v_patch ? 'cancel_date' then (v_patch->>'cancel_date')::date else pol.cancel_date end,
        source_style_type  = case when v_patch ? 'source_style_type' then nullif(btrim(lower(coalesce(v_patch->>'source_style_type',''))),'') else pol.source_style_type end,
        metadata           = case when v_patch ? 'metadata' then pol.metadata || (v_patch->'metadata') else pol.metadata end,
        void_reason        = case when v_patch ? 'void_reason' then nullif(btrim(coalesce(v_patch->>'void_reason','')),'') else pol.void_reason end,
        voided_at          = case when v_patch ? 'voided'
                                  then case when (v_patch->>'voided')::boolean then now() else null end
                                  else pol.voided_at end,
        voided_by          = case when v_patch ? 'voided'
                                  then case when (v_patch->>'voided')::boolean then v_actor else null end
                                  else pol.voided_by end,
        updated_at         = now()
      where pol.id = v_line_id
        and pol.production_order_id = p_order_id
      returning pol.source_style_type into v_catalog;

      get diagnostics v_hit = row_count;
      if v_hit = 0 then
        raise exception 'update_dam_order: line % does not belong to order %', v_line_id, p_order_id
          using errcode = 'P0002';
      end if;
      -- A different style must not retain the previous product's facts.
      if lower(btrim(v_sku)) is distinct from lower(btrim(v_old.sku))
        or v_catalog is distinct from v_old.source_style_type then
        select count(distinct b.plm_item_id),(array_agg(distinct b.plm_item_id))[1]
          into v_candidates,v_item
        from plm.style_tracker_item_bridge b join public.style_tracker_rows t on t.id=b.style_tracker_row_id
        where lower(btrim(t.sku))=lower(btrim(v_sku)) and b.plm_item_id is not null
          and b.tracker_type=v_catalog
          and t.tracker_type=b.tracker_type;
        update plm.production_order_line set item_id=case when v_candidates=1 then v_item end,
          master_data_match_status=case when v_candidates=1 then 'matched' when v_candidates>1 then 'ambiguous' else 'unmatched' end
          where id=v_line_id and production_order_id=p_order_id;
      end if;

    end loop;
  end if;

  return p_order_id;
end;
$_$;

-- FUNCTION public.upsert_dam_order_customer_settings(text, text)
CREATE OR REPLACE FUNCTION public.upsert_dam_order_customer_settings(p_customer text, p_suffix text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or app.has_role('administrator'::app.app_role) is not true then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  insert into dam.orderlist_customer_settings(customer_normalized,suffix,updated_by)
  values(lower(btrim(p_customer)),btrim(p_suffix),auth.uid())
  on conflict(customer_normalized) do update set suffix=excluded.suffix,updated_at=now(),updated_by=auth.uid();
end;
$$;

-- FUNCTION public.upsert_dam_order_sample_depth(text, text, numeric)
CREATE OR REPLACE FUNCTION public.upsert_dam_order_sample_depth(p_sku text, p_customer text, p_depth_inches numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or app.has_role('administrator'::app.app_role) is not true then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  insert into dam.orderlist_sample_depth(sku_normalized,customer_normalized,depth_inches,updated_by)
  values(lower(btrim(p_sku)),lower(btrim(p_customer)),p_depth_inches,auth.uid())
  on conflict(sku_normalized,customer_normalized) do update set depth_inches=excluded.depth_inches, updated_at=now(),updated_by=auth.uid();
end;
$$;

-- FUNCTION public.upsert_dam_search_embedding(text, uuid, text, uuid, extensions.vector, text)
CREATE OR REPLACE FUNCTION public.upsert_dam_search_embedding(p_document_type text, p_entity_id uuid, p_content_sha256 text, p_lease_token uuid, p_embedding extensions.vector, p_embedding_model text DEFAULT 'google/siglip2-base-patch16-naflex'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (coalesce((select auth.role()) = 'service_role', false) or pg_has_role(session_user, 'dam_image_embed_worker', 'MEMBER')) is not true then raise exception 'authorized embedding actor required' using errcode='42501'; end if;
  update public.dam_search_documents set embedding=p_embedding,embedding_model=p_embedding_model,embedding_updated_at=now(),
    embedding_error=null,embedding_error_category=null,embedding_next_retry_at=null,embedding_lease_token=null,
    embedding_lease_owner=null,embedding_lease_expires_at=null where document_type=p_document_type and entity_id=p_entity_id
    and coalesce(metadata->>'_embedding_lease_input_sha256',content_sha256)=p_content_sha256 and p_embedding_model='google/siglip2-base-patch16-naflex' and embedding_lease_token=p_lease_token and embedding_lease_expires_at>now(); return found;
end
$$;

-- FUNCTION public.upsert_sg_search_embedding(uuid, text, uuid, extensions.vector, text)
CREATE OR REPLACE FUNCTION public.upsert_sg_search_embedding(p_style_guide_file_id uuid, p_content_sha256 text, p_lease_token uuid, p_embedding extensions.vector, p_embedding_model text DEFAULT 'google/siglip2-base-patch16-naflex'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_embedding_model is distinct from 'google/siglip2-base-patch16-naflex'
     or extensions.vector_dims(p_embedding) is distinct from 768 then
    raise exception 'unsupported embedding model or dimension' using errcode = '22023';
  end if;
  delete from public.style_guide_search_embedding_jobs j
   where j.style_guide_file_id = p_style_guide_file_id
     and j.content_sha256 = p_content_sha256
     and j.lease_token = p_lease_token
     and j.lease_expires_at > now()
     and exists (select 1 from public.style_guide_search_documents d
                  where d.style_guide_file_id = p_style_guide_file_id
                    and d.content_sha256 = p_content_sha256);
  if not found then
    return false;  -- no live lease: nothing is written anywhere
  end if;
  -- pgvector has no equality operator; the text cast is the exact comparison.
  -- An equal vector and model write nothing to the wide row (#5758 D2).
  update public.style_guide_search_documents
     set embedding = p_embedding,
         embedding_model = p_embedding_model,
         embedding_updated_at = now()
   where style_guide_file_id = p_style_guide_file_id
     and content_sha256 = p_content_sha256
     and (embedding is null
          or embedding::text is distinct from p_embedding::text
          or embedding_model is distinct from p_embedding_model);
  return true;
end;
$$;

-- FUNCTION public.upsert_style_guide_crawl_files(uuid, jsonb)
CREATE OR REPLACE FUNCTION public.upsert_style_guide_crawl_files(p_run_id uuid, p_rows jsonb) RETURNS TABLE(id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_run_id is null then
    raise exception 'upsert_style_guide_crawl_files requires a run id';
  end if;

  create temporary table if not exists pg_temp.sg_crawl_rows (
    root_label text,
    relative_path text,
    directory_path text,
    filename text,
    basename_no_ext text,
    file_extension text,
    property_folder text,
    style_guide_folder text,
    normalized_name text,
    normalized_style_guide_folder text,
    size_bytes bigint,
    modified_at timestamptz,
    has_talent_likeness boolean
  ) on commit drop;
  truncate pg_temp.sg_crawl_rows;

  insert into pg_temp.sg_crawl_rows
  select distinct on (r.root_label, r.relative_path) r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r (
      root_label text,
      relative_path text,
      directory_path text,
      filename text,
      basename_no_ext text,
      file_extension text,
      property_folder text,
      style_guide_folder text,
      normalized_name text,
      normalized_style_guide_folder text,
      size_bytes bigint,
      modified_at timestamptz,
      has_talent_likeness boolean
    )
   order by r.root_label, r.relative_path;

  insert into public.style_guide_files as f (
    crawl_run_id, root_label, relative_path, directory_path, filename,
    basename_no_ext, file_extension, property_folder, style_guide_folder,
    normalized_name, normalized_style_guide_folder, size_bytes, modified_at,
    last_seen_at, is_active, has_talent_likeness)
  select p_run_id, c.root_label, c.relative_path, c.directory_path, c.filename,
         c.basename_no_ext, c.file_extension, c.property_folder, c.style_guide_folder,
         c.normalized_name, c.normalized_style_guide_folder, c.size_bytes, c.modified_at,
         now(), true, c.has_talent_likeness
    from pg_temp.sg_crawl_rows c
   order by c.root_label, c.relative_path
  on conflict (root_label, relative_path) do update
     set crawl_run_id = excluded.crawl_run_id,
         directory_path = excluded.directory_path,
         filename = excluded.filename,
         basename_no_ext = excluded.basename_no_ext,
         file_extension = excluded.file_extension,
         property_folder = excluded.property_folder,
         style_guide_folder = excluded.style_guide_folder,
         normalized_name = excluded.normalized_name,
         normalized_style_guide_folder = excluded.normalized_style_guide_folder,
         size_bytes = excluded.size_bytes,
         modified_at = excluded.modified_at,
         last_seen_at = excluded.last_seen_at,
         is_active = true,
         has_talent_likeness = excluded.has_talent_likeness
   where not f.is_active
      or (f.directory_path, f.filename, f.basename_no_ext, f.file_extension,
          f.property_folder, f.style_guide_folder, f.normalized_name,
          f.normalized_style_guide_folder, f.size_bytes, f.modified_at,
          f.has_talent_likeness)
         is distinct from
         (excluded.directory_path, excluded.filename, excluded.basename_no_ext,
          excluded.file_extension, excluded.property_folder, excluded.style_guide_folder,
          excluded.normalized_name, excluded.normalized_style_guide_folder,
          excluded.size_bytes, excluded.modified_at, excluded.has_talent_likeness);

  insert into public.style_guide_file_crawl_seen as s
         (style_guide_file_id, root_label, crawl_run_id, last_seen_at)
  select f.id, f.root_label, p_run_id, now()
    from pg_temp.sg_crawl_rows c
    join public.style_guide_files f
      on f.root_label = c.root_label and f.relative_path = c.relative_path
   where f.is_active
  on conflict (style_guide_file_id) do update
     set crawl_run_id = excluded.crawl_run_id,
         root_label = excluded.root_label,
         last_seen_at = excluded.last_seen_at;

  return query
  select f.id
    from pg_temp.sg_crawl_rows c
    join public.style_guide_files f
      on f.root_label = c.root_label and f.relative_path = c.relative_path;
end;
$$;

-- VIEW api.dam_order_customer_settings
CREATE OR REPLACE VIEW api.dam_order_customer_settings WITH (security_invoker='true') AS
 SELECT customer_normalized,
    suffix,
    updated_at,
    updated_by
   FROM dam.orderlist_customer_settings;

-- VIEW api.dam_order_sample_depth
CREATE OR REPLACE VIEW api.dam_order_sample_depth WITH (security_invoker='true') AS
 SELECT sku_normalized,
    customer_normalized,
    depth_inches,
    depth_raw,
    source_workbook_id,
    source_row_number,
    updated_at,
    updated_by
   FROM dam.orderlist_sample_depth;

-- VIEW api.dam_order_vendor_statistics
CREATE OR REPLACE VIEW api.dam_order_vendor_statistics WITH (security_invoker='true') AS
 SELECT factory_id,
    min(vendor_name) AS vendor_name,
    count(*) AS order_count,
    count(*) FILTER (WHERE (close_tracking IS TRUE)) AS closed_orders,
    count(*) FILTER (WHERE ((close_tracking IS NOT TRUE) AND (order_voided_at IS NULL))) AS open_orders,
    max(sent_po_date) FILTER (WHERE ((order_voided_at IS NULL) AND (production_order_number !~~* '%cancel%'::text))) AS last_sent_po_date,
        CASE
            WHEN (max(sent_po_date) FILTER (WHERE ((order_voided_at IS NULL) AND (production_order_number !~~* '%cancel%'::text))) > ((CURRENT_DATE - '1 year 2 mons'::interval))::date) THEN 'Active'::text
            ELSE 'Inactive'::text
        END AS activity_status
   FROM ( SELECT po.factory_id,
            COALESCE(v.vendor_name, NULLIF((po.metadata ->> 'order_vendor_name'::text), ''::text)) AS vendor_name,
            po.close_tracking,
            po.voided_at AS order_voided_at,
            po.sent_po_date,
            po.production_order_number
           FROM (plm.production_order po
             LEFT JOIN dam.dam_order_list_vendor_directory v ON ((v.vendor_id = po.factory_id)))
          WHERE (NOT (COALESCE((po.source_system = 'coldlion'::text), false) AND COALESCE((po.production_order_number ~~ 'coldlion/%'::text), false)))) headers
  WHERE (vendor_name IS NOT NULL)
  GROUP BY factory_id, (lower(btrim(vendor_name)));

-- TABLE public.popdam_item_state
CREATE TABLE public.popdam_item_state (
    item_id uuid NOT NULL,
    source_system text NOT NULL,
    division_code text NOT NULL,
    source_id text NOT NULL,
    dismissed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT popdam_item_state_identity_nonblank_ck CHECK (((NULLIF(btrim(source_system), ''::text) IS NOT NULL) AND (NULLIF(btrim(division_code), ''::text) IS NOT NULL) AND (NULLIF(btrim(source_id), ''::text) IS NOT NULL) AND (POSITION(('|'::text) IN (source_system)) = 0) AND (POSITION(('|'::text) IN (division_code)) = 0) AND (POSITION(('|'::text) IN (source_id)) = 0)))
);

-- TABLE archive.ai_tag_parallel_before_trial_20261101
CREATE TABLE archive.ai_tag_parallel_before_trial_20261101 (
    at timestamp with time zone,
    cfg jsonb,
    op jsonb
);

-- TABLE archive.asset_characters_before_core_retag_20261031
CREATE TABLE archive.asset_characters_before_core_retag_20261031 (
    asset_id uuid,
    character_id uuid
);

-- TABLE archive.asset_characters_wrong_family_20261102
CREATE TABLE archive.asset_characters_wrong_family_20261102 (
    asset_id uuid NOT NULL,
    character_id uuid NOT NULL,
    character_name text,
    char_licensor text,
    group_licensor text,
    scope text,
    legacy_property text,
    verdict text,
    rn bigint
);

-- TABLE archive.asset_characters_wrong_licensor_20261102
CREATE TABLE archive.asset_characters_wrong_licensor_20261102 (
    asset_id uuid NOT NULL,
    character_id uuid NOT NULL,
    rn bigint
);

-- TABLE archive.asset_characters_wrong_spiderfamily_tagger_20261029
CREATE TABLE archive.asset_characters_wrong_spiderfamily_tagger_20261029 (
    asset_id uuid,
    character_id uuid
);

-- TABLE archive.asset_characters_wrong_spiderman_20261029
CREATE TABLE archive.asset_characters_wrong_spiderman_20261029 (
    asset_id uuid,
    character_id uuid
);

-- TABLE archive.asset_characters_wrong_spiderman_tagger_20261029
CREATE TABLE archive.asset_characters_wrong_spiderman_tagger_20261029 (
    asset_id uuid,
    character_id uuid
);

-- TABLE archive.asset_tags_wrong_spiderman_20261102
CREATE TABLE archive.asset_tags_wrong_spiderman_20261102 (
    id uuid NOT NULL,
    asset_id uuid,
    tag text,
    source text,
    created_at timestamp with time zone,
    created_by uuid,
    category text,
    status text,
    confidence numeric,
    model text,
    evidence jsonb,
    rejected_at timestamp with time zone,
    rejected_by uuid,
    updated_at timestamp with time zone
);

-- TABLE archive.asset_tags_wrong_unlicensed_20261102
CREATE TABLE archive.asset_tags_wrong_unlicensed_20261102 (
    id uuid NOT NULL,
    asset_id uuid,
    tag text,
    source text,
    created_at timestamp with time zone,
    created_by uuid,
    category text,
    status text,
    confidence numeric,
    model text,
    evidence jsonb,
    rejected_at timestamp with time zone,
    rejected_by uuid,
    updated_at timestamp with time zone
);

-- TABLE archive.bulk_op_ai_tag_all_before_trial_20261101
CREATE TABLE archive.bulk_op_ai_tag_all_before_trial_20261101 (
    saved_at timestamp with time zone,
    state jsonb
);

-- TABLE archive.bulk_op_ai_tag_groups_before_trial_20261101
CREATE TABLE archive.bulk_op_ai_tag_groups_before_trial_20261101 (
    saved_at timestamp with time zone,
    state jsonb
);

-- TABLE archive.character_child_grogu_links_20261104
CREATE TABLE archive.character_child_grogu_links_20261104 (
    asset_id uuid NOT NULL,
    old_row jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE archive.character_link_licensing_audit_20261102
CREATE TABLE archive.character_link_licensing_audit_20261102 (
    asset_id uuid NOT NULL,
    character_id uuid NOT NULL,
    character_name text,
    char_licensor text,
    group_licensor text,
    scope text,
    family_ambiguous boolean,
    ai_tagged_at timestamp with time zone
);

-- TABLE archive.dc_hp_wb_repoint_20261101
CREATE TABLE archive.dc_hp_wb_repoint_20261101 (
    source_table text NOT NULL,
    row_key text NOT NULL,
    old_row jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE archive.erp_items_current
CREATE TABLE archive.erp_items_current (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_id text NOT NULL,
    style_number text,
    item_description text,
    mg_category text,
    mg01_code text,
    mg02_code text,
    mg03_code text,
    mg04_code text,
    mg05_code text,
    mg06_code text,
    size_code text,
    licensor_code text,
    property_code text,
    division_code text,
    erp_updated_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_run_id uuid,
    source_system text DEFAULT 'designflow'::text NOT NULL,
    raw_mg_fields jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed boolean DEFAULT false NOT NULL,
    prepack_code text,
    prepack_codes jsonb
);

-- TABLE archive.erp_items_raw
CREATE TABLE archive.erp_items_raw (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_id text NOT NULL,
    raw_payload jsonb NOT NULL,
    sync_run_id uuid,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE archive.popdam_dc_hp_wb_repoint_20261101
CREATE TABLE archive.popdam_dc_hp_wb_repoint_20261101 (
    source_table text NOT NULL,
    row_id uuid NOT NULL,
    old_licensor_id uuid,
    old_licensor_name text,
    archived_at timestamp with time zone DEFAULT now()
);

-- TABLE archive.retag_trial_500_20261031
CREATE TABLE archive.retag_trial_500_20261031 (
    asset_id uuid,
    bucket text,
    ai_description text,
    cover_description text,
    ai_model text,
    ai_tagged_at timestamp with time zone,
    old_characters text[]
);

-- TABLE archive.retag_trial_500_asset_tags_20261031
CREATE TABLE archive.retag_trial_500_asset_tags_20261031 (
    id uuid,
    asset_id uuid,
    tag text,
    source text,
    created_at timestamp with time zone,
    created_by uuid,
    category text,
    status text,
    confidence numeric,
    model text,
    evidence jsonb,
    rejected_at timestamp with time zone,
    rejected_by uuid,
    updated_at timestamp with time zone
);

-- TABLE archive.retag_trial_parallel_ids_20261101
CREATE TABLE archive.retag_trial_parallel_ids_20261101 (
    asset_id uuid,
    st text
);

-- TABLE archive.spiderfamily_link_review_20261029
CREATE TABLE archive.spiderfamily_link_review_20261029 (
    asset_id uuid,
    character_id uuid,
    style_group_id uuid,
    txt text,
    remove boolean
);

-- TABLE archive.spiderman_link_review_20261029
CREATE TABLE archive.spiderman_link_review_20261029 (
    asset_id uuid,
    character_id uuid,
    style_group_id uuid,
    asku text,
    filename text,
    txt text,
    remove boolean
);

-- TABLE archive.spiderman_text_audit_20261102
CREATE TABLE archive.spiderman_text_audit_20261102 (
    asset_id uuid NOT NULL,
    is_deleted boolean,
    status text,
    ai_tagged_at timestamp with time zone,
    ai_model text,
    tier smallint,
    has_thumb boolean,
    style_group_id uuid,
    sku text,
    a_licensor_id uuid,
    a_property_id uuid,
    a_licensor_code text,
    a_property_code text,
    d_hit boolean,
    s_hit boolean,
    c_hit boolean,
    t_hit boolean
);

-- TABLE archive.style_groups_cover_description_3fz93mvdp02_20261029
CREATE TABLE archive.style_groups_cover_description_3fz93mvdp02_20261029 (
    id uuid,
    sku text,
    cover_description text
);

-- TABLE archive.style_groups_erp_licensing_plan_20261029
CREATE TABLE archive.style_groups_erp_licensing_plan_20261029 (
    id uuid,
    lc text,
    pc text,
    lid uuid,
    lname text,
    pid uuid,
    pname text
);

-- TABLE archive.style_groups_licensing_before_erp_20261029
CREATE TABLE archive.style_groups_licensing_before_erp_20261029 (
    id uuid,
    sku text,
    licensor_id uuid,
    licensor_code text,
    licensor_name text,
    property_id uuid,
    property_code text,
    property_name text,
    is_licensed boolean
);

-- VIEW dam.asset_character_current
CREATE OR REPLACE VIEW dam.asset_character_current WITH (security_invoker='true') AS
 SELECT id,
    asset_id,
    character_id,
    is_current,
    retired_at,
    retired_reason
   FROM dam.asset_character
  WHERE is_current;

-- TABLE dam.asset_character_source_edge
CREATE TABLE dam.asset_character_source_edge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    character_id uuid NOT NULL,
    licensor_id uuid NOT NULL,
    source_system text NOT NULL,
    source_id text,
    source_evidence text,
    evidence_kind core.relationship_evidence_kind NOT NULL,
    is_direct_source_relationship boolean GENERATED ALWAYS AS ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) STORED,
    observation_count integer DEFAULT 0 NOT NULL,
    confidence numeric(5,4),
    is_current boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    superseded_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    updated_by text,
    CONSTRAINT asset_character_source_edge_confidence_range CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT asset_character_source_edge_direct_has_no_confidence CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0)))),
    CONSTRAINT asset_character_source_edge_observation_count_non_negative CHECK ((observation_count >= 0)),
    CONSTRAINT asset_character_source_edge_source_id_not_blank CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0))),
    CONSTRAINT asset_character_source_edge_source_system_not_blank CHECK ((length(btrim(source_system)) > 0)),
    CONSTRAINT asset_character_source_edge_superseded_reason_only_when_superse CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL))),
    CONSTRAINT asset_character_source_edge_supersession_consistent CHECK ((is_current = (superseded_at IS NULL)))
);

-- TABLE dam.asset_franchise
CREATE TABLE dam.asset_franchise (
    asset_id uuid NOT NULL,
    franchise_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    retired_at timestamp with time zone,
    retired_reason text,
    CONSTRAINT asset_franchise_lifecycle_chk CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))))
);

-- VIEW dam.asset_franchise_current
CREATE OR REPLACE VIEW dam.asset_franchise_current WITH (security_invoker='true') AS
 SELECT asset_id,
    franchise_id,
    created_at,
    updated_at,
    is_current,
    retired_at,
    retired_reason
   FROM dam.asset_franchise
  WHERE is_current;

-- TABLE dam.asset_franchise_source_edge
CREATE TABLE dam.asset_franchise_source_edge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    franchise_id uuid NOT NULL,
    licensor_id uuid NOT NULL,
    source_system text NOT NULL,
    source_id text,
    source_evidence text,
    evidence_kind core.relationship_evidence_kind NOT NULL,
    is_direct_source_relationship boolean GENERATED ALWAYS AS ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) STORED,
    observation_count integer DEFAULT 0 NOT NULL,
    confidence numeric(5,4),
    is_current boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    superseded_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    updated_by text,
    CONSTRAINT asset_franchise_source_edge_confidence_range CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT asset_franchise_source_edge_direct_has_no_confidence CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0)))),
    CONSTRAINT asset_franchise_source_edge_observation_count_non_negative CHECK ((observation_count >= 0)),
    CONSTRAINT asset_franchise_source_edge_source_id_not_blank CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0))),
    CONSTRAINT asset_franchise_source_edge_source_system_not_blank CHECK ((length(btrim(source_system)) > 0)),
    CONSTRAINT asset_franchise_source_edge_superseded_reason_only_when_superse CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL))),
    CONSTRAINT asset_franchise_source_edge_supersession_consistent CHECK ((is_current = (superseded_at IS NULL)))
);

-- TABLE dam.asset_property
CREATE TABLE dam.asset_property (
    asset_id uuid NOT NULL,
    property_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    retired_at timestamp with time zone,
    retired_reason text,
    CONSTRAINT asset_property_lifecycle_chk CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))))
);

-- VIEW dam.asset_property_current
CREATE OR REPLACE VIEW dam.asset_property_current WITH (security_invoker='true') AS
 SELECT asset_id,
    property_id,
    created_at,
    updated_at,
    is_current,
    retired_at,
    retired_reason
   FROM dam.asset_property
  WHERE is_current;

-- TABLE dam.asset_property_source_edge
CREATE TABLE dam.asset_property_source_edge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    property_id uuid NOT NULL,
    licensor_id uuid NOT NULL,
    source_system text NOT NULL,
    source_id text,
    source_evidence text,
    evidence_kind core.relationship_evidence_kind NOT NULL,
    is_direct_source_relationship boolean GENERATED ALWAYS AS ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) STORED,
    observation_count integer DEFAULT 0 NOT NULL,
    confidence numeric(5,4),
    is_current boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    superseded_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    updated_by text,
    CONSTRAINT asset_property_source_edge_confidence_range CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT asset_property_source_edge_direct_has_no_confidence CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0)))),
    CONSTRAINT asset_property_source_edge_observation_count_non_negative CHECK ((observation_count >= 0)),
    CONSTRAINT asset_property_source_edge_source_id_not_blank CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0))),
    CONSTRAINT asset_property_source_edge_source_system_not_blank CHECK ((length(btrim(source_system)) > 0)),
    CONSTRAINT asset_property_source_edge_superseded_reason_only_when_supersed CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL))),
    CONSTRAINT asset_property_source_edge_supersession_consistent CHECK ((is_current = (superseded_at IS NULL)))
);

-- TABLE dam.asset_style_guide
CREATE TABLE dam.asset_style_guide (
    asset_id uuid NOT NULL,
    style_guide_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    retired_at timestamp with time zone,
    retired_reason text,
    CONSTRAINT asset_style_guide_lifecycle_chk CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))))
);

-- VIEW dam.asset_style_guide_current
CREATE OR REPLACE VIEW dam.asset_style_guide_current WITH (security_invoker='true') AS
 SELECT asset_id,
    style_guide_id,
    created_at,
    updated_at,
    is_current,
    retired_at,
    retired_reason
   FROM dam.asset_style_guide
  WHERE is_current;

-- TABLE dam.asset_style_guide_source_edge
CREATE TABLE dam.asset_style_guide_source_edge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    style_guide_id uuid NOT NULL,
    licensor_id uuid NOT NULL,
    source_system text NOT NULL,
    source_id text,
    source_evidence text,
    evidence_kind core.relationship_evidence_kind NOT NULL,
    is_direct_source_relationship boolean GENERATED ALWAYS AS ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) STORED,
    observation_count integer DEFAULT 0 NOT NULL,
    confidence numeric(5,4),
    is_current boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    superseded_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    updated_by text,
    CONSTRAINT asset_style_guide_source_edge_confidence_range CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT asset_style_guide_source_edge_direct_has_no_confidence CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0)))),
    CONSTRAINT asset_style_guide_source_edge_observation_count_non_negative CHECK ((observation_count >= 0)),
    CONSTRAINT asset_style_guide_source_edge_source_id_not_blank CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0))),
    CONSTRAINT asset_style_guide_source_edge_source_system_not_blank CHECK ((length(btrim(source_system)) > 0)),
    CONSTRAINT asset_style_guide_source_edge_superseded_reason_only_when_super CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL))),
    CONSTRAINT asset_style_guide_source_edge_supersession_consistent CHECK ((is_current = (superseded_at IS NULL)))
);

-- TABLE dam.dam_asset_image_vectors
CREATE TABLE dam.dam_asset_image_vectors (
    asset_id uuid NOT NULL,
    vec_dino extensions.halfvec(768),
    vec_siglip extensions.halfvec(768),
    embedding_model text NOT NULL,
    border_cropped boolean DEFAULT false NOT NULL,
    last_embedded_thumbnail_url text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dam_asset_image_vectors_legs_together_chk CHECK (((vec_dino IS NULL) = (vec_siglip IS NULL))),
    CONSTRAINT dam_asset_image_vectors_stamp_chk CHECK ((btrim(embedding_model) <> ''::text)),
    CONSTRAINT dam_asset_image_vectors_watermark_chk CHECK ((btrim(last_embedded_thumbnail_url) <> ''::text))
);

-- TABLE dam.folder_rename_log
CREATE TABLE dam.folder_rename_log (
    id bigint NOT NULL,
    share text DEFAULT 'mac'::text NOT NULL,
    old_path text NOT NULL,
    new_path text NOT NULL,
    renamed_at timestamp with time zone NOT NULL,
    batch_id uuid NOT NULL,
    rule text NOT NULL,
    reverted_at timestamp with time zone,
    CONSTRAINT folder_rename_log_not_nested CHECK ((("left"(old_path, (length(new_path) + 1)) <> (new_path || '/'::text)) AND ("left"(new_path, (length(old_path) + 1)) <> (old_path || '/'::text)))),
    CONSTRAINT folder_rename_log_paths_differ CHECK ((old_path <> new_path)),
    CONSTRAINT folder_rename_log_paths_shape CHECK (((old_path <> ''::text) AND (new_path <> ''::text) AND ("left"(old_path, 1) <> '/'::text) AND ("right"(old_path, 1) <> '/'::text) AND ("left"(new_path, 1) <> '/'::text) AND ("right"(new_path, 1) <> '/'::text))),
    CONSTRAINT folder_rename_log_revert_after_rename CHECK (((reverted_at IS NULL) OR (reverted_at >= renamed_at)))
);

-- SEQUENCE dam.folder_rename_log_id_seq
ALTER TABLE dam.folder_rename_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME dam.folder_rename_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- TABLE dam.image_embed_worker_heartbeat
CREATE TABLE dam.image_embed_worker_heartbeat (
    worker_id text NOT NULL,
    seen_at timestamp with time zone NOT NULL,
    CONSTRAINT image_embed_worker_heartbeat_worker_chk CHECK ((btrim(worker_id) <> ''::text))
);

-- TABLE dam.order_buy_sheet_import
CREATE TABLE dam.order_buy_sheet_import (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    file_name text,
    file_sha256 text NOT NULL,
    raw_sheet jsonb NOT NULL,
    parsed_lines jsonb NOT NULL,
    order_numbers jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb NOT NULL,
    imported_by uuid NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_buy_sheet_import_file_sha256_check CHECK ((file_sha256 ~ '^[0-9a-f]{64}$'::text))
);

-- TABLE dam.search_group_vectors
CREATE TABLE dam.search_group_vectors (
    entity_id uuid NOT NULL,
    document_type text DEFAULT 'style_group'::text NOT NULL,
    asset_id uuid,
    style_group_id uuid,
    embedding extensions.vector(768) NOT NULL,
    embedding_model text,
    CONSTRAINT search_group_vectors_document_type_check CHECK ((document_type = 'style_group'::text))
);
ALTER TABLE ONLY dam.search_group_vectors ALTER COLUMN embedding SET STORAGE PLAIN;

-- TABLE hts_rag.hts_rag_article_types
CREATE TABLE hts_rag.hts_rag_article_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    synonyms text[] DEFAULT '{}'::text[] NOT NULL,
    vocab_version text NOT NULL,
    name_embedding extensions.halfvec(768),
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_article_types_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT hts_rag_article_types_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_attribute_keys
CREATE TABLE hts_rag.hts_rag_attribute_keys (
    key text NOT NULL,
    kind text NOT NULL,
    unit text,
    vocab_version text NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_attribute_keys_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'range'::text]))),
    CONSTRAINT hts_rag_attribute_keys_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_authorities
CREATE TABLE hts_rag.hts_rag_authorities (
    id integer NOT NULL,
    kind text NOT NULL,
    ref text NOT NULL,
    ref_norm text NOT NULL,
    ruling_number text,
    hs_era text,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_authorities_kind_check CHECK ((kind = ANY (ARRAY['gri'::text, 'section_note'::text, 'chapter_note'::text, 'subheading_note'::text, 'additional_us_note'::text, 'explanatory_note'::text, 'court_case'::text, 'prior_ruling'::text, 'statute'::text, 'informed_compliance'::text, 'other'::text]))),
    CONSTRAINT hts_rag_authorities_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- SEQUENCE hts_rag.hts_rag_authorities_id_seq
ALTER TABLE hts_rag.hts_rag_authorities ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME hts_rag.hts_rag_authorities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- TABLE hts_rag.hts_rag_broker_opinions
CREATE TABLE hts_rag.hts_rag_broker_opinions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_kind text NOT NULL,
    ruling_number text,
    held_code text,
    determination_id uuid,
    rfq_item_id integer,
    broker_code text NOT NULL,
    broker_firm text NOT NULL,
    broker_person text,
    opinion_date date NOT NULL,
    notes text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_authoritative boolean DEFAULT false NOT NULL,
    recorded_by text NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_broker_opinions_code_check CHECK ((broker_code ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}$'::text)),
    CONSTRAINT hts_rag_broker_opinions_evidence_check CHECK ((jsonb_typeof(evidence) = 'array'::text)),
    CONSTRAINT hts_rag_broker_opinions_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_broker_opinions_subject_check CHECK ((((subject_kind = 'ruling_code'::text) AND (ruling_number IS NOT NULL) AND (held_code IS NOT NULL) AND (determination_id IS NULL) AND (rfq_item_id IS NULL)) OR ((subject_kind = 'product'::text) AND (determination_id IS NOT NULL) AND (ruling_number IS NULL) AND (held_code IS NULL))))
);

-- TABLE hts_rag.hts_rag_classification_jobs
CREATE TABLE hts_rag.hts_rag_classification_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    determination_id uuid NOT NULL,
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    owner_key text NOT NULL,
    created_by jsonb,
    input jsonb NOT NULL,
    result jsonb,
    error_code text,
    error_message text,
    rfq_id integer,
    rfq_item_id integer,
    source text DEFAULT 'hts_lookup'::text NOT NULL,
    source_environment text NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    estimated_cost_usd numeric,
    actual_cost_usd numeric,
    notified_at timestamp with time zone,
    applied_at timestamp with time zone,
    applied_by jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    result_public jsonb GENERATED ALWAYS AS ((result -> 'public'::text)) STORED,
    result_system_check jsonb GENERATED ALWAYS AS ((result -> 'automated_system_check'::text)) STORED,
    result_core_phrase jsonb GENERATED ALWAYS AS ((result #> '{request_snapshot,evidence,coreProductType,phrase}'::text[])) STORED,
    CONSTRAINT hts_rag_classification_jobs_attempt_check CHECK ((attempt_count >= 0)),
    CONSTRAINT hts_rag_classification_jobs_environment_check CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_classification_jobs_kind_check CHECK ((kind = ANY (ARRAY['initial'::text, 'answer'::text]))),
    CONSTRAINT hts_rag_classification_jobs_max_attempts_check CHECK ((max_attempts >= 1)),
    CONSTRAINT hts_rag_classification_jobs_source_check CHECK ((source = ANY (ARRAY['hts_lookup'::text, 'rfq'::text]))),
    CONSTRAINT hts_rag_classification_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'needs_answer'::text, 'ready'::text, 'applied'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT hts_rag_classification_jobs_turn_check CHECK ((turn_index >= 0))
);

-- TABLE hts_rag.hts_rag_classification_tests
CREATE TABLE hts_rag.hts_rag_classification_tests (
    id integer NOT NULL,
    canonical_name text NOT NULL,
    kind text NOT NULL,
    anchor_authority_id integer,
    description text,
    vocab_version integer NOT NULL,
    merged_into integer,
    embedding extensions.halfvec(768),
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_classification_tests_kind_check CHECK ((kind = ANY (ARRAY['gri'::text, 'section_note'::text, 'chapter_note'::text, 'additional_us_note'::text, 'explanatory_note'::text, 'judicial'::text, 'cbp_doctrine'::text, 'definitional'::text]))),
    CONSTRAINT hts_rag_classification_tests_not_self_merged CHECK ((merged_into IS DISTINCT FROM id)),
    CONSTRAINT hts_rag_classification_tests_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- SEQUENCE hts_rag.hts_rag_classification_tests_id_seq
ALTER TABLE hts_rag.hts_rag_classification_tests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME hts_rag.hts_rag_classification_tests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- TABLE hts_rag.hts_rag_counterfactuals
CREATE TABLE hts_rag.hts_rag_counterfactuals (
    product_id uuid NOT NULL,
    attribute_key text NOT NULL,
    if_value text NOT NULL,
    then_code_prefix text NOT NULL,
    sentence_seq integer NOT NULL,
    extraction_id uuid NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_counterfactuals_prefix_check CHECK ((then_code_prefix ~ '^[0-9]{4}(\.?[0-9]{2}){0,3}$'::text)),
    CONSTRAINT hts_rag_counterfactuals_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_debate_runs
CREATE TABLE hts_rag.hts_rag_debate_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_determination_id uuid NOT NULL,
    session_id uuid NOT NULL,
    policy_version text NOT NULL,
    case_packet_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    turn_count integer DEFAULT 0 NOT NULL,
    evidence_expansion_count integer DEFAULT 0 NOT NULL,
    spark_initial_code text,
    luna_initial_code text,
    spark_final_code text,
    luna_final_code text,
    consensus_code text,
    stop_reason text,
    evidence_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    gate_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    precedent_id uuid,
    error_code text,
    error_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_debate_runs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT hts_rag_debate_runs_case_packet_hash_check CHECK ((case_packet_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_debate_runs_consensus_code_check CHECK (((consensus_code IS NULL) OR (consensus_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_evidence_expansion_count_check CHECK ((evidence_expansion_count >= 0)),
    CONSTRAINT hts_rag_debate_runs_evidence_result_check CHECK ((jsonb_typeof(evidence_result) = 'object'::text)),
    CONSTRAINT hts_rag_debate_runs_gate_result_check CHECK ((jsonb_typeof(gate_result) = 'object'::text)),
    CONSTRAINT hts_rag_debate_runs_luna_final_code_check CHECK (((luna_final_code IS NULL) OR (luna_final_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_luna_initial_code_check CHECK (((luna_initial_code IS NULL) OR (luna_initial_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT hts_rag_debate_runs_policy_version_check CHECK ((btrim(policy_version) <> ''::text)),
    CONSTRAINT hts_rag_debate_runs_promoted_chk CHECK (((status <> 'promoted'::text) OR ((consensus_code IS NOT NULL) AND (precedent_id IS NOT NULL) AND (gate_result @> '{"passed": true}'::jsonb)))),
    CONSTRAINT hts_rag_debate_runs_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_debate_runs_spark_final_code_check CHECK (((spark_final_code IS NULL) OR (spark_final_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_spark_initial_code_check CHECK (((spark_initial_code IS NULL) OR (spark_initial_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'initial_opinions'::text, 'debating'::text, 'final_votes'::text, 'gating'::text, 'promoted'::text, 'not_proven'::text, 'failed'::text, 'dead_letter'::text]))),
    CONSTRAINT hts_rag_debate_runs_stop_reason_check CHECK (((stop_reason IS NULL) OR (stop_reason = ANY (ARRAY['converged'::text, 'needs_more_facts'::text, 'deadlocked'::text, 'degraded'::text, 'circuit_breaker'::text])))),
    CONSTRAINT hts_rag_debate_runs_terminal_completed_chk CHECK (((status <> ALL (ARRAY['promoted'::text, 'not_proven'::text, 'failed'::text, 'dead_letter'::text])) OR (completed_at IS NOT NULL))),
    CONSTRAINT hts_rag_debate_runs_turn_count_check CHECK ((turn_count >= 0))
);

-- TABLE hts_rag.hts_rag_decision_authorities
CREATE TABLE hts_rag.hts_rag_decision_authorities (
    decision_id uuid NOT NULL,
    authority_id integer NOT NULL,
    role text NOT NULL,
    sentence_seq integer NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_decision_authorities_role_check CHECK ((role = ANY (ARRAY['applied'::text, 'distinguished'::text, 'overruled'::text, 'quoted'::text, 'followed'::text]))),
    CONSTRAINT hts_rag_decision_authorities_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_decision_facts
CREATE TABLE hts_rag.hts_rag_decision_facts (
    decision_test_id uuid NOT NULL,
    attribute_id uuid,
    attribute_key text NOT NULL,
    direction text NOT NULL,
    sentence_seq integer NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_decision_facts_direction_check CHECK ((direction = ANY (ARRAY['supports'::text, 'defeats'::text]))),
    CONSTRAINT hts_rag_decision_facts_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_decision_tests
CREATE TABLE hts_rag.hts_rag_decision_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id uuid NOT NULL,
    test_id integer NOT NULL,
    outcome text NOT NULL,
    is_dispositive boolean DEFAULT false NOT NULL,
    reason_sentence_seq integer,
    extraction_id uuid NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_decision_tests_outcome_check CHECK ((outcome = ANY (ARRAY['satisfied'::text, 'failed'::text, 'not_reached'::text, 'assumed'::text]))),
    CONSTRAINT hts_rag_decision_tests_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_determinations
CREATE TABLE hts_rag.hts_rag_determinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_example_id uuid NOT NULL,
    precedent_id uuid,
    method text NOT NULL,
    proposed_hts text,
    classification_state text NOT NULL,
    operative_eligible boolean DEFAULT false NOT NULL,
    result_hash text NOT NULL,
    comparison_key uuid NOT NULL,
    comparison_review_state text DEFAULT 'unreviewed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    comparison_category text DEFAULT 'not_compared'::text NOT NULL,
    comparison_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    session_id uuid,
    completion_key text,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_determinations_classification_state_check CHECK ((classification_state = ANY (ARRAY['needs_more_facts'::text, 'provisional_complete'::text]))),
    CONSTRAINT hts_rag_determinations_comparison_category_chk CHECK ((comparison_category = ANY (ARRAY['not_compared'::text, 'agree'::text, 'agree_at_heading'::text, 'disagree'::text, 'incomparable'::text]))),
    CONSTRAINT hts_rag_determinations_comparison_details_chk CHECK ((jsonb_typeof(comparison_details) = 'object'::text)),
    CONSTRAINT hts_rag_determinations_comparison_review_state_check CHECK ((comparison_review_state = ANY (ARRAY['unreviewed'::text, 'accepted'::text, 'rejected'::text, 'needs_revision'::text]))),
    CONSTRAINT hts_rag_determinations_completion_key_chk CHECK (((completion_key IS NULL) OR (btrim(completion_key) <> ''::text))),
    CONSTRAINT hts_rag_determinations_completion_session_chk CHECK (((completion_key IS NULL) OR (session_id IS NOT NULL))),
    CONSTRAINT hts_rag_determinations_method_check CHECK ((method = ANY (ARRAY['legacy_ai_cross'::text, 'rag_shadow'::text]))),
    CONSTRAINT hts_rag_determinations_operability_chk CHECK (((NOT operative_eligible) OR (classification_state = 'provisional_complete'::text))),
    CONSTRAINT hts_rag_determinations_operative_proposed_hts_chk CHECK (((NOT operative_eligible) OR (NULLIF(btrim(proposed_hts), ''::text) IS NOT NULL))),
    CONSTRAINT hts_rag_determinations_proposed_hts_check CHECK (((proposed_hts IS NULL) OR (proposed_hts ~ '^[0-9]{4}([.][0-9]{2}){0,3}$'::text))),
    CONSTRAINT hts_rag_determinations_result_hash_check CHECK ((result_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_determinations_shadow_precedent_chk CHECK (((method <> 'rag_shadow'::text) OR (precedent_id IS NOT NULL))),
    CONSTRAINT hts_rag_determinations_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_extraction_jobs
CREATE TABLE hts_rag.hts_rag_extraction_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_example_id uuid NOT NULL,
    prompt_version text NOT NULL,
    model_version text NOT NULL,
    extraction_version text NOT NULL,
    input_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    attempt_count integer DEFAULT 0 NOT NULL,
    result_hash text,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    raw_extraction jsonb,
    parse_state text DEFAULT 'unparsed'::text NOT NULL,
    parse_error_code text,
    max_attempts integer DEFAULT 3 NOT NULL,
    dead_lettered_at timestamp with time zone,
    dead_letter_reason text,
    review_needed boolean DEFAULT false NOT NULL,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_extraction_jobs_active_claim_chk CHECK (((status <> ALL (ARRAY['running'::text, 'succeeded'::text])) OR (claimed_at IS NOT NULL))),
    CONSTRAINT hts_rag_extraction_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT hts_rag_extraction_jobs_claim_chk CHECK (((claimed_at IS NULL) = (claimed_by IS NULL))),
    CONSTRAINT hts_rag_extraction_jobs_completion_chk CHECK (((status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text])) = (completed_at IS NOT NULL))),
    CONSTRAINT hts_rag_extraction_jobs_dead_letter_pair_chk CHECK (((dead_lettered_at IS NULL) = (dead_letter_reason IS NULL))),
    CONSTRAINT hts_rag_extraction_jobs_dead_letter_reason_chk CHECK (((dead_letter_reason IS NULL) OR (btrim(dead_letter_reason) <> ''::text))),
    CONSTRAINT hts_rag_extraction_jobs_dead_letter_terminal_chk CHECK (((dead_lettered_at IS NULL) OR (status = ANY (ARRAY['failed'::text, 'cancelled'::text])))),
    CONSTRAINT hts_rag_extraction_jobs_extraction_version_check CHECK ((btrim(extraction_version) <> ''::text)),
    CONSTRAINT hts_rag_extraction_jobs_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_extraction_jobs_max_attempts_chk CHECK ((max_attempts >= 1)),
    CONSTRAINT hts_rag_extraction_jobs_model_version_check CHECK ((btrim(model_version) <> ''::text)),
    CONSTRAINT hts_rag_extraction_jobs_parse_artifact_chk CHECK (((parse_state = 'unparsed'::text) OR (raw_extraction IS NOT NULL))),
    CONSTRAINT hts_rag_extraction_jobs_parse_error_chk CHECK (((parse_state <> 'unparseable'::text) OR (btrim(COALESCE(parse_error_code, ''::text)) <> ''::text))),
    CONSTRAINT hts_rag_extraction_jobs_parse_state_chk CHECK ((parse_state = ANY (ARRAY['unparsed'::text, 'parsed'::text, 'unparseable'::text, 'enriched'::text]))),
    CONSTRAINT hts_rag_extraction_jobs_pending_unclaimed_chk CHECK (((status <> 'pending'::text) OR (claimed_at IS NULL))),
    CONSTRAINT hts_rag_extraction_jobs_prompt_version_check CHECK ((btrim(prompt_version) <> ''::text)),
    CONSTRAINT hts_rag_extraction_jobs_raw_extraction_chk CHECK (((raw_extraction IS NULL) OR (jsonb_typeof(raw_extraction) = 'object'::text))),
    CONSTRAINT hts_rag_extraction_jobs_result_hash_check CHECK (((result_hash IS NULL) OR (result_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT hts_rag_extraction_jobs_retry_budget_chk CHECK (((attempt_count < max_attempts) OR (status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'cancelled'::text])))),
    CONSTRAINT hts_rag_extraction_jobs_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_extraction_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT hts_rag_extraction_jobs_success_result_chk CHECK (((status <> 'succeeded'::text) OR (result_hash IS NOT NULL)))
);

-- TABLE hts_rag.hts_rag_extractions
CREATE TABLE hts_rag.hts_rag_extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruling_number text NOT NULL,
    pass text NOT NULL,
    extract_version text NOT NULL,
    model text NOT NULL,
    prompt_hash text NOT NULL,
    text_hash text NOT NULL,
    raw_output jsonb,
    cost_usd numeric(8,5),
    is_current boolean DEFAULT false NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_extractions_pass_check CHECK ((pass = ANY (ARRAY['product'::text, 'reasoning'::text, 'revocation'::text]))),
    CONSTRAINT hts_rag_extractions_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_heading_decisions
CREATE TABLE hts_rag.hts_rag_heading_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    heading text NOT NULL,
    outcome text NOT NULL,
    rule_used text[] DEFAULT '{}'::text[] NOT NULL,
    legal_note_refs text[] DEFAULT '{}'::text[] NOT NULL,
    reason_text text,
    decisive_keys text[] DEFAULT '{}'::text[] NOT NULL,
    source_span int4range,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code_prefix text,
    rejected_proposed_by text,
    sentence_seq integer,
    extraction_id uuid,
    CONSTRAINT hts_rag_heading_decisions_code_prefix_check CHECK (((code_prefix IS NULL) OR ((code_prefix ~ '^[0-9]{4}(\.?[0-9]{2}){0,3}$'::text) AND ("left"(code_prefix, 4) = heading)))),
    CONSTRAINT hts_rag_heading_decisions_heading_check CHECK ((heading ~ '^[0-9]{4}$'::text)),
    CONSTRAINT hts_rag_heading_decisions_outcome_check CHECK ((outcome = ANY (ARRAY['held'::text, 'rejected'::text, 'alternative_mentioned'::text]))),
    CONSTRAINT hts_rag_heading_decisions_proposed_by_check CHECK (((rejected_proposed_by IS NULL) OR (rejected_proposed_by = ANY (ARRAY['importer'::text, 'cbp_alternative'::text, 'prior_ruling'::text])))),
    CONSTRAINT hts_rag_heading_decisions_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_products
CREATE TABLE hts_rag.hts_rag_ruling_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruling_number text NOT NULL,
    item_label text NOT NULL,
    plain_phrase text NOT NULL,
    article_type_id uuid,
    primary_material_id uuid,
    description_text text,
    held_code text,
    held_code_current text[] DEFAULT '{}'::text[] NOT NULL,
    held_heading text,
    held_chapter text,
    is_set boolean DEFAULT false NOT NULL,
    is_composite boolean DEFAULT false NOT NULL,
    source_span int4range,
    effective_status text DEFAULT 'active'::text NOT NULL,
    phrase_embedding extensions.halfvec(768),
    confidence_checks jsonb DEFAULT '{}'::jsonb NOT NULL,
    review_state text DEFAULT 'pending'::text NOT NULL,
    extract_version text NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    extraction_id uuid,
    likely_superseded boolean DEFAULT false NOT NULL,
    CONSTRAINT hts_rag_ruling_products_chapter_check CHECK (((held_chapter IS NULL) OR (held_chapter ~ '^[0-9]{2}$'::text))),
    CONSTRAINT hts_rag_ruling_products_checks_object CHECK ((jsonb_typeof(confidence_checks) = 'object'::text)),
    CONSTRAINT hts_rag_ruling_products_heading_check CHECK (((held_heading IS NULL) OR (held_heading ~ '^[0-9]{4}$'::text))),
    CONSTRAINT hts_rag_ruling_products_review_check CHECK ((review_state = ANY (ARRAY['pending'::text, 'trusted'::text, 'review_queue'::text, 'rejected'::text]))),
    CONSTRAINT hts_rag_ruling_products_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_ruling_products_status_check CHECK ((effective_status = ANY (ARRAY['active'::text, 'modified'::text, 'revoked'::text, 'superseded_by_law'::text])))
);

-- MATERIALIZED VIEW hts_rag.hts_rag_fault_lines
CREATE MATERIALIZED VIEW hts_rag.hts_rag_fault_lines AS
 WITH pairs AS (
         SELECT p.id AS product_id,
            p.article_type_id,
            COALESCE(held.code_prefix, held.heading) AS held_prefix,
            COALESCE(rej.code_prefix, rej.heading) AS rejected_prefix,
            held.id AS held_decision_id,
            rej.id AS rejected_decision_id
           FROM ((hts_rag.hts_rag_ruling_products p
             JOIN hts_rag.hts_rag_heading_decisions held ON (((held.product_id = p.id) AND (held.outcome = 'held'::text))))
             JOIN hts_rag.hts_rag_heading_decisions rej ON (((rej.product_id = p.id) AND (rej.outcome = 'rejected'::text))))
          WHERE ((p.effective_status = 'active'::text) AND (p.review_state = 'trusted'::text))
        ), keys AS (
         SELECT DISTINCT dt.decision_id,
            dt.test_id,
            df.attribute_key
           FROM (hts_rag.hts_rag_decision_tests dt
             JOIN hts_rag.hts_rag_decision_facts df ON ((df.decision_test_id = dt.id)))
        )
 SELECT LEAST(pr.held_prefix, pr.rejected_prefix) AS prefix_a,
    GREATEST(pr.held_prefix, pr.rejected_prefix) AS prefix_b,
    pr.article_type_id,
    k.test_id,
    k.attribute_key,
    count(DISTINCT pr.product_id) AS n_products,
    count(DISTINCT pr.product_id) FILTER (WHERE (pr.held_prefix < pr.rejected_prefix)) AS n_held_a,
    count(DISTINCT pr.product_id) FILTER (WHERE (pr.held_prefix > pr.rejected_prefix)) AS n_held_b,
    (array_agg(DISTINCT pr.product_id))[1:3] AS example_products
   FROM ((pairs pr
     CROSS JOIN LATERAL ( VALUES (pr.held_decision_id), (pr.rejected_decision_id)) d(decision_id))
     JOIN keys k ON ((k.decision_id = d.decision_id)))
  GROUP BY LEAST(pr.held_prefix, pr.rejected_prefix), GREATEST(pr.held_prefix, pr.rejected_prefix), pr.article_type_id, k.test_id, k.attribute_key
  WITH NO DATA;

-- MATERIALIZED VIEW hts_rag.hts_rag_fault_lines_any_type
CREATE MATERIALIZED VIEW hts_rag.hts_rag_fault_lines_any_type AS
 WITH pairs AS (
         SELECT p.id AS product_id,
            COALESCE(held.code_prefix, held.heading) AS held_prefix,
            COALESCE(rej.code_prefix, rej.heading) AS rejected_prefix,
            held.id AS held_decision_id,
            rej.id AS rejected_decision_id
           FROM ((hts_rag.hts_rag_ruling_products p
             JOIN hts_rag.hts_rag_heading_decisions held ON (((held.product_id = p.id) AND (held.outcome = 'held'::text))))
             JOIN hts_rag.hts_rag_heading_decisions rej ON (((rej.product_id = p.id) AND (rej.outcome = 'rejected'::text))))
          WHERE ((p.effective_status = 'active'::text) AND (p.review_state = 'trusted'::text))
        ), keys AS (
         SELECT DISTINCT dt.decision_id,
            dt.test_id,
            df.attribute_key
           FROM (hts_rag.hts_rag_decision_tests dt
             JOIN hts_rag.hts_rag_decision_facts df ON ((df.decision_test_id = dt.id)))
        )
 SELECT LEAST(pr.held_prefix, pr.rejected_prefix) AS prefix_a,
    GREATEST(pr.held_prefix, pr.rejected_prefix) AS prefix_b,
    k.test_id,
    k.attribute_key,
    count(DISTINCT pr.product_id) AS n_products,
    count(DISTINCT pr.product_id) FILTER (WHERE (pr.held_prefix < pr.rejected_prefix)) AS n_held_a,
    count(DISTINCT pr.product_id) FILTER (WHERE (pr.held_prefix > pr.rejected_prefix)) AS n_held_b,
    (array_agg(DISTINCT pr.product_id))[1:3] AS example_products
   FROM ((pairs pr
     CROSS JOIN LATERAL ( VALUES (pr.held_decision_id), (pr.rejected_decision_id)) d(decision_id))
     JOIN keys k ON ((k.decision_id = d.decision_id)))
  GROUP BY LEAST(pr.held_prefix, pr.rejected_prefix), GREATEST(pr.held_prefix, pr.rejected_prefix), k.test_id, k.attribute_key
  WITH NO DATA;

-- TABLE hts_rag.hts_rag_hts_codes
CREATE TABLE hts_rag.hts_rag_hts_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    revision text NOT NULL,
    description text NOT NULL,
    indent smallint DEFAULT 0 NOT NULL,
    parent_code text,
    valid_from date,
    valid_to date,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_hts_codes_code_check CHECK ((code ~ '^[0-9]{4}(\.[0-9]{2}){0,3}$'::text)),
    CONSTRAINT hts_rag_hts_codes_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_hts_renumbering
CREATE TABLE hts_rag.hts_rag_hts_renumbering (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    old_code text NOT NULL,
    new_code text,
    revision text NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_url text,
    is_partial boolean DEFAULT false NOT NULL,
    CONSTRAINT hts_rag_hts_renumbering_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_materials
CREATE TABLE hts_rag.hts_rag_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    synonyms text[] DEFAULT '{}'::text[] NOT NULL,
    vocab_version text NOT NULL,
    name_embedding extensions.halfvec(768),
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_materials_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT hts_rag_materials_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_precedent_rulings
CREATE TABLE hts_rag.hts_rag_precedent_rulings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    precedent_id uuid NOT NULL,
    ruling_id uuid NOT NULL,
    provisional_claim text,
    verifier_relevance text DEFAULT 'unverified'::text NOT NULL,
    source_status text DEFAULT 'unknown'::text NOT NULL,
    final_relationship text,
    verifier_result_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_precedent_rulings_final_relationship_check CHECK (((final_relationship IS NULL) OR (final_relationship = ANY (ARRAY['relied_on'::text, 'supporting'::text, 'contrasting'::text, 'background'::text])))),
    CONSTRAINT hts_rag_precedent_rulings_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_precedent_rulings_source_status_check CHECK ((source_status = ANY (ARRAY['unknown'::text, 'active'::text, 'modified'::text, 'revoked'::text]))),
    CONSTRAINT hts_rag_precedent_rulings_verifier_relevance_check CHECK ((verifier_relevance = ANY (ARRAY['unverified'::text, 'relevant'::text, 'unrelated'::text, 'conflicting'::text]))),
    CONSTRAINT hts_rag_precedent_rulings_verifier_result_hash_check CHECK (((verifier_result_hash IS NULL) OR (verifier_result_hash ~ '^[0-9a-f]{64}$'::text)))
);

-- TABLE hts_rag.hts_rag_precedents
CREATE TABLE hts_rag.hts_rag_precedents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_family text NOT NULL,
    fixture_version text NOT NULL,
    prompt_version text NOT NULL,
    classifier_model text NOT NULL,
    verifier_model text NOT NULL,
    extraction_version text NOT NULL,
    fixture_hash text NOT NULL,
    input_hash text NOT NULL,
    raw_result_hash text NOT NULL,
    normalized_facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    positive_attributes jsonb DEFAULT '[]'::jsonb NOT NULL,
    negative_attributes jsonb DEFAULT '[]'::jsonb NOT NULL,
    exclusions_checked jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_critical_facts jsonb DEFAULT '[]'::jsonb NOT NULL,
    conflicts jsonb DEFAULT '[]'::jsonb NOT NULL,
    plausible_headings jsonb DEFAULT '[]'::jsonb NOT NULL,
    proposed_hts text,
    classification_state text NOT NULL,
    reasoning_summary text,
    confidence_components jsonb DEFAULT '{}'::jsonb NOT NULL,
    decision_card_candidate boolean DEFAULT false NOT NULL,
    operative_eligible boolean DEFAULT false NOT NULL,
    review_state text DEFAULT 'unreviewed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    promotion_basis text DEFAULT 'legacy_unspecified'::text NOT NULL,
    promotion_policy_version text,
    promotion_source_determination_id uuid,
    promotion_debate_run_id uuid,
    promotion_gate_result jsonb,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_precedents_classification_state_check CHECK ((classification_state = ANY (ARRAY['needs_more_facts'::text, 'provisional_complete'::text]))),
    CONSTRAINT hts_rag_precedents_classifier_model_check CHECK ((btrim(classifier_model) <> ''::text)),
    CONSTRAINT hts_rag_precedents_confidence_components_check CHECK ((jsonb_typeof(confidence_components) = 'object'::text)),
    CONSTRAINT hts_rag_precedents_conflicts_check CHECK ((jsonb_typeof(conflicts) = 'array'::text)),
    CONSTRAINT hts_rag_precedents_dual_model_provenance_chk CHECK (((promotion_basis <> 'dual_model_verified'::text) OR ((promotion_debate_run_id IS NOT NULL) AND (promotion_policy_version IS NOT NULL) AND (promotion_gate_result IS NOT NULL)))),
    CONSTRAINT hts_rag_precedents_exclusions_checked_check CHECK ((jsonb_typeof(exclusions_checked) = 'array'::text)),
    CONSTRAINT hts_rag_precedents_extraction_version_check CHECK ((btrim(extraction_version) <> ''::text)),
    CONSTRAINT hts_rag_precedents_fixture_hash_check CHECK ((fixture_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_precedents_fixture_version_check CHECK ((btrim(fixture_version) <> ''::text)),
    CONSTRAINT hts_rag_precedents_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_precedents_missing_critical_facts_check CHECK ((jsonb_typeof(missing_critical_facts) = 'array'::text)),
    CONSTRAINT hts_rag_precedents_negative_attributes_check CHECK ((jsonb_typeof(negative_attributes) = 'array'::text)),
    CONSTRAINT hts_rag_precedents_normalized_facts_check CHECK ((jsonb_typeof(normalized_facts) = 'object'::text)),
    CONSTRAINT hts_rag_precedents_operability_chk CHECK (((NOT operative_eligible) OR (classification_state = 'provisional_complete'::text))),
    CONSTRAINT hts_rag_precedents_plausible_headings_check CHECK ((jsonb_typeof(plausible_headings) = 'array'::text)),
    CONSTRAINT hts_rag_precedents_positive_attributes_check CHECK ((jsonb_typeof(positive_attributes) = 'array'::text)),
    CONSTRAINT hts_rag_precedents_product_family_check CHECK ((btrim(product_family) <> ''::text)),
    CONSTRAINT hts_rag_precedents_promotion_basis_chk CHECK ((promotion_basis = ANY (ARRAY['human_review'::text, 'dual_model_verified'::text, 'legacy_unspecified'::text]))),
    CONSTRAINT hts_rag_precedents_promotion_gate_result_chk CHECK (((promotion_gate_result IS NULL) OR (jsonb_typeof(promotion_gate_result) = 'object'::text))),
    CONSTRAINT hts_rag_precedents_promotion_policy_version_chk CHECK (((promotion_policy_version IS NULL) OR (btrim(promotion_policy_version) <> ''::text))),
    CONSTRAINT hts_rag_precedents_prompt_version_check CHECK ((btrim(prompt_version) <> ''::text)),
    CONSTRAINT hts_rag_precedents_proposed_hts_check CHECK (((proposed_hts IS NULL) OR (proposed_hts ~ '^[0-9]{4}([.][0-9]{2}){0,3}$'::text))),
    CONSTRAINT hts_rag_precedents_raw_result_hash_check CHECK ((raw_result_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_precedents_review_state_check CHECK ((review_state = ANY (ARRAY['unreviewed'::text, 'accepted'::text, 'rejected'::text, 'needs_revision'::text]))),
    CONSTRAINT hts_rag_precedents_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_precedents_verifier_model_check CHECK ((btrim(verifier_model) <> ''::text))
);

-- TABLE hts_rag.hts_rag_product_attributes
CREATE TABLE hts_rag.hts_rag_product_attributes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    key text NOT NULL,
    value_text text,
    value_num numeric,
    unit text,
    basis text,
    is_decisive boolean DEFAULT false NOT NULL,
    source_span int4range NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sentence_seq integer,
    CONSTRAINT hts_rag_product_attributes_basis_check CHECK (((basis IS NULL) OR (basis = ANY (ARRAY['weight'::text, 'value'::text, 'surface'::text, 'volume'::text, 'count'::text])))),
    CONSTRAINT hts_rag_product_attributes_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_product_attributes_value_check CHECK (((value_text IS NOT NULL) OR (value_num IS NOT NULL)))
);

-- TABLE hts_rag.hts_rag_product_components
CREATE TABLE hts_rag.hts_rag_product_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    component text NOT NULL,
    material text,
    own_code_if_stated text,
    is_essential_character boolean DEFAULT false NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_product_components_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_product_examples
CREATE TABLE hts_rag.hts_rag_product_examples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_family text NOT NULL,
    fixture_version text NOT NULL,
    fixture_hash text NOT NULL,
    input_hash text NOT NULL,
    facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_product_examples_facts_check CHECK ((jsonb_typeof(facts) = 'object'::text)),
    CONSTRAINT hts_rag_product_examples_fixture_hash_check CHECK ((fixture_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_product_examples_fixture_version_check CHECK ((btrim(fixture_version) <> ''::text)),
    CONSTRAINT hts_rag_product_examples_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_product_examples_product_family_check CHECK ((btrim(product_family) <> ''::text)),
    CONSTRAINT hts_rag_product_examples_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_product_family_allowlist
CREATE TABLE hts_rag.hts_rag_product_family_allowlist (
    product_family text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    enabled_at timestamp with time zone,
    enabled_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_product_family_allowlist_enabled_chk CHECK ((((NOT enabled) AND (enabled_at IS NULL) AND (enabled_by IS NULL)) OR (enabled AND (enabled_at IS NOT NULL) AND (enabled_by IS NOT NULL) AND (btrim(COALESCE(reason, ''::text)) <> ''::text)))),
    CONSTRAINT hts_rag_product_family_allowlist_product_family_check CHECK ((btrim(product_family) <> ''::text)),
    CONSTRAINT hts_rag_product_family_allowlist_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_provider_responses
CREATE TABLE hts_rag.hts_rag_provider_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    turn_role text NOT NULL,
    determination_id uuid,
    extraction_job_id uuid,
    provider text NOT NULL,
    model_version text NOT NULL,
    prompt_version text NOT NULL,
    request_hash text NOT NULL,
    raw_response jsonb NOT NULL,
    raw_response_hash text NOT NULL,
    parse_state text DEFAULT 'unparsed'::text NOT NULL,
    parsed_payload jsonb,
    parse_error_code text,
    enrichment_state text DEFAULT 'none'::text NOT NULL,
    persisted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_provider_responses_enrichment_chk CHECK (((enrichment_state <> 'enriched'::text) OR (parse_state = 'enriched'::text))),
    CONSTRAINT hts_rag_provider_responses_enrichment_state_check CHECK ((enrichment_state = ANY (ARRAY['none'::text, 'pending'::text, 'enriched'::text, 'failed'::text]))),
    CONSTRAINT hts_rag_provider_responses_model_version_check CHECK ((btrim(model_version) <> ''::text)),
    CONSTRAINT hts_rag_provider_responses_parse_error_chk CHECK (((parse_state <> 'unparseable'::text) OR (btrim(COALESCE(parse_error_code, ''::text)) <> ''::text))),
    CONSTRAINT hts_rag_provider_responses_parse_state_check CHECK ((parse_state = ANY (ARRAY['unparsed'::text, 'parsed'::text, 'unparseable'::text, 'enriched'::text]))),
    CONSTRAINT hts_rag_provider_responses_parsed_payload_check CHECK (((parsed_payload IS NULL) OR (jsonb_typeof(parsed_payload) = 'object'::text))),
    CONSTRAINT hts_rag_provider_responses_parsed_payload_chk CHECK (((parse_state <> ALL (ARRAY['parsed'::text, 'enriched'::text])) OR (parsed_payload IS NOT NULL))),
    CONSTRAINT hts_rag_provider_responses_prompt_version_check CHECK ((btrim(prompt_version) <> ''::text)),
    CONSTRAINT hts_rag_provider_responses_provider_check CHECK ((btrim(provider) <> ''::text)),
    CONSTRAINT hts_rag_provider_responses_raw_response_check CHECK ((jsonb_typeof(raw_response) = 'object'::text)),
    CONSTRAINT hts_rag_provider_responses_raw_response_hash_check CHECK ((raw_response_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_provider_responses_release_order_chk CHECK (((released_at IS NULL) OR (released_at >= persisted_at))),
    CONSTRAINT hts_rag_provider_responses_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_provider_responses_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_provider_responses_subject_chk CHECK (((determination_id IS NOT NULL) OR (extraction_job_id IS NOT NULL))),
    CONSTRAINT hts_rag_provider_responses_turn_index_check CHECK ((turn_index >= 0)),
    CONSTRAINT hts_rag_provider_responses_turn_role_check CHECK ((turn_role = ANY (ARRAY['extractor'::text, 'classifier'::text, 'verifier'::text, 'legacy_ai_cross'::text])))
);

-- TABLE hts_rag.hts_rag_review_events
CREATE TABLE hts_rag.hts_rag_review_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    action text NOT NULL,
    prior_state text,
    new_state text,
    notes text,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    CONSTRAINT hts_rag_review_events_action_check CHECK ((btrim(action) <> ''::text)),
    CONSTRAINT hts_rag_review_events_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_review_events_subject_type_check CHECK ((subject_type = ANY (ARRAY['precedent'::text, 'determination'::text, 'precedent_ruling'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_codes
CREATE TABLE hts_rag.hts_rag_ruling_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruling_number text NOT NULL,
    code text NOT NULL,
    role text NOT NULL,
    source_span int4range,
    extract_version text NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_ruling_codes_role_check CHECK ((role = ANY (ARRAY['held'::text, 'rejected'::text, 'mentioned'::text, 'cited_from_other_ruling'::text]))),
    CONSTRAINT hts_rag_ruling_codes_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_current_codes
CREATE TABLE hts_rag.hts_rag_ruling_current_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruling_number text NOT NULL,
    held_code text NOT NULL,
    state text NOT NULL,
    current_code text,
    candidate_codes text[] DEFAULT '{}'::text[] NOT NULL,
    confidence text,
    reason text,
    method text NOT NULL,
    mapping_path text[] DEFAULT '{}'::text[] NOT NULL,
    hts_revision text NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_ruling_current_codes_code_check CHECK ((((current_code IS NULL) OR (current_code ~ '^[0-9]{4}(\.[0-9]{2}){0,3}$'::text)) AND (array_position(candidate_codes, NULL::text) IS NULL) AND (array_position(candidate_codes, ''::text) IS NULL) AND (array_to_string(candidate_codes, ','::text) ~ '^([0-9]{4}(\.[0-9]{2}){0,3}(,|$))*$'::text))),
    CONSTRAINT hts_rag_ruling_current_codes_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))),
    CONSTRAINT hts_rag_ruling_current_codes_method_check CHECK ((method = ANY (ARRAY['exact'::text, 'concordance'::text, 'model'::text, 'none'::text]))),
    CONSTRAINT hts_rag_ruling_current_codes_shape_check CHECK ((((state = ANY (ARRAY['current'::text, 'mapped'::text])) AND (current_code IS NOT NULL) AND (current_code = ANY (candidate_codes))) OR ((state = 'split'::text) AND (current_code IS NULL) AND (cardinality(candidate_codes) > 1)) OR ((state = 'unmapped'::text) AND (current_code IS NULL) AND (cardinality(candidate_codes) = 0)))),
    CONSTRAINT hts_rag_ruling_current_codes_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_ruling_current_codes_state_check CHECK ((state = ANY (ARRAY['current'::text, 'mapped'::text, 'split'::text, 'unmapped'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_ingest_jobs
CREATE TABLE hts_rag.hts_rag_ruling_ingest_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruling_number text NOT NULL,
    source_determination_id uuid,
    source_environment text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    claimed_by text,
    claimed_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    error_code text,
    error_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT hts_rag_ruling_ingest_jobs_attempt_check CHECK ((attempt_count >= 0)),
    CONSTRAINT hts_rag_ruling_ingest_jobs_max_attempts_check CHECK ((max_attempts >= 1)),
    CONSTRAINT hts_rag_ruling_ingest_jobs_ruling_number_check CHECK ((btrim(ruling_number) <> ''::text)),
    CONSTRAINT hts_rag_ruling_ingest_jobs_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_ruling_ingest_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'done'::text, 'dead_letter'::text]))),
    CONSTRAINT hts_rag_ruling_ingest_jobs_terminal_completed_chk CHECK (((status <> ALL (ARRAY['done'::text, 'dead_letter'::text])) OR (completed_at IS NOT NULL)))
);

-- TABLE hts_rag.hts_rag_ruling_links
CREATE TABLE hts_rag.hts_rag_ruling_links (
    from_ruling text NOT NULL,
    to_ruling text NOT NULL,
    kind text NOT NULL,
    link_source text NOT NULL,
    product_label text,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    affected_product_ids uuid[],
    CONSTRAINT hts_rag_ruling_links_kind_check CHECK ((kind = ANY (ARRAY['revokes'::text, 'modifies'::text, 'cites'::text, 'follows'::text, 'distinguishes'::text]))),
    CONSTRAINT hts_rag_ruling_links_source_check CHECK ((link_source = ANY (ARRAY['cbp_field'::text, 'text'::text]))),
    CONSTRAINT hts_rag_ruling_links_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_passb
CREATE TABLE hts_rag.hts_rag_ruling_passb (
    ruling_number text NOT NULL,
    extract_version text NOT NULL,
    model text NOT NULL,
    prompt_hash text NOT NULL,
    text_hash text NOT NULL,
    trigger_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    raw_output jsonb,
    cost_usd numeric(8,5),
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_ruling_passb_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_scope_labels
CREATE TABLE hts_rag.hts_rag_ruling_scope_labels (
    ruling_number text NOT NULL,
    label_version text NOT NULL,
    scope_label text NOT NULL,
    in_scope boolean NOT NULL,
    method text NOT NULL,
    model text,
    confidence numeric(4,3),
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_ruling_scope_labels_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT hts_rag_ruling_scope_labels_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT hts_rag_ruling_scope_labels_label_check CHECK ((scope_label = ANY (ARRAY['classification'::text, 'marking'::text, 'country_of_origin'::text, 'valuation'::text, 'carriers'::text, 'drawback'::text, 'entry'::text, 'liquidation'::text, 'tsus'::text, 'other'::text]))),
    CONSTRAINT hts_rag_ruling_scope_labels_method_check CHECK ((method = ANY (ARRAY['source'::text, 'rule'::text, 'model'::text, 'manual'::text]))),
    CONSTRAINT hts_rag_ruling_scope_labels_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_ruling_sentences
CREATE TABLE hts_rag.hts_rag_ruling_sentences (
    ruling_number text NOT NULL,
    seq integer NOT NULL,
    section text NOT NULL,
    span int4range NOT NULL,
    text_norm text NOT NULL,
    text_hash text NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_ruling_sentences_hash_check CHECK ((text_hash ~ '^[0-9a-f]{40}$'::text)),
    CONSTRAINT hts_rag_ruling_sentences_section_check CHECK ((section = ANY (ARRAY['header'::text, 'facts'::text, 'issue'::text, 'analysis'::text, 'holding'::text, 'effect'::text, 'boilerplate'::text, 'signature'::text, 'unknown'::text]))),
    CONSTRAINT hts_rag_ruling_sentences_seq_check CHECK ((seq >= 0)),
    CONSTRAINT hts_rag_ruling_sentences_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- TABLE hts_rag.hts_rag_rulings
CREATE TABLE hts_rag.hts_rag_rulings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruling_number text NOT NULL,
    full_text text NOT NULL,
    full_text_hash text NOT NULL,
    subject text,
    ruling_date date,
    collection text,
    tariffs jsonb DEFAULT '[]'::jsonb NOT NULL,
    operationally_revoked boolean DEFAULT false NOT NULL,
    revoked_by jsonb DEFAULT '[]'::jsonb NOT NULL,
    modified_by jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_url text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    category text,
    raw_json jsonb,
    hs_era text,
    effective_status text DEFAULT 'active'::text NOT NULL,
    extract_version text,
    extracted_at timestamp with time zone,
    pdf_url text,
    search_tsv tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(subject, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, "left"(full_text, 3000)), 'D'::"char"))) STORED,
    CONSTRAINT hts_rag_rulings_effective_status_check CHECK ((effective_status = ANY (ARRAY['active'::text, 'modified'::text, 'revoked'::text]))),
    CONSTRAINT hts_rag_rulings_modified_by_array_check CHECK ((jsonb_typeof(modified_by) = 'array'::text)),
    CONSTRAINT hts_rag_rulings_revoked_by_array_check CHECK ((jsonb_typeof(revoked_by) = 'array'::text)),
    CONSTRAINT hts_rag_rulings_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT hts_rag_rulings_tariffs_array_check CHECK ((jsonb_typeof(tariffs) = 'array'::text))
);

-- TABLE hts_rag.hts_rag_test_aliases
CREATE TABLE hts_rag.hts_rag_test_aliases (
    alias text NOT NULL,
    test_id integer NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hts_rag_test_aliases_alias_check CHECK (((alias = lower(btrim(alias))) AND (alias <> ''::text))),
    CONSTRAINT hts_rag_test_aliases_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text])))
);

-- MATERIALIZED VIEW hts_rag.hts_rag_type_heading_stats
CREATE MATERIALIZED VIEW hts_rag.hts_rag_type_heading_stats AS
 SELECT p.article_type_id,
    (GROUPING(p.primary_material_id) = 1) AS all_materials,
    p.primary_material_id,
    d.heading,
    "left"(d.heading, 2) AS chapter,
    d.outcome,
    count(DISTINCT p.id) AS product_count,
    count(DISTINCT p.ruling_number) AS ruling_count,
    max(r.ruling_date) AS newest_ruling_date
   FROM ((hts_rag.hts_rag_heading_decisions d
     JOIN hts_rag.hts_rag_ruling_products p ON ((p.id = d.product_id)))
     JOIN hts_rag.hts_rag_rulings r ON ((r.ruling_number = p.ruling_number)))
  WHERE ((p.effective_status = 'active'::text) AND (p.review_state = 'trusted'::text) AND (p.article_type_id IS NOT NULL))
  GROUP BY GROUPING SETS ((p.article_type_id, d.heading, d.outcome), (p.article_type_id, p.primary_material_id, d.heading, d.outcome))
  WITH NO DATA;

-- TABLE hts_rag.item_classification_fact
CREATE TABLE hts_rag.item_classification_fact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_ref text NOT NULL,
    family text NOT NULL,
    fact_key text NOT NULL,
    fact_value text NOT NULL,
    source text NOT NULL,
    answered_by text NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    source_environment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_classification_fact_fact_key_check CHECK ((fact_key ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT item_classification_fact_family_check CHECK ((family ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT item_classification_fact_item_ref_check CHECK (((length(btrim(item_ref)) >= 1) AND (length(btrim(item_ref)) <= 200))),
    CONSTRAINT item_classification_fact_source_check CHECK ((source = ANY (ARRAY['requester'::text, 'designer'::text, 'import'::text]))),
    CONSTRAINT item_classification_fact_source_environment_chk CHECK ((source_environment = ANY (ARRAY['production'::text, 'alsand'::text]))),
    CONSTRAINT item_classification_fact_value_check CHECK (((length(btrim(fact_value)) >= 1) AND (length(btrim(fact_value)) <= 1500)))
);

-- TABLE public.asset_designer_sheet_backup
CREATE TABLE public.asset_designer_sheet_backup (
    asset_id uuid NOT NULL,
    designer_name text,
    technical_designer_name text,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE public.asset_licensor_characters
CREATE TABLE public.asset_licensor_characters (
    asset_id uuid NOT NULL,
    character_id uuid NOT NULL,
    source text DEFAULT 'ai'::text NOT NULL,
    model text,
    tagged_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE public.bulk_operation_runs
CREATE TABLE public.bulk_operation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operation text NOT NULL,
    run_id text NOT NULL,
    status text NOT NULL,
    stage text,
    error text,
    reason_code text,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    source_status text,
    succeeded boolean GENERATED ALWAYS AS (((status = 'succeeded'::text) OR COALESCE(((status = 'completed'::text) AND ((progress -> 'failed'::text) = '0'::jsonb)), false))) STORED NOT NULL,
    CONSTRAINT bulk_operation_runs_ended_after_started CHECK (((ended_at IS NULL) OR (ended_at >= started_at))),
    CONSTRAINT bulk_operation_runs_failure_is_explained CHECK ((succeeded OR (status = ANY (ARRAY['completed'::text, 'interrupted'::text, 'stopped'::text, 'cancelled'::text])) OR (COALESCE(length(btrim(error)), 0) > 0) OR (reason_code IS NOT NULL))),
    CONSTRAINT bulk_operation_runs_operation_not_blank CHECK ((length(btrim(operation)) > 0)),
    CONSTRAINT bulk_operation_runs_progress_is_object CHECK ((jsonb_typeof(progress) = 'object'::text)),
    CONSTRAINT bulk_operation_runs_reason_code_not_blank CHECK (((reason_code IS NULL) OR (length(btrim(reason_code)) > 0))),
    CONSTRAINT bulk_operation_runs_run_id_not_blank CHECK ((length(btrim(run_id)) > 0)),
    CONSTRAINT bulk_operation_runs_source_status_not_blank CHECK (((source_status IS NULL) OR (length(btrim(source_status)) > 0))),
    CONSTRAINT bulk_operation_runs_stage_not_blank CHECK (((stage IS NULL) OR (length(btrim(stage)) > 0))),
    CONSTRAINT bulk_operation_runs_status_is_terminal_outcome CHECK ((status = ANY (ARRAY['completed'::text, 'interrupted'::text, 'stopped'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);

-- TABLE public.dam_search_keys
CREATE TABLE public.dam_search_keys (
    document_type text NOT NULL,
    entity_id uuid NOT NULL,
    asset_id uuid,
    style_group_id uuid,
    title text NOT NULL,
    path text NOT NULL,
    customer text,
    program text,
    title_key text NOT NULL,
    title_tsv tsvector NOT NULL,
    search_tsv tsvector NOT NULL
)
WITH (toast_tuple_target='128');
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN title SET STORAGE MAIN;
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN path SET STORAGE MAIN;
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN customer SET STORAGE MAIN;
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN program SET STORAGE MAIN;
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN title_key SET STORAGE MAIN;
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN title_tsv SET STORAGE MAIN;
ALTER TABLE ONLY public.dam_search_keys ALTER COLUMN search_tsv SET STORAGE EXTERNAL;

-- TABLE public.hts_rag_debate_runs
CREATE TABLE public.hts_rag_debate_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_determination_id uuid NOT NULL,
    session_id uuid NOT NULL,
    policy_version text NOT NULL,
    case_packet_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    turn_count integer DEFAULT 0 NOT NULL,
    evidence_expansion_count integer DEFAULT 0 NOT NULL,
    spark_initial_code text,
    luna_initial_code text,
    spark_final_code text,
    luna_final_code text,
    consensus_code text,
    stop_reason text,
    evidence_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    gate_result jsonb DEFAULT '{}'::jsonb NOT NULL,
    precedent_id uuid,
    error_code text,
    error_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT hts_rag_debate_runs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT hts_rag_debate_runs_case_packet_hash_check CHECK ((case_packet_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hts_rag_debate_runs_consensus_code_check CHECK (((consensus_code IS NULL) OR (consensus_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_evidence_expansion_count_check CHECK ((evidence_expansion_count >= 0)),
    CONSTRAINT hts_rag_debate_runs_evidence_result_check CHECK ((jsonb_typeof(evidence_result) = 'object'::text)),
    CONSTRAINT hts_rag_debate_runs_gate_result_check CHECK ((jsonb_typeof(gate_result) = 'object'::text)),
    CONSTRAINT hts_rag_debate_runs_luna_final_code_check CHECK (((luna_final_code IS NULL) OR (luna_final_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_luna_initial_code_check CHECK (((luna_initial_code IS NULL) OR (luna_initial_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT hts_rag_debate_runs_policy_version_check CHECK ((btrim(policy_version) <> ''::text)),
    CONSTRAINT hts_rag_debate_runs_promoted_chk CHECK (((status <> 'promoted'::text) OR ((consensus_code IS NOT NULL) AND (precedent_id IS NOT NULL) AND (gate_result @> '{"passed": true}'::jsonb)))),
    CONSTRAINT hts_rag_debate_runs_spark_final_code_check CHECK (((spark_final_code IS NULL) OR (spark_final_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_spark_initial_code_check CHECK (((spark_initial_code IS NULL) OR (spark_initial_code ~ '^[0-9]{10}$'::text))),
    CONSTRAINT hts_rag_debate_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'initial_opinions'::text, 'debating'::text, 'final_votes'::text, 'gating'::text, 'promoted'::text, 'not_proven'::text, 'failed'::text, 'dead_letter'::text]))),
    CONSTRAINT hts_rag_debate_runs_stop_reason_check CHECK (((stop_reason IS NULL) OR (stop_reason = ANY (ARRAY['converged'::text, 'needs_more_facts'::text, 'deadlocked'::text, 'degraded'::text, 'circuit_breaker'::text])))),
    CONSTRAINT hts_rag_debate_runs_terminal_completed_chk CHECK (((status <> ALL (ARRAY['promoted'::text, 'not_proven'::text, 'failed'::text, 'dead_letter'::text])) OR (completed_at IS NOT NULL))),
    CONSTRAINT hts_rag_debate_runs_turn_count_check CHECK ((turn_count >= 0))
);

-- TABLE public.known_designer_first_name
CREATE TABLE public.known_designer_first_name (
    first_name text NOT NULL,
    CONSTRAINT known_designer_first_name_first_name_check CHECK ((first_name = upper(first_name)))
);

-- TABLE public.pdf_text_samples_backup
CREATE TABLE public.pdf_text_samples_backup (
    asset_id uuid NOT NULL,
    filename text,
    relative_path text,
    extraction_method text,
    extracted_text text,
    page_count integer,
    char_count integer,
    extraction_error text,
    thumbnail_url text,
    sampled_at timestamp with time zone,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE public.sku_style_guide_links
CREATE TABLE public.sku_style_guide_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    file_name text,
    source_system text NOT NULL,
    source_style_guide_key text NOT NULL,
    style_guide_label text NOT NULL,
    match_method text NOT NULL,
    match_confidence real DEFAULT 1.0 NOT NULL,
    matched_asset_count integer DEFAULT 1 NOT NULL,
    core_style_guide_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sku_style_guide_links_asset_count_chk CHECK ((matched_asset_count >= 1)),
    CONSTRAINT sku_style_guide_links_confidence_chk CHECK (((match_confidence >= (0)::double precision) AND (match_confidence <= (1)::double precision))),
    CONSTRAINT sku_style_guide_links_file_name_chk CHECK (((file_name IS NULL) OR (btrim(file_name) <> ''::text))),
    CONSTRAINT sku_style_guide_links_label_chk CHECK ((btrim(style_guide_label) <> ''::text)),
    CONSTRAINT sku_style_guide_links_match_method_chk CHECK ((match_method = ANY (ARRAY['filename_exact'::text, 'filename_normalized'::text, 'sheet_declared'::text, 'sheet_label_match'::text]))),
    CONSTRAINT sku_style_guide_links_sku_chk CHECK ((btrim(sku) <> ''::text)),
    CONSTRAINT sku_style_guide_links_source_key_chk CHECK ((btrim(source_style_guide_key) <> ''::text)),
    CONSTRAINT sku_style_guide_links_source_system_chk CHECK ((btrim(source_system) <> ''::text))
);

-- TABLE public.sku_style_guide_resolver_progress
CREATE TABLE public.sku_style_guide_resolver_progress (
    sku text NOT NULL,
    input_hash text NOT NULL,
    portal_hash text NOT NULL,
    active_link_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    output_hash text NOT NULL,
    resolved_at timestamp with time zone NOT NULL
);

-- TABLE public.style_guide_file_crawl_seen
CREATE TABLE public.style_guide_file_crawl_seen (
    style_guide_file_id uuid NOT NULL,
    root_label text NOT NULL,
    crawl_run_id uuid,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE public.style_guide_file_preview_state
CREATE TABLE public.style_guide_file_preview_state (
    style_guide_file_id uuid NOT NULL,
    is_active boolean NOT NULL,
    has_preview boolean NOT NULL,
    has_error boolean NOT NULL
);

-- TABLE public.style_guide_search_documents
CREATE TABLE public.style_guide_search_documents (
    style_guide_file_id uuid NOT NULL,
    root_label text NOT NULL,
    licensor_name text,
    property_folder text,
    style_guide_folder text,
    style_guide_name text NOT NULL,
    directory_path text NOT NULL,
    relative_path text NOT NULL,
    filename text NOT NULL,
    file_extension text,
    tag_names text[] DEFAULT '{}'::text[] NOT NULL,
    size_bytes bigint,
    modified_at timestamp with time zone,
    thumbnail_url text,
    is_active boolean DEFAULT true NOT NULL,
    pdf_text_status text,
    pdf_text_length integer DEFAULT 0 NOT NULL,
    source_identity text NOT NULL,
    search_vector tsvector NOT NULL,
    document_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    embedding extensions.vector(768),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    embedding_error text,
    embedding_error_category text,
    embedding_next_retry_at timestamp with time zone,
    embedding_attempts integer DEFAULT 0 NOT NULL,
    embedding_max_attempts integer DEFAULT 5 NOT NULL,
    embedding_lease_token uuid,
    embedding_lease_owner text,
    embedding_lease_expires_at timestamp with time zone,
    content_sha256 text
)
WITH (autovacuum_vacuum_scale_factor='0', autovacuum_vacuum_threshold='2000', autovacuum_analyze_scale_factor='0.02');

-- MATERIALIZED VIEW public.style_guide_library_default_guides
CREATE MATERIALIZED VIEW public.style_guide_library_default_guides AS
 WITH render_rollup AS MATERIALIZED (
         SELECT q.style_guide_file_id,
            bool_or((q.status = ANY (ARRAY['pending'::public.queue_status, 'claimed'::public.queue_status, 'processing'::public.queue_status]))) AS has_open_work,
            bool_or(((q.status = 'failed'::public.queue_status) AND (q.attempts < 3))) AS has_recoverable_error,
            bool_or(((q.status = 'failed'::public.queue_status) AND (q.attempts >= 3))) AS has_terminal_error
           FROM public.style_guide_render_queue q
          GROUP BY q.style_guide_file_id
        ), live_files AS NOT MATERIALIZED (
         SELECT style_guide_files.id,
            true AS has_preview,
            false AS has_error
           FROM public.style_guide_files
          WHERE (style_guide_files.is_active AND (style_guide_files.thumbnail_url IS NOT NULL))
        UNION ALL
         SELECT style_guide_files.id,
            false,
            false
           FROM public.style_guide_files
          WHERE (style_guide_files.is_active AND (style_guide_files.thumbnail_url IS NULL) AND (style_guide_files.thumbnail_error IS NULL))
        UNION ALL
         SELECT style_guide_files.id,
            false,
            true
           FROM public.style_guide_files
          WHERE (style_guide_files.is_active AND (style_guide_files.thumbnail_url IS NULL) AND (style_guide_files.thumbnail_error IS NOT NULL))
        ), active_children AS MATERIALIZED (
         SELECT concat_ws(chr(31), COALESCE(((length(d_1.root_label) || ':'::text) || d_1.root_label), '-'::text), COALESCE(((length(d_1.licensor_name) || ':'::text) || d_1.licensor_name), '-'::text), COALESCE(((length(d_1.property_folder) || ':'::text) || d_1.property_folder), '-'::text), COALESCE(((length(d_1.style_guide_folder) || ':'::text) || d_1.style_guide_folder), '-'::text), COALESCE(((length(d_1.style_guide_name) || ':'::text) || d_1.style_guide_name), '-'::text)) AS group_id,
            d_1.style_guide_file_id,
            d_1.root_label,
            d_1.licensor_name,
            d_1.property_folder,
            d_1.style_guide_folder,
            d_1.style_guide_name,
            lower(d_1.file_extension) AS extension,
            d_1.tag_names,
            d_1.modified_at,
                CASE
                    WHEN f.has_preview THEN 'available'::text
                    ELSE 'missing'::text
                END AS preview_state,
                CASE
                    WHEN f.has_preview THEN 'none'::text
                    WHEN COALESCE(r.has_open_work, false) THEN 'waiting'::text
                    WHEN COALESCE(r.has_recoverable_error, false) THEN 'recoverable_error'::text
                    WHEN (f.has_error OR COALESCE(r.has_terminal_error, false)) THEN 'terminal_exception'::text
                    ELSE 'unclassified'::text
                END AS render_exception_state,
                CASE
                    WHEN (lower(COALESCE(d_1.file_extension, ''::text)) <> 'pdf'::text) THEN 'not_applicable'::text
                    WHEN ((d_1.pdf_text_status = 'extracted'::text) AND (d_1.pdf_text_length > 0)) THEN 'available'::text
                    ELSE 'unavailable'::text
                END AS pdf_content_state,
            (0)::real AS rank
           FROM ((public.style_guide_search_documents d_1
             JOIN live_files f ON ((f.id = d_1.style_guide_file_id)))
             LEFT JOIN render_rollup r ON ((r.style_guide_file_id = d_1.style_guide_file_id)))
          WHERE d_1.is_active
        ), entities AS MATERIALIZED (
         SELECT g.group_id,
            concat_ws(chr(31), g.root_label, COALESCE(g.licensor_name, ''::text), COALESCE(g.property_folder, ''::text), COALESCE(g.style_guide_folder, ''::text), g.style_guide_name) AS entity_key,
            g.modified_at,
            lower(g.style_guide_name) AS sort_name,
            g.root_label,
            g.licensor_name,
            g.property_folder,
            g.style_guide_folder,
            g.style_guide_name
           FROM ( SELECT d_1.group_id,
                    max(d_1.modified_at) AS modified_at,
                    min(d_1.root_label) AS root_label,
                    min(d_1.licensor_name) AS licensor_name,
                    min(d_1.property_folder) AS property_folder,
                    min(d_1.style_guide_folder) AS style_guide_folder,
                    min(d_1.style_guide_name) AS style_guide_name
                   FROM active_children d_1
                  GROUP BY d_1.group_id) g
        )
 SELECT e.group_id,
    e.entity_key,
    e.modified_at,
    e.sort_name,
    jsonb_build_object('result_mode', 'guides', 'guide_key', e.entity_key, 'root_label', e.root_label, 'licensor_name', e.licensor_name, 'property_folder', e.property_folder, 'style_guide_folder', e.style_guide_folder, 'style_guide_name', e.style_guide_name, 'matched_file_count', count(DISTINCT d.style_guide_file_id), 'file_extensions', to_jsonb(COALESCE(array_agg(DISTINCT d.extension) FILTER (WHERE (d.extension IS NOT NULL)), '{}'::text[])), 'tag_names', to_jsonb(COALESCE(array_agg(DISTINCT tag.value ORDER BY tag.value) FILTER (WHERE (tag.value IS NOT NULL)), '{}'::text[])), 'modified_at', max(d.modified_at), 'thumbnail_url', (array_agg(live_payload.thumbnail_url ORDER BY (live_payload.thumbnail_url IS NULL), d.modified_at DESC NULLS LAST, d.style_guide_file_id) FILTER (WHERE (live_payload.thumbnail_url IS NOT NULL)))[1], 'preview_states', to_jsonb(array_agg(DISTINCT d.preview_state ORDER BY d.preview_state)), 'render_exception_states', to_jsonb(array_agg(DISTINCT d.render_exception_state ORDER BY d.render_exception_state)), 'pdf_content_states', to_jsonb(array_agg(DISTINCT d.pdf_content_state ORDER BY d.pdf_content_state)), 'rank', max(d.rank)) AS result
   FROM (((entities e
     JOIN active_children d ON ((d.group_id = e.group_id)))
     JOIN public.style_guide_files live_payload ON ((live_payload.id = d.style_guide_file_id)))
     LEFT JOIN LATERAL unnest(d.tag_names) tag(value) ON (true))
  GROUP BY e.group_id, e.entity_key, e.modified_at, e.sort_name, e.root_label, e.licensor_name, e.property_folder, e.style_guide_folder, e.style_guide_name
  WITH NO DATA;

-- MATERIALIZED VIEW public.style_guide_library_default_summary
CREATE MATERIALIZED VIEW public.style_guide_library_default_summary AS
 WITH render_rollup AS MATERIALIZED (
         SELECT q.style_guide_file_id,
            bool_or((q.status = ANY (ARRAY['pending'::public.queue_status, 'claimed'::public.queue_status, 'processing'::public.queue_status]))) AS has_open_work,
            bool_or(((q.status = 'failed'::public.queue_status) AND (q.attempts < 3))) AS has_recoverable_error,
            bool_or(((q.status = 'failed'::public.queue_status) AND (q.attempts >= 3))) AS has_terminal_error
           FROM public.style_guide_render_queue q
          GROUP BY q.style_guide_file_id
        ), live_files AS NOT MATERIALIZED (
         SELECT style_guide_files.id,
            true AS has_preview,
            false AS has_error
           FROM public.style_guide_files
          WHERE (style_guide_files.is_active AND (style_guide_files.thumbnail_url IS NOT NULL))
        UNION ALL
         SELECT style_guide_files.id,
            false,
            false
           FROM public.style_guide_files
          WHERE (style_guide_files.is_active AND (style_guide_files.thumbnail_url IS NULL) AND (style_guide_files.thumbnail_error IS NULL))
        UNION ALL
         SELECT style_guide_files.id,
            false,
            true
           FROM public.style_guide_files
          WHERE (style_guide_files.is_active AND (style_guide_files.thumbnail_url IS NULL) AND (style_guide_files.thumbnail_error IS NOT NULL))
        ), active_children AS MATERIALIZED (
         SELECT concat_ws(chr(31), COALESCE(((length(d.root_label) || ':'::text) || d.root_label), '-'::text), COALESCE(((length(d.licensor_name) || ':'::text) || d.licensor_name), '-'::text), COALESCE(((length(d.property_folder) || ':'::text) || d.property_folder), '-'::text), COALESCE(((length(d.style_guide_folder) || ':'::text) || d.style_guide_folder), '-'::text), COALESCE(((length(d.style_guide_name) || ':'::text) || d.style_guide_name), '-'::text)) AS group_id,
            d.licensor_name,
            d.property_folder,
            d.style_guide_name,
            lower(d.file_extension) AS extension,
            d.tag_names,
                CASE
                    WHEN f.has_preview THEN 'available'::text
                    ELSE 'missing'::text
                END AS preview_state,
                CASE
                    WHEN f.has_preview THEN 'none'::text
                    WHEN COALESCE(r.has_open_work, false) THEN 'waiting'::text
                    WHEN COALESCE(r.has_recoverable_error, false) THEN 'recoverable_error'::text
                    WHEN (f.has_error OR COALESCE(r.has_terminal_error, false)) THEN 'terminal_exception'::text
                    ELSE 'unclassified'::text
                END AS render_exception_state,
                CASE
                    WHEN (lower(COALESCE(d.file_extension, ''::text)) <> 'pdf'::text) THEN 'not_applicable'::text
                    WHEN ((d.pdf_text_status = 'extracted'::text) AND (d.pdf_text_length > 0)) THEN 'available'::text
                    ELSE 'unavailable'::text
                END AS pdf_content_state
           FROM ((public.style_guide_search_documents d
             JOIN live_files f ON ((f.id = d.style_guide_file_id)))
             LEFT JOIN render_rollup r ON ((r.style_guide_file_id = d.style_guide_file_id)))
          WHERE d.is_active
        ), entities AS MATERIALIZED (
         SELECT d.group_id,
            min(d.licensor_name) AS licensor_name,
            min(d.property_folder) AS property_folder,
            min(d.style_guide_name) AS style_guide_name
           FROM active_children d
          GROUP BY d.group_id
        ), guide_facets AS MATERIALIZED (
         SELECT counts.category,
            jsonb_agg(jsonb_build_object('value', counts.value, 'count', counts.count) ORDER BY counts.count DESC, counts.value) AS facet_values
           FROM ( SELECT 'extensions'::text AS category,
                    u.value,
                    count(*) AS count
                   FROM ( SELECT DISTINCT d.group_id,
                            d.extension AS value
                           FROM active_children d
                          WHERE (d.extension IS NOT NULL)) u
                  GROUP BY u.value
                UNION ALL
                 SELECT 'tags'::text AS text,
                    u.value,
                    count(*) AS count
                   FROM ( SELECT DISTINCT d.group_id,
                            t.value
                           FROM (active_children d
                             CROSS JOIN LATERAL unnest(d.tag_names) t(value))
                          WHERE (t.value IS NOT NULL)) u
                  GROUP BY u.value
                UNION ALL
                 SELECT 'preview_states'::text AS text,
                    u.value,
                    count(*) AS count
                   FROM ( SELECT DISTINCT d.group_id,
                            d.preview_state AS value
                           FROM active_children d) u
                  GROUP BY u.value
                UNION ALL
                 SELECT 'render_exception_states'::text AS text,
                    u.value,
                    count(*) AS count
                   FROM ( SELECT DISTINCT d.group_id,
                            d.render_exception_state AS value
                           FROM active_children d) u
                  GROUP BY u.value
                UNION ALL
                 SELECT 'pdf_content_states'::text AS text,
                    u.value,
                    count(*) AS count
                   FROM ( SELECT DISTINCT d.group_id,
                            d.pdf_content_state AS value
                           FROM active_children d) u
                  GROUP BY u.value) counts
          GROUP BY counts.category
        )
 SELECT 'files'::text AS result_mode,
    ( SELECT count(*) AS count
           FROM active_children) AS total,
    jsonb_build_object('licensors', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.licensor_name AS value,
                    count(*) AS count
                   FROM active_children c
                  WHERE (c.licensor_name IS NOT NULL)
                  GROUP BY c.licensor_name) facet), '[]'::jsonb), 'properties', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.property_folder AS value,
                    count(*) AS count
                   FROM active_children c
                  WHERE (c.property_folder IS NOT NULL)
                  GROUP BY c.property_folder) facet), '[]'::jsonb), 'style_guides', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.style_guide_name AS value,
                    count(*) AS count
                   FROM active_children c
                  GROUP BY c.style_guide_name) facet), '[]'::jsonb), 'extensions', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.extension AS value,
                    count(*) AS count
                   FROM active_children c
                  WHERE (c.extension IS NOT NULL)
                  GROUP BY c.extension) facet), '[]'::jsonb), 'tags', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT t.value,
                    count(*) AS count
                   FROM (active_children c
                     CROSS JOIN LATERAL unnest(c.tag_names) t(value))
                  GROUP BY t.value) facet), '[]'::jsonb), 'preview_states', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.preview_state AS value,
                    count(*) AS count
                   FROM active_children c
                  GROUP BY c.preview_state) facet), '[]'::jsonb), 'render_exception_states', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.render_exception_state AS value,
                    count(*) AS count
                   FROM active_children c
                  GROUP BY c.render_exception_state) facet), '[]'::jsonb), 'pdf_content_states', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT c.pdf_content_state AS value,
                    count(*) AS count
                   FROM active_children c
                  GROUP BY c.pdf_content_state) facet), '[]'::jsonb)) AS facets
UNION ALL
 SELECT 'guides'::text AS result_mode,
    ( SELECT count(*) AS count
           FROM entities) AS total,
    jsonb_build_object('licensors', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT entities.licensor_name AS value,
                    count(*) AS count
                   FROM entities
                  WHERE (entities.licensor_name IS NOT NULL)
                  GROUP BY entities.licensor_name) facet), '[]'::jsonb), 'properties', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT entities.property_folder AS value,
                    count(*) AS count
                   FROM entities
                  WHERE (entities.property_folder IS NOT NULL)
                  GROUP BY entities.property_folder) facet), '[]'::jsonb), 'style_guides', COALESCE(( SELECT jsonb_agg(jsonb_build_object('value', facet.value, 'count', facet.count) ORDER BY facet.count DESC, facet.value) AS jsonb_agg
           FROM ( SELECT entities.style_guide_name AS value,
                    count(*) AS count
                   FROM entities
                  GROUP BY entities.style_guide_name) facet), '[]'::jsonb), 'extensions', COALESCE(( SELECT guide_facets.facet_values
           FROM guide_facets
          WHERE (guide_facets.category = 'extensions'::text)), '[]'::jsonb), 'tags', COALESCE(( SELECT guide_facets.facet_values
           FROM guide_facets
          WHERE (guide_facets.category = 'tags'::text)), '[]'::jsonb), 'preview_states', COALESCE(( SELECT guide_facets.facet_values
           FROM guide_facets
          WHERE (guide_facets.category = 'preview_states'::text)), '[]'::jsonb), 'render_exception_states', COALESCE(( SELECT guide_facets.facet_values
           FROM guide_facets
          WHERE (guide_facets.category = 'render_exception_states'::text)), '[]'::jsonb), 'pdf_content_states', COALESCE(( SELECT guide_facets.facet_values
           FROM guide_facets
          WHERE (guide_facets.category = 'pdf_content_states'::text)), '[]'::jsonb)) AS facets
  WITH NO DATA;

-- TABLE public.style_guide_pdf_text
CREATE TABLE public.style_guide_pdf_text (
    style_guide_file_id uuid NOT NULL,
    content_identity text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    claimed_by text,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    page_count integer,
    extracted_text text,
    text_length integer GENERATED ALWAYS AS (COALESCE(length(extracted_text), 0)) STORED,
    error_message text,
    extracted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    extraction_method character varying(100),
    terminal_reason character varying(2000),
    CONSTRAINT style_guide_pdf_text_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'extracted'::text, 'failed'::text, 'skipped'::text])))
);

-- TABLE public.style_guide_search_embedding_jobs
CREATE TABLE public.style_guide_search_embedding_jobs (
    style_guide_file_id uuid NOT NULL,
    content_sha256 text NOT NULL,
    lease_token uuid,
    claimed_by text,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    error text,
    error_category text,
    next_retry_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT style_guide_search_embedding_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT style_guide_search_embedding_jobs_error_category_check CHECK ((error_category = ANY (ARRAY['transient'::text, 'permanent'::text]))),
    CONSTRAINT style_guide_search_embedding_jobs_max_attempts_check CHECK ((max_attempts >= 1))
)
WITH (fillfactor='70');

-- TABLE public.style_guide_search_sync_queue
CREATE TABLE public.style_guide_search_sync_queue (
    style_guide_file_id uuid NOT NULL,
    queued_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

-- CONSTRAINT archive.asset_characters_wrong_family_20261102 asset_characters_wrong_family_20261102_pkey
ALTER TABLE ONLY archive.asset_characters_wrong_family_20261102
    ADD CONSTRAINT asset_characters_wrong_family_20261102_pkey PRIMARY KEY (asset_id, character_id);

-- CONSTRAINT archive.asset_characters_wrong_licensor_20261102 asset_characters_wrong_licensor_20261102_pkey
ALTER TABLE ONLY archive.asset_characters_wrong_licensor_20261102
    ADD CONSTRAINT asset_characters_wrong_licensor_20261102_pkey PRIMARY KEY (asset_id, character_id);

-- CONSTRAINT archive.asset_tags_wrong_spiderman_20261102 asset_tags_wrong_spiderman_20261102_pkey
ALTER TABLE ONLY archive.asset_tags_wrong_spiderman_20261102
    ADD CONSTRAINT asset_tags_wrong_spiderman_20261102_pkey PRIMARY KEY (id);

-- CONSTRAINT archive.asset_tags_wrong_unlicensed_20261102 asset_tags_wrong_unlicensed_20261102_pkey
ALTER TABLE ONLY archive.asset_tags_wrong_unlicensed_20261102
    ADD CONSTRAINT asset_tags_wrong_unlicensed_20261102_pkey PRIMARY KEY (id);

-- CONSTRAINT archive.character_child_grogu_links_20261104 character_child_grogu_links_20261104_pkey
ALTER TABLE ONLY archive.character_child_grogu_links_20261104
    ADD CONSTRAINT character_child_grogu_links_20261104_pkey PRIMARY KEY (asset_id);

-- CONSTRAINT archive.character_link_licensing_audit_20261102 character_link_licensing_audit_20261102_pkey
ALTER TABLE ONLY archive.character_link_licensing_audit_20261102
    ADD CONSTRAINT character_link_licensing_audit_20261102_pkey PRIMARY KEY (asset_id, character_id);

-- CONSTRAINT archive.dc_hp_wb_repoint_20261101 dc_hp_wb_repoint_20261101_pkey
ALTER TABLE ONLY archive.dc_hp_wb_repoint_20261101
    ADD CONSTRAINT dc_hp_wb_repoint_20261101_pkey PRIMARY KEY (source_table, row_key);

-- CONSTRAINT archive.erp_items_current erp_items_current_external_id_key
ALTER TABLE ONLY archive.erp_items_current
    ADD CONSTRAINT erp_items_current_external_id_key UNIQUE (external_id);

-- CONSTRAINT archive.erp_items_current erp_items_current_pkey
ALTER TABLE ONLY archive.erp_items_current
    ADD CONSTRAINT erp_items_current_pkey PRIMARY KEY (id);

-- CONSTRAINT archive.erp_items_raw erp_items_raw_pkey
ALTER TABLE ONLY archive.erp_items_raw
    ADD CONSTRAINT erp_items_raw_pkey PRIMARY KEY (id);

-- CONSTRAINT archive.popdam_dc_hp_wb_repoint_20261101 popdam_dc_hp_wb_repoint_20261101_pkey
ALTER TABLE ONLY archive.popdam_dc_hp_wb_repoint_20261101
    ADD CONSTRAINT popdam_dc_hp_wb_repoint_20261101_pkey PRIMARY KEY (source_table, row_id);

-- CONSTRAINT archive.spiderman_text_audit_20261102 spiderman_text_audit_20261102_pkey
ALTER TABLE ONLY archive.spiderman_text_audit_20261102
    ADD CONSTRAINT spiderman_text_audit_20261102_pkey PRIMARY KEY (asset_id);

-- CONSTRAINT dam.asset_character_source_edge asset_character_source_edge_pkey
ALTER TABLE ONLY dam.asset_character_source_edge
    ADD CONSTRAINT asset_character_source_edge_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.asset_franchise asset_franchise_pkey
ALTER TABLE ONLY dam.asset_franchise
    ADD CONSTRAINT asset_franchise_pkey PRIMARY KEY (asset_id, franchise_id);

-- CONSTRAINT dam.asset_franchise_source_edge asset_franchise_source_edge_pkey
ALTER TABLE ONLY dam.asset_franchise_source_edge
    ADD CONSTRAINT asset_franchise_source_edge_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.asset_property asset_property_pkey
ALTER TABLE ONLY dam.asset_property
    ADD CONSTRAINT asset_property_pkey PRIMARY KEY (asset_id, property_id);

-- CONSTRAINT dam.asset_property_source_edge asset_property_source_edge_pkey
ALTER TABLE ONLY dam.asset_property_source_edge
    ADD CONSTRAINT asset_property_source_edge_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.asset_style_guide asset_style_guide_pkey
ALTER TABLE ONLY dam.asset_style_guide
    ADD CONSTRAINT asset_style_guide_pkey PRIMARY KEY (asset_id, style_guide_id);

-- CONSTRAINT dam.asset_style_guide_source_edge asset_style_guide_source_edge_pkey
ALTER TABLE ONLY dam.asset_style_guide_source_edge
    ADD CONSTRAINT asset_style_guide_source_edge_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.dam_asset_image_vectors dam_asset_image_vectors_pkey
ALTER TABLE ONLY dam.dam_asset_image_vectors
    ADD CONSTRAINT dam_asset_image_vectors_pkey PRIMARY KEY (asset_id);

-- CHECK CONSTRAINT dam.asset dam_asset_missing_after_first_seen
ALTER TABLE dam.asset
    ADD CONSTRAINT dam_asset_missing_after_first_seen CHECK (((missing_since IS NULL) OR (first_seen_at IS NULL) OR (missing_since >= first_seen_at))) NOT VALID;

-- CHECK CONSTRAINT dam.asset dam_asset_seen_order
ALTER TABLE dam.asset
    ADD CONSTRAINT dam_asset_seen_order CHECK (((first_seen_at IS NULL) OR (last_seen_at IS NULL) OR (last_seen_at >= first_seen_at))) NOT VALID;

-- CONSTRAINT dam.folder_rename_log folder_rename_log_pkey
ALTER TABLE ONLY dam.folder_rename_log
    ADD CONSTRAINT folder_rename_log_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.folder_rename_log folder_rename_log_unique
ALTER TABLE ONLY dam.folder_rename_log
    ADD CONSTRAINT folder_rename_log_unique UNIQUE (share, old_path, renamed_at);

-- CONSTRAINT dam.image_embed_jobs image_embed_jobs_pkey
ALTER TABLE ONLY dam.image_embed_jobs
    ADD CONSTRAINT image_embed_jobs_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.image_embed_worker_heartbeat image_embed_worker_heartbeat_pkey
ALTER TABLE ONLY dam.image_embed_worker_heartbeat
    ADD CONSTRAINT image_embed_worker_heartbeat_pkey PRIMARY KEY (worker_id);

-- CONSTRAINT dam.order_buy_sheet_import order_buy_sheet_import_pkey
ALTER TABLE ONLY dam.order_buy_sheet_import
    ADD CONSTRAINT order_buy_sheet_import_pkey PRIMARY KEY (id);

-- CONSTRAINT dam.order_tracking_ext order_tracking_ext_pkey
ALTER TABLE ONLY dam.order_tracking_ext
    ADD CONSTRAINT order_tracking_ext_pkey PRIMARY KEY (order_id);

-- CONSTRAINT dam.orderlist_customer_settings orderlist_customer_settings_pkey
ALTER TABLE ONLY dam.orderlist_customer_settings
    ADD CONSTRAINT orderlist_customer_settings_pkey PRIMARY KEY (customer_normalized);

-- CONSTRAINT dam.orderlist_sample_depth orderlist_sample_depth_pkey
ALTER TABLE ONLY dam.orderlist_sample_depth
    ADD CONSTRAINT orderlist_sample_depth_pkey PRIMARY KEY (sku_normalized, customer_normalized);

-- CONSTRAINT dam.search_group_vectors search_group_vectors_pkey
ALTER TABLE ONLY dam.search_group_vectors
    ADD CONSTRAINT search_group_vectors_pkey PRIMARY KEY (entity_id);

-- CONSTRAINT hts_rag.hts_rag_article_types hts_rag_article_types_name_key
ALTER TABLE ONLY hts_rag.hts_rag_article_types
    ADD CONSTRAINT hts_rag_article_types_name_key UNIQUE (name);

-- CONSTRAINT hts_rag.hts_rag_article_types hts_rag_article_types_pkey
ALTER TABLE ONLY hts_rag.hts_rag_article_types
    ADD CONSTRAINT hts_rag_article_types_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_attribute_keys hts_rag_attribute_keys_pkey
ALTER TABLE ONLY hts_rag.hts_rag_attribute_keys
    ADD CONSTRAINT hts_rag_attribute_keys_pkey PRIMARY KEY (key);

-- CONSTRAINT hts_rag.hts_rag_authorities hts_rag_authorities_pkey
ALTER TABLE ONLY hts_rag.hts_rag_authorities
    ADD CONSTRAINT hts_rag_authorities_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_authorities hts_rag_authorities_ref_norm_key
ALTER TABLE ONLY hts_rag.hts_rag_authorities
    ADD CONSTRAINT hts_rag_authorities_ref_norm_key UNIQUE (ref_norm);

-- CONSTRAINT hts_rag.hts_rag_broker_opinions hts_rag_broker_opinions_pkey
ALTER TABLE ONLY hts_rag.hts_rag_broker_opinions
    ADD CONSTRAINT hts_rag_broker_opinions_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_classification_jobs hts_rag_classification_jobs_determination_turn_uq
ALTER TABLE ONLY hts_rag.hts_rag_classification_jobs
    ADD CONSTRAINT hts_rag_classification_jobs_determination_turn_uq UNIQUE (determination_id, turn_index);

-- CONSTRAINT hts_rag.hts_rag_classification_jobs hts_rag_classification_jobs_pkey
ALTER TABLE ONLY hts_rag.hts_rag_classification_jobs
    ADD CONSTRAINT hts_rag_classification_jobs_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_classification_tests hts_rag_classification_tests_name_key
ALTER TABLE ONLY hts_rag.hts_rag_classification_tests
    ADD CONSTRAINT hts_rag_classification_tests_name_key UNIQUE (canonical_name);

-- CONSTRAINT hts_rag.hts_rag_classification_tests hts_rag_classification_tests_pkey
ALTER TABLE ONLY hts_rag.hts_rag_classification_tests
    ADD CONSTRAINT hts_rag_classification_tests_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_counterfactuals hts_rag_counterfactuals_pkey
ALTER TABLE ONLY hts_rag.hts_rag_counterfactuals
    ADD CONSTRAINT hts_rag_counterfactuals_pkey PRIMARY KEY (product_id, attribute_key, then_code_prefix, extraction_id, sentence_seq);

-- CONSTRAINT hts_rag.hts_rag_debate_runs hts_rag_debate_runs_determination_policy_uq
ALTER TABLE ONLY hts_rag.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_determination_policy_uq UNIQUE (source_determination_id, policy_version);

-- CONSTRAINT hts_rag.hts_rag_debate_runs hts_rag_debate_runs_pkey
ALTER TABLE ONLY hts_rag.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_decision_authorities hts_rag_decision_authorities_pkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_authorities
    ADD CONSTRAINT hts_rag_decision_authorities_pkey PRIMARY KEY (decision_id, authority_id, role);

-- CONSTRAINT hts_rag.hts_rag_decision_facts hts_rag_decision_facts_pkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_facts
    ADD CONSTRAINT hts_rag_decision_facts_pkey PRIMARY KEY (decision_test_id, attribute_key, sentence_seq);

-- CONSTRAINT hts_rag.hts_rag_decision_tests hts_rag_decision_tests_pkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_tests
    ADD CONSTRAINT hts_rag_decision_tests_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_decision_tests hts_rag_decision_tests_uq
ALTER TABLE ONLY hts_rag.hts_rag_decision_tests
    ADD CONSTRAINT hts_rag_decision_tests_uq UNIQUE (decision_id, test_id, extraction_id);

-- CONSTRAINT hts_rag.hts_rag_determinations hts_rag_determinations_completion_key_uq
ALTER TABLE ONLY hts_rag.hts_rag_determinations
    ADD CONSTRAINT hts_rag_determinations_completion_key_uq UNIQUE (completion_key);

-- CONSTRAINT hts_rag.hts_rag_determinations hts_rag_determinations_pkey
ALTER TABLE ONLY hts_rag.hts_rag_determinations
    ADD CONSTRAINT hts_rag_determinations_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_extraction_jobs hts_rag_extraction_jobs_pkey
ALTER TABLE ONLY hts_rag.hts_rag_extraction_jobs
    ADD CONSTRAINT hts_rag_extraction_jobs_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_extractions hts_rag_extractions_pkey
ALTER TABLE ONLY hts_rag.hts_rag_extractions
    ADD CONSTRAINT hts_rag_extractions_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_extractions hts_rag_extractions_version_key
ALTER TABLE ONLY hts_rag.hts_rag_extractions
    ADD CONSTRAINT hts_rag_extractions_version_key UNIQUE (ruling_number, pass, extract_version);

-- CONSTRAINT hts_rag.hts_rag_heading_decisions hts_rag_heading_decisions_pkey
ALTER TABLE ONLY hts_rag.hts_rag_heading_decisions
    ADD CONSTRAINT hts_rag_heading_decisions_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_hts_codes hts_rag_hts_codes_code_revision_key
ALTER TABLE ONLY hts_rag.hts_rag_hts_codes
    ADD CONSTRAINT hts_rag_hts_codes_code_revision_key UNIQUE (code, revision);

-- CONSTRAINT hts_rag.hts_rag_hts_codes hts_rag_hts_codes_pkey
ALTER TABLE ONLY hts_rag.hts_rag_hts_codes
    ADD CONSTRAINT hts_rag_hts_codes_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_hts_renumbering hts_rag_hts_renumbering_pkey
ALTER TABLE ONLY hts_rag.hts_rag_hts_renumbering
    ADD CONSTRAINT hts_rag_hts_renumbering_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_hts_renumbering hts_rag_hts_renumbering_uq
ALTER TABLE ONLY hts_rag.hts_rag_hts_renumbering
    ADD CONSTRAINT hts_rag_hts_renumbering_uq UNIQUE NULLS NOT DISTINCT (old_code, new_code, revision);

-- CONSTRAINT hts_rag.hts_rag_materials hts_rag_materials_name_key
ALTER TABLE ONLY hts_rag.hts_rag_materials
    ADD CONSTRAINT hts_rag_materials_name_key UNIQUE (name);

-- CONSTRAINT hts_rag.hts_rag_materials hts_rag_materials_pkey
ALTER TABLE ONLY hts_rag.hts_rag_materials
    ADD CONSTRAINT hts_rag_materials_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_precedent_rulings hts_rag_precedent_rulings_pkey
ALTER TABLE ONLY hts_rag.hts_rag_precedent_rulings
    ADD CONSTRAINT hts_rag_precedent_rulings_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_precedent_rulings hts_rag_precedent_rulings_precedent_id_ruling_id_key
ALTER TABLE ONLY hts_rag.hts_rag_precedent_rulings
    ADD CONSTRAINT hts_rag_precedent_rulings_precedent_id_ruling_id_key UNIQUE (precedent_id, ruling_id);

-- CONSTRAINT hts_rag.hts_rag_precedents hts_rag_precedents_pkey
ALTER TABLE ONLY hts_rag.hts_rag_precedents
    ADD CONSTRAINT hts_rag_precedents_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_product_attributes hts_rag_product_attributes_pkey
ALTER TABLE ONLY hts_rag.hts_rag_product_attributes
    ADD CONSTRAINT hts_rag_product_attributes_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_product_components hts_rag_product_components_pkey
ALTER TABLE ONLY hts_rag.hts_rag_product_components
    ADD CONSTRAINT hts_rag_product_components_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_product_examples hts_rag_product_examples_fixture_version_fixture_hash_input_key
ALTER TABLE ONLY hts_rag.hts_rag_product_examples
    ADD CONSTRAINT hts_rag_product_examples_fixture_version_fixture_hash_input_key UNIQUE (fixture_version, fixture_hash, input_hash);

-- CONSTRAINT hts_rag.hts_rag_product_examples hts_rag_product_examples_pkey
ALTER TABLE ONLY hts_rag.hts_rag_product_examples
    ADD CONSTRAINT hts_rag_product_examples_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_product_family_allowlist hts_rag_product_family_allowlist_pkey
ALTER TABLE ONLY hts_rag.hts_rag_product_family_allowlist
    ADD CONSTRAINT hts_rag_product_family_allowlist_pkey PRIMARY KEY (product_family);

-- CONSTRAINT hts_rag.hts_rag_provider_responses hts_rag_provider_responses_pkey
ALTER TABLE ONLY hts_rag.hts_rag_provider_responses
    ADD CONSTRAINT hts_rag_provider_responses_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_provider_responses hts_rag_provider_responses_turn_uq
ALTER TABLE ONLY hts_rag.hts_rag_provider_responses
    ADD CONSTRAINT hts_rag_provider_responses_turn_uq UNIQUE (session_id, turn_role, turn_index);

-- CONSTRAINT hts_rag.hts_rag_review_events hts_rag_review_events_pkey
ALTER TABLE ONLY hts_rag.hts_rag_review_events
    ADD CONSTRAINT hts_rag_review_events_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_ruling_codes hts_rag_ruling_codes_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_codes
    ADD CONSTRAINT hts_rag_ruling_codes_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_ruling_codes hts_rag_ruling_codes_uq
ALTER TABLE ONLY hts_rag.hts_rag_ruling_codes
    ADD CONSTRAINT hts_rag_ruling_codes_uq UNIQUE (ruling_number, code, role, extract_version);

-- CONSTRAINT hts_rag.hts_rag_ruling_current_codes hts_rag_ruling_current_codes_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_current_codes
    ADD CONSTRAINT hts_rag_ruling_current_codes_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_ruling_current_codes hts_rag_ruling_current_codes_uq
ALTER TABLE ONLY hts_rag.hts_rag_ruling_current_codes
    ADD CONSTRAINT hts_rag_ruling_current_codes_uq UNIQUE (ruling_number, held_code, source_environment);

-- CONSTRAINT hts_rag.hts_rag_ruling_ingest_jobs hts_rag_ruling_ingest_jobs_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_ingest_jobs
    ADD CONSTRAINT hts_rag_ruling_ingest_jobs_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_ruling_links hts_rag_ruling_links_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_links
    ADD CONSTRAINT hts_rag_ruling_links_pkey PRIMARY KEY (from_ruling, to_ruling, kind);

-- CONSTRAINT hts_rag.hts_rag_ruling_passb hts_rag_ruling_passb_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_passb
    ADD CONSTRAINT hts_rag_ruling_passb_pkey PRIMARY KEY (ruling_number, extract_version, source_environment);

-- CONSTRAINT hts_rag.hts_rag_ruling_products hts_rag_ruling_products_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_products
    ADD CONSTRAINT hts_rag_ruling_products_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_ruling_scope_labels hts_rag_ruling_scope_labels_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_scope_labels
    ADD CONSTRAINT hts_rag_ruling_scope_labels_pkey PRIMARY KEY (ruling_number, label_version, source_environment);

-- CONSTRAINT hts_rag.hts_rag_ruling_sentences hts_rag_ruling_sentences_pkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_sentences
    ADD CONSTRAINT hts_rag_ruling_sentences_pkey PRIMARY KEY (ruling_number, seq);

-- CONSTRAINT hts_rag.hts_rag_rulings hts_rag_rulings_pkey
ALTER TABLE ONLY hts_rag.hts_rag_rulings
    ADD CONSTRAINT hts_rag_rulings_pkey PRIMARY KEY (id);

-- CONSTRAINT hts_rag.hts_rag_rulings hts_rag_rulings_ruling_number_key
ALTER TABLE ONLY hts_rag.hts_rag_rulings
    ADD CONSTRAINT hts_rag_rulings_ruling_number_key UNIQUE (ruling_number);

-- CONSTRAINT hts_rag.hts_rag_test_aliases hts_rag_test_aliases_pkey
ALTER TABLE ONLY hts_rag.hts_rag_test_aliases
    ADD CONSTRAINT hts_rag_test_aliases_pkey PRIMARY KEY (alias);

-- CONSTRAINT hts_rag.item_classification_fact item_classification_fact_pkey
ALTER TABLE ONLY hts_rag.item_classification_fact
    ADD CONSTRAINT item_classification_fact_pkey PRIMARY KEY (id);

-- CONSTRAINT public.asset_designer_sheet_backup asset_designer_sheet_backup_pkey
ALTER TABLE ONLY public.asset_designer_sheet_backup
    ADD CONSTRAINT asset_designer_sheet_backup_pkey PRIMARY KEY (asset_id);

-- CONSTRAINT public.asset_licensor_characters asset_licensor_characters_pkey
ALTER TABLE ONLY public.asset_licensor_characters
    ADD CONSTRAINT asset_licensor_characters_pkey PRIMARY KEY (asset_id, character_id);

-- CONSTRAINT public.bulk_operation_runs bulk_operation_runs_pkey
ALTER TABLE ONLY public.bulk_operation_runs
    ADD CONSTRAINT bulk_operation_runs_pkey PRIMARY KEY (id);

-- CONSTRAINT public.dam_search_keys dam_search_keys_pkey
ALTER TABLE ONLY public.dam_search_keys
    ADD CONSTRAINT dam_search_keys_pkey PRIMARY KEY (document_type, entity_id);

-- CONSTRAINT public.hts_rag_debate_runs hts_rag_debate_runs_determination_policy_uq
ALTER TABLE ONLY public.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_determination_policy_uq UNIQUE (source_determination_id, policy_version);

-- CONSTRAINT public.hts_rag_debate_runs hts_rag_debate_runs_pkey
ALTER TABLE ONLY public.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_pkey PRIMARY KEY (id);

-- CONSTRAINT public.known_designer_first_name known_designer_first_name_pkey
ALTER TABLE ONLY public.known_designer_first_name
    ADD CONSTRAINT known_designer_first_name_pkey PRIMARY KEY (first_name);

-- CONSTRAINT public.pdf_text_samples_backup pdf_text_samples_backup_pkey
ALTER TABLE ONLY public.pdf_text_samples_backup
    ADD CONSTRAINT pdf_text_samples_backup_pkey PRIMARY KEY (asset_id);

-- CONSTRAINT public.popdam_item_state popdam_item_state_pkey
ALTER TABLE ONLY public.popdam_item_state
    ADD CONSTRAINT popdam_item_state_pkey PRIMARY KEY (item_id);

-- CONSTRAINT public.popdam_item_state popdam_item_state_source_identity_key
ALTER TABLE ONLY public.popdam_item_state
    ADD CONSTRAINT popdam_item_state_source_identity_key UNIQUE (source_system, division_code, source_id);

-- CONSTRAINT public.sku_style_guide_links sku_style_guide_links_identity_key
ALTER TABLE ONLY public.sku_style_guide_links
    ADD CONSTRAINT sku_style_guide_links_identity_key UNIQUE NULLS NOT DISTINCT (sku, source_system, source_style_guide_key, file_name);

-- CONSTRAINT public.sku_style_guide_links sku_style_guide_links_pkey
ALTER TABLE ONLY public.sku_style_guide_links
    ADD CONSTRAINT sku_style_guide_links_pkey PRIMARY KEY (id);

-- CONSTRAINT public.sku_style_guide_resolver_progress sku_style_guide_resolver_progress_pkey
ALTER TABLE ONLY public.sku_style_guide_resolver_progress
    ADD CONSTRAINT sku_style_guide_resolver_progress_pkey PRIMARY KEY (sku);

-- CONSTRAINT public.style_guide_file_crawl_seen style_guide_file_crawl_seen_pkey
ALTER TABLE ONLY public.style_guide_file_crawl_seen
    ADD CONSTRAINT style_guide_file_crawl_seen_pkey PRIMARY KEY (style_guide_file_id);

-- CONSTRAINT public.style_guide_file_preview_state style_guide_file_preview_state_pkey
ALTER TABLE ONLY public.style_guide_file_preview_state
    ADD CONSTRAINT style_guide_file_preview_state_pkey PRIMARY KEY (style_guide_file_id);

-- CONSTRAINT public.style_guide_pdf_text style_guide_pdf_text_pkey
ALTER TABLE ONLY public.style_guide_pdf_text
    ADD CONSTRAINT style_guide_pdf_text_pkey PRIMARY KEY (style_guide_file_id);

-- CONSTRAINT public.style_guide_search_documents style_guide_search_documents_pkey
ALTER TABLE ONLY public.style_guide_search_documents
    ADD CONSTRAINT style_guide_search_documents_pkey PRIMARY KEY (style_guide_file_id);

-- CONSTRAINT public.style_guide_search_embedding_jobs style_guide_search_embedding_jobs_pkey
ALTER TABLE ONLY public.style_guide_search_embedding_jobs
    ADD CONSTRAINT style_guide_search_embedding_jobs_pkey PRIMARY KEY (style_guide_file_id);

-- CONSTRAINT public.style_guide_search_sync_queue style_guide_search_sync_queue_pkey
ALTER TABLE ONLY public.style_guide_search_sync_queue
    ADD CONSTRAINT style_guide_search_sync_queue_pkey PRIMARY KEY (style_guide_file_id);

-- INDEX archive.idx_erp_items_current_dismissed
CREATE INDEX idx_erp_items_current_dismissed ON archive.erp_items_current USING btree (dismissed) WHERE (dismissed = true);

-- INDEX archive.idx_erp_items_current_mg_category
CREATE INDEX idx_erp_items_current_mg_category ON archive.erp_items_current USING btree (mg_category);

-- INDEX archive.idx_erp_items_current_style_number
CREATE INDEX idx_erp_items_current_style_number ON archive.erp_items_current USING btree (style_number);

-- INDEX archive.idx_erp_items_current_synced_at
CREATE INDEX idx_erp_items_current_synced_at ON archive.erp_items_current USING btree (synced_at);

-- INDEX archive.idx_erp_items_raw_external_id
CREATE INDEX idx_erp_items_raw_external_id ON archive.erp_items_raw USING btree (external_id);

-- INDEX archive.idx_erp_items_raw_sync_run_id
CREATE INDEX idx_erp_items_raw_sync_run_id ON archive.erp_items_raw USING btree (sync_run_id);

-- INDEX dam.asset_character_source_edge_asset_id_idx
CREATE INDEX asset_character_source_edge_asset_id_idx ON dam.asset_character_source_edge USING btree (asset_id);

-- INDEX dam.asset_character_source_edge_character_id_idx
CREATE INDEX asset_character_source_edge_character_id_idx ON dam.asset_character_source_edge USING btree (character_id);

-- INDEX dam.asset_character_source_edge_current_claim_key
CREATE UNIQUE INDEX asset_character_source_edge_current_claim_key ON dam.asset_character_source_edge USING btree (asset_id, character_id, licensor_id, source_system, evidence_kind) WHERE is_current;

-- INDEX dam.asset_character_source_edge_direct_current_idx
CREATE INDEX asset_character_source_edge_direct_current_idx ON dam.asset_character_source_edge USING btree (asset_id, character_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_character_source_edge_licensor_idx
CREATE INDEX asset_character_source_edge_licensor_idx ON dam.asset_character_source_edge USING btree (licensor_id);

-- INDEX dam.asset_character_source_edge_source_retirement_idx
CREATE INDEX asset_character_source_edge_source_retirement_idx ON dam.asset_character_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_franchise_franchise_id_idx
CREATE INDEX asset_franchise_franchise_id_idx ON dam.asset_franchise USING btree (franchise_id);

-- INDEX dam.asset_franchise_source_edge_asset_id_idx
CREATE INDEX asset_franchise_source_edge_asset_id_idx ON dam.asset_franchise_source_edge USING btree (asset_id);

-- INDEX dam.asset_franchise_source_edge_current_claim_key
CREATE UNIQUE INDEX asset_franchise_source_edge_current_claim_key ON dam.asset_franchise_source_edge USING btree (asset_id, franchise_id, licensor_id, source_system, evidence_kind) WHERE is_current;

-- INDEX dam.asset_franchise_source_edge_direct_current_idx
CREATE INDEX asset_franchise_source_edge_direct_current_idx ON dam.asset_franchise_source_edge USING btree (asset_id, franchise_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_franchise_source_edge_franchise_id_idx
CREATE INDEX asset_franchise_source_edge_franchise_id_idx ON dam.asset_franchise_source_edge USING btree (franchise_id);

-- INDEX dam.asset_franchise_source_edge_licensor_idx
CREATE INDEX asset_franchise_source_edge_licensor_idx ON dam.asset_franchise_source_edge USING btree (licensor_id);

-- INDEX dam.asset_franchise_source_edge_source_retirement_idx
CREATE INDEX asset_franchise_source_edge_source_retirement_idx ON dam.asset_franchise_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_property_property_id_idx
CREATE INDEX asset_property_property_id_idx ON dam.asset_property USING btree (property_id);

-- INDEX dam.asset_property_source_edge_asset_id_idx
CREATE INDEX asset_property_source_edge_asset_id_idx ON dam.asset_property_source_edge USING btree (asset_id);

-- INDEX dam.asset_property_source_edge_current_claim_key
CREATE UNIQUE INDEX asset_property_source_edge_current_claim_key ON dam.asset_property_source_edge USING btree (asset_id, property_id, licensor_id, source_system, evidence_kind) WHERE is_current;

-- INDEX dam.asset_property_source_edge_direct_current_idx
CREATE INDEX asset_property_source_edge_direct_current_idx ON dam.asset_property_source_edge USING btree (asset_id, property_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_property_source_edge_licensor_idx
CREATE INDEX asset_property_source_edge_licensor_idx ON dam.asset_property_source_edge USING btree (licensor_id);

-- INDEX dam.asset_property_source_edge_property_id_idx
CREATE INDEX asset_property_source_edge_property_id_idx ON dam.asset_property_source_edge USING btree (property_id);

-- INDEX dam.asset_property_source_edge_source_retirement_idx
CREATE INDEX asset_property_source_edge_source_retirement_idx ON dam.asset_property_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_style_guide_source_edge_asset_id_idx
CREATE INDEX asset_style_guide_source_edge_asset_id_idx ON dam.asset_style_guide_source_edge USING btree (asset_id);

-- INDEX dam.asset_style_guide_source_edge_current_claim_key
CREATE UNIQUE INDEX asset_style_guide_source_edge_current_claim_key ON dam.asset_style_guide_source_edge USING btree (asset_id, style_guide_id, licensor_id, source_system, evidence_kind) WHERE is_current;

-- INDEX dam.asset_style_guide_source_edge_direct_current_idx
CREATE INDEX asset_style_guide_source_edge_direct_current_idx ON dam.asset_style_guide_source_edge USING btree (asset_id, style_guide_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_style_guide_source_edge_licensor_idx
CREATE INDEX asset_style_guide_source_edge_licensor_idx ON dam.asset_style_guide_source_edge USING btree (licensor_id);

-- INDEX dam.asset_style_guide_source_edge_source_retirement_idx
CREATE INDEX asset_style_guide_source_edge_source_retirement_idx ON dam.asset_style_guide_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));

-- INDEX dam.asset_style_guide_source_edge_style_guide_id_idx
CREATE INDEX asset_style_guide_source_edge_style_guide_id_idx ON dam.asset_style_guide_source_edge USING btree (style_guide_id);

-- INDEX dam.asset_style_guide_style_guide_id_idx
CREATE INDEX asset_style_guide_style_guide_id_idx ON dam.asset_style_guide USING btree (style_guide_id);

-- INDEX dam.dam_asset_image_vectors_stale_cover
CREATE INDEX dam_asset_image_vectors_stale_cover ON dam.dam_asset_image_vectors USING btree (asset_id) INCLUDE (embedding_model, last_embedded_thumbnail_url);

-- INDEX dam.dam_asset_image_vectors_vec_dino_hnsw
CREATE INDEX dam_asset_image_vectors_vec_dino_hnsw ON dam.dam_asset_image_vectors USING hnsw (vec_dino extensions.halfvec_cosine_ops) WITH (m='16', ef_construction='64') WHERE (vec_dino IS NOT NULL);

-- INDEX dam.dam_asset_image_vectors_vec_siglip_hnsw
CREATE INDEX dam_asset_image_vectors_vec_siglip_hnsw ON dam.dam_asset_image_vectors USING hnsw (vec_siglip extensions.halfvec_cosine_ops) WITH (m='16', ef_construction='64') WHERE (vec_siglip IS NOT NULL);

-- INDEX dam.folder_rename_log_new_path_idx
CREATE INDEX folder_rename_log_new_path_idx ON dam.folder_rename_log USING btree (share, new_path);

-- INDEX dam.image_embed_jobs_kind_status_lease_idx
CREATE INDEX image_embed_jobs_kind_status_lease_idx ON dam.image_embed_jobs USING btree (kind, status, lease_expires_at);

-- INDEX dam.image_embed_jobs_one_active_index_per_asset_uq
CREATE UNIQUE INDEX image_embed_jobs_one_active_index_per_asset_uq ON dam.image_embed_jobs USING btree (asset_id) WHERE ((kind = 'index'::text) AND (status = ANY (ARRAY['pending'::text, 'leased'::text])));

-- INDEX hts_rag.hts_rag_article_types_synonyms_idx
CREATE INDEX hts_rag_article_types_synonyms_idx ON hts_rag.hts_rag_article_types USING gin (synonyms);

-- INDEX hts_rag.hts_rag_broker_opinions_determination_idx
CREATE INDEX hts_rag_broker_opinions_determination_idx ON hts_rag.hts_rag_broker_opinions USING btree (determination_id) WHERE (determination_id IS NOT NULL);

-- INDEX hts_rag.hts_rag_broker_opinions_product_auth_uq
CREATE UNIQUE INDEX hts_rag_broker_opinions_product_auth_uq ON hts_rag.hts_rag_broker_opinions USING btree (determination_id, source_environment) WHERE (is_authoritative AND (subject_kind = 'product'::text));

-- INDEX hts_rag.hts_rag_broker_opinions_ruling_auth_uq
CREATE UNIQUE INDEX hts_rag_broker_opinions_ruling_auth_uq ON hts_rag.hts_rag_broker_opinions USING btree (ruling_number, held_code, source_environment) WHERE (is_authoritative AND (subject_kind = 'ruling_code'::text));

-- INDEX hts_rag.hts_rag_broker_opinions_ruling_idx
CREATE INDEX hts_rag_broker_opinions_ruling_idx ON hts_rag.hts_rag_broker_opinions USING btree (ruling_number) WHERE (ruling_number IS NOT NULL);

-- INDEX hts_rag.hts_rag_classification_jobs_owner_idx
CREATE INDEX hts_rag_classification_jobs_owner_idx ON hts_rag.hts_rag_classification_jobs USING btree (owner_key, status);

-- INDEX hts_rag.hts_rag_classification_jobs_rfq_idx
CREATE INDEX hts_rag_classification_jobs_rfq_idx ON hts_rag.hts_rag_classification_jobs USING btree (rfq_id, rfq_item_id);

-- INDEX hts_rag.hts_rag_classification_jobs_status_idx
CREATE INDEX hts_rag_classification_jobs_status_idx ON hts_rag.hts_rag_classification_jobs USING btree (status, created_at);

-- INDEX hts_rag.hts_rag_debate_runs_claim_idx
CREATE INDEX hts_rag_debate_runs_claim_idx ON hts_rag.hts_rag_debate_runs USING btree (status, lease_expires_at) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));

-- INDEX hts_rag.hts_rag_debate_runs_precedent_idx
CREATE INDEX hts_rag_debate_runs_precedent_idx ON hts_rag.hts_rag_debate_runs USING btree (precedent_id) WHERE (precedent_id IS NOT NULL);

-- INDEX hts_rag.hts_rag_debate_runs_source_determination_idx
CREATE INDEX hts_rag_debate_runs_source_determination_idx ON hts_rag.hts_rag_debate_runs USING btree (source_determination_id);

-- INDEX hts_rag.hts_rag_decision_authorities_authority_idx
CREATE INDEX hts_rag_decision_authorities_authority_idx ON hts_rag.hts_rag_decision_authorities USING btree (authority_id, role);

-- INDEX hts_rag.hts_rag_decision_facts_key_idx
CREATE INDEX hts_rag_decision_facts_key_idx ON hts_rag.hts_rag_decision_facts USING btree (attribute_key);

-- INDEX hts_rag.hts_rag_decision_tests_extraction_idx
CREATE INDEX hts_rag_decision_tests_extraction_idx ON hts_rag.hts_rag_decision_tests USING btree (extraction_id);

-- INDEX hts_rag.hts_rag_decision_tests_test_idx
CREATE INDEX hts_rag_decision_tests_test_idx ON hts_rag.hts_rag_decision_tests USING btree (test_id, outcome);

-- INDEX hts_rag.hts_rag_determinations_comparison_category_idx
CREATE INDEX hts_rag_determinations_comparison_category_idx ON hts_rag.hts_rag_determinations USING btree (comparison_category, created_at DESC);

-- INDEX hts_rag.hts_rag_determinations_comparison_review_idx
CREATE INDEX hts_rag_determinations_comparison_review_idx ON hts_rag.hts_rag_determinations USING btree (comparison_key, comparison_review_state, created_at DESC);

-- INDEX hts_rag.hts_rag_determinations_family_created_idx
CREATE INDEX hts_rag_determinations_family_created_idx ON hts_rag.hts_rag_determinations USING btree (product_example_id, created_at DESC);

-- INDEX hts_rag.hts_rag_extraction_jobs_idempotency_idx
CREATE UNIQUE INDEX hts_rag_extraction_jobs_idempotency_idx ON hts_rag.hts_rag_extraction_jobs USING btree (product_example_id, prompt_version, model_version, extraction_version, input_hash);

-- INDEX hts_rag.hts_rag_extraction_jobs_pending_claim_idx
CREATE INDEX hts_rag_extraction_jobs_pending_claim_idx ON hts_rag.hts_rag_extraction_jobs USING btree (available_at, created_at) WHERE (status = 'pending'::text);

-- INDEX hts_rag.hts_rag_extractions_current_uq
CREATE UNIQUE INDEX hts_rag_extractions_current_uq ON hts_rag.hts_rag_extractions USING btree (ruling_number, pass) WHERE is_current;

-- INDEX hts_rag.hts_rag_fault_lines_any_type_uq
CREATE UNIQUE INDEX hts_rag_fault_lines_any_type_uq ON hts_rag.hts_rag_fault_lines_any_type USING btree (prefix_a, prefix_b, test_id, attribute_key);

-- INDEX hts_rag.hts_rag_fault_lines_uq
CREATE UNIQUE INDEX hts_rag_fault_lines_uq ON hts_rag.hts_rag_fault_lines USING btree (prefix_a, prefix_b, article_type_id, test_id, attribute_key) NULLS NOT DISTINCT;

-- INDEX hts_rag.hts_rag_heading_decisions_extraction_idx
CREATE INDEX hts_rag_heading_decisions_extraction_idx ON hts_rag.hts_rag_heading_decisions USING btree (extraction_id);

-- INDEX hts_rag.hts_rag_heading_decisions_heading_idx
CREATE INDEX hts_rag_heading_decisions_heading_idx ON hts_rag.hts_rag_heading_decisions USING btree (heading, outcome);

-- INDEX hts_rag.hts_rag_heading_decisions_prefix_idx
CREATE INDEX hts_rag_heading_decisions_prefix_idx ON hts_rag.hts_rag_heading_decisions USING btree (code_prefix);

-- INDEX hts_rag.hts_rag_heading_decisions_product_idx
CREATE INDEX hts_rag_heading_decisions_product_idx ON hts_rag.hts_rag_heading_decisions USING btree (product_id);

-- INDEX hts_rag.hts_rag_hts_renumbering_old_idx
CREATE INDEX hts_rag_hts_renumbering_old_idx ON hts_rag.hts_rag_hts_renumbering USING btree (old_code);

-- INDEX hts_rag.hts_rag_materials_synonyms_idx
CREATE INDEX hts_rag_materials_synonyms_idx ON hts_rag.hts_rag_materials USING gin (synonyms);

-- INDEX hts_rag.hts_rag_precedent_rulings_relationship_idx
CREATE INDEX hts_rag_precedent_rulings_relationship_idx ON hts_rag.hts_rag_precedent_rulings USING btree (final_relationship, verifier_relevance);

-- INDEX hts_rag.hts_rag_precedent_rulings_ruling_idx
CREATE INDEX hts_rag_precedent_rulings_ruling_idx ON hts_rag.hts_rag_precedent_rulings USING btree (ruling_id);

-- INDEX hts_rag.hts_rag_precedents_extraction_idempotency_idx
CREATE UNIQUE INDEX hts_rag_precedents_extraction_idempotency_idx ON hts_rag.hts_rag_precedents USING btree (fixture_version, prompt_version, classifier_model, verifier_model, extraction_version, fixture_hash, input_hash, raw_result_hash);

-- INDEX hts_rag.hts_rag_precedents_family_review_idx
CREATE INDEX hts_rag_precedents_family_review_idx ON hts_rag.hts_rag_precedents USING btree (product_family, review_state, created_at DESC);

-- INDEX hts_rag.hts_rag_product_attributes_key_idx
CREATE INDEX hts_rag_product_attributes_key_idx ON hts_rag.hts_rag_product_attributes USING btree (key, is_decisive);

-- INDEX hts_rag.hts_rag_product_attributes_product_idx
CREATE INDEX hts_rag_product_attributes_product_idx ON hts_rag.hts_rag_product_attributes USING btree (product_id);

-- INDEX hts_rag.hts_rag_product_components_product_idx
CREATE INDEX hts_rag_product_components_product_idx ON hts_rag.hts_rag_product_components USING btree (product_id);

-- INDEX hts_rag.hts_rag_product_examples_family_idx
CREATE INDEX hts_rag_product_examples_family_idx ON hts_rag.hts_rag_product_examples USING btree (product_family, created_at DESC);

-- INDEX hts_rag.hts_rag_provider_responses_determination_idx
CREATE INDEX hts_rag_provider_responses_determination_idx ON hts_rag.hts_rag_provider_responses USING btree (determination_id, turn_index) WHERE (determination_id IS NOT NULL);

-- INDEX hts_rag.hts_rag_review_events_subject_created_idx
CREATE INDEX hts_rag_review_events_subject_created_idx ON hts_rag.hts_rag_review_events USING btree (subject_type, subject_id, created_at DESC);

-- INDEX hts_rag.hts_rag_ruling_codes_code_role_idx
CREATE INDEX hts_rag_ruling_codes_code_role_idx ON hts_rag.hts_rag_ruling_codes USING btree (code, role);

-- INDEX hts_rag.hts_rag_ruling_codes_held_chapter_idx
CREATE INDEX hts_rag_ruling_codes_held_chapter_idx ON hts_rag.hts_rag_ruling_codes USING btree ("left"(code, 2), ruling_number) WHERE (role = 'held'::text);

-- INDEX hts_rag.hts_rag_ruling_current_codes_state_idx
CREATE INDEX hts_rag_ruling_current_codes_state_idx ON hts_rag.hts_rag_ruling_current_codes USING btree (state);

-- INDEX hts_rag.hts_rag_ruling_ingest_jobs_claim_idx
CREATE INDEX hts_rag_ruling_ingest_jobs_claim_idx ON hts_rag.hts_rag_ruling_ingest_jobs USING btree (status, lease_expires_at) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));

-- INDEX hts_rag.hts_rag_ruling_ingest_jobs_open_uq
CREATE UNIQUE INDEX hts_rag_ruling_ingest_jobs_open_uq ON hts_rag.hts_rag_ruling_ingest_jobs USING btree (source_environment, ruling_number) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));

-- INDEX hts_rag.hts_rag_ruling_ingest_jobs_source_determination_idx
CREATE INDEX hts_rag_ruling_ingest_jobs_source_determination_idx ON hts_rag.hts_rag_ruling_ingest_jobs USING btree (source_determination_id);

-- INDEX hts_rag.hts_rag_ruling_links_to_idx
CREATE INDEX hts_rag_ruling_links_to_idx ON hts_rag.hts_rag_ruling_links USING btree (to_ruling, kind);

-- INDEX hts_rag.hts_rag_ruling_passb_version_idx
CREATE INDEX hts_rag_ruling_passb_version_idx ON hts_rag.hts_rag_ruling_passb USING btree (extract_version, ruling_number);

-- INDEX hts_rag.hts_rag_ruling_products_active_chapter_idx
CREATE INDEX hts_rag_ruling_products_active_chapter_idx ON hts_rag.hts_rag_ruling_products USING btree (held_chapter, held_heading) WHERE ((effective_status = 'active'::text) AND (review_state = 'trusted'::text));

-- INDEX hts_rag.hts_rag_ruling_products_article_type_idx
CREATE INDEX hts_rag_ruling_products_article_type_idx ON hts_rag.hts_rag_ruling_products USING btree (article_type_id);

-- INDEX hts_rag.hts_rag_ruling_products_extraction_idx
CREATE INDEX hts_rag_ruling_products_extraction_idx ON hts_rag.hts_rag_ruling_products USING btree (extraction_id);

-- INDEX hts_rag.hts_rag_ruling_products_fts_idx
CREATE INDEX hts_rag_ruling_products_fts_idx ON hts_rag.hts_rag_ruling_products USING gin (to_tsvector('english'::regconfig, ((plain_phrase || ' '::text) || COALESCE(description_text, ''::text)))) WHERE ((effective_status = 'active'::text) AND (review_state = 'trusted'::text));

-- INDEX hts_rag.hts_rag_ruling_products_material_idx
CREATE INDEX hts_rag_ruling_products_material_idx ON hts_rag.hts_rag_ruling_products USING btree (primary_material_id);

-- INDEX hts_rag.hts_rag_ruling_products_phrase_hnsw_idx
CREATE INDEX hts_rag_ruling_products_phrase_hnsw_idx ON hts_rag.hts_rag_ruling_products USING hnsw (phrase_embedding extensions.halfvec_cosine_ops) WHERE ((effective_status = 'active'::text) AND (review_state = 'trusted'::text));

-- INDEX hts_rag.hts_rag_ruling_products_phrase_trgm_idx
CREATE INDEX hts_rag_ruling_products_phrase_trgm_idx ON hts_rag.hts_rag_ruling_products USING gin (plain_phrase extensions.gin_trgm_ops) WHERE ((effective_status = 'active'::text) AND (review_state = 'trusted'::text));

-- INDEX hts_rag.hts_rag_ruling_products_ruling_idx
CREATE INDEX hts_rag_ruling_products_ruling_idx ON hts_rag.hts_rag_ruling_products USING btree (ruling_number);

-- INDEX hts_rag.hts_rag_ruling_scope_labels_version_idx
CREATE INDEX hts_rag_ruling_scope_labels_version_idx ON hts_rag.hts_rag_ruling_scope_labels USING btree (label_version, in_scope, ruling_number);

-- INDEX hts_rag.hts_rag_ruling_sentences_hash_idx
CREATE INDEX hts_rag_ruling_sentences_hash_idx ON hts_rag.hts_rag_ruling_sentences USING btree (text_hash);

-- INDEX hts_rag.hts_rag_ruling_sentences_section_idx
CREATE INDEX hts_rag_ruling_sentences_section_idx ON hts_rag.hts_rag_ruling_sentences USING btree (ruling_number, section);

-- INDEX hts_rag.hts_rag_rulings_category_status_idx
CREATE INDEX hts_rag_rulings_category_status_idx ON hts_rag.hts_rag_rulings USING btree (category, effective_status);

-- INDEX hts_rag.hts_rag_rulings_operationally_revoked_idx
CREATE INDEX hts_rag_rulings_operationally_revoked_idx ON hts_rag.hts_rag_rulings USING btree (operationally_revoked);

-- INDEX hts_rag.hts_rag_rulings_ruling_date_idx
CREATE INDEX hts_rag_rulings_ruling_date_idx ON hts_rag.hts_rag_rulings USING btree (ruling_date DESC);

-- INDEX hts_rag.hts_rag_rulings_scope_cover_idx
CREATE INDEX hts_rag_rulings_scope_cover_idx ON hts_rag.hts_rag_rulings USING btree (ruling_number) INCLUDE (subject, ruling_date, effective_status, operationally_revoked);

-- INDEX hts_rag.hts_rag_rulings_search_trgm_idx
CREATE INDEX hts_rag_rulings_search_trgm_idx ON hts_rag.hts_rag_rulings USING gin (public.hts_rag_fold_text(((COALESCE(subject, ''::text) || ' '::text) || full_text)) extensions.gin_trgm_ops);

-- INDEX hts_rag.hts_rag_rulings_search_tsv_active_idx
CREATE INDEX hts_rag_rulings_search_tsv_active_idx ON hts_rag.hts_rag_rulings USING gin (search_tsv) WHERE (effective_status = 'active'::text);

-- INDEX hts_rag.hts_rag_rulings_subheadings_idx
CREATE INDEX hts_rag_rulings_subheadings_idx ON hts_rag.hts_rag_rulings USING gin (public.hts_rag_tariff_subheadings(tariffs));

-- INDEX hts_rag.hts_rag_rulings_subject_trgm_active_idx
CREATE INDEX hts_rag_rulings_subject_trgm_active_idx ON hts_rag.hts_rag_rulings USING gin (lower(subject) extensions.gin_trgm_ops) WHERE (effective_status = 'active'::text);

-- INDEX hts_rag.hts_rag_test_aliases_test_idx
CREATE INDEX hts_rag_test_aliases_test_idx ON hts_rag.hts_rag_test_aliases USING btree (test_id);

-- INDEX hts_rag.hts_rag_type_heading_stats_chapter_idx
CREATE INDEX hts_rag_type_heading_stats_chapter_idx ON hts_rag.hts_rag_type_heading_stats USING btree (article_type_id, chapter);

-- INDEX hts_rag.hts_rag_type_heading_stats_uq
CREATE UNIQUE INDEX hts_rag_type_heading_stats_uq ON hts_rag.hts_rag_type_heading_stats USING btree (article_type_id, all_materials, primary_material_id, heading, outcome) NULLS NOT DISTINCT;

-- INDEX hts_rag.item_classification_fact_item_fact_uq
CREATE UNIQUE INDEX item_classification_fact_item_fact_uq ON hts_rag.item_classification_fact USING btree (source_environment, item_ref, fact_key);

-- INDEX public.asset_licensor_characters_character_id_idx
CREATE INDEX asset_licensor_characters_character_id_idx ON public.asset_licensor_characters USING btree (character_id);

-- INDEX public.assets_style_group_changed_at_idx
CREATE INDEX assets_style_group_changed_at_idx ON public.assets USING btree (style_group_changed_at, id) WHERE (is_deleted = false);

-- INDEX public.assets_ungrouped_style_cursor_idx
CREATE INDEX assets_ungrouped_style_cursor_idx ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (style_group_id IS NULL));

-- INDEX public.bulk_operation_runs_failures_idx
CREATE INDEX bulk_operation_runs_failures_idx ON public.bulk_operation_runs USING btree (operation, started_at DESC) WHERE (NOT succeeded);

-- INDEX public.bulk_operation_runs_operation_run_key
CREATE UNIQUE INDEX bulk_operation_runs_operation_run_key ON public.bulk_operation_runs USING btree (operation, run_id);

-- INDEX public.bulk_operation_runs_operation_started_idx
CREATE INDEX bulk_operation_runs_operation_started_idx ON public.bulk_operation_runs USING btree (operation, started_at DESC);

-- INDEX public.dam_search_documents_default_flag_cover_idx
CREATE INDEX dam_search_documents_default_flag_cover_idx ON public.dam_search_documents USING btree (document_type, entity_id) INCLUDE (has_default_visible_member, default_visible_member_count, default_visible_min_date, asset_id, style_group_id);

-- INDEX public.dam_search_documents_default_visible_min_date_idx
CREATE INDEX dam_search_documents_default_visible_min_date_idx ON public.dam_search_documents USING btree (default_visible_min_date);

-- INDEX public.dam_search_documents_default_visible_null_idx
CREATE INDEX dam_search_documents_default_visible_null_idx ON public.dam_search_documents USING btree (document_type, entity_id) WHERE ((has_default_visible_member IS NULL) OR (default_visible_member_count IS NULL));

-- INDEX public.dam_search_embedding_claim_order_idx
CREATE INDEX dam_search_embedding_claim_order_idx ON public.dam_search_documents USING btree (((document_type = 'style_group'::text)) DESC, indexed_at, document_type, entity_id) WHERE ((embedding IS NULL) AND (embedding_error_category IS DISTINCT FROM 'permanent'::text) AND (NULLIF((metadata ->> 'thumbnail_url'::text), ''::text) IS NOT NULL));

-- INDEX public.dam_search_keys_customer_trgm_idx
CREATE INDEX dam_search_keys_customer_trgm_idx ON public.dam_search_keys USING gin (customer extensions.gin_trgm_ops);

-- INDEX public.dam_search_keys_path_trgm_idx
CREATE INDEX dam_search_keys_path_trgm_idx ON public.dam_search_keys USING gin (path extensions.gin_trgm_ops);

-- INDEX public.dam_search_keys_path_words_idx
CREATE INDEX dam_search_keys_path_words_idx ON public.dam_search_keys USING gin (regexp_split_to_array(lower(path), '[^[:alnum:]]+'::text));

-- INDEX public.dam_search_keys_program_trgm_idx
CREATE INDEX dam_search_keys_program_trgm_idx ON public.dam_search_keys USING gin (program extensions.gin_trgm_ops);

-- INDEX public.dam_search_keys_title_trgm_idx
CREATE INDEX dam_search_keys_title_trgm_idx ON public.dam_search_keys USING gin (title extensions.gin_trgm_ops);

-- INDEX public.dam_search_keys_title_words_idx
CREATE INDEX dam_search_keys_title_words_idx ON public.dam_search_keys USING gin (regexp_split_to_array(lower(title), '[^[:alnum:]]+'::text));

-- INDEX public.dam_search_keys_tsv_idx
CREATE INDEX dam_search_keys_tsv_idx ON public.dam_search_keys USING gin (search_tsv);

-- INDEX public.hts_rag_debate_runs_claim_idx
CREATE INDEX hts_rag_debate_runs_claim_idx ON public.hts_rag_debate_runs USING btree (status, lease_expires_at) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));

-- INDEX public.hts_rag_debate_runs_precedent_idx
CREATE INDEX hts_rag_debate_runs_precedent_idx ON public.hts_rag_debate_runs USING btree (precedent_id) WHERE (precedent_id IS NOT NULL);

-- INDEX public.hts_rag_debate_runs_source_determination_idx
CREATE INDEX hts_rag_debate_runs_source_determination_idx ON public.hts_rag_debate_runs USING btree (source_determination_id);

-- INDEX public.hts_rag_rulings_search_trgm_idx
CREATE INDEX hts_rag_rulings_search_trgm_idx ON public.hts_rag_rulings USING gin (public.hts_rag_fold_text(((COALESCE(subject, ''::text) || ' '::text) || full_text)) extensions.gin_trgm_ops);

-- INDEX public.hts_rag_rulings_subheadings_idx
CREATE INDEX hts_rag_rulings_subheadings_idx ON public.hts_rag_rulings USING gin (public.hts_rag_tariff_subheadings(tariffs));

-- INDEX public.idx_assets_ai_tag_all_candidates
DROP INDEX IF EXISTS public.idx_assets_ai_tag_all_candidates;
CREATE INDEX idx_assets_ai_tag_all_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[5, 9])));

-- INDEX public.idx_assets_ai_tag_untagged_candidates
DROP INDEX IF EXISTS public.idx_assets_ai_tag_untagged_candidates;
CREATE INDEX idx_assets_ai_tag_untagged_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[5, 9])) AND (status <> 'tagged'::public.asset_status));

-- INDEX public.idx_assets_embed_stale_cover
CREATE INDEX idx_assets_embed_stale_cover ON public.assets USING btree (id) INCLUDE (is_deleted, thumbnail_url);

-- INDEX public.idx_assets_licensing_pdf_backfill_candidates
CREATE INDEX idx_assets_licensing_pdf_backfill_candidates ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (file_type = 'pdf'::public.file_type) AND public.is_style_guide_source_pdf('pdf'::text, filename));

-- INDEX public.idx_assets_pdf_rescan_candidates
CREATE INDEX idx_assets_pdf_rescan_candidates ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (file_type = 'pdf'::public.file_type));

-- INDEX public.idx_assets_sku_division_active
CREATE INDEX idx_assets_sku_division_active ON public.assets USING btree (sku, division_code) WHERE (is_deleted = false);

-- INDEX public.idx_assets_tag_pending_facets
CREATE INDEX idx_assets_tag_pending_facets ON public.assets USING btree (id) INCLUDE (file_type, status, workflow_status, stage, is_licensed, modified_at, file_created_at) WHERE ((is_deleted = false) AND (thumbnail_url IS NULL));

-- INDEX public.idx_assets_tag_rls_visible_ids
CREATE INDEX idx_assets_tag_rls_visible_ids ON public.assets USING btree (id) WHERE (is_deleted = false);

-- INDEX public.idx_assets_tag_visible_facets
CREATE INDEX idx_assets_tag_visible_facets ON public.assets USING btree (id) INCLUDE (file_type, status, workflow_status, stage, is_licensed) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL));

-- INDEX public.idx_assets_thumbnail_error_pattern
CREATE INDEX idx_assets_thumbnail_error_pattern ON public.assets USING btree (thumbnail_error text_pattern_ops) WHERE (thumbnail_error IS NOT NULL);

-- INDEX public.idx_product_category_predictions_plm_item_id
CREATE INDEX idx_product_category_predictions_plm_item_id ON public.product_category_predictions USING btree (plm_item_id) WHERE (plm_item_id IS NOT NULL);

-- INDEX public.idx_sg_file_crawl_seen_root_run
CREATE INDEX idx_sg_file_crawl_seen_root_run ON public.style_guide_file_crawl_seen USING btree (root_label, crawl_run_id, style_guide_file_id);

-- INDEX public.idx_sg_pdf_text_claimable
CREATE INDEX idx_sg_pdf_text_claimable ON public.style_guide_pdf_text USING btree (status, claim_expires_at, style_guide_file_id) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text, 'failed'::text]));

-- INDEX public.idx_sg_search_documents_claim_pending
CREATE INDEX idx_sg_search_documents_claim_pending ON public.style_guide_search_documents USING btree (document_updated_at, style_guide_file_id) INCLUDE (thumbnail_url, embedding_next_retry_at, embedding_lease_expires_at) WHERE (is_active AND (content_sha256 IS NOT NULL) AND (embedding IS NULL) AND (embedding_attempts < embedding_max_attempts) AND (embedding_error_category IS DISTINCT FROM 'permanent'::text));

-- INDEX public.idx_sg_search_documents_embedding_hnsw
CREATE INDEX idx_sg_search_documents_embedding_hnsw ON public.style_guide_search_documents USING hnsw (embedding extensions.vector_cosine_ops) WHERE (embedding IS NOT NULL);

-- INDEX public.idx_sg_search_documents_embedding_pending
CREATE INDEX idx_sg_search_documents_embedding_pending ON public.style_guide_search_documents USING btree (document_updated_at, style_guide_file_id) WHERE (is_active AND (content_sha256 IS NOT NULL) AND (embedding IS NULL));

-- INDEX public.idx_sg_search_documents_filters
CREATE INDEX idx_sg_search_documents_filters ON public.style_guide_search_documents USING btree (licensor_name, property_folder, file_extension, modified_at DESC) WHERE is_active;

-- INDEX public.idx_sg_search_documents_meter_embedded
CREATE INDEX idx_sg_search_documents_meter_embedded ON public.style_guide_search_documents USING btree (style_guide_file_id) WHERE (embedding IS NOT NULL);

-- INDEX public.idx_sg_search_documents_meter_errored
CREATE INDEX idx_sg_search_documents_meter_errored ON public.style_guide_search_documents USING btree (style_guide_file_id) WHERE (embedding_error IS NOT NULL);

-- INDEX public.idx_sg_search_documents_meter_exhausted
CREATE INDEX idx_sg_search_documents_meter_exhausted ON public.style_guide_search_documents USING btree (style_guide_file_id) WHERE ((embedding IS NULL) AND ((embedding_attempts >= embedding_max_attempts) OR (embedding_error_category = 'permanent'::text)));

-- INDEX public.idx_sg_search_documents_meter_lease
CREATE INDEX idx_sg_search_documents_meter_lease ON public.style_guide_search_documents USING btree (embedding_lease_expires_at);

-- INDEX public.idx_sg_search_documents_meter_pending
CREATE INDEX idx_sg_search_documents_meter_pending ON public.style_guide_search_documents USING btree (document_updated_at, style_guide_file_id) WHERE (is_active AND (content_sha256 IS NOT NULL) AND (embedding IS NULL) AND (embedding_attempts < embedding_max_attempts) AND (embedding_error_category IS DISTINCT FROM 'permanent'::text));

-- INDEX public.idx_sg_search_documents_meter_unidentified
CREATE INDEX idx_sg_search_documents_meter_unidentified ON public.style_guide_search_documents USING btree (style_guide_file_id) WHERE (content_sha256 IS NULL);

-- INDEX public.idx_sg_search_documents_meter_updated_at
CREATE INDEX idx_sg_search_documents_meter_updated_at ON public.style_guide_search_documents USING btree (document_updated_at);

-- INDEX public.idx_sg_search_documents_search_vector
CREATE INDEX idx_sg_search_documents_search_vector ON public.style_guide_search_documents USING gin (search_vector) WHERE is_active;

-- INDEX public.idx_sg_search_documents_stable_page
CREATE INDEX idx_sg_search_documents_stable_page ON public.style_guide_search_documents USING btree (modified_at DESC NULLS LAST, style_guide_file_id) WHERE is_active;

-- INDEX public.idx_sgf_active_preview_category
CREATE INDEX idx_sgf_active_preview_category ON public.style_guide_files USING btree ((
CASE
    WHEN (thumbnail_url IS NOT NULL) THEN 'has_preview'::text
    WHEN (lower(file_extension) <> ALL (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text])) THEN 'unsupported'::text
    WHEN ((thumbnail_error IS NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text]))) THEN 'renderable_no_preview'::text
    WHEN ((thumbnail_error IS NOT NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text])) AND ((lower(thumbnail_error) = ANY (ARRAY['no_pdf_compat'::text, 'no_preview_or_render_failed'::text, 'blank_render'::text])) OR (lower(thumbnail_error) ~~ '%enoent%'::text) OR (lower(thumbnail_error) ~~ '%not found%'::text) OR (lower(thumbnail_error) ~~ '%missing%'::text) OR (lower(thumbnail_error) ~~ '%unsupported%'::text) OR (lower(thumbnail_error) ~~ '%corrupt%'::text))) THEN 'renderable_terminal'::text
    WHEN ((thumbnail_error IS NOT NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text]))) THEN 'renderable_recoverable'::text
    WHEN ((thumbnail_error IS NOT NULL) AND ((lower(thumbnail_error) = ANY (ARRAY['no_pdf_compat'::text, 'no_preview_or_render_failed'::text, 'blank_render'::text])) OR (lower(thumbnail_error) ~~ '%enoent%'::text) OR (lower(thumbnail_error) ~~ '%not found%'::text) OR (lower(thumbnail_error) ~~ '%missing%'::text) OR (lower(thumbnail_error) ~~ '%unsupported%'::text) OR (lower(thumbnail_error) ~~ '%corrupt%'::text))) THEN 'other_terminal'::text
    WHEN (thumbnail_error IS NOT NULL) THEN 'other_recoverable'::text
    ELSE 'other_unexplained'::text
END)) WHERE is_active;

-- INDEX public.idx_sgf_live_missing_clean_ids
CREATE INDEX idx_sgf_live_missing_clean_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NULL));

-- INDEX public.idx_sgf_live_missing_error_ids
CREATE INDEX idx_sgf_live_missing_error_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NOT NULL));

-- INDEX public.idx_sgf_live_preview_ids
CREATE INDEX idx_sgf_live_preview_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NOT NULL));

-- INDEX public.idx_sgf_reconcile_root_active_run_id
CREATE INDEX idx_sgf_reconcile_root_active_run_id ON public.style_guide_files USING btree (root_label, crawl_run_id, id) WHERE is_active;

-- INDEX public.idx_style_groups_code_format
CREATE INDEX idx_style_groups_code_format ON public.style_groups USING btree (translate(sku, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'::text, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999'::text)) WHERE ((sku COLLATE "C") ~ '^[A-Za-z0-9]{7,64}$'::text);

-- INDEX public.idx_style_guide_files_thumbnail_live
CREATE INDEX idx_style_guide_files_thumbnail_live ON public.style_guide_files USING btree (id) INCLUDE (is_active) WHERE (thumbnail_url IS NOT NULL);

-- INDEX public.render_queue_search_image_revision_idx
CREATE INDEX render_queue_search_image_revision_idx ON public.render_queue USING btree (asset_id, completed_at DESC) WHERE ((status = 'completed'::public.queue_status) AND (completed_at IS NOT NULL));

-- INDEX public.sgfolders_licensor_property_uidx
CREATE UNIQUE INDEX sgfolders_licensor_property_uidx ON public.style_guide_folders USING btree (licensor_name, property_folder) NULLS NOT DISTINCT;

-- INDEX public.sku_sg_pdf_declared_key_idx
CREATE INDEX sku_sg_pdf_declared_key_idx ON public.pdf_text_samples USING btree (declared_style_guide_key, asset_id);

-- INDEX public.sku_style_guide_links_core_guide_idx
CREATE INDEX sku_style_guide_links_core_guide_idx ON public.sku_style_guide_links USING btree (core_style_guide_id) WHERE (core_style_guide_id IS NOT NULL);

-- INDEX public.sku_style_guide_links_guide_idx
CREATE INDEX sku_style_guide_links_guide_idx ON public.sku_style_guide_links USING btree (source_system, source_style_guide_key);

-- INDEX public.sku_style_guide_links_sku_idx
CREATE INDEX sku_style_guide_links_sku_idx ON public.sku_style_guide_links USING btree (sku);

-- INDEX public.style_groups_style_group_changed_at_idx
CREATE INDEX style_groups_style_group_changed_at_idx ON public.style_groups USING btree (style_group_changed_at, id);

-- INDEX public.style_guide_library_default_guides_group_uidx
CREATE UNIQUE INDEX style_guide_library_default_guides_group_uidx ON public.style_guide_library_default_guides USING btree (group_id);

-- INDEX public.style_guide_library_default_guides_modified_idx
CREATE INDEX style_guide_library_default_guides_modified_idx ON public.style_guide_library_default_guides USING btree (modified_at DESC NULLS LAST, entity_key);

-- INDEX public.style_guide_library_default_guides_name_idx
CREATE INDEX style_guide_library_default_guides_name_idx ON public.style_guide_library_default_guides USING btree (sort_name, entity_key);

-- INDEX public.style_guide_library_default_summary_mode_uidx
CREATE UNIQUE INDEX style_guide_library_default_summary_mode_uidx ON public.style_guide_library_default_summary USING btree (result_mode);

-- TRIGGER archive.erp_items_current set_erp_items_current_updated_at
CREATE TRIGGER set_erp_items_current_updated_at BEFORE UPDATE ON archive.erp_items_current FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- TRIGGER dam.asset_character_source_edge assert_canonical_edge_still_supported
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON dam.asset_character_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('dam.asset_character', 'asset_id', 'character_id');

-- TRIGGER dam.asset_franchise_source_edge assert_canonical_edge_still_supported
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON dam.asset_franchise_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('dam.asset_franchise', 'asset_id', 'franchise_id');

-- TRIGGER dam.asset_property_source_edge assert_canonical_edge_still_supported
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON dam.asset_property_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('dam.asset_property', 'asset_id', 'property_id');

-- TRIGGER dam.asset_style_guide_source_edge assert_canonical_edge_still_supported
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON dam.asset_style_guide_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('dam.asset_style_guide', 'asset_id', 'style_guide_id');

-- TRIGGER dam.asset dam_asset_freshness_guard
CREATE TRIGGER dam_asset_freshness_guard BEFORE INSERT OR UPDATE ON dam.asset FOR EACH ROW EXECUTE FUNCTION dam.enforce_asset_freshness();

-- TRIGGER dam.asset_character lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_character FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_character', 'asset_id', 'character_id');

-- TRIGGER dam.asset_character_source_edge lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_character', 'asset_id', 'character_id');

-- TRIGGER dam.asset_franchise lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_franchise FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_franchise', 'asset_id', 'franchise_id');

-- TRIGGER dam.asset_franchise_source_edge lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_franchise', 'asset_id', 'franchise_id');

-- TRIGGER dam.asset_property lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_property FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_property', 'asset_id', 'property_id');

-- TRIGGER dam.asset_property_source_edge lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_property_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_property', 'asset_id', 'property_id');

-- TRIGGER dam.asset_style_guide lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_style_guide FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_style_guide', 'asset_id', 'style_guide_id');

-- TRIGGER dam.asset_style_guide_source_edge lock_relationship_pair
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON dam.asset_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('dam.asset_style_guide', 'asset_id', 'style_guide_id');

-- TRIGGER dam.asset_character_source_edge refuse_delete_of_current_support
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON dam.asset_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();

-- TRIGGER dam.asset_franchise_source_edge refuse_delete_of_current_support
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON dam.asset_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();

-- TRIGGER dam.asset_property_source_edge refuse_delete_of_current_support
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON dam.asset_property_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();

-- TRIGGER dam.asset_style_guide_source_edge refuse_delete_of_current_support
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON dam.asset_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();

-- TRIGGER dam.asset_character require_direct_support
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON dam.asset_character FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('dam.asset_character_source_edge', 'asset_id', 'character_id');

-- TRIGGER dam.asset_franchise require_direct_support
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON dam.asset_franchise FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('dam.asset_franchise_source_edge', 'asset_id', 'franchise_id');

-- TRIGGER dam.asset_property require_direct_support
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON dam.asset_property FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('dam.asset_property_source_edge', 'asset_id', 'property_id');

-- TRIGGER dam.asset_style_guide require_direct_support
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON dam.asset_style_guide FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('dam.asset_style_guide_source_edge', 'asset_id', 'style_guide_id');

-- TRIGGER dam.asset_character_source_edge require_matching_licensor
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON dam.asset_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('dam.asset', 'asset_id', 'core.character', 'character_id');

-- TRIGGER dam.asset_franchise_source_edge require_matching_licensor
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON dam.asset_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('dam.asset', 'asset_id', 'core.franchise', 'franchise_id');

-- TRIGGER dam.asset_property_source_edge require_matching_licensor
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON dam.asset_property_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('dam.asset', 'asset_id', 'core.property', 'property_id');

-- TRIGGER dam.asset_style_guide_source_edge require_matching_licensor
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON dam.asset_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('dam.asset', 'asset_id', 'core.style_guide', 'style_guide_id');

-- TRIGGER dam.asset_character_source_edge set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_character_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.asset_franchise set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_franchise FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.asset_franchise_source_edge set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.asset_property set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_property FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.asset_property_source_edge set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_property_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.asset_style_guide set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_style_guide FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.asset_style_guide_source_edge set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.asset_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER dam.image_embed_jobs set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dam.image_embed_jobs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_precedents hts_rag_precedents_promotion_gate_immutable
CREATE TRIGGER hts_rag_precedents_promotion_gate_immutable BEFORE UPDATE OF promotion_gate_result ON hts_rag.hts_rag_precedents FOR EACH ROW EXECUTE FUNCTION hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable();

-- TRIGGER hts_rag.hts_rag_article_types set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_article_types FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_attribute_keys set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_attribute_keys FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_authorities set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_authorities FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_broker_opinions set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_broker_opinions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_classification_tests set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_classification_tests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_counterfactuals set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_counterfactuals FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_debate_runs set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_debate_runs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_decision_authorities set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_decision_authorities FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_decision_facts set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_decision_facts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_decision_tests set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_decision_tests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_extractions set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_extractions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_heading_decisions set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_heading_decisions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_hts_codes set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_hts_codes FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_hts_renumbering set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_hts_renumbering FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_materials set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_materials FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_product_attributes set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_product_attributes FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_product_components set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_product_components FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_codes set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_ruling_codes FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_current_codes set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_ruling_current_codes FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_ingest_jobs set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_ruling_ingest_jobs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_links set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_ruling_links FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_products set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_ruling_products FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_sentences set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_ruling_sentences FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_rulings set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_rulings FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_test_aliases set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.hts_rag_test_aliases FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.item_classification_fact set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hts_rag.item_classification_fact FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER hts_rag.hts_rag_ruling_links validate_affected_product_ids
CREATE TRIGGER validate_affected_product_ids BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_ruling_links FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_affected_product_ids();

-- TRIGGER hts_rag.hts_rag_counterfactuals validate_sentence_provenance
CREATE TRIGGER validate_sentence_provenance BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_counterfactuals FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_sentence_provenance();

-- TRIGGER hts_rag.hts_rag_decision_authorities validate_sentence_provenance
CREATE TRIGGER validate_sentence_provenance BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_decision_authorities FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_sentence_provenance();

-- TRIGGER hts_rag.hts_rag_decision_facts validate_sentence_provenance
CREATE TRIGGER validate_sentence_provenance BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_decision_facts FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_sentence_provenance();

-- TRIGGER hts_rag.hts_rag_decision_tests validate_sentence_provenance
CREATE TRIGGER validate_sentence_provenance BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_decision_tests FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_sentence_provenance();

-- TRIGGER hts_rag.hts_rag_heading_decisions validate_sentence_provenance
CREATE TRIGGER validate_sentence_provenance BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_heading_decisions FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_sentence_provenance();

-- TRIGGER hts_rag.hts_rag_product_attributes validate_sentence_provenance
CREATE TRIGGER validate_sentence_provenance BEFORE INSERT OR UPDATE ON hts_rag.hts_rag_product_attributes FOR EACH ROW EXECUTE FUNCTION hts_rag.validate_sentence_provenance();

-- TRIGGER public.asset_characters asset_characters_dam_search_refresh_del
CREATE TRIGGER asset_characters_dam_search_refresh_del AFTER DELETE ON public.asset_characters REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_characters asset_characters_dam_search_refresh_ins
CREATE TRIGGER asset_characters_dam_search_refresh_ins AFTER INSERT ON public.asset_characters REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_characters asset_characters_dam_search_refresh_upd
CREATE TRIGGER asset_characters_dam_search_refresh_upd AFTER UPDATE ON public.asset_characters REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_licensor_characters asset_licensor_characters_dam_search_refresh_del
CREATE TRIGGER asset_licensor_characters_dam_search_refresh_del AFTER DELETE ON public.asset_licensor_characters REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_licensor_characters asset_licensor_characters_dam_search_refresh_ins
CREATE TRIGGER asset_licensor_characters_dam_search_refresh_ins AFTER INSERT ON public.asset_licensor_characters REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_licensor_characters asset_licensor_characters_dam_search_refresh_upd
CREATE TRIGGER asset_licensor_characters_dam_search_refresh_upd AFTER UPDATE ON public.asset_licensor_characters REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_tags asset_tags_dam_search_refresh_del
CREATE TRIGGER asset_tags_dam_search_refresh_del AFTER DELETE ON public.asset_tags REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_tags asset_tags_dam_search_refresh_ins
CREATE TRIGGER asset_tags_dam_search_refresh_ins AFTER INSERT ON public.asset_tags REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_tags asset_tags_dam_search_refresh_upd
CREATE TRIGGER asset_tags_dam_search_refresh_upd AFTER UPDATE ON public.asset_tags REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.asset_tags asset_tags_sync_assets_tags_del
CREATE TRIGGER asset_tags_sync_assets_tags_del AFTER DELETE ON public.asset_tags REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_asset_tags_to_array();

-- TRIGGER public.asset_tags asset_tags_sync_assets_tags_ins
CREATE TRIGGER asset_tags_sync_assets_tags_ins AFTER INSERT ON public.asset_tags REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_asset_tags_to_array();

-- TRIGGER public.asset_tags asset_tags_sync_assets_tags_upd
CREATE TRIGGER asset_tags_sync_assets_tags_upd AFTER UPDATE ON public.asset_tags REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.sync_asset_tags_to_array();

-- TRIGGER public.assets assets_style_group_change_clock
CREATE TRIGGER assets_style_group_change_clock BEFORE INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.stamp_style_group_asset_change();

-- TRIGGER public.dam_search_documents dam_search_documents_default_visible
CREATE TRIGGER dam_search_documents_default_visible BEFORE INSERT OR UPDATE OF document_type, entity_id, asset_id, style_group_id ON public.dam_search_documents FOR EACH ROW EXECUTE FUNCTION public.dam_search_documents_set_default_visible();

-- TRIGGER public.dam_search_documents dam_search_documents_sync_keys
CREATE TRIGGER dam_search_documents_sync_keys AFTER INSERT OR DELETE OR UPDATE OF document_type, entity_id, asset_id, style_group_id, title, path, customer, program, search_text ON public.dam_search_documents FOR EACH ROW EXECUTE FUNCTION public.sync_dam_search_keys();

-- TRIGGER public.hts_rag_precedents hts_rag_precedents_promotion_gate_immutable
CREATE TRIGGER hts_rag_precedents_promotion_gate_immutable BEFORE UPDATE OF promotion_gate_result ON public.hts_rag_precedents FOR EACH ROW EXECUTE FUNCTION public.enforce_hts_rag_precedent_promotion_gate_immutable();

-- TRIGGER public.pdf_text_samples pdf_text_samples_style_tags
CREATE TRIGGER pdf_text_samples_style_tags AFTER INSERT OR UPDATE OF extracted_fields ON public.pdf_text_samples FOR EACH ROW EXECUTE FUNCTION public.apply_pdf_sheet_style_tags();

-- TRIGGER public.product_category_predictions product_category_predictions_resolve_item_identity
CREATE TRIGGER product_category_predictions_resolve_item_identity BEFORE INSERT OR UPDATE OF external_id, erp_item_id, plm_item_id ON public.product_category_predictions FOR EACH ROW EXECUTE FUNCTION public.resolve_product_category_prediction_item_identity();

-- TRIGGER public.assets redirect_retired_wb_licensor
CREATE TRIGGER redirect_retired_wb_licensor BEFORE INSERT OR UPDATE OF licensor_id ON public.assets FOR EACH ROW EXECUTE FUNCTION plm.redirect_retired_wb_licensor();

-- TRIGGER public.style_groups redirect_retired_wb_licensor
CREATE TRIGGER redirect_retired_wb_licensor BEFORE INSERT OR UPDATE OF licensor_id ON public.style_groups FOR EACH ROW EXECUTE FUNCTION plm.redirect_retired_wb_licensor();

-- TRIGGER public.hts_rag_debate_runs set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.hts_rag_debate_runs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER public.sku_style_guide_links set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sku_style_guide_links FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- TRIGGER public.pdf_text_samples sku_sg_pdf_keys
CREATE TRIGGER sku_sg_pdf_keys BEFORE INSERT OR UPDATE OF extracted_text, declared_style_guide_label, declared_style_guide_key ON public.pdf_text_samples FOR EACH ROW EXECUTE FUNCTION public.sku_sg_pdf_keys();

-- TRIGGER public.style_group_tags style_group_tags_change_clock
CREATE TRIGGER style_group_tags_change_clock AFTER INSERT OR DELETE OR UPDATE ON public.style_group_tags FOR EACH ROW EXECUTE FUNCTION public.touch_style_group_tag_change();

-- TRIGGER public.style_group_tags style_group_tags_dam_search_refresh_del
CREATE TRIGGER style_group_tags_dam_search_refresh_del AFTER DELETE ON public.style_group_tags REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.style_group_tags style_group_tags_dam_search_refresh_ins
CREATE TRIGGER style_group_tags_dam_search_refresh_ins AFTER INSERT ON public.style_group_tags REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.style_group_tags style_group_tags_dam_search_refresh_upd
CREATE TRIGGER style_group_tags_dam_search_refresh_upd AFTER UPDATE ON public.style_group_tags REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_dam_tag_or_character_stmt();

-- TRIGGER public.style_groups style_groups_style_group_change_clock
CREATE TRIGGER style_groups_style_group_change_clock BEFORE INSERT OR UPDATE ON public.style_groups FOR EACH ROW EXECUTE FUNCTION public.stamp_style_group_definition_change();

-- TRIGGER public.assets trg_assets_enqueue_image_embed
CREATE TRIGGER trg_assets_enqueue_image_embed AFTER INSERT OR UPDATE OF thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION dam.assets_enqueue_image_embed_trg_fn();

-- TRIGGER public.assets trg_assets_rollup_pdf_rich_extraction_groups
CREATE TRIGGER trg_assets_rollup_pdf_rich_extraction_groups AFTER UPDATE OF style_group_id ON public.assets FOR EACH STATEMENT EXECUTE FUNCTION dam.rollup_moved_pdf_rich_extraction_groups();

-- TRIGGER public.assets trg_assets_sync_pdf_rich_extraction_group
CREATE TRIGGER trg_assets_sync_pdf_rich_extraction_group AFTER UPDATE OF style_group_id ON public.assets FOR EACH ROW WHEN ((old.style_group_id IS DISTINCT FROM new.style_group_id)) EXECUTE FUNCTION dam.sync_pdf_rich_extraction_style_group();

-- TRIGGER public.assets trg_auto_queue_render
DROP TRIGGER IF EXISTS trg_auto_queue_render ON public.assets;
CREATE TRIGGER trg_auto_queue_render AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((old.id IS DISTINCT FROM new.id) OR (old.thumbnail_error IS DISTINCT FROM new.thumbnail_error) OR (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url) OR (old.filename IS DISTINCT FROM new.filename))) EXECUTE FUNCTION public.auto_queue_render();

-- TRIGGER public.assets trg_auto_queue_render_ins_del
CREATE TRIGGER trg_auto_queue_render_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION public.auto_queue_render();

-- TRIGGER public.assets trg_compute_primary_sort_tier
DROP TRIGGER IF EXISTS trg_compute_primary_sort_tier ON public.assets;
CREATE TRIGGER trg_compute_primary_sort_tier BEFORE INSERT OR UPDATE OF filename, relative_path, file_type, thumbnail_url, thumbnail_error ON public.assets FOR EACH ROW EXECUTE FUNCTION public.compute_primary_sort_tier();

-- TRIGGER public.render_queue trg_dam_search_after_render_completion
CREATE TRIGGER trg_dam_search_after_render_completion AFTER UPDATE OF status, completed_at ON public.render_queue FOR EACH ROW EXECUTE FUNCTION public.refresh_dam_search_after_render_completion();

-- TRIGGER public.assets trg_dam_search_after_source_size_change
CREATE TRIGGER trg_dam_search_after_source_size_change AFTER UPDATE OF file_size ON public.assets FOR EACH ROW WHEN (((old.file_size IS DISTINCT FROM new.file_size) AND (NOT (old.modified_at IS DISTINCT FROM new.modified_at)) AND (NOT (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url)))) EXECUTE FUNCTION public.refresh_dam_search_after_source_size_change();

-- TRIGGER public.assets trg_dam_search_assets_refresh
DROP TRIGGER IF EXISTS trg_dam_search_assets_refresh ON public.assets;
CREATE TRIGGER trg_dam_search_assets_refresh AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((old.id IS DISTINCT FROM new.id) OR (old.filename IS DISTINCT FROM new.filename) OR (old.relative_path IS DISTINCT FROM new.relative_path) OR (old.content_type IS DISTINCT FROM new.content_type) OR (old.cover_description IS DISTINCT FROM new.cover_description) OR (old.ai_description IS DISTINCT FROM new.ai_description) OR (old.scene_description IS DISTINCT FROM new.scene_description) OR (old.customer IS DISTINCT FROM new.customer) OR (old.program IS DISTINCT FROM new.program) OR (old.licensor_name IS DISTINCT FROM new.licensor_name) OR (old.property_name IS DISTINCT FROM new.property_name) OR (old.product_category IS DISTINCT FROM new.product_category) OR (old.product_material IS DISTINCT FROM new.product_material) OR (old.product_dimensions IS DISTINCT FROM new.product_dimensions) OR (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url) OR (old.file_type IS DISTINCT FROM new.file_type) OR (old.asset_type IS DISTINCT FROM new.asset_type) OR (old.workflow_status IS DISTINCT FROM new.workflow_status) OR (old.is_licensed IS DISTINCT FROM new.is_licensed) OR (old.style_group_id IS DISTINCT FROM new.style_group_id) OR (old.is_deleted IS DISTINCT FROM new.is_deleted) OR (old.modified_at IS DISTINCT FROM new.modified_at))) EXECUTE FUNCTION public.trg_refresh_dam_asset_search_document();

-- TRIGGER public.assets trg_dam_search_assets_refresh_ins_del
CREATE TRIGGER trg_dam_search_assets_refresh_ins_del AFTER INSERT OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_dam_asset_search_document();

-- TRIGGER public.style_guide_files trg_style_guide_file_preview_state
CREATE TRIGGER trg_style_guide_file_preview_state AFTER INSERT OR UPDATE OF is_active, thumbnail_url, thumbnail_error ON public.style_guide_files FOR EACH ROW EXECUTE FUNCTION public.sync_style_guide_file_preview_state();

-- TRIGGER public.style_guide_files trg_style_guide_files_crawl_seen
CREATE TRIGGER trg_style_guide_files_crawl_seen AFTER INSERT OR UPDATE OF is_active, crawl_run_id, root_label ON public.style_guide_files FOR EACH ROW EXECUTE FUNCTION public.style_guide_files_sync_crawl_seen();

-- TRIGGER public.style_guide_files trg_style_guide_files_queue_search_sync
CREATE TRIGGER trg_style_guide_files_queue_search_sync AFTER INSERT OR UPDATE ON public.style_guide_files FOR EACH ROW EXECUTE FUNCTION public.style_guide_files_queue_search_sync();

-- TRIGGER public.assets trg_sync_cover_description_to_style_group
DROP TRIGGER IF EXISTS trg_sync_cover_description_to_style_group ON public.assets;
CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((old.cover_description IS DISTINCT FROM new.cover_description) OR (old.style_group_id IS DISTINCT FROM new.style_group_id) OR (old.is_deleted IS DISTINCT FROM new.is_deleted))) EXECUTE FUNCTION public.sync_cover_description_to_style_group();

-- TRIGGER public.assets trg_sync_cover_description_to_style_group_ins_del
CREATE TRIGGER trg_sync_cover_description_to_style_group_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_cover_description_to_style_group();

-- TRIGGER public.assets trg_sync_designer_to_style_group
DROP TRIGGER IF EXISTS trg_sync_designer_to_style_group ON public.assets;
CREATE TRIGGER trg_sync_designer_to_style_group AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((old.designer_name IS DISTINCT FROM new.designer_name) OR (old.technical_designer_name IS DISTINCT FROM new.technical_designer_name) OR (old.freelancer_name IS DISTINCT FROM new.freelancer_name) OR (old.style_group_id IS DISTINCT FROM new.style_group_id) OR (old.is_deleted IS DISTINCT FROM new.is_deleted))) EXECUTE FUNCTION public.sync_designer_to_style_group();

-- TRIGGER public.assets trg_sync_designer_to_style_group_ins_del
CREATE TRIGGER trg_sync_designer_to_style_group_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_designer_to_style_group();

-- TRIGGER public.assets trg_sync_primary_on_thumbnail
DROP TRIGGER IF EXISTS trg_sync_primary_on_thumbnail ON public.assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER UPDATE ON public.assets FOR EACH ROW WHEN (((old.id IS DISTINCT FROM new.id) OR (old.thumbnail_url IS DISTINCT FROM new.thumbnail_url) OR (old.thumbnail_error IS DISTINCT FROM new.thumbnail_error) OR (old.style_group_id IS DISTINCT FROM new.style_group_id) OR (old.asset_type IS DISTINCT FROM new.asset_type))) EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();

-- TRIGGER public.assets trg_sync_primary_on_thumbnail_ins_del
CREATE TRIGGER trg_sync_primary_on_thumbnail_ins_del AFTER INSERT ON public.assets FOR EACH ROW EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();

-- TRIGGER public.dam_search_documents trg_sync_search_group_vectors
CREATE TRIGGER trg_sync_search_group_vectors AFTER INSERT OR DELETE OR UPDATE OF document_type, entity_id, asset_id, style_group_id, embedding, embedding_model ON public.dam_search_documents FOR EACH ROW EXECUTE FUNCTION dam.sync_search_group_vectors();

ALTER TABLE public.dam_search_documents ENABLE ALWAYS TRIGGER trg_sync_search_group_vectors;

-- TRIGGER public.assets zz_assets_refresh_default_visible_flags
CREATE TRIGGER zz_assets_refresh_default_visible_flags AFTER INSERT OR DELETE OR UPDATE OF id, is_deleted, modified_at, file_created_at, thumbnail_url, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION public.assets_refresh_default_visible_flags();

-- FK CONSTRAINT archive.erp_items_current erp_items_current_sync_run_id_fkey
ALTER TABLE ONLY archive.erp_items_current
    ADD CONSTRAINT erp_items_current_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.erp_sync_runs(id) ON DELETE SET NULL;

-- FK CONSTRAINT archive.erp_items_raw erp_items_raw_sync_run_id_fkey
ALTER TABLE ONLY archive.erp_items_raw
    ADD CONSTRAINT erp_items_raw_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.erp_sync_runs(id) ON DELETE SET NULL;

-- FK CONSTRAINT dam.asset_character_source_edge asset_character_source_edge_asset_id_fkey
ALTER TABLE ONLY dam.asset_character_source_edge
    ADD CONSTRAINT asset_character_source_edge_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_character_source_edge asset_character_source_edge_character_id_fkey
ALTER TABLE ONLY dam.asset_character_source_edge
    ADD CONSTRAINT asset_character_source_edge_character_id_fkey FOREIGN KEY (character_id) REFERENCES core."character"(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_character_source_edge asset_character_source_edge_licensor_id_fkey
ALTER TABLE ONLY dam.asset_character_source_edge
    ADD CONSTRAINT asset_character_source_edge_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_franchise asset_franchise_asset_id_fkey
ALTER TABLE ONLY dam.asset_franchise
    ADD CONSTRAINT asset_franchise_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_franchise asset_franchise_franchise_id_fkey
ALTER TABLE ONLY dam.asset_franchise
    ADD CONSTRAINT asset_franchise_franchise_id_fkey FOREIGN KEY (franchise_id) REFERENCES core.franchise(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_franchise_source_edge asset_franchise_source_edge_asset_id_fkey
ALTER TABLE ONLY dam.asset_franchise_source_edge
    ADD CONSTRAINT asset_franchise_source_edge_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_franchise_source_edge asset_franchise_source_edge_franchise_id_fkey
ALTER TABLE ONLY dam.asset_franchise_source_edge
    ADD CONSTRAINT asset_franchise_source_edge_franchise_id_fkey FOREIGN KEY (franchise_id) REFERENCES core.franchise(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_franchise_source_edge asset_franchise_source_edge_licensor_id_fkey
ALTER TABLE ONLY dam.asset_franchise_source_edge
    ADD CONSTRAINT asset_franchise_source_edge_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_property asset_property_asset_id_fkey
ALTER TABLE ONLY dam.asset_property
    ADD CONSTRAINT asset_property_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_property asset_property_property_id_fkey
ALTER TABLE ONLY dam.asset_property
    ADD CONSTRAINT asset_property_property_id_fkey FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_property_source_edge asset_property_source_edge_asset_id_fkey
ALTER TABLE ONLY dam.asset_property_source_edge
    ADD CONSTRAINT asset_property_source_edge_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_property_source_edge asset_property_source_edge_licensor_id_fkey
ALTER TABLE ONLY dam.asset_property_source_edge
    ADD CONSTRAINT asset_property_source_edge_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_property_source_edge asset_property_source_edge_property_id_fkey
ALTER TABLE ONLY dam.asset_property_source_edge
    ADD CONSTRAINT asset_property_source_edge_property_id_fkey FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_style_guide asset_style_guide_asset_id_fkey
ALTER TABLE ONLY dam.asset_style_guide
    ADD CONSTRAINT asset_style_guide_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_style_guide_source_edge asset_style_guide_source_edge_asset_id_fkey
ALTER TABLE ONLY dam.asset_style_guide_source_edge
    ADD CONSTRAINT asset_style_guide_source_edge_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES dam.asset(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_style_guide_source_edge asset_style_guide_source_edge_licensor_id_fkey
ALTER TABLE ONLY dam.asset_style_guide_source_edge
    ADD CONSTRAINT asset_style_guide_source_edge_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;

-- FK CONSTRAINT dam.asset_style_guide_source_edge asset_style_guide_source_edge_style_guide_id_fkey
ALTER TABLE ONLY dam.asset_style_guide_source_edge
    ADD CONSTRAINT asset_style_guide_source_edge_style_guide_id_fkey FOREIGN KEY (style_guide_id) REFERENCES core.style_guide(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- FK CONSTRAINT dam.asset_style_guide asset_style_guide_style_guide_id_fkey
ALTER TABLE ONLY dam.asset_style_guide
    ADD CONSTRAINT asset_style_guide_style_guide_id_fkey FOREIGN KEY (style_guide_id) REFERENCES core.style_guide(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- FK CONSTRAINT dam.dam_asset_image_vectors dam_asset_image_vectors_asset_fkey
ALTER TABLE ONLY dam.dam_asset_image_vectors
    ADD CONSTRAINT dam_asset_image_vectors_asset_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;

-- FK CONSTRAINT dam.image_embed_jobs image_embed_jobs_asset_fkey
ALTER TABLE ONLY dam.image_embed_jobs
    ADD CONSTRAINT image_embed_jobs_asset_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;

-- FK CONSTRAINT dam.order_tracking_ext order_tracking_ext_order_id_fkey
ALTER TABLE ONLY dam.order_tracking_ext
    ADD CONSTRAINT order_tracking_ext_order_id_fkey FOREIGN KEY (order_id) REFERENCES plm.production_order(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_authorities hts_rag_authorities_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_authorities
    ADD CONSTRAINT hts_rag_authorities_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_broker_opinions hts_rag_broker_opinions_determination_fkey
ALTER TABLE ONLY hts_rag.hts_rag_broker_opinions
    ADD CONSTRAINT hts_rag_broker_opinions_determination_fkey FOREIGN KEY (determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_broker_opinions hts_rag_broker_opinions_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_broker_opinions
    ADD CONSTRAINT hts_rag_broker_opinions_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_classification_jobs hts_rag_classification_jobs_determination_fkey
ALTER TABLE ONLY hts_rag.hts_rag_classification_jobs
    ADD CONSTRAINT hts_rag_classification_jobs_determination_fkey FOREIGN KEY (determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_classification_tests hts_rag_classification_tests_anchor_fkey
ALTER TABLE ONLY hts_rag.hts_rag_classification_tests
    ADD CONSTRAINT hts_rag_classification_tests_anchor_fkey FOREIGN KEY (anchor_authority_id) REFERENCES hts_rag.hts_rag_authorities(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_classification_tests hts_rag_classification_tests_merged_fkey
ALTER TABLE ONLY hts_rag.hts_rag_classification_tests
    ADD CONSTRAINT hts_rag_classification_tests_merged_fkey FOREIGN KEY (merged_into) REFERENCES hts_rag.hts_rag_classification_tests(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_counterfactuals hts_rag_counterfactuals_extraction_fkey
ALTER TABLE ONLY hts_rag.hts_rag_counterfactuals
    ADD CONSTRAINT hts_rag_counterfactuals_extraction_fkey FOREIGN KEY (extraction_id) REFERENCES hts_rag.hts_rag_extractions(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_counterfactuals hts_rag_counterfactuals_key_fkey
ALTER TABLE ONLY hts_rag.hts_rag_counterfactuals
    ADD CONSTRAINT hts_rag_counterfactuals_key_fkey FOREIGN KEY (attribute_key) REFERENCES hts_rag.hts_rag_attribute_keys(key) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_counterfactuals hts_rag_counterfactuals_product_fkey
ALTER TABLE ONLY hts_rag.hts_rag_counterfactuals
    ADD CONSTRAINT hts_rag_counterfactuals_product_fkey FOREIGN KEY (product_id) REFERENCES hts_rag.hts_rag_ruling_products(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_debate_runs hts_rag_debate_runs_precedent_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_precedent_id_fkey FOREIGN KEY (precedent_id) REFERENCES hts_rag.hts_rag_precedents(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_debate_runs hts_rag_debate_runs_source_determination_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_source_determination_id_fkey FOREIGN KEY (source_determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_decision_authorities hts_rag_decision_authorities_authority_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_authorities
    ADD CONSTRAINT hts_rag_decision_authorities_authority_fkey FOREIGN KEY (authority_id) REFERENCES hts_rag.hts_rag_authorities(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_decision_authorities hts_rag_decision_authorities_decision_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_authorities
    ADD CONSTRAINT hts_rag_decision_authorities_decision_fkey FOREIGN KEY (decision_id) REFERENCES hts_rag.hts_rag_heading_decisions(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_decision_facts hts_rag_decision_facts_attribute_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_facts
    ADD CONSTRAINT hts_rag_decision_facts_attribute_fkey FOREIGN KEY (attribute_id) REFERENCES hts_rag.hts_rag_product_attributes(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_decision_facts hts_rag_decision_facts_key_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_facts
    ADD CONSTRAINT hts_rag_decision_facts_key_fkey FOREIGN KEY (attribute_key) REFERENCES hts_rag.hts_rag_attribute_keys(key) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_decision_facts hts_rag_decision_facts_test_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_facts
    ADD CONSTRAINT hts_rag_decision_facts_test_fkey FOREIGN KEY (decision_test_id) REFERENCES hts_rag.hts_rag_decision_tests(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_decision_tests hts_rag_decision_tests_decision_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_tests
    ADD CONSTRAINT hts_rag_decision_tests_decision_fkey FOREIGN KEY (decision_id) REFERENCES hts_rag.hts_rag_heading_decisions(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_decision_tests hts_rag_decision_tests_extraction_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_tests
    ADD CONSTRAINT hts_rag_decision_tests_extraction_fkey FOREIGN KEY (extraction_id) REFERENCES hts_rag.hts_rag_extractions(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_decision_tests hts_rag_decision_tests_test_fkey
ALTER TABLE ONLY hts_rag.hts_rag_decision_tests
    ADD CONSTRAINT hts_rag_decision_tests_test_fkey FOREIGN KEY (test_id) REFERENCES hts_rag.hts_rag_classification_tests(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_determinations hts_rag_determinations_precedent_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_determinations
    ADD CONSTRAINT hts_rag_determinations_precedent_id_fkey FOREIGN KEY (precedent_id) REFERENCES hts_rag.hts_rag_precedents(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_determinations hts_rag_determinations_product_example_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_determinations
    ADD CONSTRAINT hts_rag_determinations_product_example_id_fkey FOREIGN KEY (product_example_id) REFERENCES hts_rag.hts_rag_product_examples(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_extraction_jobs hts_rag_extraction_jobs_product_example_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_extraction_jobs
    ADD CONSTRAINT hts_rag_extraction_jobs_product_example_id_fkey FOREIGN KEY (product_example_id) REFERENCES hts_rag.hts_rag_product_examples(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_extractions hts_rag_extractions_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_extractions
    ADD CONSTRAINT hts_rag_extractions_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_heading_decisions hts_rag_heading_decisions_extraction_fkey
ALTER TABLE ONLY hts_rag.hts_rag_heading_decisions
    ADD CONSTRAINT hts_rag_heading_decisions_extraction_fkey FOREIGN KEY (extraction_id) REFERENCES hts_rag.hts_rag_extractions(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_heading_decisions hts_rag_heading_decisions_product_fkey
ALTER TABLE ONLY hts_rag.hts_rag_heading_decisions
    ADD CONSTRAINT hts_rag_heading_decisions_product_fkey FOREIGN KEY (product_id) REFERENCES hts_rag.hts_rag_ruling_products(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_precedent_rulings hts_rag_precedent_rulings_precedent_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_precedent_rulings
    ADD CONSTRAINT hts_rag_precedent_rulings_precedent_id_fkey FOREIGN KEY (precedent_id) REFERENCES hts_rag.hts_rag_precedents(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_precedent_rulings hts_rag_precedent_rulings_ruling_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_precedent_rulings
    ADD CONSTRAINT hts_rag_precedent_rulings_ruling_id_fkey FOREIGN KEY (ruling_id) REFERENCES hts_rag.hts_rag_rulings(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_precedents hts_rag_precedents_promotion_debate_run_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_precedents
    ADD CONSTRAINT hts_rag_precedents_promotion_debate_run_id_fkey FOREIGN KEY (promotion_debate_run_id) REFERENCES hts_rag.hts_rag_debate_runs(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_precedents hts_rag_precedents_promotion_source_determination_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_precedents
    ADD CONSTRAINT hts_rag_precedents_promotion_source_determination_id_fkey FOREIGN KEY (promotion_source_determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_product_attributes hts_rag_product_attributes_key_fkey
ALTER TABLE ONLY hts_rag.hts_rag_product_attributes
    ADD CONSTRAINT hts_rag_product_attributes_key_fkey FOREIGN KEY (key) REFERENCES hts_rag.hts_rag_attribute_keys(key) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_product_attributes hts_rag_product_attributes_product_fkey
ALTER TABLE ONLY hts_rag.hts_rag_product_attributes
    ADD CONSTRAINT hts_rag_product_attributes_product_fkey FOREIGN KEY (product_id) REFERENCES hts_rag.hts_rag_ruling_products(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_product_components hts_rag_product_components_product_fkey
ALTER TABLE ONLY hts_rag.hts_rag_product_components
    ADD CONSTRAINT hts_rag_product_components_product_fkey FOREIGN KEY (product_id) REFERENCES hts_rag.hts_rag_ruling_products(id) ON DELETE CASCADE;

-- FK CONSTRAINT hts_rag.hts_rag_provider_responses hts_rag_provider_responses_determination_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_provider_responses
    ADD CONSTRAINT hts_rag_provider_responses_determination_id_fkey FOREIGN KEY (determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_provider_responses hts_rag_provider_responses_extraction_job_id_fkey
ALTER TABLE ONLY hts_rag.hts_rag_provider_responses
    ADD CONSTRAINT hts_rag_provider_responses_extraction_job_id_fkey FOREIGN KEY (extraction_job_id) REFERENCES hts_rag.hts_rag_extraction_jobs(id) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_codes hts_rag_ruling_codes_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_codes
    ADD CONSTRAINT hts_rag_ruling_codes_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_current_codes hts_rag_ruling_current_codes_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_current_codes
    ADD CONSTRAINT hts_rag_ruling_current_codes_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_ingest_jobs hts_rag_ruling_ingest_jobs_source_determination_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_ingest_jobs
    ADD CONSTRAINT hts_rag_ruling_ingest_jobs_source_determination_fkey FOREIGN KEY (source_determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_links hts_rag_ruling_links_from_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_links
    ADD CONSTRAINT hts_rag_ruling_links_from_fkey FOREIGN KEY (from_ruling) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_passb hts_rag_ruling_passb_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_passb
    ADD CONSTRAINT hts_rag_ruling_passb_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_products hts_rag_ruling_products_article_type_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_products
    ADD CONSTRAINT hts_rag_ruling_products_article_type_fkey FOREIGN KEY (article_type_id) REFERENCES hts_rag.hts_rag_article_types(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_products hts_rag_ruling_products_extraction_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_products
    ADD CONSTRAINT hts_rag_ruling_products_extraction_fkey FOREIGN KEY (extraction_id) REFERENCES hts_rag.hts_rag_extractions(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_products hts_rag_ruling_products_material_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_products
    ADD CONSTRAINT hts_rag_ruling_products_material_fkey FOREIGN KEY (primary_material_id) REFERENCES hts_rag.hts_rag_materials(id) ON DELETE SET NULL;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_products hts_rag_ruling_products_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_products
    ADD CONSTRAINT hts_rag_ruling_products_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_scope_labels hts_rag_ruling_scope_labels_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_scope_labels
    ADD CONSTRAINT hts_rag_ruling_scope_labels_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_ruling_sentences hts_rag_ruling_sentences_ruling_fkey
ALTER TABLE ONLY hts_rag.hts_rag_ruling_sentences
    ADD CONSTRAINT hts_rag_ruling_sentences_ruling_fkey FOREIGN KEY (ruling_number) REFERENCES hts_rag.hts_rag_rulings(ruling_number) ON DELETE RESTRICT;

-- FK CONSTRAINT hts_rag.hts_rag_test_aliases hts_rag_test_aliases_test_fkey
ALTER TABLE ONLY hts_rag.hts_rag_test_aliases
    ADD CONSTRAINT hts_rag_test_aliases_test_fkey FOREIGN KEY (test_id) REFERENCES hts_rag.hts_rag_classification_tests(id) ON DELETE RESTRICT;

-- FK CONSTRAINT public.asset_licensor_characters asset_licensor_characters_asset_id_fkey
ALTER TABLE ONLY public.asset_licensor_characters
    ADD CONSTRAINT asset_licensor_characters_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;

-- FK CONSTRAINT public.asset_licensor_characters asset_licensor_characters_character_id_fkey
ALTER TABLE ONLY public.asset_licensor_characters
    ADD CONSTRAINT asset_licensor_characters_character_id_fkey FOREIGN KEY (character_id) REFERENCES core."character"(id) ON DELETE CASCADE;

-- FK CONSTRAINT public.hts_rag_debate_runs hts_rag_debate_runs_precedent_id_fkey
ALTER TABLE ONLY public.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_precedent_id_fkey FOREIGN KEY (precedent_id) REFERENCES public.hts_rag_precedents(id) ON DELETE RESTRICT;

-- FK CONSTRAINT public.hts_rag_debate_runs hts_rag_debate_runs_source_determination_id_fkey
ALTER TABLE ONLY public.hts_rag_debate_runs
    ADD CONSTRAINT hts_rag_debate_runs_source_determination_id_fkey FOREIGN KEY (source_determination_id) REFERENCES public.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT public.hts_rag_precedents hts_rag_precedents_promotion_debate_run_id_fkey
ALTER TABLE ONLY public.hts_rag_precedents
    ADD CONSTRAINT hts_rag_precedents_promotion_debate_run_id_fkey FOREIGN KEY (promotion_debate_run_id) REFERENCES public.hts_rag_debate_runs(id) ON DELETE RESTRICT;

-- FK CONSTRAINT public.hts_rag_precedents hts_rag_precedents_promotion_source_determination_id_fkey
ALTER TABLE ONLY public.hts_rag_precedents
    ADD CONSTRAINT hts_rag_precedents_promotion_source_determination_id_fkey FOREIGN KEY (promotion_source_determination_id) REFERENCES public.hts_rag_determinations(id) ON DELETE RESTRICT;

-- FK CONSTRAINT public.popdam_item_state popdam_item_state_item_id_fkey
ALTER TABLE ONLY public.popdam_item_state
    ADD CONSTRAINT popdam_item_state_item_id_fkey FOREIGN KEY (item_id) REFERENCES plm.item(id) ON DELETE RESTRICT;

-- FK CONSTRAINT public.product_category_predictions product_category_predictions_plm_item_id_fkey
ALTER TABLE ONLY public.product_category_predictions
    ADD CONSTRAINT product_category_predictions_plm_item_id_fkey FOREIGN KEY (plm_item_id) REFERENCES plm.item(id) ON DELETE SET NULL;

-- FK CONSTRAINT public.sku_style_guide_links sku_style_guide_links_core_style_guide_id_fkey
ALTER TABLE ONLY public.sku_style_guide_links
    ADD CONSTRAINT sku_style_guide_links_core_style_guide_id_fkey FOREIGN KEY (core_style_guide_id) REFERENCES core.style_guide(id) ON DELETE SET NULL;

-- FK CONSTRAINT public.style_guide_file_crawl_seen style_guide_file_crawl_seen_style_guide_file_id_fkey
ALTER TABLE ONLY public.style_guide_file_crawl_seen
    ADD CONSTRAINT style_guide_file_crawl_seen_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES public.style_guide_files(id) ON DELETE CASCADE;

-- FK CONSTRAINT public.style_guide_file_preview_state style_guide_file_preview_state_style_guide_file_id_fkey
ALTER TABLE ONLY public.style_guide_file_preview_state
    ADD CONSTRAINT style_guide_file_preview_state_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES public.style_guide_files(id) ON DELETE CASCADE;

-- FK CONSTRAINT public.style_guide_pdf_text style_guide_pdf_text_style_guide_file_id_fkey
ALTER TABLE ONLY public.style_guide_pdf_text
    ADD CONSTRAINT style_guide_pdf_text_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES public.style_guide_files(id) ON DELETE CASCADE;

-- FK CONSTRAINT public.style_guide_search_documents style_guide_search_documents_style_guide_file_id_fkey
ALTER TABLE ONLY public.style_guide_search_documents
    ADD CONSTRAINT style_guide_search_documents_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES public.style_guide_files(id) ON DELETE CASCADE;

-- FK CONSTRAINT public.style_guide_search_embedding_jobs style_guide_search_embedding_jobs_style_guide_file_id_fkey
ALTER TABLE ONLY public.style_guide_search_embedding_jobs
    ADD CONSTRAINT style_guide_search_embedding_jobs_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES public.style_guide_search_documents(style_guide_file_id) ON DELETE CASCADE;

-- POLICY archive.erp_items_current Admin manage erp_items_current
CREATE POLICY "Admin manage erp_items_current" ON archive.erp_items_current TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- POLICY archive.erp_items_raw Admin manage erp_items_raw
CREATE POLICY "Admin manage erp_items_raw" ON archive.erp_items_raw TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ROW SECURITY archive.character_child_grogu_links_20261104
ALTER TABLE archive.character_child_grogu_links_20261104 ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY archive.dc_hp_wb_repoint_20261101
ALTER TABLE archive.dc_hp_wb_repoint_20261101 ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY archive.erp_items_current
ALTER TABLE archive.erp_items_current ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY archive.erp_items_raw
ALTER TABLE archive.erp_items_raw ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_character_source_edge
ALTER TABLE dam.asset_character_source_edge ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_franchise
ALTER TABLE dam.asset_franchise ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_franchise_source_edge
ALTER TABLE dam.asset_franchise_source_edge ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_property
ALTER TABLE dam.asset_property ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_property_source_edge
ALTER TABLE dam.asset_property_source_edge ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_style_guide
ALTER TABLE dam.asset_style_guide ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.asset_style_guide_source_edge
ALTER TABLE dam.asset_style_guide_source_edge ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.dam_asset_image_vectors
ALTER TABLE dam.dam_asset_image_vectors ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.folder_rename_log
ALTER TABLE dam.folder_rename_log ENABLE ROW LEVEL SECURITY;

-- POLICY dam.folder_rename_log folder_rename_log_admin_read
CREATE POLICY folder_rename_log_admin_read ON dam.folder_rename_log FOR SELECT TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));

-- ROW SECURITY dam.image_embed_jobs
ALTER TABLE dam.image_embed_jobs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.image_embed_worker_heartbeat
ALTER TABLE dam.image_embed_worker_heartbeat ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.order_buy_sheet_import
ALTER TABLE dam.order_buy_sheet_import ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY dam.order_tracking_ext
ALTER TABLE dam.order_tracking_ext ENABLE ROW LEVEL SECURITY;

-- POLICY dam.order_tracking_ext order_tracking_ext_read
CREATE POLICY order_tracking_ext_read ON dam.order_tracking_ext FOR SELECT TO authenticated USING (true);

-- POLICY dam.order_tracking_ext order_tracking_ext_write
CREATE POLICY order_tracking_ext_write ON dam.order_tracking_ext TO authenticated USING (app.has_role('administrator'::app.app_role)) WITH CHECK (app.has_role('administrator'::app.app_role));

-- ROW SECURITY dam.orderlist_customer_settings
ALTER TABLE dam.orderlist_customer_settings ENABLE ROW LEVEL SECURITY;

-- POLICY dam.orderlist_customer_settings orderlist_customer_settings_read
CREATE POLICY orderlist_customer_settings_read ON dam.orderlist_customer_settings FOR SELECT TO authenticated USING (true);

-- POLICY dam.orderlist_customer_settings orderlist_customer_settings_write
CREATE POLICY orderlist_customer_settings_write ON dam.orderlist_customer_settings TO authenticated USING (app.has_role('administrator'::app.app_role)) WITH CHECK (app.has_role('administrator'::app.app_role));

-- ROW SECURITY dam.orderlist_sample_depth
ALTER TABLE dam.orderlist_sample_depth ENABLE ROW LEVEL SECURITY;

-- POLICY dam.orderlist_sample_depth orderlist_sample_depth_read
CREATE POLICY orderlist_sample_depth_read ON dam.orderlist_sample_depth FOR SELECT TO authenticated USING (true);

-- POLICY dam.orderlist_sample_depth orderlist_sample_depth_write
CREATE POLICY orderlist_sample_depth_write ON dam.orderlist_sample_depth TO authenticated USING (app.has_role('administrator'::app.app_role)) WITH CHECK (app.has_role('administrator'::app.app_role));

-- ROW SECURITY dam.search_group_vectors
ALTER TABLE dam.search_group_vectors ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_article_types
ALTER TABLE hts_rag.hts_rag_article_types ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_attribute_keys
ALTER TABLE hts_rag.hts_rag_attribute_keys ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_authorities
ALTER TABLE hts_rag.hts_rag_authorities ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_broker_opinions
ALTER TABLE hts_rag.hts_rag_broker_opinions ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_classification_jobs
ALTER TABLE hts_rag.hts_rag_classification_jobs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_classification_tests
ALTER TABLE hts_rag.hts_rag_classification_tests ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_counterfactuals
ALTER TABLE hts_rag.hts_rag_counterfactuals ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_debate_runs
ALTER TABLE hts_rag.hts_rag_debate_runs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_decision_authorities
ALTER TABLE hts_rag.hts_rag_decision_authorities ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_decision_facts
ALTER TABLE hts_rag.hts_rag_decision_facts ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_decision_tests
ALTER TABLE hts_rag.hts_rag_decision_tests ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_determinations
ALTER TABLE hts_rag.hts_rag_determinations ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_extraction_jobs
ALTER TABLE hts_rag.hts_rag_extraction_jobs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_extractions
ALTER TABLE hts_rag.hts_rag_extractions ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_heading_decisions
ALTER TABLE hts_rag.hts_rag_heading_decisions ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_hts_codes
ALTER TABLE hts_rag.hts_rag_hts_codes ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_hts_renumbering
ALTER TABLE hts_rag.hts_rag_hts_renumbering ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_materials
ALTER TABLE hts_rag.hts_rag_materials ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_precedent_rulings
ALTER TABLE hts_rag.hts_rag_precedent_rulings ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_precedents
ALTER TABLE hts_rag.hts_rag_precedents ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_product_attributes
ALTER TABLE hts_rag.hts_rag_product_attributes ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_product_components
ALTER TABLE hts_rag.hts_rag_product_components ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_product_examples
ALTER TABLE hts_rag.hts_rag_product_examples ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_product_family_allowlist
ALTER TABLE hts_rag.hts_rag_product_family_allowlist ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_provider_responses
ALTER TABLE hts_rag.hts_rag_provider_responses ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_review_events
ALTER TABLE hts_rag.hts_rag_review_events ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_codes
ALTER TABLE hts_rag.hts_rag_ruling_codes ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_current_codes
ALTER TABLE hts_rag.hts_rag_ruling_current_codes ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_ingest_jobs
ALTER TABLE hts_rag.hts_rag_ruling_ingest_jobs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_links
ALTER TABLE hts_rag.hts_rag_ruling_links ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_passb
ALTER TABLE hts_rag.hts_rag_ruling_passb ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_products
ALTER TABLE hts_rag.hts_rag_ruling_products ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_scope_labels
ALTER TABLE hts_rag.hts_rag_ruling_scope_labels ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_ruling_sentences
ALTER TABLE hts_rag.hts_rag_ruling_sentences ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_rulings
ALTER TABLE hts_rag.hts_rag_rulings ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.hts_rag_test_aliases
ALTER TABLE hts_rag.hts_rag_test_aliases ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY hts_rag.item_classification_fact
ALTER TABLE hts_rag.item_classification_fact ENABLE ROW LEVEL SECURITY;

-- POLICY public.admin_config Admin delete admin_config
DROP POLICY IF EXISTS "Admin delete admin_config" ON public.admin_config;
CREATE POLICY "Admin delete admin_config" ON public.admin_config FOR DELETE TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.agent_pairings Admin manage agent_pairings
DROP POLICY IF EXISTS "Admin manage agent_pairings" ON public.agent_pairings;
CREATE POLICY "Admin manage agent_pairings" ON public.agent_pairings USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.agent_registrations Admin manage agent_registrations
DROP POLICY IF EXISTS "Admin manage agent_registrations" ON public.agent_registrations;
CREATE POLICY "Admin manage agent_registrations" ON public.agent_registrations TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.ai_tag_bakeoff_results Admin manage ai tag bakeoff results
DROP POLICY IF EXISTS "Admin manage ai tag bakeoff results" ON public.ai_tag_bakeoff_results;
CREATE POLICY "Admin manage ai tag bakeoff results" ON public.ai_tag_bakeoff_results USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.ai_tag_bakeoff_reviews Admin manage ai tag bakeoff reviews
DROP POLICY IF EXISTS "Admin manage ai tag bakeoff reviews" ON public.ai_tag_bakeoff_reviews;
CREATE POLICY "Admin manage ai tag bakeoff reviews" ON public.ai_tag_bakeoff_reviews USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.ai_tag_bakeoff_runs Admin manage ai tag bakeoff runs
DROP POLICY IF EXISTS "Admin manage ai tag bakeoff runs" ON public.ai_tag_bakeoff_runs;
CREATE POLICY "Admin manage ai tag bakeoff runs" ON public.ai_tag_bakeoff_runs USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.asset_tags Admin manage asset_tags
DROP POLICY IF EXISTS "Admin manage asset_tags" ON public.asset_tags;
CREATE POLICY "Admin manage asset_tags" ON public.asset_tags TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.erp_enrichment_log Admin manage erp_enrichment_log
DROP POLICY IF EXISTS "Admin manage erp_enrichment_log" ON public.erp_enrichment_log;
CREATE POLICY "Admin manage erp_enrichment_log" ON public.erp_enrichment_log TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.erp_sync_runs Admin manage erp_sync_runs
DROP POLICY IF EXISTS "Admin manage erp_sync_runs" ON public.erp_sync_runs;
CREATE POLICY "Admin manage erp_sync_runs" ON public.erp_sync_runs TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.hygiene_findings Admin manage hygiene_findings
DROP POLICY IF EXISTS "Admin manage hygiene_findings" ON public.hygiene_findings;
CREATE POLICY "Admin manage hygiene_findings" ON public.hygiene_findings TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.invitations Admin manage invitations
DROP POLICY IF EXISTS "Admin manage invitations" ON public.invitations;
CREATE POLICY "Admin manage invitations" ON public.invitations TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.processing_queue Admin manage processing_queue
DROP POLICY IF EXISTS "Admin manage processing_queue" ON public.processing_queue;
CREATE POLICY "Admin manage processing_queue" ON public.processing_queue TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.product_category_predictions Admin manage product_category_predictions
DROP POLICY IF EXISTS "Admin manage product_category_predictions" ON public.product_category_predictions;
CREATE POLICY "Admin manage product_category_predictions" ON public.product_category_predictions TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.render_queue Admin manage render_queue
DROP POLICY IF EXISTS "Admin manage render_queue" ON public.render_queue;
CREATE POLICY "Admin manage render_queue" ON public.render_queue TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.style_group_tags Admin manage style_group_tags
DROP POLICY IF EXISTS "Admin manage style_group_tags" ON public.style_group_tags;
CREATE POLICY "Admin manage style_group_tags" ON public.style_group_tags TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.style_guide_render_queue Admin manage style_guide_render_queue
DROP POLICY IF EXISTS "Admin manage style_guide_render_queue" ON public.style_guide_render_queue;
CREATE POLICY "Admin manage style_guide_render_queue" ON public.style_guide_render_queue TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.tiff_optimization_queue Admin manage tiff_optimization_queue
DROP POLICY IF EXISTS "Admin manage tiff_optimization_queue" ON public.tiff_optimization_queue;
CREATE POLICY "Admin manage tiff_optimization_queue" ON public.tiff_optimization_queue USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.ai_tag_bakeoff_results Admin read ai tag bakeoff results
DROP POLICY IF EXISTS "Admin read ai tag bakeoff results" ON public.ai_tag_bakeoff_results;
CREATE POLICY "Admin read ai tag bakeoff results" ON public.ai_tag_bakeoff_results FOR SELECT USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.ai_tag_bakeoff_reviews Admin read ai tag bakeoff reviews
DROP POLICY IF EXISTS "Admin read ai tag bakeoff reviews" ON public.ai_tag_bakeoff_reviews;
CREATE POLICY "Admin read ai tag bakeoff reviews" ON public.ai_tag_bakeoff_reviews FOR SELECT USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.ai_tag_bakeoff_runs Admin read ai tag bakeoff runs
DROP POLICY IF EXISTS "Admin read ai tag bakeoff runs" ON public.ai_tag_bakeoff_runs;
CREATE POLICY "Admin read ai tag bakeoff runs" ON public.ai_tag_bakeoff_runs FOR SELECT USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.admin_config Admin read all admin_config
DROP POLICY IF EXISTS "Admin read all admin_config" ON public.admin_config;
CREATE POLICY "Admin read all admin_config" ON public.admin_config FOR SELECT TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.admin_config Admin update admin_config
DROP POLICY IF EXISTS "Admin update admin_config" ON public.admin_config;
CREATE POLICY "Admin update admin_config" ON public.admin_config FOR UPDATE TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.admin_config Admin write admin_config
DROP POLICY IF EXISTS "Admin write admin_config" ON public.admin_config;
CREATE POLICY "Admin write admin_config" ON public.admin_config FOR INSERT TO authenticated WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.asset_characters Admin write asset_characters
DROP POLICY IF EXISTS "Admin write asset_characters" ON public.asset_characters;
CREATE POLICY "Admin write asset_characters" ON public.asset_characters TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.asset_licensor_characters Admin write asset_licensor_characters
CREATE POLICY "Admin write asset_licensor_characters" ON public.asset_licensor_characters TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.characters Admin write characters
DROP POLICY IF EXISTS "Admin write characters" ON public.characters;
CREATE POLICY "Admin write characters" ON public.characters TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.licensors Admin write licensors
DROP POLICY IF EXISTS "Admin write licensors" ON public.licensors;
CREATE POLICY "Admin write licensors" ON public.licensors TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.product_categories Admin write product_categories
DROP POLICY IF EXISTS "Admin write product_categories" ON public.product_categories;
CREATE POLICY "Admin write product_categories" ON public.product_categories TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.product_subtypes Admin write product_subtypes
DROP POLICY IF EXISTS "Admin write product_subtypes" ON public.product_subtypes;
CREATE POLICY "Admin write product_subtypes" ON public.product_subtypes TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.product_types Admin write product_types
DROP POLICY IF EXISTS "Admin write product_types" ON public.product_types;
CREATE POLICY "Admin write product_types" ON public.product_types TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.properties Admin write properties
DROP POLICY IF EXISTS "Admin write properties" ON public.properties;
CREATE POLICY "Admin write properties" ON public.properties TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.bulk_operation_runs Administrator read bulk_operation_runs
CREATE POLICY "Administrator read bulk_operation_runs" ON public.bulk_operation_runs FOR SELECT TO authenticated USING (app.has_any_role(ARRAY['administrator'::app.app_role]));

-- POLICY public.assets Admins can insert assets
DROP POLICY IF EXISTS "Admins can insert assets" ON public.assets;
CREATE POLICY "Admins can insert assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.style_groups Admins can manage style_groups
DROP POLICY IF EXISTS "Admins can manage style_groups" ON public.style_groups;
CREATE POLICY "Admins can manage style_groups" ON public.style_groups USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.assets Admins can update assets
DROP POLICY IF EXISTS "Admins can update assets" ON public.assets;
CREATE POLICY "Admins can update assets" ON public.assets FOR UPDATE TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.style_tracker_rows Admins delete style tracker rows
DROP POLICY IF EXISTS "Admins delete style tracker rows" ON public.style_tracker_rows;
CREATE POLICY "Admins delete style tracker rows" ON public.style_tracker_rows FOR DELETE TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.app_access Admins manage app_access
DROP POLICY IF EXISTS "Admins manage app_access" ON public.app_access;
CREATE POLICY "Admins manage app_access" ON public.app_access TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.prod_order_headers_current Admins manage prod_order_headers_current
DROP POLICY IF EXISTS "Admins manage prod_order_headers_current" ON public.prod_order_headers_current;
CREATE POLICY "Admins manage prod_order_headers_current" ON public.prod_order_headers_current USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.prod_order_headers_raw Admins manage prod_order_headers_raw
DROP POLICY IF EXISTS "Admins manage prod_order_headers_raw" ON public.prod_order_headers_raw;
CREATE POLICY "Admins manage prod_order_headers_raw" ON public.prod_order_headers_raw USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.prod_order_sync_runs Admins manage prod_order_sync_runs
DROP POLICY IF EXISTS "Admins manage prod_order_sync_runs" ON public.prod_order_sync_runs;
CREATE POLICY "Admins manage prod_order_sync_runs" ON public.prod_order_sync_runs USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role)) WITH CHECK (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.user_roles Admins manage user_roles
DROP POLICY IF EXISTS "Admins manage user_roles" ON public.user_roles;
CREATE POLICY "Admins manage user_roles" ON public.user_roles TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.profiles Admins read all profiles
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.asset_licensor_characters Authenticated read asset_licensor_characters
CREATE POLICY "Authenticated read asset_licensor_characters" ON public.asset_licensor_characters FOR SELECT TO authenticated USING (true);

-- POLICY public.style_tracker_user_views Users insert their own style tracker views
DROP POLICY IF EXISTS "Users insert their own style tracker views" ON public.style_tracker_user_views;
CREATE POLICY "Users insert their own style tracker views" ON public.style_tracker_user_views FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.app_access Users read own app_access
DROP POLICY IF EXISTS "Users read own app_access" ON public.app_access;
CREATE POLICY "Users read own app_access" ON public.app_access FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.profiles Users read own profile
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.style_tracker_user_views Users read their own style tracker views
DROP POLICY IF EXISTS "Users read their own style tracker views" ON public.style_tracker_user_views;
CREATE POLICY "Users read their own style tracker views" ON public.style_tracker_user_views FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.profiles Users update own profile
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.style_tracker_user_views Users update their own style tracker views
DROP POLICY IF EXISTS "Users update their own style tracker views" ON public.style_tracker_user_views;
CREATE POLICY "Users update their own style tracker views" ON public.style_tracker_user_views FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.pdf_text_samples admin full access pdf_text_samples
DROP POLICY IF EXISTS "admin full access pdf_text_samples" ON public.pdf_text_samples;
CREATE POLICY "admin full access pdf_text_samples" ON public.pdf_text_samples TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.style_guide_crawl_runs admin full access style_guide_crawl_runs
DROP POLICY IF EXISTS "admin full access style_guide_crawl_runs" ON public.style_guide_crawl_runs;
CREATE POLICY "admin full access style_guide_crawl_runs" ON public.style_guide_crawl_runs TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- POLICY public.style_guide_files admin full access style_guide_files
DROP POLICY IF EXISTS "admin full access style_guide_files" ON public.style_guide_files;
CREATE POLICY "admin full access style_guide_files" ON public.style_guide_files TO authenticated USING (( SELECT public.has_role(auth.uid(), 'admin'::public.app_role) AS has_role));

-- ROW SECURITY public.asset_designer_sheet_backup
ALTER TABLE public.asset_designer_sheet_backup ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.asset_licensor_characters
ALTER TABLE public.asset_licensor_characters ENABLE ROW LEVEL SECURITY;

-- POLICY public.sku_style_guide_links authenticated read
CREATE POLICY "authenticated read" ON public.sku_style_guide_links FOR SELECT TO authenticated USING (true);

-- POLICY public.style_guide_pdf_text authenticated read style_guide_pdf_text
CREATE POLICY "authenticated read style_guide_pdf_text" ON public.style_guide_pdf_text FOR SELECT TO authenticated USING (true);

-- POLICY public.style_guide_search_documents authenticated read style_guide_search_documents
CREATE POLICY "authenticated read style_guide_search_documents" ON public.style_guide_search_documents FOR SELECT TO authenticated USING (true);

-- ROW SECURITY public.bulk_operation_runs
ALTER TABLE public.bulk_operation_runs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.dam_search_keys
ALTER TABLE public.dam_search_keys ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.hts_rag_debate_runs
ALTER TABLE public.hts_rag_debate_runs ENABLE ROW LEVEL SECURITY;

-- POLICY public.hts_rag_debate_runs hts_rag_debate_runs_backend_insert
CREATE POLICY hts_rag_debate_runs_backend_insert ON public.hts_rag_debate_runs FOR INSERT TO service_role WITH CHECK (true);

-- POLICY public.hts_rag_debate_runs hts_rag_debate_runs_backend_read
CREATE POLICY hts_rag_debate_runs_backend_read ON public.hts_rag_debate_runs FOR SELECT TO service_role USING (true);

-- POLICY public.hts_rag_debate_runs hts_rag_debate_runs_backend_update
CREATE POLICY hts_rag_debate_runs_backend_update ON public.hts_rag_debate_runs FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- ROW SECURITY public.known_designer_first_name
ALTER TABLE public.known_designer_first_name ENABLE ROW LEVEL SECURITY;

-- POLICY public.order_list_user_views order_list_user_views_owner_delete
DROP POLICY IF EXISTS "order_list_user_views_owner_delete" ON public.order_list_user_views;
CREATE POLICY order_list_user_views_owner_delete ON public.order_list_user_views FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.order_list_user_views order_list_user_views_owner_insert
DROP POLICY IF EXISTS "order_list_user_views_owner_insert" ON public.order_list_user_views;
CREATE POLICY order_list_user_views_owner_insert ON public.order_list_user_views FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.order_list_user_views order_list_user_views_owner_select
DROP POLICY IF EXISTS "order_list_user_views_owner_select" ON public.order_list_user_views;
CREATE POLICY order_list_user_views_owner_select ON public.order_list_user_views FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.order_list_user_views order_list_user_views_owner_update
DROP POLICY IF EXISTS "order_list_user_views_owner_update" ON public.order_list_user_views;
CREATE POLICY order_list_user_views_owner_update ON public.order_list_user_views FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- ROW SECURITY public.pdf_text_samples_backup
ALTER TABLE public.pdf_text_samples_backup ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.popdam_item_state
ALTER TABLE public.popdam_item_state ENABLE ROW LEVEL SECURITY;

-- POLICY public.sku_style_guide_links service role all
CREATE POLICY "service role all" ON public.sku_style_guide_links TO service_role USING (true) WITH CHECK (true);

-- POLICY public.sku_style_guide_resolver_progress service_all
CREATE POLICY service_all ON public.sku_style_guide_resolver_progress TO service_role USING (true) WITH CHECK (true);

-- ROW SECURITY public.sku_style_guide_links
ALTER TABLE public.sku_style_guide_links ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.sku_style_guide_resolver_progress
ALTER TABLE public.sku_style_guide_resolver_progress ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.style_guide_file_crawl_seen
ALTER TABLE public.style_guide_file_crawl_seen ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.style_guide_file_preview_state
ALTER TABLE public.style_guide_file_preview_state ENABLE ROW LEVEL SECURITY;

-- POLICY public.style_guide_file_tags style_guide_file_tags_read
DROP POLICY IF EXISTS "style_guide_file_tags_read" ON public.style_guide_file_tags;
CREATE POLICY style_guide_file_tags_read ON public.style_guide_file_tags FOR SELECT TO authenticated USING (( SELECT public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

-- ROW SECURITY public.style_guide_pdf_text
ALTER TABLE public.style_guide_pdf_text ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.style_guide_search_documents
ALTER TABLE public.style_guide_search_documents ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.style_guide_search_embedding_jobs
ALTER TABLE public.style_guide_search_embedding_jobs ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY public.style_guide_search_sync_queue
ALTER TABLE public.style_guide_search_sync_queue ENABLE ROW LEVEL SECURITY;

-- POLICY public.style_guide_tag_aliases style_guide_tag_aliases_read
DROP POLICY IF EXISTS "style_guide_tag_aliases_read" ON public.style_guide_tag_aliases;
CREATE POLICY style_guide_tag_aliases_read ON public.style_guide_tag_aliases FOR SELECT TO authenticated USING (( SELECT public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

-- POLICY public.style_guide_tagging_state style_guide_tagging_state_read
DROP POLICY IF EXISTS "style_guide_tagging_state_read" ON public.style_guide_tagging_state;
CREATE POLICY style_guide_tagging_state_read ON public.style_guide_tagging_state FOR SELECT TO authenticated USING (( SELECT public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

-- POLICY public.style_guide_tags style_guide_tags_read
DROP POLICY IF EXISTS "style_guide_tags_read" ON public.style_guide_tags;
CREATE POLICY style_guide_tags_read ON public.style_guide_tags FOR SELECT TO authenticated USING (( SELECT public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'::public.app_name) AS has_app_access));

-- POLICY public.asset_checkouts users insert own checkouts
DROP POLICY IF EXISTS "users insert own checkouts" ON public.asset_checkouts;
CREATE POLICY "users insert own checkouts" ON public.asset_checkouts FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.helper_devices users insert own devices
DROP POLICY IF EXISTS "users insert own devices" ON public.helper_devices;
CREATE POLICY "users insert own devices" ON public.helper_devices FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.helper_tokens users insert own tokens
DROP POLICY IF EXISTS "users insert own tokens" ON public.helper_tokens;
CREATE POLICY "users insert own tokens" ON public.helper_tokens FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.helper_devices users see own devices
DROP POLICY IF EXISTS "users see own devices" ON public.helper_devices;
CREATE POLICY "users see own devices" ON public.helper_devices FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.helper_tokens users see own tokens
DROP POLICY IF EXISTS "users see own tokens" ON public.helper_tokens;
CREATE POLICY "users see own tokens" ON public.helper_tokens FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.asset_checkouts users update own checkouts
DROP POLICY IF EXISTS "users update own checkouts" ON public.asset_checkouts;
CREATE POLICY "users update own checkouts" ON public.asset_checkouts FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));

-- POLICY public.helper_devices users update own devices
DROP POLICY IF EXISTS "users update own devices" ON public.helper_devices;
CREATE POLICY "users update own devices" ON public.helper_devices FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));

-- COMMENT -.SCHEMA archive
COMMENT ON SCHEMA archive IS 'Retired tables kept for recovery only. Not exposed to API roles. Contents may be dropped by a later governed migration.';

-- COMMENT -.SCHEMA dam
COMMENT ON SCHEMA dam IS 'Digital asset management, style groups, style guides, and DAM operational queues.';

-- COMMENT -.SCHEMA hts_rag
COMMENT ON SCHEMA hts_rag IS 'Issue #2712. The sole shared HTS knowledge surface for production and Alsand. Not exposed to the Data API. Access only through the four designflow_hts_* roles.';

-- COMMENT dam.FUNCTION assets_enqueue_image_embed_trg_fn()
COMMENT ON FUNCTION dam.assets_enqueue_image_embed_trg_fn() IS 'After-insert / after-thumbnail-update bridge on public.assets: enqueue an image-embed index job for raster thumbnails, never failing ingest.';

-- COMMENT dam.TABLE image_embed_jobs
COMMENT ON TABLE dam.image_embed_jobs IS 'PopDAM image-embed queue: index jobs (per-asset thumbnails) and query jobs (uploaded picture payloads) claimed by GPU desktop pollers over the pooler.';

-- COMMENT dam.FUNCTION image_embed_enabled()
COMMENT ON FUNCTION dam.image_embed_enabled() IS 'True only when admin_config.IMAGE_EMBED_ENABLED is exactly true. Read by the assets enqueue trigger; the GPU poller claim loop is expected to honour the same flag, but the database does not enforce that.';

-- COMMENT dam.FUNCTION image_embed_purge_jobs()
COMMENT ON FUNCTION dam.image_embed_purge_jobs() IS 'Purge done/failed embed jobs older than 7 days; scheduled daily by pg_cron job purge-image-embed-jobs.';

-- COMMENT dam.FUNCTION rollup_moved_pdf_rich_extraction_groups()
COMMENT ON FUNCTION dam.rollup_moved_pdf_rich_extraction_groups() IS '#3911: statement trigger on public.assets (UPDATE OF style_group_id); rolls each group recorded by dam.sync_pdf_rich_extraction_style_group up once.';

-- COMMENT dam.FUNCTION sync_pdf_rich_extraction_style_group()
COMMENT ON FUNCTION dam.sync_pdf_rich_extraction_style_group() IS '#3911: row trigger on public.assets (UPDATE OF style_group_id, value changed); re-points the asset''s dam.pdf_rich_extraction row and records the affected groups for the statement rollup.';

-- COMMENT hts_rag.FUNCTION hts_rag_refresh_fault_lines()
COMMENT ON FUNCTION hts_rag.hts_rag_refresh_fault_lines() IS 'designflow-backend#254 §13.4. Refreshes both fault-line views after a reasoning extraction batch.';

-- COMMENT hts_rag.FUNCTION hts_rag_refresh_type_heading_stats()
COMMENT ON FUNCTION hts_rag.hts_rag_refresh_type_heading_stats() IS 'designflow-backend#254. Refreshes hts_rag_type_heading_stats after a harvest or extraction batch.';

-- COMMENT hts_rag.FUNCTION validate_affected_product_ids()
COMMENT ON FUNCTION hts_rag.validate_affected_product_ids() IS 'Trigger: refuses ruling_links.affected_product_ids that name an unknown product. designflow-backend#254 §13.5.';

-- COMMENT hts_rag.FUNCTION validate_sentence_provenance()
COMMENT ON FUNCTION hts_rag.validate_sentence_provenance() IS 'Trigger: refuses a claim whose (ruling_number, sentence_seq) is not in hts_rag_ruling_sentences. designflow-backend#254 §13.1.';

-- COMMENT public.FUNCTION backfill_pdf_files_used_v2()
COMMENT ON FUNCTION public.backfill_pdf_files_used_v2() IS 'Re-run the FILES USED and declared-style-guide parsers over every existing pdf_text_samples row. Needed because bulk_insert_pdf_text_samples skips the per-row trigger and only parses the rows in that batch; samples written before the parsers existed are otherwise never parsed.';

-- COMMENT dam.VIEW dam_order_list_customer_directory
COMMENT ON VIEW dam.dam_order_list_customer_directory IS 'Issue #2988. Narrow (id, name) customer directory for api.dam_order_list, read as its postgres owner so the bounded OrderList page never pays the per-row core.customer policy evaluation. Exposes no other column; core.customer policies, grants and columns are unchanged. Not exposed by PostgREST.';

-- COMMENT dam.VIEW dam_order_list_vendor_directory
COMMENT ON VIEW dam.dam_order_list_vendor_directory IS 'Issue #2988. Narrow (id, name) vendor directory for api.dam_order_list, read as its postgres owner so the bounded OrderList page never pays the per-row core.factory policy evaluation. Exposes no other column; core.factory policies, grants and columns are unchanged. Not exposed by PostgREST.';

-- COMMENT dam.TABLE order_tracking_ext
COMMENT ON TABLE dam.order_tracking_ext IS 'Manual PO tracking inputs. CRD/ETA clear flags suppress historic compatibility fallbacks.';

-- COMMENT dam.TABLE orderlist_customer_settings
COMMENT ON TABLE dam.orderlist_customer_settings IS 'Application customer suffix inputs, maintained through administrator-only RPC.';

-- COMMENT dam.TABLE orderlist_sample_depth
COMMENT ON TABLE dam.orderlist_sample_depth IS 'Application sample-depth inputs. One-time source seeding is separate from schema promotion; no curated Master Data load.';

-- COMMENT api.VIEW dam_order_list
COMMENT ON VIEW api.dam_order_list IS 'PopDAM order lines: Item Master descriptions, current Master Data workflow, source-qualified historic evidence, sample depth and forecasts. #4111';

-- COMMENT dam.VIEW dam_order_tracking
COMMENT ON VIEW dam.dam_order_tracking IS 'Private per-PO tracking rollup. API reads use bounded get_dam_order_tracking; source-parent cases count once.';

-- COMMENT public.FUNCTION get_render_z_nas_password()
COMMENT ON FUNCTION public.get_render_z_nas_password() IS 'shared-db#4283: Z: (mac share) NAS password from Vault secret popdam_render_z_nas_password; service_role only.';

-- COMMENT public.FUNCTION get_sg_nas_password()
COMMENT ON FUNCTION public.get_sg_nas_password() IS 'shared-db#4168: PopSG NAS password from Vault secret popdam_sg_nas_password; service_role only.';

-- COMMENT public.FUNCTION image_embed_status()
COMMENT ON FUNCTION public.image_embed_status() IS 'The only freshness API the edge may call: queue counts plus workers_fresh (>=1 heartbeat within 90 s).';

-- COMMENT public.FUNCTION queue_nightly_rebuild_style_groups()
COMMENT ON FUNCTION public.queue_nightly_rebuild_style_groups() IS 'Nightly style-group rebuild DRIVER (issue #2440). Invoked every 10 minutes by cron job "nightly-rebuild-style-groups"; the schedule is a poll, the function decides. Three mutually exclusive arms, evaluated in the order 2, 1, 3: (1) enqueue the rebuild once per UTC day at or after 06:00 UTC, which is the retired 0 6 * * * behaviour expressed as state; (2) run the asset-count reconcile in 500-group chunks when the operation reaches status "completed" with a run_id this function has not already reconciled - checked BEFORE arm 1 so the enqueue cannot overwrite an unreconciled completed run; (3) run it if the last reconcile is older than 7 days or never happened AND the rebuild is not in flight - arm 3 never runs while the operation is "running"/"queued" and freshly touched, because a ~98s recompute against membership the rebuild is still changing is exactly what this design exists to stop. An operation stuck at "queued" for longer than the floor window counts as not in flight, so a dead worker cannot suppress the floor forever. Arm 2 replaces the retired cron job "nightly-reconcile-sg-asset-counts" (45 3 * * *), which recomputed every count 2h15m BEFORE the rebuild that changed the membership being counted. Idempotence and the once-per-day enqueue gate are keyed on admin_config -> BULK_OPERATIONS -> "style-group-counts-reconcile", a separate key the PopDAM worker never writes: update_bulk_operation replaces the "rebuild-style-groups" object wholesale, so a marker stored there would be erased by the next progress update. Arm 3 exists because the failure mode this design introduces is SILENCE - read last_reconciled_at from that marker to detect it.';

-- COMMENT public.FUNCTION resolve_product_category_prediction_item_identity()
COMMENT ON FUNCTION public.resolve_product_category_prediction_item_identity() IS 'Preserves legacy prediction rows while binding new three-part canonical identities to plm.item. Canonical missing/ambiguous identities refuse; legacy ambiguity remains visible as unresolved history.';

-- COMMENT public.FUNCTION resolve_sku_style_guide_links()
COMMENT ON FUNCTION public.resolve_sku_style_guide_links() IS 'Derive public.sku_style_guide_links from (a) extracted FILES USED file names matched against plm.asset_file_style_guide_index, (b) the sheet''s declared CORE/STYLE GUIDE USED field, and (c) that declared field matched to a portal guide label. Upsert only; never deletes. SECURITY DEFINER because plm.* is not PostgREST-exposed.';

-- COMMENT public.FUNCTION style_guide_files_queue_search_sync()
COMMENT ON FUNCTION public.style_guide_files_queue_search_sync() IS 'Issue #3023, #4437. Enqueues an active style_guide_files row for search-document sync when it is inserted or any source_identity input (including thumbnail_url, the embedding content input) changes.';

-- COMMENT public.FUNCTION sync_asset_effective_tags()
COMMENT ON FUNCTION public.sync_asset_effective_tags() IS 'Maintains public.asset_effective_tags. The assets branch compares the derived set against the stored set and writes only the difference (#2213); an unchanged set performs no delete and no insert.';

-- COMMENT api.VIEW dam_order_customer_settings
COMMENT ON VIEW api.dam_order_customer_settings IS 'Customer suffix settings for derived OrderList output.';

-- COMMENT api.VIEW dam_order_sample_depth
COMMENT ON VIEW api.dam_order_sample_depth IS 'Customer-specific sample depth; original source values and source row retained separately from parsed depth.';

-- COMMENT api.VIEW dam_order_vendor_statistics
COMMENT ON VIEW api.dam_order_vendor_statistics IS 'Header-only vendor counts and 14-month active/inactive classification; sales-history placeholders excluded.';

-- COMMENT public.TABLE popdam_item_state
COMMENT ON TABLE public.popdam_item_state IS 'PopDAM-owned item workflow state keyed to canonical plm.item identity. Source identity columns are a readable immutable snapshot; source-owned plm.item remains free of application state.';

-- COMMENT archive.TABLE erp_items_current
COMMENT ON TABLE archive.erp_items_current IS 'RETIRED (#2482). Frozen DesignFlow item snapshot, moved from public for recovery only. Readers use plm.item and plm.legacy_erp_item_identity.';

-- COMMENT archive.TABLE erp_items_raw
COMMENT ON TABLE archive.erp_items_raw IS 'RETIRED (#2482). Frozen DesignFlow raw item payloads, moved from public for recovery only.';

-- COMMENT dam.VIEW asset_character_current
COMMENT ON VIEW dam.asset_character_current IS 'Current relationships only; raw table remains authorized historical summary with explicit lifecycle flags.';

-- COMMENT dam.TABLE asset_character_source_edge
COMMENT ON TABLE dam.asset_character_source_edge IS 'Per-source support evidence for the asset <-> character relationship (issue #2334). Supports dam.asset_character, which already existed on main and is deliberately left unaltered. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';

-- COMMENT dam.TABLE asset_franchise
COMMENT ON TABLE dam.asset_franchise IS 'Canonical direct asset <-> franchise relationship (issue #2334). Which franchise a digital asset belongs to. A row may exist only while dam.asset_franchise_source_edge holds a CURRENT direct source assertion for the same pair; inferred and co-occurrence evidence never reach this table. Endpoint deletion is RESTRICT, so a asset or franchise cannot be deleted out from under a stated relationship. No role may write here -- canonical edges are written only by a governed migration. Seeded empty: #2334 authorizes no relationship rows.';

-- COMMENT dam.VIEW asset_franchise_current
COMMENT ON VIEW dam.asset_franchise_current IS 'Current relationships only; raw table remains authorized historical summary with explicit lifecycle flags.';

-- COMMENT dam.TABLE asset_franchise_source_edge
COMMENT ON TABLE dam.asset_franchise_source_edge IS 'Per-source support evidence for the asset <-> franchise relationship (issue #2334). Supports the canonical bridge dam.asset_franchise, created alongside it. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';

-- COMMENT dam.TABLE asset_property
COMMENT ON TABLE dam.asset_property IS 'Canonical direct asset <-> property relationship (issue #2334). Which properties a digital asset depicts. dam.asset.property_id is a single legacy scalar pointer and cannot express an asset that depicts two properties. A row may exist only while dam.asset_property_source_edge holds a CURRENT direct source assertion for the same pair; inferred and co-occurrence evidence never reach this table. Endpoint deletion is RESTRICT, so a asset or property cannot be deleted out from under a stated relationship. No role may write here -- canonical edges are written only by a governed migration. Seeded empty: #2334 authorizes no relationship rows.';

-- COMMENT dam.VIEW asset_property_current
COMMENT ON VIEW dam.asset_property_current IS 'Current relationships only; raw table remains authorized historical summary with explicit lifecycle flags.';

-- COMMENT dam.TABLE asset_property_source_edge
COMMENT ON TABLE dam.asset_property_source_edge IS 'Per-source support evidence for the asset <-> property relationship (issue #2334). Supports the canonical bridge dam.asset_property, created alongside it. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';

-- COMMENT dam.TABLE asset_style_guide
COMMENT ON TABLE dam.asset_style_guide IS 'Canonical direct asset <-> style guide relationship (issue #2334). Which style guide a digital asset was drawn from. Approval submissions cite this. A row may exist only while dam.asset_style_guide_source_edge holds a CURRENT direct source assertion for the same pair; inferred and co-occurrence evidence never reach this table. Endpoint deletion is RESTRICT, so a asset or style_guide cannot be deleted out from under a stated relationship. No role may write here -- canonical edges are written only by a governed migration. Seeded empty: #2334 authorizes no relationship rows.';

-- COMMENT dam.VIEW asset_style_guide_current
COMMENT ON VIEW dam.asset_style_guide_current IS 'Current relationships only; raw table remains authorized historical summary with explicit lifecycle flags.';

-- COMMENT dam.TABLE asset_style_guide_source_edge
COMMENT ON TABLE dam.asset_style_guide_source_edge IS 'Per-source support evidence for the asset <-> style guide relationship (issue #2334). Supports the canonical bridge dam.asset_style_guide, created alongside it. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';

-- COMMENT dam.TABLE dam_asset_image_vectors
COMMENT ON TABLE dam.dam_asset_image_vectors IS 'PopDAM image-similarity vectors: one DINOv3 + one SigLIP 2 halfvec(768) per asset, with the exact model stamp and the thumbnail URL watermark they were computed from.';

-- COMMENT dam.TABLE folder_rename_log
COMMENT ON TABLE dam.folder_rename_log IS 'Permanent folder-level record of NAS folder renames (popdam3#963). NEVER purge: it is the only way to find a file''s pre-rename path in NAS snapshots and backups, which are kept for years. Written only by the service role.';

-- COMMENT dam.TABLE image_embed_worker_heartbeat
COMMENT ON TABLE dam.image_embed_worker_heartbeat IS 'One row per PopDAM image-embed GPU worker; public.image_embed_status() reports the fleet fresh while at least one row is younger than 90 s.';

-- COMMENT dam.TABLE order_buy_sheet_import
COMMENT ON TABLE dam.order_buy_sheet_import IS 'One row per applied customer buy-sheet import (public.import_dam_buy_sheet): who, when, the raw sheet cells, the parsed lines and the outcome. Written only by that function.';

-- COMMENT hts_rag.TABLE hts_rag_article_types
COMMENT ON TABLE hts_rag.hts_rag_article_types IS 'Canonical article types vocabulary with synonyms, built by clustering ruling phrases (flat in v1).';

-- COMMENT hts_rag.TABLE hts_rag_attribute_keys
COMMENT ON TABLE hts_rag.hts_rag_attribute_keys IS 'Vocabulary of fact kinds CBP decides on (material_pct, function, user_age, illuminated, ...).';

-- COMMENT hts_rag.TABLE hts_rag_authorities
COMMENT ON TABLE hts_rag.hts_rag_authorities IS 'One row per distinct legal citation target (GRI, note, EN, case, prior ruling), parsed deterministically. designflow-backend#254 §13.2.';

-- COMMENT hts_rag.TABLE hts_rag_broker_opinions
COMMENT ON TABLE hts_rag.hts_rag_broker_opinions IS 'Customs broker opinion on an HTS code; an authoritative row overrides AI candidates. designflow-backend#278.';

-- COMMENT hts_rag.TABLE hts_rag_classification_jobs
COMMENT ON TABLE hts_rag.hts_rag_classification_jobs IS 'Operational classification control data, not reusable HTS learning evidence. Owner/creator identity, input/result payloads and RFQ pointers are permitted only in this environment-isolated job table; never copy its raw operational payloads into shared HTS learning tables. Backend creator/admin authorization is required within each environment.';

-- COMMENT hts_rag.TABLE hts_rag_classification_tests
COMMENT ON TABLE hts_rag.hts_rag_classification_tests IS 'Controlled vocabulary of tests CBP applies, seeded from law and grown by clustering; merges use merged_into, nothing is deleted. designflow-backend#254 §13.3.';

-- COMMENT hts_rag.TABLE hts_rag_counterfactuals
COMMENT ON TABLE hts_rag.hts_rag_counterfactuals IS 'Only when CBP states it in a sentence: if this attribute had that value, the code would be then_code_prefix. Never model speculation. §13.2.';

-- COMMENT hts_rag.TABLE hts_rag_decision_authorities
COMMENT ON TABLE hts_rag.hts_rag_decision_authorities IS 'Which authority each heading decision applied, distinguished, overruled, quoted or followed, with the citing sentence. §13.2.';

-- COMMENT hts_rag.TABLE hts_rag_decision_facts
COMMENT ON TABLE hts_rag.hts_rag_decision_facts IS 'Sentence-backed facts that satisfied (supports) or failed (defeats) a decision test. §13.2.';

-- COMMENT hts_rag.TABLE hts_rag_decision_tests
COMMENT ON TABLE hts_rag.hts_rag_decision_tests IS 'One row per (heading decision, test): outcome, whether CBP said it decided the heading, and the sentence stating it. §13.2.';

-- COMMENT hts_rag.TABLE hts_rag_extractions
COMMENT ON TABLE hts_rag.hts_rag_extractions IS 'One row per (ruling, pass, extract_version): model, prompt and text hashes, raw output (re-validation is free). New versions write beside the old and flip is_current. designflow-backend#254 §13.5.';

-- COMMENT hts_rag.TABLE hts_rag_heading_decisions
COMMENT ON TABLE hts_rag.hts_rag_heading_decisions IS 'Every heading CBP weighed for a product, winners and losers, with rule, notes and CBPs verbatim reason.';

-- COMMENT hts_rag.TABLE hts_rag_ruling_products
COMMENT ON TABLE hts_rag.hts_rag_ruling_products IS 'One row per product a CBP ruling classifies (search target). effective_status is per product: a modification may revoke one product only.';

-- COMMENT hts_rag.MATERIALIZED VIEW hts_rag_fault_lines
COMMENT ON MATERIALIZED VIEW hts_rag.hts_rag_fault_lines IS 'For competing code prefixes A and B per article type: which test and attribute key split them, with counts per side and three example products. §13.4.';

-- COMMENT hts_rag.MATERIALIZED VIEW hts_rag_fault_lines_any_type
COMMENT ON MATERIALIZED VIEW hts_rag.hts_rag_fault_lines_any_type IS 'hts_rag_fault_lines without the article type, for rare or unresolved types. §13.4.';

-- COMMENT hts_rag.TABLE hts_rag_hts_codes
COMMENT ON TABLE hts_rag.hts_rag_hts_codes IS 'Official USITC HTS lines per revision (USITC data only, never hand-typed). Design: designflow-backend#254.';

-- COMMENT hts_rag.TABLE hts_rag_hts_renumbering
COMMENT ON TABLE hts_rag.hts_rag_hts_renumbering IS 'Many-to-many USITC renumbering map; new_code null means no current equivalent (flagged, never guessed).';

-- COMMENT hts_rag.TABLE hts_rag_materials
COMMENT ON TABLE hts_rag.hts_rag_materials IS 'Canonical materials vocabulary with synonyms, built by clustering ruling phrases (flat in v1).';

-- COMMENT hts_rag.TABLE hts_rag_product_attributes
COMMENT ON TABLE hts_rag.hts_rag_product_attributes IS 'Normalized product facts, each tied to the ruling sentence that states it; is_decisive = CBP named it as a reason.';

-- COMMENT hts_rag.TABLE hts_rag_product_components
COMMENT ON TABLE hts_rag.hts_rag_product_components IS 'Components of sets and composite goods (GRI 3).';

-- COMMENT hts_rag.TABLE hts_rag_ruling_codes
COMMENT ON TABLE hts_rag.hts_rag_ruling_codes IS 'Every HTS code in a ruling with its role; held comes from the holding sentence first (fixes counting rejected codes as agreement).';

-- COMMENT hts_rag.TABLE hts_rag_ruling_current_codes
COMMENT ON TABLE hts_rag.hts_rag_ruling_current_codes IS 'Current HTS equivalent of each ruling''s held code; held_code is never rewritten. Design: designflow-backend#278.';

-- COMMENT hts_rag.TABLE hts_rag_ruling_ingest_jobs
COMMENT ON TABLE hts_rag.hts_rag_ruling_ingest_jobs IS 'Operational queue for background ingest of cited CBP rulings (leased, bounded retry, dead-letter). Not HTS learning evidence. Environment isolated; no browser/runtime role access; no DELETE.';

-- COMMENT hts_rag.TABLE hts_rag_ruling_links
COMMENT ON TABLE hts_rag.hts_rag_ruling_links IS 'Ruling precedent graph (revokes/modifies/cites/follows/distinguishes); drives effective_status. to_ruling may not be harvested yet, so it has no FK.';

-- COMMENT hts_rag.TABLE hts_rag_ruling_passb
COMMENT ON TABLE hts_rag.hts_rag_ruling_passb IS 'Pass B CBP-reasoning extraction per ruling and extract_version; Pass A rows in hts_rag_extractions untouched; insert/delete only. designflow-backend#278 plan_hts-4-upgrades.md Phase 4.';

-- COMMENT hts_rag.TABLE hts_rag_ruling_scope_labels
COMMENT ON TABLE hts_rag.hts_rag_ruling_scope_labels IS 'Shelf-1 scope label per ruling and label_version; insert/delete only (no worker UPDATE). designflow-backend#278 plan_hts-4-upgrades.md Phase 2.';

-- COMMENT hts_rag.TABLE hts_rag_ruling_sentences
COMMENT ON TABLE hts_rag.hts_rag_ruling_sentences IS 'Sentences of each ruling in document order; (ruling_number, seq) is the provenance key for every stored claim. text_hash = sha1(text_norm), stable across CBP API and CustomsMobile text. designflow-backend#254 §13.1.';

-- COMMENT hts_rag.TABLE hts_rag_test_aliases
COMMENT ON TABLE hts_rag.hts_rag_test_aliases IS 'Lower-case free test names (model or CBP wording) mapped to a canonical test. designflow-backend#254 §13.3.';

-- COMMENT hts_rag.MATERIALIZED VIEW hts_rag_type_heading_stats
COMMENT ON MATERIALIZED VIEW hts_rag.hts_rag_type_heading_stats IS 'designflow-backend#254. Per article type (all_materials = true) and per type x material (all_materials = false; material may be unknown): held/rejected counts per heading and chapter. Candidate chapters are computed from it, never hand-typed.';

-- COMMENT hts_rag.TABLE item_classification_fact
COMMENT ON TABLE hts_rag.item_classification_fact IS 'Person-supplied classification fact for a product (never AI-inferred); read by the HTS classifier before it asks. designflow-backend#278.';

-- COMMENT public.TABLE asset_designer_sheet_backup
COMMENT ON TABLE public.asset_designer_sheet_backup IS 'First-seen asset designer values before a licensing sheet replaced them. Undo source; safe to retire once the change is accepted.';

-- COMMENT public.TABLE bulk_operation_runs
COMMENT ON TABLE public.bulk_operation_runs IS 'Append-only history of terminal PopDAM bulk-operation outcomes (issue #2439). public.admin_config -> BULK_OPERATIONS holds ONE state object per operation and overwrites it on every run, so a failure is erased by the next attempt and "how long has this been failing" is unanswerable. This table keeps one immutable row per run so alerting can read the WORKER''s outcome; cron.job_run_details cannot, because job 7 only enqueues the rebuild and reports success for the enqueue. No role is granted update or delete: history is corrected by a reviewed migration or not at all. Empty means "not instrumented yet", never "no failures".';

-- COMMENT public.TABLE dam_search_keys
COMMENT ON TABLE public.dam_search_keys IS 'Narrow precomputed keyword-search keys for dam_search_documents (one row per document), maintained only by trigger dam_search_documents_sync_keys. Read by search_dam_documents. Do not write directly.';

-- COMMENT public.TABLE hts_rag_debate_runs
COMMENT ON TABLE public.hts_rag_debate_runs IS 'Service-only, append-preserved HTS dual-model debate audit. No browser role has access and no application role may delete records. Raw provider payloads and licensed product descriptions do not belong here.';

-- COMMENT public.TABLE pdf_text_samples_backup
COMMENT ON TABLE public.pdf_text_samples_backup IS 'First-seen copy of pdf_text_samples rows, taken before the Indra rescan replaced them. Restore source; safe to retire after the rescan is accepted.';

-- COMMENT public.TABLE sku_style_guide_links
COMMENT ON TABLE public.sku_style_guide_links IS 'Which licensor style guide(s) a PopDAM item (SKU / style group) drew its source art from. Derived by matching the item''s extracted "FILES USED" file names against plm.asset_file_style_guide_index, and by the sheet''s own "CORE/STYLE GUIDE USED" field. Evidence, not canonical: quarantine model, never auto-deleted. core_style_guide_id is a reserved promotion slot to core.style_guide (currently empty).';

-- COMMENT public.TABLE style_guide_file_crawl_seen
COMMENT ON TABLE public.style_guide_file_crawl_seen IS 'Last PopSG crawl run that saw each ACTIVE style_guide_files row (popdam3#804). One row per active file, kept by trg_style_guide_files_crawl_seen and upsert_style_guide_crawl_files; read by reconcile/preview.';

-- COMMENT public.TABLE style_guide_file_preview_state
COMMENT ON TABLE public.style_guide_file_preview_state IS 'Compact mirror of style_guide_files preview state for search_style_guide_library_v2 (#4210). Maintained only by trg_style_guide_file_preview_state.';

-- COMMENT public.TABLE style_guide_search_documents
COMMENT ON TABLE public.style_guide_search_documents IS 'Issue #2212. Incrementally maintained PopSG search documents. Populated in bounded slices by refresh_style_guide_matviews and complete_style_guide_pdf_text, and deactivated by reconcile_stale_sg_files_batch. Deliberately NOT backfilled by the migration.';

-- COMMENT public.TABLE style_guide_pdf_text
COMMENT ON TABLE public.style_guide_pdf_text IS 'Issue #2212. PopSG PDF text keyed to ACTIVE style_guide_files. `content_identity` is derived from the file row; a change to it invalidates the extraction on the next claim, and complete_style_guide_pdf_text refuses a result whose identity no longer matches. Restart-safe: an expired claim is reclaimable.';

-- COMMENT public.TABLE style_guide_search_embedding_jobs
COMMENT ON TABLE public.style_guide_search_embedding_jobs IS 'Issue #5758 Step 4. Lease, attempt and error state of the PopSG image-embedding queue, one row per search document with pending or failed embedding work. Only the primary key is indexed so every lease/attempt update is HOT. A row applies only while content_sha256 equals the document''s; a successful embedding deletes it. Written only by claim_sg_search_embedding_documents, upsert_sg_search_embedding, mark_sg_search_embedding_error and reset_sg_search_embedding_errors.';

-- COMMENT public.TABLE style_guide_search_sync_queue
COMMENT ON TABLE public.style_guide_search_sync_queue IS 'Issue #3023. Files whose search document may be missing or stale. Filled by trg_style_guide_files_queue_search_sync, drained by refresh_style_guide_matviews. Internal; service-role only.';

-- ACL -.SCHEMA dam
GRANT USAGE ON SCHEMA dam TO authenticated;
GRANT USAGE ON SCHEMA dam TO service_role;

-- ACL -.SCHEMA hts_rag


-- ACL dam.FUNCTION assets_enqueue_image_embed_trg_fn()
REVOKE ALL ON FUNCTION dam.assets_enqueue_image_embed_trg_fn() FROM PUBLIC;

-- ACL dam.TABLE image_embed_jobs


-- ACL dam.FUNCTION enforce_asset_freshness()
REVOKE ALL ON FUNCTION dam.enforce_asset_freshness() FROM PUBLIC;

-- ACL dam.FUNCTION image_embed_enabled()
REVOKE ALL ON FUNCTION dam.image_embed_enabled() FROM PUBLIC;
GRANT ALL ON FUNCTION dam.image_embed_enabled() TO service_role;

-- ACL dam.FUNCTION image_embed_purge_jobs()
REVOKE ALL ON FUNCTION dam.image_embed_purge_jobs() FROM PUBLIC;

-- ACL dam.FUNCTION rollup_moved_pdf_rich_extraction_groups()
REVOKE ALL ON FUNCTION dam.rollup_moved_pdf_rich_extraction_groups() FROM PUBLIC;

-- ACL dam.FUNCTION sync_pdf_rich_extraction_style_group()
REVOKE ALL ON FUNCTION dam.sync_pdf_rich_extraction_style_group() FROM PUBLIC;

-- ACL dam.FUNCTION sync_search_group_vectors()
REVOKE ALL ON FUNCTION dam.sync_search_group_vectors() FROM PUBLIC;

-- ACL hts_rag.FUNCTION enforce_hts_rag_precedent_promotion_gate_immutable()
REVOKE ALL ON FUNCTION hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable() FROM PUBLIC;

-- ACL hts_rag.FUNCTION hts_rag_refresh_fault_lines()
REVOKE ALL ON FUNCTION hts_rag.hts_rag_refresh_fault_lines() FROM PUBLIC;

-- ACL hts_rag.FUNCTION hts_rag_refresh_type_heading_stats()
REVOKE ALL ON FUNCTION hts_rag.hts_rag_refresh_type_heading_stats() FROM PUBLIC;

-- ACL hts_rag.FUNCTION validate_affected_product_ids()
REVOKE ALL ON FUNCTION hts_rag.validate_affected_product_ids() FROM PUBLIC;

-- ACL hts_rag.FUNCTION validate_sentence_provenance()
REVOKE ALL ON FUNCTION hts_rag.validate_sentence_provenance() FROM PUBLIC;

-- ACL public.FUNCTION apply_pdf_sheet_style_tags()
REVOKE ALL ON FUNCTION public.apply_pdf_sheet_style_tags() FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_pdf_sheet_style_tags() TO service_role;

-- ACL public.FUNCTION assets_refresh_default_visible_flags()
REVOKE ALL ON FUNCTION public.assets_refresh_default_visible_flags() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assets_refresh_default_visible_flags() TO service_role;

-- ACL public.FUNCTION backfill_pdf_files_used()
REVOKE ALL ON FUNCTION public.backfill_pdf_files_used() FROM PUBLIC;
GRANT ALL ON FUNCTION public.backfill_pdf_files_used() TO service_role;

-- ACL public.FUNCTION backfill_pdf_files_used_v2()
REVOKE ALL ON FUNCTION public.backfill_pdf_files_used_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.backfill_pdf_files_used_v2() TO service_role;

-- ACL public.FUNCTION compute_primary_sort_tier()
REVOKE ALL ON FUNCTION public.compute_primary_sort_tier() FROM PUBLIC;
GRANT ALL ON FUNCTION public.compute_primary_sort_tier() TO service_role;

-- ACL public.FUNCTION count_pdf_backfill_remaining()
REVOKE ALL ON FUNCTION public.count_pdf_backfill_remaining() FROM PUBLIC;
GRANT ALL ON FUNCTION public.count_pdf_backfill_remaining() TO authenticated;
GRANT ALL ON FUNCTION public.count_pdf_backfill_remaining() TO service_role;

-- ACL public.FUNCTION count_pdf_rescan_remaining()
REVOKE ALL ON FUNCTION public.count_pdf_rescan_remaining() FROM PUBLIC;
GRANT ALL ON FUNCTION public.count_pdf_rescan_remaining() TO service_role;

-- ACL public.FUNCTION dam_search_documents_set_default_visible()
REVOKE ALL ON FUNCTION public.dam_search_documents_set_default_visible() FROM PUBLIC;
GRANT ALL ON FUNCTION public.dam_search_documents_set_default_visible() TO service_role;

-- ACL public.FUNCTION enforce_hts_rag_precedent_promotion_gate_immutable()
REVOKE ALL ON FUNCTION public.enforce_hts_rag_precedent_promotion_gate_immutable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_hts_rag_precedent_promotion_gate_immutable() TO service_role;

-- ACL public.FUNCTION finish_sku_style_guide_catchup()
REVOKE ALL ON FUNCTION public.finish_sku_style_guide_catchup() FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_sku_style_guide_catchup() TO service_role;

-- ACL public.FUNCTION get_dam_asset_taxonomy_counts()
REVOKE ALL ON FUNCTION public.get_dam_asset_taxonomy_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_dam_asset_taxonomy_counts() TO service_role;
GRANT ALL ON FUNCTION public.get_dam_asset_taxonomy_counts() TO authenticated;

-- ACL public.FUNCTION get_dam_order_list_status_counts()
REVOKE ALL ON FUNCTION public.get_dam_order_list_status_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_dam_order_list_status_counts() TO service_role;
GRANT ALL ON FUNCTION public.get_dam_order_list_status_counts() TO authenticated;

-- ACL dam.TABLE order_tracking_ext
GRANT SELECT ON TABLE dam.order_tracking_ext TO authenticated;
GRANT ALL ON TABLE dam.order_tracking_ext TO service_role;

-- ACL dam.TABLE orderlist_customer_settings
GRANT SELECT ON TABLE dam.orderlist_customer_settings TO authenticated;
GRANT ALL ON TABLE dam.orderlist_customer_settings TO service_role;

-- ACL dam.TABLE orderlist_sample_depth
GRANT SELECT ON TABLE dam.orderlist_sample_depth TO authenticated;
GRANT ALL ON TABLE dam.orderlist_sample_depth TO service_role;

-- ACL public.FUNCTION get_dam_search_embedding_status()
REVOKE ALL ON FUNCTION public.get_dam_search_embedding_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_dam_search_embedding_status() TO service_role;

-- ACL public.FUNCTION get_render_z_nas_password()
REVOKE ALL ON FUNCTION public.get_render_z_nas_password() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_render_z_nas_password() TO service_role;

-- ACL public.FUNCTION get_search_embedding_health()
REVOKE ALL ON FUNCTION public.get_search_embedding_health() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_search_embedding_health() TO service_role;

-- ACL public.FUNCTION get_sg_nas_password()
REVOKE ALL ON FUNCTION public.get_sg_nas_password() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_sg_nas_password() TO service_role;

-- ACL public.FUNCTION get_sg_preview_stats()
REVOKE ALL ON FUNCTION public.get_sg_preview_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_sg_preview_stats() TO authenticated;
GRANT ALL ON FUNCTION public.get_sg_preview_stats() TO service_role;

-- ACL public.FUNCTION get_sg_search_embedding_status()
REVOKE ALL ON FUNCTION public.get_sg_search_embedding_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_sg_search_embedding_status() TO service_role;

-- ACL public.FUNCTION image_embed_status()
REVOKE ALL ON FUNCTION public.image_embed_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.image_embed_status() TO service_role;

-- ACL public.FUNCTION prewarm_style_guide_search()
REVOKE ALL ON FUNCTION public.prewarm_style_guide_search() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prewarm_style_guide_search() TO service_role;

-- ACL public.FUNCTION queue_nightly_rebuild_style_groups()
REVOKE ALL ON FUNCTION public.queue_nightly_rebuild_style_groups() FROM PUBLIC;
GRANT ALL ON FUNCTION public.queue_nightly_rebuild_style_groups() TO service_role;

-- ACL public.FUNCTION refresh_dam_search_after_render_completion()
REVOKE ALL ON FUNCTION public.refresh_dam_search_after_render_completion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_dam_search_after_render_completion() TO service_role;

-- ACL public.FUNCTION refresh_dam_search_after_source_size_change()
REVOKE ALL ON FUNCTION public.refresh_dam_search_after_source_size_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_dam_search_after_source_size_change() TO service_role;

-- ACL public.FUNCTION refresh_sku_human_description()
REVOKE ALL ON FUNCTION public.refresh_sku_human_description() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_sku_human_description() TO service_role;

-- ACL public.FUNCTION refresh_style_guide_library_default_snapshot()
REVOKE ALL ON FUNCTION public.refresh_style_guide_library_default_snapshot() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_style_guide_library_default_snapshot() TO service_role;

-- ACL public.FUNCTION refresh_style_guide_matviews_job()
REVOKE ALL ON FUNCTION public.refresh_style_guide_matviews_job() FROM PUBLIC;

-- ACL public.FUNCTION resolve_product_category_prediction_item_identity()
REVOKE ALL ON FUNCTION public.resolve_product_category_prediction_item_identity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_product_category_prediction_item_identity() TO service_role;

-- ACL public.FUNCTION resolve_sku_style_guide_links()
REVOKE ALL ON FUNCTION public.resolve_sku_style_guide_links() FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_sku_style_guide_links() TO service_role;

-- ACL public.FUNCTION sku_sg_file_exact_filename_key()
REVOKE ALL ON FUNCTION public.sku_sg_file_exact_filename_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_file_exact_filename_key() TO service_role;

-- ACL public.FUNCTION sku_sg_file_file_name_key()
REVOKE ALL ON FUNCTION public.sku_sg_file_file_name_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_file_file_name_key() TO service_role;

-- ACL public.FUNCTION sku_sg_file_original_file_name_key()
REVOKE ALL ON FUNCTION public.sku_sg_file_original_file_name_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_file_original_file_name_key() TO service_role;

-- ACL public.FUNCTION sku_sg_label_exact_label_key()
REVOKE ALL ON FUNCTION public.sku_sg_label_exact_label_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_label_exact_label_key() TO service_role;

-- ACL public.FUNCTION sku_sg_label_folder_name_key()
REVOKE ALL ON FUNCTION public.sku_sg_label_folder_name_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_label_folder_name_key() TO service_role;

-- ACL public.FUNCTION sku_sg_label_label_key()
REVOKE ALL ON FUNCTION public.sku_sg_label_label_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_label_label_key() TO service_role;

-- ACL public.FUNCTION sku_sg_label_style_guide_label_key()
REVOKE ALL ON FUNCTION public.sku_sg_label_style_guide_label_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_label_style_guide_label_key() TO service_role;

-- ACL public.FUNCTION sku_sg_label_value_label_key()
REVOKE ALL ON FUNCTION public.sku_sg_label_value_label_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_label_value_label_key() TO service_role;

-- ACL public.FUNCTION sku_sg_pdf_keys()
REVOKE ALL ON FUNCTION public.sku_sg_pdf_keys() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_sg_pdf_keys() TO service_role;

-- ACL public.FUNCTION stamp_style_group_asset_change()
REVOKE ALL ON FUNCTION public.stamp_style_group_asset_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.stamp_style_group_asset_change() TO service_role;

-- ACL public.FUNCTION stamp_style_group_definition_change()
REVOKE ALL ON FUNCTION public.stamp_style_group_definition_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.stamp_style_group_definition_change() TO service_role;

-- ACL public.FUNCTION style_guide_files_queue_search_sync()
REVOKE ALL ON FUNCTION public.style_guide_files_queue_search_sync() FROM PUBLIC;
GRANT ALL ON FUNCTION public.style_guide_files_queue_search_sync() TO service_role;

-- ACL public.FUNCTION style_guide_files_sync_crawl_seen()
REVOKE ALL ON FUNCTION public.style_guide_files_sync_crawl_seen() FROM PUBLIC;
GRANT ALL ON FUNCTION public.style_guide_files_sync_crawl_seen() TO service_role;

-- ACL public.FUNCTION sync_asset_effective_tags()
REVOKE ALL ON FUNCTION public.sync_asset_effective_tags() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_asset_effective_tags() TO service_role;

-- ACL public.FUNCTION sync_asset_tags_to_array()
REVOKE ALL ON FUNCTION public.sync_asset_tags_to_array() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_asset_tags_to_array() TO service_role;

-- ACL public.FUNCTION sync_style_guide_file_preview_state()
REVOKE ALL ON FUNCTION public.sync_style_guide_file_preview_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_style_guide_file_preview_state() TO service_role;

-- ACL public.FUNCTION touch_style_group_tag_change()
REVOKE ALL ON FUNCTION public.touch_style_group_tag_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_style_group_tag_change() TO service_role;

-- ACL public.FUNCTION trg_refresh_dam_tag_or_character_stmt()
REVOKE ALL ON FUNCTION public.trg_refresh_dam_tag_or_character_stmt() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_refresh_dam_tag_or_character_stmt() TO service_role;

-- ACL public.TABLE popdam_item_state
GRANT ALL ON TABLE public.popdam_item_state TO service_role;

-- ACL archive.TABLE erp_items_current
GRANT ALL ON TABLE archive.erp_items_current TO service_role;

-- ACL archive.TABLE erp_items_raw
GRANT ALL ON TABLE archive.erp_items_raw TO service_role;

-- ACL dam.TABLE asset_character_source_edge
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE dam.asset_character_source_edge TO service_role;

-- ACL dam.TABLE asset_franchise
GRANT SELECT ON TABLE dam.asset_franchise TO service_role;

-- ACL dam.TABLE asset_franchise_source_edge
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE dam.asset_franchise_source_edge TO service_role;

-- ACL dam.TABLE asset_property
GRANT SELECT ON TABLE dam.asset_property TO service_role;

-- ACL dam.TABLE asset_property_source_edge
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE dam.asset_property_source_edge TO service_role;

-- ACL dam.TABLE asset_style_guide
GRANT SELECT ON TABLE dam.asset_style_guide TO service_role;

-- ACL dam.TABLE asset_style_guide_source_edge
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE dam.asset_style_guide_source_edge TO service_role;

-- ACL dam.TABLE folder_rename_log
GRANT SELECT ON TABLE dam.folder_rename_log TO authenticated;
GRANT ALL ON TABLE dam.folder_rename_log TO service_role;

-- ACL dam.TABLE image_embed_worker_heartbeat


-- ACL dam.TABLE order_buy_sheet_import
GRANT SELECT,INSERT ON TABLE dam.order_buy_sheet_import TO service_role;

-- ACL hts_rag.TABLE hts_rag_article_types


-- ACL hts_rag.TABLE hts_rag_attribute_keys


-- ACL hts_rag.TABLE hts_rag_authorities


-- ACL hts_rag.TABLE hts_rag_broker_opinions


-- ACL hts_rag.TABLE hts_rag_classification_jobs


-- ACL hts_rag.TABLE hts_rag_classification_tests


-- ACL hts_rag.TABLE hts_rag_counterfactuals


-- ACL hts_rag.TABLE hts_rag_debate_runs


-- ACL hts_rag.TABLE hts_rag_decision_authorities


-- ACL hts_rag.TABLE hts_rag_decision_facts


-- ACL hts_rag.TABLE hts_rag_decision_tests


-- ACL hts_rag.TABLE hts_rag_determinations


-- ACL hts_rag.TABLE hts_rag_extraction_jobs


-- ACL hts_rag.TABLE hts_rag_extractions


-- ACL hts_rag.TABLE hts_rag_heading_decisions


-- ACL hts_rag.TABLE hts_rag_ruling_products


-- ACL hts_rag.TABLE hts_rag_hts_codes


-- ACL hts_rag.TABLE hts_rag_hts_renumbering


-- ACL hts_rag.TABLE hts_rag_materials


-- ACL hts_rag.TABLE hts_rag_precedent_rulings


-- ACL hts_rag.TABLE hts_rag_precedents


-- ACL hts_rag.TABLE hts_rag_product_attributes


-- ACL hts_rag.TABLE hts_rag_product_components


-- ACL hts_rag.TABLE hts_rag_product_examples


-- ACL hts_rag.TABLE hts_rag_product_family_allowlist


-- ACL hts_rag.TABLE hts_rag_provider_responses


-- ACL hts_rag.TABLE hts_rag_review_events


-- ACL hts_rag.TABLE hts_rag_ruling_codes


-- ACL hts_rag.TABLE hts_rag_ruling_current_codes


-- ACL hts_rag.TABLE hts_rag_ruling_ingest_jobs


-- ACL hts_rag.TABLE hts_rag_ruling_links


-- ACL hts_rag.TABLE hts_rag_ruling_passb


-- ACL hts_rag.TABLE hts_rag_ruling_scope_labels


-- ACL hts_rag.TABLE hts_rag_ruling_sentences


-- ACL hts_rag.TABLE hts_rag_rulings


-- ACL hts_rag.TABLE hts_rag_test_aliases


-- ACL hts_rag.TABLE item_classification_fact


-- ACL public.TABLE asset_designer_sheet_backup
GRANT ALL ON TABLE public.asset_designer_sheet_backup TO service_role;

-- ACL public.TABLE asset_licensor_characters
GRANT ALL ON TABLE public.asset_licensor_characters TO anon;
GRANT ALL ON TABLE public.asset_licensor_characters TO authenticated;
GRANT ALL ON TABLE public.asset_licensor_characters TO service_role;

-- ACL public.TABLE bulk_operation_runs
GRANT SELECT ON TABLE public.bulk_operation_runs TO authenticated;
GRANT SELECT,INSERT ON TABLE public.bulk_operation_runs TO service_role;

-- ACL public.TABLE dam_search_keys
GRANT ALL ON TABLE public.dam_search_keys TO service_role;

-- ACL public.TABLE hts_rag_debate_runs
GRANT SELECT,INSERT ON TABLE public.hts_rag_debate_runs TO service_role;

-- ACL public.TABLE known_designer_first_name
GRANT ALL ON TABLE public.known_designer_first_name TO service_role;

-- ACL public.TABLE pdf_text_samples_backup
GRANT ALL ON TABLE public.pdf_text_samples_backup TO service_role;

-- ACL public.TABLE sku_style_guide_links
GRANT ALL ON TABLE public.sku_style_guide_links TO service_role;
GRANT SELECT ON TABLE public.sku_style_guide_links TO authenticated;

-- ACL public.TABLE sku_style_guide_resolver_progress
GRANT ALL ON TABLE public.sku_style_guide_resolver_progress TO service_role;

-- ACL public.TABLE style_guide_file_crawl_seen
GRANT ALL ON TABLE public.style_guide_file_crawl_seen TO service_role;

-- ACL public.TABLE style_guide_file_preview_state
GRANT ALL ON TABLE public.style_guide_file_preview_state TO service_role;

-- ACL public.TABLE style_guide_search_documents
GRANT ALL ON TABLE public.style_guide_search_documents TO authenticated;
GRANT ALL ON TABLE public.style_guide_search_documents TO service_role;

-- ACL public.TABLE style_guide_pdf_text
GRANT ALL ON TABLE public.style_guide_pdf_text TO authenticated;
GRANT ALL ON TABLE public.style_guide_pdf_text TO service_role;

-- ACL public.TABLE style_guide_search_embedding_jobs
GRANT ALL ON TABLE public.style_guide_search_embedding_jobs TO service_role;

-- ACL public.TABLE style_guide_search_sync_queue
GRANT ALL ON TABLE public.style_guide_search_sync_queue TO service_role;


--
-- PostgreSQL database dump complete
--



-- existing-table rules
alter table dam.asset_character add constraint asset_character_lifecycle_chk CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))));
alter table public.hts_rag_determinations add constraint hts_rag_determinations_operative_proposed_hts_chk CHECK (((NOT operative_eligible) OR (NULLIF(btrim(proposed_hts), ''::text) IS NOT NULL)));
alter table public.hts_rag_precedents add constraint hts_rag_precedents_dual_model_provenance_chk CHECK (((promotion_basis <> 'dual_model_verified'::text) OR ((promotion_debate_run_id IS NOT NULL) AND (promotion_policy_version IS NOT NULL) AND (promotion_gate_result IS NOT NULL))));
alter table public.hts_rag_precedents add constraint hts_rag_precedents_promotion_basis_chk CHECK ((promotion_basis = ANY (ARRAY['human_review'::text, 'dual_model_verified'::text, 'legacy_unspecified'::text])));
alter table public.hts_rag_precedents add constraint hts_rag_precedents_promotion_gate_result_chk CHECK (((promotion_gate_result IS NULL) OR (jsonb_typeof(promotion_gate_result) = 'object'::text)));
alter table public.hts_rag_precedents add constraint hts_rag_precedents_promotion_policy_version_chk CHECK (((promotion_policy_version IS NULL) OR (btrim(promotion_policy_version) <> ''::text)));
alter table public.product_category_predictions add constraint product_category_predictions_item_identity_status_check CHECK ((item_identity_status = ANY (ARRAY['resolved'::text, 'unresolved'::text])));
alter table public.style_groups add constraint style_groups_item_short_description_source_check CHECK (((item_short_description_source IS NULL) OR (item_short_description_source = ANY (ARRAY['ai'::text, 'manual'::text]))));
alter table public.style_guide_crawl_runs add constraint style_guide_crawl_runs_completion_requires_reconcile CHECK ((((lifecycle_state <> 'completed'::text) AND (status IS DISTINCT FROM 'completed'::text)) OR ((reconcile_completed_at IS NOT NULL) AND (refresh_completed_at IS NOT NULL))));
alter table public.style_guide_crawl_runs add constraint style_guide_crawl_runs_guard_state_check CHECK (((guard_state IS NULL) OR (guard_state = ANY (ARRAY['ok'::text, 'empty_crawl'::text, 'inaccessible_roots'::text, 'low_nonzero'::text]))));
alter table public.style_guide_crawl_runs add constraint style_guide_crawl_runs_lifecycle_state_check CHECK ((lifecycle_state = ANY (ARRAY['pending'::text, 'ingesting'::text, 'reconciling'::text, 'refreshing'::text, 'completed'::text, 'failed'::text, 'attention_required'::text])));
alter table public.style_tracker_audit_log drop constraint if exists style_tracker_audit_log_event_type_check;
alter table public.style_tracker_audit_log add constraint style_tracker_audit_log_event_type_check CHECK ((event_type = ANY (ARRAY['row_added'::text, 'cell_update'::text, 'value_resolution'::text, 'row_deleted'::text])));
create index if not exists assets_style_group_changed_at_idx ON public.assets USING btree (style_group_changed_at, id) WHERE (is_deleted = false);
create index if not exists assets_ungrouped_style_cursor_idx ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (style_group_id IS NULL));
drop index if exists public.idx_assets_ai_tag_all_candidates;
create index if not exists idx_assets_ai_tag_all_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[5, 9])));
drop index if exists public.idx_assets_ai_tag_untagged_candidates;
create index if not exists idx_assets_ai_tag_untagged_candidates ON public.assets USING btree (primary_sort_tier, id) INCLUDE (thumbnail_url, filename, relative_path, style_group_id) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL) AND (primary_sort_tier <> ALL (ARRAY[5, 9])) AND (status <> 'tagged'::asset_status));
create index if not exists idx_assets_embed_stale_cover ON public.assets USING btree (id) INCLUDE (is_deleted, thumbnail_url);
create index if not exists idx_assets_licensing_pdf_backfill_candidates ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (file_type = 'pdf'::file_type) AND is_style_guide_source_pdf('pdf'::text, filename));
create index if not exists idx_assets_pdf_rescan_candidates ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (file_type = 'pdf'::file_type));
create index if not exists idx_assets_sku_division_active ON public.assets USING btree (sku, division_code) WHERE (is_deleted = false);
create index if not exists idx_assets_tag_pending_facets ON public.assets USING btree (id) INCLUDE (file_type, status, workflow_status, stage, is_licensed, modified_at, file_created_at) WHERE ((is_deleted = false) AND (thumbnail_url IS NULL));
create index if not exists idx_assets_tag_rls_visible_ids ON public.assets USING btree (id) WHERE (is_deleted = false);
create index if not exists idx_assets_tag_visible_facets ON public.assets USING btree (id) INCLUDE (file_type, status, workflow_status, stage, is_licensed) WHERE ((is_deleted = false) AND (thumbnail_url IS NOT NULL));
create index if not exists idx_assets_thumbnail_error_pattern ON public.assets USING btree (thumbnail_error text_pattern_ops) WHERE (thumbnail_error IS NOT NULL);
create index if not exists dam_search_documents_default_flag_cover_idx ON public.dam_search_documents USING btree (document_type, entity_id) INCLUDE (has_default_visible_member, default_visible_member_count, default_visible_min_date, asset_id, style_group_id);
create index if not exists dam_search_documents_default_visible_min_date_idx ON public.dam_search_documents USING btree (default_visible_min_date);
create index if not exists dam_search_documents_default_visible_null_idx ON public.dam_search_documents USING btree (document_type, entity_id) WHERE ((has_default_visible_member IS NULL) OR (default_visible_member_count IS NULL));
create index if not exists dam_search_embedding_claim_order_idx ON public.dam_search_documents USING btree (((document_type = 'style_group'::text)) DESC, indexed_at, document_type, entity_id) WHERE ((embedding IS NULL) AND (embedding_error_category IS DISTINCT FROM 'permanent'::text) AND (NULLIF((metadata ->> 'thumbnail_url'::text), ''::text) IS NOT NULL));
create index if not exists hts_rag_rulings_search_trgm_idx ON public.hts_rag_rulings USING gin (hts_rag_fold_text(((COALESCE(subject, ''::text) || ' '::text) || full_text)) extensions.gin_trgm_ops);
create index if not exists hts_rag_rulings_subheadings_idx ON public.hts_rag_rulings USING gin (hts_rag_tariff_subheadings(tariffs));
create index if not exists sku_sg_pdf_declared_key_idx ON public.pdf_text_samples USING btree (declared_style_guide_key, asset_id);
create index if not exists idx_product_category_predictions_plm_item_id ON public.product_category_predictions USING btree (plm_item_id) WHERE (plm_item_id IS NOT NULL);
create index if not exists render_queue_search_image_revision_idx ON public.render_queue USING btree (asset_id, completed_at DESC) WHERE ((status = 'completed'::queue_status) AND (completed_at IS NOT NULL));
create index if not exists idx_style_groups_code_format ON public.style_groups USING btree (translate(sku, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'::text, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999'::text)) WHERE ((sku COLLATE "C") ~ '^[A-Za-z0-9]{7,64}$'::text);
create index if not exists style_groups_style_group_changed_at_idx ON public.style_groups USING btree (style_group_changed_at, id);
create index if not exists idx_sgf_active_preview_category ON public.style_guide_files USING btree ((
CASE
    WHEN (thumbnail_url IS NOT NULL) THEN 'has_preview'::text
    WHEN (lower(file_extension) <> ALL (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text])) THEN 'unsupported'::text
    WHEN ((thumbnail_error IS NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text]))) THEN 'renderable_no_preview'::text
    WHEN ((thumbnail_error IS NOT NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text])) AND ((lower(thumbnail_error) = ANY (ARRAY['no_pdf_compat'::text, 'no_preview_or_render_failed'::text, 'blank_render'::text])) OR (lower(thumbnail_error) ~~ '%enoent%'::text) OR (lower(thumbnail_error) ~~ '%not found%'::text) OR (lower(thumbnail_error) ~~ '%missing%'::text) OR (lower(thumbnail_error) ~~ '%unsupported%'::text) OR (lower(thumbnail_error) ~~ '%corrupt%'::text))) THEN 'renderable_terminal'::text
    WHEN ((thumbnail_error IS NOT NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text]))) THEN 'renderable_recoverable'::text
    WHEN ((thumbnail_error IS NOT NULL) AND ((lower(thumbnail_error) = ANY (ARRAY['no_pdf_compat'::text, 'no_preview_or_render_failed'::text, 'blank_render'::text])) OR (lower(thumbnail_error) ~~ '%enoent%'::text) OR (lower(thumbnail_error) ~~ '%not found%'::text) OR (lower(thumbnail_error) ~~ '%missing%'::text) OR (lower(thumbnail_error) ~~ '%unsupported%'::text) OR (lower(thumbnail_error) ~~ '%corrupt%'::text))) THEN 'other_terminal'::text
    WHEN (thumbnail_error IS NOT NULL) THEN 'other_recoverable'::text
    ELSE 'other_unexplained'::text
END)) WHERE is_active;
create index if not exists idx_sgf_live_missing_clean_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NULL));
create index if not exists idx_sgf_live_missing_error_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NOT NULL));
create index if not exists idx_sgf_live_preview_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NOT NULL));
create index if not exists idx_sgf_reconcile_root_active_run_id ON public.style_guide_files USING btree (root_label, crawl_run_id, id) WHERE is_active;
create index if not exists idx_style_guide_files_thumbnail_live ON public.style_guide_files USING btree (id) INCLUDE (is_active) WHERE (thumbnail_url IS NOT NULL);
create unique index if not exists sgfolders_licensor_property_uidx ON public.style_guide_folders USING btree (licensor_name, property_folder) NULLS NOT DISTINCT;
CREATE OR REPLACE FUNCTION public.apply_sheet_designers(p_asset_id uuid, p_creative text, p_technical text, OUT c integer, OUT t integer)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_creative text := NULLIF(btrim(p_creative), '');
  v_technical text := NULLIF(btrim(p_technical), '');
  v_cur public.assets%ROWTYPE;
BEGIN
  c := 0; t := 0;
  IF NOT public.is_known_designer_value(v_creative) THEN v_creative := NULL; END IF;
  IF NOT public.is_known_designer_value(v_technical) THEN v_technical := NULL; END IF;

  SELECT * INTO v_cur FROM public.assets a WHERE a.id = p_asset_id;
  IF NOT FOUND OR NOT public.is_style_guide_source_pdf(v_cur.file_type::text, v_cur.filename) THEN RETURN; END IF;

  IF v_creative IS NOT NULL AND v_cur.designer_name IS DISTINCT FROM v_creative THEN c := 1; END IF;
  IF v_technical IS NOT NULL AND v_cur.technical_designer_name IS DISTINCT FROM v_technical THEN t := 1; END IF;
  IF c = 0 AND t = 0 THEN RETURN; END IF;

  INSERT INTO public.asset_designer_sheet_backup (asset_id, designer_name, technical_designer_name)
  VALUES (p_asset_id, v_cur.designer_name, v_cur.technical_designer_name)
  ON CONFLICT (asset_id) DO NOTHING;

  UPDATE public.assets a SET
    designer_name = CASE WHEN c = 1 THEN v_creative ELSE a.designer_name END,
    technical_designer_name = CASE WHEN t = 1 THEN v_technical ELSE a.technical_designer_name END
  WHERE a.id = p_asset_id;
END;
$function$
;
grant execute on function apply_sheet_designers(uuid,text,text) to service_role;
CREATE OR REPLACE FUNCTION public.dam_asset_matches_filters(p_id uuid, p_is_deleted boolean, p_modified_at timestamp with time zone, p_file_created_at timestamp with time zone, p_thumbnail_url text, p_style_group_id uuid, p_licensor_id uuid, p_sg_licensor_id uuid, p_property_id uuid, p_sg_property_id uuid, p_customer_id uuid, p_sg_customer_id uuid, p_file_type file_type, p_content_type text, p_product_material text[], p_status asset_status, p_workflow_status workflow_status, p_stage text, p_is_licensed boolean, p_asset_type asset_type, p_art_source art_source, p_thumbnail_error text, p_product_category text, p_relative_path text, p_customer text, p_program text, p_filters jsonb, p_min_date timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  select not p_is_deleted
      and (p_modified_at >= p_min_date or p_file_created_at >= p_min_date or p_thumbnail_url is not null)
      and (nullif(p_filters->>'licensorId','') is null or case when p_style_group_id is null then p_licensor_id else p_sg_licensor_id end=(p_filters->>'licensorId')::uuid)
      and (nullif(p_filters->>'propertyId','') is null or case when p_style_group_id is null then p_property_id else p_sg_property_id end=(p_filters->>'propertyId')::uuid)
      and (nullif(p_filters->>'customerId','') is null or case when p_style_group_id is null then p_customer_id else p_sg_customer_id end=(p_filters->>'customerId')::uuid)
      and (nullif(p_filters->>'tagFilter','') is null or exists(select 1 from public.asset_effective_tags e where e.asset_id=p_id and e.tag=p_filters->>'tagFilter'))
      and (jsonb_array_length(coalesce(p_filters->'fileType','[]'))=0 or p_file_type::text in(select jsonb_array_elements_text(p_filters->'fileType')))
      and (jsonb_array_length(coalesce(p_filters->'contentType','[]'))=0 or p_content_type in(select jsonb_array_elements_text(p_filters->'contentType')))
      and (jsonb_array_length(coalesce(p_filters->'productMaterial','[]'))=0 or p_product_material && array(select jsonb_array_elements_text(p_filters->'productMaterial')))
      and (jsonb_array_length(coalesce(p_filters->'status','[]'))=0 or p_status::text in(select jsonb_array_elements_text(p_filters->'status')))
      and (jsonb_array_length(coalesce(p_filters->'workflowStatus','[]'))=0 or p_workflow_status::text in(select jsonb_array_elements_text(p_filters->'workflowStatus')))
      and (jsonb_array_length(coalesce(p_filters->'stage','[]'))=0 or p_stage in(select jsonb_array_elements_text(p_filters->'stage')))
      and ((p_filters->>'isLicensed') is null or p_is_licensed=(p_filters->>'isLicensed')::boolean)
      and (jsonb_array_length(coalesce(p_filters->'assetType','[]'))=0 or p_asset_type::text in(select jsonb_array_elements_text(p_filters->'assetType')))
      and (jsonb_array_length(coalesce(p_filters->'artSource','[]'))=0 or p_art_source::text in(select jsonb_array_elements_text(p_filters->'artSource')))
      and (jsonb_array_length(coalesce(p_filters->'fileStatus','[]'))=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'fileStatus') fs where
        (fs='has_preview' and p_thumbnail_url is not null) or
        (fs='no_preview_renderable' and p_thumbnail_url is null and p_thumbnail_error is null) or
        (fs='no_pdf_compat' and p_thumbnail_url is null and p_thumbnail_error='no_pdf_compat') or
        (fs='no_preview_unsupported' and p_thumbnail_url is null and p_thumbnail_error='no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(p_filters->'productCategory','[]'))=0 or p_product_category in(select jsonb_array_elements_text(p_filters->'productCategory')) or
        ('Wall' in(select jsonb_array_elements_text(p_filters->'productCategory')) and (p_relative_path ilike '%WALL ART%' or p_relative_path ilike '%3FZ%')))
      and (nullif(p_filters->>'customer','') is null or p_customer=p_filters->>'customer')
      and (nullif(p_filters->>'program','') is null or p_program=p_filters->>'program')
$function$
;
grant execute on function dam_asset_matches_filters(uuid,boolean,timestamp with time zone,timestamp with time zone,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,file_type,text,text[],asset_status,workflow_status,text,boolean,asset_type,art_source,text,text,text,text,text,jsonb,timestamp with time zone) to service_role;
revoke all on function public.apply_sheet_designers(uuid,text,text) from public, anon, authenticated;
grant execute on function public.apply_sheet_designers(uuid,text,text) to service_role;

-- plm sku_sg triggers (call public functions created above)
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF file_name, sku_sg_file_key ON plm.dcp_asset FOR EACH ROW EXECUTE FUNCTION sku_sg_file_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF folder_name, sku_sg_label_key ON plm.dcp_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_folder_name_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF file_name, sku_sg_file_key ON plm.lucasfilm_dcp_asset FOR EACH ROW EXECUTE FUNCTION sku_sg_file_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF folder_name, sku_sg_label_key ON plm.lucasfilm_dcp_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_folder_name_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF exact_filename, sku_sg_file_key ON plm.marvel_asgard_node_asset_observation FOR EACH ROW EXECUTE FUNCTION sku_sg_file_exact_filename_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF exact_label, sku_sg_label_key ON plm.marvel_asgard_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_exact_label_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF file_name, sku_sg_file_key ON plm.marvel_dcp_asset FOR EACH ROW EXECUTE FUNCTION sku_sg_file_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF folder_name, sku_sg_label_key ON plm.marvel_dcp_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_folder_name_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF file_name, sku_sg_file_key ON plm.nbcu_asset FOR EACH ROW EXECUTE FUNCTION sku_sg_file_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF style_guide_label, sku_sg_label_key ON plm.nbcu_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_style_guide_label_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF file_name, sku_sg_file_key ON plm.peanuts_asset FOR EACH ROW EXECUTE FUNCTION sku_sg_file_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF value_label, sku_sg_label_key ON plm.peanuts_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_value_label_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF original_file_name, sku_sg_file_key ON plm.sesame_asset FOR EACH ROW EXECUTE FUNCTION sku_sg_file_original_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF value_label, sku_sg_label_key ON plm.sesame_style_guide FOR EACH ROW EXECUTE FUNCTION sku_sg_label_value_label_key();
CREATE TRIGGER sku_sg_file_key BEFORE INSERT OR UPDATE OF file_name, sku_sg_file_key ON plm.wb_asset_normalized FOR EACH ROW EXECUTE FUNCTION sku_sg_file_file_name_key();
CREATE TRIGGER sku_sg_label_key BEFORE INSERT OR UPDATE OF label, sku_sg_label_key ON plm.wb_style_guide_normalized FOR EACH ROW EXECUTE FUNCTION sku_sg_label_label_key();
