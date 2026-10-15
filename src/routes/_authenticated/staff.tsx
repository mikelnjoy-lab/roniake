import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/lib/tenant";
import { can, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({ meta: [{ title: "Staff — RONIA Business" }, { name: "description", content: "Add staff, set roles and branch access." }] }),
  beforeLoad: requireTenant,
  component: Staff,
});

type Role = "owner" | "manager" | "cashier" | "auditor";

function Staff() {
  const { tenant } = Route.useRouteContext();
  const qc = useQueryClient();
  const view = can(tenant.permissions, "members.view");
  const manage = can(tenant.permissions, "members.manage");
  const isOwner = can(tenant.permissions, "members.manage_owner");
  const members = useQuery({
    queryKey: ["members", tenant.business_id], enabled: view,
    queryFn: async () => { const { data, error } = await supabase.rpc("list_members", { _business: tenant.business_id }); if (error) throw error; return data ?? []; },
  });
  const branches = useQuery({
    queryKey: ["branches", tenant.business_id],
    queryFn: async () => (await supabase.from("branches").select("id,name").eq("business_id", tenant.business_id).order("name")).data ?? [],
  });
  const [f, setF] = useState({ email: "", role: "cashier" as Role, all: false, branchIds: [tenant.branch_id!] as string[] });

  if (!view) return <AppShell><p className="text-xl font-bold">Your role can't view staff.</p></AppShell>;

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.rpc("invite_member_by_email", { _business: tenant.business_id, _email: f.email, _role: f.role, _branch_ids: f.branchIds, _all_branches: f.all });
    if (error) { toast.error(error.message); return; }
    toast.success("Staff member added"); setF({ ...f, email: "" }); qc.invalidateQueries({ queryKey: ["members"] });
  };
  const setStatus = async (id: string, status: "active" | "suspended") => {
    const { error } = await supabase.from("business_memberships").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(status === "active" ? "Reactivated" : "Suspended"); qc.invalidateQueries({ queryKey: ["members"] }); }
  };
  const roles: Role[] = isOwner ? ["cashier", "manager", "auditor", "owner"] : ["cashier", "manager", "auditor"];

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Staff</h1>
      {manage && (
        <form onSubmit={invite} className="mt-3 grid gap-3 rounded-xl border-4 border-foreground bg-card p-4 sm:grid-cols-2">
          <p className="font-bold sm:col-span-2">The person must first create a RONIA account with this email.</p>
          <div><Label>Email</Label><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Role</Label>
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} className="h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg">
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></div>
          <label className="flex items-center gap-2 text-lg font-bold sm:col-span-2"><input type="checkbox" className="size-6" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} /> All branches</label>
          {!f.all && <div className="flex flex-wrap gap-2 sm:col-span-2">{(branches.data ?? []).map((b) => {
            const on = f.branchIds.includes(b.id);
            return <Button type="button" key={b.id} variant={on ? "default" : "outline"} className="border-2 font-bold" onClick={() => setF({ ...f, branchIds: on ? f.branchIds.filter((x) => x !== b.id) : [...f.branchIds, b.id] })}>{b.name}</Button>;
          })}</div>}
          <Button size="lg" className="h-14 text-lg font-black sm:col-span-2">Add staff member</Button>
        </form>
      )}
      <ul className="mt-4 space-y-2">
        {(members.data ?? []).map((m) => (
          <li key={m.membership_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-foreground bg-card p-3">
            <span><b className="text-lg">{m.email ?? m.user_id}</b>
              <span className="block text-sm">{ROLE_LABEL[m.role as Role]} · {m.all_branches ? "All branches" : (m.branch_names ?? []).join(", ") || "No branch"} · <b className={m.status === "active" ? "" : "text-destructive"}>{m.status}</b></span></span>
            {manage && m.role !== "owner" && (m.status === "active"
              ? <Button variant="destructive" onClick={() => setStatus(m.membership_id, "suspended")}>Suspend</Button>
              : <Button variant="outline" className="border-2" onClick={() => setStatus(m.membership_id, "active")}>Reactivate</Button>)}
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
