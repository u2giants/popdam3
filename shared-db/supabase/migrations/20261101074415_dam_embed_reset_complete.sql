-- Version: 20261101074415
-- Complete the style-group embed-queue reset predicate (issue #5292,
-- review-finding #5268; application issue u2giants/popdam3#616).
-- derived-from: 20261101065326
--
-- 20261101065326 step 6 stated "every style_group document is claimable" but
-- its WHERE tested only embedding, attempts, lease fields and retry time. A
-- row carrying ONLY an error mark (e.g. embedding_error_category =
-- 'permanent' with attempts 0 and no lease) escaped the reset and stayed
-- outside claim_dam_search_embedding_documents' predicate (... AND
-- embedding_error_category IS DISTINCT FROM 'permanent'). Add the four
-- missing disjuncts so the reset covers every marker the claim predicate
-- consults. Idempotent; touches only style_group documents.

set statement_timeout = '10min';

update public.dam_search_documents
set embedding = null,
    embedding_model = null,
    embedding_updated_at = null,
    embedding_error = null,
    embedding_error_category = null,
    embedding_next_retry_at = null,
    embedding_attempts = 0,
    embedding_lease_token = null,
    embedding_lease_owner = null,
    embedding_lease_expires_at = null
where document_type = 'style_group'
  and (embedding is not null
       or embedding_model is not null
       or embedding_updated_at is not null
       or embedding_error is not null
       or embedding_error_category is not null
       or embedding_next_retry_at is not null
       or embedding_attempts <> 0
       or embedding_lease_token is not null
       or embedding_lease_owner is not null
       or embedding_lease_expires_at is not null);
