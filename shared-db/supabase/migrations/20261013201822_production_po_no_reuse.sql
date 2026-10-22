-- derived-from: none
-- #4257 / PopDAM #277. Future production PO identities are never reused.
-- Existing historical duplicate headers are preserved, including their raw spelling.
-- No business rows, source references, or completed integration fields are rewritten.

begin;

-- Serialize cutover with every header writer while capturing all existing numbers.
lock table plm.production_order in share row exclusive mode;

create function plm.normalize_production_po_number(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $function$
  select lower(regexp_replace(value, U&'^[[:space:]\00A0]+|[[:space:]\00A0]+$', '', 'g'));
$function$;

revoke all on function plm.normalize_production_po_number(text) from public, anon, authenticated, service_role;

do $cutover$
begin
  if exists (select 1 from plm.production_order
             where plm.normalize_production_po_number(production_order_number) = '') then
    raise exception 'Production PO enforcement requires resolving existing blank numbers first.'
      using errcode = '23514';
  end if;
end;
$cutover$;

create table plm.production_po_reservation (
  normalized_po text primary key,
  reserved_at timestamptz not null default now(),
  constraint production_po_reservation_normalized check (
    normalized_po <> '' and normalized_po = plm.normalize_production_po_number(normalized_po)
  )
);

-- Closed technical recovery surface, not an application/importer bypass. A reviewed
-- historical disposition may enroll one exact new UUID before its first insert.
-- Its proof digests bind the private historical evidence and independent review.
create table plm.production_po_legacy_admission (
  order_id uuid primary key,
  normalized_po text not null references plm.production_po_reservation(normalized_po),
  source_evidence_sha256 text not null check (source_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  review_receipt_sha256 text not null check (review_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  admitted_at timestamptz not null default now(),
  used_at timestamptz
);

alter table plm.production_po_reservation enable row level security;
alter table plm.production_po_legacy_admission enable row level security;
revoke all on plm.production_po_reservation from public, anon, authenticated, service_role;
revoke all on plm.production_po_legacy_admission from public, anon, authenticated, service_role;

insert into plm.production_po_reservation(normalized_po)
select distinct plm.normalize_production_po_number(production_order_number)
from plm.production_order where plm.normalize_production_po_number(production_order_number) <> '';

create function plm.guard_production_po_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  next_po text := plm.normalize_production_po_number(new.production_order_number);
  claimed_po text;
  admitted_id uuid;
begin
  if next_po is null or next_po = '' then
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
    raise exception 'An existing production PO number cannot be changed.' using errcode = '23514';
  end if;

  -- An exact-ID INSERT ... ON CONFLICT UPDATE can update the same existing order.
  -- A deleted order no longer qualifies, so its number cannot be recycled.
  if exists (select 1 from plm.production_order p
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
$function$;

revoke all on function plm.guard_production_po_number() from public, anon, authenticated, service_role;

create trigger production_po_no_reuse
before insert or update on plm.production_order
for each row execute function plm.guard_production_po_number();

comment on table plm.production_po_reservation is
  'Permanent case/outer-whitespace normalized production PO reservations. No cascade: cancellation, voiding and deletion never release a number. Historical duplicate headers remain intact.';
comment on table plm.production_po_legacy_admission is
  'Postgres-owner-only, one-use exact-order historical admissions requiring private evidence and review digests. Application roles and service_role have no access. Never a general import/date-based exemption.';
comment on function plm.guard_production_po_number() is
  'Atomic no-reuse enforcement for every canonical header writer; preserves existing historical duplicates and immutable identities. Punctuation and leading zeros are significant.';

commit;
