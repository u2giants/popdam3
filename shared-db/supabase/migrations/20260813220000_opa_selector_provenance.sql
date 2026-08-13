-- Preserve the three OPA selector values outside source_url. The source URL
-- remains query-free, while each row can retain the exact extract scope.

alter table plm.opa_property_character
  add column "regionName" text null,
  add column "templateId" bigint null,
  add column "workflowId" bigint null;

comment on column plm.opa_property_character."regionName" is
  'Optional exact OPA regionName selector used for the source extract. NULL on older captures.';
comment on column plm.opa_property_character."templateId" is
  'Optional exact OPA templateId selector used for the source extract. NULL on older captures.';
comment on column plm.opa_property_character."workflowId" is
  'Optional exact OPA workflowId selector used for the source extract. NULL on older captures.';
