-- popdam3#963: folder rename log, path_as_of, path_candidates, move-history retention.

do $t$
declare
  v_batch uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_n int;
  v_c text[];
  v_cmd text;
begin
  -- A11 path_as_of matches whole segments only
  insert into dam.folder_rename_log (share, old_path, new_path, renamed_at, batch_id, rule)
  values ('t963', 'A/Ross Wall 2026', 'A/Ross', '2026-06-01', v_batch, 'test');
  if dam.path_as_of('t963', 'A/Ross Stores/x.psd', '2026-01-01') <> 'A/Ross Stores/x.psd' then
    raise exception 'path_as_of matches whole segments only: prefix bled into Ross Stores';
  end if;
  if dam.path_as_of('t963', 'A/Ross/x.psd', '2026-01-01') <> 'A/Ross Wall 2026/x.psd' then
    raise exception 'rename dated after p_at must be undone';
  end if;
  if dam.path_as_of('t963', 'A/Ross', '2026-01-01') <> 'A/Ross Wall 2026' then
    raise exception 'exact folder path must be undone';
  end if;
  if dam.path_as_of('t963', 'A/Ross/x.psd', '2026-07-01') <> 'A/Ross/x.psd' then
    raise exception 'rename dated before p_at must not be undone';
  end if;
  if dam.path_as_of('t963', 'B/untouched.psd', '2020-01-01') <> 'B/untouched.psd' then
    raise exception 'untouched path must return unchanged';
  end if;

  -- A12 chained and reverted renames; names with LIKE wildcards are literal
  insert into dam.folder_rename_log (share, old_path, new_path, renamed_at, batch_id, rule) values
    ('t963', 'C/____New_%', 'C/Mid', '2026-03-01', v_batch, 'test'),
    ('t963', 'C/Mid', 'C/Short', '2026-05-01', v_batch, 'test'),
    ('t963', 'C/Short', 'C/Oops', '2026-06-01', v_batch, 'test');
  update dam.folder_rename_log set reverted_at = '2026-06-02' where share = 't963' and new_path = 'C/Oops';
  if dam.path_as_of('t963', 'C/Short/f.ai', '2026-01-01') <> 'C/____New_%/f.ai' then
    raise exception 'path_as_of across chained renames (before both)';
  end if;
  if dam.path_as_of('t963', 'C/Short/f.ai', '2026-04-01') <> 'C/Mid/f.ai' then
    raise exception 'path_as_of across chained renames (between)';
  end if;
  if dam.path_as_of('t963', 'C/Short/f.ai', '2026-05-15') <> 'C/Short/f.ai' then
    raise exception 'reverted renames must be ignored';
  end if;
  if dam.path_as_of('t963', 'C/Mixed/f.ai', '2026-01-01') <> 'C/Mixed/f.ai' then
    raise exception 'wildcard characters must not pattern-match';
  end if;

  -- path_candidates on the real share uses public.assets + public.asset_path_history
  insert into dam.folder_rename_log (share, old_path, new_path, renamed_at, batch_id, rule)
  values ('mac', 'Z963/Customer Adopted', 'Z963/Cust Adopted', '2026-06-01', v_batch, 'test');
  insert into public.assets (id, relative_path, filename, file_type, quick_hash, modified_at)
  values (v_asset, 'Z963/Cust Adopted/new/f.psd', 'f.psd', 'psd', 'qh963', now());
  insert into public.asset_path_history (asset_id, old_relative_path, new_relative_path)
  values (v_asset, 'Z963/Cust Adopted/old/f.psd', 'Z963/Cust Adopted/new/f.psd');
  select array_agg(p order by p) into v_c from dam.path_candidates('mac', v_asset) p;
  if v_c is distinct from array[
      'Z963/Cust Adopted/new/f.psd', 'Z963/Cust Adopted/old/f.psd',
      'Z963/Customer Adopted/new/f.psd', 'Z963/Customer Adopted/old/f.psd'] then
    raise exception 'path_candidates wrong or duplicated: %', v_c;
  end if;
  select count(*) into v_n from public.dam_asset_path_candidates(v_asset);
  if v_n <> 4 then
    raise exception 'public wrapper must return the same candidates';
  end if;

  -- grants
  if has_function_privilege('authenticated', 'public.dam_asset_path_candidates(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'dam.path_as_of(text,text,timestamptz)', 'EXECUTE') then
    raise exception 'functions must be service-role only';
  end if;
  if has_table_privilege('authenticated', 'dam.folder_rename_log', 'INSERT') then
    raise exception 'rename log must be written only by the service role';
  end if;

  -- 1.3 retention, where pg_cron exists
  if to_regclass('cron.job') is not null then
    select command into v_cmd from cron.job where jobname = 'purge-asset-path-history-old-rows';
    if v_cmd is null or v_cmd not like '%400 days%' then
      raise exception 'move history purge must keep 400 days';
    end if;
  end if;
end
$t$;

