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
        Relationships: []
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
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: []
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
          phone?: string | null
          preferred_contract?: string | null
          raw_data?: Json | null
          skills?: string[] | null
          source_base?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: []
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
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          tech_stack?: string[] | null
          year_founded?: string | null
        }
        Relationships: []
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
          raw_data?: Json | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: []
      }
      airtable_glossary: {
        Row: {
          airtable_id: string
          category: string | null
          created_at: string
          description: string | null
          id: string
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
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          term?: string | null
        }
        Relationships: []
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
          raw_data?: Json | null
          salary?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          title?: string | null
        }
        Relationships: []
      }
      airtable_kpi: {
        Row: {
          airtable_id: string
          category: string | null
          created_at: string
          id: string
          name: string | null
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
          period?: string | null
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          value?: string | null
        }
        Relationships: []
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
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          synced_at?: string
          title?: string | null
        }
        Relationships: []
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
          raw_data?: Json | null
          salary?: string | null
          source_base?: string
          start_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Relationships: []
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
          raw_data?: Json | null
          salary_proposed?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      airtable_shortlists_cumulated: {
        Row: {
          airtable_id: string
          candidate_airtable_id: string | null
          company_airtable_id: string | null
          created_at: string
          id: string
          last_shortlist_date: string | null
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
          raw_data?: Json | null
          source_base?: string
          synced_at?: string
          total_shortlists?: number | null
        }
        Relationships: []
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
          raw_data?: Json | null
          shortlist_airtable_id?: string | null
          source_base?: string
          status?: string | null
          synced_at?: string
          task_type?: string | null
          title?: string | null
        }
        Relationships: []
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
          report?: Json | null
          scorecard_id?: string
          status?: string | null
          transcript?: string | null
        }
        Relationships: []
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
          overall_score?: number | null
          ratings?: Json
          recommendation?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
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
      candidate_portal_tokens: {
        Row: {
          candidate_id: string
          candidate_name: string | null
          company_name: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean
          job_id: string | null
          job_title: string | null
          next_steps: string | null
          pipeline_stage: string | null
          token: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          candidate_name?: string | null
          company_name?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          job_id?: string | null
          job_title?: string | null
          next_steps?: string | null
          pipeline_stage?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          candidate_name?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          job_id?: string | null
          job_title?: string | null
          next_steps?: string | null
          pipeline_stage?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      candidate_profiles: {
        Row: {
          candidate_id: string
          created_at: string
          embedding: string | null
          headline: string | null
          id: string
          name: string | null
          skills: string[] | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          embedding?: string | null
          headline?: string | null
          id?: string
          name?: string | null
          skills?: string[] | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          embedding?: string | null
          headline?: string | null
          id?: string
          name?: string | null
          skills?: string[] | null
          summary?: string | null
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
      chat_categories: {
        Row: {
          account_id: string
          category: string
          chat_id: string
          created_at: string
          created_by: string
          id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          category: string
          chat_id: string
          created_at?: string
          created_by: string
          id?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          category?: string
          chat_id?: string
          created_at?: string
          created_by?: string
          id?: string
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
      match_scores: {
        Row: {
          candidate_id: string
          confidence: number
          created_at: string
          id: string
          job_id: string
          score: number
          scoring_result: Json
        }
        Insert: {
          candidate_id: string
          confidence?: number
          created_at?: string
          id?: string
          job_id: string
          score?: number
          scoring_result?: Json
        }
        Update: {
          candidate_id?: string
          confidence?: number
          created_at?: string
          id?: string
          job_id?: string
          score?: number
          scoring_result?: Json
        }
        Relationships: []
      }
      message_analysis_cache: {
        Row: {
          account_id: string
          analysis: Json
          chat_id: string
          created_at: string
          id: string
          recipient_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          analysis?: Json
          chat_id: string
          created_at?: string
          id?: string
          recipient_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          analysis?: Json
          chat_id?: string
          created_at?: string
          id?: string
          recipient_name?: string | null
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
            foreignKeyName: "qualification_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sourcing_projects"
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
          updated_at?: string
          usage_count?: number
        }
        Relationships: []
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
          project_id?: string | null
          results_count?: number
          search_api?: string | null
          shortlisted_count?: number
          treated_count?: number
          updated_at?: string
        }
        Relationships: [
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
          network_distance: string | null
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
          id: string
          job_id: string | null
          job_title: string | null
          last_search_at: string | null
          name: string
          notes: string | null
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
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_search_at?: string | null
          name: string
          notes?: string | null
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
          id?: string
          job_id?: string | null
          job_title?: string | null
          last_search_at?: string | null
          name?: string
          notes?: string | null
          stats_dismissed?: number
          stats_messaged?: number
          stats_scored?: number
          stats_shortlisted?: number
          stats_total_found?: number
          status?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_sequence_lock: {
        Args: { p_run_id: string; p_ttl_minutes?: number }
        Returns: boolean
      }
      cosine_similarity_match: {
        Args: { p_candidate_id: string; p_job_id: string }
        Returns: number
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
      release_sequence_lock: { Args: { p_run_id: string }; Returns: undefined }
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
