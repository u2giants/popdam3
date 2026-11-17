-- Read-only source/dependency inventory; verify the live target first.
-- Review full function bodies privately; publish names and hashes only.
select n.nspname as schema, p.oid::regprocedure::text as identity,
       md5(pg_get_functiondef(p.oid)) as definition_md5,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prokind='f'
  and n.nspname not in ('pg_catalog','information_schema')
  and n.nspname not like 'pg_toast%'
  and (p.prosrc ~* '(assets|style_guide_files|hts_rag_ruling_sentences|hts_rag_rulings)'
       or p.proname in ('search_assets_full_text','search_style_groups_full_text'))
order by 1,2;

select 'view' as kind,schemaname as schema,viewname as name,definition
from pg_views
where schemaname not in ('pg_catalog','information_schema')
  and definition ~* '(assets|style_guide_files|hts_rag_ruling_sentences|hts_rag_rulings)'
union all
select 'materialized view',schemaname,matviewname,definition
from pg_matviews
where schemaname not in ('pg_catalog','information_schema')
  and definition ~* '(assets|style_guide_files|hts_rag_ruling_sentences|hts_rag_rulings)'
union all
select 'policy',schemaname,tablename||'.'||policyname,coalesce(qual,'')||' '||coalesce(with_check,'')
from pg_policies
where coalesce(qual,'')||' '||coalesce(with_check,'')
  ~* '(assets|style_guide_files|hts_rag_ruling_sentences|hts_rag_rulings|directory_path|tag_search_text|text_hash)'
order by 1,2,3;

select n.nspname as schema,c.relname as index_name,
       con.conname as constraint_name,con.contype as constraint_type,
       pg_describe_object(d.classid,d.objid,d.objsubid) as dependent_object,d.deptype
from pg_class c join pg_namespace n on n.oid=c.relnamespace
left join pg_constraint con on con.conindid=c.oid
left join pg_depend d on d.refclassid='pg_class'::regclass and d.refobjid=c.oid
where c.relkind='i'
  and ((n.nspname='public' and c.relname in
        ('idx_assets_tags','idx_assets_full_text_search',
         'idx_sgf_directory_path_trgm','idx_style_guide_files_tag_search_trgm'))
    or (n.nspname='hts_rag' and c.relname in
        ('hts_rag_ruling_sentences_hash_idx','hts_rag_rulings_search_trgm_idx')))
order by 1,2,3,5;
