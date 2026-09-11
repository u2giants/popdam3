// Production can exceed the ordinary database statement ceiling when 500 rows
// and their render/search side effects are committed in one Edge request.
// Keep ingestion bounded without extending any timeout.
export const SG_CRAWL_INGEST_BATCH_SIZE = 100;
