-- Issue #7070. Production team role, used by factory customer approvals.
-- Separate migration: a new enum value cannot be used in the transaction that adds it.
alter type app.app_role add value if not exists 'production';
