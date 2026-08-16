-- Issue #1049: read-only Warner relationship evidence inferred from shared assets.
-- These views never promote co-occurrence into Warner's direct relationship tables.
-- first_seen_at is the earliest time both endpoint links had been observed for a shared
-- asset. last_seen_at is the latest corroborating observation of either endpoint link.
-- This remains ordered when Warner refreshes the relationship streams independently.

create view api.wb_inferred_franchise_property
with (security_invoker = true) as
with shared as (
  select af.franchise_id as left_id, ap.property_id as right_id,
         count(distinct af.asset_id)::bigint as via_asset_count,
         min(greatest(af.first_seen_at, ap.first_seen_at)) as first_seen_at,
         max(greatest(af.last_seen_at, ap.last_seen_at)) as last_seen_at
  from plm.wb_asset_franchise af join plm.wb_asset_property ap using (asset_id)
  group by af.franchise_id, ap.property_id
), left_counts as (
  select franchise_id as left_id,count(*)::bigint as asset_count from plm.wb_asset_franchise group by franchise_id
), right_counts as (
  select property_id as right_id,count(*)::bigint as asset_count from plm.wb_asset_property group by property_id
), totals as (
  select s.*,(l.asset_count+r.asset_count-s.via_asset_count)::bigint as support_asset_count
  from shared s join left_counts l using(left_id) join right_counts r using(right_id)
), scored as (
  select t.*, round(t.via_asset_count::numeric/nullif(t.support_asset_count,0),6) as support_ratio from totals t
)
select f.id as franchise_id, f.source_namespace as franchise_source_namespace,
       f.source_id as franchise_source_id, f.fallback_key as franchise_fallback_key,
       p.id as property_id, p.source_namespace as property_source_namespace,
       p.source_id as property_source_id, p.fallback_key as property_fallback_key,
       s.via_asset_count, s.support_asset_count, s.support_ratio,
       case when s.via_asset_count=1 then 'weak' when s.support_ratio=1 then 'universal'
            when s.support_ratio>=0.5 then 'strong' else 'moderate' end as evidence_strength,
       s.first_seen_at, s.last_seen_at,
       'inferred_asset_cooccurrence'::text as evidence_type, false as is_direct
from scored s join plm.wb_franchise f on f.id=s.left_id join plm.wb_property p on p.id=s.right_id;

create view api.wb_inferred_franchise_style_guide
with (security_invoker = true) as
with shared as (
  select af.franchise_id as left_id, ag.style_guide_id as right_id, count(distinct af.asset_id)::bigint as via_asset_count,
         min(greatest(af.first_seen_at,ag.first_seen_at)) as first_seen_at, max(greatest(af.last_seen_at,ag.last_seen_at)) as last_seen_at
  from plm.wb_asset_franchise af join plm.wb_asset_style_guide_normalized ag using(asset_id) group by af.franchise_id,ag.style_guide_id
), left_counts as (select franchise_id left_id,count(*)::bigint asset_count from plm.wb_asset_franchise group by franchise_id
), right_counts as (select style_guide_id right_id,count(*)::bigint asset_count from plm.wb_asset_style_guide_normalized group by style_guide_id
), totals as (
  select s.*,(l.asset_count+r.asset_count-s.via_asset_count)::bigint support_asset_count from shared s join left_counts l using(left_id) join right_counts r using(right_id)
), scored as (select t.*,round(t.via_asset_count::numeric/nullif(t.support_asset_count,0),6) support_ratio from totals t)
select f.id franchise_id,f.source_namespace franchise_source_namespace,f.source_id franchise_source_id,f.fallback_key franchise_fallback_key,
       g.id style_guide_id,g.source_namespace style_guide_source_namespace,g.source_id style_guide_source_id,g.fallback_key style_guide_fallback_key,
       s.via_asset_count,s.support_asset_count,s.support_ratio,
       case when s.via_asset_count=1 then 'weak' when s.support_ratio=1 then 'universal' when s.support_ratio>=0.5 then 'strong' else 'moderate' end evidence_strength,
       s.first_seen_at,s.last_seen_at,'inferred_asset_cooccurrence'::text evidence_type,false is_direct
from scored s join plm.wb_franchise f on f.id=s.left_id join plm.wb_style_guide_normalized g on g.id=s.right_id;

create view api.wb_inferred_franchise_character
with (security_invoker = true) as
with shared as (
  select af.franchise_id left_id,ac.character_id right_id,count(distinct af.asset_id)::bigint via_asset_count,
         min(greatest(af.first_seen_at,ac.first_seen_at)) first_seen_at,max(greatest(af.last_seen_at,ac.last_seen_at)) last_seen_at
  from plm.wb_asset_franchise af join plm.wb_asset_character_normalized ac using(asset_id) group by af.franchise_id,ac.character_id
), left_counts as (select franchise_id left_id,count(*)::bigint asset_count from plm.wb_asset_franchise group by franchise_id
), right_counts as (select character_id right_id,count(*)::bigint asset_count from plm.wb_asset_character_normalized group by character_id
), totals as (
  select s.*,(l.asset_count+r.asset_count-s.via_asset_count)::bigint support_asset_count from shared s join left_counts l using(left_id) join right_counts r using(right_id)
), scored as (select t.*,round(t.via_asset_count::numeric/nullif(t.support_asset_count,0),6) support_ratio from totals t)
select f.id franchise_id,f.source_namespace franchise_source_namespace,f.source_id franchise_source_id,f.fallback_key franchise_fallback_key,
       c.id character_id,c.source_namespace character_source_namespace,c.source_id character_source_id,c.fallback_key character_fallback_key,
       s.via_asset_count,s.support_asset_count,s.support_ratio,
       case when s.via_asset_count=1 then 'weak' when s.support_ratio=1 then 'universal' when s.support_ratio>=0.5 then 'strong' else 'moderate' end evidence_strength,
       s.first_seen_at,s.last_seen_at,'inferred_asset_cooccurrence'::text evidence_type,false is_direct
from scored s join plm.wb_franchise f on f.id=s.left_id join plm.wb_character_normalized c on c.id=s.right_id;

create view api.wb_inferred_style_guide_property
with (security_invoker = true) as
with shared as (
 select ag.style_guide_id left_id,ap.property_id right_id,count(distinct ag.asset_id)::bigint via_asset_count,
        min(greatest(ag.first_seen_at,ap.first_seen_at)) first_seen_at,max(greatest(ag.last_seen_at,ap.last_seen_at)) last_seen_at
 from plm.wb_asset_style_guide_normalized ag join plm.wb_asset_property ap using(asset_id) group by ag.style_guide_id,ap.property_id
), left_counts as (select style_guide_id left_id,count(*)::bigint asset_count from plm.wb_asset_style_guide_normalized group by style_guide_id
), right_counts as (select property_id right_id,count(*)::bigint asset_count from plm.wb_asset_property group by property_id
), totals as (
 select s.*,(l.asset_count+r.asset_count-s.via_asset_count)::bigint support_asset_count from shared s join left_counts l using(left_id) join right_counts r using(right_id)
), scored as (select t.*,round(t.via_asset_count::numeric/nullif(t.support_asset_count,0),6) support_ratio from totals t)
select g.id style_guide_id,g.source_namespace style_guide_source_namespace,g.source_id style_guide_source_id,g.fallback_key style_guide_fallback_key,
       p.id property_id,p.source_namespace property_source_namespace,p.source_id property_source_id,p.fallback_key property_fallback_key,
       s.via_asset_count,s.support_asset_count,s.support_ratio,
       case when s.via_asset_count=1 then 'weak' when s.support_ratio=1 then 'universal' when s.support_ratio>=0.5 then 'strong' else 'moderate' end evidence_strength,
       s.first_seen_at,s.last_seen_at,'inferred_asset_cooccurrence'::text evidence_type,false is_direct
from scored s join plm.wb_style_guide_normalized g on g.id=s.left_id join plm.wb_property p on p.id=s.right_id;

create view api.wb_inferred_property_character
with (security_invoker = true) as
with shared as (
 select ap.property_id left_id,ac.character_id right_id,count(distinct ap.asset_id)::bigint via_asset_count,
        min(greatest(ap.first_seen_at,ac.first_seen_at)) first_seen_at,max(greatest(ap.last_seen_at,ac.last_seen_at)) last_seen_at
 from plm.wb_asset_property ap join plm.wb_asset_character_normalized ac using(asset_id) group by ap.property_id,ac.character_id
), left_counts as (select property_id left_id,count(*)::bigint asset_count from plm.wb_asset_property group by property_id
), right_counts as (select character_id right_id,count(*)::bigint asset_count from plm.wb_asset_character_normalized group by character_id
), totals as (
 select s.*,(l.asset_count+r.asset_count-s.via_asset_count)::bigint support_asset_count from shared s join left_counts l using(left_id) join right_counts r using(right_id)
), scored as (select t.*,round(t.via_asset_count::numeric/nullif(t.support_asset_count,0),6) support_ratio from totals t)
select p.id property_id,p.source_namespace property_source_namespace,p.source_id property_source_id,p.fallback_key property_fallback_key,
       c.id character_id,c.source_namespace character_source_namespace,c.source_id character_source_id,c.fallback_key character_fallback_key,
       s.via_asset_count,s.support_asset_count,s.support_ratio,
       case when s.via_asset_count=1 then 'weak' when s.support_ratio=1 then 'universal' when s.support_ratio>=0.5 then 'strong' else 'moderate' end evidence_strength,
       s.first_seen_at,s.last_seen_at,'inferred_asset_cooccurrence'::text evidence_type,false is_direct
from scored s join plm.wb_property p on p.id=s.left_id join plm.wb_character_normalized c on c.id=s.right_id;

create view api.wb_inferred_style_guide_character
with (security_invoker = true) as
with shared as (
 select ag.style_guide_id left_id,ac.character_id right_id,count(distinct ag.asset_id)::bigint via_asset_count,
        min(greatest(ag.first_seen_at,ac.first_seen_at)) first_seen_at,max(greatest(ag.last_seen_at,ac.last_seen_at)) last_seen_at
 from plm.wb_asset_style_guide_normalized ag join plm.wb_asset_character_normalized ac using(asset_id) group by ag.style_guide_id,ac.character_id
), left_counts as (select style_guide_id left_id,count(*)::bigint asset_count from plm.wb_asset_style_guide_normalized group by style_guide_id
), right_counts as (select character_id right_id,count(*)::bigint asset_count from plm.wb_asset_character_normalized group by character_id
), totals as (
 select s.*,(l.asset_count+r.asset_count-s.via_asset_count)::bigint support_asset_count from shared s join left_counts l using(left_id) join right_counts r using(right_id)
), scored as (select t.*,round(t.via_asset_count::numeric/nullif(t.support_asset_count,0),6) support_ratio from totals t)
select g.id style_guide_id,g.source_namespace style_guide_source_namespace,g.source_id style_guide_source_id,g.fallback_key style_guide_fallback_key,
       c.id character_id,c.source_namespace character_source_namespace,c.source_id character_source_id,c.fallback_key character_fallback_key,
       s.via_asset_count,s.support_asset_count,s.support_ratio,
       case when s.via_asset_count=1 then 'weak' when s.support_ratio=1 then 'universal' when s.support_ratio>=0.5 then 'strong' else 'moderate' end evidence_strength,
       s.first_seen_at,s.last_seen_at,'inferred_asset_cooccurrence'::text evidence_type,false is_direct
from scored s join plm.wb_style_guide_normalized g on g.id=s.left_id join plm.wb_character_normalized c on c.id=s.right_id;

grant select on api.wb_inferred_franchise_property,api.wb_inferred_franchise_style_guide,
 api.wb_inferred_franchise_character,api.wb_inferred_style_guide_property,
 api.wb_inferred_property_character,api.wb_inferred_style_guide_character to authenticated,service_role;
revoke all on api.wb_inferred_franchise_property,api.wb_inferred_franchise_style_guide,
 api.wb_inferred_franchise_character,api.wb_inferred_style_guide_property,
 api.wb_inferred_property_character,api.wb_inferred_style_guide_character from anon;

comment on view api.wb_inferred_franchise_property is 'Asset co-occurrence evidence only. A human assignment suggestion, never Warner source truth or automatic parentage.';
comment on view api.wb_inferred_franchise_style_guide is 'Asset co-occurrence evidence only. Never a direct Warner relationship assertion.';
comment on view api.wb_inferred_franchise_character is 'Asset co-occurrence evidence only. Never a direct Warner relationship assertion.';
comment on view api.wb_inferred_style_guide_property is 'Asset co-occurrence evidence only. Never a direct Warner relationship assertion or automatic parentage.';
comment on view api.wb_inferred_property_character is 'Asset depiction/co-occurrence only. Direct Warner Product Property-to-Character assertions remain in plm.wb_property_character_normalized.';
comment on view api.wb_inferred_style_guide_character is 'Asset depiction/co-occurrence only. Never a direct Warner relationship assertion.';
