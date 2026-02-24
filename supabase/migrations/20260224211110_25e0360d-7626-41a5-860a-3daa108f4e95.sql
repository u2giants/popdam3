ALTER TABLE public.style_groups ADD COLUMN latest_file_date TIMESTAMPTZ;
CREATE INDEX idx_style_groups_latest_file_date ON public.style_groups(latest_file_date);