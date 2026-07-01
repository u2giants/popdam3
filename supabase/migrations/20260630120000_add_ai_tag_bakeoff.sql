-- Non-destructive A/B/C evaluation for vision tagging models.

create table if not exists public.ai_tag_bakeoff_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'queued', 'running', 'completed', 'failed', 'stopped')),
  model_a text not null,
  model_b text not null,
  model_c text not null,
  sample_size integer not null default 30 check (sample_size between 1 and 500),
  asset_ids uuid[] not null default '{}',
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.ai_tag_bakeoff_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_tag_bakeoff_runs(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  model_slot text not null check (model_slot in ('a', 'b', 'c')),
  model_id text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  tags text[] not null default '{}',
  ai_description text null,
  character_ids uuid[] not null default '{}',
  character_names text[] not null default '{}',
  property_id uuid null references public.properties(id) on delete set null,
  property_name text null,
  raw_output jsonb null,
  latency_ms integer null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, asset_id, model_slot)
);

create table if not exists public.ai_tag_bakeoff_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_tag_bakeoff_runs(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  field text not null check (field in ('tags', 'description', 'characters', 'property', 'overall')),
  winner_slot text null check (winner_slot in ('a', 'b', 'c')),
  scores jsonb not null default '{}',
  notes text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  unique (run_id, asset_id, field)
);

create index if not exists idx_ai_tag_bakeoff_results_run_asset on public.ai_tag_bakeoff_results(run_id, asset_id);
create index if not exists idx_ai_tag_bakeoff_results_status on public.ai_tag_bakeoff_results(status);
create index if not exists idx_ai_tag_bakeoff_reviews_run on public.ai_tag_bakeoff_reviews(run_id);

alter table public.ai_tag_bakeoff_runs enable row level security;
alter table public.ai_tag_bakeoff_results enable row level security;
alter table public.ai_tag_bakeoff_reviews enable row level security;

create policy "Admin read ai tag bakeoff runs"
  on public.ai_tag_bakeoff_runs for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admin manage ai tag bakeoff runs"
  on public.ai_tag_bakeoff_runs for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin read ai tag bakeoff results"
  on public.ai_tag_bakeoff_results for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admin manage ai tag bakeoff results"
  on public.ai_tag_bakeoff_results for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin read ai tag bakeoff reviews"
  on public.ai_tag_bakeoff_reviews for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admin manage ai tag bakeoff reviews"
  on public.ai_tag_bakeoff_reviews for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
