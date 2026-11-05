set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

-- Bounded build: failures roll back without a long tagging-write lock.
create index if not exists render_queue_search_image_revision_idx
  on public.render_queue(asset_id, completed_at desc)
  where status = 'completed' and completed_at is not null;
