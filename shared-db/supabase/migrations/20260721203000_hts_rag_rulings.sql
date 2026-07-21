-- Cache CBP customs rulings selected as useful precedent by DesignFlow's
-- backend HTS-classification service. Ruling text is public, but only the
-- backend service may read or write this table.

create table public.hts_rag_rulings (
  id                    uuid primary key default gen_random_uuid(),
  ruling_number         text not null,
  full_text             text not null,
  full_text_hash        text not null,
  subject               text,
  ruling_date           date,
  collection            text,
  tariffs               jsonb not null default '[]'::jsonb,
  operationally_revoked boolean not null default false,
  revoked_by            jsonb not null default '[]'::jsonb,
  modified_by           jsonb not null default '[]'::jsonb,
  source_url            text,
  fetched_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint hts_rag_rulings_ruling_number_key unique (ruling_number),
  constraint hts_rag_rulings_tariffs_array_check
    check (jsonb_typeof(tariffs) = 'array'),
  constraint hts_rag_rulings_revoked_by_array_check
    check (jsonb_typeof(revoked_by) = 'array'),
  constraint hts_rag_rulings_modified_by_array_check
    check (jsonb_typeof(modified_by) = 'array')
);

create index hts_rag_rulings_ruling_date_idx
  on public.hts_rag_rulings (ruling_date desc);
create index hts_rag_rulings_operationally_revoked_idx
  on public.hts_rag_rulings (operationally_revoked);

create trigger set_updated_at before update on public.hts_rag_rulings
  for each row execute function app.set_updated_at();

alter table public.hts_rag_rulings enable row level security;

revoke all on public.hts_rag_rulings from anon, authenticated;
grant all on public.hts_rag_rulings to service_role;

comment on table public.hts_rag_rulings is
  'Local cache of full-text CBP customs rulings selected as useful precedent for DesignFlow HTS classification. Service-role access only.';
comment on column public.hts_rag_rulings.full_text_hash is
  'Lowercase hexadecimal SHA-256 digest of full_text, supplied by the backend to detect source changes.';
