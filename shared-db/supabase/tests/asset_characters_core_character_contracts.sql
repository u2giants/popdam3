-- Verification for migration 20261225091203_asset_characters_core_character (popcre/shared-db#6995).
-- Proves: public.asset_characters.character_id references core.character, no
-- link is orphaned, dam.character_usage exists with RLS and the agreed grants,
-- and the search builders no longer read public.characters. Rolls back.
begin;

do $$
declare
  v_orphans bigint;
  v_asset uuid := gen_random_uuid();
  v_char uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asset_characters'::regclass and contype = 'f'
      and conname = 'asset_characters_character_id_fkey'
      and confrelid = 'core.character'::regclass) then
    raise exception 'asset_characters.character_id must reference core.character';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.asset_characters'::regclass and contype = 'f'
      and confrelid = 'public.characters'::regclass) then
    raise exception 'asset_characters must not reference public.characters';
  end if;

  select count(*) into v_orphans
  from public.asset_characters ac
  left join core.character c on c.id = ac.character_id
  where c.id is null;
  if v_orphans <> 0 then
    raise exception 'asset_characters has % orphan links', v_orphans;
  end if;

  if to_regclass('archive.asset_characters_before_core_character_20261124') is null then
    raise exception 'archive snapshot missing';
  end if;

  if to_regclass('dam.character_usage') is null then
    raise exception 'dam.character_usage missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'dam.character_usage'::regclass) then
    raise exception 'dam.character_usage must have RLS enabled';
  end if;
  if (select confrelid from pg_constraint
      where conrelid = 'dam.character_usage'::regclass and contype = 'f') <> 'core.character'::regclass then
    raise exception 'dam.character_usage must reference core.character';
  end if;
  if not has_table_privilege('authenticated', 'dam.character_usage', 'select')
     or has_table_privilege('authenticated', 'dam.character_usage', 'insert')
     or has_table_privilege('anon', 'dam.character_usage', 'select')
     or not has_table_privilege('service_role', 'dam.character_usage', 'insert') then
    raise exception 'dam.character_usage grants wrong';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in ('dam.search_text_embedding_input',
      'public.refresh_dam_search_style_group_document', 'public.refresh_dam_search_asset_document')
      and p.prosrc like '%public.characters%') then
    raise exception 'search builders still read public.characters';
  end if;

  -- A core character id is accepted, cascades on delete, and its name reaches search text.
  insert into core.character (id, name) values (v_char, 'zz6995 core character');
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, file_created_at)
    values (v_asset, 'zz6995.pdf', 'zz6995/zz6995.pdf', 'pdf', 'zz6995', now(), now());
  insert into public.asset_characters (asset_id, character_id) values (v_asset, v_char);
  perform public.refresh_dam_search_asset_document(v_asset);
  if position('zz6995 core character' in
      (select search_text from public.dam_search_documents where document_type = 'asset' and entity_id = v_asset)) = 0 then
    raise exception 'core character name missing from asset search text';
  end if;
  delete from core.character where id = v_char;
  if exists (select 1 from public.asset_characters where character_id = v_char) then
    raise exception 'deleting a core.character must cascade to asset_characters';
  end if;
end $$;

rollback;
