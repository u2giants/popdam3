-- PopSG's guides grid and folder tree are served by two views that re-aggregate
-- ALL 214k+ active style_guide_files rows on EVERY page load (~250-425ms warm,
-- ~2-3s cold, and they fire concurrently). The data only changes once per crawl,
-- so re-aggregating per request is wasted work. Convert both to MATERIALIZED
-- views, refreshed at the end of each crawl (see agent-api complete-style-guide
-- -crawl) via refresh_style_guide_matviews(). Guides query ~425ms -> ~28ms.
--
-- RLS note: style_guide_files' only SELECT policy is `authenticated USING(true)`
-- (every authenticated user can read every row), so precomputing into matviews
-- and granting SELECT to authenticated is NOT a privilege change. anon is NOT
-- granted (PopSG is authenticated-only), preserving prior access.

DROP VIEW IF EXISTS public.style_guide_file_groups;
DROP VIEW IF EXISTS public.style_guide_folders;

CREATE MATERIALIZED VIEW public.style_guide_file_groups AS
  SELECT md5((COALESCE(root_label, ''::text) || '/'::text) || COALESCE(directory_path, ''::text)) AS group_key,
    root_label,
    directory_path,
    licensor_name,
    property_folder,
    style_guide_folder,
    COALESCE(NULLIF(style_guide_folder, ''::text), NULLIF(property_folder, ''::text), licensor_name, 'Unfiled'::text) AS style_guide_name,
    count(*)::integer AS file_count,
    max(modified_at) AS latest_modified_at,
    sum(COALESCE(size_bytes, 0::bigint))::bigint AS total_size_bytes,
    (array_remove(array_agg(thumbnail_url ORDER BY modified_at DESC NULLS LAST), NULL::text))[1] AS sample_thumbnail_url
   FROM style_guide_files
  WHERE is_active = true
  GROUP BY root_label, directory_path, licensor_name, property_folder, style_guide_folder
  WITH DATA;

CREATE MATERIALIZED VIEW public.style_guide_folders AS
  SELECT DISTINCT licensor_name, property_folder
   FROM style_guide_files
  WHERE is_active = true AND licensor_name IS NOT NULL
  WITH DATA;

-- Unique index required for REFRESH ... CONCURRENTLY on the groups matview.
CREATE UNIQUE INDEX sgfg_group_key_uidx ON public.style_guide_file_groups (group_key);
CREATE INDEX sgfg_licensor_idx ON public.style_guide_file_groups (licensor_name);
CREATE INDEX sgfg_property_idx ON public.style_guide_file_groups (property_folder);
CREATE INDEX sgfg_modified_idx ON public.style_guide_file_groups (latest_modified_at DESC NULLS LAST);

GRANT SELECT ON public.style_guide_file_groups TO authenticated, service_role;
GRANT SELECT ON public.style_guide_folders TO authenticated, service_role;

-- Called by agent-api at crawl completion. SECURITY DEFINER so the service-role
-- caller can refresh matviews it does not own. The groups matview uses
-- CONCURRENTLY (no read lock); the 361-row folders matview uses a plain refresh
-- (instant, no unique-index requirement).
CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups;
  REFRESH MATERIALIZED VIEW public.style_guide_folders;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_style_guide_matviews() TO service_role;
