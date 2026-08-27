-- #1452: support unread badge counts and bounded newest-first notification lists.
--
-- The partial predicate keeps read notifications out of the index.  The leading
-- user key supports count/mark-all lookups, while created_date preserves the
-- application's requested order for its limited list.
create index if not exists user_notification_unread_user_created_idx
  on dflow.user_notification (user_id_fk, created_date desc)
  where unread = true;
