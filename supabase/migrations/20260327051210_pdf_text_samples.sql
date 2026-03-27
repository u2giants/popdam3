CREATE TABLE public.pdf_text_samples (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  filename          text NOT NULL,
  relative_path     text NOT NULL,
  extraction_method text NOT NULL, -- 'pdf_text' | 'likely_scanned' | 'failed'
  extracted_text    text,
  page_count        int,
  char_count        int NOT NULL DEFAULT 0,
  extraction_error  text,
  sampled_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_text_samples_asset_id ON public.pdf_text_samples(asset_id);
CREATE INDEX idx_pdf_text_samples_sampled_at ON public.pdf_text_samples(sampled_at DESC);

ALTER TABLE public.pdf_text_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin full access pdf_text_samples"
  ON public.pdf_text_samples FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
