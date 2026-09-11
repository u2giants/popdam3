-- A classification outcome is an append-only event owned by its session. The same
-- product example may therefore produce byte-identical outcomes in separate sessions.
-- Completion-key uniqueness remains the idempotency boundary for one completion event.

alter table public.hts_rag_determinations
  drop constraint if exists hts_rag_determinations_method_product_example_id_result_has_key;

do $$
begin
  if exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'hts_rag_determinations'
       and c.contype = 'u'
       and pg_get_constraintdef(c.oid) = 'UNIQUE (method, product_example_id, result_hash)'
  ) then
    raise exception 'obsolete HTS result uniqueness still blocks separate sessions';
  end if;

  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'hts_rag_determinations'
       and c.contype = 'u'
       and c.conname = 'hts_rag_determinations_completion_key_uq'
       and pg_get_constraintdef(c.oid) = 'UNIQUE (completion_key)'
  ) then
    raise exception 'HTS completion-key idempotency constraint is missing or changed';
  end if;
end $$;
