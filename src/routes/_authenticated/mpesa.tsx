import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/mpesa")({
  head: () => ({ meta: [
    { title: "M-Pesa — RONIA Business" },
    { name: "description", content: "Till and PayBill setup, readiness and payment reconciliation." },
    { property: "og:title", content: "M-Pesa — RONIA Business" },
    { property: "og:description", content: "Set up M-Pesa and check every M-Pesa payment." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: Mpesa,
});

const STEPS = [["configured", "Configured"], ["credentials_pending", "Credentials pending"], ["live_ready", "Live ready"]] as const;

function Mpesa() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const biz = tenant.business_id;
  const qc = useQueryClient();
  const configure = can(tenant.permissions, "mpesa.configure");
  const review = configure || can(tenant.permissions, "reports.view");

  const cfg = useQuery({
    queryKey: ["mpesa-cfg", branch], enabled: review,
    queryFn: async () => (await supabase.from("mpesa_configs").select("*").eq("business_id", biz).or(`branch_id.eq.${branch},branch_id.is.null`)).data ?? [],
  });
  const current = cfg.data?.find((c) => c.branch_id === branch) ?? cfg.data?.find((c) => c.branch_id == null);

  const [f, setF] = useState({ kind: "till", store: "", till: "", shortcode: "", account: "", status: "configured", scope: "branch" });
  useEffect(() => {
    if (current) setF({ kind: current.kind, store: current.store_number ?? "", till: current.till_number ?? "", shortcode: current.shortcode ?? "", account: current.account_format ?? "", status: current.status === "live_ready" ? "credentials_pending" : current.status, scope: current.branch_id ? "branch" : "business" });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const { error } = await supabase.rpc("save_mpesa_config", { _business: biz, _branch: (f.scope === "branch" ? branch : null) as string, _kind: f.kind, _store: f.store, _till: f.till, _shortcode: f.shortcode, _account_format: f.account, _status: f.status });
    if (error) { toast.error(error.message); return; }
    toast.success("M-Pesa details saved"); qc.invalidateQueries({ queryKey: ["mpesa-cfg", branch] });
  }

  const [days, setDays] = useState(1);
  const [filter, setFilter] = useState<"pending" | "verified" | "flagged" | "all">("pending");
  const pay = useQuery({
    queryKey: ["mpesa-pay", branch, days], enabled: review,
    queryFn: async () => {
      const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
      const { data: sales } = await supabase.from("sales").select("id,receipt_no,created_at,cashier_id").eq("branch_id", branch).gte("created_at", from.toISOString()).limit(2000);
      const ids = (sales ?? []).map((s) => s.id);
      const t: { id: number; sale_id: string; amount: number; reference: string | null }[] = [];
      for (let i = 0; i < ids.length; i += 200) t.push(...((await supabase.from("sale_tenders").select("id,sale_id,amount,reference").eq("tender_type", "mpesa_manual").in("sale_id", ids.slice(i, i + 200))).data ?? []));
      const tids = t.map((x) => x.id);
      const r: { sale_tender_id: number; status: string; note: string | null; created_at: string }[] = [];
      for (let i = 0; i < tids.length; i += 200) r.push(...((await supabase.from("mpesa_reconciliations").select("sale_tender_id,status,note,created_at").in("sale_tender_id", tids.slice(i, i + 200)).order("created_at", { ascending: false })).data ?? []));
      const last = new Map<number, (typeof r)[number]>();
      for (const x of r) if (!last.has(x.sale_tender_id)) last.set(x.sale_tender_id, x);
      const sm = new Map((sales ?? []).map((s) => [s.id, s]));
      const counts = new Map<string, number>();
      for (const x of t) if (x.reference) counts.set(x.reference.toUpperCase(), (counts.get(x.reference.toUpperCase()) ?? 0) + 1);
      return t.map((x) => ({ ...x, sale: sm.get(x.sale_id)!, rec: last.get(x.id), duplicate: !!x.reference && (counts.get(x.reference.toUpperCase()) ?? 0) > 1 }))
        .sort((a, b) => +new Date(b.sale.created_at) - +new Date(a.sale.created_at));
    },
  });

  async function mark(id: number, status: "verified" | "flagged", amount: number) {
    let note = "";
    let stmt: number | undefined;
    if (status === "flagged") { note = window.prompt("What doesn't match? (e.g. amount differs, code not on statement)") ?? ""; if (note.trim().length < 3) return; }
    else {
      const v = window.prompt("Amount shown on your M-Pesa statement (KES)", String(amount));
      if (v === null) return;
      stmt = Number(v);
      if (!(stmt > 0)) { toast.error("Enter the statement amount"); return; }
    }
    const { data, error } = await supabase.rpc("reconcile_mpesa", { _tender: id, _status: status, _note: note, ...(stmt ? { _statement_amount: stmt } : {}) });
    if (error) { toast.error(error.message); return; }
    if ((data as { changed?: boolean } | null)?.changed === false) toast.info("Already marked");
    qc.invalidateQueries({ queryKey: ["mpesa-pay", branch, days] });
  }
  const canMark = can(tenant.permissions, "mpesa.reconcile");

  if (!review) return <AppShell><h1 className="text-3xl font-black">M-Pesa</h1><p className="mt-3 font-bold">Your role can't view M-Pesa settings.</p></AppShell>;

  const rows = (pay.data ?? []).filter((x) => filter === "all" || (filter === "pending" ? !x.rec : x.rec?.status === filter));
  const sum = (k: string) => (pay.data ?? []).filter((x) => (k === "pending" ? !x.rec : x.rec?.status === k)).reduce((a, x) => a + Number(x.amount), 0);
  const stepIdx = STEPS.findIndex(([k]) => k === (current?.status ?? ""));

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">M-Pesa</h1>
      <p className="mt-1 font-bold">Mode: manual confirmation — cashier types the M-Pesa code. Money goes straight to your own Till/PayBill; RONIA never holds funds.</p>

      <ol className="mt-4 grid grid-cols-3 gap-2">
        {STEPS.map(([k, l], i) => (
          <li key={k} className={`rounded-xl border-4 p-3 text-center font-black ${i <= stepIdx ? "border-foreground bg-primary text-primary-foreground" : "border-muted bg-card text-muted-foreground"}`}>{i + 1}. {l}</li>
        ))}
      </ol>
      <p className="mt-2 text-sm">"Live ready" switches on only after Safaricom approves your Daraja credentials and we test a real STK Push. Not live yet.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Till / PayBill details</h2>
          {!configure && <p className="text-sm font-bold">View only — the owner sets these.</p>}
          <fieldset disabled={!configure} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[["till", "Buy Goods Till"], ["paybill", "PayBill"]].map(([k, l]) => <Button key={k} type="button" size="lg" variant={f.kind === k ? "default" : "outline"} className="border-2 font-black" onClick={() => setF({ ...f, kind: k! })}>{l}</Button>)}
            </div>
            {f.kind === "till" ? (<>
              <label className="block font-bold">Store number<Input className="h-12 text-lg" inputMode="numeric" value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} /></label>
              <label className="block font-bold">Till number<Input className="h-12 text-lg" inputMode="numeric" value={f.till} onChange={(e) => setF({ ...f, till: e.target.value })} /></label>
            </>) : (<>
              <label className="block font-bold">Business shortcode<Input className="h-12 text-lg" inputMode="numeric" value={f.shortcode} onChange={(e) => setF({ ...f, shortcode: e.target.value })} /></label>
              <label className="block font-bold">Account number format<Input className="h-12 text-lg" placeholder="e.g. receipt number" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></label>
            </>)}
            <div className="grid grid-cols-2 gap-2">
              {[["branch", "This branch only"], ["business", "All branches"]].map(([k, l]) => <Button key={k} type="button" variant={f.scope === k ? "default" : "outline"} className="border-2 font-bold" onClick={() => setF({ ...f, scope: k! })}>{l}</Button>)}
            </div>
            <label className="flex items-center gap-2 font-bold"><input type="checkbox" className="size-6" checked={f.status === "credentials_pending"} onChange={(e) => setF({ ...f, status: e.target.checked ? "credentials_pending" : "configured" })} />I've applied to Safaricom for Daraja API access</label>
            <Button size="lg" className="h-14 w-full text-lg font-black" onClick={save}>Save M-Pesa details</Button>
          </fieldset>
        </section>

        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Check M-Pesa payments</h2>
          <p className="text-sm">Compare each code against your M-Pesa statement, then mark it.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[[1, "Today"], [7, "7 days"], [30, "30 days"]].map(([d, l]) => <Button key={d} variant={days === d ? "default" : "outline"} className="border-2 font-bold" onClick={() => setDays(d as number)}>{l}</Button>)}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center text-sm font-bold">
            {(["pending", "verified", "flagged"] as const).map((k) => <button key={k} onClick={() => setFilter(k)} className={`rounded-md border-2 p-2 ${filter === k ? "border-foreground bg-secondary text-secondary-foreground" : "border-muted"}`}><p className="capitalize">{k}</p><p className="font-black">{kes(sum(k))}</p></button>)}
          </div>
          <ul className="mt-3 max-h-[28rem] space-y-2 overflow-auto">
            {rows.map((x) => (
              <li key={x.id} className={`rounded-lg border-2 p-3 ${x.rec?.status === "flagged" || x.duplicate ? "border-destructive" : "border-foreground"}`}>
                <div className="flex justify-between font-black"><span>{x.reference ?? "NO CODE"}</span><span>{kes(x.amount)}</span></div>
                <p className="text-sm">{x.sale.receipt_no} · {new Date(x.sale.created_at).toLocaleString()}</p>
                {x.duplicate && <p className="text-sm font-black text-destructive">Same code used on more than one sale</p>}
                {x.rec && <p className="text-sm font-bold">{x.rec.status === "verified" ? "✓ Verified" : `⚠ Flagged: ${x.rec.note}`}</p>}
                {canMark && <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button size="lg" className="font-black" onClick={() => mark(x.id, "verified", Number(x.amount))}>On statement</Button>
                  <Button size="lg" variant="destructive" className="font-black" onClick={() => mark(x.id, "flagged", Number(x.amount))}>Mismatch</Button>
                </div>}
              </li>
            ))}
            {!rows.length && <li className="text-muted-foreground">{pay.isLoading ? "Loading…" : "Nothing here."}</li>}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
