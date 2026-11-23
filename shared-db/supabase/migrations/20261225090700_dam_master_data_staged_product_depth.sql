-- Work issue #6984. Store a canonical Depth choice independently of item linking.

alter table public.style_tracker_rows
  add column staged_product_depth_id uuid references core.product_depth(id) on delete restrict,
  add constraint style_tracker_staged_product_depth_sheet_check
    check (staged_product_depth_id is null or tracker_type in ('licensed', 'generic'));

comment on column public.style_tracker_rows.staged_product_depth_id is
  'Depth selected on a Master Data row and awaiting transfer through the audited DesignFlow item write path.';

create function dam.validate_style_tracker_product_depth()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.staged_product_depth_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.staged_product_depth_id is not distinct from new.staged_product_depth_id then
      return new;
    end if;
  end if;

  if not exists (
    select 1
    from core.product_depth depth
    where depth.id = new.staged_product_depth_id and depth.status = 'active'
  ) then
    raise exception 'Choose an active Product Depth.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function dam.validate_style_tracker_product_depth() from public, anon, authenticated;

create trigger style_tracker_product_depth_validate
  before insert or update of staged_product_depth_id on public.style_tracker_rows
  for each row execute function dam.validate_style_tracker_product_depth();

-- Keep the independent Depth lookup free of dependencies on the legacy RFQ schema.
create view api.style_tracker_staged_product_depth with (security_invoker = true) as
select
  tracker.id as tracker_row_id,
  depth.id as product_depth_id,
  depth.label,
  depth.status = 'active' as selectable
from public.style_tracker_rows tracker
join core.product_depth depth on depth.id = tracker.staged_product_depth_id;

revoke all on api.style_tracker_staged_product_depth from public, anon;
grant select on api.style_tracker_staged_product_depth to authenticated, service_role;
