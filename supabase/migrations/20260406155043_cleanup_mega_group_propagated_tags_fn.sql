-- Helper function to delete propagated AI tags from pending assets in mega-groups,
-- in batches of 10,000 to avoid statement timeout.
-- These 6 groups had product-category folder names incorrectly treated as SKUs,
-- accumulating 324K wrong tag rows via non-deterministic propagation source selection.
-- Returns rows_deleted (0 when done). Called repeatedly until 0 is returned.

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM asset_tags
  WHERE ctid IN (
    SELECT at2.ctid
    FROM asset_tags at2
    JOIN assets a ON a.id = at2.asset_id
    WHERE at2.source = 'ai'
      AND a.style_group_id IN (
        '038e1fda-f413-495d-981a-f2bfbe3b604e',
        '0ef04984-f645-469b-9775-a0c8e3eb416a',
        '6241f8d1-1c75-4e4c-918f-28e73d8f3bc3',
        '2f8c7f5e-a76d-4310-b571-7202e847cb76',
        '4978fbe3-d604-477b-abe0-536cad1d706b',
        'ac2bbd81-648f-43a1-b1cf-4bb0bdd78d79'
      )
      AND a.ai_tagged_at IS NULL
      AND a.is_deleted = false
    LIMIT 10000
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
