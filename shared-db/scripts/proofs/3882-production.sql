-- Fixed catalog-only observations. No application rows are returned.
select 'assertion'::text kind, 3882 work_issue, null::text table_name, null::text schema_name, null::jsonb columns, passed from (select (
  exists (select 1 from supabase_migrations.schema_migrations where version = '20261002173317')
  and (
    select count(*) from (values
      ('dflow.art_piece', 'art_piece_licensor_id_fkey', 'licensor_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_property_id_fkey', 'property_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_style_guide_id_fkey', 'style_guide_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_big_theme_id_fkey', 'big_theme_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_little_theme_id_fkey', 'little_theme_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_art_type_id_fkey', 'art_type_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_art_source_id_fkey', 'art_source_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_artist_id_fkey', 'artist_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_age_group_id_fkey', 'age_group_id', 'core."merchGroup"', 'mg_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_divisioncode_id_fkey', 'divisioncode_id', 'plm."divisionCode"', 'divCode_id', 'a', 'a'),
      ('dflow.art_piece', 'art_piece_season_code_id_fkey', 'season_code_id', 'plm."SeasonCode"', 'id', 'a', 'a'),
      ('dflow.properties_and_characters', 'properties_and_characters_licensor_id_fkey', 'licensor_id', 'core."licenseList"', 'licenseList_id', 'c', 'r'),
      ('dflow.property_character_associations', 'property_character_associations_licensor_id_fkey', 'licensor_id', 'core."licenseList"', 'licenseList_id', 'c', 'r'),
      ('dflow.item_character_associations', 'item_character_associations_item_header_id_fkey', 'item_header_id', 'plm."itemHeader"', 'item_id_pk', 'c', 'c')
    ) v(t, n, col, p, pc, upd, del)
    join pg_catalog.pg_constraint c
      on c.contype = 'f' and c.convalidated
     and c.conrelid = pg_catalog.to_regclass(v.t) and c.conname = v.n
     and c.confrelid = pg_catalog.to_regclass(v.p)
     and c.confupdtype = v.upd and c.confdeltype = v.del and not c.condeferrable
     and array_length(c.conkey, 1) = 1 and array_length(c.confkey, 1) = 1
    join pg_catalog.pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1] and ca.attname = v.col
    join pg_catalog.pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1] and pa.attname = v.pc
  ) = 14
) as passed) probe
union all
select 'assertion'::text kind, 3887 work_issue, null::text table_name, null::text schema_name, null::jsonb columns, passed from (select (
  exists (select 1 from supabase_migrations.schema_migrations where version = '20261002155633')
  and pg_catalog.to_regclass('app.users') is not null
  and (
    select count(*) from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.convalidated
      and c.confrelid = pg_catalog.to_regclass('dflow.users')
      and c.confdeltype = 'a'
      and c.confkey = array[(select a.attnum from pg_catalog.pg_attribute a
                             where a.attrelid = pg_catalog.to_regclass('dflow.users') and a.attname = 'id')]::int2[]
      and (c.conrelid, c.conname, c.confupdtype, c.conkey) in (
        select pg_catalog.to_regclass(t), n, u::"char",
               array[(select a.attnum from pg_catalog.pg_attribute a
                      where a.attrelid = pg_catalog.to_regclass(t) and a.attname = col)]::int2[]
        from (values
          ('core.age_group', 'age_group_created_by_fkey', 'a', 'created_by'),
          ('core.age_group', 'age_group_updated_by_fkey', 'a', 'updated_by'),
          ('core.art_types', 'art_types_created_by_fkey', 'a', 'created_by'),
          ('core.art_types', 'art_types_updated_by_fkey', 'a', 'updated_by'),
          ('core.artist_types', 'artist_types_created_by_fkey', 'a', 'created_by'),
          ('core.artist_types', 'artist_types_updated_by_fkey', 'a', 'updated_by'),
          ('plm."productUserAssignment"', 'productUserAssignment_user_id_fk_fkey', 'c', 'user_id_fk'),
          ('plm.sample_comments', 'sample_comments_user_id_fkey', 'c', 'user_id')
        ) v(t, n, u, col)
      )
  ) = 8
  and not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.contype = 'f'
      and c.confrelid = pg_catalog.to_regclass('app.users')
      and c.conrelid in (pg_catalog.to_regclass('core.age_group'), pg_catalog.to_regclass('core.art_types'),
                         pg_catalog.to_regclass('core.artist_types'), pg_catalog.to_regclass('plm."productUserAssignment"'),
                         pg_catalog.to_regclass('plm.sample_comments'))
  )
) as passed) probe
union all
select 'assertion'::text kind, 3907 work_issue, null::text table_name, null::text schema_name, null::jsonb columns, passed from (SELECT (
  EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261007002113')
  AND (SELECT count(*) FROM (VALUES
    ('app."RolePermissions"', 'RolePermissions_UserId_fkey', 'UserId'),
    ('plm.art_piece_attachment', 'art_piece_attachment_created_by_fkey', 'created_by'),
    ('plm.art_piece_attachment', 'art_piece_attachment_updated_by_fkey', 'updated_by')
  ) v(t,n,col)
  JOIN pg_constraint c ON c.conrelid = to_regclass(v.t) AND c.conname = v.n
    AND c.contype = 'f' AND c.confrelid = to_regclass('dflow.users')
    AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
    AND c.confmatchtype = 's' AND c.confupdtype = 'a' AND c.confdeltype = 'a'
  JOIN pg_attribute child ON child.attrelid = c.conrelid AND child.attname = v.col
    AND c.conkey = ARRAY[child.attnum]
  JOIN pg_attribute parent ON parent.attrelid = c.confrelid AND parent.attname = 'id'
    AND c.confkey = ARRAY[parent.attnum]
  ) = 3
) as passed) probe
union all
select 'assertion'::text kind, 4010 work_issue, null::text table_name, null::text schema_name, null::jsonb columns, passed from (SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261007002731') AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='art_source_id' JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attname='mg_id' WHERE c.conrelid='dflow.artists'::regclass AND c.conname='artists_art_source_id_fkey' AND c.contype='f' AND c.confrelid='core."merchGroup"'::regclass AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[p.attnum] AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred) AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='artist_type_id' JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attname='id' WHERE c.conrelid='dflow.artists'::regclass AND c.conname='artists_artist_type_id_fkey' AND c.contype='f' AND c.confrelid='core.artist_types'::regclass AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[p.attnum] AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred) AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='divisioncode_id' JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attname='divCode_id' WHERE c.conrelid='dflow.artists'::regclass AND c.conname='artists_divisioncode_id_fkey' AND c.contype='f' AND c.confrelid='plm."divisionCode"'::regclass AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[p.attnum] AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred) as passed) probe
union all
select 'assertion',3890,null,null,null,to_regclass('dflow.properties_and_characters') is not null and to_regclass('core.properties_and_characters') is null and (select count(*) from pg_attribute where attrelid=to_regclass('dflow.properties_and_characters') and attnum>0 and not attisdropped)=8
union all
select 'table',null,w.table_name,w.schema_name,(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass(format('%I.%I',w.schema_name,w.table_name)) and a.attnum>0 and not a.attisdropped),to_regclass(format('%I.%I',w.schema_name,w.table_name)) is not null from (values ('art_piece','dflow'),('art_piece_attachment','plm'),('properties_and_characters','dflow'),('property_character_associations','dflow'),('item_character_associations','dflow'),('FactoryTime','plm'),('itemHeader','plm'),('itemDetail','plm'),('RFQItem','plm'),('user_notification','app'),('ProdOrderHeader','plm'),('RolePermissions','app')) w(table_name,schema_name);
