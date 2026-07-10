-- Generated from a read-only production pg_dump schema snapshot.
-- Additive reconciliation: skip the complete baseline when the schema exists.
create or replace procedure public.reconcile_ai_tag_bakeoff()
language plpgsql
as $guard$
begin
  if to_regclass('public.ai_tag_bakeoff_runs') is not null then
    raise notice 'reconciliation target already exists; baseline skipped';
    return;
  end if;
  execute $ddl_0$
CREATE TABLE public.ai_tag_bakeoff_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    model_slot text NOT NULL,
    model_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    ai_description text,
    character_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    character_names text[] DEFAULT '{}'::text[] NOT NULL,
    property_id uuid,
    property_name text,
    raw_output jsonb,
    latency_ms integer,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_tag_bakeoff_results_model_slot_check CHECK ((model_slot = ANY (ARRAY['a'::text, 'b'::text, 'c'::text]))),
    CONSTRAINT ai_tag_bakeoff_results_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))
);
$ddl_0$;
  execute $ddl_1$
CREATE TABLE public.ai_tag_bakeoff_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    field text NOT NULL,
    winner_slot text,
    scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_tag_bakeoff_reviews_field_check CHECK ((field = ANY (ARRAY['tags'::text, 'description'::text, 'characters'::text, 'property'::text, 'overall'::text]))),
    CONSTRAINT ai_tag_bakeoff_reviews_winner_slot_check CHECK ((winner_slot = ANY (ARRAY['a'::text, 'b'::text, 'c'::text])))
);
$ddl_1$;
  execute $ddl_2$
CREATE TABLE public.ai_tag_bakeoff_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    model_a text NOT NULL,
    model_b text NOT NULL,
    model_c text NOT NULL,
    sample_size integer DEFAULT 30 NOT NULL,
    asset_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT ai_tag_bakeoff_runs_sample_size_check CHECK (((sample_size >= 1) AND (sample_size <= 500))),
    CONSTRAINT ai_tag_bakeoff_runs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'stopped'::text])))
);
$ddl_2$;
  execute $ddl_3$
ALTER TABLE ONLY public.ai_tag_bakeoff_results
    ADD CONSTRAINT ai_tag_bakeoff_results_pkey PRIMARY KEY (id);
$ddl_3$;
  execute $ddl_4$
ALTER TABLE ONLY public.ai_tag_bakeoff_results
    ADD CONSTRAINT ai_tag_bakeoff_results_run_id_asset_id_model_slot_key UNIQUE (run_id, asset_id, model_slot);
$ddl_4$;
  execute $ddl_5$
ALTER TABLE ONLY public.ai_tag_bakeoff_reviews
    ADD CONSTRAINT ai_tag_bakeoff_reviews_pkey PRIMARY KEY (id);
$ddl_5$;
  execute $ddl_6$
ALTER TABLE ONLY public.ai_tag_bakeoff_reviews
    ADD CONSTRAINT ai_tag_bakeoff_reviews_run_id_asset_id_field_key UNIQUE (run_id, asset_id, field);
$ddl_6$;
  execute $ddl_7$
ALTER TABLE ONLY public.ai_tag_bakeoff_runs
    ADD CONSTRAINT ai_tag_bakeoff_runs_pkey PRIMARY KEY (id);
$ddl_7$;
  execute $ddl_8$
CREATE INDEX idx_ai_tag_bakeoff_results_run_asset ON public.ai_tag_bakeoff_results USING btree (run_id, asset_id);
$ddl_8$;
  execute $ddl_9$
CREATE INDEX idx_ai_tag_bakeoff_results_status ON public.ai_tag_bakeoff_results USING btree (status);
$ddl_9$;
  execute $ddl_10$
CREATE INDEX idx_ai_tag_bakeoff_reviews_run ON public.ai_tag_bakeoff_reviews USING btree (run_id);
$ddl_10$;
  execute $ddl_11$
ALTER TABLE ONLY public.ai_tag_bakeoff_results
    ADD CONSTRAINT ai_tag_bakeoff_results_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;
$ddl_11$;
  execute $ddl_12$
ALTER TABLE ONLY public.ai_tag_bakeoff_results
    ADD CONSTRAINT ai_tag_bakeoff_results_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
$ddl_12$;
  execute $ddl_13$
ALTER TABLE ONLY public.ai_tag_bakeoff_results
    ADD CONSTRAINT ai_tag_bakeoff_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.ai_tag_bakeoff_runs(id) ON DELETE CASCADE;
$ddl_13$;
  execute $ddl_14$
ALTER TABLE ONLY public.ai_tag_bakeoff_reviews
    ADD CONSTRAINT ai_tag_bakeoff_reviews_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;
$ddl_14$;
  execute $ddl_15$
ALTER TABLE ONLY public.ai_tag_bakeoff_reviews
    ADD CONSTRAINT ai_tag_bakeoff_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
$ddl_15$;
  execute $ddl_16$
ALTER TABLE ONLY public.ai_tag_bakeoff_reviews
    ADD CONSTRAINT ai_tag_bakeoff_reviews_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.ai_tag_bakeoff_runs(id) ON DELETE CASCADE;
$ddl_16$;
  execute $ddl_17$
ALTER TABLE ONLY public.ai_tag_bakeoff_runs
    ADD CONSTRAINT ai_tag_bakeoff_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
$ddl_17$;
  execute $ddl_18$
CREATE POLICY "Admin manage ai tag bakeoff results" ON public.ai_tag_bakeoff_results USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_18$;
  execute $ddl_19$
CREATE POLICY "Admin manage ai tag bakeoff reviews" ON public.ai_tag_bakeoff_reviews USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_19$;
  execute $ddl_20$
CREATE POLICY "Admin manage ai tag bakeoff runs" ON public.ai_tag_bakeoff_runs USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_20$;
  execute $ddl_21$
CREATE POLICY "Admin read ai tag bakeoff results" ON public.ai_tag_bakeoff_results FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_21$;
  execute $ddl_22$
CREATE POLICY "Admin read ai tag bakeoff reviews" ON public.ai_tag_bakeoff_reviews FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_22$;
  execute $ddl_23$
CREATE POLICY "Admin read ai tag bakeoff runs" ON public.ai_tag_bakeoff_runs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_23$;
  execute $ddl_24$
ALTER TABLE public.ai_tag_bakeoff_results ENABLE ROW LEVEL SECURITY;
$ddl_24$;
  execute $ddl_25$
ALTER TABLE public.ai_tag_bakeoff_reviews ENABLE ROW LEVEL SECURITY;
$ddl_25$;
  execute $ddl_26$
ALTER TABLE public.ai_tag_bakeoff_runs ENABLE ROW LEVEL SECURITY;
$ddl_26$;
end;
$guard$;

call public.reconcile_ai_tag_bakeoff();
drop procedure public.reconcile_ai_tag_bakeoff();
