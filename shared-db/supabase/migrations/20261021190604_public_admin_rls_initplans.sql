-- Issue #4427; claim #4563; reserved version 20261021190604.
-- Change exactly 44 qualified request-constant predicates. Two retired archive
-- policies remain unchanged: current role/privilege intersections have no callers. No grants, helper, role,
-- policy union, RLS flag, or implicit WITH CHECK changes.
-- The atomic migration runner supplies the transaction. Never run production SQL manually.
SET LOCAL search_path = public, pg_catalog;
DO $rls4427_before$
DECLARE
 targets jsonb := $targets$[{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"legacy_erp_item_identity","permissive":"PERMISSIVE","policyname":"legacy_erp_item_identity_admin_read","schemaname":"plm","with_check":null},{"cmd":"DELETE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin delete admin_config","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin read all admin_config","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin update admin_config","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin write admin_config","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"agent_pairings","permissive":"PERMISSIVE","policyname":"Admin manage agent_pairings","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"agent_registrations","permissive":"PERMISSIVE","policyname":"Admin manage agent_registrations","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_results","permissive":"PERMISSIVE","policyname":"Admin manage ai tag bakeoff results","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_results","permissive":"PERMISSIVE","policyname":"Admin read ai tag bakeoff results","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_reviews","permissive":"PERMISSIVE","policyname":"Admin manage ai tag bakeoff reviews","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_reviews","permissive":"PERMISSIVE","policyname":"Admin read ai tag bakeoff reviews","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_runs","permissive":"PERMISSIVE","policyname":"Admin manage ai tag bakeoff runs","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_runs","permissive":"PERMISSIVE","policyname":"Admin read ai tag bakeoff runs","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"app_access","permissive":"PERMISSIVE","policyname":"Admins manage app_access","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"asset_characters","permissive":"PERMISSIVE","policyname":"Admin write asset_characters","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"asset_tags","permissive":"PERMISSIVE","policyname":"Admin manage asset_tags","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"assets","permissive":"PERMISSIVE","policyname":"Admins can insert assets","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"UPDATE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"assets","permissive":"PERMISSIVE","policyname":"Admins can update assets","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"characters","permissive":"PERMISSIVE","policyname":"Admin write characters","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"erp_enrichment_log","permissive":"PERMISSIVE","policyname":"Admin manage erp_enrichment_log","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"erp_sync_runs","permissive":"PERMISSIVE","policyname":"Admin manage erp_sync_runs","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"hygiene_findings","permissive":"PERMISSIVE","policyname":"Admin manage hygiene_findings","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"invitations","permissive":"PERMISSIVE","policyname":"Admin manage invitations","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"licensors","permissive":"PERMISSIVE","policyname":"Admin write licensors","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"pdf_text_samples","permissive":"PERMISSIVE","policyname":"admin full access pdf_text_samples","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"processing_queue","permissive":"PERMISSIVE","policyname":"Admin manage processing_queue","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"prod_order_headers_current","permissive":"PERMISSIVE","policyname":"Admins manage prod_order_headers_current","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"prod_order_headers_raw","permissive":"PERMISSIVE","policyname":"Admins manage prod_order_headers_raw","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"prod_order_sync_runs","permissive":"PERMISSIVE","policyname":"Admins manage prod_order_sync_runs","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_categories","permissive":"PERMISSIVE","policyname":"Admin write product_categories","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_category_predictions","permissive":"PERMISSIVE","policyname":"Admin manage product_category_predictions","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_subtypes","permissive":"PERMISSIVE","policyname":"Admin write product_subtypes","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_types","permissive":"PERMISSIVE","policyname":"Admin write product_types","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"profiles","permissive":"PERMISSIVE","policyname":"Admins read all profiles","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"properties","permissive":"PERMISSIVE","policyname":"Admin write properties","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"render_queue","permissive":"PERMISSIVE","policyname":"Admin manage render_queue","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_group_tags","permissive":"PERMISSIVE","policyname":"Admin manage style_group_tags","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"style_groups","permissive":"PERMISSIVE","policyname":"Admins can manage style_groups","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_guide_crawl_runs","permissive":"PERMISSIVE","policyname":"admin full access style_guide_crawl_runs","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_guide_files","permissive":"PERMISSIVE","policyname":"admin full access style_guide_files","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_guide_render_queue","permissive":"PERMISSIVE","policyname":"Admin manage style_guide_render_queue","schemaname":"public","with_check":null},{"cmd":"DELETE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_tracker_rows","permissive":"PERMISSIVE","policyname":"Admins delete style tracker rows","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"tiff_optimization_queue","permissive":"PERMISSIVE","policyname":"Admin manage tiff_optimization_queue","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"user_roles","permissive":"PERMISSIVE","policyname":"Admins manage user_roles","schemaname":"public","with_check":null}]$targets$::jsonb;
 expected jsonb;
 actual jsonb;
 snapshot jsonb;
BEGIN
 IF (SELECT count(*) FROM jsonb_array_elements(targets)) <> 44 THEN
  RAISE EXCEPTION '4427 target manifest cardinality changed';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('auth.uid()'::regprocedure,'public.has_role(uuid,public.app_role)'::regprocedure) AND provolatile <> 's') THEN
  RAISE EXCEPTION '4427 request-constant helper volatility drift';
 END IF;
 FOR expected IN SELECT * FROM jsonb_array_elements(targets) LOOP
  SELECT jsonb_build_object('schemaname',p.schemaname,'tablename',p.tablename,'policyname',p.policyname,'cmd',p.cmd,'roles',to_jsonb(p.roles),'permissive',p.permissive,'qual',p.qual,'with_check',p.with_check) INTO actual
  FROM pg_policies p WHERE p.schemaname=expected->>'schemaname' AND p.tablename=expected->>'tablename' AND p.policyname=expected->>'policyname';
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION '4427 baseline policy drift: %.% / %', expected->>'schemaname', expected->>'tablename', expected->>'policyname';
  END IF;
 END LOOP;
 SELECT jsonb_build_object(
 'tables', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (SELECT x->>'schemaname',x->>'tablename' FROM jsonb_array_elements(targets) x)),
 'helpers', (SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'volatility',p.provolatile,'definer',p.prosecdef) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('auth.uid()'::regprocedure,'public.has_role(uuid,public.app_role)'::regprocedure)),
 'policies', (SELECT jsonb_agg(jsonb_build_object('schema',p.schemaname,'table',p.tablename,'name',p.policyname,'command',p.cmd,'permissive',p.permissive,'roles',p.roles,'qual',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(targets) x WHERE x->>'schemaname'=p.schemaname AND x->>'tablename'=p.tablename AND x->>'policyname'=p.policyname) THEN '#target#' ELSE p.qual END,'check',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(targets) x WHERE x->>'schemaname'=p.schemaname AND x->>'tablename'=p.tablename AND x->>'policyname'=p.policyname) THEN '#target#' ELSE p.with_check END) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_policies p WHERE (p.schemaname,p.tablename) IN (SELECT x->>'schemaname',x->>'tablename' FROM jsonb_array_elements(targets) x))) INTO snapshot;
 PERFORM set_config('shared_db.rls4427_before',snapshot::text,true);
END
$rls4427_before$;

ALTER POLICY "legacy_erp_item_identity_admin_read" ON "plm"."legacy_erp_item_identity"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin delete admin_config" ON "public"."admin_config"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin read all admin_config" ON "public"."admin_config"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin update admin_config" ON "public"."admin_config"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write admin_config" ON "public"."admin_config"
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage agent_pairings" ON "public"."agent_pairings"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage agent_registrations" ON "public"."agent_registrations"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage ai tag bakeoff results" ON "public"."ai_tag_bakeoff_results"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin read ai tag bakeoff results" ON "public"."ai_tag_bakeoff_results"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage ai tag bakeoff reviews" ON "public"."ai_tag_bakeoff_reviews"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin read ai tag bakeoff reviews" ON "public"."ai_tag_bakeoff_reviews"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage ai tag bakeoff runs" ON "public"."ai_tag_bakeoff_runs"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin read ai tag bakeoff runs" ON "public"."ai_tag_bakeoff_runs"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins manage app_access" ON "public"."app_access"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write asset_characters" ON "public"."asset_characters"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage asset_tags" ON "public"."asset_tags"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins can insert assets" ON "public"."assets"
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins can update assets" ON "public"."assets"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write characters" ON "public"."characters"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage erp_enrichment_log" ON "public"."erp_enrichment_log"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage erp_sync_runs" ON "public"."erp_sync_runs"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage hygiene_findings" ON "public"."hygiene_findings"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage invitations" ON "public"."invitations"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write licensors" ON "public"."licensors"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "admin full access pdf_text_samples" ON "public"."pdf_text_samples"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage processing_queue" ON "public"."processing_queue"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins manage prod_order_headers_current" ON "public"."prod_order_headers_current"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins manage prod_order_headers_raw" ON "public"."prod_order_headers_raw"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins manage prod_order_sync_runs" ON "public"."prod_order_sync_runs"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write product_categories" ON "public"."product_categories"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage product_category_predictions" ON "public"."product_category_predictions"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write product_subtypes" ON "public"."product_subtypes"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write product_types" ON "public"."product_types"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins read all profiles" ON "public"."profiles"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin write properties" ON "public"."properties"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage render_queue" ON "public"."render_queue"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage style_group_tags" ON "public"."style_group_tags"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins can manage style_groups" ON "public"."style_groups"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "admin full access style_guide_crawl_runs" ON "public"."style_guide_crawl_runs"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "admin full access style_guide_files" ON "public"."style_guide_files"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage style_guide_render_queue" ON "public"."style_guide_render_queue"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins delete style tracker rows" ON "public"."style_tracker_rows"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admin manage tiff_optimization_queue" ON "public"."tiff_optimization_queue"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Admins manage user_roles" ON "public"."user_roles"
  USING ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

DO $rls4427_after$
DECLARE
 targets jsonb := $targets$[{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"legacy_erp_item_identity","permissive":"PERMISSIVE","policyname":"legacy_erp_item_identity_admin_read","schemaname":"plm","with_check":null},{"cmd":"DELETE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin delete admin_config","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin read all admin_config","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin update admin_config","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"admin_config","permissive":"PERMISSIVE","policyname":"Admin write admin_config","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"agent_pairings","permissive":"PERMISSIVE","policyname":"Admin manage agent_pairings","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"agent_registrations","permissive":"PERMISSIVE","policyname":"Admin manage agent_registrations","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_results","permissive":"PERMISSIVE","policyname":"Admin manage ai tag bakeoff results","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_results","permissive":"PERMISSIVE","policyname":"Admin read ai tag bakeoff results","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_reviews","permissive":"PERMISSIVE","policyname":"Admin manage ai tag bakeoff reviews","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_reviews","permissive":"PERMISSIVE","policyname":"Admin read ai tag bakeoff reviews","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_runs","permissive":"PERMISSIVE","policyname":"Admin manage ai tag bakeoff runs","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"ai_tag_bakeoff_runs","permissive":"PERMISSIVE","policyname":"Admin read ai tag bakeoff runs","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"app_access","permissive":"PERMISSIVE","policyname":"Admins manage app_access","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"asset_characters","permissive":"PERMISSIVE","policyname":"Admin write asset_characters","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"asset_tags","permissive":"PERMISSIVE","policyname":"Admin manage asset_tags","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"assets","permissive":"PERMISSIVE","policyname":"Admins can insert assets","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"UPDATE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"assets","permissive":"PERMISSIVE","policyname":"Admins can update assets","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"characters","permissive":"PERMISSIVE","policyname":"Admin write characters","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"erp_enrichment_log","permissive":"PERMISSIVE","policyname":"Admin manage erp_enrichment_log","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"erp_sync_runs","permissive":"PERMISSIVE","policyname":"Admin manage erp_sync_runs","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"hygiene_findings","permissive":"PERMISSIVE","policyname":"Admin manage hygiene_findings","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"invitations","permissive":"PERMISSIVE","policyname":"Admin manage invitations","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"licensors","permissive":"PERMISSIVE","policyname":"Admin write licensors","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"pdf_text_samples","permissive":"PERMISSIVE","policyname":"admin full access pdf_text_samples","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"processing_queue","permissive":"PERMISSIVE","policyname":"Admin manage processing_queue","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"prod_order_headers_current","permissive":"PERMISSIVE","policyname":"Admins manage prod_order_headers_current","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"prod_order_headers_raw","permissive":"PERMISSIVE","policyname":"Admins manage prod_order_headers_raw","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"prod_order_sync_runs","permissive":"PERMISSIVE","policyname":"Admins manage prod_order_sync_runs","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_categories","permissive":"PERMISSIVE","policyname":"Admin write product_categories","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_category_predictions","permissive":"PERMISSIVE","policyname":"Admin manage product_category_predictions","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_subtypes","permissive":"PERMISSIVE","policyname":"Admin write product_subtypes","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"product_types","permissive":"PERMISSIVE","policyname":"Admin write product_types","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"profiles","permissive":"PERMISSIVE","policyname":"Admins read all profiles","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"properties","permissive":"PERMISSIVE","policyname":"Admin write properties","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"render_queue","permissive":"PERMISSIVE","policyname":"Admin manage render_queue","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_group_tags","permissive":"PERMISSIVE","policyname":"Admin manage style_group_tags","schemaname":"public","with_check":"has_role(auth.uid(), 'admin'::app_role)"},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"style_groups","permissive":"PERMISSIVE","policyname":"Admins can manage style_groups","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_guide_crawl_runs","permissive":"PERMISSIVE","policyname":"admin full access style_guide_crawl_runs","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_guide_files","permissive":"PERMISSIVE","policyname":"admin full access style_guide_files","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_guide_render_queue","permissive":"PERMISSIVE","policyname":"Admin manage style_guide_render_queue","schemaname":"public","with_check":null},{"cmd":"DELETE","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"style_tracker_rows","permissive":"PERMISSIVE","policyname":"Admins delete style tracker rows","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["public"],"tablename":"tiff_optimization_queue","permissive":"PERMISSIVE","policyname":"Admin manage tiff_optimization_queue","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"has_role(auth.uid(), 'admin'::app_role)","roles":["authenticated"],"tablename":"user_roles","permissive":"PERMISSIVE","policyname":"Admins manage user_roles","schemaname":"public","with_check":null}]$targets$::jsonb;
 expected jsonb;
 actual record;
 snapshot jsonb;
 wrapped text := '( SELECT has_role(auth.uid(), ''admin''::app_role) AS has_role)';
BEGIN
 SELECT jsonb_build_object(
 'tables', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (SELECT x->>'schemaname',x->>'tablename' FROM jsonb_array_elements(targets) x)),
 'helpers', (SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'volatility',p.provolatile,'definer',p.prosecdef) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('auth.uid()'::regprocedure,'public.has_role(uuid,public.app_role)'::regprocedure)),
 'policies', (SELECT jsonb_agg(jsonb_build_object('schema',p.schemaname,'table',p.tablename,'name',p.policyname,'command',p.cmd,'permissive',p.permissive,'roles',p.roles,'qual',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(targets) x WHERE x->>'schemaname'=p.schemaname AND x->>'tablename'=p.tablename AND x->>'policyname'=p.policyname) THEN '#target#' ELSE p.qual END,'check',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(targets) x WHERE x->>'schemaname'=p.schemaname AND x->>'tablename'=p.tablename AND x->>'policyname'=p.policyname) THEN '#target#' ELSE p.with_check END) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_policies p WHERE (p.schemaname,p.tablename) IN (SELECT x->>'schemaname',x->>'tablename' FROM jsonb_array_elements(targets) x))) INTO snapshot;
 IF snapshot IS DISTINCT FROM current_setting('shared_db.rls4427_before')::jsonb THEN
  RAISE EXCEPTION '4427 changed metadata, helper protections, grants, or overlapping policies';
 END IF;
 FOR expected IN SELECT * FROM jsonb_array_elements(targets) LOOP
  SELECT p.qual,p.with_check INTO STRICT actual FROM pg_policies p WHERE p.schemaname=expected->>'schemaname' AND p.tablename=expected->>'tablename' AND p.policyname=expected->>'policyname';
  IF regexp_replace(actual.qual,'[[:space:]]+',' ','g') IS DISTINCT FROM (CASE WHEN expected->>'qual' IS NULL THEN NULL ELSE wrapped END)
   OR regexp_replace(actual.with_check,'[[:space:]]+',' ','g') IS DISTINCT FROM (CASE WHEN expected->>'with_check' IS NULL THEN NULL ELSE wrapped END) THEN
   RAISE EXCEPTION '4427 resulting expression or implicit check differs: %.% / %',expected->>'schemaname',expected->>'tablename',expected->>'policyname';
  END IF;
 END LOOP;
END
$rls4427_after$;
