CREATE OR REPLACE FUNCTION public.execute_readonly_query(query_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT (lower(trim(query_text)) ~ '^select\s') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  IF lower(query_text) ~ '\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  
  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;