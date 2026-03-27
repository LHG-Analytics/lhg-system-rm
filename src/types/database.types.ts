export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      channel_inventory: {
        Row: {
          available_quantity: number
          category_id: string
          channel_id: string
          id: string
          updated_at: string
        }
        Insert: {
          available_quantity?: number
          category_id: string
          channel_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          available_quantity?: number
          category_id?: string
          channel_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_inventory_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_inventory_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_sync_log: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          payload: Json | null
          status: Database["public"]["Enums"]["sync_status"]
          unit_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          payload?: Json | null
          status: Database["public"]["Enums"]["sync_status"]
          unit_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          payload?: Json | null
          status?: Database["public"]["Enums"]["sync_status"]
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_sync_log_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_sync_log_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_snapshots: {
        Row: {
          avg_ticket: number | null
          category_id: string | null
          date: string
          day_of_week: number | null
          giro: number | null
          hour: number | null
          id: string
          occupancy_rate: number | null
          period_label: string | null
          reservations_count: number | null
          revenue: number | null
          revpar: number | null
          synced_at: string
          tmo: string | null
          trevpar: number | null
          unit_id: string
        }
        Insert: {
          avg_ticket?: number | null
          category_id?: string | null
          date: string
          day_of_week?: number | null
          giro?: number | null
          hour?: number | null
          id?: string
          occupancy_rate?: number | null
          period_label?: string | null
          reservations_count?: number | null
          revenue?: number | null
          revpar?: number | null
          synced_at?: string
          tmo?: string | null
          trevpar?: number | null
          unit_id: string
        }
        Update: {
          avg_ticket?: number | null
          category_id?: string | null
          date?: string
          day_of_week?: number | null
          giro?: number | null
          hour?: number | null
          id?: string
          occupancy_rate?: number | null
          period_label?: string | null
          reservations_count?: number | null
          revenue?: number | null
          revpar?: number | null
          synced_at?: string
          tmo?: string | null
          trevpar?: number | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_snapshots_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_snapshots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      price_rules: {
        Row: {
          category_id: string
          channel_id: string | null
          created_at: string
          day_of_week: number | null
          id: string
          period_id: string
          price: number
          priority: number
          specific_date: string | null
          time_end: string | null
          time_start: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          category_id: string
          channel_id?: string | null
          created_at?: string
          day_of_week?: number | null
          id?: string
          period_id: string
          price: number
          priority?: number
          specific_date?: string | null
          time_end?: string | null
          time_start?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          category_id?: string
          channel_id?: string | null
          created_at?: string
          day_of_week?: number | null
          id?: string
          period_id?: string
          price?: number
          priority?: number
          specific_date?: string | null
          time_end?: string | null
          time_start?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "suite_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          unit_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          unit_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          unit_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_agent_config: {
        Row: {
          competitor_urls: Json
          created_at: string
          id: string
          is_active: boolean
          last_context_update: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          competitor_urls?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_context_update?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          competitor_urls?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          last_context_update?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_agent_config_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_agent_overrides: {
        Row: {
          created_at: string
          decision_id: string
          id: string
          overridden_by: string
          override_type: Database["public"]["Enums"]["override_type"]
          reason: string | null
          unit_id: string
        }
        Insert: {
          created_at?: string
          decision_id: string
          id?: string
          overridden_by: string
          override_type: Database["public"]["Enums"]["override_type"]
          reason?: string | null
          unit_id: string
        }
        Update: {
          created_at?: string
          decision_id?: string
          id?: string
          overridden_by?: string
          override_type?: Database["public"]["Enums"]["override_type"]
          reason?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_agent_overrides_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "rm_price_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_agent_overrides_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          status: Database["public"]["Enums"]["conversation_status"]
          unit_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          status?: Database["public"]["Enums"]["conversation_status"]
          unit_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          status?: Database["public"]["Enums"]["conversation_status"]
          unit_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_conversations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_generated_prices: {
        Row: {
          category_id: string
          channel_id: string | null
          generated_at: string
          id: string
          period_id: string
          price: number
          rationale: string | null
          status: Database["public"]["Enums"]["rm_price_status"]
          unit_id: string
          valid_until: string | null
        }
        Insert: {
          category_id: string
          channel_id?: string | null
          generated_at?: string
          id?: string
          period_id: string
          price: number
          rationale?: string | null
          status?: Database["public"]["Enums"]["rm_price_status"]
          unit_id: string
          valid_until?: string | null
        }
        Update: {
          category_id?: string
          channel_id?: string | null
          generated_at?: string
          id?: string
          period_id?: string
          price?: number
          rationale?: string | null
          status?: Database["public"]["Enums"]["rm_price_status"]
          unit_id?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rm_generated_prices_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_generated_prices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_generated_prices_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "suite_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_generated_prices_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_price_decisions: {
        Row: {
          category_id: string
          channel_id: string | null
          competitor_prices: Json | null
          decided_at: string
          id: string
          occupancy_at_decision: number | null
          period_id: string
          price_after: number
          price_before: number
          rationale: string | null
          reverted_by: string | null
          trigger: string | null
          unit_id: string
          was_reverted: boolean
          weather_snapshot: Json | null
        }
        Insert: {
          category_id: string
          channel_id?: string | null
          competitor_prices?: Json | null
          decided_at?: string
          id?: string
          occupancy_at_decision?: number | null
          period_id: string
          price_after: number
          price_before: number
          rationale?: string | null
          reverted_by?: string | null
          trigger?: string | null
          unit_id: string
          was_reverted?: boolean
          weather_snapshot?: Json | null
        }
        Update: {
          category_id?: string
          channel_id?: string | null
          competitor_prices?: Json | null
          decided_at?: string
          id?: string
          occupancy_at_decision?: number | null
          period_id?: string
          price_after?: number
          price_before?: number
          rationale?: string | null
          reverted_by?: string | null
          trigger?: string | null
          unit_id?: string
          was_reverted?: boolean
          weather_snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "rm_price_decisions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_price_decisions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_price_decisions_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "suite_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_price_decisions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_price_guardrails: {
        Row: {
          category_id: string
          ceiling_price: number
          created_at: string
          floor_price: number
          freeze_minutes: number
          id: string
          loop_interval_minutes: number
          max_change_pct: number
          notify_before_publish: boolean
          notify_window_minutes: number
          period_id: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          ceiling_price: number
          created_at?: string
          floor_price: number
          freeze_minutes?: number
          id?: string
          loop_interval_minutes?: number
          max_change_pct: number
          notify_before_publish?: boolean
          notify_window_minutes?: number
          period_id: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          ceiling_price?: number
          created_at?: string
          floor_price?: number
          freeze_minutes?: number
          id?: string
          loop_interval_minutes?: number
          max_change_pct?: number
          notify_before_publish?: boolean
          notify_window_minutes?: number
          period_id?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_price_guardrails_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_price_guardrails_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "suite_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_price_guardrails_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_weather_demand_patterns: {
        Row: {
          avg_demand_delta_pct: number
          category_id: string
          day_of_week: number | null
          id: string
          last_updated: string
          sample_count: number
          unit_id: string
          weather_condition: string
        }
        Insert: {
          avg_demand_delta_pct?: number
          category_id: string
          day_of_week?: number | null
          id?: string
          last_updated?: string
          sample_count?: number
          unit_id: string
          weather_condition: string
        }
        Update: {
          avg_demand_delta_pct?: number
          category_id?: string
          day_of_week?: number | null
          id?: string
          last_updated?: string
          sample_count?: number
          unit_id?: string
          weather_condition?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_weather_demand_patterns_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_weather_demand_patterns_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channels: {
        Row: {
          credentials_vault_key: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          last_sync_status: Database["public"]["Enums"]["sync_status"] | null
          name: Database["public"]["Enums"]["channel_name"]
          unit_id: string
        }
        Insert: {
          credentials_vault_key?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_status?: Database["public"]["Enums"]["sync_status"] | null
          name: Database["public"]["Enums"]["channel_name"]
          unit_id: string
        }
        Update: {
          credentials_vault_key?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_status?: Database["public"]["Enums"]["sync_status"] | null
          name?: Database["public"]["Enums"]["channel_name"]
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_channels_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      suite_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          total_suites: number
          unit_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          total_suites?: number
          unit_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          total_suites?: number
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suite_categories_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      suite_periods: {
        Row: {
          base_price: number
          category_id: string
          duration_minutes: number
          id: string
          is_active: boolean
          label: Database["public"]["Enums"]["period_label"]
        }
        Insert: {
          base_price: number
          category_id: string
          duration_minutes: number
          id?: string
          is_active?: boolean
          label: Database["public"]["Enums"]["period_label"]
        }
        Update: {
          base_price?: number
          category_id?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          label?: Database["public"]["Enums"]["period_label"]
        }
        Relationships: [
          {
            foreignKeyName: "suite_periods_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "suite_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          slug: string
          state: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          slug: string
          state?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          slug?: string
          state?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_user_unit_id: { Args: never; Returns: string }
    }
    Enums: {
      channel_name:
        | "erp"
        | "site"
        | "guia_moteis"
        | "booking"
        | "expedia"
        | "decolar"
        | "airbnb"
      conversation_status: "active" | "completed"
      override_type: "cancelled_before_publish" | "reverted_after_publish"
      period_label: "3h" | "6h" | "12h" | "pernoite"
      rm_price_status: "pending" | "approved" | "rejected"
      sync_status: "success" | "error" | "conflict"
      user_role: "super_admin" | "admin" | "manager" | "viewer"
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
      channel_name: [
        "erp",
        "site",
        "guia_moteis",
        "booking",
        "expedia",
        "decolar",
        "airbnb",
      ],
      conversation_status: ["active", "completed"],
      override_type: ["cancelled_before_publish", "reverted_after_publish"],
      period_label: ["3h", "6h", "12h", "pernoite"],
      rm_price_status: ["pending", "approved", "rejected"],
      sync_status: ["success", "error", "conflict"],
      user_role: ["super_admin", "admin", "manager", "viewer"],
    },
  },
} as const

