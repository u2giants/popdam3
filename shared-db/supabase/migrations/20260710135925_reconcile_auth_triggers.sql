-- Reconcile auth trigger DDL that was previously represented only by no-op
-- production ledger markers. Trigger replacement is non-destructive: existing
-- users and auth data are untouched.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

drop trigger if exists on_auth_user_created_popdam on auth.users;
create trigger on_auth_user_created_popdam
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The refresh-token sequence was inspected separately. Preview and production
-- already have the same owner, ownership dependency, and column default, so no
-- platform-owned sequence DDL is required here.
