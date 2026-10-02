-- Issue #3911 behavioural contracts: a dam.pdf_rich_extraction row follows its
-- asset to the asset's current style group, through both a direct regroup and
-- a public.style_groups delete (ON DELETE SET NULL) followed by re-assignment.
-- Synthetic rows are rolled back; nothing survives this test.

begin;

do $contract$
declare
  g1 uuid; g2 uuid; g3 uuid; a1 uuid; a2 uuid;
  v uuid; rm jsonb;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.assets'::regclass
      and tgname = 'trg_assets_sync_pdf_rich_extraction_group'
      and tgfoid = 'dam.sync_pdf_rich_extraction_style_group()'::regprocedure
      and tgenabled = 'O'
      and tgtype = 17 -- row-level AFTER UPDATE
      and tgqual is not null
      and array_length(tgattr::int2[], 1) = 1
      and (select attnum from pg_attribute where attrelid = 'public.assets'::regclass and attname = 'style_group_id') = all (tgattr::int2[])
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.assets'::regclass
      and tgname = 'trg_assets_rollup_pdf_rich_extraction_groups'
      and tgfoid = 'dam.rollup_moved_pdf_rich_extraction_groups()'::regprocedure
      and tgenabled = 'O'
      and tgtype = 16 -- statement-level AFTER UPDATE
      and array_length(tgattr::int2[], 1) = 1
      and (select attnum from pg_attribute where attrelid = 'public.assets'::regclass and attname = 'style_group_id') = all (tgattr::int2[])
  ) then
    raise exception '#3911: triggers missing or wrong shape';
  end if;

  insert into public.style_groups (sku, folder_path) values ('T3911A', '/t3911/a') returning id into g1;
  insert into public.style_groups (sku, folder_path) values ('T3911B', '/t3911/b') returning id into g2;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id)
    values ('t3911.pdf', 't3911/t3911.pdf', 'pdf', 't3911', now(), g1) returning id into a1;
  insert into dam.pdf_rich_extraction (asset_id, style_group_id, doc_kind, data)
    values (a1, g1, 'tech_pack', '{"production_specs":{"materials":["CANVAS"]}}');
  perform public.refresh_style_group_rich_metadata(g1);

  -- 1. direct regroup
  update public.assets set style_group_id = g2 where id = a1;
  select style_group_id into v from dam.pdf_rich_extraction where asset_id = a1;
  if v is distinct from g2 then raise exception '#3911: regroup did not re-point extraction (got %)', v; end if;
  select rich_metadata into rm from public.style_groups where id = g2;
  if rm is null then raise exception '#3911: new group was not rolled up'; end if;
  select rich_metadata into rm from public.style_groups where id = g1;
  if rm is not null then raise exception '#3911: old group kept stale rich_metadata'; end if;

  -- 2. unrelated update is a no-op for the extraction row
  update public.assets set filename = 't3911b.pdf' where id = a1;
  select style_group_id into v from dam.pdf_rich_extraction where asset_id = a1;
  if v is distinct from g2 then raise exception '#3911: unrelated update moved extraction'; end if;

  -- 2b. two assets of one group moved in one statement: both rows follow
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id)
    values ('t3911c.pdf', 't3911/t3911c.pdf', 'pdf', 't3911c', now(), g2) returning id into a2;
  insert into dam.pdf_rich_extraction (asset_id, style_group_id, doc_kind, data)
    values (a2, g2, 'licensing_sheet', '{"legal":{"copyright":["T3911"]}}');
  update public.assets set style_group_id = g1 where id in (a1, a2);
  if (select count(*) from dam.pdf_rich_extraction where asset_id in (a1, a2) and style_group_id = g1) <> 2 then
    raise exception '#3911: bulk move did not re-point both rows';
  end if;
  select rich_metadata into rm from public.style_groups where id = g1;
  if rm is null or rm #>> '{legal,copyright,0}' is distinct from 'T3911'
     or rm #>> '{production_specs,materials,0}' is distinct from 'CANVAS' then
    raise exception '#3911: bulk move did not roll up both extractions';
  end if;
  update public.assets set style_group_id = g2 where id in (a1, a2);

  -- 3. group delete (SET NULL) then re-assignment to a recreated group
  delete from public.style_groups where id = g2;
  select style_group_id into v from dam.pdf_rich_extraction where asset_id = a1;
  if v is not null then raise exception '#3911: SET NULL did not clear extraction group (got %)', v; end if;
  insert into public.style_groups (sku, folder_path) values ('T3911B', '/t3911/b') returning id into g3;
  update public.assets set style_group_id = g3 where id = a1;
  select style_group_id into v from dam.pdf_rich_extraction where asset_id = a1;
  if v is distinct from g3 then raise exception '#3911: recreated group not linked (got %)', v; end if;
  select rich_metadata into rm from public.style_groups where id = g3;
  if rm is null or rm #>> '{production_specs,materials,0}' is distinct from 'CANVAS' then
    raise exception '#3911: recreated group lost spec-sheet data';
  end if;
end;
$contract$;

rollback;
