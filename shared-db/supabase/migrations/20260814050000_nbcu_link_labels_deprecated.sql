-- NBCU: stop forcing duplicated labels onto the property-character link table.
--
-- plm.nbcu_property_character already has the right bones — a composite key, foreign keys
-- to both entity tables, and zero orphans. Its one flaw is that it also stores
-- property_label and character_label, which duplicate plm.nbcu_property.property_label and
-- plm.nbcu_character.character_label on every link row.
--
-- Verified on production 2026-08-13 before writing this: across all 190 link rows there are
-- ZERO label mismatches against the entity tables, zero orphan property keys and zero
-- orphan character keys. The duplication is currently consistent — which is exactly the
-- state in which to remove the requirement, before a future capture makes the two copies
-- disagree and leaves nobody able to say which is right.
--
-- WHY NOT JUST DROP THE COLUMNS. The NBCU loader writes them today, and it writes them
-- because they are NOT NULL — it has no choice. Dropping the columns now would break the
-- next capture. Dropping the NOT NULL first lets the loader stop writing them at its own
-- pace, with nothing breaking on either side; the columns themselves come out in a
-- follow-up once it has. This is the same sequencing used for the Disney OPA normalization
-- in 20260814040000.
--
-- This migration touches NBCU only. Warner needs nothing here: it was already normalized on
-- 2026-08-13 by 20260813230000/20260813231000, and its flat wb_property_character is the
-- retired generation, kept alongside a live legacy code path that is not ours to remove.

do $$
declare
  v_prop_mismatch bigint;
  v_char_mismatch bigint;
  v_orphans bigint;
begin
  -- Refuse to relax the constraint if the duplicate has ALREADY drifted. In that case the
  -- right response is to reconcile first, not to quietly make the bad copy optional.
  select count(*) into v_prop_mismatch
  from plm.nbcu_property_character pc
  join plm.nbcu_property p
    on p.property_key = pc.property_key and p.capture_id = pc.capture_id
  where p.property_label is distinct from pc.property_label;

  select count(*) into v_char_mismatch
  from plm.nbcu_property_character pc
  join plm.nbcu_character c
    on c.character_key = pc.character_key and c.capture_id = pc.capture_id
  where c.character_label is distinct from pc.character_label;

  select count(*) into v_orphans
  from plm.nbcu_property_character pc
  where not exists (
          select 1 from plm.nbcu_property p
          where p.property_key = pc.property_key and p.capture_id = pc.capture_id)
     or not exists (
          select 1 from plm.nbcu_character c
          where c.character_key = pc.character_key and c.capture_id = pc.capture_id);

  if v_prop_mismatch > 0 or v_char_mismatch > 0 then
    raise exception
      'nbcu link labels: % property and % character labels already disagree with the entity tables; reconcile before deprecating',
      v_prop_mismatch, v_char_mismatch;
  end if;

  if v_orphans > 0 then
    raise exception
      'nbcu link labels: % link rows have no entity row; the entity tables cannot yet replace the labels',
      v_orphans;
  end if;

  raise notice 'nbcu link labels: verified consistent, proceeding';
end $$;

alter table plm.nbcu_property_character alter column property_label  drop not null;
alter table plm.nbcu_property_character alter column character_label drop not null;

comment on column plm.nbcu_property_character.property_label is
  'DEPRECATED duplicate of plm.nbcu_property.property_label. Do not read it and do not '
  'write it. Nullable since 2026-08-14 so the loader can stop populating it; the column is '
  'dropped once it has.';

comment on column plm.nbcu_property_character.character_label is
  'DEPRECATED duplicate of plm.nbcu_character.character_label. Do not read it and do not '
  'write it. Nullable since 2026-08-14 so the loader can stop populating it; the column is '
  'dropped once it has.';

comment on table plm.nbcu_property_character is
  'NBCU property-to-character LINK table. Join to plm.nbcu_property and plm.nbcu_character '
  'for labels — the property_label and character_label columns here are deprecated '
  'duplicates awaiting removal. evidence_type and evidence_value are genuine link '
  'attributes and stay.';
