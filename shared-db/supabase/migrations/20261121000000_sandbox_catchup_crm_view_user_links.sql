-- Sandbox catch-up batch 14 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- 1. api.crm_ingested_domain_list gains production's customer columns (appended, same order) and production's grants.
-- 2. core.age_group / art_types / artist_types created_by and updated_by point at the DesignFlow user table, as in
--    production (production's dflow_prod.users is the sandbox's dflow.users). Sandbox pre-check 2026-11-16: every
--    existing created_by/updated_by value exists in dflow.users.
-- derived-from: none

create or replace view api.crm_ingested_domain_list with (security_invoker = true) as
 SELECT d.id,
    (d.domain)::text AS domain,
    d.display_name,
    d.status,
    d.email_count,
    d.first_seen_at,
    d.last_seen_at,
    (d.last_sender)::text AS last_sender,
    d.sample_subject,
    d.updated_at,
    d.customer_id,
    c.name AS customer_name,
    (c.status)::text AS customer_status
   FROM (crm.ingested_domain d
     LEFT JOIN core.customer c ON ((c.id = d.customer_id)));
revoke all on table api.crm_ingested_domain_list from public, anon, authenticated, service_role;
grant select on table api.crm_ingested_domain_list to authenticated;

alter table core.age_group drop constraint age_group_created_by_fkey;
alter table core.age_group add constraint age_group_created_by_fkey FOREIGN KEY (created_by) REFERENCES dflow.users(id);
alter table core.age_group drop constraint age_group_updated_by_fkey;
alter table core.age_group add constraint age_group_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES dflow.users(id);
alter table core.art_types drop constraint art_types_created_by_fkey;
alter table core.art_types add constraint art_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES dflow.users(id);
alter table core.art_types drop constraint art_types_updated_by_fkey;
alter table core.art_types add constraint art_types_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES dflow.users(id);
alter table core.artist_types drop constraint artist_types_created_by_fkey;
alter table core.artist_types add constraint artist_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES dflow.users(id);
alter table core.artist_types drop constraint artist_types_updated_by_fkey;
alter table core.artist_types add constraint artist_types_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES dflow.users(id);
