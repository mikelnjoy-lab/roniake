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
      subscriptions: {
        Row: {
          business_id: string
          created_at: string
          max_branches: number
          max_staff: number
          max_terminals: number
          period_end: string | null
          plan: string
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          max_branches?: number
          max_staff?: number
          max_terminals?: number
          period_end?: string | null
          plan?: string
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          max_branches?: number
          max_staff?: number
          max_terminals?: number
          period_end?: string | null
          plan?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
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
      branch_business_checked: {
        Args: { _branch: string; _permission: string }
        Returns: string
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
      member_role: {
        Args: { _business: string }
        Returns: Database["public"]["Enums"]["business_role"]
      }
      my_open_shift: { Args: { _branch: string }; Returns: Json }
      open_shift: { Args: { _branch: string; _float: number }; Returns: string }
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
        Args: { _note: string; _status: string; _tender: number }
        Returns: undefined
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
      resolve_tenant_context: {
        Args: { _branch?: string; _business: string }
        Returns: Json
      }
      revoke_support_access: { Args: { _grant: string }; Returns: undefined }
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
      subscription_overview: { Args: { _business: string }; Returns: Json }
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
