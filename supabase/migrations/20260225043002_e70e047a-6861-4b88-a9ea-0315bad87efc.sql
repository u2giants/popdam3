CREATE OR REPLACE FUNCTION public.auto_queue_render()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip junk files (macOS resource forks, system files)
  IF NEW.filename LIKE '._%' OR
     NEW.filename = '.DS_Store' OR
     NEW.filename = '.localized' OR
     NEW.filename = 'Thumbs.db' OR
     NEW.filename = 'desktop.ini' OR
     NEW.filename LIKE '~%' THEN
    RETURN NEW;
  END IF;

  IF NEW.file_type = 'ai'
     AND NEW.thumbnail_error IS NOT NULL
     AND NEW.thumbnail_url IS NULL THEN
    INSERT INTO public.render_queue (asset_id, status)
    VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;