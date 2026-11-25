-- Issue #7070. Production team role, used by factory customer approvals.
-- Re-issue of 20261225130000 (PR #7071), never applied: its batch was refused at preview.
-- Separate migration: a new enum value cannot be used in the transaction that adds it.
alter type app.app_role add value if not exists 'production';
