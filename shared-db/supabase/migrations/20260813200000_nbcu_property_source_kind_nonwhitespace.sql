-- btrim(text) removes ordinary spaces only. Require at least one character
-- outside PostgreSQL's POSIX whitespace class so tabs and line breaks cannot
-- satisfy the landing contract either.

alter table plm.nbcu_property
  drop constraint if exists nbcu_property_source_kind_nonblank_chk;

alter table plm.nbcu_property
  add constraint nbcu_property_source_kind_nonblank_chk
  check (source_kind ~ '[^[:space:]]');
