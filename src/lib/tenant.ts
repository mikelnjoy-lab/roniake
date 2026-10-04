import { supabase } from "@/integrations/supabase/client";

// Only remembers WHICH business/branch the user picked. Authorization is always
// re-resolved server-side via resolve_tenant_context (RLS + membership checks).
const KEY = "ronia.active-context";

export type Selection = { businessId: string; branchId: string | null };

export type TenantContext = {
  user_id: string;
  business_id: string;
  branch_id: string | null;
  role: "owner" | "manager" | "cashier" | "auditor";
  lifecycle_state: string;
  permissions: string[];
};

export function getSelection(): Selection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Selection) : null;
  } catch {
    return null;
  }
}

export function setSelection(s: Selection | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

export async function resolveContext(s: Selection): Promise<TenantContext> {
  const { data, error } = await supabase.rpc("resolve_tenant_context", {
    _business: s.businessId,
    _branch: s.branchId ?? undefined,
  });
  if (error) throw error;
  return data as unknown as TenantContext;
}

export const ROLE_LABEL: Record<TenantContext["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  auditor: "Auditor",
};
