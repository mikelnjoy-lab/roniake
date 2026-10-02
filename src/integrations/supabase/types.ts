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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          branch_id: string | null
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          payload: Json
          request_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          branch_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          payload?: Json
          request_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          branch_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          payload?: Json
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          business_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          physical_address: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          physical_address?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          physical_address?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_memberships: {
        Row: {
          all_branches: boolean
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["business_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          all_branches?: boolean
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["business_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          all_branches?: boolean
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["business_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_memberships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          email: string | null
          id: string
          kra_pin: string | null
          legal_name: string | null
          lifecycle_state: Database["public"]["Enums"]["business_lifecycle"]
          name: string
          organization_id: string
          phone: string | null
          physical_address: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          email?: string | null
          id?: string
          kra_pin?: string | null
          legal_name?: string | null
          lifecycle_state?: Database["public"]["Enums"]["business_lifecycle"]
          name: string
          organization_id: string
          phone?: string | null
          physical_address?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          email?: string | null
          id?: string
          kra_pin?: string | null
          legal_name?: string | null
          lifecycle_state?: Database["public"]["Enums"]["business_lifecycle"]
          name?: string
          organization_id?: string
          phone?: string | null
          physical_address?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "businesses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          actor_user_id: string
          business_id: string
          created_at: string
          idem_key: string
          request_hash: string
          response: Json | null
          scope: string
        }
        Insert: {
          actor_user_id: string
          business_id: string
          created_at?: string
          idem_key: string
          request_hash: string
          response?: Json | null
          scope: string
        }
        Update: {
          actor_user_id?: string
          business_id?: string
          created_at?: string
          idem_key?: string
          request_hash?: string
          response?: Json | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_branches: {
        Row: {
          branch_id: string
          created_at: string
          membership_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          membership_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_branches_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "business_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["business_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["business_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["business_role"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_business_member: {
        Args: {
          _branch_ids?: string[]
          _business: string
          _role: Database["public"]["Enums"]["business_role"]
          _user: string
        }
        Returns: string
      }
      can_access_branch: { Args: { _branch: string }; Returns: boolean }
      can_access_branch_row: {
        Args: { _branch: string; _business: string }
        Returns: boolean
      }
      claim_idempotency: {
        Args: {
          _business: string
          _key: string
          _request_hash: string
          _scope: string
        }
        Returns: Json
      }
      complete_idempotency: {
        Args: {
          _business: string
          _key: string
          _response: Json
          _scope: string
        }
        Returns: undefined
      }
      create_business: {
        Args: { _branch_code?: string; _branch_name: string; _name: string }
        Returns: string
      }
      has_permission: {
        Args: { _business: string; _permission: string }
        Returns: boolean
      }
      is_business_member: { Args: { _business: string }; Returns: boolean }
      member_role: {
        Args: { _business: string }
        Returns: Database["public"]["Enums"]["business_role"]
      }
      resolve_tenant_context: {
        Args: { _branch?: string; _business: string }
        Returns: Json
      }
      write_audit: {
        Args: {
          _action: string
          _branch: string
          _business: string
          _entity_id: string
          _entity_type: string
          _payload: Json
          _request_id?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      business_lifecycle: "setup" | "active" | "suspended" | "closed"
      business_role: "owner" | "manager" | "cashier" | "auditor"
      membership_status: "invited" | "active" | "suspended" | "revoked"
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
      business_lifecycle: ["setup", "active", "suspended", "closed"],
      business_role: ["owner", "manager", "cashier", "auditor"],
      membership_status: ["invited", "active", "suspended", "revoked"],
    },
  },
} as const
