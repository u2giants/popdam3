-- Remove render_queue from Realtime publication (eliminates #1/#2 most expensive WAL queries)
ALTER PUBLICATION supabase_realtime DROP TABLE public.render_queue;

-- Drop all SynoMon tables accidentally applied to this project (~634 MB)
DROP TABLE IF EXISTS public.smon_logs CASCADE;
DROP TABLE IF EXISTS public.smon_metrics CASCADE;
DROP TABLE IF EXISTS public.smon_storage_snapshots CASCADE;
DROP TABLE IF EXISTS public.smon_container_status CASCADE;
DROP TABLE IF EXISTS public.smon_security_events CASCADE;
DROP TABLE IF EXISTS public.smon_ai_analyses CASCADE;
DROP TABLE IF EXISTS public.smon_alerts CASCADE;
DROP TABLE IF EXISTS public.smon_copilot_messages CASCADE;
DROP TABLE IF EXISTS public.smon_analyzed_problems CASCADE;
DROP TABLE IF EXISTS public.smon_copilot_actions CASCADE;
DROP TABLE IF EXISTS public.smon_user_roles CASCADE;
DROP TABLE IF EXISTS public.smon_copilot_sessions CASCADE;
DROP TABLE IF EXISTS public.smon_analysis_runs CASCADE;
DROP TABLE IF EXISTS public.smon_ai_settings CASCADE;
DROP TABLE IF EXISTS public.smon_nas_units CASCADE;
DROP TABLE IF EXISTS public.smon_push_subscriptions CASCADE;
DROP TABLE IF EXISTS public.smon_drive_activities CASCADE;
DROP TABLE IF EXISTS public.smon_sync_remediations CASCADE;
DROP TABLE IF EXISTS public.smon_drive_team_folders CASCADE;

-- Truncate render_queue: 0 pending/claimed rows confirmed, 226 MB physical bloat
TRUNCATE public.render_queue;
