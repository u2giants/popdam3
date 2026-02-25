
ALTER TABLE public.characters
ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN is_priority BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_characters_is_priority 
ON public.characters(is_priority) 
WHERE is_priority = true;

CREATE INDEX idx_characters_usage_count 
ON public.characters(usage_count);
