-- Sandbox catch-up batch 15 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Copies production's current plm.guard_production_po_number() (buy-sheet orders may wait for their PO, owner rule
-- 2026-11-16, #6476). Grants unchanged (owner-only execute on both sides).
-- derived-from: none

CREATE OR REPLACE FUNCTION plm.guard_production_po_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  next_po text := plm.normalize_production_po_number(new.production_order_number);
  claimed_po text;
  admitted_id uuid;
begin
  if next_po is null or next_po = '' then
    -- Buy-sheet orders wait for their PO (owner rule 2026-11-16, shared-db#6476).
    if next_po = '' and new.source_system = 'popdam_buy_sheet'
       and (tg_op = 'INSERT'
            or plm.normalize_production_po_number(old.production_order_number) = '') then
      return new;
    end if;
    raise exception 'A production PO number is required.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'An existing order identity cannot be changed.' using errcode = '23514';
    end if;
    -- Existing historical reuse is grandfathered by identity, never by date or role.
    if next_po = plm.normalize_production_po_number(old.production_order_number) then
      return new;
    end if;
    -- A blank buy-sheet order receives its PO once; the number is reserved below.
    if plm.normalize_production_po_number(old.production_order_number) is distinct from '' then
      raise exception 'An existing production PO number cannot be changed.' using errcode = '23514';
    end if;
  end if;

  -- An exact-ID INSERT ... ON CONFLICT UPDATE can update the same existing order.
  -- A deleted order no longer qualifies, so its number cannot be recycled.
  if tg_op = 'INSERT' and exists (select 1 from plm.production_order p
             where p.id = new.id and plm.normalize_production_po_number(p.production_order_number) = next_po) then
    return new;
  end if;

  -- The primary key waits on concurrent reservations and permits only one winner.
  insert into plm.production_po_reservation(normalized_po) values (next_po)
  on conflict (normalized_po) do nothing returning normalized_po into claimed_po;
  if claimed_po is not null then return new; end if;

  update plm.production_po_legacy_admission
     set used_at = clock_timestamp()
   where order_id = new.id and normalized_po = next_po and used_at is null
   returning order_id into admitted_id;
  if admitted_id is not null then return new; end if;

  raise exception 'This production PO number has already been used. Enter a new number.'
    using errcode = '23505', constraint = 'production_po_no_reuse';
end;
$function$
;
