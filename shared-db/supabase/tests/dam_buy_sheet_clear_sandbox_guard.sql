-- Contracts for the #6520 sandbox-only guard on public.clear_dam_buy_sheet_import().
--
-- What is being pinned:
--   1. Without the admin_config.SANDBOX_ENABLED_TOOLS row, a signed-in caller
--      is refused with 42501 and the sandbox-only message (production shape:
--      that row never exists there, so every call refuses).
--   2. With the row listing 'clear_dam_buy_sheet_import', the guard opens and
--      the call proceeds to normal behaviour (a signed-in user with no imports
--      gets P0002 "no buy-sheet import to clear"), proving the guard sits in
--      front of the undo logic without breaking it.
--
-- This test FAILS against the pre-#6520 definition, where a signed-in caller
-- with no imports goes straight to P0002.

begin;

delete from public.admin_config where key = 'SANDBOX_ENABLED_TOOLS';

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1. Refused without the enable row (production shape).
do $refused$
declare
  v_msg text := null;
begin
  begin
    perform public.clear_dam_buy_sheet_import(null, false);
    raise exception 'CONTRACT (#6520): call without SANDBOX_ENABLED_TOOLS did not raise';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = MESSAGE_TEXT;
    if position('sandbox-only' in v_msg) = 0 then
      raise exception 'CONTRACT (#6520): refusal message does not say sandbox-only: %', v_msg;
    end if;
  end;
  raise notice 'OK: without the enable row the call refuses with 42501 sandbox-only.';
end
$refused$;

-- 2. With the enable row the guard opens and normal behaviour resumes.
insert into public.admin_config (key, value, updated_at)
values ('SANDBOX_ENABLED_TOOLS', '["clear_dam_buy_sheet_import"]'::jsonb, now());

do $allowed$
declare
  v_msg text := null;
begin
  begin
    perform public.clear_dam_buy_sheet_import(null, false);
    raise exception 'CONTRACT (#6520): call with SANDBOX_ENABLED_TOOLS and no imports did not raise';
  exception when no_data_found then
    -- P0002: the function's own 'no buy-sheet import to clear' refusal, i.e. past the guard.
    get stacked diagnostics v_msg = MESSAGE_TEXT;
    if position('no buy-sheet import to clear' in v_msg) = 0 then
      raise exception 'CONTRACT (#6520): expected no-buy-sheet-to-clear past the guard, got: %', v_msg;
    end if;
  end;
  raise notice 'OK: with the enable row the guard opens and normal refusal-for-no-imports runs.';
end
$allowed$;

rollback;
