-- Review finding #5508 on 20261102224413 (issue #5454), fixed forward.
-- A trailing blank candidate ('1001', '') joins to '1001,', which the per-candidate regex
-- accepts. Reject blank candidates explicitly. Added not valid, then validated.
alter table hts_rag.hts_rag_ruling_current_codes drop constraint if exists hts_rag_ruling_current_codes_code_check;
alter table hts_rag.hts_rag_ruling_current_codes add constraint hts_rag_ruling_current_codes_code_check
  check ((current_code is null or current_code ~ '^[0-9]{4}(\.[0-9]{2}){0,3}$')
         and array_position(candidate_codes, null) is null
         and array_position(candidate_codes, '') is null
         and array_to_string(candidate_codes, ',') ~ '^([0-9]{4}(\.[0-9]{2}){0,3}(,|$))*$') not valid;
alter table hts_rag.hts_rag_ruling_current_codes validate constraint hts_rag_ruling_current_codes_code_check;
