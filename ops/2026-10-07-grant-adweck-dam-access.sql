-- Grant PopDAM ("dam") app access to adweck@popcre.com (Microsoft sign-in).
-- Target: live project qsllyeztdwjgirsysgai. Exactly one row; aborts otherwise.
-- Why: his searches fail with "DAM access is required" (403) and show "No assets found".
begin;
do $$
declare n int;
begin
  if (select email from auth.users where id = 'fde045bf-c899-4b75-b579-e4fef0308380') <> 'adweck@popcre.com'
     or not exists (select 1 from app.profile where id = 'c6c3b9e1-7235-4ed1-8c2c-cc230a884736'
                    and auth_user_id = 'fde045bf-c899-4b75-b579-e4fef0308380' and status = 'active') then
    raise exception 'target profile mismatch';
  end if;
  insert into app.app_access (profile_id, app, granted_by_profile_id)
  values ('c6c3b9e1-7235-4ed1-8c2c-cc230a884736', 'dam', '0301af81-7aa9-4655-8746-61bccd93a78e');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected 1 row, got %', n; end if;
end $$;
commit;
