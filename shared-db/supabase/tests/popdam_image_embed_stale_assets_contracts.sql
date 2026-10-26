-- PopDAM image-embed stale-asset enumeration contracts (#4814 / claim #4818,
-- popdam3 #486 Step 4b). Disposable-database transaction only; the harness
-- owns BEGIN/ROLLBACK. Covers: service_role-only execute posture, the three
-- staleness legs (missing vector, watermark change, stamp outside the active
-- window), is_deleted + non-raster-thumbnail exclusion, cursor pagination to
-- exhaustion, the re-embed window admitting the PREVIOUS stamp, and the
-- unconfigured-stamp refusal.

-- =====================================================================================
-- Phase 1 — grant posture: service_role only.
-- =====================================================================================
do $phase1$
begin
  if not has_function_privilege('service_role', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('dam_image_embed_worker', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE') then
    raise exception 'image_embed_stale_assets execute is not service_role-only';
  end if;
end
$phase1$;

-- =====================================================================================
-- Phase 2 — fixture. Stamps configured, embed gate OFF (the wrapper must not
-- depend on it). Six assets: missing-vector, fresh, watermark-stale,
-- stamp-stale, deleted, pdf-thumbnail.
-- =====================================================================================
insert into public.admin_config (key, value)
values ('IMAGE_EMBED_ENABLED', 'false'::jsonb)
on conflict (key) do update set value = excluded.value;

insert into public.admin_config (key, value)
values ('IMAGE_SIM_EMBEDDING_MODEL', '"zz486b-stamp-v1"'::jsonb)
on conflict (key) do update set value = excluded.value;

insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, thumbnail_url)
values
  ('00000000-0000-4000-8000-000000000491', 'zz486b-a.jpg', 'ZZ486B/zz486b-a.jpg', 'jpg', 'zz486b-a', now(), false,
   'https://cdn.example.test/zz486b-a.jpg'),
  ('00000000-0000-4000-8000-000000000492', 'zz486b-b.jpg', 'ZZ486B/zz486b-b.jpg', 'jpg', 'zz486b-b', now(), false,
   'https://cdn.example.test/zz486b-b.jpg'),
  ('00000000-0000-4000-8000-000000000493', 'zz486b-c.jpg', 'ZZ486B/zz486b-c.jpg', 'jpg', 'zz486b-c', now(), false,
   'https://cdn.example.test/zz486b-c.jpg'),
  ('00000000-0000-4000-8000-000000000494', 'zz486b-d.jpg', 'ZZ486B/zz486b-d.jpg', 'jpg', 'zz486b-d', now(), false,
   'https://cdn.example.test/zz486b-d.jpg'),
  ('00000000-0000-4000-8000-000000000495', 'zz486b-e.jpg', 'ZZ486B/zz486b-e.jpg', 'jpg', 'zz486b-e', now(), true,
   'https://cdn.example.test/zz486b-e.jpg'),
  ('00000000-0000-4000-8000-000000000496', 'zz486b-f.pdf', 'ZZ486B/zz486b-f.pdf', 'pdf', 'zz486b-f', now(), false,
   'https://cdn.example.test/zz486b-f.pdf');

do $phase2$
declare
  v_dino text := '[' || (select string_agg(g::text, ',') from generate_series(1, 768) g) || ']';
  v_siglip text := '[' || (select string_agg((g * 2)::text, ',') from generate_series(1, 768) g) || ']';
begin
  -- 492: fresh (matching watermark + active stamp).
  -- 493: watermark drift.
  -- 494: foreign stamp.
  insert into dam.dam_asset_image_vectors (asset_id, vec_dino, vec_siglip, embedding_model, last_embedded_thumbnail_url)
  values
    ('00000000-0000-4000-8000-000000000492',
     v_dino::extensions.halfvec, v_siglip::extensions.halfvec,
     'zz486b-stamp-v1', 'https://cdn.example.test/zz486b-b.jpg'),
    ('00000000-0000-4000-8000-000000000493',
     v_dino::extensions.halfvec, v_siglip::extensions.halfvec,
     'zz486b-stamp-v1', 'https://cdn.example.test/zz486b-c-OLD.jpg'),
    ('00000000-0000-4000-8000-000000000494',
     v_dino::extensions.halfvec, v_siglip::extensions.halfvec,
     'zz486b-stamp-v9', 'https://cdn.example.test/zz486b-d.jpg')
  on conflict (asset_id) do nothing;
end
$phase2$;

-- =====================================================================================
-- Phase 3 — enumeration: exactly the three stale legs, ordered by id.
-- =====================================================================================
do $phase3$
declare
  v_ids uuid[];
begin
  select array_agg(t.x order by t.x) into v_ids from public.image_embed_stale_assets(null, null) as t(x);
  if v_ids is distinct from array['00000000-0000-4000-8000-000000000491',
                                 '00000000-0000-4000-8000-000000000493',
                                 '00000000-0000-4000-8000-000000000494']::uuid[] then
    raise exception 'stale enumeration wrong (missing/watermark/stamp legs or is_deleted/raster filters): %', v_ids;
  end if;
end
$phase3$;

-- =====================================================================================
-- Phase 4 — cursor pagination: bounded pages, cursor resumes, exhaustion ends.
-- =====================================================================================
do $phase4$
declare
  v_page1 uuid[];
  v_page2 uuid[];
  v_page3 uuid[];
  v_last  uuid;
begin
  select array_agg(t.x order by t.x) into v_page1 from public.image_embed_stale_assets(null, 2) as t(x);
  if cardinality(coalesce(v_page1, '{}'::uuid[])) <> 2
     or v_page1[1] <> '00000000-0000-4000-8000-000000000491' then
    raise exception 'page 1 wrong: %', v_page1;
  end if;

  v_last := v_page1[cardinality(v_page1)];
  select array_agg(t.x order by t.x) into v_page2 from public.image_embed_stale_assets(v_last, 2) as t(x);
  if cardinality(coalesce(v_page2, '{}'::uuid[])) <> 1
     or v_page2[1] <> '00000000-0000-4000-8000-000000000494' then
    raise exception 'page 2 wrong: %', v_page2;
  end if;

  v_last := v_page2[cardinality(v_page2)];
  select array_agg(t.x order by t.x) into v_page3 from public.image_embed_stale_assets(v_last, 2) as t(x);
  if cardinality(coalesce(v_page3, '{}'::uuid[])) <> 0 then
    raise exception 'exhausted cursor returned rows: %', v_page3;
  end if;
end
$phase4$;

-- =====================================================================================
-- Phase 5 — re-embed window: with REEMBED_IN_PROGRESS + PREVIOUS, the old
-- stamp counts as fresh and the stamp-stale leg disappears.
-- =====================================================================================
insert into public.admin_config (key, value)
values
  ('IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS', '"zz486b-stamp-v9"'::jsonb),
  ('IMAGE_SIM_REEMBED_IN_PROGRESS', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

do $phase5$
declare
  v_ids uuid[];
begin
  select array_agg(t.x order by t.x) into v_ids from public.image_embed_stale_assets(null, null) as t(x);
  if v_ids is distinct from array['00000000-0000-4000-8000-000000000491',
                                 '00000000-0000-4000-8000-000000000493']::uuid[] then
    raise exception 're-embed window did not admit the PREVIOUS stamp: %', v_ids;
  end if;
end
$phase5$;

-- =====================================================================================
-- Phase 6 — unconfigured stamp refuses loudly instead of returning a silent
-- empty backfill.
-- =====================================================================================
delete from public.admin_config where key in ('IMAGE_SIM_EMBEDDING_MODEL',
                                              'IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS',
                                              'IMAGE_SIM_REEMBED_IN_PROGRESS');

do $phase6$
declare
  v_failed boolean := false;
begin
  begin
    perform public.image_embed_stale_assets(null, null);
  exception when others then
    if sqlerrm not like '%DAM_IMAGE_EMBED_STAMP_UNCONFIGURED%' then
      raise;
    end if;
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'unconfigured stamp did not raise DAM_IMAGE_EMBED_STAMP_UNCONFIGURED';
  end if;
end
$phase6$;
