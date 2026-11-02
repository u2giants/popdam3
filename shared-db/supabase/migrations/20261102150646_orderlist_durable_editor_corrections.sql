-- Durable source-bound ordinary editor corrections, #5403 / claim #5404.
-- derived-from: 20260831045020
begin;
CREATE OR REPLACE FUNCTION public.update_dam_order(p_order_id uuid, p_order_patch jsonb DEFAULT '{}'::jsonb, p_line_patches jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plm', 'public', 'core', 'app', 'pg_temp'
AS $function$
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
$function$;

comment on function public.link_dam_order_line(uuid,uuid,text) is
  'Manual exact item-link resolution through plm.style_tracker_item_bridge. Requires an exact, unique licensed/generic-qualified SKU match, never fuzzy. Ordinary SKU/catalog editor corrections also re-resolve the link under the same unique style/catalog rule in update_dam_order; source intake has its separately guarded exact linking path.';

commit;
