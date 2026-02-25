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
    PostgrestVersion: "14.1"
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
      assets: {
        Row: {
          ai_description: string | null
          ai_tagged_at: string | null
          art_source: Database["public"]["Enums"]["art_source"] | null
          artboards: number | null
          asset_type: Database["public"]["Enums"]["asset_type"] | null
          big_theme: string | null
          created_at: string
          design_ref: string | null
          design_style: string | null
          division_code: string | null
          division_name: string | null
          file_created_at: string | null
          file_size: number | null
          file_type: Database["public"]["Enums"]["file_type"]
          filename: string
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
          thumbnail_error: string | null
          thumbnail_url: string | null
          width: number | null
          workflow_status: Database["public"]["Enums"]["workflow_status"] | null
        }
        Insert: {
          ai_description?: string | null
          ai_tagged_at?: string | null
          art_source?: Database["public"]["Enums"]["art_source"] | null
          artboards?: number | null
          asset_type?: Database["public"]["Enums"]["asset_type"] | null
          big_theme?: string | null
          created_at?: string
          design_ref?: string | null
          design_style?: string | null
          division_code?: string | null
          division_name?: string | null
          file_created_at?: string | null
          file_size?: number | null
          file_type: Database["public"]["Enums"]["file_type"]
          filename: string
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
          thumbnail_error?: string | null
          thumbnail_url?: string | null
          width?: number | null
          workflow_status?:
            | Database["public"]["Enums"]["workflow_status"]
            | null
        }
        Update: {
          ai_description?: string | null
          ai_tagged_at?: string | null
          art_source?: Database["public"]["Enums"]["art_source"] | null
          artboards?: number | null
          asset_type?: Database["public"]["Enums"]["asset_type"] | null
          big_theme?: string | null
          created_at?: string
          design_ref?: string | null
          design_style?: string | null
          division_code?: string | null
          division_name?: string | null
          file_created_at?: string | null
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["file_type"]
          filename?: string
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
          thumbnail_error?: string | null
          thumbnail_url?: string | null
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
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Update: {
          accepted_at?: string | null
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
      style_groups: {
        Row: {
          asset_count: number | null
          created_at: string | null
          division_code: string | null
          division_name: string | null
          folder_path: string
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
          product_category: string | null
          property_code: string | null
          property_id: string | null
          property_name: string | null
          size_code: string | null
          size_name: string | null
          sku: string
          updated_at: string | null
          workflow_status: Database["public"]["Enums"]["workflow_status"] | null
        }
        Insert: {
          asset_count?: number | null
          created_at?: string | null
          division_code?: string | null
          division_name?: string | null
          folder_path: string
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
          product_category?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          size_code?: string | null
          size_name?: string | null
          sku: string
          updated_at?: string | null
          workflow_status?:
            | Database["public"]["Enums"]["workflow_status"]
            | null
        }
        Update: {
          asset_count?: number | null
          created_at?: string | null
          division_code?: string | null
          division_name?: string | null
          folder_path?: string
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
          product_category?: string | null
          property_code?: string | null
          property_id?: string | null
          property_name?: string | null
          size_code?: string | null
          size_name?: string | null
          sku?: string
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
      [_ in never]: never
    }
    Functions: {
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
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      get_filter_counts: { Args: { p_filters?: Json }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      reset_stale_jobs: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
    }
    Enums: {
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
      file_type: "psd" | "ai"
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
  public: {
    Enums: {
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
      file_type: ["psd", "ai"],
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
