alter table public.ai_tag_bakeoff_runs
  add column if not exists model_d text,
  add column if not exists model_e text;

alter table public.ai_tag_bakeoff_results
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists cost_usd numeric(14, 8),
  add column if not exists pricing_snapshot jsonb;

alter table public.ai_tag_bakeoff_results
  drop constraint if exists ai_tag_bakeoff_results_model_slot_check;

alter table public.ai_tag_bakeoff_results
  add constraint ai_tag_bakeoff_results_model_slot_check
  check (model_slot = any (array['a'::text, 'b'::text, 'c'::text, 'd'::text, 'e'::text]));

alter table public.ai_tag_bakeoff_reviews
  drop constraint if exists ai_tag_bakeoff_reviews_winner_slot_check;

alter table public.ai_tag_bakeoff_reviews
  add constraint ai_tag_bakeoff_reviews_winner_slot_check
  check (winner_slot = any (array['a'::text, 'b'::text, 'c'::text, 'd'::text, 'e'::text]));
