-- Fix-forward for review finding popcre/shared-db#5955 on PR #5953 (migration 20261108152959).
--
-- Schema plm carries ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role, so both
-- tables were born with service_role UPDATE/DELETE/TRUNCATE and the bare grants in 20261108152959
-- did not restrict anything. Rows of plm.licensor_submission_pdf are evidence and are never edited;
-- a capture row may only advance its own progress columns. No data is read or written here.

revoke update, delete, truncate on plm.licensor_submission_pdf from service_role;
revoke update, delete, truncate on plm.licensor_submission_pdf_capture from service_role;
grant update (loaded_file_count, status, completed_at, notes) on plm.licensor_submission_pdf_capture to service_role;

do $assert$
begin
  if has_table_privilege('service_role', 'plm.licensor_submission_pdf', 'UPDATE')
     or has_table_privilege('service_role', 'plm.licensor_submission_pdf', 'DELETE')
     or has_table_privilege('service_role', 'plm.licensor_submission_pdf', 'TRUNCATE')
     or has_table_privilege('service_role', 'plm.licensor_submission_pdf_capture', 'DELETE')
     or has_table_privilege('service_role', 'plm.licensor_submission_pdf_capture', 'TRUNCATE')
     or has_column_privilege('service_role', 'plm.licensor_submission_pdf_capture', 'capture_key', 'UPDATE')
     or has_column_privilege('service_role', 'plm.licensor_submission_pdf_capture', 'expected_file_count', 'UPDATE')
  then
    raise exception '#5955: licensor submission-PDF immutability revokes did not take';
  end if;
  if not has_table_privilege('service_role', 'plm.licensor_submission_pdf', 'INSERT')
     or not has_column_privilege('service_role', 'plm.licensor_submission_pdf_capture', 'status', 'UPDATE')
  then
    raise exception '#5955: loader privileges missing after revoke';
  end if;
end
$assert$;
