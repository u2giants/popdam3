-- Enable Supabase Realtime on tables used for live status subscriptions.
-- This replaces all frontend polling with push updates, eliminating the
-- 2M+ edge function invocations caused by repeated get-config / run-query calls.

ALTER PUBLICATION supabase_realtime ADD TABLE admin_config;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE render_queue;
