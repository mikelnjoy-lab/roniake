import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { can, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/etims")({
  head: () => ({ meta: [
    { title: "eTIMS — RONIA Business" },
    { name: "description", content: "KRA eTIMS setup, readiness and fiscal transmission log." },
    { property: "og:title", content: "eTIMS — RONIA Business" },
    { property: "og:description", content: "Set up KRA eTIMS details and track fiscal submissions." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: Etims,
});

const STATUS: Record<string, string> = {
  not_configured: "Not configured", configured: "Details entered", kra_onboarding: "KRA onboarding in progress", kra_approved: "KRA approved (production)",
};
const PIN = /^[A-Z][0-9]{9}[A-Z]$/;

function Etims() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const qc = useQueryClient();
  const configure = can(tenant.permissions, "etims.configure");
  const review = configure || can(tenant.permissions, "reports.view");

  const cfg = useQuery({ queryKey: ["etims-cfg", branch], enabled: review,
    queryFn: async () => (await supabase.from("etims_configs").select("*").eq("branch_id", branch).maybeSingle()).data });
  const tx = useQuery({ queryKey: ["etims-tx", branch], enabled: review,
    queryFn: async () => (await supabase.from("etims_transmissions").select("*").eq("branch_id", branch).order("created_at", { ascending: false }).limit(200)).data ?? [] });
  const unsent = useQuery({ queryKey: ["etims-unsent", branch], enabled: review,
    queryFn: async () => {
      const { data: sales } = await supabase.from("sales").select("id").eq("branch_id", branch).eq("status", "completed").order("created_at", { ascending: false }).limit(500);
      const ids = new Set((tx.data ?? []).map((t) => t.sale_id));
      return (sales ?? []).filter((s) => !ids.has(s.id)).length;
    } });

  const [f, setF] = useState({ pin: "", code: "", device: "vscu", serial: "", env: "sandbox", status: "configured" });
  useEffect(() => {
    const c = cfg.data;
    if (c) setF({ pin: c.kra_pin ?? "", code: c.branch_code ?? "", device: c.device_type, serial: c.device_serial ?? "", env: c.environment, status: c.status });
  }, [cfg.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (f.pin && !PIN.test(f.pin.toUpperCase())) { toast.error("KRA PIN looks wrong — e.g. P051234567X"); return; }
    const { error } = await supabase.rpc("save_etims_config", { _branch: branch, _kra_pin: f.pin, _branch_code: f.code, _device_type: f.device, _device_serial: f.serial, _environment: f.env, _status: f.status });
    if (error) { toast.error(error.message); return; }
    toast.success("eTIMS details saved"); qc.invalidateQueries({ queryKey: ["etims-cfg", branch] });
  }

  if (!review) return <AppShell><p className="text-lg font-bold">Only owners, managers and auditors can see eTIMS.</p></AppShell>;
  const status = cfg.data?.status ?? "not_configured";
  const sel = "h-12 w-full rounded-md border-2 border-foreground bg-background px-3 text-base font-bold";

  return (
    <AppShell wide>
      <h1 className="mb-3 text-3xl font-black">eTIMS</h1>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border-4 border-foreground bg-secondary p-4 text-secondary-foreground">
          <p className="text-sm font-black uppercase">RONIA</p>
          <p className="text-xl font-black">eTIMS-ready</p>
          <p className="text-sm font-bold">Receipts carry tax classes A–E and VAT, ready to send.</p>
        </div>
        <div className={`rounded-lg border-4 border-foreground p-4 ${status === "kra_approved" ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
          <p className="text-sm font-black uppercase">KRA</p>
          <p className="text-xl font-black">{status === "kra_approved" ? "Approved for this branch" : "Not KRA certified"}</p>
          <p className="text-sm font-bold">Status: {STATUS[status]}. Receipts are not fiscal invoices until KRA approves.</p>
        </div>
      </div>

      <section className="mb-6 rounded-lg border-4 border-foreground bg-card p-4">
        <h2 className="mb-3 text-xl font-black">KRA connection profile</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="font-bold">KRA PIN<Input className="h-12 text-lg uppercase" value={f.pin} disabled={!configure} placeholder="P051234567X" onChange={(e) => setF({ ...f, pin: e.target.value.toUpperCase() })} /></label>
          <label className="font-bold">KRA branch code<Input className="h-12 text-lg uppercase" value={f.code} disabled={!configure} placeholder="00" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
          <label className="font-bold">Device type<select className={sel} value={f.device} disabled={!configure} onChange={(e) => setF({ ...f, device: e.target.value })}><option value="vscu">VSCU (online, virtual)</option><option value="oscu">OSCU (control unit)</option></select></label>
          <label className="font-bold">Device serial<Input className="h-12 text-lg" value={f.serial} disabled={!configure} onChange={(e) => setF({ ...f, serial: e.target.value })} /></label>
          <label className="font-bold">Environment<select className={sel} value={f.env} disabled={!configure} onChange={(e) => setF({ ...f, env: e.target.value })}><option value="sandbox">Sandbox (testing)</option><option value="production">Production</option></select></label>
          <label className="font-bold">Stage<select className={sel} value={f.status} disabled={!configure} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <p className="mt-2 text-sm font-bold text-muted-foreground">Only mark "KRA approved" once KRA has confirmed your device in production. Every change is recorded.</p>
        {configure && <Button size="lg" className="mt-3 h-14 w-full text-lg font-black" onClick={save}>Save eTIMS details</Button>}
      </section>

      <section className="rounded-lg border-4 border-foreground bg-card p-4">
        <h2 className="mb-2 text-xl font-black">Fiscal transmission queue</h2>
        <p className="mb-3 font-bold">Recent sales not yet sent to KRA: <span className="text-2xl font-black">{unsent.data ?? "…"}</span></p>
        <p className="mb-3 text-sm font-bold text-muted-foreground">Sending to KRA starts once the connection is approved. Until then nothing is sent and no KRA invoice numbers are shown.</p>
        {(tx.data ?? []).length === 0 ? <p className="font-bold">No transmissions yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b-2 border-foreground font-black"><th className="p-2">Time</th><th>Status</th><th>Try</th><th>KRA invoice</th><th>Error</th></tr></thead>
            <tbody>{tx.data!.map((t) => <tr key={t.id} className="border-b"><td className="p-2">{new Date(t.created_at).toLocaleString()}</td><td className="font-black">{t.status}</td><td>{t.attempt}</td><td>{t.kra_invoice_no ?? "—"}</td><td>{t.error_message ?? ""}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </AppShell>
  );
}
