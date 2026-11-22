-- #6871: a 768-dimensional inline vector already exceeds the default TOAST target.
-- Its short model label was stored out of line, so every exact picture scan
-- fetched the label separately before scoring each vector.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '8s';
set local search_path = pg_catalog, dam;

-- A relation option takes ShareUpdateExclusiveLock. Keep readers and regular
-- embedding writes compatible with the table lock during the bounded refresh.
alter table dam.search_group_vectors set (toast_tuple_target = 4096);

do $refresh$
begin
  if (select count(*) from (select 1 from dam.search_group_vectors limit 20001) rows) > 20000 then
    raise exception '#6871 group vector projection exceeds the bounded storage refresh';
  end if;

  -- Re-form the short variable-length value so PostgreSQL can store it inline.
  -- Uncompressed out-of-line text reports its payload size, whereas inline
  -- text includes a header. Only short legacy labels need this refresh.
  update dam.search_group_vectors
  set embedding_model = embedding_model || ''
  where octet_length(embedding_model) <= 256
    and pg_column_size(embedding_model) <= octet_length(embedding_model);
end;
$refresh$;

commit;
