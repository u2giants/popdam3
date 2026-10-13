-- Issue #4150 (claim #4245): ColdLion /orderHistory createdTime / createdUser / modTime /
-- modUser on coldlion.order_history_line, read as New York time.
--
-- Why: ColdLion added these four ORDER-LEVEL fields to /orderHistory (identical on every
-- line of one salesOrderNo) and on 2026-10-12 moved createdTime/modTime to the sales-order
-- details (not the invoice). The vendor sends a zone-less wall clock
-- 'YYYY-MM-DD HH:MM:SS.mmm' in New York time (Settled, Albert Hazan, 2026-10-09:
-- "All ColdLion times are New York time"). The loader converts that wall clock from
-- America/New_York to an instant before writing; this column is that instant.
--
-- Production never received 20261009170724 (issue #3869, which added the same four
-- columns for the DesignFlow sandbox and described them as "landed as UTC"). This
-- migration is self-sufficient: ADD COLUMN IF NOT EXISTS lands the columns where they are
-- missing and is a no-op where 20261009170724 already ran. The comments are restated
-- with the New York reading, which supersedes the earlier "landed as UTC" text.
--
-- Additive only: four nullable columns, no default, no rewrite, no index, no grant
-- change. Not part of line_source_hash (modTime moves on every edit; hashing it would mint
-- a new line version per edit). Existing rows stay NULL until the re-runnable
-- tools/coldlion-landing/backfill-order-stamps.mjs fills them, one 7-day window per
-- statement.

alter table coldlion.order_history_line
  add column if not exists created_time timestamptz,
  add column if not exists created_user text,
  add column if not exists mod_time     timestamptz,
  add column if not exists mod_user     text;

do $$
declare
  bad text;
begin
  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ')
    into bad
    from pg_attribute a
   where a.attrelid = 'coldlion.order_history_line'::regclass
     and not a.attisdropped
     and ((a.attname in ('created_time', 'mod_time')
           and a.atttypid <> 'timestamp with time zone'::regtype)
       or (a.attname in ('created_user', 'mod_user') and a.atttypid <> 'text'::regtype));
  if bad is not null then
    raise exception 'coldlion.order_history_line stamp columns have unexpected types: %', bad;
  end if;
end
$$;

comment on column coldlion.order_history_line.created_time is
  'ColdLion /orderHistory createdTime: when the sales order was entered in ColdLion (order details, per ColdLion''s 2026-10-12 fix). Order-level: the same on every line of one sales order. The vendor sends a zone-less New York wall clock; the loader reads it as America/New_York (Settled, Albert Hazan, 2026-10-09). Not part of line_source_hash. NULL until loaded or backfilled. Issue #4150.';
comment on column coldlion.order_history_line.created_user is
  'ColdLion /orderHistory createdUser, paired with created_time. Issue #4150.';
comment on column coldlion.order_history_line.mod_time is
  'ColdLion /orderHistory modTime: last change in ColdLion as of the fetch. Order-level. Read as America/New_York like created_time. Not part of line_source_hash. Issue #4150.';
comment on column coldlion.order_history_line.mod_user is
  'ColdLion /orderHistory modUser, paired with mod_time. Issue #4150.';
