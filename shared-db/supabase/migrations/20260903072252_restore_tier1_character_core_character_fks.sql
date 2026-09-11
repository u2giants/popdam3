-- Issue #2146 (claim #2153): restore the core.character referential contract on
-- the three Tier-1 source character tables.
--
-- derived-from: none
--
-- 20260823133150_drop_empty_universe_a_character_tables.sql dropped
-- nbcu_character_core_character_id_fkey, opa_character_core_character_id_fkey
-- and pmt_character_core_character_id_fkey because it was about to drop
-- core.character. 20260829004145_separate_property_and_character.sql recreated
-- core.character and restored the contract for
-- core.property_character_associations and plm.item_character_associations, but
-- not for these three tables, so plm.nbcu_character.core_character_id,
-- plm.opa_character.core_character_id and plm.pmt_character.core_character_id
-- have been unchecked resolution pointers ever since.
--
-- Shape derived from the surviving neighbours restored by 20260829004145
-- (core.property_character_associations.character_id and
-- plm.item_character_associations.character_id), both of which carry
-- ON UPDATE CASCADE ON DELETE RESTRICT. The pre-#1684 declarations in
-- 20260810020000 (pmt), 20260810070000 (nbcu) and 20260814040000 (opa) named
-- only ON DELETE RESTRICT and therefore defaulted to ON UPDATE NO ACTION; the
-- current neighbour shape is adopted deliberately so one Character contract
-- exists rather than two. core.character(id) is a generated uuid primary key
-- that is never updated, so the cascade cannot move a resolved pointer.
--
-- No rows are inserted, updated or deleted. Column types and nullability are
-- unchanged: uuid null on all three, matching core.character.id (uuid).
--
-- Reversal: drop the three named constraints. Nothing else in this file
-- changes state.

begin;

-- SHARE ROW EXCLUSIVE blocks concurrent writers (so no unresolvable value can
-- appear between the check below and the constraint) while leaving readers
-- alone. It is the lock level ADD CONSTRAINT takes anyway.
lock table plm.nbcu_character in share row exclusive mode;
lock table plm.opa_character in share row exclusive mode;
lock table plm.pmt_character in share row exclusive mode;

do $precheck$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
  from plm.nbcu_character s
  where s.core_character_id is not null
    and not exists (select 1 from core.character c where c.id = s.core_character_id);
  if v_orphans <> 0 then
    raise exception
      'issue #2146 refused: plm.nbcu_character has % core_character_id value(s) with no core.character row',
      v_orphans;
  end if;

  select count(*) into v_orphans
  from plm.opa_character s
  where s.core_character_id is not null
    and not exists (select 1 from core.character c where c.id = s.core_character_id);
  if v_orphans <> 0 then
    raise exception
      'issue #2146 refused: plm.opa_character has % core_character_id value(s) with no core.character row',
      v_orphans;
  end if;

  select count(*) into v_orphans
  from plm.pmt_character s
  where s.core_character_id is not null
    and not exists (select 1 from core.character c where c.id = s.core_character_id);
  if v_orphans <> 0 then
    raise exception
      'issue #2146 refused: plm.pmt_character has % core_character_id value(s) with no core.character row',
      v_orphans;
  end if;
end
$precheck$;

alter table plm.nbcu_character
  add constraint nbcu_character_core_character_id_fkey
  foreign key (core_character_id) references core.character(id)
  on update cascade on delete restrict;

alter table plm.opa_character
  add constraint opa_character_core_character_id_fkey
  foreign key (core_character_id) references core.character(id)
  on update cascade on delete restrict;

alter table plm.pmt_character
  add constraint pmt_character_core_character_id_fkey
  foreign key (core_character_id) references core.character(id)
  on update cascade on delete restrict;

comment on constraint nbcu_character_core_character_id_fkey on plm.nbcu_character is
  'A resolved NBCU character must point at a real core.character row; a referenced Character cannot be deleted while this resolution stands.';
comment on constraint opa_character_core_character_id_fkey on plm.opa_character is
  'A resolved OPA character must point at a real core.character row; a referenced Character cannot be deleted while this resolution stands.';
comment on constraint pmt_character_core_character_id_fkey on plm.pmt_character is
  'A resolved Paramount character must point at a real core.character row; a referenced Character cannot be deleted while this resolution stands.';

-- Verification. Asserts the DEFINITION of each constraint, not its name:
-- referencing table, single referencing column core_character_id, referenced
-- relation core.character, single referenced column id, ON UPDATE CASCADE
-- ('c'), ON DELETE RESTRICT ('r'), MATCH SIMPLE ('s'), and validated. The final
-- cardinality assertion refuses any outcome other than exactly three such
-- foreign keys across the three tables, so a dropped, renamed, duplicated or
-- misdirected constraint cannot pass.
do $verify$
declare
  v_expected constant text[] := array[
    'plm.nbcu_character', 'nbcu_character_core_character_id_fkey',
    'plm.opa_character',  'opa_character_core_character_id_fkey',
    'plm.pmt_character',  'pmt_character_core_character_id_fkey'
  ];
  v_table text;
  v_name text;
  v_matched integer;
  v_total integer;
  i integer;
begin
  i := 1;
  while i < array_length(v_expected, 1) loop
    v_table := v_expected[i];
    v_name := v_expected[i + 1];

    select count(*) into v_matched
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = c.conkey[1]
     and not a.attisdropped
    join pg_attribute ra
      on ra.attrelid = c.confrelid
     and ra.attnum = c.confkey[1]
     and not ra.attisdropped
    where c.contype = 'f'
      and c.conrelid = v_table::regclass
      and c.conname = v_name
      and array_length(c.conkey, 1) = 1
      and array_length(c.confkey, 1) = 1
      and a.attname = 'core_character_id'
      and c.confrelid = 'core.character'::regclass
      and ra.attname = 'id'
      and c.confupdtype = 'c'
      and c.confdeltype = 'r'
      and c.confmatchtype = 's'
      and c.convalidated;

    if v_matched <> 1 then
      raise exception
        'issue #2146 verification failed: expected exactly one validated foreign key % on % as (core_character_id) references core.character(id) on update cascade on delete restrict, found %',
        v_name, v_table, v_matched;
    end if;

    i := i + 2;
  end loop;

  select count(*) into v_total
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'core.character'::regclass
    and c.conrelid in (
      'plm.nbcu_character'::regclass,
      'plm.opa_character'::regclass,
      'plm.pmt_character'::regclass
    );

  if v_total <> 3 then
    raise exception
      'issue #2146 verification failed: expected exactly 3 foreign keys to core.character across the three Tier-1 character tables, found %',
      v_total;
  end if;
end
$verify$;

commit;
