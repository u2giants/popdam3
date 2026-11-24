do $test$
declare
  definition text := pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass);
begin
  if strpos(definition, $needle$NULLIF(TRIM(BOTH FROM i."rfqItem_style_number"), ''::text) IS NOT NULL$needle$) = 0 then
    raise exception 'The Master Data RFQ lookup must state the partial index predicate';
  end if;
end;
$test$;
