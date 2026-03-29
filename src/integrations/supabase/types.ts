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
      agent_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          id: string
          job_id: string | null
          job_title: string | null
          organization_id: string | null
          project_id: string | null
          results_summary: Json | null
          search_config: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          job_id?: string | null
          job_title?: string | null
          organization_id?: string | null
          project_id?: string | null
          results_summary?: Json | null
          search_config?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string | null
          job_title?: string | null
          organization_id?: string | null
          project_id?: string | null
          results_summary?: Json | null
          search_config?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_balances: {
        Row: {
          created_at: string
          credits_remaining: number
          credits_total: number
          id: string
          organization_id: string
          period_end: string
          period_start: string
          plan_credits: number
          topup_credits: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_remaining?: number
          credits_total?: number
          id?: string
          organization_id: string
          period_end?: string
          period_start?: string
          plan_credits?: number
          topup_credits?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_remaining?: number
          credits_total?: number
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          plan_credits?: number
          topup_credits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_transactions: {
        Row: {
          action: string
          amount: number
          balance_after: number
          cost_usd: number
          created_at: string
          credits_used: number
          description: string | null
          id: string
          metadata: Json | null
          model_id: string | null
          organization_id: string
          source: string
          tokens_input: number
          tokens_output: number
          user_id: string
        }
        Insert: {
          action: string
          amount: number
          balance_after: number
          cost_usd?: number
          created_at?: string
          credits_used?: number
          description?: string | null
          id?: string
          metadata?: Json | null
          model_id?: string | null
          organization_id: string
          source?: string
          tokens_input?: number
          tokens_output?: number
          user_id: string
        }
        Update: {
          action?: string
          amount?: number
          balance_after?: number
          cost_usd?: number
          created_at?: string
          credits_used?: number
          description?: string | null
          id?: string
          metadata?: Json | null
          model_id?: string | null
          organization_id?: string
          source?: string
          tokens_input?: number
          tokens_output?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      aircall_calls: {
        Row: {
          aircall_id: number
          answered_at: string | null
          callee_name: string | null
          callee_number: string | null
          caller_name: string | null
          caller_number: string | null
          created_at: string
          direction: string
          duration: number | null
          ended_at: string | null
          id: string
          matched_airtable_candidate_id: string | null
          matched_candidate_name: string | null
          matched_candidate_phone: string | null
          matched_linkedin_profile_id: string | null
          notes: string | null
          organization_id: string | null
          raw_data: Json | null
          raw_number: string | null
          recording_url: string | null
          started_at: string | null
          status: string | null
          synced_at: string
          tags: string[] | null
          user_email: string | null
          user_name: string | null
          voicemail_url: string | null
        }
        Insert: {
          aircall_id: number
          answered_at?: string | null
          callee_name?: string | null
          callee_number?: string | null
          caller_name?: string | null
          caller_number?: string | null
          created_at?: string
          direction: string
          duration?: number | null
          ended_at?: string | null
          id?: string
          matched_airtable_candidate_id?: string | null
          matched_candidate_name?: string | null
          matched_candidate_phone?: string | null
          matched_linkedin_profile_id?: string | null
          notes?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          raw_number?: string | null
          recording_url?: string | null
          started_at?: string | null
          status?: string | null
          synced_at?: string
          tags?: string[] | null
          user_email?: string | null
          user_name?: string | null
          voicemail_url?: string | null
        }
        Update: {
          aircall_id?: number
          answered_at?: string | null
          callee_name?: string | null
          callee_number?: string | null
          caller_name?: string | null
          caller_number?: string | null
          created_at?: string
          direction?: string
          duration?: number | null
          ended_at?: string | null
          id?: string
          matched_airtable_candidate_id?: string | null
          matched_candidate_name?: string | null
          matched_candidate_phone?: string | null
          matched_linkedin_profile_id?: string | null
          notes?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          raw_number?: string | null
          recording_url?: string | null
          started_at?: string | null
          status?: string | null
          synced_at?: string
          tags?: string[] | null
          user_email?: string | null
          user_name?: string | null
          voicemail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aircall_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_appointments: {
        Row: {
          airtable_id: string
          appointment_date: string | null
          appointment_type: string | null
          candidate_airtable_id: string | null
          contact_airtable_id: string | null
          created_at: string
          id: string
          job_airtable_id: string | null
          notes: string | null
          organization_id: string | null
          raw_data: Json | null
          shortlist_airtable_id: string | null
          source_base: string
          status: string | null
          synced_at: string
          title: string | null
        }
        Insert: {
          airtable_id: string
          appointment_date?: string | null
          appointment_type?: string | null
          candidate_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          id?: string
          job_airtable_id?: string | null
          notes?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Update: {
          airtable_id?: string
          appointment_date?: string | null
          appointment_type?: string | null
          candidate_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          id?: string
          job_airtable_id?: string | null
          notes?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_candidates: {
        Row: {
          airtable_id: string
          created_at: string
          education_level: string | null
          email: string | null
          experience: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          linkedin_url: string | null
          organization_id: string | null
          phone: string | null
          preferred_contract: string | null
          raw_data: Json | null
          skills: string[] | null
          source_base: string
          status: string | null
          synced_at: string
        }
        Insert: {
          airtable_id: string
          created_at?: string
          education_level?: string | null
          email?: string | null
          experience?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          organization_id?: string | null
          phone?: string | null
          preferred_contract?: string | null
          raw_data?: Json | null
          skills?: string[] | null
          source_base?: string
          status?: string | null
          synced_at?: string
        }
        Update: {
          airtable_id?: string
          created_at?: string
          education_level?: string | null
          email?: string | null
          experience?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          linkedin_url?: string | null
          organization_id?: string | null
          phone?: string | null
          preferred_contract?: string | null
          raw_data?: Json | null
          skills?: string[] | null
          source_base?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "airtable_candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_companies: {
        Row: {
          airtable_id: string
          benefits: string | null
          city: string | null
          created_at: string
          description: string | null
          headcount: string | null
          id: string
          name: string
          organization_id: string | null
          raw_data: Json | null
          source_base: string
          synced_at: string
          tech_stack: string[] | null
          year_founded: string | null
        }
        Insert: {
          airtable_id: string
          benefits?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          headcount?: string | null
          id?: string
          name: string
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          tech_stack?: string[] | null
          year_founded?: string | null
        }
        Update: {
          airtable_id?: string
          benefits?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          headcount?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          tech_stack?: string[] | null
          year_founded?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_contacts: {
        Row: {
          airtable_id: string
          city: string | null
          company_airtable_id: string | null
          contact_type: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string | null
          raw_data: Json | null
          source_base: string
          status: string | null
          synced_at: string
          title: string | null
        }
        Insert: {
          airtable_id: string
          city?: string | null
          company_airtable_id?: string | null
          contact_type?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Update: {
          airtable_id?: string
          city?: string | null
          company_airtable_id?: string | null
          contact_type?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_glossary: {
        Row: {
          airtable_id: string
          category: string | null
          created_at: string
          description: string | null
          id: string
          organization_id: string | null
          raw_data: Json | null
          source_base: string
          synced_at: string
          term: string | null
        }
        Insert: {
          airtable_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          term?: string | null
        }
        Update: {
          airtable_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_glossary_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_jobs: {
        Row: {
          airtable_id: string
          city: string | null
          company_airtable_id: string | null
          contract_type: string | null
          created_at: string
          criteria: string | null
          description: string | null
          id: string
          organization_id: string | null
          raw_data: Json | null
          salary: string | null
          source_base: string
          status: string | null
          synced_at: string
          title: string | null
        }
        Insert: {
          airtable_id: string
          city?: string | null
          company_airtable_id?: string | null
          contract_type?: string | null
          created_at?: string
          criteria?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
          raw_data?: Json | null
          salary?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Update: {
          airtable_id?: string
          city?: string | null
          company_airtable_id?: string | null
          contract_type?: string | null
          created_at?: string
          criteria?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
          raw_data?: Json | null
          salary?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_kpi: {
        Row: {
          airtable_id: string
          category: string | null
          created_at: string
          id: string
          name: string | null
          organization_id: string | null
          period: string | null
          raw_data: Json | null
          source_base: string
          synced_at: string
          value: string | null
        }
        Insert: {
          airtable_id: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string | null
          organization_id?: string | null
          period?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          value?: string | null
        }
        Update: {
          airtable_id?: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string | null
          organization_id?: string | null
          period?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_kpi_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_notes: {
        Row: {
          airtable_id: string
          author: string | null
          candidate_airtable_id: string | null
          contact_airtable_id: string | null
          created_at: string
          detail: string | null
          id: string
          job_airtable_id: string | null
          note_date: string | null
          note_type: string | null
          organization_id: string | null
          raw_data: Json | null
          shortlist_airtable_id: string | null
          source_base: string
          synced_at: string
          title: string | null
        }
        Insert: {
          airtable_id: string
          author?: string | null
          candidate_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          job_airtable_id?: string | null
          note_date?: string | null
          note_type?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          synced_at?: string
          title?: string | null
        }
        Update: {
          airtable_id?: string
          author?: string | null
          candidate_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          job_airtable_id?: string | null
          note_date?: string | null
          note_type?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          synced_at?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_placements: {
        Row: {
          airtable_id: string
          candidate_airtable_id: string | null
          company_airtable_id: string | null
          contract_type: string | null
          created_at: string
          fees: string | null
          id: string
          name: string | null
          organization_id: string | null
          raw_data: Json | null
          salary: string | null
          source_base: string
          start_date: string | null
          status: string | null
          synced_at: string
        }
        Insert: {
          airtable_id: string
          candidate_airtable_id?: string | null
          company_airtable_id?: string | null
          contract_type?: string | null
          created_at?: string
          fees?: string | null
          id?: string
          name?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          salary?: string | null
          source_base?: string
          start_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Update: {
          airtable_id?: string
          candidate_airtable_id?: string | null
          company_airtable_id?: string | null
          contract_type?: string | null
          created_at?: string
          fees?: string | null
          id?: string
          name?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          salary?: string | null
          source_base?: string
          start_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "airtable_placements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_shortlists: {
        Row: {
          airtable_id: string
          candidate_airtable_id: string | null
          company_airtable_id: string | null
          contact_airtable_id: string | null
          created_at: string
          date_added: string | null
          estimated_fees: string | null
          id: string
          job_airtable_id: string | null
          organization_id: string | null
          raw_data: Json | null
          salary_proposed: string | null
          source_base: string
          status: string | null
          synced_at: string
        }
        Insert: {
          airtable_id: string
          candidate_airtable_id?: string | null
          company_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          date_added?: string | null
          estimated_fees?: string | null
          id?: string
          job_airtable_id?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          salary_proposed?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
        }
        Update: {
          airtable_id?: string
          candidate_airtable_id?: string | null
          company_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          date_added?: string | null
          estimated_fees?: string | null
          id?: string
          job_airtable_id?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          salary_proposed?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "airtable_shortlists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_shortlists_cumulated: {
        Row: {
          airtable_id: string
          candidate_airtable_id: string | null
          company_airtable_id: string | null
          created_at: string
          id: string
          last_shortlist_date: string | null
          organization_id: string | null
          raw_data: Json | null
          source_base: string
          synced_at: string
          total_shortlists: number | null
        }
        Insert: {
          airtable_id: string
          candidate_airtable_id?: string | null
          company_airtable_id?: string | null
          created_at?: string
          id?: string
          last_shortlist_date?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          total_shortlists?: number | null
        }
        Update: {
          airtable_id?: string
          candidate_airtable_id?: string | null
          company_airtable_id?: string | null
          created_at?: string
          id?: string
          last_shortlist_date?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          total_shortlists?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_shortlists_cumulated_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airtable_sync_meta: {
        Row: {
          id: string
          last_synced_at: string
          records_count: number | null
          source_base: string
          status: string | null
          table_name: string
        }
        Insert: {
          id?: string
          last_synced_at?: string
          records_count?: number | null
          source_base?: string
          status?: string | null
          table_name: string
        }
        Update: {
          id?: string
          last_synced_at?: string
          records_count?: number | null
          source_base?: string
          status?: string | null
          table_name?: string
        }
        Relationships: []
      }
      airtable_tasks: {
        Row: {
          airtable_id: string
          assignee: string | null
          candidate_airtable_id: string | null
          contact_airtable_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          job_airtable_id: string | null
          organization_id: string | null
          raw_data: Json | null
          shortlist_airtable_id: string | null
          source_base: string
          status: string | null
          synced_at: string
          task_type: string | null
          title: string | null
        }
        Insert: {
          airtable_id: string
          assignee?: string | null
          candidate_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          job_airtable_id?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          task_type?: string | null
          title?: string | null
        }
        Update: {
          airtable_id?: string
          assignee?: string | null
          candidate_airtable_id?: string | null
          contact_airtable_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          job_airtable_id?: string | null
          organization_id?: string | null
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          task_type?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airtable_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_coaching_sessions: {
        Row: {
          alerts_log: Json | null
          candidate_id: string
          coach_feed: Json | null
          created_at: string | null
          created_by: string
          criteria_detected: Json | null
          duration_seconds: number | null
          id: string
          job_id: string
          organization_id: string | null
          report: Json | null
          scorecard_id: string
          status: string | null
          transcript: string | null
        }
        Insert: {
          alerts_log?: Json | null
          candidate_id: string
          coach_feed?: Json | null
          created_at?: string | null
          created_by: string
          criteria_detected?: Json | null
          duration_seconds?: number | null
          id?: string
          job_id: string
          organization_id?: string | null
          report?: Json | null
          scorecard_id: string
          status?: string | null
          transcript?: string | null
        }
        Update: {
          alerts_log?: Json | null
          candidate_id?: string
          coach_feed?: Json | null
          created_at?: string | null
          created_by?: string
          criteria_detected?: Json | null
          duration_seconds?: number | null
          id?: string
          job_id?: string
          organization_id?: string | null
          report?: Json | null
          scorecard_id?: string
          status?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_coaching_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_assignments: {
        Row: {
          assigned_by: string | null
          assigned_to: string
          assignment_method: string
          candidate_id: string
          candidate_name: string | null
          created_at: string
          id: string
          job_id: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_to: string
          assignment_method?: string
          candidate_id: string
          candidate_name?: string | null
          created_at?: string
          id?: string
          job_id: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          assigned_to?: string
          assignment_method?: string
          candidate_id?: string
          candidate_name?: string | null
          created_at?: string
          id?: string
          job_id?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_comments: {
        Row: {
          candidate_id: string
          content: string
          created_at: string
          created_by: string
          id: string
          job_id: string | null
          mentions: string[] | null
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          content: string
          created_at?: string
          created_by: string
          id?: string
          job_id?: string | null
          mentions?: string[] | null
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string | null
          mentions?: string[] | null
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_evaluations: {
        Row: {
          ai_generated: boolean
          candidate_id: string
          comments: Json
          created_at: string
          created_by: string
          criteria: Json
          follow_up_notes: string | null
          id: string
          interview_stage: string | null
          job_id: string | null
          job_title: string | null
          organization_id: string | null
          overall_score: number | null
          ratings: Json
          recommendation: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          ai_generated?: boolean
          candidate_id: string
          comments?: Json
          created_at?: string
          created_by: string
          criteria?: Json
          follow_up_notes?: string | null
          id?: string
          interview_stage?: string | null
          job_id?: string | null
          job_title?: string | null
          organization_id?: string | null
          overall_score?: number | null
          ratings?: Json
          recommendation?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          ai_generated?: boolean
          candidate_id?: string
          comments?: Json
          created_at?: string
          created_by?: string
          criteria?: Json
          follow_up_notes?: string | null
          id?: string
          interview_stage?: string | null
          job_id?: string | null
          job_title?: string | null
          organization_id?: string | null
          overall_score?: number | null
          ratings?: Json
          recommendation?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_notes: {
        Row: {
          candidate_id: string
          content: string
          created_at: string
          created_by: string
          id: string
          organization_id: string | null
          shortlist_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          content: string
          created_at?: string
          created_by: string
          id?: string
          organization_id?: string | null
          shortlist_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string | null
          shortlist_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_portal_tokens: {
        Row: {
          candidate_id: string
          candidate_name: string | null
          company_description: string | null
          company_logo_url: string | null
          company_name: string | null
          created_at: string
          created_by: string
          documents: Json | null
          estimated_days_to_next: number | null
          expires_at: string | null
          faq: Json | null
          id: string
          is_active: boolean
          job_id: string | null
          job_title: string | null
          next_steps: string | null
          organization_id: string | null
          pipeline_stage: string | null
          recruiter_email: string | null
          recruiter_name: string | null
          recruiter_phone: string | null
          stage_updated_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          candidate_name?: string | null
          company_description?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string
          created_by: string
          documents?: Json | null
          estimated_days_to_next?: number | null
          expires_at?: string | null
          faq?: Json | null
          id?: string
          is_active?: boolean
          job_id?: string | null
          job_title?: string | null
          next_steps?: string | null
          organization_id?: string | null
          pipeline_stage?: string | null
          recruiter_email?: string | null
          recruiter_name?: string | null
          recruiter_phone?: string | null
          stage_updated_at?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          candidate_name?: string | null
          company_description?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string
          documents?: Json | null
          estimated_days_to_next?: number | null
          expires_at?: string | null
          faq?: Json | null
          id?: string
          is_active?: boolean
          job_id?: string | null
          job_title?: string | null
          next_steps?: string | null
          organization_id?: string | null
          pipeline_stage?: string | null
          recruiter_email?: string | null
          recruiter_name?: string | null
          recruiter_phone?: string | null
          stage_updated_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_portal_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profiles: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string | null
          embedding: string | null
          headline: string | null
          id: string
          name: string | null
          organization_id: string | null
          skills: string[] | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          headline?: string | null
          id?: string
          name?: string | null
          organization_id?: string | null
          skills?: string[] | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          embedding?: string | null
          headline?: string | null
          id?: string
          name?: string | null
          organization_id?: string | null
          skills?: string[] | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          shortlist_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_reminders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      career_page_scans: {
        Row: {
          careers_url: string
          id: string
          new_roles_count: number | null
          organization_id: string
          roles_found: Json | null
          scanned_at: string | null
        }
        Insert: {
          careers_url: string
          id?: string
          new_roles_count?: number | null
          organization_id: string
          roles_found?: Json | null
          scanned_at?: string | null
        }
        Update: {
          careers_url?: string
          id?: string
          new_roles_count?: number | null
          organization_id?: string
          roles_found?: Json | null
          scanned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "career_page_scans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_categories: {
        Row: {
          account_id: string
          category: string
          chat_id: string
          created_at: string
          created_by: string
          id: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          category: string
          chat_id: string
          created_at?: string
          created_by: string
          id?: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          category?: string
          chat_id?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_tokens: {
        Row: {
          client_email: string | null
          client_name: string
          created_at: string | null
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          organization_id: string
          permissions: Json | null
          project_ids: string[] | null
          token: string
        }
        Insert: {
          client_email?: string | null
          client_name: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          organization_id: string
          permissions?: Json | null
          project_ids?: string[] | null
          token?: string
        }
        Update: {
          client_email?: string | null
          client_name?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          organization_id?: string
          permissions?: Json | null
          project_ids?: string[] | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_instances: {
        Row: {
          config: Json | null
          connector_id: string
          created_at: string
          error_message: string | null
          id: string
          last_sync_at: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json | null
          connector_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json | null
          connector_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_instances_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "connector_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_registry: {
        Row: {
          category: string
          config_schema: Json | null
          created_at: string
          description: string | null
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          category?: string
          config_schema?: Json | null
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id: string
          is_active?: boolean
          name: string
        }
        Update: {
          category?: string
          config_schema?: Json | null
          created_at?: string
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
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
      credit_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          credits: number
          currency: string
          id: string
          organization_id: string
          pack_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          credits?: number
          currency?: string
          id?: string
          organization_id: string
          pack_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          credits?: number
          currency?: string
          id?: string
          organization_id?: string
          pack_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      enrichment_cache: {
        Row: {
          cache_key: string
          created_at: string
          result: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          result: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          result?: Json
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
      feature_activations: {
        Row: {
          checklist: Json | null
          contract_document_url: string | null
          contract_signed_at: string | null
          created_at: string | null
          feature: string
          id: string
          organization_id: string
          payment_method_added: boolean | null
          status: string | null
          updated_at: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          checklist?: Json | null
          contract_document_url?: string | null
          contract_signed_at?: string | null
          created_at?: string | null
          feature: string
          id?: string
          organization_id: string
          payment_method_added?: boolean | null
          status?: string | null
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          checklist?: Json | null
          contract_document_url?: string | null
          contract_signed_at?: string | null
          created_at?: string | null
          feature?: string
          id?: string
          organization_id?: string
          payment_method_added?: boolean | null
          status?: string | null
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_activations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_applications: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          match_score: number | null
          message: string | null
          project_id: string
          recruiter_org_id: string | null
          recruiter_user_id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          match_score?: number | null
          message?: string | null
          project_id: string
          recruiter_org_id?: string | null
          recruiter_user_id: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          match_score?: number | null
          message?: string | null
          project_id?: string
          recruiter_org_id?: string | null
          recruiter_user_id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hunt_applications_recruiter_org_id_fkey"
            columns: ["recruiter_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "inmail_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      job_assignments: {
        Row: {
          assigned_by: string
          created_at: string
          id: string
          job_id: string
          job_title: string | null
          member_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          assigned_by: string
          created_at?: string
          id?: string
          job_id: string
          job_title?: string | null
          member_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string
          created_at?: string
          id?: string
          job_id?: string
          job_title?: string | null
          member_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_candidate_status: {
        Row: {
          candidate_headline: string | null
          candidate_id: string
          candidate_name: string | null
          created_at: string
          created_by: string
          id: string
          job_id: string
          linkedin_profile_data: Json | null
          linkedin_profile_url: string | null
          notion_candidate_id: string | null
          notion_shortlist_id: string | null
          notion_synced_at: string | null
          organization_id: string | null
          pipeline_stage: string | null
          project_id: string | null
          recommendation: string | null
          score: number | null
          scoring_details: Json | null
          skip_reason: string | null
          status: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          candidate_headline?: string | null
          candidate_id: string
          candidate_name?: string | null
          created_at?: string
          created_by: string
          id?: string
          job_id: string
          linkedin_profile_data?: Json | null
          linkedin_profile_url?: string | null
          notion_candidate_id?: string | null
          notion_shortlist_id?: string | null
          notion_synced_at?: string | null
          organization_id?: string | null
          pipeline_stage?: string | null
          project_id?: string | null
          recommendation?: string | null
          score?: number | null
          scoring_details?: Json | null
          skip_reason?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          candidate_headline?: string | null
          candidate_id?: string
          candidate_name?: string | null
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string
          linkedin_profile_data?: Json | null
          linkedin_profile_url?: string | null
          notion_candidate_id?: string | null
          notion_shortlist_id?: string | null
          notion_synced_at?: string | null
          organization_id?: string | null
          pipeline_stage?: string | null
          project_id?: string | null
          recommendation?: string | null
          score?: number | null
          scoring_details?: Json | null
          skip_reason?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_candidate_status_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_candidate_status_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
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
      job_profiles: {
        Row: {
          created_at: string
          description: string | null
          embedding: string | null
          id: string
          job_id: string
          requirements: string | null
          skills: string[] | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          embedding?: string | null
          id?: string
          job_id: string
          requirements?: string | null
          skills?: string[] | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          embedding?: string | null
          id?: string
          job_id?: string
          requirements?: string | null
          skills?: string[] | null
          title?: string | null
          updated_at?: string
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
      knowledge_chunks: {
        Row: {
          chunk_type: string
          content: string
          content_hash: string
          created_at: string
          embedding: string | null
          entity_id: string
          entity_type: string
          expires_at: string | null
          id: string
          metadata: Json | null
          organization_id: string
          source_connector_id: string | null
          source_id: string | null
          source_table: string | null
          updated_at: string
        }
        Insert: {
          chunk_type: string
          content: string
          content_hash: string
          created_at?: string
          embedding?: string | null
          entity_id: string
          entity_type: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          source_connector_id?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string
        }
        Update: {
          chunk_type?: string
          content?: string
          content_hash?: string
          created_at?: string
          embedding?: string | null
          entity_id?: string
          entity_type?: string
          expires_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          source_connector_id?: string | null
          source_id?: string | null
          source_table?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_scores: {
        Row: {
          candidate_id: string
          confidence: number
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          organization_id: string | null
          score: number
          scoring_result: Json
        }
        Insert: {
          candidate_id: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          job_id: string
          organization_id?: string | null
          score?: number
          scoring_result?: Json
        }
        Update: {
          candidate_id?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string
          organization_id?: string | null
          score?: number
          scoring_result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "match_scores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_linkedin_accounts: {
        Row: {
          id: string
          linked_at: string
          linked_by: string
          linkedin_account_id: string
          linkedin_account_name: string | null
          organization_id: string
          proxy_country: string | null
          proxy_host: string | null
          proxy_is_active: boolean | null
          proxy_last_error: string | null
          proxy_mode: string | null
          proxy_port: number | null
          proxy_protocol: string | null
          proxy_updated_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          linked_at?: string
          linked_by: string
          linkedin_account_id: string
          linkedin_account_name?: string | null
          organization_id: string
          proxy_country?: string | null
          proxy_host?: string | null
          proxy_is_active?: boolean | null
          proxy_last_error?: string | null
          proxy_mode?: string | null
          proxy_port?: number | null
          proxy_protocol?: string | null
          proxy_updated_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          linked_at?: string
          linked_by?: string
          linkedin_account_id?: string
          linkedin_account_name?: string | null
          organization_id?: string
          proxy_country?: string | null
          proxy_host?: string | null
          proxy_is_active?: boolean | null
          proxy_last_error?: string | null
          proxy_mode?: string | null
          proxy_port?: number | null
          proxy_protocol?: string | null
          proxy_updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_linkedin_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_quotas: {
        Row: {
          created_at: string
          id: string
          max_inmails_per_day: number | null
          max_messages_per_day: number | null
          max_profile_visits_per_day: number | null
          max_searches_per_day: number | null
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_inmails_per_day?: number | null
          max_messages_per_day?: number | null
          max_profile_visits_per_day?: number | null
          max_searches_per_day?: number | null
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          max_inmails_per_day?: number | null
          max_messages_per_day?: number | null
          max_profile_visits_per_day?: number | null
          max_searches_per_day?: number | null
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_quotas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_analysis_cache: {
        Row: {
          account_id: string
          analysis: Json
          chat_id: string
          created_at: string
          id: string
          organization_id: string | null
          recipient_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          analysis?: Json
          chat_id: string
          created_at?: string
          id?: string
          organization_id?: string | null
          recipient_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          analysis?: Json
          chat_id?: string
          created_at?: string
          id?: string
          organization_id?: string | null
          recipient_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_analysis_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string
          message: string | null
          organization_id: string
          project_id: string
          role: string
          status: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by: string
          message?: string | null
          organization_id: string
          project_id: string
          role?: string
          status?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string
          message?: string | null
          organization_id?: string
          project_id?: string
          role?: string
          status?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_process_steps: {
        Row: {
          created_at: string | null
          description: string | null
          duration_minutes: number | null
          evaluation_criteria: Json | null
          id: string
          interviewer_name: string | null
          interviewer_type: string | null
          interviewer_user_id: string | null
          is_eliminatory: boolean | null
          name: string
          objectives: string[] | null
          organization_id: string
          project_id: string
          step_order: number
          template_source: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          evaluation_criteria?: Json | null
          id?: string
          interviewer_name?: string | null
          interviewer_type?: string | null
          interviewer_user_id?: string | null
          is_eliminatory?: boolean | null
          name: string
          objectives?: string[] | null
          organization_id: string
          project_id: string
          step_order: number
          template_source?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          evaluation_criteria?: Json | null
          id?: string
          interviewer_name?: string | null
          interviewer_type?: string | null
          interviewer_user_id?: string | null
          is_eliminatory?: boolean | null
          name?: string
          objectives?: string[] | null
          organization_id?: string
          project_id?: string
          step_order?: number
          template_source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mission_process_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_process_steps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_team: {
        Row: {
          created_at: string | null
          id: string
          permissions: Json | null
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permissions?: Json | null
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permissions?: Json | null
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_team_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          metadata: Json | null
          organization_id: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          metadata?: Json | null
          organization_id?: string | null
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          metadata?: Json | null
          organization_id?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "nurturing_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_integrations: {
        Row: {
          aircall_api_id: string | null
          aircall_api_token: string | null
          aircall_connected: boolean
          airtable_api_key: string | null
          airtable_base_id: string | null
          airtable_base_id_2: string | null
          airtable_connected: boolean
          anthropic_api_key: string | null
          apollo_api_key: string | null
          calendly_api_key: string | null
          calendly_connected: boolean
          created_at: string
          id: string
          notion_api_key: string | null
          notion_candidats_db_id: string | null
          notion_connected: boolean
          notion_postes_db_id: string | null
          notion_shortlist_db_id: string | null
          organization_id: string
          pdl_api_key: string | null
          unipile_api_key: string | null
          unipile_connected: boolean
          unipile_dsn: string | null
          updated_at: string
        }
        Insert: {
          aircall_api_id?: string | null
          aircall_api_token?: string | null
          aircall_connected?: boolean
          airtable_api_key?: string | null
          airtable_base_id?: string | null
          airtable_base_id_2?: string | null
          airtable_connected?: boolean
          anthropic_api_key?: string | null
          apollo_api_key?: string | null
          calendly_api_key?: string | null
          calendly_connected?: boolean
          created_at?: string
          id?: string
          notion_api_key?: string | null
          notion_candidats_db_id?: string | null
          notion_connected?: boolean
          notion_postes_db_id?: string | null
          notion_shortlist_db_id?: string | null
          organization_id: string
          pdl_api_key?: string | null
          unipile_api_key?: string | null
          unipile_connected?: boolean
          unipile_dsn?: string | null
          updated_at?: string
        }
        Update: {
          aircall_api_id?: string | null
          aircall_api_token?: string | null
          aircall_connected?: boolean
          airtable_api_key?: string | null
          airtable_base_id?: string | null
          airtable_base_id_2?: string | null
          airtable_connected?: boolean
          anthropic_api_key?: string | null
          apollo_api_key?: string | null
          calendly_api_key?: string | null
          calendly_connected?: boolean
          created_at?: string
          id?: string
          notion_api_key?: string | null
          notion_candidats_db_id?: string | null
          notion_connected?: boolean
          notion_postes_db_id?: string | null
          notion_shortlist_db_id?: string | null
          organization_id?: string
          pdl_api_key?: string | null
          unipile_api_key?: string | null
          unipile_connected?: boolean
          unipile_dsn?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role?: string
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_subscriptions: {
        Row: {
          billing_cycle: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          organization_id: string
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id: string
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id?: string
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          agency_permissions: Json | null
          annual_hires: string | null
          careers_url: string | null
          created_at: string
          created_by: string
          discovery_source: string | null
          freelance_mode: string | null
          id: string
          logo_url: string | null
          name: string
          org_type: string | null
          slug: string
          specializations: string[] | null
          team_size: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          agency_permissions?: Json | null
          annual_hires?: string | null
          careers_url?: string | null
          created_at?: string
          created_by: string
          discovery_source?: string | null
          freelance_mode?: string | null
          id?: string
          logo_url?: string | null
          name: string
          org_type?: string | null
          slug: string
          specializations?: string[] | null
          team_size?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          agency_permissions?: Json | null
          annual_hires?: string | null
          careers_url?: string | null
          created_at?: string
          created_by?: string
          discovery_source?: string | null
          freelance_mode?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          org_type?: string | null
          slug?: string
          specializations?: string[] | null
          team_size?: string | null
          updated_at?: string
          website?: string | null
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
          organization_id: string | null
          project_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_sequences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      process_templates: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean | null
          job_category: string | null
          name: string
          organization_id: string
          steps: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          job_category?: string | null
          name: string
          organization_id: string
          steps?: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          job_category?: string | null
          name?: string
          organization_id?: string
          steps?: Json
        }
        Relationships: [
          {
            foreignKeyName: "process_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_organization_id: string | null
          avg_time_to_fill_days: number | null
          created_at: string
          display_name: string | null
          experience_classifications: Json | null
          first_round_rate: number | null
          id: string
          intro_video_url: string | null
          job_title: string | null
          linkedin_skills: string[] | null
          linkedin_url: string | null
          mid_round_rate: number | null
          placements_count: number | null
          public_slug: string | null
          rating: number | null
          recruiter_bio: string | null
          recruiter_headline: string | null
          specializations: string[] | null
          testimonials: Json | null
          updated_at: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          active_organization_id?: string | null
          avg_time_to_fill_days?: number | null
          created_at?: string
          display_name?: string | null
          experience_classifications?: Json | null
          first_round_rate?: number | null
          id?: string
          intro_video_url?: string | null
          job_title?: string | null
          linkedin_skills?: string[] | null
          linkedin_url?: string | null
          mid_round_rate?: number | null
          placements_count?: number | null
          public_slug?: string | null
          rating?: number | null
          recruiter_bio?: string | null
          recruiter_headline?: string | null
          specializations?: string[] | null
          testimonials?: Json | null
          updated_at?: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          active_organization_id?: string | null
          avg_time_to_fill_days?: number | null
          created_at?: string
          display_name?: string | null
          experience_classifications?: Json | null
          first_round_rate?: number | null
          id?: string
          intro_video_url?: string | null
          job_title?: string | null
          linkedin_skills?: string[] | null
          linkedin_url?: string | null
          mid_round_rate?: number | null
          placements_count?: number | null
          public_slug?: string | null
          rating?: number | null
          recruiter_bio?: string | null
          recruiter_headline?: string | null
          specializations?: string[] | null
          testimonials?: Json | null
          updated_at?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_organization_id_fkey"
            columns: ["active_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prospection_icps: {
        Row: {
          created_at: string
          created_by: string
          criteria: Json
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string | null
          target_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          criteria?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string | null
          target_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          criteria?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string | null
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospection_icps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_sessions: {
        Row: {
          calendly_event_id: string | null
          calendly_invitee_id: string | null
          candidate_headline: string | null
          candidate_linkedin_url: string | null
          candidate_name: string | null
          candidate_profile_id: string | null
          client_name: string | null
          created_at: string
          created_by: string
          event_end_at: string | null
          event_location: string | null
          event_name: string | null
          event_start_at: string | null
          id: string
          invitee_email: string | null
          job_criteria: Json | null
          job_id: string | null
          job_title: string | null
          notes: string | null
          notion_candidate_id: string | null
          notion_shortlist_id: string | null
          notion_synced_at: string | null
          organization_id: string | null
          project_id: string | null
          scoring_summary: Json | null
          status: string
          updated_at: string
          verdict: string | null
          verdict_at: string | null
          verdict_by: string | null
          verdict_notes: string | null
        }
        Insert: {
          calendly_event_id?: string | null
          calendly_invitee_id?: string | null
          candidate_headline?: string | null
          candidate_linkedin_url?: string | null
          candidate_name?: string | null
          candidate_profile_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by: string
          event_end_at?: string | null
          event_location?: string | null
          event_name?: string | null
          event_start_at?: string | null
          id?: string
          invitee_email?: string | null
          job_criteria?: Json | null
          job_id?: string | null
          job_title?: string | null
          notes?: string | null
          notion_candidate_id?: string | null
          notion_shortlist_id?: string | null
          notion_synced_at?: string | null
          organization_id?: string | null
          project_id?: string | null
          scoring_summary?: Json | null
          status?: string
          updated_at?: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_by?: string | null
          verdict_notes?: string | null
        }
        Update: {
          calendly_event_id?: string | null
          calendly_invitee_id?: string | null
          candidate_headline?: string | null
          candidate_linkedin_url?: string | null
          candidate_name?: string | null
          candidate_profile_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string
          event_end_at?: string | null
          event_location?: string | null
          event_name?: string | null
          event_start_at?: string | null
          id?: string
          invitee_email?: string | null
          job_criteria?: Json | null
          job_id?: string | null
          job_title?: string | null
          notes?: string | null
          notion_candidate_id?: string | null
          notion_shortlist_id?: string | null
          notion_synced_at?: string | null
          organization_id?: string | null
          project_id?: string | null
          scoring_summary?: Json | null
          status?: string
          updated_at?: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_by?: string | null
          verdict_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qualification_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      round_robin_state: {
        Row: {
          id: string
          job_id: string
          last_assigned_at: string | null
          last_assigned_user_id: string | null
          organization_id: string
        }
        Insert: {
          id?: string
          job_id: string
          last_assigned_at?: string | null
          last_assigned_user_id?: string | null
          organization_id: string
        }
        Update: {
          id?: string
          job_id?: string
          last_assigned_at?: string | null
          last_assigned_user_id?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_robin_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_filter_presets: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          filters: Json
          id: string
          job_id: string | null
          job_title: string | null
          last_used_at: string | null
          name: string
          organization_id: string | null
          updated_at: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          filters?: Json
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_used_at?: string | null
          name: string
          organization_id?: string | null
          updated_at?: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          filters?: Json
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_used_at?: string | null
          name?: string
          organization_id?: string | null
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "saved_filter_presets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      search_history: {
        Row: {
          client_name: string | null
          created_at: string
          created_by: string
          dismissed_count: number
          filters_snapshot: Json
          id: string
          job_id: string
          job_title: string | null
          messaged_count: number
          organization_id: string | null
          project_id: string | null
          results_count: number
          search_api: string | null
          shortlisted_count: number
          treated_count: number
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          created_by: string
          dismissed_count?: number
          filters_snapshot?: Json
          id?: string
          job_id: string
          job_title?: string | null
          messaged_count?: number
          organization_id?: string | null
          project_id?: string | null
          results_count?: number
          search_api?: string | null
          shortlisted_count?: number
          treated_count?: number
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          created_at?: string
          created_by?: string
          dismissed_count?: number
          filters_snapshot?: Json
          id?: string
          job_id?: string
          job_title?: string | null
          messaged_count?: number
          organization_id?: string | null
          project_id?: string | null
          results_count?: number
          search_api?: string | null
          shortlisted_count?: number
          treated_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_analytics: {
        Row: {
          created_at: string | null
          date: string
          id: string
          invites_accepted: number | null
          invites_sent: number | null
          messages_sent: number | null
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          profile_visits?: number | null
          replies_received?: number | null
          sequence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_analytics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
          network_distance: string | null
          organization_id: string | null
          profile_headline: string | null
          profile_id: string
          profile_name: string | null
          profile_url: string | null
          provider_id: string | null
          replied_at: string | null
          resolved_profile_id: string | null
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
          network_distance?: string | null
          organization_id?: string | null
          profile_headline?: string | null
          profile_id: string
          profile_name?: string | null
          profile_url?: string | null
          provider_id?: string | null
          replied_at?: string | null
          resolved_profile_id?: string | null
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
          network_distance?: string | null
          organization_id?: string | null
          profile_headline?: string | null
          profile_id?: string
          profile_name?: string | null
          profile_url?: string | null
          provider_id?: string | null
          replied_at?: string | null
          resolved_profile_id?: string | null
          sequence_id?: string
          status?: string
          updated_at?: string
          user_timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "outreach_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_processing_lock: {
        Row: {
          id: string
          locked_at: string | null
          locked_by: string | null
        }
        Insert: {
          id?: string
          locked_at?: string | null
          locked_by?: string | null
        }
        Update: {
          id?: string
          locked_at?: string | null
          locked_by?: string | null
        }
        Relationships: []
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
          organization_id: string | null
          retry_count: number
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
          organization_id?: string | null
          retry_count?: number
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
          organization_id?: string | null
          retry_count?: number
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
            foreignKeyName: "sequence_step_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          delay_minutes: number | null
          id: string
          if_false_goto_step: string | null
          if_true_goto_step: string | null
          message_template: string | null
          next_step_id: string | null
          organization_id: string | null
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
          delay_minutes?: number | null
          id?: string
          if_false_goto_step?: string | null
          if_true_goto_step?: string | null
          message_template?: string | null
          next_step_id?: string | null
          organization_id?: string | null
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
          delay_minutes?: number | null
          id?: string
          if_false_goto_step?: string | null
          if_true_goto_step?: string | null
          message_template?: string | null
          next_step_id?: string | null
          organization_id?: string | null
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
            foreignKeyName: "sequence_steps_if_false_goto_step_fkey"
            columns: ["if_false_goto_step"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_if_true_goto_step_fkey"
            columns: ["if_true_goto_step"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_next_step_id_fkey"
            columns: ["next_step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
      sourcing_projects: {
        Row: {
          calendly_link: string | null
          client_name: string | null
          created_at: string
          created_by: string
          description: string | null
          filters_snapshot: Json
          hunt_bounty_percent: number | null
          hunt_deadline: string | null
          hunt_max_recruiters: number | null
          hunt_mode: boolean | null
          hunt_status: string | null
          icp_id: string | null
          id: string
          job_details: Json | null
          job_id: string | null
          job_title: string | null
          last_search_at: string | null
          name: string
          notes: string | null
          organization_id: string | null
          stats_dismissed: number
          stats_messaged: number
          stats_scored: number
          stats_shortlisted: number
          stats_total_found: number
          status: string
          updated_at: string
        }
        Insert: {
          calendly_link?: string | null
          client_name?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          filters_snapshot?: Json
          hunt_bounty_percent?: number | null
          hunt_deadline?: string | null
          hunt_max_recruiters?: number | null
          hunt_mode?: boolean | null
          hunt_status?: string | null
          icp_id?: string | null
          id?: string
          job_details?: Json | null
          job_id?: string | null
          job_title?: string | null
          last_search_at?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
          stats_dismissed?: number
          stats_messaged?: number
          stats_scored?: number
          stats_shortlisted?: number
          stats_total_found?: number
          status?: string
          updated_at?: string
        }
        Update: {
          calendly_link?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          filters_snapshot?: Json
          hunt_bounty_percent?: number | null
          hunt_deadline?: string | null
          hunt_max_recruiters?: number | null
          hunt_mode?: boolean | null
          hunt_status?: string | null
          icp_id?: string | null
          id?: string
          job_details?: Json | null
          job_id?: string | null
          job_title?: string | null
          last_search_at?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          stats_dismissed?: number
          stats_messaged?: number
          stats_scored?: number
          stats_shortlisted?: number
          stats_total_found?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_projects_icp_id_fkey"
            columns: ["icp_id"]
            isOneToOne: false
            referencedRelation: "prospection_icps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          limits: Json
          name: string
          price_monthly: number
          price_yearly: number
          sort_order: number
          stripe_price_id_monthly: string | null
          stripe_price_id_yearly: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id: string
          is_active?: boolean
          limits?: Json
          name: string
          price_monthly?: number
          price_yearly?: number
          sort_order?: number
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          limits?: Json
          name?: string
          price_monthly?: number
          price_yearly?: number
          sort_order?: number
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
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
      vivier_enrichments: {
        Row: {
          apollo_data: Json | null
          company_change_detail: string | null
          contact_airtable_id: string
          created_at: string | null
          current_company: string | null
          current_job_title: string | null
          enriched_at: string | null
          generated_message: string | null
          headline: string | null
          id: string
          is_relevant: boolean | null
          linkedin_url: string | null
          location: string | null
          match_type: string | null
          message_status: string | null
          message_type: string | null
          notable_events: Json | null
          organization_id: string | null
          relevance_reason: string | null
          still_same_company: boolean | null
          updated_at: string | null
        }
        Insert: {
          apollo_data?: Json | null
          company_change_detail?: string | null
          contact_airtable_id: string
          created_at?: string | null
          current_company?: string | null
          current_job_title?: string | null
          enriched_at?: string | null
          generated_message?: string | null
          headline?: string | null
          id?: string
          is_relevant?: boolean | null
          linkedin_url?: string | null
          location?: string | null
          match_type?: string | null
          message_status?: string | null
          message_type?: string | null
          notable_events?: Json | null
          organization_id?: string | null
          relevance_reason?: string | null
          still_same_company?: boolean | null
          updated_at?: string | null
        }
        Update: {
          apollo_data?: Json | null
          company_change_detail?: string | null
          contact_airtable_id?: string
          created_at?: string | null
          current_company?: string | null
          current_job_title?: string | null
          enriched_at?: string | null
          generated_message?: string | null
          headline?: string | null
          id?: string
          is_relevant?: boolean | null
          linkedin_url?: string | null
          location?: string | null
          match_type?: string | null
          message_status?: string | null
          message_type?: string | null
          notable_events?: Json | null
          organization_id?: string | null
          relevance_reason?: string | null
          still_same_company?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vivier_enrichments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_sequence_lock: {
        Args: { p_run_id: string; p_ttl_minutes?: number }
        Returns: boolean
      }
      archive_old_agent_conversations: { Args: never; Returns: number }
      check_rate_limit: {
        Args: {
          p_action: string
          p_max_requests: number
          p_user_id: string
          p_window_seconds?: number
        }
        Returns: boolean
      }
      cleanup_rate_limit_log: { Args: never; Returns: undefined }
      cosine_similarity_match: {
        Args: { p_candidate_id: string; p_job_id: string }
        Returns: number
      }
      deduct_ai_credits: {
        Args: {
          p_action: string
          p_amount: number
          p_description?: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_org_integration: {
        Args: { p_org_id: string }
        Returns: {
          aircall_api_id: string | null
          aircall_api_token: string | null
          aircall_connected: boolean
          airtable_api_key: string | null
          airtable_base_id: string | null
          airtable_base_id_2: string | null
          airtable_connected: boolean
          anthropic_api_key: string | null
          apollo_api_key: string | null
          calendly_api_key: string | null
          calendly_connected: boolean
          created_at: string
          id: string
          notion_api_key: string | null
          notion_candidats_db_id: string | null
          notion_connected: boolean
          notion_postes_db_id: string | null
          notion_shortlist_db_id: string | null
          organization_id: string
          pdl_api_key: string | null
          unipile_api_key: string | null
          unipile_connected: boolean
          unipile_dsn: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_integrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_org_role: {
        Args: { _org_id: string; _user_id: string }
        Returns: string
      }
      get_portal_token: {
        Args: { p_token: string }
        Returns: {
          candidate_id: string
          candidate_name: string | null
          company_description: string | null
          company_logo_url: string | null
          company_name: string | null
          created_at: string
          created_by: string
          documents: Json | null
          estimated_days_to_next: number | null
          expires_at: string | null
          faq: Json | null
          id: string
          is_active: boolean
          job_id: string | null
          job_title: string | null
          next_steps: string | null
          organization_id: string | null
          pipeline_stage: string | null
          recruiter_email: string | null
          recruiter_name: string | null
          recruiter_phone: string | null
          stage_updated_at: string | null
          token: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "candidate_portal_tokens"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      get_vivier_candidates: {
        Args: {
          p_has_appointments?: boolean
          p_has_notes?: boolean
          p_limit?: number
          p_min_shortlists?: number
          p_offset?: number
          p_search?: string
          p_skill?: string
          p_source_base?: string
        }
        Returns: {
          airtable_id: string
          appointment_count: number
          education_level: string
          email: string
          experience: string
          full_name: string
          last_interaction_date: string
          linkedin_url: string
          note_count: number
          phone: string
          placement_count: number
          shortlist_count: number
          skills: string[]
          source_base: string
          status: string
          total_count: number
        }[]
      }
      get_vivier_companies: {
        Args: {
          p_city?: string
          p_has_placements?: boolean
          p_limit?: number
          p_min_placements?: number
          p_min_shortlists?: number
          p_offset?: number
          p_search?: string
          p_sort_by?: string
          p_source_base?: string
        }
        Returns: {
          appointment_count: number
          city: string
          company_airtable_id: string
          company_name: string
          contact_count: number
          description: string
          headcount: string
          last_interaction_date: string
          note_count: number
          placement_count: number
          shortlist_count: number
          source_base: string
          total_count: number
        }[]
      }
      get_vivier_contacts: {
        Args: {
          p_city?: string
          p_contact_type?: string
          p_has_placements?: boolean
          p_limit?: number
          p_min_shortlists?: number
          p_offset?: number
          p_search?: string
          p_sort_by?: string
          p_source_base?: string
        }
        Returns: {
          airtable_id: string
          appointment_count: number
          city: string
          company_airtable_id: string
          company_name: string
          contact_type: string
          email: string
          full_name: string
          last_interaction_date: string
          note_count: number
          placement_count: number
          shortlist_count: number
          source_base: string
          status: string
          title: string
          total_count: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_process_sequences: {
        Args: { p_action: string }
        Returns: undefined
      }
      is_mission_team_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_mission_team_member_for_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      release_sequence_lock: { Args: { p_run_id: string }; Returns: undefined }
      retrieve_context: {
        Args: {
          p_chunk_types?: string[]
          p_entity_id: string
          p_entity_type: string
          p_limit?: number
          p_org_id: string
          p_query_embedding: string
        }
        Returns: {
          chunk_type: string
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      retrieve_context_multi: {
        Args: {
          p_chunk_types?: string[]
          p_entity_ids: string[]
          p_limit?: number
          p_org_id: string
          p_query_embedding: string
        }
        Returns: {
          chunk_type: string
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
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
