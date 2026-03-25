
-- style_guide_crawl_runs: tracks each crawl execution
CREATE TABLE public.style_guide_crawl_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL DEFAULT 'pending',
  agent_id        text,
  roots_scanned   text[],
  files_found     integer,
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- style_guide_files: one row per file discovered during a crawl
CREATE TABLE public.style_guide_files (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_run_id            uuid REFERENCES public.style_guide_crawl_runs(id) ON DELETE SET NULL,
  root_label              text NOT NULL,
  relative_path           text NOT NULL,
  directory_path          text NOT NULL,
  filename                text NOT NULL,
  basename_no_ext         text NOT NULL,
  file_extension          text,
  parent_folder           text NOT NULL,
  grandparent_folder      text,
  normalized_name         text NOT NULL,
  normalized_parent_folder text NOT NULL,
  size_bytes              bigint,
  modified_at             timestamptz,
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT style_guide_files_root_path_unique UNIQUE (root_label, relative_path)
);

CREATE INDEX idx_sgf_root_label ON public.style_guide_files(root_label);
CREATE INDEX idx_sgf_directory_path ON public.style_guide_files(directory_path);
CREATE INDEX idx_sgf_normalized_name ON public.style_guide_files(normalized_name);
CREATE INDEX idx_sgf_is_active ON public.style_guide_files(is_active);
CREATE INDEX idx_sgf_crawl_run_id ON public.style_guide_files(crawl_run_id);

-- RLS
ALTER TABLE public.style_guide_crawl_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.style_guide_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin full access style_guide_crawl_runs"
  ON public.style_guide_crawl_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin full access style_guide_files"
  ON public.style_guide_files FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "authenticated read style_guide_files"
  ON public.style_guide_files FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "authenticated read style_guide_crawl_runs"
  ON public.style_guide_crawl_runs FOR SELECT TO authenticated
  USING (true);
