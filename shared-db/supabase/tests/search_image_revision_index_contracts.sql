-- Installed index contract: no application rows are modified.
begin;
do $$
declare idx regclass:='public.render_queue_search_image_revision_idx'::regclass; def text;
begin
 select pg_get_indexdef(idx) into def;
 if not exists(select 1 from pg_index where indexrelid=idx and indisvalid and indisready
  and indrelid='public.render_queue'::regclass) then raise exception 'revision index must be valid, ready and on render_queue'; end if;
 if def not like '%(asset_id, completed_at DESC)%' then raise exception 'revision lookup ordering lost'; end if;
 if def not like '%status = %completed%' or def not like '%completed_at IS NOT NULL%' then raise exception 'completed-only revision predicate lost'; end if;
 if def like '%UNIQUE%' then raise exception 'revision lookup must not impose source uniqueness'; end if;
end $$;
rollback;
