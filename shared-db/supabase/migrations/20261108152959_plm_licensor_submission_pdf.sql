-- Issue popcre/shared-db#5952: readings taken from licensor submission confirmation PDFs.
--
-- Owner request, Albert Hazan, 2026-11-08 ("Yes, save it"): keep what was read from the
-- licensor confirmation PDFs (edgesynology1 SharedLic, licensor folders, 2022-2026) in the
-- database. Each PDF is the licensor portal's own page for one of our styles, so it records
-- the licensor-side property, sub-property, characters and style guides for that style.
--
-- NO LICENSED VALUES ARE IN THIS FILE. Rows are loaded afterwards by the application session
-- (AGENTS.md section 0.0-B: data, not structure). The private extraction code and capture
-- receipt live in u2giants/licensor-source-data.
--
-- Read-only evidence: these tables never change MG05/MG06. ColdLion is authoritative for MG
-- codes; disagreements are reviewed by people and sent to ColdLion.

create table plm.licensor_submission_pdf_capture (
  id uuid primary key default gen_random_uuid(),
  capture_key text not null unique,
  source_root text not null,
  year_from integer not null,
  year_to integer not null,
  reader text not null,
  extractor_commit text,
  expected_file_count integer not null check (expected_file_count >= 0),
  loaded_file_count integer not null default 0 check (loaded_file_count >= 0),
  status text not null default 'loading' check (status in ('loading','complete','rejected')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  check (year_from <= year_to),
  check ((status = 'complete') = (completed_at is not null))
);

comment on table plm.licensor_submission_pdf_capture is
'One run of reading licensor submission confirmation PDFs from the NAS (popcre/shared-db#5952). A capture is usable only when status is complete; its rows in plm.licensor_submission_pdf are never edited, a new run is a new capture.';

create table plm.licensor_submission_pdf (
  id bigint generated always as identity primary key,
  capture_id uuid not null references plm.licensor_submission_pdf_capture(id) on delete restrict,
  nas_path text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  licensor_folder text not null,
  submission_year integer,
  style_code text,
  portal_system text not null,
  properties text[] not null default '{}',
  sub_properties text[] not null default '{}',
  characters text[] not null default '{}',
  style_guides text[] not null default '{}',
  text_length integer not null check (text_length >= 0),
  created_at timestamptz not null default now(),
  unique (capture_id, nas_path)
);

comment on table plm.licensor_submission_pdf is
'Per-PDF readings from licensor submission confirmation pages: the licensor-side properties, sub-properties, characters and style guides printed on the page, keyed to our style number taken from the file name. Evidence only; ColdLion stays authoritative for MG05/MG06 (popcre/shared-db#5952).';
comment on column plm.licensor_submission_pdf.nas_path is
'Path below the SharedLic share on edgesynology1, exactly as stored on the NAS.';
comment on column plm.licensor_submission_pdf.style_code is
'Our style (item) number read from the file name; null when the file name carries none.';
comment on column plm.licensor_submission_pdf.portal_system is
'Which licensor portal layout the page was recognised as (for example OPA, MediaBox, TrackerPlus, STARLabs, Source); unknown when not recognised.';

create index licensor_submission_pdf_style_idx
  on plm.licensor_submission_pdf (style_code, capture_id);

alter table plm.licensor_submission_pdf_capture enable row level security;
alter table plm.licensor_submission_pdf enable row level security;

create policy licensor_submission_pdf_capture_staff_read
  on plm.licensor_submission_pdf_capture for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer']::app.app_role[]));
create policy licensor_submission_pdf_staff_read
  on plm.licensor_submission_pdf for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer']::app.app_role[]));

revoke all on plm.licensor_submission_pdf_capture, plm.licensor_submission_pdf from public, anon;
grant select on plm.licensor_submission_pdf_capture, plm.licensor_submission_pdf to authenticated;
grant select, insert on plm.licensor_submission_pdf_capture, plm.licensor_submission_pdf to service_role;
grant update (loaded_file_count, status, completed_at, notes) on plm.licensor_submission_pdf_capture to service_role;
revoke insert, update, delete, truncate on plm.licensor_submission_pdf_capture, plm.licensor_submission_pdf from authenticated;
