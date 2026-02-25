-- Update auto_queue_render to queue ALL file types (not just .ai)
CREATE OR REPLACE FUNCTION public.auto_queue_render()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
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

  -- Queue ANY file type that has a thumbnail error and no thumbnail
  IF NEW.thumbnail_error IS NOT NULL
     AND NEW.thumbnail_url IS NULL THEN
    INSERT INTO public.render_queue (asset_id, status)
    VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure trigger exists on assets table
DROP TRIGGER IF EXISTS trg_auto_queue_render ON public.assets;
CREATE TRIGGER trg_auto_queue_render
  AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url
  ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_queue_render();