-- Generated from a read-only production pg_dump schema snapshot.
-- Additive reconciliation: skip the complete baseline when the schema exists.
create or replace procedure public.reconcile_style_tracker_tables()
language plpgsql
as $guard$
begin
  if to_regclass('public.style_tracker_rows') is not null then
    raise notice 'reconciliation target already exists; baseline skipped';
    return;
  end if;
  execute $ddl_0$
CREATE TABLE public.style_tracker_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_workbook_id text DEFAULT '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'::text NOT NULL,
    source_sheet text NOT NULL,
    source_row_number integer,
    tracker_type text NOT NULL,
    sku text,
    group_id text,
    description text,
    customer text,
    designer text,
    commissioned text,
    upc text,
    customer_sku text,
    licensor text,
    license_status text,
    royalty text,
    concept_status text,
    pre_production_status text,
    production_status text,
    default_vendor text,
    discontinued boolean,
    notes text,
    row_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT style_tracker_rows_tracker_type_check CHECK ((tracker_type = ANY (ARRAY['licensed'::text, 'generic'::text, 'vendor'::text, 'project'::text, 'order'::text, 'other'::text])))
);
$ddl_0$;
  execute $ddl_1$
COMMENT ON TABLE public.style_tracker_rows IS 'Supabase-backed replacement for the legacy Google style tracker workbook. Typed columns support cross-app joins; row_data preserves the original sheet cells.';
$ddl_1$;
  execute $ddl_2$
CREATE TABLE plm.style_tracker_value_resolution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_key text NOT NULL,
    raw_value text NOT NULL,
    normalized_value text NOT NULL,
    resolution_type text NOT NULL,
    target_schema text,
    target_table text,
    target_id uuid,
    target_label text,
    local_value text,
    confidence text DEFAULT 'verified'::text NOT NULL,
    notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT style_tracker_value_resolution_confidence_check CHECK ((confidence = ANY (ARRAY['verified'::text, 'probable'::text, 'possible'::text, 'conflict'::text]))),
    CONSTRAINT style_tracker_value_resolution_field_key_check CHECK ((field_key = ANY (ARRAY['sku'::text, 'customer'::text, 'licensor'::text, 'designer'::text, 'factory'::text]))),
    CONSTRAINT style_tracker_value_resolution_resolution_type_check CHECK ((resolution_type = ANY (ARRAY['canonical'::text, 'master_data'::text]))),
    CONSTRAINT style_tracker_value_resolution_target_check CHECK ((((resolution_type = 'canonical'::text) AND (target_schema IS NOT NULL) AND (target_table IS NOT NULL) AND (target_id IS NOT NULL) AND (target_label IS NOT NULL) AND (local_value IS NULL)) OR ((resolution_type = 'master_data'::text) AND (local_value IS NOT NULL) AND (target_schema IS NULL) AND (target_table IS NULL) AND (target_id IS NULL))))
);
$ddl_2$;
  execute $ddl_3$
COMMENT ON TABLE plm.style_tracker_value_resolution IS 'Manual Master Data resolutions for values imported from the style tracker. Canonical resolutions link to shared tables; master_data resolutions create local-only values and never write to shared tables.';
$ddl_3$;
  execute $ddl_4$
CREATE TABLE plm.style_tracker_item_bridge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    style_tracker_row_id uuid NOT NULL,
    bridge_source text DEFAULT 'google_style_tracker'::text NOT NULL,
    source_workbook_id text NOT NULL,
    source_sheet text NOT NULL,
    source_row_number integer,
    tracker_type text NOT NULL,
    sku text,
    description text,
    customer_name text,
    designer_name text,
    commissioned text,
    upc text,
    customer_sku text,
    licensor_name text,
    license_status text,
    royalty text,
    concept_status text,
    pre_production_status text,
    production_status text,
    default_vendor_name text,
    discontinued boolean,
    notes text,
    erp_item_id uuid,
    style_group_id uuid,
    company_id uuid,
    public_licensor_id uuid,
    core_licensor_id uuid,
    factory_id uuid,
    plm_item_id uuid,
    match_status text DEFAULT 'unmatched'::text NOT NULL,
    match_confidence text DEFAULT 'possible'::text NOT NULL,
    match_notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_row_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    creative_designer_id uuid,
    CONSTRAINT style_tracker_item_bridge_match_confidence_check CHECK ((match_confidence = ANY (ARRAY['verified'::text, 'probable'::text, 'possible'::text, 'conflict'::text]))),
    CONSTRAINT style_tracker_item_bridge_match_status_check CHECK ((match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'partial'::text, 'needs_review'::text]))),
    CONSTRAINT style_tracker_item_bridge_tracker_type_check CHECK ((tracker_type = ANY (ARRAY['licensed'::text, 'generic'::text, 'vendor'::text, 'project'::text, 'order'::text, 'other'::text])))
);
$ddl_4$;
  execute $ddl_5$
COMMENT ON TABLE plm.style_tracker_item_bridge IS 'Temporary operational PLM bridge for the Google style tracker. It keeps sheet-entered business data editable now while PLM canonical tables are being migrated into Supabase.';
$ddl_5$;
  execute $ddl_6$
COMMENT ON COLUMN plm.style_tracker_item_bridge.match_status IS 'Overall bridge resolution: unmatched, partial, matched, or needs_review for duplicate/conflicting deterministic matches.';
$ddl_6$;
  execute $ddl_7$
CREATE TABLE public.style_tracker_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    style_tracker_row_id uuid,
    source_sheet text,
    source_row_number integer,
    field_key text,
    column_letter text,
    old_value jsonb,
    new_value jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    changed_by uuid DEFAULT auth.uid(),
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT style_tracker_audit_log_event_type_check CHECK ((event_type = ANY (ARRAY['row_added'::text, 'cell_update'::text, 'value_resolution'::text])))
);
$ddl_7$;
  execute $ddl_8$
COMMENT ON TABLE public.style_tracker_audit_log IS 'User-visible Master Data style tracker audit log for row additions, cell edits, and manual value resolutions.';
$ddl_8$;
  execute $ddl_9$
CREATE VIEW public.style_tracker_audit_log_with_user AS
 SELECT audit.id,
    audit.event_type,
    audit.style_tracker_row_id,
    audit.source_sheet,
    audit.source_row_number,
    audit.field_key,
    audit.column_letter,
    audit.old_value,
    audit.new_value,
    audit.metadata,
    audit.changed_by,
    audit.changed_at,
    COALESCE(NULLIF(profile.full_name, ''::text), NULLIF(profile.email, ''::text), (audit.changed_by)::text, 'System'::text) AS changed_by_label,
    profile.email AS changed_by_email
   FROM (public.style_tracker_audit_log audit
     LEFT JOIN public.profiles profile ON ((profile.user_id = audit.changed_by)));
$ddl_9$;
  execute $ddl_10$
CREATE VIEW public.style_tracker_rows_with_bridge AS
 SELECT r.id,
    r.source_workbook_id,
    r.source_sheet,
    r.source_row_number,
    r.tracker_type,
    r.sku,
    r.group_id,
    r.description,
    r.customer,
    r.designer,
    r.commissioned,
    r.upc,
    r.customer_sku,
    r.licensor,
    r.license_status,
    r.royalty,
    r.concept_status,
    r.pre_production_status,
    r.production_status,
    r.default_vendor,
    r.discontinued,
    r.notes,
    r.row_data,
    r.imported_at,
    r.created_at,
    r.updated_at,
    r.updated_by,
    b.id AS bridge_id,
    b.erp_item_id,
    b.style_group_id,
    b.company_id,
    b.public_licensor_id,
    b.core_licensor_id,
    b.factory_id,
    b.plm_item_id,
    b.match_status,
    b.match_confidence,
    b.match_notes,
    b.last_matched_at,
    erp.item_description AS canonical_description,
    company.name AS canonical_customer_name,
    COALESCE(core_lic.name, public_lic.name) AS canonical_licensor_name,
    factory.name AS canonical_factory_name,
    sg.sku AS style_group_sku,
    erp.style_number AS erp_style_number,
    b.creative_designer_id,
    creative.name AS canonical_designer_name
   FROM ((((((((public.style_tracker_rows r
     LEFT JOIN plm.style_tracker_item_bridge b ON ((b.style_tracker_row_id = r.id)))
     LEFT JOIN public.erp_items_current erp ON ((erp.id = b.erp_item_id)))
     LEFT JOIN public.style_groups sg ON ((sg.id = b.style_group_id)))
     LEFT JOIN core.customer company ON ((company.id = b.company_id)))
     LEFT JOIN public.licensors public_lic ON ((public_lic.id = b.public_licensor_id)))
     LEFT JOIN core.licensor core_lic ON ((core_lic.id = b.core_licensor_id)))
     LEFT JOIN core.creative_designer creative ON ((creative.id = b.creative_designer_id)))
     LEFT JOIN core.factory factory ON ((factory.id = b.factory_id)));
$ddl_10$;
  execute $ddl_11$
CREATE TABLE public.style_tracker_user_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source_sheet text NOT NULL,
    view_name text DEFAULT 'default'::text NOT NULL,
    column_state jsonb DEFAULT '[]'::jsonb NOT NULL,
    filter_model jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT style_tracker_user_views_source_sheet_check CHECK ((source_sheet = ANY (ARRAY['License.Style'::text, 'Generic.Style'::text])))
);
$ddl_11$;
  execute $ddl_12$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_pkey PRIMARY KEY (id);
$ddl_12$;
  execute $ddl_13$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_row_unique UNIQUE (style_tracker_row_id);
$ddl_13$;
  execute $ddl_14$
ALTER TABLE ONLY plm.style_tracker_value_resolution
    ADD CONSTRAINT style_tracker_value_resolution_pkey PRIMARY KEY (id);
$ddl_14$;
  execute $ddl_15$
ALTER TABLE ONLY plm.style_tracker_value_resolution
    ADD CONSTRAINT style_tracker_value_resolution_unique UNIQUE (field_key, normalized_value);
$ddl_15$;
  execute $ddl_16$
ALTER TABLE ONLY public.style_tracker_audit_log
    ADD CONSTRAINT style_tracker_audit_log_pkey PRIMARY KEY (id);
$ddl_16$;
  execute $ddl_17$
ALTER TABLE ONLY public.style_tracker_rows
    ADD CONSTRAINT style_tracker_rows_pkey PRIMARY KEY (id);
$ddl_17$;
  execute $ddl_18$
ALTER TABLE ONLY public.style_tracker_rows
    ADD CONSTRAINT style_tracker_rows_source_row_unique UNIQUE (source_workbook_id, source_sheet, source_row_number);
$ddl_18$;
  execute $ddl_19$
ALTER TABLE ONLY public.style_tracker_user_views
    ADD CONSTRAINT style_tracker_user_views_pkey PRIMARY KEY (id);
$ddl_19$;
  execute $ddl_20$
ALTER TABLE ONLY public.style_tracker_user_views
    ADD CONSTRAINT style_tracker_user_views_unique UNIQUE (user_id, source_sheet, view_name);
$ddl_20$;
  execute $ddl_21$
CREATE INDEX idx_style_tracker_item_bridge_company ON plm.style_tracker_item_bridge USING btree (company_id) WHERE (company_id IS NOT NULL);
$ddl_21$;
  execute $ddl_22$
CREATE INDEX idx_style_tracker_item_bridge_creative_designer ON plm.style_tracker_item_bridge USING btree (creative_designer_id) WHERE (creative_designer_id IS NOT NULL);
$ddl_22$;
  execute $ddl_23$
CREATE INDEX idx_style_tracker_item_bridge_erp_item ON plm.style_tracker_item_bridge USING btree (erp_item_id) WHERE (erp_item_id IS NOT NULL);
$ddl_23$;
  execute $ddl_24$
CREATE INDEX idx_style_tracker_item_bridge_match_status ON plm.style_tracker_item_bridge USING btree (match_status);
$ddl_24$;
  execute $ddl_25$
CREATE INDEX idx_style_tracker_item_bridge_row ON plm.style_tracker_item_bridge USING btree (style_tracker_row_id);
$ddl_25$;
  execute $ddl_26$
CREATE INDEX idx_style_tracker_item_bridge_sku ON plm.style_tracker_item_bridge USING btree (upper(sku)) WHERE (sku IS NOT NULL);
$ddl_26$;
  execute $ddl_27$
CREATE INDEX idx_style_tracker_item_bridge_style_group ON plm.style_tracker_item_bridge USING btree (style_group_id) WHERE (style_group_id IS NOT NULL);
$ddl_27$;
  execute $ddl_28$
CREATE INDEX idx_style_tracker_value_resolution_field_value ON plm.style_tracker_value_resolution USING btree (field_key, normalized_value);
$ddl_28$;
  execute $ddl_29$
CREATE INDEX idx_style_tracker_audit_log_changed_at ON public.style_tracker_audit_log USING btree (changed_at DESC);
$ddl_29$;
  execute $ddl_30$
CREATE INDEX idx_style_tracker_audit_log_row ON public.style_tracker_audit_log USING btree (style_tracker_row_id, changed_at DESC) WHERE (style_tracker_row_id IS NOT NULL);
$ddl_30$;
  execute $ddl_31$
CREATE INDEX idx_style_tracker_audit_log_sheet ON public.style_tracker_audit_log USING btree (source_sheet, changed_at DESC);
$ddl_31$;
  execute $ddl_32$
CREATE INDEX idx_style_tracker_rows_group_id ON public.style_tracker_rows USING btree (upper(group_id)) WHERE (group_id IS NOT NULL);
$ddl_32$;
  execute $ddl_33$
CREATE INDEX idx_style_tracker_rows_row_data_gin ON public.style_tracker_rows USING gin (row_data);
$ddl_33$;
  execute $ddl_34$
CREATE INDEX idx_style_tracker_rows_sku ON public.style_tracker_rows USING btree (upper(sku)) WHERE (sku IS NOT NULL);
$ddl_34$;
  execute $ddl_35$
CREATE INDEX idx_style_tracker_rows_source_sheet ON public.style_tracker_rows USING btree (source_sheet, source_row_number);
$ddl_35$;
  execute $ddl_36$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_company_id_fkey FOREIGN KEY (company_id) REFERENCES core.customer(id) ON DELETE SET NULL;
$ddl_36$;
  execute $ddl_37$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_core_licensor_id_fkey FOREIGN KEY (core_licensor_id) REFERENCES core.licensor(id) ON DELETE SET NULL;
$ddl_37$;
  execute $ddl_38$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_creative_designer_id_fkey FOREIGN KEY (creative_designer_id) REFERENCES core.creative_designer(id) ON DELETE SET NULL;
$ddl_38$;
  execute $ddl_39$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_erp_item_id_fkey FOREIGN KEY (erp_item_id) REFERENCES public.erp_items_current(id) ON DELETE SET NULL;
$ddl_39$;
  execute $ddl_40$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES core.factory(id) ON DELETE SET NULL;
$ddl_40$;
  execute $ddl_41$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_plm_item_id_fkey FOREIGN KEY (plm_item_id) REFERENCES plm.item(id) ON DELETE SET NULL;
$ddl_41$;
  execute $ddl_42$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_public_licensor_id_fkey FOREIGN KEY (public_licensor_id) REFERENCES public.licensors(id) ON DELETE SET NULL;
$ddl_42$;
  execute $ddl_43$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_style_group_id_fkey FOREIGN KEY (style_group_id) REFERENCES public.style_groups(id) ON DELETE SET NULL;
$ddl_43$;
  execute $ddl_44$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_style_tracker_row_id_fkey FOREIGN KEY (style_tracker_row_id) REFERENCES public.style_tracker_rows(id) ON DELETE CASCADE;
$ddl_44$;
  execute $ddl_45$
ALTER TABLE ONLY plm.style_tracker_item_bridge
    ADD CONSTRAINT style_tracker_item_bridge_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
$ddl_45$;
  execute $ddl_46$
ALTER TABLE ONLY plm.style_tracker_value_resolution
    ADD CONSTRAINT style_tracker_value_resolution_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
$ddl_46$;
  execute $ddl_47$
ALTER TABLE ONLY public.style_tracker_audit_log
    ADD CONSTRAINT style_tracker_audit_log_style_tracker_row_id_fkey FOREIGN KEY (style_tracker_row_id) REFERENCES public.style_tracker_rows(id) ON DELETE SET NULL;
$ddl_47$;
  execute $ddl_48$
ALTER TABLE ONLY public.style_tracker_rows
    ADD CONSTRAINT style_tracker_rows_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
$ddl_48$;
  execute $ddl_49$
ALTER TABLE ONLY public.style_tracker_user_views
    ADD CONSTRAINT style_tracker_user_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
$ddl_49$;
  execute $ddl_50$
CREATE POLICY "Authenticated users insert style tracker bridge" ON plm.style_tracker_item_bridge FOR INSERT TO authenticated WITH CHECK (true);
$ddl_50$;
  execute $ddl_51$
CREATE POLICY "Authenticated users insert style tracker value resolutions" ON plm.style_tracker_value_resolution FOR INSERT TO authenticated WITH CHECK (true);
$ddl_51$;
  execute $ddl_52$
CREATE POLICY "Authenticated users read style tracker bridge" ON plm.style_tracker_item_bridge FOR SELECT TO authenticated USING (true);
$ddl_52$;
  execute $ddl_53$
CREATE POLICY "Authenticated users read style tracker value resolutions" ON plm.style_tracker_value_resolution FOR SELECT TO authenticated USING (true);
$ddl_53$;
  execute $ddl_54$
CREATE POLICY "Authenticated users update style tracker bridge" ON plm.style_tracker_item_bridge FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
$ddl_54$;
  execute $ddl_55$
CREATE POLICY "Authenticated users update style tracker value resolutions" ON plm.style_tracker_value_resolution FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
$ddl_55$;
  execute $ddl_56$
ALTER TABLE plm.style_tracker_item_bridge ENABLE ROW LEVEL SECURITY;
$ddl_56$;
  execute $ddl_57$
ALTER TABLE plm.style_tracker_value_resolution ENABLE ROW LEVEL SECURITY;
$ddl_57$;
  execute $ddl_58$
CREATE POLICY "Admins delete style tracker rows" ON public.style_tracker_rows FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
$ddl_58$;
  execute $ddl_59$
CREATE POLICY "Authenticated users insert style tracker rows" ON public.style_tracker_rows FOR INSERT TO authenticated WITH CHECK (true);
$ddl_59$;
  execute $ddl_60$
CREATE POLICY "Authenticated users read style tracker rows" ON public.style_tracker_rows FOR SELECT TO authenticated USING (true);
$ddl_60$;
  execute $ddl_61$
CREATE POLICY "Authenticated users update style tracker rows" ON public.style_tracker_rows FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
$ddl_61$;
  execute $ddl_62$
CREATE POLICY "Users insert their own style tracker views" ON public.style_tracker_user_views FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
$ddl_62$;
  execute $ddl_63$
CREATE POLICY "Users read their own style tracker views" ON public.style_tracker_user_views FOR SELECT TO authenticated USING ((user_id = auth.uid()));
$ddl_63$;
  execute $ddl_64$
CREATE POLICY "Users update their own style tracker views" ON public.style_tracker_user_views FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
$ddl_64$;
  execute $ddl_65$
CREATE POLICY "style tracker audit readable by authenticated users" ON public.style_tracker_audit_log FOR SELECT TO authenticated USING (true);
$ddl_65$;
  execute $ddl_66$
ALTER TABLE public.style_tracker_audit_log ENABLE ROW LEVEL SECURITY;
$ddl_66$;
  execute $ddl_67$
ALTER TABLE public.style_tracker_rows ENABLE ROW LEVEL SECURITY;
$ddl_67$;
  execute $ddl_68$
ALTER TABLE public.style_tracker_user_views ENABLE ROW LEVEL SECURITY;
$ddl_68$;
end;
$guard$;

call public.reconcile_style_tracker_tables();
drop procedure public.reconcile_style_tracker_tables();
