-- Issue popcre/shared-db#5079: real Characters for Disney (DY), Star Wars (SW), Peanuts (PN)
-- and Sega (SE), plus Disney Property/Character links.
--
-- Owner rulings, Albert Hazan (verbatim): 2026-10-29 "licensor scrape is authoritative";
-- 2026-11-02 "Fix the missing characters". The second supersedes the Tier 3 exclusion in
-- docs/core-character-backfill-source-decision-20260902.md for the Peanuts and Sega labels.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- WHY. The OPA load gave Disney many titles and collections, and Star Wars almost nothing.
-- DCP vault character ids carry the portal's own character slug, the only name it captured.
--
-- SW keeps only characters the portal shows on a Star Wars asset (that vault also holds
-- crossover Disney characters). SE drops labels that describe art rather than a character.
-- DISNEY LINKS. A DY Property links to a DCP Property when every word of its name is in the
-- portal's Property slug; links are co_occurrence evidence from assets tagged with both, top
-- 120 per Property with at least two assets. They only narrow the list offered to the tagger,
-- so they stay source edges: core.property_character_associations requires direct evidence.
--
-- Insert-only and idempotent. RECOVERY: retire edges whose metadata issue
-- and loaded_by match, then remove the characters and source refs with the same marker.

create function pg_temp.slug_name(p_slug text) returns text language plpgsql immutable as $fn$
declare
  v_out text := '';
  v_word text;
  v_part text;
begin
  foreach v_word in array string_to_array(p_slug, '-') loop
    continue when v_word = '';
    if v_word = 's' and v_out <> '' then v_out := v_out || '''s'; continue; end if;
    v_part := case
      when v_word ~ '[0-9]' or v_word in ('ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix') then upper(v_word)
      when v_word ~ '^mc[a-z]' then 'Mc' || initcap(substr(v_word, 3))
      when v_word = 'de' and v_out <> '' then 'de'
      else initcap(v_word) end;
    -- Codes keep their hyphen: a short prefix before a digit token, as the slug has it.
    if v_word ~ '[0-9]' and length(v_out) > 0 and split_part(v_out, ' ', -1) ~ '^[A-Za-z0-9]{1,2}$' then
      v_out := regexp_replace(v_out, '[^ ]+$', upper(split_part(v_out, ' ', -1))) || '-' || v_part;
    else
      v_out := btrim(v_out || ' ' || v_part);
    end if;
  end loop;
  return regexp_replace(v_out, ' The$', '');
end
$fn$;

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261103005035';
  v_meta jsonb := jsonb_build_object('loaded_by', v_actor, 'issue', v_issue);
begin
  create temporary table pg_temp.new_chars on commit drop as
  select l.id as licensor_id, s.name, s.source_system || ':' || s.source_id as code, s.source_system, s.source_table, s.source_id
    from (
      select 'DY' as lic, c.source_system, 'plm.dcp_character' as source_table, c.source_id,
             pg_temp.slug_name(regexp_replace(split_part(c.source_id, '/', 3), '-disney-(pooh|princess)$', '')) as name
        from plm.dcp_character c
       where split_part(c.source_id, '/', 3) !~ '^(unnamed-character|aliens-as-)'
      union all
      select 'SW', c.source_system, 'plm.lucasfilm_dcp_character', c.source_id,
             pg_temp.slug_name(split_part(c.source_id, '/', 3))
        from plm.lucasfilm_dcp_character c
       where split_part(c.source_id, '/', 3) !~ '^unnamed-character'
         and exists (select 1 from plm.lucasfilm_dcp_asset_character_observation co
                       join plm.lucasfilm_dcp_asset_property_observation po
                         on po.lucasfilm_dcp_asset_id = co.lucasfilm_dcp_asset_id and po.fetch_status = 'success'
                       join plm.lucasfilm_dcp_property p on p.id = po.lucasfilm_dcp_property_id
                      where co.lucasfilm_dcp_character_id = c.id and co.fetch_status = 'success'
                        and split_part(p.source_id, '/', 3) ~ '^(star-wars|clone-wars|rebels|maul)')
      union all
      select 'PN', 'peanuts', 'plm.peanuts_character', c.value_key, btrim(c.value_label)
        from plm.peanuts_character c
       where c.capture_id = (select id from plm.peanuts_capture where status = 'complete' order by load_completed_at desc limit 1)
         and btrim(c.value_label) !~* '^unnamed'
      union all
      select 'SE', 'sega', 'plm.sega_character_candidate', c.character_candidate_key, btrim(c.candidate_label)
        from plm.sega_character_candidate c
       where c.capture_id = (select id from plm.sega_capture where status = 'complete' order by load_completed_at desc limit 1)
         and c.candidate_label !~ '&'
         and c.candidate_label !~* '(^| )(2d|3d|cg|cgi|cmyk|rgb|pantone|vector|line art|icon|pixel|poster|illos?|illustrated|color|text|turnarounds?|stage|poses?|size chart|character art|themes?|groups?|guide|exp|sb)( |$)'
         and c.candidate_label !~* '^(additional|athletic|b&w|baby|baseball|baseketball|basketball|bosses enemies|easter|enemies|enemy|football|halloween|heroes|holidays?|monsters|motion|people|primary|snowboarding|soccer|sports|transformation|winning|extra)'
    ) s
    join core.licensor l on l.code = s.lic
   where nullif(btrim(s.name), '') is not null;

  insert into core.character (licensor_id, name, code, status, metadata)
  select n.licensor_id, n.name, n.code, 'active',
         v_meta || jsonb_build_object('source_system', n.source_system, 'source_table', n.source_table, 'source_id', n.source_id)
    from pg_temp.new_chars n
  on conflict do nothing;

  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, n.source_system, n.source_table, n.source_id, ch.name,
         -- Peanuts labels are a licensor search vocabulary; Sega labels are derived candidates.
         (case n.source_system when 'peanuts' then 'probable' when 'sega' then 'possible' else 'verified' end)::app.source_confidence, v_meta
    from pg_temp.new_chars n
    join core.character ch on ch.licensor_id = n.licensor_id and ch.code = n.code
  on conflict (source_system, source_table, source_id) do nothing;

  -- plm.source_resolution supports the two DCP vaults only.
  perform plm.set_source_resolution(n.source_system, 'character', n.source_id, 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from pg_temp.new_chars n
     join core.character ch on ch.licensor_id = n.licensor_id and ch.code = n.code
    where n.source_system in ('disney_dcpvault', 'lucasfilm_dcpvault')
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = n.source_system and r.entity_kind = 'character'
                         and r.source_id = n.source_id and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  create temporary table pg_temp.disney_links on commit drop as
  with cp as (
    select p.id, array(select regexp_replace(regexp_replace(t, 'esses$', 'ess'), '([^s])s$', '\1')
                         from unnest(regexp_split_to_array(regexp_replace(lower(p.name), '[^a-z0-9]+', ' ', 'g'), ' ')) t
                        where t <> '' and t not in ('the', 'and', 'movie', 's')) as toks, p.licensor_id
      from core.property p join core.licensor l on l.id = p.licensor_id where l.code = 'DY'),
  dp as (
    select id, array(select regexp_replace(regexp_replace(t, 'esses$', 'ess'), '([^s])s$', '\1')
                       from unnest(string_to_array(split_part(source_id, '/', 3), '-')) t) as toks
      from plm.dcp_property where source_id !~ '(parks|publishing)-use-only'),
  counted as (
    select cp.id as property_id, cp.licensor_id, ch.id as character_id, count(distinct po.dcp_asset_id) as n
      from cp
      join dp on cp.toks <@ dp.toks and cardinality(cp.toks) > 0
      join plm.dcp_asset_property_observation po on po.dcp_property_id = dp.id and po.fetch_status = 'success'
      join plm.dcp_asset_character_observation co on co.dcp_asset_id = po.dcp_asset_id and co.fetch_status = 'success'
      join plm.dcp_character dc on dc.id = co.dcp_character_id
      join core.character ch on ch.code = dc.source_system || ':' || dc.source_id and ch.licensor_id = cp.licensor_id
     group by 1, 2, 3 having count(distinct po.dcp_asset_id) >= 2)
  select * from (select c.*, row_number() over (partition by property_id order by n desc, character_id) as rn from counted c) r
   where rn <= 120;

  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select l.property_id, l.character_id, l.licensor_id, 'disney_dcpvault',
         l.property_id::text || ':' || l.character_id::text,
         'plm.dcp_asset_property_observation', 'co_occurrence', l.n, null, true, v_meta, v_actor, v_actor
    from pg_temp.disney_links l
   where not exists (select 1 from core.property_character_source_edge e
                      where e.property_id = l.property_id and e.character_id = l.character_id
                        and e.source_system = 'disney_dcpvault' and e.is_current);

  -- Fail closed when a scrape holds rows but nothing eligible landed.
  if exists (select 1 from plm.dcp_character) and not exists
     (select 1 from core.character ch join core.licensor l on l.id = ch.licensor_id where l.code = 'DY' and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_dcpvault')
    then raise exception '#5079: no DY characters loaded'; end if;
  if exists (select 1 from plm.lucasfilm_dcp_character) and not exists
     (select 1 from core.character ch join core.licensor l on l.id = ch.licensor_id where l.code = 'SW' and ch.metadata ->> 'source_system' = 'lucasfilm_dcpvault')
    then raise exception '#5079: no SW characters loaded'; end if;
  if exists (select 1 from plm.peanuts_character) and not exists
     (select 1 from core.character ch join core.licensor l on l.id = ch.licensor_id where l.code = 'PN')
    then raise exception '#5079: no PN characters loaded'; end if;
  if exists (select 1 from plm.sega_character_candidate) and not exists
     (select 1 from core.character ch join core.licensor l on l.id = ch.licensor_id where l.code = 'SE')
    then raise exception '#5079: no SE characters loaded'; end if;
end
$characters$;
