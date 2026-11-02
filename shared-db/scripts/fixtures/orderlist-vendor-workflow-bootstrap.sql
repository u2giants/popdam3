create role anon; create role authenticated;
create schema plm; create schema coldlion; create schema dam; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function dam.orderlist_parse_boolean(text) returns boolean language sql immutable as $$select case lower($1) when 'true' then true when 'false' then false else null end$$;
create function dam.orderlist_license_status(jsonb,boolean) returns text language sql immutable as $$select 'Test status'::text$$;
create table plm.item(id uuid primary key,item_number text,style_number text,source_system text,raw jsonb);
create table public.style_tracker_rows(id uuid primary key,sku text,tracker_type text,row_data jsonb,discontinued boolean,license_status text,licensor text,customer text,default_vendor text);
create table plm.style_tracker_item_bridge(id uuid primary key,plm_item_id uuid,style_tracker_row_id uuid,tracker_type text);
create table plm.production_order_line(id uuid primary key,sku text,assortment_id text);
create table plm.production_order_line_source_ref(production_order_line_id uuid,source_system text,is_primary boolean,source_id text);
create table coldlion.intake_order_line(id uuid,company_code text,sales_order_no bigint,sales_order_line_no int,prod_reference_no text,master_item_no text,last_seen_run uuid);
create table plm.history_fixture(company_code text,sales_order_no bigint,prod_reference_no text,item_no text,sub_item_no text,component_id uuid,vendor_code text,line_id uuid);
create view plm.coldlion_prod_history as select * from plm.history_fixture;

create table coldlion.sync_run(id uuid primary key,started_at timestamptz);
