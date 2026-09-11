-- =====================================================================================
-- Issue #2173 - ColdLion landing unit 3: sales-history redesign and the stage/page
-- completion ledger. Tracker #2081; plan `plan_coldlion_landing_schema_completion.md`
-- §9 Step 4. Claim #2181 reserves version 20260905105038 and exactly these objects:
--
--   coldlion.window_ledger                 (repaired in place - stage/division/page scope)
--   coldlion.history_page_ledger           (new)
--   coldlion.order_history_line            (replaced by forward migration)
--   coldlion.order_history_component       (replaced by forward migration)
--   coldlion.order_history_invoice_ref     (new)
--   coldlion.order_history_pick_ticket_ref (new)
--
-- The three trigger functions created here exist only to enforce contracts of those two
-- ledger tables that no CHECK constraint can express, because they span two rows or two
-- tables. They are part of the declared tables, not separately claimed objects.
--
-- EVIDENCE THIS MIGRATION IS BUILT ON (live, 2026-09-02; #2081 comment 5519573718)
-- ---------------------------------------------------------------------------------
--  1. THE VENDOR SILENTLY CAPS PAGES. `GET /orderHistory?...&size=2000&page=0` returned
--     `size=200` in the envelope with no error at all. A loader that asks for one big
--     page and trusts its own request gets 200 rows and believes it has the window.
--     Both the requested and the returned page size are therefore recorded per page,
--     and a window can only be called loaded once its pages are proven contiguous.
--  2. BOTH HISTORY FEEDS RETURN A SPRING `Page` ENVELOPE - `content, first, last,
--     number, numberOfElements, size, sort, totalElements, totalPages` - even though
--     `/v2/api-docs` declares them as raw arrays. 14 of the 16 GET feeds type their 200
--     response as bare {"type":"object"}. THE SPEC IS STALE DOCUMENTATION, NOT A
--     CONTRACT: the loader's unknown-field refusal must key off a SAMPLED SHAPE and
--     never off `/api-docs`. Nothing here is built to the spec.
--  3. `coldlion.window_ledger` as applied had `endpoint, company_code, window_from,
--     window_to, state, attempt_count, last_run_id, row_count` and NO stage code, NO
--     division scope and NO page number. It could not express a stage-scoped or a
--     multi-page window, which is why repairing it belongs to this issue and is a hard
--     prerequisite for production history (#2174) rather than a sibling of it.
--  4. A `fromDate`/`toDate` span wider than seven days returns HTTP 400. The fixed
--     seven-day grid already enforced on this table is mandatory, not an optimisation.
--  5. `OrderHistory` carries `merchGroup01`-`merchGroup06` only. The 14-slot rule is
--     item-side and is deliberately NOT applied to sales history.
--
-- SOURCE RULES APPLIED (docs/business-rules-erp-data.md §10, verified 2026-09-01 on
-- 1,823 live rows across 409 orders)
-- ---------------------------------------------------------------------------------
--  * §10.5 The natural key is the four-part (salesOrderNo, salesOrderLineNo, itemNo,
--    subItemNo): zero duplicates across the corpus. The superseded
--    (salesOrderNo, itemNo, labelCode) design collided as soon as the vendor exposed
--    the real line number. `(salesOrderNo, salesOrderLineNo)` alone repeats on 179
--    groups and is a grouping candidate only - it is NOT business identity and is not
--    described as one anywhere here.
--  * §10.1/§10.2 The API never returns the parent line. It returns it EXPLODED, one row
--    per component SKU, with the parent's totals repeated on every row. A repeated
--    parent total is a header field, not a multiplication: it is stored once, on the
--    parent version, and never summed across components.
--  * §10.3 `orderQty`/`invoiceQty` are already per SKU; `lineQty`/`lineInvoiceQty` are
--    parent totals. Per-design quantities therefore live on the component.
--  * §10.4 `salesOrderLineNo` = 0 is the prepack-explosion marker, not missing data.
--    That is exactly why the line number is constrained >= 0 and not > 0.
--  * §10.7 `invoiceNoString`, `invoiceDateString` and `pickTicketNoString` are
--    COMMA-SEPARATED LISTS. Typing one as an integer truncates or fails. The original
--    string is preserved verbatim AND split into ordered child rows.
--  * §10.8 An invoice number does not prove the row was invoiced - 58 sampled rows have
--    a pick ticket and no invoice, 336 have neither. Fulfilment state is read from the
--    quantities. No document type is inferred and none is stored.
--
-- OWNER DECISIONS: `docs/coldlion-field-decisions-20260819.csv` holds the orderHistory
-- dispositions. D2 (line-level merch groups are item attributes) is narrowed by D14
-- (2026-09-01) to NON-PREPACK rows only: `merchGroup01`-`06` VARY per component on an
-- exploded prepack row, so they are kept at COMPONENT grain here and appear nowhere at
-- line grain. D5 (no per-row raw archive) is why an omitted field is unrecoverable
-- without re-pulling history, and it is why the document-list strings - marked `ignore`
-- on 2026-08-19 from a sample in which they were always empty, then shown by the
-- 1,823-row corpus to carry real comma-separated lists on 31 rows - are ingested.
--
-- NO foreign key from either sales-history table to coldlion.item_header: discontinued
-- historical items are legitimately absent from the current item master. No FK into
-- core.*. No application grants. No raw column (D5). No loader: its runtime is not this
-- issue's to decide.
-- =====================================================================================

do $$ begin
  if to_regclass('coldlion.sync_run') is null or to_regclass('coldlion.window_ledger') is null then
    raise exception 'ColdLion phase 1 spine is required before issue #2173';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 1. coldlion.window_ledger - stage, division and page-completion scope
-- -------------------------------------------------------------------------------------
--
-- A stage-less /prodHistory request returned ONLY `ISS` rows for a window that also held
-- `INTRAN` rows, with no error and a plausible-looking total. So a window is not an
-- (endpoint, company, dates) fact: it is an (endpoint, company, division scope, stage
-- scope, dates) fact, and an unscoped pull is a DIFFERENT window from a scoped one, not
-- a superset of it.
--
-- Both new scope columns are nullable because an unscoped pull is a real, legitimate
-- request shape. Postgres's default UNIQUE treats every NULL as distinct, so an
-- unscoped window could be recorded twice under the default rule. Every identity
-- constraint added here is therefore NULLS NOT DISTINCT: replaying an unscoped
-- stage/division cannot duplicate a window or a page.

alter table coldlion.window_ledger
  add column if not exists division_code text,
  add column if not exists stage_code text,
  add column if not exists reported_total_elements bigint,
  add column if not exists reported_total_pages integer,
  add column if not exists last_page_number integer;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.window_ledger'::regclass
      and conname = 'coldlion_window_ledger_identity_unique'
  ) then
    alter table coldlion.window_ledger
      drop constraint coldlion_window_ledger_identity_unique;
  end if;
end $$;

alter table coldlion.window_ledger
  add constraint coldlion_window_ledger_identity_unique
    unique nulls not distinct (endpoint, company_code, division_code, stage_code, window_from);

alter table coldlion.window_ledger
  add constraint coldlion_window_ledger_stage_allowed
    check (stage_code is null or stage_code in ('ISS','INTRAN','REC')),
  -- /orderHistory has no stage dimension at all; a stage recorded there is invented.
  add constraint coldlion_window_ledger_order_history_has_no_stage
    check (endpoint <> '/orderHistory' or stage_code is null),
  -- /prodHistory without a stage is the silent-omission shape confirmed live. Refused.
  add constraint coldlion_window_ledger_prod_history_requires_stage
    check (endpoint <> '/prodHistory' or stage_code is not null),
  add constraint coldlion_window_ledger_division_not_blank
    check (division_code is null or length(btrim(division_code)) > 0),
  add constraint coldlion_window_ledger_division_not_ep001
    check (division_code is null or division_code <> 'EP001'),
  add constraint coldlion_window_ledger_totals_non_negative
    check ((reported_total_elements is null or reported_total_elements >= 0)
       and (reported_total_pages is null or reported_total_pages >= 0)),
  add constraint coldlion_window_ledger_last_page_non_negative
    check (last_page_number is null or last_page_number >= 0),
  -- A loaded window must know which page the vendor itself flagged last. Without that
  -- number there is nothing for page contiguity to be contiguous UP TO.
  add constraint coldlion_window_ledger_loaded_witnessed_last_page
    check (state <> 'loaded' or last_page_number is not null);

create index if not exists coldlion_window_ledger_scope_idx
  on coldlion.window_ledger (endpoint, company_code, division_code, stage_code, window_from);

comment on table coldlion.window_ledger is
  'One row per 7-day window per capped history endpoint (/prodHistory, /orderHistory), scoped by company, optional division and - for production history - the required ISS/INTRAN/REC stage. States: pending, running, loaded, failed. Windows advance by exactly 7 days on the grid anchored at 2019-01-01; a wider fromDate/toDate span returns HTTP 400 from the vendor. CORRECTION (issue #2173, live evidence 2026-09-02): this table previously stated that both history endpoints are unpaged. That is WRONG. They return a Spring Page envelope and silently cap the page size at 200 - a requested size=2000 came back as size=200 with no error. Completion is therefore proven by coldlion.history_page_ledger and never by one sync_run row; see the window_ledger_completion_guard trigger. A stage-less /prodHistory request returns only ISS rows while INTRAN rows exist, so an unscoped pull is a DIFFERENT window from a scoped one. Issue #1184 phase 1; fixed grid #1195; stage/page scope #2173.';

comment on column coldlion.window_ledger.stage_code is
  'ISS, INTRAN or REC for /prodHistory, where an unscoped request silently omits whole stages. NULL for /orderHistory, which has no stage dimension. Part of the NULLS NOT DISTINCT window identity.';
comment on column coldlion.window_ledger.division_code is
  'Division scope of the request, or NULL for a deliberately unscoped pull. Part of the NULLS NOT DISTINCT window identity, so an unscoped replay cannot duplicate the window.';
comment on column coldlion.window_ledger.last_page_number is
  'The page number the vendor envelope flagged `last`. A window cannot be loaded without it: it is the upper bound page contiguity is measured against.';
comment on column coldlion.window_ledger.reported_total_elements is
  'totalElements from the envelope, compared against the summed page row counts before a window may be called loaded. It is the vendor''s claim, not our count.';

-- -------------------------------------------------------------------------------------
-- 2. coldlion.history_page_ledger - one row per page of one window
-- -------------------------------------------------------------------------------------
--
-- This table is the structural answer to objection U6. Because the vendor silently
-- replaces the requested page size, the only honest evidence that a window is complete
-- is a page-by-page record: every page from 0 through the page the vendor itself
-- flagged `last`, each one succeeded, and the row counts adding up to the totals the
-- vendor reported. `requested_page_size` and `returned_page_size` are stored separately
-- precisely so the silent substitution is visible in the data rather than inferred.

create table coldlion.history_page_ledger (
  id uuid primary key default gen_random_uuid(),

  -- Both the parent key and the scope columns are kept. The FK makes the parent
  -- unambiguous and cascades; the scope columns are the identity the plan and the issue
  -- specify, and the scope guard below proves the two always agree.
  window_id uuid not null references coldlion.window_ledger(id) on delete cascade,

  endpoint text not null,
  company_code text not null,
  division_code text,
  stage_code text,
  window_from date not null,
  page_number integer not null,

  requested_page_size integer,
  returned_page_size integer,
  page_row_count integer,
  reported_total_elements bigint,
  reported_total_pages integer,
  is_last_page boolean,

  state text not null default 'pending',
  attempt_count integer not null default 0,

  run_id uuid references coldlion.sync_run(id) on delete set null,
  first_attempted_at timestamptz,
  loaded_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coldlion_history_page_ledger_endpoint_allowed
    check (endpoint in ('/prodHistory', '/orderHistory')),
  constraint coldlion_history_page_ledger_company_not_blank
    check (length(btrim(company_code)) > 0),
  constraint coldlion_history_page_ledger_division_not_blank
    check (division_code is null or length(btrim(division_code)) > 0),
  constraint coldlion_history_page_ledger_division_not_ep001
    check (division_code is null or division_code <> 'EP001'),
  constraint coldlion_history_page_ledger_stage_allowed
    check (stage_code is null or stage_code in ('ISS','INTRAN','REC')),
  constraint coldlion_history_page_ledger_order_history_has_no_stage
    check (endpoint <> '/orderHistory' or stage_code is null),
  constraint coldlion_history_page_ledger_prod_history_requires_stage
    check (endpoint <> '/prodHistory' or stage_code is not null),
  constraint coldlion_history_page_ledger_window_not_empty_date_marker
    check (window_from > date '1900-01-01'),
  constraint coldlion_history_page_ledger_fixed_grid
    check ((window_from - date '2019-01-01') % 7 = 0),

  -- Spring pages are zero-based. Page 1 existing while page 0 does not is a gap, and
  -- the completion guard is what refuses it; a negative page is simply impossible.
  constraint coldlion_history_page_ledger_page_non_negative
    check (page_number >= 0),
  constraint coldlion_history_page_ledger_sizes_positive
    check ((requested_page_size is null or requested_page_size > 0)
       and (returned_page_size is null or returned_page_size >= 0)),
  constraint coldlion_history_page_ledger_counts_non_negative
    check ((page_row_count is null or page_row_count >= 0)
       and (reported_total_elements is null or reported_total_elements >= 0)
       and (reported_total_pages is null or reported_total_pages >= 0)),
  -- The vendor's OWN returned size bounds its page. This is not the number 200 written
  -- into the schema: the cap is a vendor behaviour we record, never a rule we assume.
  constraint coldlion_history_page_ledger_rows_within_returned_size
    check (page_row_count is null or returned_page_size is null
           or page_row_count <= returned_page_size),
  constraint coldlion_history_page_ledger_attempts_non_negative
    check (attempt_count >= 0),
  constraint coldlion_history_page_ledger_state_allowed
    check (state in ('pending', 'running', 'loaded', 'failed')),
  constraint coldlion_history_page_ledger_failed_has_error
    check (state <> 'failed' or last_error is not null),
  constraint coldlion_history_page_ledger_loaded_is_evidenced
    check (state <> 'loaded'
           or (page_row_count is not null and is_last_page is not null
               and loaded_at is not null and run_id is not null)),

  constraint coldlion_history_page_ledger_identity_unique
    unique nulls not distinct
      (endpoint, company_code, division_code, stage_code, window_from, page_number)
);

create index if not exists coldlion_history_page_ledger_window_idx
  on coldlion.history_page_ledger (window_id, page_number);
create index if not exists coldlion_history_page_ledger_state_idx
  on coldlion.history_page_ledger (endpoint, state, window_from);
create index if not exists coldlion_history_page_ledger_run_idx
  on coldlion.history_page_ledger (run_id);

comment on table coldlion.history_page_ledger is
  'One row per PAGE of one history window, keyed by endpoint, company, division scope, stage scope, window start and page number under NULLS NOT DISTINCT. It exists because the vendor silently caps pages: a requested size=2000 came back as size=200 in the envelope with no error (live, 2026-09-02), so a single sync_run row can never prove a multi-page window complete. requested_page_size and returned_page_size are stored separately so that substitution is visible evidence rather than an inference. Issue #2173, objection U6.';
comment on column coldlion.history_page_ledger.requested_page_size is
  'The `size` we asked for. Kept alongside returned_page_size because the vendor silently replaces it - the pair is the evidence of the cap.';
comment on column coldlion.history_page_ledger.returned_page_size is
  'The `size` the Spring Page envelope actually reported, which is the vendor''s real page size for this call.';
comment on column coldlion.history_page_ledger.is_last_page is
  'The envelope''s `last` flag. Walking until this is true - rather than trusting a requested page size - is what completes a window.';
comment on column coldlion.history_page_ledger.page_row_count is
  'Rows actually delivered in this page (`numberOfElements` / length of `content`). Summed across pages and compared with the reported totals before a window may be loaded.';

drop trigger if exists set_updated_at on coldlion.history_page_ledger;
create trigger set_updated_at
  before update on coldlion.history_page_ledger
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------------------------------
-- 3. The three things no CHECK constraint can say
-- -------------------------------------------------------------------------------------

-- (a) A page row must describe the same window its window_id points at. Without this
--     the scope columns and the FK could disagree, and the completion proof would be
--     counting the pages of some other window.
create or replace function coldlion.history_page_ledger_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
declare
  w coldlion.window_ledger%rowtype;
begin
  select * into w from coldlion.window_ledger where id = new.window_id;
  if not found then
    raise exception 'history page references a window that does not exist';
  end if;

  if new.endpoint is distinct from w.endpoint
     or new.company_code is distinct from w.company_code
     or new.division_code is distinct from w.division_code
     or new.stage_code is distinct from w.stage_code
     or new.window_from is distinct from w.window_from then
    raise exception
      'history page scope does not match its window (page %/%/%/%/%, window %/%/%/%/%)',
      new.endpoint, new.company_code, coalesce(new.division_code, '<null>'),
      coalesce(new.stage_code, '<null>'), new.window_from,
      w.endpoint, w.company_code, coalesce(w.division_code, '<null>'),
      coalesce(w.stage_code, '<null>'), w.window_from;
  end if;

  return new;
end;
$fn$;

comment on function coldlion.history_page_ledger_scope_guard() is
  'Keeps coldlion.history_page_ledger''s scope columns and its window_id describing the same window. Part of the history_page_ledger table contract (issue #2173).';

drop trigger if exists history_page_ledger_scope_guard on coldlion.history_page_ledger;
create trigger history_page_ledger_scope_guard
  before insert or update on coldlion.history_page_ledger
  for each row execute function coldlion.history_page_ledger_scope_guard();

-- A parent scope is the identity copied onto every page. Once pages exist, changing
-- that identity would make the parent and its evidence disagree. Loaded scope is
-- immutable even if its pages are later found missing through outside corruption.
create or replace function coldlion.window_ledger_scope_immutable_with_pages()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
begin
  if new.endpoint is not distinct from old.endpoint
     and new.company_code is not distinct from old.company_code
     and new.division_code is not distinct from old.division_code
     and new.stage_code is not distinct from old.stage_code
     and new.window_from is not distinct from old.window_from
     and new.window_to is not distinct from old.window_to then
    return new;
  end if;

  if old.state = 'loaded' or exists (
    select 1 from coldlion.history_page_ledger where window_id = old.id
  ) then
    raise exception
      'window % scope cannot change after page evidence exists or the window is loaded',
      old.id;
  end if;

  return new;
end;
$fn$;

comment on function coldlion.window_ledger_scope_immutable_with_pages() is
  'Prevents a ColdLion history window scope from diverging from existing page evidence and seals the scope of loaded windows (issue #2173).';

drop trigger if exists window_ledger_scope_immutable_with_pages on coldlion.window_ledger;
create trigger window_ledger_scope_immutable_with_pages
  before update on coldlion.window_ledger
  for each row execute function coldlion.window_ledger_scope_immutable_with_pages();

-- (b) A window becomes `loaded` ONLY on page evidence. This is the whole point of the
--     unit: one sync_run row never proves a multi-page window complete. It is a
--     CONSTRAINT trigger so the check can be deferred when needed, but pages must be
--     recorded before the parent becomes loaded because loaded evidence is immutable.
create or replace function coldlion.window_ledger_completion_guard()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
declare
  v_pages integer;
  v_min integer;
  v_max integer;
  v_unloaded integer;
  v_rows bigint;
  v_flagged_last integer;
begin
  if new.state <> 'loaded' then
    return null;
  end if;

  select count(*), min(page_number), max(page_number),
         count(*) filter (where state <> 'loaded'),
         sum(page_row_count),
         count(*) filter (where is_last_page)
    into v_pages, v_min, v_max, v_unloaded, v_rows, v_flagged_last
  from coldlion.history_page_ledger
  where window_id = new.id;

  if v_pages = 0 then
    raise exception
      'window % cannot be loaded: no page evidence exists. One sync_run row does not prove a multi-page window complete.',
      new.id;
  end if;

  if v_unloaded > 0 then
    raise exception 'window % cannot be loaded: % page(s) are not loaded', new.id, v_unloaded;
  end if;

  if v_min <> 0 then
    raise exception 'window % cannot be loaded: recorded pages start at %, not 0', new.id, v_min;
  end if;

  if v_max is distinct from new.last_page_number then
    raise exception
      'window % cannot be loaded: highest recorded page is %, but the vendor flagged page % as last',
      new.id, v_max, new.last_page_number;
  end if;

  -- Contiguity. A window holding pages 0 and 2 has a hole that a count alone misses.
  if v_pages <> v_max + 1 then
    raise exception
      'window % cannot be loaded: pages 0..% are not contiguous (% recorded)',
      new.id, v_max, v_pages;
  end if;

  if v_flagged_last <> 1 or not exists (
    select 1 from coldlion.history_page_ledger
    where window_id = new.id and page_number = v_max and is_last_page
  ) then
    raise exception
      'window % cannot be loaded: exactly one page must carry the envelope''s last flag and it must be page %',
      new.id, v_max;
  end if;

  if new.row_count is distinct from v_rows then
    raise exception
      'window % cannot be loaded: window row_count % does not equal the summed page rows %',
      new.id, new.row_count, v_rows;
  end if;

  if new.reported_total_elements is null then
    raise exception
      'window % cannot be loaded: vendor totalElements was not recorded',
      new.id;
  end if;

  if new.reported_total_elements is distinct from v_rows then
    raise exception
      'window % cannot be loaded: vendor totalElements % does not equal the summed page rows %',
      new.id, new.reported_total_elements, v_rows;
  end if;

  return null;
end;
$fn$;

comment on function coldlion.window_ledger_completion_guard() is
  'Refuses to let a coldlion.window_ledger row reach state=loaded unless coldlion.history_page_ledger holds contiguous pages 0..last, all loaded, exactly one flagged last, summing to the window row count and to the vendor''s reported total. Part of the window_ledger table contract (issue #2173, objection U6).';

drop trigger if exists window_ledger_completion_guard on coldlion.window_ledger;
create constraint trigger window_ledger_completion_guard
  after insert or update on coldlion.window_ledger
  deferrable initially immediate
  for each row execute function coldlion.window_ledger_completion_guard();

-- (c) The pages of a loaded window ARE the proof of that window. They may not be
--     deleted or rewritten while it still claims to be loaded.
create or replace function coldlion.history_page_ledger_immutable_when_loaded()
returns trigger
language plpgsql
security definer
set search_path = coldlion, pg_temp
as $fn$
declare
  v_parent record;
  v_window_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_window_ids := array[new.window_id];
  elsif tg_op = 'DELETE' then
    v_window_ids := array[old.window_id];
  else
    v_window_ids := array[old.window_id, new.window_id];
  end if;

  -- Lock both parents in deterministic order. An UPDATE that re-parents a page
  -- must protect its loaded destination as well as its source, and deterministic
  -- ordering avoids deadlocks when two transactions move pages in opposite ways.
  for v_parent in
    select id, state
      from coldlion.window_ledger
     where id = any(v_window_ids)
     order by id
     for update
  loop
    if v_parent.state = 'loaded' then
      raise exception
        'page evidence for window % cannot be added, changed or removed while that window is loaded',
        v_parent.id;
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

comment on function coldlion.history_page_ledger_immutable_when_loaded() is
  'Protects the page evidence behind a loaded window from being added, rewritten or deleted. Part of the history_page_ledger table contract (issue #2173).';

drop trigger if exists history_page_ledger_immutable_when_loaded on coldlion.history_page_ledger;
create trigger history_page_ledger_immutable_when_loaded
  before insert or update or delete on coldlion.history_page_ledger
  for each row execute function coldlion.history_page_ledger_immutable_when_loaded();

-- -------------------------------------------------------------------------------------
-- 4. Sales history, replaced by forward migration
-- -------------------------------------------------------------------------------------
--
-- Migration-ledger identity is immutable, so the applied 20260825023430 tables are not
-- edited: they are dropped and rebuilt here. Both are empty in production (17 coldlion
-- tables, 0 rows in all 17, re-verified read-only 2026-09-02), so no evidence is lost.
-- Their key - (salesOrderNo, itemNo, labelCode) - was superseded the moment the vendor
-- exposed `salesOrderLineNo` on 2026-09-01, and neither table had a parent FK.

-- The 2026-09-02 census found both obsolete tables empty, but application time is
-- not frozen at census time. Refuse rather than destroy evidence if any writer has
-- populated either table before this migration is applied.
do $fn$
declare
  v_table regclass;
  v_has_rows boolean;
begin
  foreach v_table in array array[
    to_regclass('coldlion.order_history_component'),
    to_regclass('coldlion.order_history_line')
  ] loop
    if v_table is not null then
      execute format('select exists (select 1 from %s limit 1)', v_table)
        into v_has_rows;
      if v_has_rows then
        raise exception
          'refusing to replace non-empty obsolete ColdLion history table %', v_table;
      end if;
    end if;
  end loop;
end;
$fn$;

drop table if exists coldlion.order_history_component;
drop table if exists coldlion.order_history_line;

create table coldlion.order_history_line (
  -- The surrogate parent-version id. It exists because the child grains need one stable
  -- thing to point at, and because a line's identity includes its own content hash: two
  -- differing projections of the same order line are two VERSIONS, never one merged row.
  id uuid primary key default gen_random_uuid(),

  company_code text,
  sales_order_no bigint not null,
  -- 0 is the prepack-explosion marker (§10.4): the row has no line of its own because
  -- it is a piece of its parent's line. It is data, not missing data.
  sales_order_line_no integer not null,
  -- itemNo. On an exploded prepack row this is the PARENT assortment's item number and
  -- is identical on every component row; the SKU actually shipped is on the component.
  master_item_no text not null,

  label_code text,
  pre_pack_code text,
  division_code text,
  customer_code text,
  customer_desc text,
  po_number text,
  sales_person_code1 text,
  start_date date,
  cancel_date date,

  -- PARENT TOTALS. Repeated verbatim on every exploded row by the vendor; stored once,
  -- here, and never summed across components (§10.1, §10.3).
  line_qty numeric,
  line_cancelled_qty numeric,
  prepack_qty numeric,

  item_desc text,
  short_item_no text,
  brand_assurance_no text,
  warehouse_code text,
  prod_cost numeric,
  prod_reference_no text,

  line_source_hash text not null check (line_source_hash ~ '^[0-9a-f]{64}$'),

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_order_history_line_no_non_negative
    check (sales_order_line_no >= 0),
  constraint coldlion_order_history_line_division_not_ep001
    check (division_code is null or division_code <> 'EP001'),
  constraint coldlion_order_history_line_identity_unique
    unique nulls not distinct
      (sales_order_no, sales_order_line_no, master_item_no, line_source_hash)
);

comment on table coldlion.order_history_line is
  'One version of one ColdLion sales-order line. Append-only. The vendor never returns this row: it returns the line exploded into component SKUs with the parent totals repeated on each, so the loader synthesises one parent per distinct (salesOrderNo, salesOrderLineNo, itemNo, line_source_hash) and asserts field constancy only WITHIN that full group. ORDER + LINE ALONE IS NOT BUSINESS IDENTITY - it repeats on 179 groups of the 1,823-row corpus because ColdLion reassigns line numbers across documents (docs/business-rules-erp-data.md §10.5). line_source_hash covers only the line-grain projection: every approved field proven constant across components, excluding sub*, the component item, per-design quantities and prices, component taxonomy and the document-list tokens. Differing projections remain separate versions and are never merged. NO FK to coldlion.item_header: discontinued historical items are legitimately absent from the current item master. Merch-group columns appear only at component grain (D2 as narrowed by D14). Retention follows the deterministic newest-three contract; the initial backfill retains its single baseline version. Issue #2173.';
comment on column coldlion.order_history_line.sales_order_line_no is
  'salesOrderLineNo, exposed by the vendor on 2026-09-01. 0 means this row is a prepack component of its parent line (§10.4); the earlier instruction to quarantine line-0 rows is withdrawn.';
comment on column coldlion.order_history_line.line_qty is
  'lineQty - a PARENT LINE TOTAL, repeated by the vendor on every exploded component row. Never read it as a SKU quantity and never sum it across components; use the component''s order_qty (§10.3).';
comment on column coldlion.order_history_line.brand_assurance_no is
  'Write-back wanted by the owner but currently impossible: ColdLion exposes no write endpoint for orderHistory. Flag only; no invented write path.';

create table coldlion.order_history_component (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null
    references coldlion.order_history_line(id) on delete cascade,

  -- The real SKU (§10.2) is COALESCE(NULLIF(subItemNo,''), itemNo) at read time. NULL
  -- here means a non-prepack row whose SKU is the parent's master_item_no. Empty
  -- strings normalise to NULL, and the identity is NULLS NOT DISTINCT, so replaying a
  -- non-prepack line cannot duplicate its single component.
  sub_item_no text,
  sub_label_code text,
  sub_upc text,

  -- PER-DESIGN facts. linePrice is per component, not per line.
  line_price numeric,
  quantity numeric,
  order_qty numeric,
  invoice_qty numeric,
  ship_qty numeric,
  order_amount numeric,
  ship_amount numeric,

  -- Component taxonomy. `sub_merch_group*` is component-native. `merch_group01`-`06`
  -- live here and NOT on the line because D14 (2026-09-01) narrowed D2 to non-prepack
  -- rows: on an exploded prepack row they VARY per component.
  sub_merch_group01 text, sub_merch_group02 text, sub_merch_group03 text,
  sub_merch_group04 text, sub_merch_group05 text, sub_merch_group06 text,
  merch_group01 text, merch_group02 text, merch_group03 text,
  merch_group04 text, merch_group05 text, merch_group06 text,

  -- The list fields verbatim, before splitting. Preserving the original string is what
  -- makes the split reversible and a cardinality mismatch provable rather than guessed.
  invoice_no_string text,
  invoice_date_string text,
  pick_ticket_no_string text,
  -- Set by the loader when the invoice-number and invoice-date lists have different
  -- lengths. Both ordered lists are still kept, no pairing is invented, and the
  -- mismatch is recorded instead of being resolved.
  document_list_cardinality_mismatch boolean not null default false,

  component_source_hash text not null check (component_source_hash ~ '^[0-9a-f]{64}$'),

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint coldlion_order_history_component_identity_unique
    unique nulls not distinct
      (line_id, sub_item_no, sub_label_code, component_source_hash),
  -- Referenced by the two document tables so a token can never name a component that
  -- belongs to a different line than the one it claims.
  constraint coldlion_order_history_component_line_pair_unique
    unique (id, line_id)
);

create index if not exists coldlion_order_history_component_line_idx
  on coldlion.order_history_component (line_id);
create index if not exists coldlion_order_history_line_run_idx
  on coldlion.order_history_line (run_id);
create index if not exists coldlion_order_history_component_run_idx
  on coldlion.order_history_component (run_id);

comment on table coldlion.order_history_component is
  'One component design of one sales-order line version, with a mandatory FK to that version - every component has exactly one parent. On a non-prepack row there is exactly one component and sub_item_no is NULL. order_qty and invoice_qty are ColdLion''s own per-SKU numbers and are the ones to read; a prepack row with order_qty = 0 against a non-zero parent line_qty is the rounding artefact of a partial prepack (§10.6), not an empty line. An invoice number never proves the row was invoiced - fulfilment state comes from the quantities (§10.8) - and no document type is inferred or stored. Issue #2173.';
comment on column coldlion.order_history_component.order_qty is
  'orderQty - already per SKU, computed by ColdLion as (lineQty / prepackQty) * quantity and reproduced exactly on 734 of 751 sampled prepack rows and on 100% of non-prepack rows. This, not lineQty, is the quantity of this row''s product.';
comment on column coldlion.order_history_component.invoice_no_string is
  'invoiceNoString verbatim, which can be a COMMA-SEPARATED LIST (31 rows of the 1,823-row corpus carried one). Kept whole so the split into coldlion.order_history_invoice_ref round-trips.';
comment on column coldlion.order_history_component.document_list_cardinality_mismatch is
  'True when the invoice-number and invoice-date lists have different lengths. Both ordered lists are still stored; the loader refuses to invent a pairing and records the mismatch here.';

-- -------------------------------------------------------------------------------------
-- 5. Ordered document tokens
-- -------------------------------------------------------------------------------------
--
-- Ownership is recorded AS THE PAYLOAD PROVES IT. Every token arrives on a row that
-- belongs to a line version, so line_id is mandatory. component_id is set only where
-- that row also carries a distinct component identity; where the payload does not prove
-- the token belongs to one component, it stays NULL rather than being attributed to one.
-- Tokens are TEXT: a comma-separated list typed as an integer truncates or fails, and an
-- invoice "number" is a vendor token, not arithmetic.

create table coldlion.order_history_invoice_ref (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null
    references coldlion.order_history_line(id) on delete cascade,
  component_id uuid,

  ordinal integer not null,
  invoice_no text not null,
  -- The date token from the parallel list, aligned by ordinal ONLY where the two lists
  -- have equal cardinality. Where they do not, this stays NULL and the mismatch is
  -- flagged on the component: an invented pairing would be a fabricated invoice date.
  invoice_date_token text,
  invoice_date date,
  date_alignment_proven boolean not null default false,

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  foreign key (component_id, line_id)
    references coldlion.order_history_component(id, line_id) on delete cascade,

  constraint coldlion_order_history_invoice_ref_ordinal_positive
    check (ordinal >= 1),
  constraint coldlion_order_history_invoice_ref_token_not_blank
    check (length(btrim(invoice_no)) > 0),
  constraint coldlion_order_history_invoice_ref_date_needs_alignment
    check (date_alignment_proven or (invoice_date_token is null and invoice_date is null)),
  constraint coldlion_order_history_invoice_ref_identity_unique
    unique nulls not distinct (line_id, component_id, ordinal)
);

create index if not exists coldlion_order_history_invoice_ref_line_idx
  on coldlion.order_history_invoice_ref (line_id);
create index if not exists coldlion_order_history_invoice_ref_component_idx
  on coldlion.order_history_invoice_ref (component_id);
create index if not exists coldlion_order_history_invoice_ref_run_idx
  on coldlion.order_history_invoice_ref (run_id);

comment on table coldlion.order_history_invoice_ref is
  'One invoice-number token from a comma-separated invoiceNoString, in payload order. Ownership is as the payload proves it: line_id always, component_id only where the token demonstrably belongs to one component. The date token is aligned by ordinal ONLY when the number and date lists have equal cardinality; otherwise date_alignment_proven stays false, both lists are still preserved, and no pairing is invented. The presence of an invoice number does not mean the row was invoiced (§10.8). Issue #2173.';

create table coldlion.order_history_pick_ticket_ref (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null
    references coldlion.order_history_line(id) on delete cascade,
  component_id uuid,

  ordinal integer not null,
  pick_ticket_no text not null,

  run_id uuid not null references coldlion.sync_run(id),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),

  foreign key (component_id, line_id)
    references coldlion.order_history_component(id, line_id) on delete cascade,

  constraint coldlion_order_history_pick_ticket_ref_ordinal_positive
    check (ordinal >= 1),
  constraint coldlion_order_history_pick_ticket_ref_token_not_blank
    check (length(btrim(pick_ticket_no)) > 0),
  constraint coldlion_order_history_pick_ticket_ref_identity_unique
    unique nulls not distinct (line_id, component_id, ordinal)
);

create index if not exists coldlion_order_history_pick_ticket_ref_line_idx
  on coldlion.order_history_pick_ticket_ref (line_id);
create index if not exists coldlion_order_history_pick_ticket_ref_component_idx
  on coldlion.order_history_pick_ticket_ref (component_id);
create index if not exists coldlion_order_history_pick_ticket_ref_run_idx
  on coldlion.order_history_pick_ticket_ref (run_id);

comment on table coldlion.order_history_pick_ticket_ref is
  'One pick-ticket token from a comma-separated pickTicketNoString, in payload order, stored as text. Ownership is as the payload proves it. 58 rows of the 1,823-row corpus carry a pick ticket and no invoice, so a pick ticket proves nothing about invoicing and no document type is inferred. Issue #2173.';

-- -------------------------------------------------------------------------------------
-- 6. Closed landing posture - no application role reads this schema
-- -------------------------------------------------------------------------------------

do $access$
declare r record;
begin
  for r in
    select c.oid::regclass as relation_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'coldlion' and c.relkind = 'r'
      and c.relname not in ('sync_run','window_ledger','change_log')
  loop
    execute format('alter table %s enable row level security', r.relation_name);
    execute format('revoke all on table %s from public, anon, authenticated', r.relation_name);
    execute format('grant all on table %s to service_role', r.relation_name);
  end loop;
end
$access$;

revoke all on function coldlion.history_page_ledger_scope_guard() from public, anon, authenticated;
revoke all on function coldlion.window_ledger_completion_guard() from public, anon, authenticated;
revoke all on function coldlion.history_page_ledger_immutable_when_loaded() from public, anon, authenticated;
