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
      candidate_notes: {
        Row: {
          candidate_id: string
          content: string
          created_at: string
          created_by: string
          id: string
          shortlist_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          content: string
          created_at?: string
          created_by: string
          id?: string
          shortlist_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          shortlist_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      candidate_reminders: {
        Row: {
          candidate_id: string
          candidate_name: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string
          id: string
          job_id: string | null
          job_title: string | null
          shortlist_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          candidate_name?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at: string
          id?: string
          job_id?: string | null
          job_title?: string | null
          shortlist_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          candidate_name?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string
          id?: string
          job_id?: string | null
          job_title?: string | null
          shortlist_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      contact_submissions: {
        Row: {
          company: string | null
          created_at: string
          email: string
          id: string
          message: string
          name: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
        }
        Relationships: []
      }
      event_registrations: {
        Row: {
          event_id: string
          id: string
          registered_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          registered_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          registered_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string
          background_image_url: string
          created_by: string
          creator: string
          date: string
          description: string
          id: string
          target_date: string
          time: string
          title: string
        }
        Insert: {
          address: string
          background_image_url: string
          created_by?: string
          creator: string
          date: string
          description: string
          id?: string
          target_date: string
          time: string
          title: string
        }
        Update: {
          address?: string
          background_image_url?: string
          created_by?: string
          creator?: string
          date?: string
          description?: string
          id?: string
          target_date?: string
          time?: string
          title?: string
        }
        Relationships: []
      }
      inmail_queue: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          message: string
          network_distance: number | null
          recipient_headline: string | null
          recipient_name: string | null
          recipient_profile_id: string
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
          user_timezone: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          message: string
          network_distance?: number | null
          recipient_headline?: string | null
          recipient_name?: string | null
          recipient_profile_id: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_timezone?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          message?: string
          network_distance?: number | null
          recipient_headline?: string | null
          recipient_name?: string | null
          recipient_profile_id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_timezone?: string
        }
        Relationships: []
      }
      job_favorites: {
        Row: {
          created_at: string
          id: string
          job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          user_id?: string
        }
        Relationships: []
      }
      job_skills_cache: {
        Row: {
          created_at: string
          id: string
          job_id: string
          skills: string[]
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          skills?: string[]
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          skills?: string[]
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      notion_api_cache: {
        Row: {
          cache_key: string
          payload: Json
          updated_at: string
        }
        Insert: {
          cache_key: string
          payload: Json
          updated_at?: string
        }
        Update: {
          cache_key?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      nurturing_opportunities: {
        Row: {
          analysis_context: Json | null
          candidate_headline: string | null
          candidate_id: string
          candidate_name: string | null
          candidate_profile_url: string | null
          created_at: string
          created_by: string
          days_since_contact: number | null
          detected_intent: string | null
          expires_at: string | null
          id: string
          job_id: string | null
          job_title: string | null
          last_message_at: string | null
          linkedin_account_id: string | null
          priority_score: number
          reviewed_at: string | null
          sent_at: string | null
          status: string
          suggested_action: string
          suggested_message: string | null
          suggested_subject: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          analysis_context?: Json | null
          candidate_headline?: string | null
          candidate_id: string
          candidate_name?: string | null
          candidate_profile_url?: string | null
          created_at?: string
          created_by: string
          days_since_contact?: number | null
          detected_intent?: string | null
          expires_at?: string | null
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_message_at?: string | null
          linkedin_account_id?: string | null
          priority_score?: number
          reviewed_at?: string | null
          sent_at?: string | null
          status?: string
          suggested_action: string
          suggested_message?: string | null
          suggested_subject?: string | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          analysis_context?: Json | null
          candidate_headline?: string | null
          candidate_id?: string
          candidate_name?: string | null
          candidate_profile_url?: string | null
          created_at?: string
          created_by?: string
          days_since_contact?: number | null
          detected_intent?: string | null
          expires_at?: string | null
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_message_at?: string | null
          linkedin_account_id?: string | null
          priority_score?: number
          reviewed_at?: string | null
          sent_at?: string | null
          status?: string
          suggested_action?: string
          suggested_message?: string | null
          suggested_subject?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      outreach_sequences: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sequence_analytics: {
        Row: {
          created_at: string | null
          date: string
          id: string
          invites_accepted: number | null
          invites_sent: number | null
          messages_sent: number | null
          profile_visits: number | null
          replies_received: number | null
          sequence_id: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          invites_accepted?: number | null
          invites_sent?: number | null
          messages_sent?: number | null
          profile_visits?: number | null
          replies_received?: number | null
          sequence_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          invites_accepted?: number | null
          invites_sent?: number | null
          messages_sent?: number | null
          profile_visits?: number | null
          replies_received?: number | null
          sequence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_analytics_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_enrollments: {
        Row: {
          account_id: string
          completed_at: string | null
          connection_status: string | null
          created_at: string
          created_by: string
          current_step_order: number
          id: string
          job_id: string | null
          job_title: string | null
          last_check_at: string | null
          profile_headline: string | null
          profile_id: string
          profile_name: string | null
          profile_url: string | null
          replied_at: string | null
          sequence_id: string
          status: string
          updated_at: string
          user_timezone: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          connection_status?: string | null
          created_at?: string
          created_by: string
          current_step_order?: number
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_check_at?: string | null
          profile_headline?: string | null
          profile_id: string
          profile_name?: string | null
          profile_url?: string | null
          replied_at?: string | null
          sequence_id: string
          status?: string
          updated_at?: string
          user_timezone?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          connection_status?: string | null
          created_at?: string
          created_by?: string
          current_step_order?: number
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_check_at?: string | null
          profile_headline?: string | null
          profile_id?: string
          profile_name?: string | null
          profile_url?: string | null
          replied_at?: string | null
          sequence_id?: string
          status?: string
          updated_at?: string
          user_timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_step_executions: {
        Row: {
          created_at: string
          enrollment_id: string
          error_message: string | null
          executed_at: string | null
          final_message: string | null
          final_subject: string | null
          id: string
          scheduled_at: string
          skip_reason: string | null
          status: string
          step_id: string
          step_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enrollment_id: string
          error_message?: string | null
          executed_at?: string | null
          final_message?: string | null
          final_subject?: string | null
          id?: string
          scheduled_at: string
          skip_reason?: string | null
          status?: string
          step_id: string
          step_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enrollment_id?: string
          error_message?: string | null
          executed_at?: string | null
          final_message?: string | null
          final_subject?: string | null
          id?: string
          scheduled_at?: string
          skip_reason?: string | null
          status?: string
          step_id?: string
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_step_executions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "sequence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_step_executions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          action_type: string
          ai_tone: string | null
          condition_type: string | null
          created_at: string
          delay_days: number
          delay_hours: number
          id: string
          message_template: string | null
          preferred_hour_end: number | null
          preferred_hour_start: number | null
          sequence_id: string
          step_order: number
          subject_template: string | null
          timeout_branch_step_id: string | null
          timeout_days: number | null
          use_ai_personalization: boolean
          wait_for_event: string | null
        }
        Insert: {
          action_type: string
          ai_tone?: string | null
          condition_type?: string | null
          created_at?: string
          delay_days?: number
          delay_hours?: number
          id?: string
          message_template?: string | null
          preferred_hour_end?: number | null
          preferred_hour_start?: number | null
          sequence_id: string
          step_order: number
          subject_template?: string | null
          timeout_branch_step_id?: string | null
          timeout_days?: number | null
          use_ai_personalization?: boolean
          wait_for_event?: string | null
        }
        Update: {
          action_type?: string
          ai_tone?: string | null
          condition_type?: string | null
          created_at?: string
          delay_days?: number
          delay_hours?: number
          id?: string
          message_template?: string | null
          preferred_hour_end?: number | null
          preferred_hour_start?: number | null
          sequence_id?: string
          step_order?: number
          subject_template?: string | null
          timeout_branch_step_id?: string | null
          timeout_days?: number | null
          use_ai_personalization?: boolean
          wait_for_event?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_timeout_branch_step_id_fkey"
            columns: ["timeout_branch_step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    },
  },
} as const
