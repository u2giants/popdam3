-- Issue #4964: sandbox counterpart of the production DesignFlow selling
-- signal (dflow_prod.item_customer_selling). Same shape in schema dflow:
-- item_id = dflow."itemHeader".item_id_pk, customer_id =
-- dflow.customers.customers_id. No foreign keys (data-sync reloads parents).
-- No GRANT: dflow is not PostgREST-exposed; the sandbox backend connects as
-- the owning role, matching every other dflow.* table.

set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists dflow.item_customer_selling (
  id bigint generated always as identity primary key,
  item_id integer not null,
  customer_id integer not null,
  selling_signal text not null
    constraint item_customer_selling_signal_check
    check (selling_signal in ('red', 'yellow', 'green')),
  updated_by_user_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_customer_selling_item_customer_key unique (item_id, customer_id)
);

comment on table dflow.item_customer_selling is
  'Owner-entered selling signal per item per retailer (issue #4964): item_id = dflow."itemHeader".item_id_pk, customer_id = dflow.customers.customers_id, selling_signal red / yellow / green.';
