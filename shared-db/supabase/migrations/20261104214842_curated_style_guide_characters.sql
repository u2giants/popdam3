-- popdam3#680: Characters missing from licensor style guides and the Coca-Cola portal.
-- Curated Master Data (owner-rulings 6.4): insert-only, genuinely new rows. Owner rulings,
-- Albert Hazan: 2026-10-29 "licensor scrape is authoritative"; 2026-11-02 "Fix the missing
-- characters". NO LICENSED CHARACTER NAMES ARE IN THIS FILE: every name is read at apply
-- time from licensor-issued records already in this database, by key or generic pattern.
--
-- NBC. Licensor style-guide art names single-character files '<style>-s_<name>_NN'. A name
-- needs at least two files in a folder of a live NBC Property, and is skipped when an NBC
-- Character already has it. Where the guide's cast page gives a full name, that wins.
-- COCA-COLA. Three portal tags, by their stable sha256 key.
-- DISNEY. Two aliases: the first word of a portal character label, by character id.
--
-- Skips quietly where the sources are empty (test and preview databases).
-- RECOVERY: delete core.character_alias rows whose source_id starts 'popdam3#680:', then
-- core.taxonomy_source_ref and core.character rows whose marker issue matches.

do $characters$
declare
  v_issue constant text := 'popdam3#680';
  v_actor constant text := 'shared-db migration 20261104214842';
  v_meta jsonb := jsonb_build_object('loaded_by', v_actor, 'issue', v_issue);
  v_cast constant uuid := '74225803-7815-48ae-a6cb-9ed38a8f8e43';  -- one guide's cast page
  v_clear constant uuid := '16f856cb-92c2-4d85-ba4b-c7f65d9f0ed0'; -- cleared-editorial list
  v_nb uuid;
begin
  select id into v_nb from core.licensor where code = 'NB';

  create temporary table new_chars on commit drop as
  with files as (
    select split_part(f.relative_path, '/', 2) as folder,
           (regexp_match(f.filename, '(?:^|[-_])(?:char[a-z-]*|cg|line-[a-z]+|ph|fs|kawaii)-s_([A-Za-z]+)_', 'i'))[1] as tok
      from public.style_guide_files f
     where f.is_active and f.licensor_name = 'NBC UNIVERSAL'
       and split_part(f.relative_path, '/', 2) in (
         'Kung Fu Panda', 'Gabby’s Dollhouse', 'Shrek', 'Jurassic World Franchise', 'Jurassic Park',
         'How To Train Your Dragon', 'Minions', 'DO NOT USE Chucky', 'Office', 'Trolls',
         'Wicked Live Action Movie', 'Wicked Live Action Part 2', 'Jaws', 'Happy Gilmore', 'BTTF',
         'Curious George', 'Santa Claus is Coming to Town', 'Wheres Waldo', 'ET')
  ), keyed as (
    select lower(tok) as key, tok, count(*) as n from files where tok is not null group by 1, 2
  ), names as (
    select key, sum(n) as total,
           (array_agg(tok order by (tok ~ '[a-z][A-Z]') desc, n desc, tok))[1] as best
      from keyed group by key
  ), generic as (
    select unnest(array['group','boy','baby','carriage','dollhouse','red','dragon','cowboy','ranger',
      'panda','minion','lion','lioncub','alligator','caddy','delorean','gorilla','rhino','ox','croc',
      'wolf','boxcatmama','raptor','triceratopsadult','triceratopsbaby','raptorblue','indominusrex']) as key
  ), labelled as (
    select n.key,
           coalesce(initcap((regexp_match(t.extracted_text, E'\n(' || upper(n.key) || E' [A-Z]+)\n'))[1]),
                    initcap(regexp_replace(n.best, '([a-z])([A-Z])', '\1 \2', 'g'))) as name
      from names n
      left join public.style_guide_pdf_text t on t.style_guide_file_id = v_cast and t.status = 'extracted'
     where n.total >= 2 and not exists (select 1 from generic g where g.key = n.key)
  )
  select v_nb as licensor_id, l.name, 'pop_style_guides:nb:' || l.key as code,
         'pop_style_guides'::text as source_system, 'public.style_guide_files'::text as source_table,
         'nb:' || l.key as source_id
    from labelled l
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
    join core.licensor l on l.code = 'CC';

  insert into core.character (licensor_id, name, code, status, metadata)
  select n.licensor_id, n.name, n.code, 'active',
         v_meta || jsonb_build_object('source_system', n.source_system, 'source_table', n.source_table, 'source_id', n.source_id)
    from new_chars n
  on conflict do nothing;

  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, n.source_system, n.source_table, n.source_id, ch.name, 'verified', v_meta
    from new_chars n
    join core.character ch on ch.licensor_id = n.licensor_id and ch.code = n.code
  on conflict (source_system, source_table, source_id) do nothing;

  insert into core.character_alias (character_id, licensor_id, alias, source_system, source_id, evidence_notes)
  select c.id, c.licensor_id, split_part(c.name, ' ', 1), 'disney_dcpvault', 'popdam3#680:' || (c.metadata ->> 'source_id'),
         'First word of the portal label; portal shows this character on the expected Property'
    from core.character c
   where c.id in ('f1225156-12bd-4044-a9c8-354a1ebbd815', 'daa08961-63e7-4568-adcb-1424037c607c')
  on conflict do nothing;
end
$characters$;
