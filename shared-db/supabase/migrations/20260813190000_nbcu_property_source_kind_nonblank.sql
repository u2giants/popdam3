-- NBCU source_kind values are source metadata, not a closed database enum.
-- Keep the importer responsible for reviewing new values while preserving the
-- exact reviewed source text in this capture-scoped landing table.

alter table plm.nbcu_property
  drop constraint if exists nbcu_property_source_kind_chk;

alter table plm.nbcu_property
  add constraint nbcu_property_source_kind_nonblank_chk
  check (btrim(source_kind) <> '');
