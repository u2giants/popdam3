
-- Add designer metadata columns to assets
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS designer_name text,
  ADD COLUMN IF NOT EXISTS technical_designer_name text,
  ADD COLUMN IF NOT EXISTS freelancer_name text;

-- Add designer metadata + conflict flag to style_groups
ALTER TABLE public.style_groups
  ADD COLUMN IF NOT EXISTS designer_name text,
  ADD COLUMN IF NOT EXISTS technical_designer_name text,
  ADD COLUMN IF NOT EXISTS freelancer_name text,
  ADD COLUMN IF NOT EXISTS designer_conflict boolean NOT NULL DEFAULT false;
