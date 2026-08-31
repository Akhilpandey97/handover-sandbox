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
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action_type: string
          category: string
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          status: string
          tenant_id: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action_type?: string
          category?: string
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          status?: string
          tenant_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action_type?: string
          category?: string
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          status?: string
          tenant_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_workflows: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          description: string | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          name: string
          tenant_id: string | null
          trigger_config: Json
          trigger_count: number
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name: string
          tenant_id?: string | null
          trigger_config?: Json
          trigger_count?: number
          trigger_type: string
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          name?: string
          tenant_id?: string | null
          trigger_config?: Json
          trigger_count?: number
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_workflows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          category: string
          created_at: string
          id: string
          key: string
          tenant_id: string | null
          updated_at: string
          value: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          key: string
          tenant_id?: string | null
          updated_at?: string
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          key?: string
          tenant_id?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_form_assignments: {
        Row: {
          checklist_template_id: string
          created_at: string
          form_template_id: string
          id: string
          tenant_id: string | null
        }
        Insert: {
          checklist_template_id: string
          created_at?: string
          form_template_id: string
          id?: string
          tenant_id?: string | null
        }
        Update: {
          checklist_template_id?: string
          created_at?: string
          form_template_id?: string
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_form_assignments_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_assignments_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_form_fields: {
        Row: {
          category: string
          created_at: string
          field_type: string
          id: string
          is_required: boolean
          options: Json | null
          question: string
          sort_order: number
          template_id: string
          tenant_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          field_type?: string
          id?: string
          is_required?: boolean
          options?: Json | null
          question: string
          sort_order?: number
          template_id: string
          tenant_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          field_type?: string
          id?: string
          is_required?: boolean
          options?: Json | null
          question?: string
          sort_order?: number
          template_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_form_fields_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_fields_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_form_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_form_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          created_at: string
          id: string
          owner_team: string
          phase: string
          sort_order: number
          standard_duration: number | null
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_team: string
          phase: string
          sort_order?: number
          standard_duration?: number | null
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_team?: string
          phase?: string
          sort_order?: number
          standard_duration?: number | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string
          field_key: string
          field_label: string
          field_type: string
          id: string
          is_active: boolean
          options: Json | null
          sort_order: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_key: string
          field_label: string
          field_type?: string
          id?: string
          is_active?: boolean
          options?: Json | null
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_key?: string
          field_label?: string
          field_type?: string
          id?: string
          is_active?: boolean
          options?: Json | null
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_portal_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          last_accessed_at: string | null
          project_id: string
          tenant_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_accessed_at?: string | null
          project_id: string
          tenant_id?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_accessed_at?: string | null
          project_id?: string
          tenant_id?: string | null
          token?: string
        }
        Relationships: []
      }
      merchant_portal_visits: {
        Row: {
          created_at: string
          email: string
          id: string
          page: string
          project_id: string
          session_id: string | null
          tenant_id: string | null
          user_agent: string | null
          visited_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          page: string
          project_id: string
          session_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          visited_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          page?: string
          project_id?: string
          session_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          visited_at?: string
        }
        Relationships: []
      }
      movement_report_executions: {
        Row: {
          completed_at: string | null
          email_count: number | null
          error_message: string | null
          id: string
          recipients: string[]
          schedule_id: string | null
          status: string
          tenant_id: string
          triggered_at: string
        }
        Insert: {
          completed_at?: string | null
          email_count?: number | null
          error_message?: string | null
          id?: string
          recipients?: string[]
          schedule_id?: string | null
          status?: string
          tenant_id: string
          triggered_at?: string
        }
        Update: {
          completed_at?: string | null
          email_count?: number | null
          error_message?: string | null
          id?: string
          recipients?: string[]
          schedule_id?: string | null
          status?: string
          tenant_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "movement_report_executions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "movement_report_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      movement_report_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          days: string[]
          enabled: boolean
          id: string
          last_sent_at: string | null
          name: string
          recipients: string[]
          subject_prefix: string | null
          tenant_id: string
          time_ist: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days?: string[]
          enabled?: boolean
          id?: string
          last_sent_at?: string | null
          name: string
          recipients?: string[]
          subject_prefix?: string | null
          tenant_id: string
          time_ist?: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: string[]
          enabled?: boolean
          id?: string
          last_sent_at?: string | null
          name?: string
          recipients?: string[]
          subject_prefix?: string | null
          tenant_id?: string
          time_ist?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_merchants: {
        Row: {
          arr: number | null
          auto_created: boolean
          brand_poc_emails: string[]
          brand_poc_name: string | null
          created_at: string
          created_by: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          go_live_date: string | null
          id: string
          login_email: string | null
          merchant_name: string
          merchant_phone: string | null
          mid: string | null
          notes: string | null
          platform: string
          platform_poc_emails: string[]
          platform_poc_name: string | null
          status: string
          temp_password: string | null
          tenant_id: string
          updated_at: string
          website: string | null
          welcome_email_sent_at: string | null
        }
        Insert: {
          arr?: number | null
          auto_created?: boolean
          brand_poc_emails?: string[]
          brand_poc_name?: string | null
          created_at?: string
          created_by?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          go_live_date?: string | null
          id?: string
          login_email?: string | null
          merchant_name: string
          merchant_phone?: string | null
          mid?: string | null
          notes?: string | null
          platform: string
          platform_poc_emails?: string[]
          platform_poc_name?: string | null
          status?: string
          temp_password?: string | null
          tenant_id: string
          updated_at?: string
          website?: string | null
          welcome_email_sent_at?: string | null
        }
        Update: {
          arr?: number | null
          auto_created?: boolean
          brand_poc_emails?: string[]
          brand_poc_name?: string | null
          created_at?: string
          created_by?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          go_live_date?: string | null
          id?: string
          login_email?: string | null
          merchant_name?: string
          merchant_phone?: string | null
          mid?: string | null
          notes?: string | null
          platform?: string
          platform_poc_emails?: string[]
          platform_poc_name?: string | null
          status?: string
          temp_password?: string | null
          tenant_id?: string
          updated_at?: string
          website?: string | null
          welcome_email_sent_at?: string | null
        }
        Relationships: []
      }
      project_jira_tickets: {
        Row: {
          affects_versions: string[] | null
          assignee_avatar: string | null
          assignee_email: string | null
          assignee_name: string | null
          attachment_count: number | null
          comment_count: number | null
          components: string[] | null
          created: string | null
          created_at: string
          creator_email: string | null
          creator_name: string | null
          description: string | null
          due_date: string | null
          environment: string | null
          epic_key: string | null
          epic_name: string | null
          fetched_at: string
          fix_versions: string[] | null
          id: string
          issue_type: string | null
          jira_key: string
          labels: string[] | null
          parent_key: string | null
          priority: string | null
          project_id: string
          project_key: string | null
          project_name: string | null
          raw: Json | null
          reporter_avatar: string | null
          reporter_email: string | null
          reporter_name: string | null
          resolution: string | null
          resolved_at: string | null
          sprint: string | null
          status: string | null
          status_category: string | null
          story_points: number | null
          subtask_count: number | null
          summary: string | null
          tenant_id: string | null
          updated: string | null
          updated_at: string
          url: string | null
          votes: number | null
          watchers_count: number | null
        }
        Insert: {
          affects_versions?: string[] | null
          assignee_avatar?: string | null
          assignee_email?: string | null
          assignee_name?: string | null
          attachment_count?: number | null
          comment_count?: number | null
          components?: string[] | null
          created?: string | null
          created_at?: string
          creator_email?: string | null
          creator_name?: string | null
          description?: string | null
          due_date?: string | null
          environment?: string | null
          epic_key?: string | null
          epic_name?: string | null
          fetched_at?: string
          fix_versions?: string[] | null
          id?: string
          issue_type?: string | null
          jira_key: string
          labels?: string[] | null
          parent_key?: string | null
          priority?: string | null
          project_id: string
          project_key?: string | null
          project_name?: string | null
          raw?: Json | null
          reporter_avatar?: string | null
          reporter_email?: string | null
          reporter_name?: string | null
          resolution?: string | null
          resolved_at?: string | null
          sprint?: string | null
          status?: string | null
          status_category?: string | null
          story_points?: number | null
          subtask_count?: number | null
          summary?: string | null
          tenant_id?: string | null
          updated?: string | null
          updated_at?: string
          url?: string | null
          votes?: number | null
          watchers_count?: number | null
        }
        Update: {
          affects_versions?: string[] | null
          assignee_avatar?: string | null
          assignee_email?: string | null
          assignee_name?: string | null
          attachment_count?: number | null
          comment_count?: number | null
          components?: string[] | null
          created?: string | null
          created_at?: string
          creator_email?: string | null
          creator_name?: string | null
          description?: string | null
          due_date?: string | null
          environment?: string | null
          epic_key?: string | null
          epic_name?: string | null
          fetched_at?: string
          fix_versions?: string[] | null
          id?: string
          issue_type?: string | null
          jira_key?: string
          labels?: string[] | null
          parent_key?: string | null
          priority?: string | null
          project_id?: string
          project_key?: string | null
          project_name?: string | null
          raw?: Json | null
          reporter_avatar?: string | null
          reporter_email?: string | null
          reporter_name?: string | null
          resolution?: string | null
          resolved_at?: string | null
          sprint?: string | null
          status?: string | null
          status_category?: string | null
          story_points?: number | null
          subtask_count?: number | null
          summary?: string | null
          tenant_id?: string | null
          updated?: string | null
          updated_at?: string
          url?: string | null
          votes?: number | null
          watchers_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_jira_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_risks: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          escalated: boolean
          id: string
          mitigation_due_at: string | null
          mitigation_plan: string | null
          project_id: string
          resolved_at: string | null
          severity: string
          status: string
          tenant_id: string | null
          title: string
          trigger_rule: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          escalated?: boolean
          id?: string
          mitigation_due_at?: string | null
          mitigation_plan?: string | null
          project_id: string
          resolved_at?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          title: string
          trigger_rule?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          escalated?: boolean
          id?: string
          mitigation_due_at?: string | null
          mitigation_plan?: string | null
          project_id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          title?: string
          trigger_rule?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_executions: {
        Row: {
          completed_at: string | null
          created_at: string
          email_count: number | null
          error_message: string | null
          id: string
          recipients: string[] | null
          report_id: string
          status: string
          tenant_id: string | null
          triggered_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          email_count?: number | null
          error_message?: string | null
          id?: string
          recipients?: string[] | null
          report_id: string
          status?: string
          tenant_id?: string | null
          triggered_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          email_count?: number | null
          error_message?: string | null
          id?: string
          recipients?: string[] | null
          report_id?: string
          status?: string
          tenant_id?: string | null
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_executions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "saved_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          columns: string[]
          created_at: string
          created_by: string | null
          id: string
          name: string
          recipients: string[] | null
          schedule: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          columns?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          recipients?: string[] | null
          schedule?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          columns?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          recipients?: string[] | null
          schedule?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_lt_thread_status: {
        Row: {
          ai_confidence: string | null
          ai_evidence: string | null
          ai_merchant_name: string | null
          ai_status: string | null
          ai_summary: string | null
          ai_summary_at: string | null
          created_at: string
          id: string
          status: string | null
          subject: string | null
          tenant_id: string | null
          thread_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_evidence?: string | null
          ai_merchant_name?: string | null
          ai_status?: string | null
          ai_summary?: string | null
          ai_summary_at?: string | null
          created_at?: string
          id?: string
          status?: string | null
          subject?: string | null
          tenant_id?: string | null
          thread_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_evidence?: string | null
          ai_merchant_name?: string | null
          ai_status?: string | null
          ai_summary?: string | null
          ai_summary_at?: string | null
          created_at?: string
          id?: string
          status?: string | null
          subject?: string | null
          tenant_id?: string | null
          thread_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_lt_thread_status_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sme_merchants: {
        Row: {
          aov: number | null
          assigned_owner_email: string | null
          brand_name: string | null
          category: string | null
          city: string | null
          commercials: Json | null
          created_at: string
          expected_arr: number | null
          gmail_message_id: string
          gmail_thread_id: string | null
          id: string
          merchant_contact: string | null
          merchant_email: string | null
          merchant_id_ext: string | null
          merchant_id_text: string | null
          merchant_poc_name: string | null
          merchant_size: string | null
          mg_sheet_link: string | null
          notes: string | null
          parsed_fields: Json | null
          platform: string | null
          raw_html: string | null
          received_at: string
          rto_coverage_pct: number | null
          rto_refund_amount: number | null
          sender: string
          shopify_url: string | null
          status: string
          sub_platform: string | null
          subject: string
          tenant_id: string | null
          txns_per_day: number | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          aov?: number | null
          assigned_owner_email?: string | null
          brand_name?: string | null
          category?: string | null
          city?: string | null
          commercials?: Json | null
          created_at?: string
          expected_arr?: number | null
          gmail_message_id: string
          gmail_thread_id?: string | null
          id?: string
          merchant_contact?: string | null
          merchant_email?: string | null
          merchant_id_ext?: string | null
          merchant_id_text?: string | null
          merchant_poc_name?: string | null
          merchant_size?: string | null
          mg_sheet_link?: string | null
          notes?: string | null
          parsed_fields?: Json | null
          platform?: string | null
          raw_html?: string | null
          received_at: string
          rto_coverage_pct?: number | null
          rto_refund_amount?: number | null
          sender: string
          shopify_url?: string | null
          status?: string
          sub_platform?: string | null
          subject: string
          tenant_id?: string | null
          txns_per_day?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          aov?: number | null
          assigned_owner_email?: string | null
          brand_name?: string | null
          category?: string | null
          city?: string | null
          commercials?: Json | null
          created_at?: string
          expected_arr?: number | null
          gmail_message_id?: string
          gmail_thread_id?: string | null
          id?: string
          merchant_contact?: string | null
          merchant_email?: string | null
          merchant_id_ext?: string | null
          merchant_id_text?: string | null
          merchant_poc_name?: string | null
          merchant_size?: string | null
          mg_sheet_link?: string | null
          notes?: string | null
          parsed_fields?: Json | null
          platform?: string | null
          raw_html?: string | null
          received_at?: string
          rto_coverage_pct?: number | null
          rto_refund_amount?: number | null
          sender?: string
          shopify_url?: string | null
          status?: string
          sub_platform?: string | null
          subject?: string
          tenant_id?: string | null
          txns_per_day?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sme_merchants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tat_report_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          days: string[]
          enabled: boolean
          granularity: string
          id: string
          last_sent_at: string | null
          name: string
          recipients: string[]
          subject_prefix: string | null
          tenant_id: string
          time_ist: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days?: string[]
          enabled?: boolean
          granularity?: string
          id?: string
          last_sent_at?: string | null
          name: string
          recipients?: string[]
          subject_prefix?: string | null
          tenant_id: string
          time_ist?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: string[]
          enabled?: boolean
          granularity?: string
          id?: string
          last_sent_at?: string | null
          name?: string
          recipients?: string[]
          subject_prefix?: string | null
          tenant_id?: string
          time_ist?: string
          updated_at?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          color: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          slug: string
          sort_order: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          slug: string
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          slug?: string
          sort_order?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      project_phase: "mint" | "integration" | "ms" | "completed"
      project_state:
        | "not_started"
        | "on_hold"
        | "in_progress"
        | "live"
        | "blocked"
      responsibility_party: "gokwik" | "merchant" | "neutral"
      team_role:
        | "mint"
        | "integration"
        | "ms"
        | "manager"
        | "super_admin"
        | "gokwik_general"
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
      project_phase: ["mint", "integration", "ms", "completed"],
      project_state: [
        "not_started",
        "on_hold",
        "in_progress",
        "live",
        "blocked",
      ],
      responsibility_party: ["gokwik", "merchant", "neutral"],
      team_role: [
        "mint",
        "integration",
        "ms",
        "manager",
        "super_admin",
        "gokwik_general",
      ],
    },
  },
} as const
