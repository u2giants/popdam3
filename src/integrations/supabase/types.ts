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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      ai_tag_bakeoff_results: {
        Row: {
          ai_description: string | null
          asset_id: string
          character_ids: string[]
          character_names: string[]
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number | null
          model_id: string
          model_slot: string
          pricing_snapshot: Json | null
          prompt_tokens: number | null
          property_id: string | null
          property_name: string | null
          raw_output: Json | null
          run_id: string
          status: string
          tags: string[]
          total_tokens: number | null
          updated_at: string
        }
        Insert: {
          ai_description?: string | null
          asset_id: string
          character_ids?: string[]
          character_names?: string[]
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model_id: string
          model_slot: string
          pricing_snapshot?: Json | null
          prompt_tokens?: number | null
          property_id?: string | null
          property_name?: string | null
          raw_output?: Json | null
          run_id: string
          status?: string
          tags?: string[]
          total_tokens?: number | null
          updated_at?: string
        }
        Update: {
          ai_description?: string | null
          asset_id?: string
          character_ids?: string[]
          character_names?: string[]
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model_id?: string
          model_slot?: string
          pricing_snapshot?: Json | null
          prompt_tokens?: number | null
          property_id?: string | null
          property_name?: string | null
          raw_output?: Json | null
          run_id?: string
          status?: string
          tags?: string[]
          total_tokens?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tag_bakeoff_results_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_tag_bakeoff_results_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_tag_bakeoff_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_tag_bakeoff_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tag_bakeoff_reviews: {
        Row: {
          asset_id: string
          field: string
          id: string
          notes: string | null
          reviewed_at: string
          reviewed_by: string | null
          run_id: string
          scores: Json
          winner_slot: string | null
        }
        Insert: {
          asset_id: string
          field: string
          id?: string
          notes?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          run_id: string
          scores?: Json
          winner_slot?: string | null
        }
        Update: {
          asset_id?: string
          field?: string
          id?: string
          notes?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          run_id?: string
          scores?: Json
          winner_slot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_tag_bakeoff_reviews_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_tag_bakeoff_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_tag_bakeoff_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tag_bakeoff_runs: {
        Row: {
          asset_ids: string[]
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          model_a: string
          model_b: string
          model_c: string
          model_d: string | null
          model_e: string | null
          name: string
          sample_size: number
          status: string
          updated_at: string
        }
        Insert: {
          asset_ids?: string[]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model_a: string
          model_b: string
          model_c: string
          model_d?: string | null
          model_e?: string | null
          name: string
          sample_size?: number
          status?: string
          updated_at?: string
        }
        Update: {
          asset_ids?: string[]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model_a?: string
          model_b?: string
          model_c?: string
          model_d?: string | null
          model_e?: string | null
          name?: string
          sample_size?: number
          status?: string
          updated_at?: string
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
          expected_quick_hash: string | null
          final_hash: string | null
          final_size: number | null
          id: string
          last_helper_heartbeat_at: string | null
          redrive_count: number
          redrive_requested: boolean
          resolution: string | null
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
          verified_at: string | null
          verify_attempts: number
          verify_deadline_at: string | null
          verify_error: string | null
          verify_failed_at: string | null
          verify_last_attempt_at: string | null
          verify_resolve_at: string | null
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
          expected_quick_hash?: string | null
          final_hash?: string | null
          final_size?: number | null
          id?: string
          last_helper_heartbeat_at?: string | null
          redrive_count?: number
          redrive_requested?: boolean
          resolution?: string | null
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
          verified_at?: string | null
          verify_attempts?: number
          verify_deadline_at?: string | null
          verify_error?: string | null
          verify_failed_at?: string | null
          verify_last_attempt_at?: string | null
          verify_resolve_at?: string | null
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
          expected_quick_hash?: string | null
          final_hash?: string | null
          final_size?: number | null
          id?: string
          last_helper_heartbeat_at?: string | null
          redrive_count?: number
          redrive_requested?: boolean
          resolution?: string | null
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
          verified_at?: string | null
          verify_attempts?: number
          verify_deadline_at?: string | null
          verify_error?: string | null
          verify_failed_at?: string | null
          verify_last_attempt_at?: string | null
          verify_resolve_at?: string | null
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
          content_type: string | null
          cover_description: string | null
          created_at: string
          customer: string | null
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
          program: string | null
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
          stage: string | null
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
          content_type?: string | null
          cover_description?: string | null
          created_at?: string
          customer?: string | null
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
          program?: string | null
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
          stage?: string | null
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
          content_type?: string | null
          cover_description?: string | null
          created_at?: string
          customer?: string | null
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
          program?: string | null
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
          stage?: string | null
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
      dam_search_documents: {
        Row: {
          asset_id: string | null
          content_sha256: string
          customer: string | null
          document_type: string
          embedding: string | null
          embedding_error: string | null
          embedding_model: string | null
          embedding_updated_at: string | null
          entity_id: string
          indexed_at: string
          metadata: Json
          path: string
          program: string | null
          search_text: string
          search_tsv: unknown
          source_updated_at: string | null
          style_group_id: string | null
          title: string
        }
        Insert: {
          asset_id?: string | null
          content_sha256?: string
          customer?: string | null
          document_type: string
          embedding?: string | null
          embedding_error?: string | null
          embedding_model?: string | null
          embedding_updated_at?: string | null
          entity_id: string
          indexed_at?: string
          metadata?: Json
          path?: string
          program?: string | null
          search_text?: string
          search_tsv?: unknown
          source_updated_at?: string | null
          style_group_id?: string | null
          title?: string
        }
        Update: {
          asset_id?: string | null
          content_sha256?: string
          customer?: string | null
          document_type?: string
          embedding?: string | null
          embedding_error?: string | null
          embedding_model?: string | null
          embedding_updated_at?: string | null
          entity_id?: string
          indexed_at?: string
          metadata?: Json
          path?: string
          program?: string | null
          search_text?: string
          search_tsv?: unknown
          source_updated_at?: string | null
          style_group_id?: string | null
          title?: string
        }
        Relationships: []
      }
      dam_search_synonyms: {
        Row: {
          created_at: string
          expansion: string
          is_active: boolean
          note: string | null
          search_term: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expansion: string
          is_active?: boolean
          note?: string | null
          search_term: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expansion?: string
          is_active?: boolean
          note?: string | null
          search_term?: string
          updated_at?: string
        }
        Relationships: []
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
      prod_order_headers_current: {
        Row: {
          created_at: string
          customer_code: string | null
          customer_name: string | null
          due_date: string | null
          erp_updated_at: string | null
          external_id: string
          id: string
          order_date: string | null
          order_status: string | null
          prod_order_number: string
          quantity: number | null
          raw_payload: Json
          style_number: string
          sync_run_id: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_code?: string | null
          customer_name?: string | null
          due_date?: string | null
          erp_updated_at?: string | null
          external_id: string
          id?: string
          order_date?: string | null
          order_status?: string | null
          prod_order_number: string
          quantity?: number | null
          raw_payload?: Json
          style_number: string
          sync_run_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_code?: string | null
          customer_name?: string | null
          due_date?: string | null
          erp_updated_at?: string | null
          external_id?: string
          id?: string
          order_date?: string | null
          order_status?: string | null
          prod_order_number?: string
          quantity?: number | null
          raw_payload?: Json
          style_number?: string
          sync_run_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prod_order_headers_current_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "prod_order_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      prod_order_headers_raw: {
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
            foreignKeyName: "prod_order_headers_raw_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "prod_order_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      prod_order_sync_runs: {
        Row: {
          created_by: string
          ended_at: string | null
          error_samples: Json
          id: string
          run_metadata: Json
          started_at: string
          status: string
          total_errors: number
          total_fetched: number
          total_upserted: number
        }
        Insert: {
          created_by?: string
          ended_at?: string | null
          error_samples?: Json
          id?: string
          run_metadata?: Json
          started_at?: string
          status?: string
          total_errors?: number
          total_fetched?: number
          total_upserted?: number
        }
        Update: {
          created_by?: string
          ended_at?: string | null
          error_samples?: Json
          id?: string
          run_metadata?: Json
          started_at?: string
          status?: string
          total_errors?: number
          total_fetched?: number
          total_upserted?: number
        }
        Relationships: []
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
          last_match_attempt_at: string | null
          match_attempts: number
          match_best_score: number | null
          sku: string
          source: string | null
          style_guide_file_id: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          last_match_attempt_at?: string | null
          match_attempts?: number
          match_best_score?: number | null
          sku: string
          source?: string | null
          style_guide_file_id?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          last_match_attempt_at?: string | null
          match_attempts?: number
          match_best_score?: number | null
          sku?: string
          source?: string | null
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
          customer: string | null
          designer_conflict: boolean
          designer_name: string | null
          division_code: string | null
          division_name: string | null
          folder_path: string
          freelancer_name: string | null
          id: string
          is_licensed: boolean | null
          item_description: string | null
          item_description_source: string | null
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
          program: string | null
          property_code: string | null
          property_id: string | null
          property_name: string | null
          size_code: string | null
          size_name: string | null
          sku: string
          stage: string | null
          technical_designer_name: string | null
          updated_at: string | null
          workflow_status: Database["public"]["Enums"]["workflow_status"] | null
        }
        Insert: {
          asset_count?: number | null
          cover_description?: string | null
          created_at?: string | null
          customer?: string | null
          designer_conflict?: boolean
          designer_name?: string | null
          division_code?: string | null
          division_name?: string | null
          folder_path: string
          freelancer_name?: string | null
          id?: string
          is_licensed?: boolean | null
          item_description?: string | null
          item_description_source?: string | null
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
          program?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          size_code?: string | null
          size_name?: string | null
          sku: string
          stage?: string | null
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
          customer?: string | null
          designer_conflict?: boolean
          designer_name?: string | null
          division_code?: string | null
          division_name?: string | null
          folder_path?: string
          freelancer_name?: string | null
          id?: string
          is_licensed?: boolean | null
          item_description?: string | null
          item_description_source?: string | null
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
          program?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          size_code?: string | null
          size_name?: string | null
          sku?: string
          stage?: string | null
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
      style_tracker_audit_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          column_letter: string | null
          event_type: string
          field_key: string | null
          id: string
          metadata: Json
          new_value: Json | null
          old_value: Json | null
          source_row_number: number | null
          source_sheet: string | null
          style_tracker_row_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          column_letter?: string | null
          event_type: string
          field_key?: string | null
          id?: string
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
          source_row_number?: number | null
          source_sheet?: string | null
          style_tracker_row_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          column_letter?: string | null
          event_type?: string
          field_key?: string | null
          id?: string
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
          source_row_number?: number | null
          source_sheet?: string | null
          style_tracker_row_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "style_tracker_audit_log_style_tracker_row_id_fkey"
            columns: ["style_tracker_row_id"]
            isOneToOne: false
            referencedRelation: "style_tracker_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "style_tracker_audit_log_style_tracker_row_id_fkey"
            columns: ["style_tracker_row_id"]
            isOneToOne: false
            referencedRelation: "style_tracker_rows_with_bridge"
            referencedColumns: ["id"]
          },
        ]
      }
      style_tracker_rows: {
        Row: {
          commissioned: string | null
          concept_status: string | null
          created_at: string
          customer: string | null
          customer_sku: string | null
          default_vendor: string | null
          description: string | null
          designer: string | null
          discontinued: boolean | null
          group_id: string | null
          id: string
          imported_at: string
          license_status: string | null
          licensor: string | null
          notes: string | null
          pre_production_status: string | null
          production_status: string | null
          row_data: Json
          royalty: string | null
          sku: string | null
          source_row_number: number | null
          source_sheet: string
          source_workbook_id: string
          tracker_type: string
          upc: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          commissioned?: string | null
          concept_status?: string | null
          created_at?: string
          customer?: string | null
          customer_sku?: string | null
          default_vendor?: string | null
          description?: string | null
          designer?: string | null
          discontinued?: boolean | null
          group_id?: string | null
          id?: string
          imported_at?: string
          license_status?: string | null
          licensor?: string | null
          notes?: string | null
          pre_production_status?: string | null
          production_status?: string | null
          row_data?: Json
          royalty?: string | null
          sku?: string | null
          source_row_number?: number | null
          source_sheet: string
          source_workbook_id?: string
          tracker_type: string
          upc?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          commissioned?: string | null
          concept_status?: string | null
          created_at?: string
          customer?: string | null
          customer_sku?: string | null
          default_vendor?: string | null
          description?: string | null
          designer?: string | null
          discontinued?: boolean | null
          group_id?: string | null
          id?: string
          imported_at?: string
          license_status?: string | null
          licensor?: string | null
          notes?: string | null
          pre_production_status?: string | null
          production_status?: string | null
          row_data?: Json
          royalty?: string | null
          sku?: string | null
          source_row_number?: number | null
          source_sheet?: string
          source_workbook_id?: string
          tracker_type?: string
          upc?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      style_tracker_user_views: {
        Row: {
          column_state: Json
          created_at: string
          filter_model: Json
          id: string
          source_sheet: string
          updated_at: string
          user_id: string
          view_name: string
        }
        Insert: {
          column_state?: Json
          created_at?: string
          filter_model?: Json
          id?: string
          source_sheet: string
          updated_at?: string
          user_id: string
          view_name?: string
        }
        Update: {
          column_state?: Json
          created_at?: string
          filter_model?: Json
          id?: string
          source_sheet?: string
          updated_at?: string
          user_id?: string
          view_name?: string
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
      sg_archive_usage: {
        Row: {
          active_files: number | null
          archive_candidate: boolean | null
          design_ref_count: number | null
          designs_using: number | null
          licensor_name: string | null
          most_recent_design_date: string | null
          newest_sg_file_date: string | null
          property_folder: string | null
          total_files: number | null
        }
        Relationships: []
      }
      style_guide_file_groups: {
        Row: {
          directory_path: string | null
          file_count: number | null
          group_key: string | null
          latest_modified_at: string | null
          licensor_name: string | null
          property_folder: string | null
          root_label: string | null
          sample_thumbnail_url: string | null
          style_guide_folder: string | null
          style_guide_name: string | null
          total_size_bytes: number | null
        }
        Relationships: []
      }
      style_guide_folders: {
        Row: {
          licensor_name: string | null
          property_folder: string | null
        }
        Relationships: []
      }
      style_tracker_audit_log_with_user: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          changed_by_email: string | null
          changed_by_label: string | null
          column_letter: string | null
          event_type: string | null
          field_key: string | null
          id: string | null
          metadata: Json | null
          new_value: Json | null
          old_value: Json | null
          source_row_number: number | null
          source_sheet: string | null
          style_tracker_row_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "style_tracker_audit_log_style_tracker_row_id_fkey"
            columns: ["style_tracker_row_id"]
            isOneToOne: false
            referencedRelation: "style_tracker_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "style_tracker_audit_log_style_tracker_row_id_fkey"
            columns: ["style_tracker_row_id"]
            isOneToOne: false
            referencedRelation: "style_tracker_rows_with_bridge"
            referencedColumns: ["id"]
          },
        ]
      }
      style_tracker_rows_with_bridge: {
        Row: {
          bridge_id: string | null
          canonical_customer_name: string | null
          canonical_description: string | null
          canonical_designer_name: string | null
          canonical_factory_name: string | null
          canonical_licensor_name: string | null
          commissioned: string | null
          company_id: string | null
          concept_status: string | null
          core_licensor_id: string | null
          created_at: string | null
          creative_designer_id: string | null
          customer: string | null
          customer_sku: string | null
          default_vendor: string | null
          description: string | null
          designer: string | null
          discontinued: boolean | null
          erp_item_id: string | null
          erp_style_number: string | null
          factory_id: string | null
          group_id: string | null
          id: string | null
          imported_at: string | null
          last_matched_at: string | null
          license_status: string | null
          licensor: string | null
          match_confidence: string | null
          match_notes: Json | null
          match_status: string | null
          notes: string | null
          plm_item_id: string | null
          pre_production_status: string | null
          production_status: string | null
          public_licensor_id: string | null
          row_data: Json | null
          royalty: string | null
          sku: string | null
          source_row_number: number | null
          source_sheet: string | null
          source_workbook_id: string | null
          style_group_id: string | null
          style_group_sku: string | null
          tracker_type: string | null
          upc: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_style_tracker_rows: {
        Args: {
          p_count?: number
          p_source_sheet: string
          p_tracker_type: string
        }
        Returns: {
          commissioned: string | null
          concept_status: string | null
          created_at: string
          customer: string | null
          customer_sku: string | null
          default_vendor: string | null
          description: string | null
          designer: string | null
          discontinued: boolean | null
          group_id: string | null
          id: string
          imported_at: string
          license_status: string | null
          licensor: string | null
          notes: string | null
          pre_production_status: string | null
          production_status: string | null
          row_data: Json
          royalty: string | null
          sku: string | null
          source_row_number: number | null
          source_sheet: string
          source_workbook_id: string
          tracker_type: string
          upc: string | null
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "style_tracker_rows"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      advise_dam_search_query_indexes: {
        Args: { p_query: string }
        Returns: {
          errors: string[]
          index_statements: string[]
          startup_cost_after: Json
          startup_cost_before: Json
          total_cost_after: Json
          total_cost_before: Json
        }[]
      }
      backfill_pdf_files_used: { Args: never; Returns: number }
      bulk_assign_style_groups: {
        Args: { p_assignments: Json }
        Returns: number
      }
      bulk_insert_pdf_text_samples: { Args: { p_rows: Json }; Returns: number }
      claim_dam_search_embedding_documents: {
        Args: { p_limit?: number }
        Returns: {
          content_sha256: string
          document_type: string
          entity_id: string
          search_text: string
        }[]
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
      deactivate_stale_sg_files: {
        Args: { p_root_label: string; p_run_id: string }
        Returns: number
      }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      expand_dam_search_queries: {
        Args: { p_query: string }
        Returns: {
          query_text: string
        }[]
      }
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
      get_ai_tag_candidates: {
        Args: {
          p_after_id?: string
          p_after_tier?: number
          p_group_ids?: string[]
          p_limit: number
          p_mode: string
        }
        Returns: {
          filename: string
          id: string
          primary_sort_tier: number
          relative_path: string
          style_group_id: string
          thumbnail_url: string
        }[]
      }
      get_dam_search_embedding_status: { Args: never; Returns: Json }
      get_dam_search_performance_stats: {
        Args: never
        Returns: {
          calls: number
          max_exec_ms: number
          mean_exec_ms: number
          query: string
          rows: number
          shared_blks_hit: number
          shared_blks_read: number
          total_exec_ms: number
        }[]
      }
      get_filter_counts: { Args: { p_filters?: Json }; Returns: Json }
      get_path_facets: { Args: { p_customer?: string }; Returns: Json }
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
      infer_path_attrs: { Args: { p_path: string }; Returns: Json }
      is_style_guide_source_pdf: {
        Args: { p_file_type: string; p_filename: string }
        Returns: boolean
      }
      mark_dam_search_embedding_error: {
        Args: {
          p_content_sha256: string
          p_document_type: string
          p_entity_id: string
          p_error: string
        }
        Returns: boolean
      }
      normalize_for_sg_match: { Args: { p: string }; Returns: string }
      parse_pdf_files_used: { Args: { p_asset_id: string }; Returns: number }
      propagate_group_tags_batch: {
        Args: { p_batch_size?: number; p_cursor?: string }
        Returns: {
          done: boolean
          next_cursor: string
          propagated: number
          skipped: number
        }[]
      }
      queue_nightly_rebuild_style_groups: { Args: never; Returns: undefined }
      queue_sg_render_jobs_by_ids: {
        Args: { p_file_ids: string[] }
        Returns: number
      }
      rebuild_dam_search_documents: { Args: never; Returns: Json }
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
      refresh_dam_search_asset_document: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      refresh_dam_search_style_group_document: {
        Args: { p_style_group_id: string }
        Returns: undefined
      }
      refresh_sku_human_description: { Args: never; Returns: number }
      refresh_style_group_counts: { Args: never; Returns: undefined }
      refresh_style_group_counts_batch: {
        Args: { p_group_ids: string[] }
        Returns: number
      }
      refresh_style_group_primaries: {
        Args: { p_group_ids: string[] }
        Returns: number
      }
      refresh_style_guide_matviews: { Args: never; Returns: undefined }
      refresh_style_tracker_item_bridge: {
        Args: never
        Returns: {
          inserted_count: number
          total_count: number
          updated_count: number
        }[]
      }
      requeue_all_failed_sg_jobs: {
        Args: { p_limit?: number }
        Returns: number
      }
      reset_stale_jobs: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
      resolve_sku_files_used: { Args: never; Returns: number }
      resolve_sku_files_used_fuzzy: {
        Args: { p_threshold?: number }
        Returns: number
      }
      retry_sg_render_errors:
        | { Args: { p_file_ids?: string[] }; Returns: number }
        | { Args: { p_file_ids?: string[]; p_limit?: number }; Returns: number }
      run_full_reconcile_style_group_stats: {
        Args: never
        Returns: {
          counts_updated: number
          primaries_updated: number
        }[]
      }
      search_assets_full_text: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          asset_id: string
          rank: number
          style_group_id: string
        }[]
      }
      search_dam_documents: {
        Args: {
          p_document_types?: string[]
          p_limit?: number
          p_query: string
          p_query_embedding?: string
        }
        Returns: {
          asset_id: string
          document_type: string
          entity_id: string
          keyword_rank: number
          rank: number
          semantic_rank: number
          style_group_id: string
        }[]
      }
      search_style_groups_full_text: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          rank: number
          style_group_id: string
        }[]
      }
      search_style_tracker_link_candidates: {
        Args: {
          p_field_key: string
          p_limit?: number
          p_match_mode?: string
          p_query: string
        }
        Returns: {
          score: number
          target_id: string
          target_label: string
          target_schema: string
          target_table: string
        }[]
      }
      set_style_group_cover: {
        Args: { p_asset_id: string; p_group_id: string }
        Returns: undefined
      }
      update_bulk_operation: {
        Args: { p_only_if_status?: string; p_op_key: string; p_op_state: Json }
        Returns: Json
      }
      update_bulk_operations_batch: { Args: { p_updates: Json }; Returns: Json }
      upsert_dam_search_embedding: {
        Args: {
          p_content_sha256: string
          p_document_type: string
          p_embedding: string
          p_embedding_model?: string
          p_entity_id: string
        }
        Returns: boolean
      }
      upsert_style_tracker_value_resolution: {
        Args: {
          p_field_key: string
          p_local_value?: string
          p_raw_value: string
          p_resolution_type: string
          p_target_id?: string
          p_target_label?: string
          p_target_schema?: string
          p_target_table?: string
        }
        Returns: unknown
        SetofOptions: {
          from: "*"
          to: "style_tracker_value_resolution"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
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
