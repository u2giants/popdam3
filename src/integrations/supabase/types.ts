export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_config: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      agent_pairings: {
        Row: {
          agent_name: string
          agent_registration_id: string | null
          agent_type: string
          consumed_at: string | null
          consumed_by_agent_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          pairing_code: string
          status: string
        }
        Insert: {
          agent_name?: string
          agent_registration_id?: string | null
          agent_type: string
          consumed_at?: string | null
          consumed_by_agent_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          pairing_code: string
          status?: string
        }
        Update: {
          agent_name?: string
          agent_registration_id?: string | null
          agent_type?: string
          consumed_at?: string | null
          consumed_by_agent_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          pairing_code?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_pairings_agent_registration_id_fkey"
            columns: ["agent_registration_id"]
            isOneToOne: false
            referencedRelation: "agent_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_registrations: {
        Row: {
          agent_key_hash: string
          agent_name: string
          agent_type: string
          created_at: string
          id: string
          last_heartbeat: string | null
          metadata: Json
        }
        Insert: {
          agent_key_hash: string
          agent_name: string
          agent_type?: string
          created_at?: string
          id?: string
          last_heartbeat?: string | null
          metadata?: Json
        }
        Update: {
          agent_key_hash?: string
          agent_name?: string
          agent_type?: string
          created_at?: string
          id?: string
          last_heartbeat?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      ai_sentinel_cleanup_log: {
        Row: {
          ai_asset_id: string
          ai_filename: string
          ai_relative_path: string
          created_at: string | null
          id: string
          replacement_asset_id: string | null
          replacement_filename: string | null
          replacement_had_thumbnail: boolean | null
          replacement_queued_for_thumbnail: boolean | null
          replacement_relative_path: string | null
        }
        Insert: {
          ai_asset_id: string
          ai_filename: string
          ai_relative_path: string
          created_at?: string | null
          id?: string
          replacement_asset_id?: string | null
          replacement_filename?: string | null
          replacement_had_thumbnail?: boolean | null
          replacement_queued_for_thumbnail?: boolean | null
          replacement_relative_path?: string | null
        }
        Update: {
          ai_asset_id?: string
          ai_filename?: string
          ai_relative_path?: string
          created_at?: string | null
          id?: string
          replacement_asset_id?: string | null
          replacement_filename?: string | null
          replacement_had_thumbnail?: boolean | null
          replacement_queued_for_thumbnail?: boolean | null
          replacement_relative_path?: string | null
        }
        Relationships: []
      }
      app_access: {
        Row: {
          app: Database["public"]["Enums"]["app_name"]
          granted_at: string
          granted_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          app: Database["public"]["Enums"]["app_name"]
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          app?: Database["public"]["Enums"]["app_name"]
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      asset_characters: {
        Row: {
          asset_id: string
          character_id: string
        }
        Insert: {
          asset_id: string
          character_id: string
        }
        Update: {
          asset_id?: string
          character_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_characters_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_characters_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_checkouts: {
        Row: {
          asset_id: string
          checked_in_at: string | null
          checked_out_at: string
          checkin_hash: string | null
          checkin_size: number | null
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          last_helper_heartbeat_at: string | null
          seafile_library_id: string | null
          seafile_path: string | null
          source_hash: string
          source_local_path: string | null
          source_provider: string | null
          source_size: number
          source_version: string | null
          status: Database["public"]["Enums"]["checkout_status"]
          synology_upload_user: string | null
          updated_at: string
          upload_method: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          checked_in_at?: string | null
          checked_out_at?: string
          checkin_hash?: string | null
          checkin_size?: number | null
          created_at?: string
          device_id?: string | null
          error_message?: string | null
          id?: string
          last_helper_heartbeat_at?: string | null
          seafile_library_id?: string | null
          seafile_path?: string | null
          source_hash: string
          source_local_path?: string | null
          source_provider?: string | null
          source_size: number
          source_version?: string | null
          status?: Database["public"]["Enums"]["checkout_status"]
          synology_upload_user?: string | null
          updated_at?: string
          upload_method?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          checked_in_at?: string | null
          checked_out_at?: string
          checkin_hash?: string | null
          checkin_size?: number | null
          created_at?: string
          device_id?: string | null
          error_message?: string | null
          id?: string
          last_helper_heartbeat_at?: string | null
          seafile_library_id?: string | null
          seafile_path?: string | null
          source_hash?: string
          source_local_path?: string | null
          source_provider?: string | null
          source_size?: number
          source_version?: string | null
          status?: Database["public"]["Enums"]["checkout_status"]
          synology_upload_user?: string | null
          updated_at?: string
          upload_method?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_checkouts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checkouts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "helper_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_path_history: {
        Row: {
          asset_id: string
          detected_at: string
          id: string
          new_relative_path: string
          old_relative_path: string
        }
        Insert: {
          asset_id: string
          detected_at?: string
          id?: string
          new_relative_path: string
          old_relative_path: string
        }
        Update: {
          asset_id?: string
          detected_at?: string
          id?: string
          new_relative_path?: string
          old_relative_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_path_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_tags: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          source: string
          tag: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          source?: string
          tag: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          source?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_tags_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          ai_description: string | null
          ai_model: string | null
          ai_tagged_at: string | null
          art_source: Database["public"]["Enums"]["art_source"] | null
          artboards: number | null
          asset_type: Database["public"]["Enums"]["asset_type"] | null
          big_theme: string | null
          cover_description: string | null
          created_at: string
          design_ref: string | null
          design_style: string | null
          designer_name: string | null
          division_code: string | null
          division_name: string | null
          file_created_at: string | null
          file_size: number | null
          file_type: Database["public"]["Enums"]["file_type"]
          filename: string
          freelancer_name: string | null
          height: number | null
          id: string
          ingested_at: string | null
          is_deleted: boolean | null
          is_licensed: boolean | null
          last_scanned_at: string | null
          last_seen_at: string
          licensor_code: string | null
          licensor_id: string | null
          licensor_name: string | null
          little_theme: string | null
          mg01_code: string | null
          mg01_name: string | null
          mg02_code: string | null
          mg02_name: string | null
          mg03_code: string | null
          mg03_name: string | null
          modified_at: string
          pdf_page2_url: string | null
          primary_sort_tier: number
          product_category: string | null
          product_subtype_id: string | null
          property_code: string | null
          property_id: string | null
          property_name: string | null
          quick_hash: string
          quick_hash_version: number
          relative_path: string
          scene_description: string | null
          size_code: string | null
          size_name: string | null
          sku: string | null
          sku_sequence: string | null
          status: Database["public"]["Enums"]["asset_status"] | null
          style_group_id: string | null
          tags: string[]
          technical_designer_name: string | null
          thumbnail_error: string | null
          thumbnail_url: string | null
          updated_at: string | null
          width: number | null
          workflow_status: Database["public"]["Enums"]["workflow_status"] | null
        }
        Insert: {
          ai_description?: string | null
          ai_model?: string | null
          ai_tagged_at?: string | null
          art_source?: Database["public"]["Enums"]["art_source"] | null
          artboards?: number | null
          asset_type?: Database["public"]["Enums"]["asset_type"] | null
          big_theme?: string | null
          cover_description?: string | null
          created_at?: string
          design_ref?: string | null
          design_style?: string | null
          designer_name?: string | null
          division_code?: string | null
          division_name?: string | null
          file_created_at?: string | null
          file_size?: number | null
          file_type: Database["public"]["Enums"]["file_type"]
          filename: string
          freelancer_name?: string | null
          height?: number | null
          id?: string
          ingested_at?: string | null
          is_deleted?: boolean | null
          is_licensed?: boolean | null
          last_scanned_at?: string | null
          last_seen_at?: string
          licensor_code?: string | null
          licensor_id?: string | null
          licensor_name?: string | null
          little_theme?: string | null
          mg01_code?: string | null
          mg01_name?: string | null
          mg02_code?: string | null
          mg02_name?: string | null
          mg03_code?: string | null
          mg03_name?: string | null
          modified_at: string
          pdf_page2_url?: string | null
          primary_sort_tier?: number
          product_category?: string | null
          product_subtype_id?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          quick_hash: string
          quick_hash_version?: number
          relative_path: string
          scene_description?: string | null
          size_code?: string | null
          size_name?: string | null
          sku?: string | null
          sku_sequence?: string | null
          status?: Database["public"]["Enums"]["asset_status"] | null
          style_group_id?: string | null
          tags?: string[]
          technical_designer_name?: string | null
          thumbnail_error?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          width?: number | null
          workflow_status?:
            | Database["public"]["Enums"]["workflow_status"]
            | null
        }
        Update: {
          ai_description?: string | null
          ai_model?: string | null
          ai_tagged_at?: string | null
          art_source?: Database["public"]["Enums"]["art_source"] | null
          artboards?: number | null
          asset_type?: Database["public"]["Enums"]["asset_type"] | null
          big_theme?: string | null
          cover_description?: string | null
          created_at?: string
          design_ref?: string | null
          design_style?: string | null
          designer_name?: string | null
          division_code?: string | null
          division_name?: string | null
          file_created_at?: string | null
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["file_type"]
          filename?: string
          freelancer_name?: string | null
          height?: number | null
          id?: string
          ingested_at?: string | null
          is_deleted?: boolean | null
          is_licensed?: boolean | null
          last_scanned_at?: string | null
          last_seen_at?: string
          licensor_code?: string | null
          licensor_id?: string | null
          licensor_name?: string | null
          little_theme?: string | null
          mg01_code?: string | null
          mg01_name?: string | null
          mg02_code?: string | null
          mg02_name?: string | null
          mg03_code?: string | null
          mg03_name?: string | null
          modified_at?: string
          pdf_page2_url?: string | null
          primary_sort_tier?: number
          product_category?: string | null
          product_subtype_id?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          quick_hash?: string
          quick_hash_version?: number
          relative_path?: string
          scene_description?: string | null
          size_code?: string | null
          size_name?: string | null
          sku?: string | null
          sku_sequence?: string | null
          status?: Database["public"]["Enums"]["asset_status"] | null
          style_group_id?: string | null
          tags?: string[]
          technical_designer_name?: string | null
          thumbnail_error?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          width?: number | null
          workflow_status?:
            | Database["public"]["Enums"]["workflow_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_licensor_id_fkey"
            columns: ["licensor_id"]
            isOneToOne: false
            referencedRelation: "licensors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_product_subtype_id_fkey"
            columns: ["product_subtype_id"]
            isOneToOne: false
            referencedRelation: "product_subtypes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_style_group_id_fkey"
            columns: ["style_group_id"]
            isOneToOne: false
            referencedRelation: "style_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          is_priority: boolean
          name: string
          property_id: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          is_priority?: boolean
          name: string
          property_id: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          is_priority?: boolean
          name?: string
          property_id?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "characters_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_enrichment_log: {
        Row: {
          applied_at: string
          confidence: number | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          run_id: string | null
          source: string
          target_id: string
          target_type: string
        }
        Insert: {
          applied_at?: string
          confidence?: number | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          run_id?: string | null
          source: string
          target_id: string
          target_type: string
        }
        Update: {
          applied_at?: string
          confidence?: number | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          run_id?: string | null
          source?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      erp_items_current: {
        Row: {
          created_at: string
          dismissed: boolean
          division_code: string | null
          erp_updated_at: string | null
          external_id: string
          id: string
          item_description: string | null
          licensor_code: string | null
          mg_category: string | null
          mg01_code: string | null
          mg02_code: string | null
          mg03_code: string | null
          mg04_code: string | null
          mg05_code: string | null
          mg06_code: string | null
          prepack_code: string | null
          prepack_codes: Json | null
          property_code: string | null
          raw_mg_fields: Json | null
          size_code: string | null
          source_system: string
          style_number: string | null
          sync_run_id: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dismissed?: boolean
          division_code?: string | null
          erp_updated_at?: string | null
          external_id: string
          id?: string
          item_description?: string | null
          licensor_code?: string | null
          mg_category?: string | null
          mg01_code?: string | null
          mg02_code?: string | null
          mg03_code?: string | null
          mg04_code?: string | null
          mg05_code?: string | null
          mg06_code?: string | null
          prepack_code?: string | null
          prepack_codes?: Json | null
          property_code?: string | null
          raw_mg_fields?: Json | null
          size_code?: string | null
          source_system?: string
          style_number?: string | null
          sync_run_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dismissed?: boolean
          division_code?: string | null
          erp_updated_at?: string | null
          external_id?: string
          id?: string
          item_description?: string | null
          licensor_code?: string | null
          mg_category?: string | null
          mg01_code?: string | null
          mg02_code?: string | null
          mg03_code?: string | null
          mg04_code?: string | null
          mg05_code?: string | null
          mg06_code?: string | null
          prepack_code?: string | null
          prepack_codes?: Json | null
          property_code?: string | null
          raw_mg_fields?: Json | null
          size_code?: string | null
          source_system?: string
          style_number?: string | null
          sync_run_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_items_current_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "erp_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_items_raw: {
        Row: {
          external_id: string
          fetched_at: string
          id: string
          raw_payload: Json
          sync_run_id: string | null
        }
        Insert: {
          external_id: string
          fetched_at?: string
          id?: string
          raw_payload: Json
          sync_run_id?: string | null
        }
        Update: {
          external_id?: string
          fetched_at?: string
          id?: string
          raw_payload?: Json
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_items_raw_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "erp_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_sync_runs: {
        Row: {
          created_by: string | null
          ended_at: string | null
          error_samples: Json | null
          id: string
          run_metadata: Json | null
          started_at: string
          status: string
          total_errors: number | null
          total_fetched: number | null
          total_upserted: number | null
        }
        Insert: {
          created_by?: string | null
          ended_at?: string | null
          error_samples?: Json | null
          id?: string
          run_metadata?: Json | null
          started_at?: string
          status?: string
          total_errors?: number | null
          total_fetched?: number | null
          total_upserted?: number | null
        }
        Update: {
          created_by?: string | null
          ended_at?: string | null
          error_samples?: Json | null
          id?: string
          run_metadata?: Json | null
          started_at?: string
          status?: string
          total_errors?: number | null
          total_fetched?: number | null
          total_upserted?: number | null
        }
        Relationships: []
      }
      helper_devices: {
        Row: {
          device_name: string
          device_os: string
          helper_version: string
          id: string
          last_seen_at: string
          registered_at: string
          user_id: string
        }
        Insert: {
          device_name: string
          device_os: string
          helper_version: string
          id?: string
          last_seen_at?: string
          registered_at?: string
          user_id: string
        }
        Update: {
          device_name?: string
          device_os?: string
          helper_version?: string
          id?: string
          last_seen_at?: string
          registered_at?: string
          user_id?: string
        }
        Relationships: []
      }
      helper_tokens: {
        Row: {
          action: string
          asset_id: string | null
          checkout_id: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          asset_id?: string | null
          checkout_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id: string
          user_id: string
        }
        Update: {
          action?: string
          asset_id?: string | null
          checkout_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "helper_tokens_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helper_tokens_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "asset_checkouts"
            referencedColumns: ["id"]
          },
        ]
      }
      hygiene_findings: {
        Row: {
          asset_id: string | null
          check_type: string
          created_at: string
          details: Json
          filename: string
          found_at: string
          found_by_agent: string | null
          id: string
          relative_path: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scan_session_id: string | null
          severity: string
          status: string
        }
        Insert: {
          asset_id?: string | null
          check_type: string
          created_at?: string
          details?: Json
          filename: string
          found_at?: string
          found_by_agent?: string | null
          id?: string
          relative_path: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_session_id?: string | null
          severity?: string
          status?: string
        }
        Update: {
          asset_id?: string | null
          check_type?: string
          created_at?: string
          details?: Json
          filename?: string
          found_at?: string
          found_by_agent?: string | null
          id?: string
          relative_path?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_session_id?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hygiene_findings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          apps: Database["public"]["Enums"]["app_name"][]
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Insert: {
          accepted_at?: string | null
          apps?: Database["public"]["Enums"]["app_name"][]
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Update: {
          accepted_at?: string | null
          apps?: Database["public"]["Enums"]["app_name"][]
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: []
      }
      licensors: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      part_config: {
        Row: {
          async_partitioning_in_progress: string | null
          automatic_maintenance: string
          constraint_cols: string[] | null
          constraint_valid: boolean
          control: string
          date_trunc_interval: string | null
          datetime_string: string | null
          epoch: string
          ignore_default_data: boolean
          infinite_time_partitions: boolean
          inherit_privileges: boolean | null
          jobmon: boolean
          maintenance_last_run: string | null
          maintenance_order: number | null
          optimize_constraint: number
          parent_table: string
          partition_interval: string
          partition_type: string
          premake: number
          retention: string | null
          retention_keep_index: boolean
          retention_keep_publication: boolean
          retention_keep_table: boolean
          retention_schema: string | null
          sub_partition_set_full: boolean
          template_table: string | null
          time_decoder: string | null
          time_encoder: string | null
          undo_in_progress: boolean
        }
        Insert: {
          async_partitioning_in_progress?: string | null
          automatic_maintenance?: string
          constraint_cols?: string[] | null
          constraint_valid?: boolean
          control: string
          date_trunc_interval?: string | null
          datetime_string?: string | null
          epoch?: string
          ignore_default_data?: boolean
          infinite_time_partitions?: boolean
          inherit_privileges?: boolean | null
          jobmon?: boolean
          maintenance_last_run?: string | null
          maintenance_order?: number | null
          optimize_constraint?: number
          parent_table: string
          partition_interval: string
          partition_type: string
          premake?: number
          retention?: string | null
          retention_keep_index?: boolean
          retention_keep_publication?: boolean
          retention_keep_table?: boolean
          retention_schema?: string | null
          sub_partition_set_full?: boolean
          template_table?: string | null
          time_decoder?: string | null
          time_encoder?: string | null
          undo_in_progress?: boolean
        }
        Update: {
          async_partitioning_in_progress?: string | null
          automatic_maintenance?: string
          constraint_cols?: string[] | null
          constraint_valid?: boolean
          control?: string
          date_trunc_interval?: string | null
          datetime_string?: string | null
          epoch?: string
          ignore_default_data?: boolean
          infinite_time_partitions?: boolean
          inherit_privileges?: boolean | null
          jobmon?: boolean
          maintenance_last_run?: string | null
          maintenance_order?: number | null
          optimize_constraint?: number
          parent_table?: string
          partition_interval?: string
          partition_type?: string
          premake?: number
          retention?: string | null
          retention_keep_index?: boolean
          retention_keep_publication?: boolean
          retention_keep_table?: boolean
          retention_schema?: string | null
          sub_partition_set_full?: boolean
          template_table?: string | null
          time_decoder?: string | null
          time_encoder?: string | null
          undo_in_progress?: boolean
        }
        Relationships: []
      }
      part_config_sub: {
        Row: {
          sub_automatic_maintenance: string
          sub_constraint_cols: string[] | null
          sub_constraint_valid: boolean
          sub_control: string
          sub_control_not_null: boolean | null
          sub_date_trunc_interval: string | null
          sub_default_table: boolean | null
          sub_epoch: string
          sub_ignore_default_data: boolean
          sub_infinite_time_partitions: boolean
          sub_inherit_privileges: boolean | null
          sub_jobmon: boolean
          sub_maintenance_order: number | null
          sub_optimize_constraint: number
          sub_parent: string
          sub_partition_interval: string
          sub_partition_type: string
          sub_premake: number
          sub_retention: string | null
          sub_retention_keep_index: boolean
          sub_retention_keep_publication: boolean
          sub_retention_keep_table: boolean
          sub_retention_schema: string | null
          sub_template_table: string | null
          sub_time_decoder: string | null
          sub_time_encoder: string | null
        }
        Insert: {
          sub_automatic_maintenance?: string
          sub_constraint_cols?: string[] | null
          sub_constraint_valid?: boolean
          sub_control: string
          sub_control_not_null?: boolean | null
          sub_date_trunc_interval?: string | null
          sub_default_table?: boolean | null
          sub_epoch?: string
          sub_ignore_default_data?: boolean
          sub_infinite_time_partitions?: boolean
          sub_inherit_privileges?: boolean | null
          sub_jobmon?: boolean
          sub_maintenance_order?: number | null
          sub_optimize_constraint?: number
          sub_parent: string
          sub_partition_interval: string
          sub_partition_type: string
          sub_premake?: number
          sub_retention?: string | null
          sub_retention_keep_index?: boolean
          sub_retention_keep_publication?: boolean
          sub_retention_keep_table?: boolean
          sub_retention_schema?: string | null
          sub_template_table?: string | null
          sub_time_decoder?: string | null
          sub_time_encoder?: string | null
        }
        Update: {
          sub_automatic_maintenance?: string
          sub_constraint_cols?: string[] | null
          sub_constraint_valid?: boolean
          sub_control?: string
          sub_control_not_null?: boolean | null
          sub_date_trunc_interval?: string | null
          sub_default_table?: boolean | null
          sub_epoch?: string
          sub_ignore_default_data?: boolean
          sub_infinite_time_partitions?: boolean
          sub_inherit_privileges?: boolean | null
          sub_jobmon?: boolean
          sub_maintenance_order?: number | null
          sub_optimize_constraint?: number
          sub_parent?: string
          sub_partition_interval?: string
          sub_partition_type?: string
          sub_premake?: number
          sub_retention?: string | null
          sub_retention_keep_index?: boolean
          sub_retention_keep_publication?: boolean
          sub_retention_keep_table?: boolean
          sub_retention_schema?: string | null
          sub_template_table?: string | null
          sub_time_decoder?: string | null
          sub_time_encoder?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_config_sub_sub_parent_fkey"
            columns: ["sub_parent"]
            isOneToOne: true
            referencedRelation: "part_config"
            referencedColumns: ["parent_table"]
          },
        ]
      }
      pdf_text_samples: {
        Row: {
          asset_id: string | null
          char_count: number
          extracted_text: string | null
          extraction_error: string | null
          extraction_method: string
          filename: string
          id: string
          page_count: number | null
          relative_path: string
          sampled_at: string
          thumbnail_url: string | null
        }
        Insert: {
          asset_id?: string | null
          char_count?: number
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_method: string
          filename: string
          id?: string
          page_count?: number | null
          relative_path: string
          sampled_at?: string
          thumbnail_url?: string | null
        }
        Update: {
          asset_id?: string | null
          char_count?: number
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_method?: string
          filename?: string
          id?: string
          page_count?: number | null
          relative_path?: string
          sampled_at?: string
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_text_samples_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_queue: {
        Row: {
          agent_id: string | null
          asset_id: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: string
          status: Database["public"]["Enums"]["queue_status"] | null
        }
        Insert: {
          agent_id?: string | null
          asset_id: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: string
          status?: Database["public"]["Enums"]["queue_status"] | null
        }
        Update: {
          agent_id?: string | null
          asset_id?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: string
          status?: Database["public"]["Enums"]["queue_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_category_predictions: {
        Row: {
          ai_model: string | null
          ai_prompt_version: string | null
          classification_source: string
          confidence: number
          created_at: string
          erp_item_id: string | null
          external_id: string
          id: string
          input_context: Json | null
          predicted_category: string
          rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          ai_model?: string | null
          ai_prompt_version?: string | null
          classification_source?: string
          confidence: number
          created_at?: string
          erp_item_id?: string | null
          external_id: string
          id?: string
          input_context?: Json | null
          predicted_category: string
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          ai_model?: string | null
          ai_prompt_version?: string | null
          classification_source?: string
          confidence?: number
          created_at?: string
          erp_item_id?: string | null
          external_id?: string
          id?: string
          input_context?: Json | null
          predicted_category?: string
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_category_predictions_erp_item_id_fkey"
            columns: ["erp_item_id"]
            isOneToOne: false
            referencedRelation: "erp_items_current"
            referencedColumns: ["id"]
          },
        ]
      }
      product_subtypes: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          name: string
          type_id: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
          type_id: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_subtypes_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      product_types: {
        Row: {
          category_id: string
          created_at: string
          external_id: string | null
          id: string
          name: string
        }
        Insert: {
          category_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          name: string
        }
        Update: {
          category_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_types_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          licensor_id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          licensor_id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          licensor_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_licensor_id_fkey"
            columns: ["licensor_id"]
            isOneToOne: false
            referencedRelation: "licensors"
            referencedColumns: ["id"]
          },
        ]
      }
      render_queue: {
        Row: {
          asset_id: string
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          lease_expires_at: string | null
          status: Database["public"]["Enums"]["queue_status"] | null
        }
        Insert: {
          asset_id: string
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"] | null
        }
        Update: {
          asset_id?: string
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "render_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      scanner_ai_ignores: {
        Row: {
          created_at: string | null
          id: string
          reason: string
          relative_path: string
          snoozed_until: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          reason: string
          relative_path: string
          snoozed_until?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          reason?: string
          relative_path?: string
          snoozed_until?: string | null
        }
        Relationships: []
      }
      sku_files_used: {
        Row: {
          created_at: string
          file_name: string
          id: string
          sku: string
          style_guide_file_id: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          sku: string
          style_guide_file_id?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          sku?: string
          style_guide_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sku_files_used_style_guide_file_id_fkey"
            columns: ["style_guide_file_id"]
            isOneToOne: false
            referencedRelation: "style_guide_files"
            referencedColumns: ["id"]
          },
        ]
      }
      style_groups: {
        Row: {
          asset_count: number | null
          cover_description: string | null
          created_at: string | null
          designer_conflict: boolean
          designer_name: string | null
          division_code: string | null
          division_name: string | null
          folder_path: string
          freelancer_name: string | null
          id: string
          is_licensed: boolean | null
          latest_file_date: string | null
          licensor_code: string | null
          licensor_id: string | null
          licensor_name: string | null
          mg01_code: string | null
          mg01_name: string | null
          mg02_code: string | null
          mg02_name: string | null
          mg03_code: string | null
          mg03_name: string | null
          primary_asset_id: string | null
          primary_asset_type: string | null
          primary_thumbnail_error: string | null
          primary_thumbnail_url: string | null
          product_category: string | null
          property_code: string | null
          property_id: string | null
          property_name: string | null
          size_code: string | null
          size_name: string | null
          sku: string
          technical_designer_name: string | null
          updated_at: string | null
          workflow_status: Database["public"]["Enums"]["workflow_status"] | null
        }
        Insert: {
          asset_count?: number | null
          cover_description?: string | null
          created_at?: string | null
          designer_conflict?: boolean
          designer_name?: string | null
          division_code?: string | null
          division_name?: string | null
          folder_path: string
          freelancer_name?: string | null
          id?: string
          is_licensed?: boolean | null
          latest_file_date?: string | null
          licensor_code?: string | null
          licensor_id?: string | null
          licensor_name?: string | null
          mg01_code?: string | null
          mg01_name?: string | null
          mg02_code?: string | null
          mg02_name?: string | null
          mg03_code?: string | null
          mg03_name?: string | null
          primary_asset_id?: string | null
          primary_asset_type?: string | null
          primary_thumbnail_error?: string | null
          primary_thumbnail_url?: string | null
          product_category?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          size_code?: string | null
          size_name?: string | null
          sku: string
          technical_designer_name?: string | null
          updated_at?: string | null
          workflow_status?:
            | Database["public"]["Enums"]["workflow_status"]
            | null
        }
        Update: {
          asset_count?: number | null
          cover_description?: string | null
          created_at?: string | null
          designer_conflict?: boolean
          designer_name?: string | null
          division_code?: string | null
          division_name?: string | null
          folder_path?: string
          freelancer_name?: string | null
          id?: string
          is_licensed?: boolean | null
          latest_file_date?: string | null
          licensor_code?: string | null
          licensor_id?: string | null
          licensor_name?: string | null
          mg01_code?: string | null
          mg01_name?: string | null
          mg02_code?: string | null
          mg02_name?: string | null
          mg03_code?: string | null
          mg03_name?: string | null
          primary_asset_id?: string | null
          primary_asset_type?: string | null
          primary_thumbnail_error?: string | null
          primary_thumbnail_url?: string | null
          product_category?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          size_code?: string | null
          size_name?: string | null
          sku?: string
          technical_designer_name?: string | null
          updated_at?: string | null
          workflow_status?:
            | Database["public"]["Enums"]["workflow_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "style_groups_licensor_id_fkey"
            columns: ["licensor_id"]
            isOneToOne: false
            referencedRelation: "licensors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "style_groups_primary_asset_id_fkey"
            columns: ["primary_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "style_groups_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      style_guide_crawl_runs: {
        Row: {
          agent_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          files_found: number | null
          id: string
          inaccessible_roots: string[] | null
          roots_scanned: string[] | null
          started_at: string | null
          status: string
        }
        Insert: {
          agent_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          files_found?: number | null
          id?: string
          inaccessible_roots?: string[] | null
          roots_scanned?: string[] | null
          started_at?: string | null
          status?: string
        }
        Update: {
          agent_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          files_found?: number | null
          id?: string
          inaccessible_roots?: string[] | null
          roots_scanned?: string[] | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      style_guide_files: {
        Row: {
          basename_no_ext: string
          crawl_run_id: string | null
          created_at: string
          directory_path: string
          file_extension: string | null
          filename: string
          id: string
          is_active: boolean
          last_seen_at: string
          licensor_name: string | null
          modified_at: string | null
          normalized_name: string
          normalized_style_guide_folder: string | null
          property_folder: string | null
          relative_path: string
          root_label: string
          size_bytes: number | null
          style_guide_folder: string | null
          thumbnail_error: string | null
          thumbnail_url: string | null
        }
        Insert: {
          basename_no_ext: string
          crawl_run_id?: string | null
          created_at?: string
          directory_path: string
          file_extension?: string | null
          filename: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          licensor_name?: string | null
          modified_at?: string | null
          normalized_name: string
          normalized_style_guide_folder?: string | null
          property_folder?: string | null
          relative_path: string
          root_label: string
          size_bytes?: number | null
          style_guide_folder?: string | null
          thumbnail_error?: string | null
          thumbnail_url?: string | null
        }
        Update: {
          basename_no_ext?: string
          crawl_run_id?: string | null
          created_at?: string
          directory_path?: string
          file_extension?: string | null
          filename?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          licensor_name?: string | null
          modified_at?: string | null
          normalized_name?: string
          normalized_style_guide_folder?: string | null
          property_folder?: string | null
          relative_path?: string
          root_label?: string
          size_bytes?: number | null
          style_guide_folder?: string | null
          thumbnail_error?: string | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "style_guide_files_crawl_run_id_fkey"
            columns: ["crawl_run_id"]
            isOneToOne: false
            referencedRelation: "style_guide_crawl_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      style_guide_render_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          lease_expires_at: string | null
          status: Database["public"]["Enums"]["queue_status"]
          style_guide_file_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          style_guide_file_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lease_expires_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          style_guide_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "style_guide_render_queue_style_guide_file_id_fkey"
            columns: ["style_guide_file_id"]
            isOneToOne: false
            referencedRelation: "style_guide_files"
            referencedColumns: ["id"]
          },
        ]
      }
      template_public_smon_container_status: {
        Row: {
          container_id: string
          container_name: string
          cpu_percent: number | null
          id: string
          image: string
          memory_bytes: number | null
          memory_limit_bytes: number | null
          nas_id: string
          recorded_at: string
          status: string
          uptime_seconds: number | null
        }
        Insert: {
          container_id: string
          container_name: string
          cpu_percent?: number | null
          id: string
          image: string
          memory_bytes?: number | null
          memory_limit_bytes?: number | null
          nas_id: string
          recorded_at: string
          status: string
          uptime_seconds?: number | null
        }
        Update: {
          container_id?: string
          container_name?: string
          cpu_percent?: number | null
          id?: string
          image?: string
          memory_bytes?: number | null
          memory_limit_bytes?: number | null
          nas_id?: string
          recorded_at?: string
          status?: string
          uptime_seconds?: number | null
        }
        Relationships: []
      }
      template_public_smon_logs: {
        Row: {
          id: string
          ingested_at: string
          logged_at: string
          message: string
          metadata: Json | null
          nas_id: string
          severity: string
          source: string
        }
        Insert: {
          id: string
          ingested_at: string
          logged_at: string
          message: string
          metadata?: Json | null
          nas_id: string
          severity: string
          source: string
        }
        Update: {
          id?: string
          ingested_at?: string
          logged_at?: string
          message?: string
          metadata?: Json | null
          nas_id?: string
          severity?: string
          source?: string
        }
        Relationships: []
      }
      template_public_smon_metrics: {
        Row: {
          id: string
          metadata: Json | null
          nas_id: string
          recorded_at: string
          type: string
          unit: string
          value: number
        }
        Insert: {
          id: string
          metadata?: Json | null
          nas_id: string
          recorded_at: string
          type: string
          unit: string
          value: number
        }
        Update: {
          id?: string
          metadata?: Json | null
          nas_id?: string
          recorded_at?: string
          type?: string
          unit?: string
          value?: number
        }
        Relationships: []
      }
      template_public_smon_storage_snapshots: {
        Row: {
          disks: Json
          id: string
          nas_id: string
          raid_type: string | null
          recorded_at: string
          status: string
          total_bytes: number
          used_bytes: number
          volume_id: string
          volume_path: string
        }
        Insert: {
          disks: Json
          id: string
          nas_id: string
          raid_type?: string | null
          recorded_at: string
          status: string
          total_bytes: number
          used_bytes: number
          volume_id: string
          volume_path: string
        }
        Update: {
          disks?: Json
          id?: string
          nas_id?: string
          raid_type?: string | null
          recorded_at?: string
          status?: string
          total_bytes?: number
          used_bytes?: number
          volume_id?: string
          volume_path?: string
        }
        Relationships: []
      }
      tiff_optimization_queue: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          compression_type: string | null
          created_at: string
          error_message: string | null
          file_created_at: string | null
          file_modified_at: string
          file_size: number
          filename: string
          id: string
          mode: string | null
          new_file_created_at: string | null
          new_file_modified_at: string | null
          new_file_size: number | null
          new_filename: string | null
          original_backed_up: boolean | null
          original_deleted: boolean | null
          processed_at: string | null
          relative_path: string
          scan_session_id: string | null
          status: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          compression_type?: string | null
          created_at?: string
          error_message?: string | null
          file_created_at?: string | null
          file_modified_at: string
          file_size: number
          filename: string
          id?: string
          mode?: string | null
          new_file_created_at?: string | null
          new_file_modified_at?: string | null
          new_file_size?: number | null
          new_filename?: string | null
          original_backed_up?: boolean | null
          original_deleted?: boolean | null
          processed_at?: string | null
          relative_path: string
          scan_session_id?: string | null
          status?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          compression_type?: string | null
          created_at?: string
          error_message?: string | null
          file_created_at?: string | null
          file_modified_at?: string
          file_size?: number
          filename?: string
          id?: string
          mode?: string | null
          new_file_created_at?: string | null
          new_file_modified_at?: string | null
          new_file_size?: number | null
          new_filename?: string | null
          original_backed_up?: boolean | null
          original_deleted?: boolean | null
          processed_at?: string | null
          relative_path?: string
          scan_session_id?: string | null
          status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      style_guide_folders: {
        Row: {
          licensor_name: string | null
          property_folder: string | null
        }
        Relationships: []
      }
      table_privs: {
        Row: {
          grantee: unknown
          grantor: unknown
          privilege_type: string | null
          table_name: unknown
          table_schema: unknown
        }
        Relationships: []
      }
    }
    Functions: {
      apply_cluster: {
        Args: {
          p_child_schema: string
          p_child_tablename: string
          p_parent_schema: string
          p_parent_tablename: string
        }
        Returns: undefined
      }
      apply_constraints: {
        Args: {
          p_analyze?: boolean
          p_child_table?: string
          p_job_id?: number
          p_parent_table: string
        }
        Returns: undefined
      }
      apply_privileges: {
        Args: {
          p_child_schema: string
          p_child_tablename: string
          p_job_id?: number
          p_parent_schema: string
          p_parent_tablename: string
        }
        Returns: undefined
      }
      autovacuum_off: {
        Args: {
          p_parent_schema: string
          p_parent_tablename: string
          p_source_schema?: string
          p_source_tablename?: string
        }
        Returns: boolean
      }
      autovacuum_reset: {
        Args: {
          p_parent_schema: string
          p_parent_tablename: string
          p_source_schema?: string
          p_source_tablename?: string
        }
        Returns: boolean
      }
      backfill_pdf_files_used: { Args: never; Returns: number }
      bulk_assign_style_groups: {
        Args: { p_assignments: Json }
        Returns: number
      }
      bulk_insert_pdf_text_samples: { Args: { p_rows: Json }; Returns: number }
      calculate_time_partition_info: {
        Args: {
          p_date_trunc_interval?: string
          p_start_time: string
          p_time_interval: string
        }
        Returns: Record<string, unknown>
      }
      check_automatic_maintenance_value: {
        Args: { p_automatic_maintenance: string }
        Returns: boolean
      }
      check_control_type: {
        Args: {
          p_control: string
          p_parent_schema: string
          p_parent_tablename: string
        }
        Returns: {
          exact_type: string
          general_type: string
        }[]
      }
      check_default: {
        Args: { p_exact_count?: boolean }
        Returns: Database["public"]["CompositeTypes"]["check_default_table"][]
        SetofOptions: {
          from: "*"
          to: "check_default_table"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      check_epoch_type: { Args: { p_type: string }; Returns: boolean }
      check_name_length: {
        Args: {
          p_object_name: string
          p_suffix?: string
          p_table_partition?: boolean
        }
        Returns: string
      }
      check_partition_type: { Args: { p_type: string }; Returns: boolean }
      check_subpart_sameconfig: {
        Args: { p_parent_table: string }
        Returns: {
          sub_automatic_maintenance: string
          sub_constraint_cols: string[]
          sub_constraint_valid: boolean
          sub_control: string
          sub_control_not_null: boolean
          sub_date_trunc_interval: string
          sub_default_table: boolean
          sub_epoch: string
          sub_ignore_default_data: boolean
          sub_infinite_time_partitions: boolean
          sub_inherit_privileges: boolean
          sub_jobmon: boolean
          sub_maintenance_order: number
          sub_optimize_constraint: number
          sub_partition_interval: string
          sub_partition_type: string
          sub_premake: number
          sub_retention: string
          sub_retention_keep_index: boolean
          sub_retention_keep_publication: boolean
          sub_retention_keep_table: boolean
          sub_retention_schema: string
          sub_template_table: string
        }[]
      }
      check_subpartition_limits: {
        Args: { p_parent_table: string; p_type: string }
        Returns: Record<string, unknown>
      }
      claim_jobs: {
        Args: { p_agent_id: string; p_batch_size?: number }
        Returns: {
          agent_id: string | null
          asset_id: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: string
          status: Database["public"]["Enums"]["queue_status"] | null
        }[]
        SetofOptions: {
          from: "*"
          to: "processing_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pdf_backfill_batch: {
        Args: { p_limit?: number }
        Returns: {
          filename: string
          id: string
          needs_thumbnail: boolean
          relative_path: string
        }[]
      }
      claim_render_jobs: {
        Args: {
          p_agent_id: string
          p_batch_size?: number
          p_lease_minutes?: number
          p_max_attempts?: number
        }
        Returns: {
          asset_id: string
          attempts: number
          id: string
          lease_expires_at: string
        }[]
      }
      claim_sg_render_jobs: {
        Args: {
          p_agent_id: string
          p_batch_size?: number
          p_lease_minutes?: number
          p_max_attempts?: number
        }
        Returns: {
          attempts: number
          id: string
          lease_expires_at: string
          style_guide_file_id: string
        }[]
      }
      claim_tiff_jobs: {
        Args: {
          p_agent_id: string
          p_batch_size?: number
          p_lease_minutes?: number
        }
        Returns: {
          file_created_at: string
          file_modified_at: string
          file_size: number
          filename: string
          id: string
          mode: string
          relative_path: string
        }[]
      }
      cleanup_mega_group_tags_batch:
        | { Args: never; Returns: number }
        | {
            Args: {
              p_batch_size?: number
              p_cursor?: string
              p_min_group_size?: number
            }
            Returns: {
              characters_deleted: number
              done: boolean
              groups_processed: number
              metadata_cleared: number
              next_cursor: string
              tags_deleted: number
            }[]
          }
      clear_style_group_batch: {
        Args: { p_batch_size?: number; p_last_id?: string }
        Returns: {
          cleared_count: number
          has_more: boolean
          last_id: string
        }[]
      }
      count_pdf_backfill_remaining: { Args: never; Returns: number }
      create_parent: {
        Args: {
          p_automatic_maintenance?: string
          p_constraint_cols?: string[]
          p_control: string
          p_control_not_null?: boolean
          p_date_trunc_interval?: string
          p_default_table?: boolean
          p_epoch?: string
          p_interval: string
          p_jobmon?: boolean
          p_offset_id?: number
          p_parent_table: string
          p_premake?: number
          p_start_partition?: string
          p_template_table?: string
          p_time_decoder?: string
          p_time_encoder?: string
          p_type?: string
        }
        Returns: boolean
      }
      create_partition_id: {
        Args: {
          p_parent_table: string
          p_partition_ids: number[]
          p_start_partition?: string
        }
        Returns: boolean
      }
      create_partition_time: {
        Args: {
          p_parent_table: string
          p_partition_times: string[]
          p_start_partition?: string
        }
        Returns: boolean
      }
      create_sub_parent: {
        Args: {
          p_constraint_cols?: string[]
          p_control: string
          p_control_not_null?: boolean
          p_date_trunc_interval?: string
          p_declarative_check?: string
          p_default_table?: boolean
          p_epoch?: string
          p_interval: string
          p_jobmon?: boolean
          p_premake?: number
          p_start_partition?: string
          p_time_decoder?: string
          p_time_encoder?: string
          p_top_parent: string
          p_type?: string
        }
        Returns: boolean
      }
      deactivate_stale_sg_files: {
        Args: { p_root_label: string; p_run_id: string }
        Returns: number
      }
      drop_constraints: {
        Args: {
          p_child_table: string
          p_debug?: boolean
          p_parent_table: string
        }
        Returns: undefined
      }
      drop_partition_id: {
        Args: {
          p_keep_index?: boolean
          p_keep_table?: boolean
          p_parent_table: string
          p_retention?: number
          p_retention_schema?: string
        }
        Returns: number
      }
      drop_partition_time: {
        Args: {
          p_keep_index?: boolean
          p_keep_table?: boolean
          p_parent_table: string
          p_reference_timestamp?: string
          p_retention?: string
          p_retention_schema?: string
        }
        Returns: number
      }
      dump_partitioned_table_definition: {
        Args: { p_ignore_template_table?: boolean; p_parent_table: string }
        Returns: string
      }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      find_ai_pdf_duplicates: {
        Args: never
        Returns: {
          filename: string
          id: string
          relative_path: string
          style_group_id: string
          thumbnail_url: string
        }[]
      }
      get_ai_sentinel_stats: { Args: never; Returns: Json }
      get_filter_counts: { Args: { p_filters?: Json }; Returns: Json }
      get_sg_preview_stats: { Args: never; Returns: Json }
      get_sg_render_queue_stats: { Args: never; Returns: Json }
      has_app_access: {
        Args: {
          _app: Database["public"]["Enums"]["app_name"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inherit_replica_identity: {
        Args: {
          p_child_tablename: string
          p_parent_schemaname: string
          p_parent_tablename: string
        }
        Returns: undefined
      }
      inherit_template_properties: {
        Args: {
          p_child_schema: string
          p_child_tablename: string
          p_parent_table: string
        }
        Returns: boolean
      }
      normalize_for_sg_match: { Args: { p: string }; Returns: string }
      parse_pdf_files_used: { Args: { p_asset_id: string }; Returns: number }
      partition_data_id: {
        Args: {
          p_analyze?: boolean
          p_batch_count?: number
          p_batch_interval?: number
          p_ignored_columns?: string[]
          p_lock_wait?: number
          p_order?: string
          p_override_system_value?: boolean
          p_parent_table: string
          p_source_table?: string
        }
        Returns: number
      }
      partition_data_time: {
        Args: {
          p_analyze?: boolean
          p_batch_count?: number
          p_batch_interval?: string
          p_ignored_columns?: string[]
          p_lock_wait?: number
          p_order?: string
          p_override_system_value?: boolean
          p_parent_table: string
          p_source_table?: string
        }
        Returns: number
      }
      partition_gap_fill: { Args: { p_parent_table: string }; Returns: number }
      propagate_for_pending_groups: {
        Args: never
        Returns: {
          groups_processed: number
          tags_inserted: number
        }[]
      }
      propagate_group_tags_batch: {
        Args: { p_batch_size?: number; p_cursor?: string }
        Returns: {
          done: boolean
          next_cursor: string
          propagated: number
          skipped: number
        }[]
      }
      queue_sg_render_jobs_by_ids: {
        Args: { p_file_ids: string[] }
        Returns: number
      }
      reapply_privileges: {
        Args: { p_parent_table: string }
        Returns: undefined
      }
      rebuild_style_groups_batch: {
        Args: { p_batch_size?: number; p_last_asset_id?: string }
        Returns: {
          assets_assigned: number
          assets_ungrouped: number
          done: boolean
          groups_created: number
          next_cursor: string
        }[]
      }
      reconcile_style_group_stats_batch: {
        Args: { p_batch_size?: number; p_cursor?: string; p_sub?: string }
        Returns: {
          done: boolean
          next_cursor: string
          processed: number
          sub: string
        }[]
      }
      refresh_style_group_counts: { Args: never; Returns: undefined }
      refresh_style_group_counts_batch: {
        Args: { p_group_ids: string[] }
        Returns: number
      }
      refresh_style_group_primaries: {
        Args: { p_group_ids: string[] }
        Returns: number
      }
      regroup_mega_group_assets: {
        Args: never
        Returns: {
          assets_reassigned: number
          assets_ungrouped: number
          new_groups_created: number
        }[]
      }
      requeue_all_failed_sg_jobs: {
        Args: { p_limit?: number }
        Returns: number
      }
      reset_mega_group_tagged_assets_batch: { Args: never; Returns: number }
      reset_stale_jobs: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
      resolve_sku_files_used: { Args: never; Returns: number }
      retry_sg_render_errors:
        | { Args: { p_file_ids?: string[] }; Returns: number }
        | { Args: { p_file_ids?: string[]; p_limit?: number }; Returns: number }
      run_full_rebuild_style_groups: {
        Args: never
        Returns: {
          assets_assigned: number
          assets_ungrouped: number
          batches: number
          groups_created: number
        }[]
      }
      run_full_reconcile_style_group_stats: {
        Args: never
        Returns: {
          counts_updated: number
          primaries_updated: number
        }[]
      }
      run_maintenance: {
        Args: {
          p_analyze?: boolean
          p_jobmon?: boolean
          p_parent_table?: string
        }
        Returns: undefined
      }
      set_style_group_cover: {
        Args: { p_asset_id: string; p_group_id: string }
        Returns: undefined
      }
      show_partition_info: {
        Args: {
          p_child_table: string
          p_parent_table?: string
          p_partition_interval?: string
          p_table_exists?: boolean
        }
        Returns: Record<string, unknown>
      }
      show_partition_name: {
        Args: { p_parent_table: string; p_value: string }
        Returns: Record<string, unknown>
      }
      show_partitions: {
        Args: {
          p_include_default?: boolean
          p_order?: string
          p_parent_table: string
        }
        Returns: {
          partition_schemaname: string
          partition_tablename: string
        }[]
      }
      smon_create_alert: {
        Args: {
          p_details?: Json
          p_message: string
          p_nas_id: string
          p_severity: string
          p_title: string
        }
        Returns: string
      }
      smon_detect_sync_anomalies: { Args: never; Returns: undefined }
      smon_get_openai_key: { Args: never; Returns: string }
      smon_process_ai_responses: { Args: never; Returns: undefined }
      smon_run_anomaly_detection: { Args: never; Returns: undefined }
      smon_run_daily_health: { Args: never; Returns: undefined }
      stop_sub_partition: {
        Args: { p_jobmon?: boolean; p_parent_table: string }
        Returns: boolean
      }
      undo_partition: {
        Args: {
          p_batch_interval?: string
          p_drop_cascade?: boolean
          p_ignored_columns?: string[]
          p_keep_table?: boolean
          p_lock_wait?: number
          p_loop_count?: number
          p_parent_table: string
          p_target_table: string
        }
        Returns: Record<string, unknown>
      }
      update_bulk_operation: {
        Args: { p_only_if_status?: string; p_op_key: string; p_op_state: Json }
        Returns: Json
      }
      update_bulk_operations_batch: { Args: { p_updates: Json }; Returns: Json }
      uuid7_time_decoder: { Args: { uuidv7: string }; Returns: string }
      uuid7_time_encoder: { Args: { ts: string }; Returns: string }
    }
    Enums: {
      app_name: "popdam" | "styleguides"
      app_role: "admin" | "user"
      art_source:
        | "freelancer"
        | "straight_style_guide"
        | "style_guide_composition"
      asset_status: "pending" | "processing" | "tagged" | "error"
      asset_type:
        | "art_piece"
        | "product"
        | "packaging"
        | "tech_pack"
        | "photography"
      checkout_status:
        | "active"
        | "checkin_queued"
        | "uploading"
        | "verifying"
        | "complete"
        | "discarded"
        | "error"
        | "conflict"
      file_type: "psd" | "ai" | "jpg" | "png" | "pdf"
      queue_status:
        | "pending"
        | "claimed"
        | "processing"
        | "completed"
        | "failed"
      workflow_status:
        | "product_ideas"
        | "concept_approved"
        | "in_development"
        | "freelancer_art"
        | "discontinued"
        | "in_process"
        | "customer_adopted"
        | "licensor_approved"
        | "other"
    }
    CompositeTypes: {
      check_default_table: {
        default_table: string | null
        count: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_name: ["popdam", "styleguides"],
      app_role: ["admin", "user"],
      art_source: [
        "freelancer",
        "straight_style_guide",
        "style_guide_composition",
      ],
      asset_status: ["pending", "processing", "tagged", "error"],
      asset_type: [
        "art_piece",
        "product",
        "packaging",
        "tech_pack",
        "photography",
      ],
      checkout_status: [
        "active",
        "checkin_queued",
        "uploading",
        "verifying",
        "complete",
        "discarded",
        "error",
        "conflict",
      ],
      file_type: ["psd", "ai", "jpg", "png", "pdf"],
      queue_status: ["pending", "claimed", "processing", "completed", "failed"],
      workflow_status: [
        "product_ideas",
        "concept_approved",
        "in_development",
        "freelancer_art",
        "discontinued",
        "in_process",
        "customer_adopted",
        "licensor_approved",
        "other",
      ],
    },
  },
} as const
