// Production can exceed the ordinary database statement ceiling when 500 rows
// and their render/search side effects are committed in one Edge request.
// Keep ingestion bounded without extending any timeout.
export const SG_CRAWL_INGEST_BATCH_SIZE = 100;

// Supports the scheduler's 67-minute hard cap plus bounded reconciliation and
// search continuations, while keeping the existing 30-second delay ceiling.
export const SG_CRAWL_MAX_COMPLETION_CONTINUATIONS = 240;
