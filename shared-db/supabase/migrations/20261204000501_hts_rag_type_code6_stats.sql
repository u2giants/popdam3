-- Issue #6590 (claim #6591, popcre/designflow-backend#278, plan_hts-4-upgrades.md Phase 2
-- step 5). 6-digit counterpart of hts_rag_type_heading_stats: per article type (all_materials
-- = true) and per type x material, the 6-digit codes CBP held, rejected or mentioned, with
-- product and ruling counts. Additive read model; refreshed only through the SECURITY DEFINER
-- routine below, never hand-written. Held codes use the product's held_code (as written by CBP);
-- decisions only count when CBP named at least six digits.

create materialized view hts_rag.hts_rag_type_code6_stats as
with codes as (
  select p.id as product_id, p.ruling_number, p.article_type_id, p.primary_material_id,
         'held'::text as outcome, left(regexp_replace(p.held_code, '\D', '', 'g'), 6) as code6
    from hts_rag.hts_rag_ruling_products p
   where p.held_code is not null
  union
  select p.id, p.ruling_number, p.article_type_id, p.primary_material_id,
         d.outcome, left(regexp_replace(d.code_prefix, '\D', '', 'g'), 6)
    from hts_rag.hts_rag_heading_decisions d
    join hts_rag.hts_rag_ruling_products p on p.id = d.product_id
   where d.outcome in ('rejected', 'alternative_mentioned')
     and length(regexp_replace(coalesce(d.code_prefix, ''), '\D', '', 'g')) >= 6
)
select c.article_type_id,
       (grouping(c.primary_material_id) = 1) as all_materials,
       c.primary_material_id,
       c.code6,
       left(c.code6, 4) as heading,
       left(c.code6, 2) as chapter,
       c.outcome,
       count(distinct c.product_id) as product_count,
       count(distinct c.ruling_number) as ruling_count,
       max(r.ruling_date) as newest_ruling_date
  from codes c
  join hts_rag.hts_rag_ruling_products p on p.id = c.product_id
  join hts_rag.hts_rag_rulings r on r.ruling_number = c.ruling_number
 where p.effective_status = 'active'
   and p.review_state = 'trusted'
   and c.article_type_id is not null
   and length(c.code6) = 6
 group by grouping sets (
   (c.article_type_id, c.code6, c.outcome),
   (c.article_type_id, c.primary_material_id, c.code6, c.outcome))
with no data;

create unique index hts_rag_type_code6_stats_uq
  on hts_rag.hts_rag_type_code6_stats
  (article_type_id, all_materials, primary_material_id, code6, outcome) nulls not distinct;
create index hts_rag_type_code6_stats_chapter_idx
  on hts_rag.hts_rag_type_code6_stats (article_type_id, chapter);

comment on materialized view hts_rag.hts_rag_type_code6_stats is
  'designflow-backend#278. 6-digit codes CBP held/rejected/mentioned per article type (all_materials = true) and per type x material; product and ruling counts. Tiebreak/statistics only. Refresh via hts_rag_refresh_type_code6_stats().';

revoke all on hts_rag.hts_rag_type_code6_stats
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
grant select on hts_rag.hts_rag_type_code6_stats
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;

create function hts_rag.hts_rag_refresh_type_code6_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from pg_matviews
              where schemaname = 'hts_rag' and matviewname = 'hts_rag_type_code6_stats' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_type_code6_stats;
  else
    refresh materialized view hts_rag.hts_rag_type_code6_stats;
  end if;
end;
$$;

comment on function hts_rag.hts_rag_refresh_type_code6_stats() is
  'designflow-backend#278. Refreshes hts_rag_type_code6_stats after a harvest or extraction batch.';
revoke all on function hts_rag.hts_rag_refresh_type_code6_stats() from public, anon, authenticated, service_role;
grant execute on function hts_rag.hts_rag_refresh_type_code6_stats()
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
