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
      agent_price_guardrails: {
        Row: {
          categoria: string
          created_at: string
          created_by: string | null
          dia_tipo: string
          id: string
          periodo: string
          preco_maximo: number
          preco_minimo: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          categoria: string
          created_at?: string
          created_by?: string | null
          dia_tipo?: string
          id?: string
          periodo: string
          preco_maximo: number
          preco_minimo: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          categoria?: string
          created_at?: string
          created_by?: string | null
          dia_tipo?: string
          id?: string
          periodo?: string
          preco_maximo?: number
          preco_minimo?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_price_guardrails_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
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
      competitor_snapshots: {
        Row: {
          apify_run_id: string | null
          competitor_name: string
          competitor_url: string
          id: string
          mapped_prices: Json
          raw_text: string | null
          scraped_at: string
          status: string
          unit_id: string
        }
        Insert: {
          apify_run_id?: string | null
          competitor_name: string
          competitor_url: string
          id?: string
          mapped_prices?: Json
          raw_text?: string | null
          scraped_at?: string
          status?: string
          unit_id: string
        }
        Update: {
          apify_run_id?: string | null
          competitor_name?: string
          competitor_url?: string
          id?: string
          mapped_prices?: Json
          raw_text?: string | null
          scraped_at?: string
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_snapshots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_proposals: {
        Row: {
          context: string | null
          conv_id: string | null
          created_at: string
          id: string
          rejected_items: Json | null
          rejection_reason_text: string | null
          rejection_reason_type: string | null
          reviewed_at: string | null
          rows: Json
          status: string
          unit_id: string
        }
        Insert: {
          context?: string | null
          conv_id?: string | null
          created_at?: string
          id?: string
          rejected_items?: Json | null
          rejection_reason_text?: string | null
          rejection_reason_type?: string | null
          reviewed_at?: string | null
          rows?: Json
          status?: string
          unit_id: string
        }
        Update: {
          context?: string | null
          conv_id?: string | null
          created_at?: string
          id?: string
          rejected_items?: Json | null
          rejection_reason_text?: string | null
          rejection_reason_type?: string | null
          reviewed_at?: string | null
          rows?: Json
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_proposals_conv_id_fkey"
            columns: ["conv_id"]
            isOneToOne: false
            referencedRelation: "rm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_proposals_unit_id_fkey"
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
      lhg_analytics_tokens: {
        Row: {
          access_token: string
          expires_at: string
          id: string
          unit_slug: string
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          id?: string
          unit_slug: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: string
          unit_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      price_import_jobs: {
        Row: {
          created_at: string
          created_by: string
          csv_content: string
          error_msg: string | null
          file_name: string
          finished_at: string | null
          id: string
          import_type: string
          parsed_preview: Json | null
          result_id: string | null
          started_at: string | null
          status: string
          unit_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          csv_content: string
          error_msg?: string | null
          file_name: string
          finished_at?: string | null
          id?: string
          import_type?: string
          parsed_preview?: Json | null
          result_id?: string | null
          started_at?: string | null
          status?: string
          unit_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          csv_content?: string
          error_msg?: string | null
          file_name?: string
          finished_at?: string | null
          id?: string
          import_type?: string
          parsed_preview?: Json | null
          result_id?: string | null
          started_at?: string | null
          status?: string
          unit_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_import_jobs_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "price_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_import_jobs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      price_imports: {
        Row: {
          canals: string[]
          discount_data: Json | null
          id: string
          import_type: string
          imported_at: string
          imported_by: string
          is_active: boolean
          parsed_data: Json
          raw_content: string
          unit_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          canals?: string[]
          discount_data?: Json | null
          id?: string
          import_type?: string
          imported_at?: string
          imported_by: string
          is_active?: boolean
          parsed_data?: Json
          raw_content: string
          unit_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          canals?: string[]
          discount_data?: Json | null
          id?: string
          import_type?: string
          imported_at?: string
          imported_by?: string
          is_active?: boolean
          parsed_data?: Json
          raw_content?: string
          unit_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_imports_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      price_proposals: {
        Row: {
          approved_at: string | null
          context: string | null
          created_at: string
          created_by: string
          effective_from: string | null
          id: string
          kpi_baseline: Json | null
          rejected_items: Json | null
          rejection_reason_text: string | null
          rejection_reason_type: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rows: Json
          status: string
          unit_id: string
        }
        Insert: {
          approved_at?: string | null
          context?: string | null
          created_at?: string
          created_by: string
          effective_from?: string | null
          id?: string
          kpi_baseline?: Json | null
          rejected_items?: Json | null
          rejection_reason_text?: string | null
          rejection_reason_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rows?: Json
          status?: string
          unit_id: string
        }
        Update: {
          approved_at?: string | null
          context?: string | null
          created_at?: string
          created_by?: string
          effective_from?: string | null
          id?: string
          kpi_baseline?: Json | null
          rejected_items?: Json | null
          rejection_reason_text?: string | null
          rejection_reason_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rows?: Json
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_proposals_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
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
          display_name: string | null
          id: string
          notification_preferences: Json
          role: Database["public"]["Enums"]["user_role"]
          unit_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          notification_preferences?: Json
          role?: Database["public"]["Enums"]["user_role"]
          unit_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          notification_preferences?: Json
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
          city: string
          competitor_urls: Json
          created_at: string
          events_cache: Json | null
          focus_metric: string
          id: string
          is_active: boolean
          max_variation_pct: number
          postal_code: string | null
          pricing_strategy: string
          pricing_thresholds: Json | null
          shared_context: string | null
          suite_amenities: Json
          timezone: string
          unit_goals: Json | null
          unit_id: string
          updated_at: string
          weather_insight_cache: Json | null
        }
        Insert: {
          city?: string
          competitor_urls?: Json
          created_at?: string
          events_cache?: Json | null
          focus_metric?: string
          id?: string
          is_active?: boolean
          max_variation_pct?: number
          postal_code?: string | null
          pricing_strategy?: string
          pricing_thresholds?: Json | null
          shared_context?: string | null
          suite_amenities?: Json
          timezone?: string
          unit_goals?: Json | null
          unit_id: string
          updated_at?: string
          weather_insight_cache?: Json | null
        }
        Update: {
          city?: string
          competitor_urls?: Json
          created_at?: string
          events_cache?: Json | null
          focus_metric?: string
          id?: string
          is_active?: boolean
          max_variation_pct?: number
          postal_code?: string | null
          pricing_strategy?: string
          pricing_thresholds?: Json | null
          shared_context?: string | null
          suite_amenities?: Json
          timezone?: string
          unit_goals?: Json | null
          unit_id?: string
          updated_at?: string
          weather_insight_cache?: Json | null
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
          context_mode: string
          created_at: string
          id: string
          messages: Json
          status: Database["public"]["Enums"]["conversation_status"]
          title: string | null
          unit_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context_mode?: string
          created_at?: string
          id?: string
          messages?: Json
          status?: Database["public"]["Enums"]["conversation_status"]
          title?: string | null
          unit_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context_mode?: string
          created_at?: string
          id?: string
          messages?: Json
          status?: Database["public"]["Enums"]["conversation_status"]
          title?: string | null
          unit_id?: string
          updated_at?: string
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
      rm_pricing_lessons: {
        Row: {
          attributed_pricing_pct: number | null
          canal: string | null
          categoria: string
          checkpoint_days: number
          conditions: Json | null
          delta_giro_pct: number | null
          delta_ocupacao_pp: number | null
          delta_revpar_pct: number | null
          delta_ticket_pct: number | null
          dia_tipo: string
          id: string
          implied_elasticity: number | null
          observed_at: string
          periodo: string
          preco_anterior: number
          preco_novo: number
          proposal_id: string | null
          unit_id: string
          variacao_pct: number
          verdict: string
        }
        Insert: {
          attributed_pricing_pct?: number | null
          canal?: string | null
          categoria: string
          checkpoint_days: number
          conditions?: Json | null
          delta_giro_pct?: number | null
          delta_ocupacao_pp?: number | null
          delta_revpar_pct?: number | null
          delta_ticket_pct?: number | null
          dia_tipo: string
          id?: string
          implied_elasticity?: number | null
          observed_at?: string
          periodo: string
          preco_anterior: number
          preco_novo: number
          proposal_id?: string | null
          unit_id: string
          variacao_pct: number
          verdict: string
        }
        Update: {
          attributed_pricing_pct?: number | null
          canal?: string | null
          categoria?: string
          checkpoint_days?: number
          conditions?: Json | null
          delta_giro_pct?: number | null
          delta_ocupacao_pp?: number | null
          delta_revpar_pct?: number | null
          delta_ticket_pct?: number | null
          dia_tipo?: string
          id?: string
          implied_elasticity?: number | null
          observed_at?: string
          periodo?: string
          preco_anterior?: number
          preco_novo?: number
          proposal_id?: string | null
          unit_id?: string
          variacao_pct?: number
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_pricing_lessons_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "price_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rm_pricing_lessons_unit_id_fkey"
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
      rm_weather_observations: {
        Row: {
          created_at: string | null
          giro: number | null
          id: string
          is_weekend: boolean | null
          observed_date: string
          occupancy_rate: number | null
          revpar: number | null
          temp_avg: number | null
          ticket_avg: number | null
          total_rentals: number | null
          unit_id: string
          weather_condition: string
          weather_description: string | null
        }
        Insert: {
          created_at?: string | null
          giro?: number | null
          id?: string
          is_weekend?: boolean | null
          observed_date: string
          occupancy_rate?: number | null
          revpar?: number | null
          temp_avg?: number | null
          ticket_avg?: number | null
          total_rentals?: number | null
          unit_id: string
          weather_condition: string
          weather_description?: string | null
        }
        Update: {
          created_at?: string | null
          giro?: number | null
          id?: string
          is_weekend?: boolean | null
          observed_date?: string
          occupancy_rate?: number | null
          revpar?: number | null
          temp_avg?: number | null
          ticket_avg?: number | null
          total_rentals?: number | null
          unit_id?: string
          weather_condition?: string
          weather_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rm_weather_observations_unit_id_fkey"
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
      scheduled_reviews: {
        Row: {
          checkpoint_days: number
          conv_id: string | null
          created_at: string
          created_by: string
          executed_at: string | null
          id: string
          note: string | null
          proposal_id: string | null
          scheduled_at: string
          status: string
          unit_id: string
        }
        Insert: {
          checkpoint_days?: number
          conv_id?: string | null
          created_at?: string
          created_by: string
          executed_at?: string | null
          id?: string
          note?: string | null
          proposal_id?: string | null
          scheduled_at?: string
          status?: string
          unit_id: string
        }
        Update: {
          checkpoint_days?: number
          conv_id?: string | null
          created_at?: string
          created_by?: string
          executed_at?: string | null
          id?: string
          note?: string | null
          proposal_id?: string | null
          scheduled_at?: string
          status?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reviews_conv_id_fkey"
            columns: ["conv_id"]
            isOneToOne: false
            referencedRelation: "rm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reviews_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "price_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reviews_unit_id_fkey"
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
      unit_capacity: {
        Row: {
          categoria: string
          created_at: string
          created_by: string | null
          custo_variavel_locacao: number
          id: string
          notes: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          categoria: string
          created_at?: string
          created_by?: string | null
          custo_variavel_locacao?: number
          id?: string
          notes?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          categoria?: string
          created_at?: string
          created_by?: string | null
          custo_variavel_locacao?: number
          id?: string
          notes?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_capacity_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_channel_costs: {
        Row: {
          canal: string
          comissao_pct: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          taxa_fixa: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          canal: string
          comissao_pct?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          taxa_fixa?: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          canal?: string
          comissao_pct?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          taxa_fixa?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_channel_costs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_date: string
          event_end_date: string | null
          event_type: string
          id: string
          impact_description: string | null
          title: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_date: string
          event_end_date?: string | null
          event_type?: string
          id?: string
          impact_description?: string | null
          title: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_date?: string
          event_end_date?: string | null
          event_type?: string
          id?: string
          impact_description?: string | null
          title?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          address: string | null
          api_base_url: string | null
          api_slug: string | null
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
          api_base_url?: string | null
          api_slug?: string | null
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
          api_base_url?: string | null
          api_slug?: string | null
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
