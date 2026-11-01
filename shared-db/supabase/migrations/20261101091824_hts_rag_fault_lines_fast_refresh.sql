-- designflow-backend#254 §13.4: make the fault-line refresh fast enough to schedule.
-- The original views joined decision tests on `decision_id in (held, rejected)`, which
-- Postgres cannot drive from the decision_id index, and multiplied every fact sentence
-- through the product pairs before counting. At 125k decision tests the refresh ran past
-- 14 minutes. This version unrolls the two decision ids with a lateral values list and
-- collapses facts to distinct (decision, test, key) first. Same columns, same rows
-- (45,720 in production on 2026-11-01 from both forms); about 20 seconds.
set statement_timeout = '10min';

drop materialized view hts_rag.hts_rag_fault_lines;
drop materialized view hts_rag.hts_rag_fault_lines_any_type;

create materialized view hts_rag.hts_rag_fault_lines as
with pairs as (
  select p.id as product_id, p.article_type_id,
         coalesce(held.code_prefix, held.heading) as held_prefix,
         coalesce(rej.code_prefix, rej.heading) as rejected_prefix,
         held.id as held_decision_id, rej.id as rejected_decision_id
    from hts_rag.hts_rag_ruling_products p
    join hts_rag.hts_rag_heading_decisions held on held.product_id = p.id and held.outcome = 'held'
    join hts_rag.hts_rag_heading_decisions rej on rej.product_id = p.id and rej.outcome = 'rejected'
   where p.effective_status = 'active' and p.review_state = 'trusted'
), keys as (
  select distinct dt.decision_id, dt.test_id, df.attribute_key
    from hts_rag.hts_rag_decision_tests dt
    join hts_rag.hts_rag_decision_facts df on df.decision_test_id = dt.id
)
select least(pr.held_prefix, pr.rejected_prefix) as prefix_a,
       greatest(pr.held_prefix, pr.rejected_prefix) as prefix_b,
       pr.article_type_id,
       k.test_id,
       k.attribute_key,
       count(distinct pr.product_id) as n_products,
       count(distinct pr.product_id) filter (where pr.held_prefix < pr.rejected_prefix) as n_held_a,
       count(distinct pr.product_id) filter (where pr.held_prefix > pr.rejected_prefix) as n_held_b,
       (array_agg(distinct pr.product_id))[1:3] as example_products
  from pairs pr
  cross join lateral (values (pr.held_decision_id), (pr.rejected_decision_id)) as d(decision_id)
  join keys k on k.decision_id = d.decision_id
 group by 1, 2, 3, 4, 5;
create unique index hts_rag_fault_lines_uq
  on hts_rag.hts_rag_fault_lines (prefix_a, prefix_b, article_type_id, test_id, attribute_key) nulls not distinct;
comment on materialized view hts_rag.hts_rag_fault_lines is
  'For competing code prefixes A and B per article type: which test and attribute key split them, with counts per side and three example products. §13.4.';

create materialized view hts_rag.hts_rag_fault_lines_any_type as
with pairs as (
  select p.id as product_id,
         coalesce(held.code_prefix, held.heading) as held_prefix,
         coalesce(rej.code_prefix, rej.heading) as rejected_prefix,
         held.id as held_decision_id, rej.id as rejected_decision_id
    from hts_rag.hts_rag_ruling_products p
    join hts_rag.hts_rag_heading_decisions held on held.product_id = p.id and held.outcome = 'held'
    join hts_rag.hts_rag_heading_decisions rej on rej.product_id = p.id and rej.outcome = 'rejected'
   where p.effective_status = 'active' and p.review_state = 'trusted'
), keys as (
  select distinct dt.decision_id, dt.test_id, df.attribute_key
    from hts_rag.hts_rag_decision_tests dt
    join hts_rag.hts_rag_decision_facts df on df.decision_test_id = dt.id
)
select least(pr.held_prefix, pr.rejected_prefix) as prefix_a,
       greatest(pr.held_prefix, pr.rejected_prefix) as prefix_b,
       k.test_id,
       k.attribute_key,
       count(distinct pr.product_id) as n_products,
       count(distinct pr.product_id) filter (where pr.held_prefix < pr.rejected_prefix) as n_held_a,
       count(distinct pr.product_id) filter (where pr.held_prefix > pr.rejected_prefix) as n_held_b,
       (array_agg(distinct pr.product_id))[1:3] as example_products
  from pairs pr
  cross join lateral (values (pr.held_decision_id), (pr.rejected_decision_id)) as d(decision_id)
  join keys k on k.decision_id = d.decision_id
 group by 1, 2, 3, 4;
create unique index hts_rag_fault_lines_any_type_uq
  on hts_rag.hts_rag_fault_lines_any_type (prefix_a, prefix_b, test_id, attribute_key);
comment on materialized view hts_rag.hts_rag_fault_lines_any_type is
  'hts_rag_fault_lines without the article type, for rare or unresolved types. §13.4.';

revoke all on hts_rag.hts_rag_fault_lines, hts_rag.hts_rag_fault_lines_any_type
  from public, anon, authenticated, service_role;
grant select on hts_rag.hts_rag_fault_lines, hts_rag.hts_rag_fault_lines_any_type
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Callers (worker logins) carry a short default statement timeout; the refresh brings its own.
alter function hts_rag.hts_rag_refresh_fault_lines() set statement_timeout = '5min';
