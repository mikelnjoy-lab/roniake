import { redirect } from "@tanstack/react-router";
import { getSelection, resolveContext, setSelection } from "@/lib/tenant";

// Every protected screen re-resolves access on the server before showing anything.
export async function requireTenant() {
  const sel = getSelection();
  if (!sel || !sel.branchId) throw redirect({ to: "/select" });
  try {
    const tenant = await resolveContext(sel);
    return { tenant: { ...tenant, branch_id: tenant.branch_id ?? sel.branchId } };
  } catch {
    setSelection(null);
    throw redirect({ to: "/unauthorized" });
  }
}

export const can = (perms: string[], p: string) => perms.includes(p);
export const kes = (n: number | string | null | undefined) =>
  "KES " + Number(n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
