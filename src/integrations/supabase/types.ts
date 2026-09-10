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
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
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
      brd_responses: {
        Row: {
          created_at: string
          field_id: string
          id: string
          session_id: string
          tenant_id: string | null
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          session_id: string
          tenant_id?: string | null
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          session_id?: string
          tenant_id?: string | null
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brd_responses_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "checklist_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brd_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "brd_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brd_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brd_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          csv_url: string | null
          form_template_id: string
          id: string
          merchant_email: string
          project_id: string
          status: string
          tenant_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          csv_url?: string | null
          form_template_id: string
          id?: string
          merchant_email: string
          project_id: string
          status?: string
          tenant_id?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          csv_url?: string | null
          form_template_id?: string
          id?: string
          merchant_email?: string
          project_id?: string
          status?: string
          tenant_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brd_sessions_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brd_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brd_sessions_tenant_id_fkey"
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
          conversation_id: string | null
          created_at: string
          id: string
          role: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          role: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string | null
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
      checklist_comments: {
        Row: {
          attachment_name: string | null
          attachment_url: string | null
          checklist_item_id: string
          comment: string
          created_at: string
          id: string
          tenant_id: string | null
          user_id: string | null
          user_name: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_url?: string | null
          checklist_item_id: string
          comment: string
          created_at?: string
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          user_name: string
        }
        Update: {
          attachment_name?: string | null
          attachment_url?: string | null
          checklist_item_id?: string
          comment?: string
          created_at?: string
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_comments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_comments_tenant_id_fkey"
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
      checklist_form_responses: {
        Row: {
          checklist_item_id: string
          created_at: string
          field_id: string
          form_template_id: string
          id: string
          project_id: string
          tenant_id: string | null
          updated_at: string
          value: string | null
        }
        Insert: {
          checklist_item_id: string
          created_at?: string
          field_id: string
          form_template_id: string
          id?: string
          project_id: string
          tenant_id?: string | null
          updated_at?: string
          value?: string | null
        }
        Update: {
          checklist_item_id?: string
          created_at?: string
          field_id?: string
          form_template_id?: string
          id?: string
          project_id?: string
          tenant_id?: string | null
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_form_responses_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_responses_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "checklist_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_responses_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_form_responses_tenant_id_fkey"
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
      checklist_items: {
        Row: {
          comment: string | null
          comment_at: string | null
          comment_by: string | null
          completed: boolean | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          current_responsibility:
            | Database["public"]["Enums"]["responsibility_party"]
            | null
          due_date: string | null
          id: string
          is_task: boolean
          owner_team: string
          phase: string
          project_id: string
          sort_order: number | null
          tenant_id: string | null
          title: string
        }
        Insert: {
          comment?: string | null
          comment_at?: string | null
          comment_by?: string | null
          completed?: boolean | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          current_responsibility?:
            | Database["public"]["Enums"]["responsibility_party"]
            | null
          due_date?: string | null
          id?: string
          is_task?: boolean
          owner_team: string
          phase: string
          project_id: string
          sort_order?: number | null
          tenant_id?: string | null
          title: string
        }
        Update: {
          comment?: string | null
          comment_at?: string | null
          comment_by?: string | null
          completed?: boolean | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          current_responsibility?:
            | Database["public"]["Enums"]["responsibility_party"]
            | null
          due_date?: string | null
          id?: string
          is_task?: boolean
          owner_team?: string
          phase?: string
          project_id?: string
          sort_order?: number | null
          tenant_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_responsibility_logs: {
        Row: {
          checklist_item_id: string
          created_at: string | null
          ended_at: string | null
          id: string
          party: Database["public"]["Enums"]["responsibility_party"]
          started_at: string
          tenant_id: string | null
        }
        Insert: {
          checklist_item_id: string
          created_at?: string | null
          ended_at?: string | null
          id?: string
          party: Database["public"]["Enums"]["responsibility_party"]
          started_at?: string
          tenant_id?: string | null
        }
        Update: {
          checklist_item_id?: string
          created_at?: string | null
          ended_at?: string | null
          id?: string
          party?: Database["public"]["Enums"]["responsibility_party"]
          started_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responsibility_logs_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responsibility_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_tasks: {
        Row: {
          assigned_to: string | null
          checklist_item_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string
          status: string
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          checklist_item_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id: string
          status?: string
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          checklist_item_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string
          status?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_tasks_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_tasks_tenant_id_fkey"
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
      custom_field_values: {
        Row: {
          created_at: string
          field_id: string
          id: string
          project_id: string
          tenant_id: string | null
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          project_id: string
          tenant_id?: string | null
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          project_id?: string
          tenant_id?: string | null
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_values_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_values_tenant_id_fkey"
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
      merchant_portal_uploads: {
        Row: {
          created_at: string
          file_name: string
          file_url: string
          id: string
          notes: string | null
          project_id: string
          tenant_id: string
          upload_type: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          notes?: string | null
          project_id: string
          tenant_id: string
          upload_type: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          notes?: string | null
          project_id?: string
          tenant_id?: string
          upload_type?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_portal_uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      notifications: {
        Row: {
          actor_name: string | null
          body: string | null
          checklist_item_id: string | null
          checklist_item_title: string | null
          comment_id: string | null
          created_at: string
          id: string
          project_id: string | null
          project_name: string | null
          read_at: string | null
          task_id: string | null
          tenant_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_name?: string | null
          body?: string | null
          checklist_item_id?: string | null
          checklist_item_title?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          project_name?: string | null
          read_at?: string | null
          task_id?: string | null
          tenant_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_name?: string | null
          body?: string | null
          checklist_item_id?: string | null
          checklist_item_title?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          project_name?: string | null
          read_at?: string | null
          task_id?: string | null
          tenant_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_emails: {
        Row: {
          aov: number | null
          arr: number | null
          brand_name: string | null
          brand_url: string | null
          category: string | null
          city: string | null
          created_at: string
          gmail_message_id: string
          id: string
          merchant_size: string | null
          parsed_fields: Json | null
          platform: string | null
          project_id: string | null
          raw_html: string | null
          received_at: string
          sales_notes: string | null
          sender: string
          status: string
          sub_platform: string | null
          subject: string
          tenant_id: string | null
          txns_per_day: number | null
          updated_at: string
        }
        Insert: {
          aov?: number | null
          arr?: number | null
          brand_name?: string | null
          brand_url?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          gmail_message_id: string
          id?: string
          merchant_size?: string | null
          parsed_fields?: Json | null
          platform?: string | null
          project_id?: string | null
          raw_html?: string | null
          received_at: string
          sales_notes?: string | null
          sender: string
          status?: string
          sub_platform?: string | null
          subject: string
          tenant_id?: string | null
          txns_per_day?: number | null
          updated_at?: string
        }
        Update: {
          aov?: number | null
          arr?: number | null
          brand_name?: string | null
          brand_url?: string | null
          category?: string | null
          city?: string | null
          created_at?: string
          gmail_message_id?: string
          id?: string
          merchant_size?: string | null
          parsed_fields?: Json | null
          platform?: string | null
          project_id?: string | null
          raw_html?: string | null
          received_at?: string
          sales_notes?: string | null
          sender?: string
          status?: string
          sub_platform?: string | null
          subject?: string
          tenant_id?: string | null
          txns_per_day?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parsed_emails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_merchants: {
        Row: {
          arr: number | null
          auto_created: boolean
          brand_poc_emails: string[]
          brand_poc_name: string | null
          created_at: string
          created_by: string | null
          csm_id: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          go_live_date: string | null
          id: string
          login_email: string | null
          merchant_name: string
          merchant_phone: string | null
          mid: string | null
          notes: string | null
          owner_id: string | null
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
          csm_id?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          go_live_date?: string | null
          id?: string
          login_email?: string | null
          merchant_name: string
          merchant_phone?: string | null
          mid?: string | null
          notes?: string | null
          owner_id?: string | null
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
          csm_id?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          go_live_date?: string | null
          id?: string
          login_email?: string | null
          merchant_name?: string
          merchant_phone?: string | null
          mid?: string | null
          notes?: string | null
          owner_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "platform_merchants_csm_id_fkey"
            columns: ["csm_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_merchants_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          id: string
          last_login: string | null
          name: string
          team: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          last_login?: string | null
          name: string
          team: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          last_login?: string | null
          name?: string
          team?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_ai_insights: {
        Row: {
          ai_generated_at: string | null
          blocked_on: string | null
          blocker: string | null
          confidence: string | null
          created_at: string
          csm_alignment: string | null
          db_walkthrough: string | null
          deadline: string | null
          id: string
          manual_overrides: Json
          month: string
          pg_creds: string | null
          project_id: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          ai_generated_at?: string | null
          blocked_on?: string | null
          blocker?: string | null
          confidence?: string | null
          created_at?: string
          csm_alignment?: string | null
          db_walkthrough?: string | null
          deadline?: string | null
          id?: string
          manual_overrides?: Json
          month: string
          pg_creds?: string | null
          project_id: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_generated_at?: string | null
          blocked_on?: string | null
          blocker?: string | null
          confidence?: string | null
          created_at?: string
          csm_alignment?: string | null
          db_walkthrough?: string | null
          deadline?: string | null
          id?: string
          manual_overrides?: Json
          month?: string
          pg_creds?: string | null
          project_id?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_ai_insights_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_comment_logs: {
        Row: {
          author_name: string
          author_type: string
          content: string
          created_at: string
          field_name: string
          id: string
          project_id: string
          tenant_id: string | null
        }
        Insert: {
          author_name: string
          author_type?: string
          content: string
          created_at?: string
          field_name: string
          id?: string
          project_id: string
          tenant_id?: string | null
        }
        Update: {
          author_name?: string
          author_type?: string
          content?: string
          created_at?: string
          field_name?: string
          id?: string
          project_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_comment_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comment_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_email_context: {
        Row: {
          action_items: Json | null
          checklist_context: string | null
          email_count: number | null
          generated_at: string
          id: string
          project_id: string
          summary: string | null
          tenant_id: string | null
          test_cases: Json | null
        }
        Insert: {
          action_items?: Json | null
          checklist_context?: string | null
          email_count?: number | null
          generated_at?: string
          id?: string
          project_id: string
          summary?: string | null
          tenant_id?: string | null
          test_cases?: Json | null
        }
        Update: {
          action_items?: Json | null
          checklist_context?: string | null
          email_count?: number | null
          generated_at?: string
          id?: string
          project_id?: string
          summary?: string | null
          tenant_id?: string | null
          test_cases?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "project_email_context_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_email_context_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_emails: {
        Row: {
          bodies_fetched_at: string | null
          created_at: string
          gmail_message_id: string
          gmail_thread_id: string
          id: string
          message_count: number | null
          messages: Json | null
          participants: string[] | null
          project_id: string
          raw_headers: Json | null
          snippet: string | null
          subject: string
          tenant_id: string | null
          thread_date: string
          updated_at: string
        }
        Insert: {
          bodies_fetched_at?: string | null
          created_at?: string
          gmail_message_id: string
          gmail_thread_id: string
          id?: string
          message_count?: number | null
          messages?: Json | null
          participants?: string[] | null
          project_id: string
          raw_headers?: Json | null
          snippet?: string | null
          subject: string
          tenant_id?: string | null
          thread_date: string
          updated_at?: string
        }
        Update: {
          bodies_fetched_at?: string | null
          created_at?: string
          gmail_message_id?: string
          gmail_thread_id?: string
          id?: string
          message_count?: number | null
          messages?: Json | null
          participants?: string[] | null
          project_id?: string
          raw_headers?: Json | null
          snippet?: string | null
          subject?: string
          tenant_id?: string | null
          thread_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_emails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      project_responsibility_logs: {
        Row: {
          created_at: string | null
          ended_at: string | null
          id: string
          party: Database["public"]["Enums"]["responsibility_party"]
          phase: Database["public"]["Enums"]["project_phase"]
          project_id: string
          started_at: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          ended_at?: string | null
          id?: string
          party: Database["public"]["Enums"]["responsibility_party"]
          phase: Database["public"]["Enums"]["project_phase"]
          project_id: string
          started_at?: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          ended_at?: string | null
          id?: string
          party?: Database["public"]["Enums"]["responsibility_party"]
          phase?: Database["public"]["Enums"]["project_phase"]
          project_id?: string
          started_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_responsibility_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_responsibility_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_risk_insights: {
        Row: {
          findings_hash: string
          generated_at: string
          kind: string
          model: string | null
          project_id: string
          recommendation: string
          tenant_id: string | null
          why: string
        }
        Insert: {
          findings_hash: string
          generated_at?: string
          kind?: string
          model?: string | null
          project_id: string
          recommendation: string
          tenant_id?: string | null
          why: string
        }
        Update: {
          findings_hash?: string
          generated_at?: string
          kind?: string
          model?: string | null
          project_id?: string
          recommendation?: string
          tenant_id?: string | null
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_risk_insights_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_risk_insights_tenant_id_fkey"
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
      projects: {
        Row: {
          aov: number | null
          archived: boolean | null
          archived_at: string | null
          arr: number | null
          assigned_owner: string | null
          brand_url: string | null
          brd_link: string | null
          category: string | null
          config_id: string | null
          contact_email: string | null
          created_at: string | null
          created_by: string | null
          current_owner_team: string | null
          current_phase: Database["public"]["Enums"]["project_phase"] | null
          current_phase_comment: string | null
          current_responsibility:
            | Database["public"]["Enums"]["responsibility_party"]
            | null
          enable_kp: boolean
          enable_mcp_document: boolean
          expected_go_live_date: string | null
          expected_go_live_is_manual: boolean
          external_id: string | null
          faq_help: Json
          go_live_date: string | null
          go_live_percent: number | null
          id: string
          integration_checklist_link: string | null
          integration_type: string | null
          jira_link: string | null
          kick_off_date: string
          kp_prod_jwe_key: string | null
          kp_sandbox_jwe_key: string | null
          mandatory_apis: string[]
          mcp_config_id: string | null
          merchant_name: string
          mid: string
          mint_checklist_link: string | null
          mint_notes: string | null
          payment_simulator_link: string | null
          pending_acceptance: boolean | null
          pg_onboarding: string | null
          phase2_comment: string | null
          platform: string | null
          prod_app_id: string | null
          prod_app_secret: string | null
          prod_base_url: string | null
          prod_config_id: string | null
          prod_kwikpass_jwe_key: string | null
          prod_mid: string | null
          project_notes: string | null
          project_state: Database["public"]["Enums"]["project_state"] | null
          sales_spoc: string | null
          sandbox_app_id: string | null
          sandbox_app_secret: string | null
          sandbox_base_url: string | null
          sandbox_config_id: string | null
          sandbox_kwikpass_jwe_key: string | null
          sandbox_mid: string | null
          sow_link: string | null
          tenant_id: string | null
          tracker_month: string | null
          txns_per_day: number | null
          updated_at: string | null
        }
        Insert: {
          aov?: number | null
          archived?: boolean | null
          archived_at?: string | null
          arr?: number | null
          assigned_owner?: string | null
          brand_url?: string | null
          brd_link?: string | null
          category?: string | null
          config_id?: string | null
          contact_email?: string | null
          created_at?: string | null
          created_by?: string | null
          current_owner_team?: string | null
          current_phase?: Database["public"]["Enums"]["project_phase"] | null
          current_phase_comment?: string | null
          current_responsibility?:
            | Database["public"]["Enums"]["responsibility_party"]
            | null
          enable_kp?: boolean
          enable_mcp_document?: boolean
          expected_go_live_date?: string | null
          expected_go_live_is_manual?: boolean
          external_id?: string | null
          faq_help?: Json
          go_live_date?: string | null
          go_live_percent?: number | null
          id?: string
          integration_checklist_link?: string | null
          integration_type?: string | null
          jira_link?: string | null
          kick_off_date: string
          kp_prod_jwe_key?: string | null
          kp_sandbox_jwe_key?: string | null
          mandatory_apis?: string[]
          mcp_config_id?: string | null
          merchant_name: string
          mid: string
          mint_checklist_link?: string | null
          mint_notes?: string | null
          payment_simulator_link?: string | null
          pending_acceptance?: boolean | null
          pg_onboarding?: string | null
          phase2_comment?: string | null
          platform?: string | null
          prod_app_id?: string | null
          prod_app_secret?: string | null
          prod_base_url?: string | null
          prod_config_id?: string | null
          prod_kwikpass_jwe_key?: string | null
          prod_mid?: string | null
          project_notes?: string | null
          project_state?: Database["public"]["Enums"]["project_state"] | null
          sales_spoc?: string | null
          sandbox_app_id?: string | null
          sandbox_app_secret?: string | null
          sandbox_base_url?: string | null
          sandbox_config_id?: string | null
          sandbox_kwikpass_jwe_key?: string | null
          sandbox_mid?: string | null
          sow_link?: string | null
          tenant_id?: string | null
          tracker_month?: string | null
          txns_per_day?: number | null
          updated_at?: string | null
        }
        Update: {
          aov?: number | null
          archived?: boolean | null
          archived_at?: string | null
          arr?: number | null
          assigned_owner?: string | null
          brand_url?: string | null
          brd_link?: string | null
          category?: string | null
          config_id?: string | null
          contact_email?: string | null
          created_at?: string | null
          created_by?: string | null
          current_owner_team?: string | null
          current_phase?: Database["public"]["Enums"]["project_phase"] | null
          current_phase_comment?: string | null
          current_responsibility?:
            | Database["public"]["Enums"]["responsibility_party"]
            | null
          enable_kp?: boolean
          enable_mcp_document?: boolean
          expected_go_live_date?: string | null
          expected_go_live_is_manual?: boolean
          external_id?: string | null
          faq_help?: Json
          go_live_date?: string | null
          go_live_percent?: number | null
          id?: string
          integration_checklist_link?: string | null
          integration_type?: string | null
          jira_link?: string | null
          kick_off_date?: string
          kp_prod_jwe_key?: string | null
          kp_sandbox_jwe_key?: string | null
          mandatory_apis?: string[]
          mcp_config_id?: string | null
          merchant_name?: string
          mid?: string
          mint_checklist_link?: string | null
          mint_notes?: string | null
          payment_simulator_link?: string | null
          pending_acceptance?: boolean | null
          pg_onboarding?: string | null
          phase2_comment?: string | null
          platform?: string | null
          prod_app_id?: string | null
          prod_app_secret?: string | null
          prod_base_url?: string | null
          prod_config_id?: string | null
          prod_kwikpass_jwe_key?: string | null
          prod_mid?: string | null
          project_notes?: string | null
          project_state?: Database["public"]["Enums"]["project_state"] | null
          sales_spoc?: string | null
          sandbox_app_id?: string | null
          sandbox_app_secret?: string | null
          sandbox_base_url?: string | null
          sandbox_config_id?: string | null
          sandbox_kwikpass_jwe_key?: string | null
          sandbox_mid?: string | null
          sow_link?: string | null
          tenant_id?: string | null
          tracker_month?: string | null
          txns_per_day?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      signup_leads: {
        Row: {
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string
          email: string
          id: string
          job_title: string | null
          name: string
          phone: string | null
          sync_error: string | null
          synced_at: string | null
          user_agent: string | null
        }
        Insert: {
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          email: string
          id?: string
          job_title?: string | null
          name: string
          phone?: string | null
          sync_error?: string | null
          synced_at?: string | null
          user_agent?: string | null
        }
        Update: {
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          email?: string
          id?: string
          job_title?: string | null
          name?: string
          phone?: string | null
          sync_error?: string | null
          synced_at?: string | null
          user_agent?: string | null
        }
        Relationships: []
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
      tenant_integrations: {
        Row: {
          app_base_url: string | null
          created_at: string
          from_email: string | null
          from_name: string | null
          gmail_monitor_address: string | null
          google_mail_api_key: string | null
          id: string
          jira_api_token: string | null
          jira_base_url: string | null
          jira_email: string | null
          jira_project_key: string | null
          reply_to: string | null
          resend_api_key: string | null
          slack_bot_token: string | null
          slack_channel: string | null
          slack_webhook_url: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          app_base_url?: string | null
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          gmail_monitor_address?: string | null
          google_mail_api_key?: string | null
          id?: string
          jira_api_token?: string | null
          jira_base_url?: string | null
          jira_email?: string | null
          jira_project_key?: string | null
          reply_to?: string | null
          resend_api_key?: string | null
          slack_bot_token?: string | null
          slack_channel?: string | null
          slack_webhook_url?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          app_base_url?: string | null
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          gmail_monitor_address?: string | null
          google_mail_api_key?: string | null
          id?: string
          jira_api_token?: string | null
          jira_base_url?: string | null
          jira_email?: string | null
          jira_project_key?: string | null
          reply_to?: string | null
          resend_api_key?: string | null
          slack_bot_token?: string | null
          slack_channel?: string | null
          slack_webhook_url?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
      transfer_history: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          from_team: string
          id: string
          notes: string | null
          project_id: string
          tenant_id: string | null
          to_team: string
          transferred_at: string
          transferred_by: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          from_team: string
          id?: string
          notes?: string | null
          project_id: string
          tenant_id?: string | null
          to_team: string
          transferred_at?: string
          transferred_by: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          from_team?: string
          id?: string
          notes?: string | null
          project_id?: string
          tenant_id?: string | null
          to_team?: string
          transferred_at?: string
          transferred_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_events: {
        Row: {
          created_at: string
          error: string | null
          event_name: string
          id: string
          new_row: Json | null
          old_row: Json | null
          processed_at: string | null
          project_id: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_name: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          processed_at?: string | null
          project_id: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_name?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          processed_at?: string | null
          project_id?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      workflow_runs: {
        Row: {
          created_at: string
          detail: string | null
          event_id: string | null
          id: string
          project_id: string | null
          status: string
          tenant_id: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          event_id?: string | null
          id?: string
          project_id?: string | null
          status: string
          tenant_id?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          event_id?: string | null
          id?: string
          project_id?: string | null
          status?: string
          tenant_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "ai_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_checklist_attachment: {
        Args: { objname: string }
        Returns: boolean
      }
      can_read_merchant_portal_file: {
        Args: { objname: string }
        Returns: boolean
      }
      cron_token_matches: { Args: { _token: string }; Returns: boolean }
      delete_team_cascade: {
        Args: { _slug: string; _team_id: string }
        Returns: undefined
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      is_gokwik_general: { Args: { _user_id: string }; Returns: boolean }
      is_manager: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_tenant_admin: { Args: { _user_id: string }; Returns: boolean }
      project_last_activity: {
        Args: { _tenant_id: string }
        Returns: {
          last_comment_at: string
          project_id: string
        }[]
      }
      recompute_expected_go_live: {
        Args: { _project_id: string }
        Returns: undefined
      }
      role: { Args: never; Returns: string }
      storage_path_project_id: { Args: { objname: string }; Returns: string }
      uid: { Args: never; Returns: string }
      workflow_transfer_project: {
        Args: { _project_id: string; _to_team: string }
        Returns: undefined
      }
      workflow_update_project: {
        Args: { _patch: Json; _project_id: string }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
