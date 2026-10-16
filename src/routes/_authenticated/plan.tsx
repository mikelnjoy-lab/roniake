import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { can, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/plan")({
  head: () => ({ meta: [
    { title: "Plan & Support — RONIA Business" },
    { name: "description", content: "Your RONIA plan, usage limits and temporary support access." },
    { property: "og:title", content: "Plan & Support — RONIA Business" },
    { property: "og:description", content: "See plan limits and control support access." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: Plan,
});

type Overview = { plan: string; status: string; period_end: string | null; max_branches: number; max_terminals: number; max_staff: number; branches: number; staff: number; terminals: number };

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  const over = used > max, near = used >= max;
  return (
    <div className="rounded-lg border-4 border-foreground bg-card p-3">
      <div className="flex justify-between font-black"><span>{label}</span><span>{used} / {max}</span></div>
      <div className="mt-2 h-4 rounded bg-muted"><div className={`h-4 rounded ${near ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
      {over && <p className="mt-1 text-sm font-bold text-destructive">Over your plan limit — selling still works; please upgrade.</p>}
    </div>
  );
}

function Plan() {
  const { tenant } = Route.useRouteContext();
  const biz = tenant.business_id;
  const qc = useQueryClient();
  const grantor = can(tenant.permissions, "support.grant");
  const seeGrants = grantor || can(tenant.permissions, "audit.view");

  const ov = useQuery({ queryKey: ["plan", biz], queryFn: async () => {
    const { data, error } = await supabase.rpc("subscription_overview", { _business: biz });
    if (error) throw error; return data as unknown as Overview;
  } });
  const grants = useQuery({ queryKey: ["support", biz], enabled: seeGrants, refetchInterval: 30000,
    queryFn: async () => (await supabase.from("support_grants").select("*").eq("business_id", biz).order("granted_at", { ascending: false }).limit(50)).data ?? [] });
  const active = grants.data?.find((g) => !g.revoked_at && new Date(g.expires_at) > new Date());

  const [scope, setScope] = useState("read_only");
  const [hours, setHours] = useState(4);
  const [reason, setReason] = useState("");

  async function grant() {
    if (reason.trim().length < 5) { toast.error("Say why support needs access"); return; }
    const { error } = await supabase.rpc("grant_support_access", { _business: biz, _scope: scope, _reason: reason, _hours: hours });
    if (error) { toast.error(error.message); return; }
    toast.success(`Support access on for ${hours}h`); setReason(""); qc.invalidateQueries({ queryKey: ["support", biz] });
  }
  async function revoke(id: string) {
    const { error } = await supabase.rpc("revoke_support_access", { _grant: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Support access ended"); qc.invalidateQueries({ queryKey: ["support", biz] });
  }

  const o = ov.data;
  const sel = "h-12 w-full rounded-md border-2 border-foreground bg-background px-3 text-base font-bold";
  return (
    <AppShell wide>
      <h1 className="mb-3 text-3xl font-black">Plan & Support</h1>
      {o && (
        <section className="mb-6">
          <div className="mb-3 rounded-lg border-4 border-foreground bg-secondary p-4 text-secondary-foreground">
            <p className="text-2xl font-black capitalize">{o.plan} plan · {o.status.replace("_", " ")}</p>
            {o.period_end && <p className="font-bold">Renews {new Date(o.period_end).toLocaleDateString()}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Meter label="Branches" used={o.branches} max={o.max_branches} />
            <Meter label="Tills (last 30 days)" used={o.terminals} max={o.max_terminals} />
            <Meter label="Active staff" used={o.staff} max={o.max_staff} />
          </div>
        </section>
      )}

      {seeGrants && (
        <section className="rounded-lg border-4 border-foreground bg-card p-4">
          <h2 className="mb-2 text-xl font-black">Support access</h2>
          <p className="mb-3 text-sm font-bold text-muted-foreground">RONIA support can't see your shop unless the owner turns this on. It switches off by itself, and every grant is recorded.</p>
          {active ? (
            <div className="mb-4 rounded-lg border-4 border-destructive p-4">
              <p className="text-lg font-black">ON — {active.scope === "read_only" ? "view only" : "troubleshooting"}</p>
              <p className="font-bold">Ends {new Date(active.expires_at).toLocaleString()} · {active.reason}</p>
              {grantor && <Button variant="destructive" size="lg" className="mt-3 h-14 w-full text-lg font-black" onClick={() => revoke(active.id)}>End support access now</Button>}
            </div>
          ) : grantor ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <label className="font-bold">What they can do<select className={sel} value={scope} onChange={(e) => setScope(e.target.value)}><option value="read_only">View only</option><option value="troubleshoot">Troubleshoot</option></select></label>
              <label className="font-bold">For how long<select className={sel} value={hours} onChange={(e) => setHours(+e.target.value)}>{[1, 4, 8, 24].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>)}</select></label>
              <label className="font-bold">Why<Input className="h-12 text-lg" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. till not printing" /></label>
              <Button size="lg" className="h-14 text-lg font-black sm:col-span-3" onClick={grant}>Turn on support access</Button>
            </div>
          ) : <p className="mb-4 font-bold">Support access is off.</p>}
          <h3 className="mb-2 font-black">History</h3>
          {(grants.data ?? []).length === 0 ? <p className="font-bold">Never granted.</p> : (
            <ul className="space-y-1 text-sm">{grants.data!.map((g) => (
              <li key={g.id} className="border-b py-1 font-bold">{new Date(g.granted_at).toLocaleString()} · {g.scope === "read_only" ? "view only" : "troubleshoot"} · {g.reason} · {g.revoked_at ? `ended ${new Date(g.revoked_at).toLocaleString()}` : new Date(g.expires_at) < new Date() ? "expired" : "active"}</li>
            ))}</ul>
          )}
        </section>
      )}
    </AppShell>
  );
}
