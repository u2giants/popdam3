-- #4707: normalized DesignFlow merchandise-group, custom-value, and price slots.
-- derived-from: none
-- Additive foundation. Application data, service access, and cutover are
-- delivered by the consumer separately. The existing item master owns identity.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table plm.item_merch_group (
  item_id uuid not null references plm.item(id) on delete cascade,
  slot_number smallint not null check (slot_number between 1 and 25),
  merch_group_id uuid references core.merch_group(id) on delete restrict,
  legacy_merch_group_id integer,
  legacy_code text check (legacy_code is null or btrim(legacy_code) <> ''),
  resolution text not null,
  primary key (item_id, slot_number),
  constraint item_merch_group_resolution_check check (
    case resolution
      when 'resolved' then merch_group_id is not null
      when 'code_only' then merch_group_id is null
                            and legacy_merch_group_id is null and legacy_code is not null
      when 'held_ambiguous' then merch_group_id is null and legacy_merch_group_id is not null
      when 'held_unmatched' then merch_group_id is null and legacy_merch_group_id is not null
      when 'missing_id_bridge' then merch_group_id is null and legacy_merch_group_id is not null
      when 'wrong_item_context' then merch_group_id is null and legacy_merch_group_id is not null
      when 'code_conflict' then merch_group_id is null
                                 and legacy_merch_group_id is not null and legacy_code is not null
      else false
    end
  )
);

create index item_merch_group_merch_group_id_idx
  on plm.item_merch_group (merch_group_id)
  where merch_group_id is not null;

create table plm.item_custom_value (
  item_id uuid not null references plm.item(id) on delete cascade,
  slot_kind text not null,
  slot_number smallint not null,
  text_value text,
  date_value timestamp without time zone,
  integer_value integer,
  numeric_value numeric,
  primary key (item_id, slot_kind, slot_number),
  constraint item_custom_value_typed_slot_check check (
    num_nonnulls(text_value, date_value, integer_value, numeric_value) = 1
    and case slot_kind
      when 'freeform' then slot_number between 1 and 20 and text_value is not null
      when 'date' then slot_number between 1 and 20 and date_value is not null
      when 'integer' then slot_number between 1 and 10 and integer_value is not null
      when 'number' then slot_number between 1 and 10 and numeric_value is not null
      when 'yes_no' then slot_number between 1 and 15 and text_value is not null
      when 'number_text' then slot_number = 1 and text_value is not null
      else false
    end
  )
);

create table plm.item_price (
  item_id uuid not null references plm.item(id) on delete cascade,
  price_level text not null check (price_level in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')),
  amount numeric not null,
  primary key (item_id, price_level)
);

alter table plm.item_merch_group enable row level security;
alter table plm.item_custom_value enable row level security;
alter table plm.item_price enable row level security;

revoke all on plm.item_merch_group, plm.item_custom_value, plm.item_price
  from public, anon, authenticated;

comment on table plm.item_merch_group is
  'DesignFlow item slots with canonical taxonomy links or an explicit unresolved legacy reference.';
comment on table plm.item_custom_value is
  'DesignFlow numbered item attributes, preserving the original value kind and slot number.';
comment on table plm.item_price is
  'DesignFlow item-header price levels A through H. Zero and negative source values are preserved.';

commit;
