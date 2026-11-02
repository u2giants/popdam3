-- Review finding #5491 on 20261102195830 (issue #5454, designflow-backend#278), fixed forward.
-- array_to_string drops NULL elements, so a NULL candidate passed the code check. Reject NULLs
-- explicitly. Added not valid, then validated, so any offending row fails with a clear error.
alter table hts_rag.hts_rag_ruling_current_codes drop constraint if exists hts_rag_ruling_current_codes_code_check;
alter table hts_rag.hts_rag_ruling_current_codes add constraint hts_rag_ruling_current_codes_code_check
  check ((current_code is null or current_code ~ '^[0-9]{4}(\.[0-9]{2}){0,3}$')
         and array_position(candidate_codes, null) is null
         and array_to_string(candidate_codes, ',') ~ '^([0-9]{4}(\.[0-9]{2}){0,3}(,|$))*$') not valid;
alter table hts_rag.hts_rag_ruling_current_codes validate constraint hts_rag_ruling_current_codes_code_check;
