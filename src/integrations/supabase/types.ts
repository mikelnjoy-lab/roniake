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
      branch_products: {
        Row: {
          branch_id: string
          business_id: string
          enabled: boolean
          product_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          business_id: string
          enabled?: boolean
          product_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          business_id?: string
          enabled?: boolean
          product_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_receipt_settings: {
        Row: {
          address: string | null
          auto_print: boolean
          branch_id: string
          business_id: string
          copies: number
          display_name: string | null
          footer: string | null
          logo_url: string | null
          paper_width: number
          phone: string | null
          show_address: boolean
          show_cashier: boolean
          show_footer: boolean
          show_logo: boolean
          show_phone: boolean
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          address?: string | null
          auto_print?: boolean
          branch_id: string
          business_id: string
          copies?: number
          display_name?: string | null
          footer?: string | null
          logo_url?: string | null
          paper_width?: number
          phone?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_footer?: boolean
          show_logo?: boolean
          show_phone?: boolean
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          address?: string | null
          auto_print?: boolean
          branch_id?: string
          business_id?: string
          copies?: number
          display_name?: string | null
          footer?: string | null
          logo_url?: string | null
          paper_width?: number
          phone?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_footer?: boolean
          show_logo?: boolean
          show_phone?: boolean
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_receipt_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_receipt_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_stock: {
        Row: {
          branch_id: string
          business_id: string
          product_id: string
          qty_on_hand: number
          updated_at: string
          wac: number
        }
        Insert: {
          branch_id: string
          business_id: string
          product_id: string
          qty_on_hand?: number
          updated_at?: string
          wac?: number
        }
        Update: {
          branch_id?: string
          business_id?: string
          product_id?: string
          qty_on_hand?: number
          updated_at?: string
          wac?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_stock_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_stock_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      customer_ledger: {
        Row: {
          actor_user_id: string | null
          amount: number
          balance_after: number
          business_id: string
          created_at: string
          customer_id: string
          entry_type: string
          id: number
          reference: string | null
          sale_id: string | null
          tender_type: Database["public"]["Enums"]["tender_type"] | null
        }
        Insert: {
          actor_user_id?: string | null
          amount: number
          balance_after: number
          business_id: string
          created_at?: string
          customer_id: string
          entry_type: string
          id?: never
          reference?: string | null
          sale_id?: string | null
          tender_type?: Database["public"]["Enums"]["tender_type"] | null
        }
        Update: {
          actor_user_id?: string | null
          amount?: number
          balance_after?: number
          business_id?: string
          created_at?: string
          customer_id?: string
          entry_type?: string
          id?: never
          reference?: string | null
          sale_id?: string | null
          tender_type?: Database["public"]["Enums"]["tender_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_ledger_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          balance: number
          business_id: string
          created_at: string
          created_by: string | null
          credit_enabled: boolean
          credit_limit: number
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          balance?: number
          business_id: string
          created_at?: string
          created_by?: string | null
          credit_enabled?: boolean
          credit_limit?: number
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          balance?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          credit_enabled?: boolean
          credit_limit?: number
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      etims_configs: {
        Row: {
          branch_code: string | null
          branch_id: string
          business_id: string
          device_serial: string | null
          device_type: string
          environment: string
          id: string
          kra_pin: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_code?: string | null
          branch_id: string
          business_id: string
          device_serial?: string | null
          device_type?: string
          environment?: string
          id?: string
          kra_pin?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_code?: string | null
          branch_id?: string
          business_id?: string
          device_serial?: string | null
          device_type?: string
          environment?: string
          id?: string
          kra_pin?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etims_configs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etims_configs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      etims_transmissions: {
        Row: {
          attempt: number
          branch_id: string
          business_id: string
          created_at: string
          error_message: string | null
          id: number
          kra_invoice_no: string | null
          sale_id: string
          status: string
        }
        Insert: {
          attempt?: number
          branch_id: string
          business_id: string
          created_at?: string
          error_message?: string | null
          id?: never
          kra_invoice_no?: string | null
          sale_id: string
          status: string
        }
        Update: {
          attempt?: number
          branch_id?: string
          business_id?: string
          created_at?: string
          error_message?: string | null
          id?: never
          kra_invoice_no?: string | null
          sale_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "etims_transmissions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etims_transmissions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etims_transmissions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
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
      manual_debt_repayments: {
        Row: {
          amount: number
          business_id: string
          client_ref: string
          created_at: string
          customer_id: string
          debt_id: string
          id: string
          method: Database["public"]["Enums"]["tender_type"]
          paid_on: string
          recorded_by: string
          reference: string | null
        }
        Insert: {
          amount: number
          business_id: string
          client_ref: string
          created_at?: string
          customer_id: string
          debt_id: string
          id?: string
          method: Database["public"]["Enums"]["tender_type"]
          paid_on: string
          recorded_by: string
          reference?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          client_ref?: string
          created_at?: string
          customer_id?: string
          debt_id?: string
          id?: string
          method?: Database["public"]["Enums"]["tender_type"]
          paid_on?: string
          recorded_by?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_debt_repayments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debt_repayments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debt_repayments_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "manual_debts"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_debt_reversals: {
        Row: {
          business_id: string
          client_ref: string
          created_at: string
          debt_id: string
          id: string
          kind: string
          reason: string
          recorded_by: string
          repayment_id: string | null
        }
        Insert: {
          business_id: string
          client_ref: string
          created_at?: string
          debt_id: string
          id?: string
          kind: string
          reason: string
          recorded_by: string
          repayment_id?: string | null
        }
        Update: {
          business_id?: string
          client_ref?: string
          created_at?: string
          debt_id?: string
          id?: string
          kind?: string
          reason?: string
          recorded_by?: string
          repayment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_debt_reversals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debt_reversals_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "manual_debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debt_reversals_repayment_id_fkey"
            columns: ["repayment_id"]
            isOneToOne: false
            referencedRelation: "manual_debt_repayments"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_debt_write_offs: {
        Row: {
          amount: number
          business_id: string
          client_ref: string
          created_at: string
          customer_id: string
          debt_id: string
          id: string
          reason: string
          recorded_by: string
        }
        Insert: {
          amount: number
          business_id: string
          client_ref: string
          created_at?: string
          customer_id: string
          debt_id: string
          id?: string
          reason: string
          recorded_by: string
        }
        Update: {
          amount?: number
          business_id?: string
          client_ref?: string
          created_at?: string
          customer_id?: string
          debt_id?: string
          id?: string
          reason?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_debt_write_offs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debt_write_offs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debt_write_offs_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "manual_debts"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_debts: {
        Row: {
          business_id: string
          client_ref: string
          created_at: string
          customer_id: string
          debt_type: string
          due_on: string | null
          id: string
          incurred_on: string
          notes: string | null
          principal: number
          reason: string
          recorded_by: string
          reference: string | null
        }
        Insert: {
          business_id: string
          client_ref: string
          created_at?: string
          customer_id: string
          debt_type: string
          due_on?: string | null
          id?: string
          incurred_on: string
          notes?: string | null
          principal: number
          reason: string
          recorded_by: string
          reference?: string | null
        }
        Update: {
          business_id?: string
          client_ref?: string
          created_at?: string
          customer_id?: string
          debt_type?: string
          due_on?: string | null
          id?: string
          incurred_on?: string
          notes?: string | null
          principal?: number
          reason?: string
          recorded_by?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_debts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_debts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
      mpesa_configs: {
        Row: {
          account_format: string | null
          branch_id: string | null
          business_id: string
          id: string
          kind: string
          shortcode: string | null
          status: string
          store_number: string | null
          till_number: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_format?: string | null
          branch_id?: string | null
          business_id: string
          id?: string
          kind: string
          shortcode?: string | null
          status?: string
          store_number?: string | null
          till_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_format?: string | null
          branch_id?: string | null
          business_id?: string
          id?: string
          kind?: string
          shortcode?: string | null
          status?: string
          store_number?: string | null
          till_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_configs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mpesa_configs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mpesa_reconciliations: {
        Row: {
          actor_user_id: string
          business_id: string
          created_at: string
          id: number
          note: string | null
          sale_tender_id: number
          status: string
        }
        Insert: {
          actor_user_id: string
          business_id: string
          created_at?: string
          id?: never
          note?: string | null
          sale_tender_id: number
          status: string
        }
        Update: {
          actor_user_id?: string
          business_id?: string
          created_at?: string
          id?: never
          note?: string | null
          sale_tender_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_reconciliations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mpesa_reconciliations_sale_tender_id_fkey"
            columns: ["sale_tender_id"]
            isOneToOne: false
            referencedRelation: "sale_tenders"
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
      plan_versions: {
        Row: {
          billing_period: string
          change_note: string | null
          created_at: string
          created_by: string | null
          features: Json
          id: string
          max_branches: number
          max_staff: number
          max_terminals: number
          plan_id: string
          price_kes: number
          published_at: string | null
          published_by: string | null
          state: string
          version_no: number
        }
        Insert: {
          billing_period: string
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          features?: Json
          id?: string
          max_branches: number
          max_staff: number
          max_terminals: number
          plan_id: string
          price_kes: number
          published_at?: string | null
          published_by?: string | null
          state?: string
          version_no: number
        }
        Update: {
          billing_period?: string
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          features?: Json
          id?: string
          max_branches?: number
          max_staff?: number
          max_terminals?: number
          plan_id?: string
          price_kes?: number
          published_at?: string | null
          published_by?: string | null
          state?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          note: string | null
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          payload: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          payload?: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          payload?: Json
        }
        Relationships: []
      }
      platform_settings: {
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
      products: {
        Row: {
          barcode: string | null
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          is_weighted: boolean
          low_stock_threshold: number | null
          name: string
          parent_product_id: string | null
          plu_code: string | null
          selling_price: number
          sku: string
          tax_class: string
          track_stock: boolean
          unit: string
          units_per_parent: number | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          business_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_weighted?: boolean
          low_stock_threshold?: number | null
          name: string
          parent_product_id?: string | null
          plu_code?: string | null
          selling_price: number
          sku: string
          tax_class?: string
          track_stock?: boolean
          unit?: string
          units_per_parent?: number | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          business_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_weighted?: boolean
          low_stock_threshold?: number | null
          name?: string
          parent_product_id?: string | null
          plu_code?: string | null
          selling_price?: number
          sku?: string
          tax_class?: string
          track_stock?: boolean
          unit?: string
          units_per_parent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
      purchase_invoice_lines: {
        Row: {
          business_id: string
          id: number
          invoice_id: string
          line_cost: number
          product_id: string
          qty: number
          unit_cost: number
        }
        Insert: {
          business_id: string
          id?: never
          invoice_id: string
          line_cost: number
          product_id: string
          qty: number
          unit_cost: number
        }
        Update: {
          business_id?: string
          id?: never
          invoice_id?: string
          line_cost?: number
          product_id?: string
          qty?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          actor_user_id: string
          branch_id: string
          business_id: string
          client_ref: string
          created_at: string
          id: string
          invoice_date: string
          invoice_no: string
          line_count: number
          purchase_order_id: string | null
          supplier_id: string
          total_cost: number
        }
        Insert: {
          actor_user_id: string
          branch_id: string
          business_id: string
          client_ref: string
          created_at?: string
          id?: string
          invoice_date: string
          invoice_no: string
          line_count: number
          purchase_order_id?: string | null
          supplier_id: string
          total_cost: number
        }
        Update: {
          actor_user_id?: string
          branch_id?: string
          business_id?: string
          client_ref?: string
          created_at?: string
          id?: string
          invoice_date?: string
          invoice_no?: string
          line_count?: number
          purchase_order_id?: string | null
          supplier_id?: string
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          business_id: string
          id: number
          po_id: string
          product_id: string
          qty_ordered: number
          qty_received: number
          unit_cost: number
        }
        Insert: {
          business_id: string
          id?: never
          po_id: string
          product_id: string
          qty_ordered: number
          qty_received?: number
          unit_cost: number
        }
        Update: {
          business_id?: string
          id?: never
          po_id?: string
          product_id?: string
          qty_ordered?: number
          qty_received?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: string
          business_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_ref: string
          created_at: string
          created_by: string
          expected_total: number
          id: string
          note: string | null
          po_no: string
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id: string
          business_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_ref: string
          created_at?: string
          created_by: string
          expected_total: number
          id?: string
          note?: string | null
          po_no: string
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string
          business_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_ref?: string
          created_at?: string
          created_by?: string
          expected_total?: number
          id?: string
          note?: string | null
          po_no?: string
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_counters: {
        Row: {
          branch_id: string
          last_no: number
        }
        Insert: {
          branch_id: string
          last_no?: number
        }
        Update: {
          branch_id?: string
          last_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_counters_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
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
      sale_lines: {
        Row: {
          business_id: string
          discount: number
          id: number
          line_cogs: number
          line_no: number
          line_total: number
          product_id: string
          product_name: string
          qty: number
          sale_id: string
          sku: string
          tax_amount: number
          tax_class: string
          unit_cost: number
          unit_price: number
        }
        Insert: {
          business_id: string
          discount?: number
          id?: never
          line_cogs: number
          line_no: number
          line_total: number
          product_id: string
          product_name: string
          qty: number
          sale_id: string
          sku: string
          tax_amount: number
          tax_class: string
          unit_cost: number
          unit_price: number
        }
        Update: {
          business_id?: string
          discount?: number
          id?: never
          line_cogs?: number
          line_no?: number
          line_total?: number
          product_id?: string
          product_name?: string
          qty?: number
          sale_id?: string
          sku?: string
          tax_amount?: number
          tax_class?: string
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_lines_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_lines: {
        Row: {
          business_id: string
          cogs_reversed: number
          id: number
          product_id: string
          qty: number
          refund_amount: number
          return_id: string
          sale_line_id: number
          tax_amount: number
          unit_cost: number
        }
        Insert: {
          business_id: string
          cogs_reversed: number
          id?: never
          product_id: string
          qty: number
          refund_amount: number
          return_id: string
          sale_line_id: number
          tax_amount: number
          unit_cost: number
        }
        Update: {
          business_id?: string
          cogs_reversed?: number
          id?: never
          product_id?: string
          qty?: number
          refund_amount?: number
          return_id?: string
          sale_line_id?: number
          tax_amount?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_lines_sale_line_id_fkey"
            columns: ["sale_line_id"]
            isOneToOne: false
            referencedRelation: "sale_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          actor_user_id: string
          branch_id: string
          business_id: string
          client_ref: string
          cogs_reversed: number
          created_at: string
          id: string
          reason: string
          reference: string | null
          refund_amount: number
          refund_type: Database["public"]["Enums"]["tender_type"]
          return_no: string
          sale_id: string
          shift_id: string | null
          tax_amount: number
        }
        Insert: {
          actor_user_id: string
          branch_id: string
          business_id: string
          client_ref: string
          cogs_reversed: number
          created_at?: string
          id?: string
          reason: string
          reference?: string | null
          refund_amount: number
          refund_type: Database["public"]["Enums"]["tender_type"]
          return_no: string
          sale_id: string
          shift_id?: string | null
          tax_amount: number
        }
        Update: {
          actor_user_id?: string
          branch_id?: string
          business_id?: string
          client_ref?: string
          cogs_reversed?: number
          created_at?: string
          id?: string
          reason?: string
          reference?: string | null
          refund_amount?: number
          refund_type?: Database["public"]["Enums"]["tender_type"]
          return_no?: string
          sale_id?: string
          shift_id?: string | null
          tax_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_tenders: {
        Row: {
          amount: number
          business_id: string
          id: number
          reference: string | null
          sale_id: string
          tender_type: Database["public"]["Enums"]["tender_type"]
        }
        Insert: {
          amount: number
          business_id: string
          id?: never
          reference?: string | null
          sale_id: string
          tender_type: Database["public"]["Enums"]["tender_type"]
        }
        Update: {
          amount?: number
          business_id?: string
          id?: never
          reference?: string | null
          sale_id?: string
          tender_type?: Database["public"]["Enums"]["tender_type"]
        }
        Relationships: [
          {
            foreignKeyName: "sale_tenders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_tenders_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_voids: {
        Row: {
          branch_id: string
          business_id: string
          reason: string
          sale_id: string
          voided_at: string
          voided_by: string
        }
        Insert: {
          branch_id: string
          business_id: string
          reason: string
          sale_id: string
          voided_at?: string
          voided_by: string
        }
        Update: {
          branch_id?: string
          business_id?: string
          reason?: string
          sale_id?: string
          voided_at?: string
          voided_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_voids_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_voids_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_voids_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          branch_id: string
          business_id: string
          cashier_id: string
          change_given: number
          client_txn_id: string
          cogs_total: number
          created_at: string
          customer_id: string | null
          device_id: string | null
          discount_total: number
          id: string
          payload_hash: string
          receipt_no: string
          receipt_snapshot: Json | null
          status: string
          subtotal: number
          tax_total: number
          tendered_total: number
          total: number
        }
        Insert: {
          branch_id: string
          business_id: string
          cashier_id: string
          change_given: number
          client_txn_id: string
          cogs_total: number
          created_at?: string
          customer_id?: string | null
          device_id?: string | null
          discount_total: number
          id?: string
          payload_hash: string
          receipt_no: string
          receipt_snapshot?: Json | null
          status?: string
          subtotal: number
          tax_total: number
          tendered_total: number
          total: number
        }
        Update: {
          branch_id?: string
          business_id?: string
          cashier_id?: string
          change_given?: number
          client_txn_id?: string
          cogs_total?: number
          created_at?: string
          customer_id?: string | null
          device_id?: string | null
          discount_total?: number
          id?: string
          payload_hash?: string
          receipt_no?: string
          receipt_snapshot?: Json | null
          status?: string
          subtotal?: number
          tax_total?: number
          tendered_total?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_payouts: {
        Row: {
          actor_user_id: string
          amount: number
          branch_id: string
          business_id: string
          category: string
          created_at: string
          id: number
          reason: string
          shift_id: string
        }
        Insert: {
          actor_user_id: string
          amount: number
          branch_id: string
          business_id: string
          category: string
          created_at?: string
          id?: never
          reason: string
          shift_id: string
        }
        Update: {
          actor_user_id?: string
          amount?: number
          branch_id?: string
          business_id?: string
          category?: string
          created_at?: string
          id?: never
          reason?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_payouts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payouts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payouts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          branch_id: string
          business_id: string
          cashier_id: string
          closed_at: string | null
          counted_cash: number | null
          expected_cash: number | null
          id: string
          opened_at: string
          opening_float: number
          status: string
          variance: number | null
        }
        Insert: {
          branch_id: string
          business_id: string
          cashier_id: string
          closed_at?: string | null
          counted_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_float: number
          status?: string
          variance?: number | null
        }
        Update: {
          branch_id?: string
          business_id?: string
          cashier_id?: string
          closed_at?: string | null
          counted_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_float?: number
          status?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          business_id: string
          count_id: string
          counted_qty: number
          id: number
          product_id: string
          system_qty: number
          unit_cost: number
          variance: number
        }
        Insert: {
          business_id: string
          count_id: string
          counted_qty: number
          id?: never
          product_id: string
          system_qty: number
          unit_cost: number
          variance: number
        }
        Update: {
          business_id?: string
          count_id?: string
          counted_qty?: number
          id?: never
          product_id?: string
          system_qty?: number
          unit_cost?: number
          variance?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          actor_user_id: string | null
          branch_id: string
          business_id: string
          created_at: string
          id: string
          lines_adjusted: number
          lines_counted: number
          note: string | null
        }
        Insert: {
          actor_user_id?: string | null
          branch_id: string
          business_id: string
          created_at?: string
          id?: string
          lines_adjusted: number
          lines_counted: number
          note?: string | null
        }
        Update: {
          actor_user_id?: string | null
          branch_id?: string
          business_id?: string
          created_at?: string
          id?: string
          lines_adjusted?: number
          lines_counted?: number
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          actor_user_id: string | null
          branch_id: string
          business_id: string
          created_at: string
          id: number
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          note: string | null
          product_id: string
          qty: number
          qty_after: number
          ref_id: string | null
          ref_type: string | null
          unit_cost: number
          wac_after: number
        }
        Insert: {
          actor_user_id?: string | null
          branch_id: string
          business_id: string
          created_at?: string
          id?: never
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          note?: string | null
          product_id: string
          qty: number
          qty_after: number
          ref_id?: string | null
          ref_type?: string | null
          unit_cost: number
          wac_after: number
        }
        Update: {
          actor_user_id?: string | null
          branch_id?: string
          business_id?: string
          created_at?: string
          id?: never
          movement_type?: Database["public"]["Enums"]["stock_movement_type"]
          note?: string | null
          product_id?: string
          qty?: number
          qty_after?: number
          ref_id?: string | null
          ref_type?: string | null
          unit_cost?: number
          wac_after?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          actor_user_id: string | null
          billing_period: string | null
          business_id: string
          created_at: string
          event: string
          id: number
          max_branches: number | null
          max_staff: number | null
          max_terminals: number | null
          note: string | null
          plan_id: string | null
          plan_version_id: string | null
          price_kes: number | null
          status: string | null
        }
        Insert: {
          actor_user_id?: string | null
          billing_period?: string | null
          business_id: string
          created_at?: string
          event: string
          id?: never
          max_branches?: number | null
          max_staff?: number | null
          max_terminals?: number | null
          note?: string | null
          plan_id?: string | null
          plan_version_id?: string | null
          price_kes?: number | null
          status?: string | null
        }
        Update: {
          actor_user_id?: string | null
          billing_period?: string | null
          business_id?: string
          created_at?: string
          event?: string
          id?: never
          max_branches?: number | null
          max_staff?: number | null
          max_terminals?: number | null
          note?: string | null
          plan_id?: string | null
          plan_version_id?: string | null
          price_kes?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          current_version_id: string | null
          description: string | null
          id: string
          name: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          business_id: string
          created_at: string
          max_branches: number
          max_staff: number
          max_terminals: number
          period_end: string | null
          plan: string
          plan_id: string | null
          plan_version_id: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          max_branches?: number
          max_staff?: number
          max_terminals?: number
          period_end?: string | null
          plan?: string
          plan_id?: string | null
          plan_version_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          max_branches?: number
          max_staff?: number
          max_terminals?: number
          period_end?: string | null
          plan?: string
          plan_id?: string | null
          plan_version_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          actor_user_id: string
          amount: number
          branch_id: string
          business_id: string
          client_ref: string
          created_at: string
          id: string
          invoice_id: string
          method: string
          paid_on: string
          reference: string | null
          supplier_id: string
        }
        Insert: {
          actor_user_id: string
          amount: number
          branch_id: string
          business_id: string
          client_ref: string
          created_at?: string
          id?: string
          invoice_id: string
          method: string
          paid_on: string
          reference?: string | null
          supplier_id: string
        }
        Update: {
          actor_user_id?: string
          amount?: number
          branch_id?: string
          business_id?: string
          client_ref?: string
          created_at?: string
          id?: string
          invoice_id?: string
          method?: string
          paid_on?: string
          reference?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kra_pin: string | null
          name: string
          payment_terms_days: number
          phone: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kra_pin?: string | null
          name: string
          payment_terms_days?: number
          phone?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kra_pin?: string | null
          name?: string
          payment_terms_days?: number
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      support_grants: {
        Row: {
          business_id: string
          expires_at: string
          granted_at: string
          granted_by: string
          id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          scope: string
        }
        Insert: {
          business_id: string
          expires_at: string
          granted_at?: string
          granted_by: string
          id?: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope: string
        }
        Update: {
          business_id?: string
          expires_at?: string
          granted_at?: string
          granted_by?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
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
      adjust_stock: {
        Args: {
          _branch: string
          _product: string
          _qty_delta: number
          _reason: string
        }
        Returns: Json
      }
      apply_stock_count: {
        Args: { _branch: string; _lines: Json; _note?: string }
        Returns: Json
      }
      apply_stock_movement: {
        Args: {
          _branch: string
          _business: string
          _note: string
          _product: string
          _qty: number
          _ref_id: string
          _ref_type: string
          _type: Database["public"]["Enums"]["stock_movement_type"]
          _unit_cost: number
        }
        Returns: number
      }
      approve_purchase_order: { Args: { _po: string }; Returns: Json }
      bootstrap_platform_owner: {
        Args: { _email: string; _note?: string }
        Returns: string
      }
      branch_business_checked: {
        Args: { _branch: string; _permission: string }
        Returns: string
      }
      branch_catalog: {
        Args: { _branch: string }
        Returns: {
          barcode: string | null
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          is_weighted: boolean
          low_stock_threshold: number | null
          name: string
          parent_product_id: string | null
          plu_code: string | null
          selling_price: number
          sku: string
          tax_class: string
          track_stock: boolean
          unit: string
          units_per_parent: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      branch_stock_levels: {
        Args: { _branch: string }
        Returns: {
          product_id: string
          qty_on_hand: number
        }[]
      }
      break_bulk: {
        Args: { _branch: string; _child_product: string; _parent_qty: number }
        Returns: Json
      }
      can_access_branch: { Args: { _branch: string }; Returns: boolean }
      can_access_branch_row: {
        Args: { _branch: string; _business: string }
        Returns: boolean
      }
      cancel_purchase_order: {
        Args: { _po: string; _reason: string }
        Returns: Json
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
      close_shift: { Args: { _counted: number; _shift: string }; Returns: Json }
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
      create_purchase_order: {
        Args: {
          _branch: string
          _client_ref: string
          _lines: Json
          _note: string
          _supplier: string
        }
        Returns: Json
      }
      grant_support_access: {
        Args: {
          _business: string
          _hours: number
          _reason: string
          _scope: string
        }
        Returns: string
      }
      has_permission: {
        Args: { _business: string; _permission: string }
        Returns: boolean
      }
      invite_member_by_email: {
        Args: {
          _all_branches?: boolean
          _branch_ids?: string[]
          _business: string
          _email: string
          _role: Database["public"]["Enums"]["business_role"]
        }
        Returns: string
      }
      is_business_member: { Args: { _business: string }; Returns: boolean }
      is_platform_owner: { Args: never; Returns: boolean }
      list_members: {
        Args: { _business: string }
        Returns: {
          all_branches: boolean
          branch_names: string[]
          email: string
          membership_id: string
          role: Database["public"]["Enums"]["business_role"]
          status: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }[]
      }
      manual_debt_figures: {
        Args: { _debt: string }
        Returns: {
          collectable: number
          outstanding: number
          principal: number
          recovered: number
          repaid: number
          reversed: boolean
          written_off: number
        }[]
      }
      manual_debt_register: {
        Args: { _business: string }
        Returns: {
          created_at: string
          customer_id: string
          customer_name: string
          debt_type: string
          due_on: string
          id: string
          incurred_on: string
          notes: string
          outstanding: number
          paid: number
          principal: number
          reason: string
          recorded_by: string
          recorded_by_email: string
          recovered: number
          reference: string
          status: string
          written_off: number
        }[]
      }
      member_role: {
        Args: { _business: string }
        Returns: Database["public"]["Enums"]["business_role"]
      }
      my_open_shift: { Args: { _branch: string }; Returns: Json }
      open_shift: { Args: { _branch: string; _float: number }; Returns: string }
      platform_assign_plan: {
        Args: { _business: string; _note?: string; _plan: string }
        Returns: Json
      }
      platform_discard_plan_draft: {
        Args: { _plan: string }
        Returns: undefined
      }
      platform_grant_owner: {
        Args: { _email: string; _note?: string }
        Returns: string
      }
      platform_list_businesses: {
        Args: never
        Returns: {
          branches: number
          business_id: string
          created_at: string
          current_version_no: number
          lifecycle_state: Database["public"]["Enums"]["business_lifecycle"]
          max_branches: number
          max_staff: number
          max_terminals: number
          name: string
          plan_id: string
          plan_name: string
          price_kes: number
          staff: number
          status: string
          terminals: number
          trial_ends_at: string
          version_no: number
        }[]
      }
      platform_list_owners: {
        Args: never
        Returns: {
          email: string
          granted_at: string
          note: string
          revoked_at: string
          user_id: string
        }[]
      }
      platform_move_subscribers: { Args: { _plan: string }; Returns: number }
      platform_preview_plan: { Args: { _plan: string }; Returns: Json }
      platform_publish_plan: { Args: { _plan: string }; Returns: Json }
      platform_revoke_owner: { Args: { _user: string }; Returns: undefined }
      platform_save_plan: {
        Args: {
          _code: string
          _description: string
          _id: string
          _name: string
          _sort?: number
        }
        Returns: string
      }
      platform_save_plan_draft: {
        Args: {
          _branches: number
          _features: Json
          _note: string
          _period: string
          _plan: string
          _price: number
          _staff: number
          _terminals: number
        }
        Returns: string
      }
      platform_set_plan_status: {
        Args: { _plan: string; _status: string }
        Returns: undefined
      }
      platform_set_trial_days: { Args: { _days: number }; Returns: undefined }
      post_purchase_invoice_internal: {
        Args: {
          _biz: string
          _branch: string
          _client_ref: string
          _invoice_date: string
          _invoice_no: string
          _lines: Json
          _po: string
          _supplier: string
        }
        Returns: Json
      }
      post_sale: {
        Args: {
          _branch: string
          _client_txn_id: string
          _customer?: string
          _device_id?: string
          _lines: Json
          _tenders: Json
        }
        Returns: Json
      }
      product_in_business: {
        Args: { _business: string; _product: string }
        Returns: {
          barcode: string | null
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          is_weighted: boolean
          low_stock_threshold: number | null
          name: string
          parent_product_id: string | null
          plu_code: string | null
          selling_price: number
          sku: string
          tax_class: string
          track_stock: boolean
          unit: string
          units_per_parent: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_purchase_invoice: {
        Args: {
          _branch: string
          _client_ref: string
          _invoice_date: string
          _invoice_no: string
          _lines: Json
          _supplier: string
        }
        Returns: Json
      }
      receive_purchase_order: {
        Args: {
          _client_ref: string
          _invoice_date: string
          _invoice_no: string
          _lines: Json
          _po: string
        }
        Returns: Json
      }
      receive_stock: {
        Args: {
          _branch: string
          _product: string
          _qty: number
          _reference?: string
          _unit_cost: number
        }
        Returns: Json
      }
      reconcile_mpesa: {
        Args: {
          _note?: string
          _statement_amount?: number
          _status: string
          _tender: number
        }
        Returns: Json
      }
      record_deni_repayment: {
        Args: {
          _amount: number
          _customer: string
          _reference?: string
          _type: Database["public"]["Enums"]["tender_type"]
        }
        Returns: Json
      }
      record_manual_debt: {
        Args: {
          _client_ref: string
          _customer: string
          _due_on: string
          _incurred_on: string
          _notes: string
          _principal: number
          _reason: string
          _reference: string
          _type: string
        }
        Returns: Json
      }
      record_manual_debt_repayment: {
        Args: {
          _amount: number
          _client_ref: string
          _debt: string
          _method: Database["public"]["Enums"]["tender_type"]
          _paid_on: string
          _reference: string
        }
        Returns: Json
      }
      record_shift_payout: {
        Args: {
          _amount: number
          _category: string
          _reason: string
          _shift: string
        }
        Returns: number
      }
      record_supplier_payment: {
        Args: {
          _amount: number
          _client_ref: string
          _invoice: string
          _method: string
          _paid_on: string
          _reference: string
        }
        Returns: Json
      }
      require_platform_owner: { Args: never; Returns: undefined }
      resolve_tenant_context: {
        Args: { _branch?: string; _business: string }
        Returns: Json
      }
      return_sale_items: {
        Args: {
          _client_ref: string
          _lines: Json
          _reason: string
          _reference: string
          _refund_type: Database["public"]["Enums"]["tender_type"]
          _sale: string
        }
        Returns: Json
      }
      reverse_manual_debt_entry: {
        Args: {
          _client_ref: string
          _debt: string
          _reason: string
          _repayment: string
        }
        Returns: Json
      }
      revoke_support_access: { Args: { _grant: string }; Returns: undefined }
      sales_history: {
        Args: {
          _branch: string
          _business: string
          _cashier?: string
          _from: string
          _limit?: number
          _offset?: number
          _status?: string
          _tender?: string
          _to: string
        }
        Returns: Json
      }
      save_branch_receipt_settings: {
        Args: { _branch: string; _s: Json }
        Returns: number
      }
      save_etims_config: {
        Args: {
          _branch: string
          _branch_code: string
          _device_serial: string
          _device_type: string
          _environment: string
          _kra_pin: string
          _status: string
        }
        Returns: string
      }
      save_mpesa_config: {
        Args: {
          _account_format: string
          _branch: string
          _business: string
          _kind: string
          _shortcode: string
          _status: string
          _store: string
          _till: string
        }
        Returns: string
      }
      save_supplier: {
        Args: {
          _active?: boolean
          _business: string
          _id: string
          _kra_pin: string
          _name: string
          _phone: string
          _terms: number
        }
        Returns: string
      }
      set_branch_product: {
        Args: { _branch: string; _enabled: boolean; _product: string }
        Returns: undefined
      }
      subscription_overview: { Args: { _business: string }; Returns: Json }
      supplier_balances: {
        Args: { _business: string }
        Returns: {
          invoiced: number
          outstanding: number
          overdue: number
          paid: number
          supplier_id: string
          supplier_name: string
        }[]
      }
      void_sale: { Args: { _reason: string; _sale: string }; Returns: Json }
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
      write_off_manual_debt: {
        Args: {
          _amount: number
          _client_ref: string
          _debt: string
          _reason: string
        }
        Returns: Json
      }
      write_platform_audit: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _payload: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      business_lifecycle: "setup" | "active" | "suspended" | "closed"
      business_role: "owner" | "manager" | "cashier" | "auditor"
      membership_status: "invited" | "active" | "suspended" | "revoked"
      stock_movement_type:
        | "receipt"
        | "sale"
        | "adjustment"
        | "break_out"
        | "break_in"
      tender_type: "cash" | "mpesa_manual" | "card" | "other" | "deni"
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
      stock_movement_type: [
        "receipt",
        "sale",
        "adjustment",
        "break_out",
        "break_in",
      ],
      tender_type: ["cash", "mpesa_manual", "card", "other", "deni"],
    },
  },
} as const
