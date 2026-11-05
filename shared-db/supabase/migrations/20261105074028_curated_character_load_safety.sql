-- Reissue for #5592: preserve both originals and their evidence; apply this version only.
-- Forward-only repair for #5592 and popdam3#680; no licensed names embedded.
-- Curated row load. Read sources: the two existing licensor style-guide source tables,
-- plm.coke_tag, and core.*. No temporary DDL, session changes, or truncated aliases.
-- Existing migration remains immutable; this repair removes only its own unsafe aliases.
-- Recovery: rows carry issue+actor markers and source refs; preserve source identities.
do $characters$
declare
  v_issue constant text := 'popdam3#680';
  v_actor constant text := 'shared-db migration 20261105074028';
  v_meta jsonb := jsonb_build_object('loaded_by', v_actor, 'issue', v_issue);
  v_cast constant uuid := '74225803-7815-48ae-a6cb-9ed38a8f8e43';
  v_clear constant uuid := '16f856cb-92c2-4d85-ba4b-c7f65d9f0ed0';
  v_nb uuid;
  candidate record;
  v_id uuid;
  v_alias record;
  v_alias_id uuid;
  v_evidence jsonb;
  v_source_alias text;
begin
  select id into v_nb from core.licensor where code = 'NB';
  if exists (select 1 from public.style_guide_files where is_active and licensor_name = 'NBC UNIVERSAL') then
    if v_nb is null or not exists (select 1 from public.style_guide_pdf_text where style_guide_file_id=v_cast and status='extracted')
      or not exists (select 1 from public.style_guide_pdf_text where style_guide_file_id=v_clear and status='extracted') then
      raise exception 'Character load source prerequisites absent; no partial load';
    end if;
  end if;
  for candidate in
  select v_nb as licensor_id, l.name, 'pop_style_guides:nb:' || l.key as code,
         'pop_style_guides'::text as source_system, 'public.style_guide_files'::text as source_table,
         'nb:' || l.key as source_id
    from (
    select n.key,
           coalesce(initcap((regexp_match(t.extracted_text, E'\n(' || upper(n.key) || E' [A-Z]+)\n'))[1]),
                    initcap(regexp_replace(n.best, '([a-z])([A-Z])', '\1 \2', 'g'))) as name
      from (
    select key, sum(n) as total,
           (array_agg(tok order by (tok ~ '[a-z][A-Z]') desc, n desc, tok))[1] as best
      from (
    select lower(tok) as key, tok, count(*) as n from (
    select split_part(f.relative_path, '/', 2) as folder,
           (regexp_match(f.filename, '(?:^|[-_])(?:char[a-z-]*|cg|line-[a-z]+|ph|fs|kawaii)-s_([A-Za-z]+)_', 'i'))[1] as tok
      from public.style_guide_files f
     where f.is_active and f.licensor_name = 'NBC UNIVERSAL'
       and split_part(f.relative_path, '/', 2) in (
         'Kung Fu Panda', 'Gabby’s Dollhouse', 'Shrek', 'Jurassic World Franchise', 'Jurassic Park',
         'How To Train Your Dragon', 'Minions', 'DO NOT USE Chucky', 'Office', 'Trolls',
         'Wicked Live Action Movie', 'Wicked Live Action Part 2', 'Jaws', 'Happy Gilmore', 'BTTF',
         'Curious George', 'Santa Claus is Coming to Town', 'Wheres Waldo', 'ET')) files where tok is not null group by 1, 2) keyed group by key) n
      left join public.style_guide_pdf_text t on t.style_guide_file_id = v_cast and t.status = 'extracted'
     where n.total >= 2 and not exists (select 1 from (
    select unnest(array['group','boy','baby','carriage','dollhouse','red','dragon','cowboy','ranger',
      'panda','minion','lion','lioncub','alligator','caddy','delorean','gorilla','rhino','ox','croc',
      'wolf','boxcatmama','raptor','triceratopsadult','triceratopsbaby','raptorblue','indominusrex']) as key) g where g.key = n.key)) l
   where v_nb is not null
     and not exists (select 1 from core.character c where c.licensor_id = v_nb
                      and (regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(l.name), '[^a-z0-9]', '', 'g')
                           or split_part(lower(c.name), ' ', 1) = l.key))
  union all
  select v_nb, m.name, 'pop_style_guides:nb:' || lower(replace(m.name, ' ', '')), 'pop_style_guides',
         'public.style_guide_pdf_text', 'nb:' || lower(replace(m.name, ' ', ''))
    from (select (regexp_match(t.extracted_text, 'Many Moods of ([A-Z][a-z]+ [A-Z][a-z]+)'))[1] as name
            from public.style_guide_pdf_text t where t.style_guide_file_id = v_clear and t.status = 'extracted') m
   where v_nb is not null and m.name is not null
  union all
  select l.id, btrim(t.exact_label), 'coke:' || t.tag_key, 'coke', 'plm.coke_tag', t.tag_key
    from (select distinct on (tag_key) tag_key, exact_label from plm.coke_tag
           where tag_key in ('exact-label-sha256:17d9a126bfb6ade052b4fde57736510a785a45472568fa00adaf218f5cbd4d62',
                             'exact-label-sha256:62f6a663b51a072fc9503a7b38c224366fd8783cf7d0f12a1014a8e80d179353',
                             'exact-label-sha256:6c01765bba89b448e7d4d74bcb400439c0e367e72a4715a42c4acea4252f80b7')
           order by tag_key, capture_id) t
    join core.licensor l on l.code = 'CC'
  loop
    v_id := null;
    v_evidence := '{}'::jsonb;
    v_source_alias := null;
    if candidate.source_system='pop_style_guides' then
      select jsonb_build_object('files',coalesce(jsonb_agg(jsonb_build_object('id',f.id,'path',f.relative_path,'filename',f.filename,'property_folder',split_part(f.relative_path,'/',2))),'[]'::jsonb), 'confidence','verified'), min((regexp_match(f.filename,'(?:^|[-_])(?:char[a-z-]*|cg|line-[a-z]+|ph|fs|kawaii)-s_([A-Za-z]+)_','i'))[1])
      into v_evidence,v_source_alias from public.style_guide_files f
      where f.is_active and f.licensor_name='NBC UNIVERSAL' and
        (lower((regexp_match(f.filename,'(?:^|[-_])(?:char[a-z-]*|cg|line-[a-z]+|ph|fs|kawaii)-s_([A-Za-z]+)_','i'))[1])=split_part(candidate.source_id,':',2)
         or (candidate.source_table='public.style_guide_pdf_text' and f.id=v_clear));
    end if;
    select id into v_id from core.character where licensor_id=candidate.licensor_id and code=candidate.code;
    if v_id is null then
      if (select count(*) from core.character where licensor_id=candidate.licensor_id and lower(name)=lower(candidate.name))>1 then
        raise exception 'Multiple canonical characters match source name; refusing ambiguous link';
      end if;
      select id into v_id from core.character where licensor_id=candidate.licensor_id and lower(name)=lower(candidate.name);
    end if;
    if v_id is null then
      insert into core.character (licensor_id,name,code,status,metadata)
      values (candidate.licensor_id,candidate.name,candidate.code,'active',v_meta || coalesce(v_evidence,'{}'::jsonb) || jsonb_build_object('source_system',candidate.source_system,'source_table',candidate.source_table,'source_id',candidate.source_id))
      returning id into v_id;
    end if;
    if v_id is null then raise exception 'Character load produced no target'; end if;
    -- An NBC alias is the exact source filename label, never a truncated canonical name.
    -- If another record already owns that label, leave it untouched and abstaicandidate.
    if v_source_alias is not null and lower(v_source_alias)<>lower(candidate.name)
      and not exists (select 1 from core.character_alias where lower(alias)=lower(v_source_alias)) then
      insert into core.character_alias(character_id,licensor_id,alias,source_system,source_id,evidence_notes)
      values(v_id,candidate.licensor_id,v_source_alias,'pop_style_guides',candidate.source_id,'Exact character token from licensor-issued filename; full canonical name retained');
    end if;
    if exists (select 1 from core.taxonomy_source_ref where source_system=candidate.source_system and source_table=candidate.source_table and source_id=candidate.source_id and entity_id<>v_id) then
      raise exception 'Character source identity already belongs to another entity';
    end if;
    insert into core.taxonomy_source_ref (entity_schema,entity_table,entity_id,source_system,source_table,source_id,source_name,confidence,raw)
    values ('core','character',v_id,candidate.source_system,candidate.source_table,candidate.source_id,candidate.name,'verified',v_meta || coalesce(v_evidence,'{}'::jsonb))
    on conflict (source_system,source_table,source_id) do nothing;
  end loop;
  -- Never truncate decorated portal labels into bare character-name aliases.
  for v_alias in select a.id from core.character_alias a
  where a.source_system='disney_dcpvault' and a.source_id like 'popdam3#680:%'
    and a.evidence_notes='First word of the portal label; portal shows this character on the expected Property'
  loop
    v_alias_id := v_alias.id;
    delete from core.character_alias where id=v_alias_id;
  end loop;
end
$characters$;
