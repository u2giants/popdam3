-- #4890 technical qualification only; all live/historical acceptance stays #4427.
-- Existing native ephemeral CI only, with fixed manual opt-in. Never a shared target.
\set rls4427_qualification 0
\getenv rls4427_qualification RLS4427_QUALIFICATION
select :'rls4427_qualification' in ('0','1') as rls4427_flag_valid,
       :'rls4427_qualification' = '1' as rls4427_run \gset
\if :rls4427_flag_valid
  \if :rls4427_run
    \! python3 scripts/qualify_rls4427_actual_tables.py
    \if :SHELL_ERROR
      \echo '4427 actual-table qualification failed; no acceptance may be claimed'
      do $failure$ begin raise exception '4427 driver failure'; end $failure$;
    \endif
  \else
    \echo '4427 actual-table qualification SKIPPED: no explicit manual opt-in; not evaluated'
  \endif
\else
  do $failure$ begin raise exception '4427 qualification flag must be exactly 0 or 1'; end $failure$;
\endif
