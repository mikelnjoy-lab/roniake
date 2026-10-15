import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "Reports — RONIA Business" },
    { name: "description", content: "Revenue, profit, tenders, stock alerts, Deni exposure and audit trail." },
    { property: "og:title", content: "Reports — RONIA Business" },
    { property: "og:description", content: "Back-office reports for your shop." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: Dashboard,
});

const RANGES = [["Today", 0], ["7 days", 7], ["30 days", 30]] as const;
const TENDER: Record<string, string> = { cash: "Cash", mpesa_manual: "M-Pesa", deni: "Deni", card: "Card", other: "Other" };

function Dashboard() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const biz = tenant.business_id;
  const [days, setDays] = useState<number>(0);
  const reports = can(tenant.permissions, "reports.view");
  const exportOk = can(tenant.permissions, "reports.export");
  const auditOk = can(tenant.permissions, "audit.view");

  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - days);

  const sales = useQuery({
    queryKey: ["dash-sales", branch, days], enabled: reports,
    queryFn: async () => {
      const { data, error } = await supabase.from("sales").select("id,receipt_no,total,tax_total,cogs_total,discount_total,created_at").eq("branch_id", branch).gte("created_at", from.toISOString()).order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      const ids = data.map((s) => s.id);
      const chunk = async <T,>(f: (c: string[]) => PromiseLike<{ data: T[] | null }>) => {
        const out: T[] = [];
        for (let i = 0; i < ids.length; i += 200) out.push(...((await f(ids.slice(i, i + 200))).data ?? []));
        return out;
      };
      const voids = await chunk((c) => supabase.from("sale_voids").select("sale_id").in("sale_id", c));
      const tenders = await chunk((c) => supabase.from("sale_tenders").select("sale_id,tender_type,amount").in("sale_id", c));
      const lines = await chunk((c) => supabase.from("sale_lines").select("sale_id,product_name,sku,qty,line_total,tax_amount,line_cogs").in("sale_id", c));
      const v = new Set(voids.map((x) => x.sale_id));
      return { sales: data.filter((s) => !v.has(s.id)), tenders: tenders.filter((t) => !v.has(t.sale_id)), lines: lines.filter((l) => !v.has(l.sale_id)), voided: v.size };
    },
  });

  const stock = useQuery({
    queryKey: ["dash-stock", branch], enabled: reports,
    queryFn: async () => {
      const [p, s] = await Promise.all([
        supabase.from("products").select("id,name,sku,unit,low_stock_threshold,track_stock").eq("business_id", biz).eq("is_active", true),
        supabase.from("branch_stock").select("product_id,qty_on_hand,wac").eq("branch_id", branch),
      ]);
      const m = new Map((s.data ?? []).map((x) => [x.product_id, x]));
      return (p.data ?? []).filter((x) => x.track_stock).map((x) => ({ ...x, qty: Number(m.get(x.id)?.qty_on_hand ?? 0), wac: Number(m.get(x.id)?.wac ?? 0) }));
    },
  });

  const deni = useQuery({
    queryKey: ["dash-deni", biz], enabled: reports,
    queryFn: async () => {
      const [c, l] = await Promise.all([
        supabase.from("customers").select("id,name,phone,balance,credit_limit").eq("business_id", biz).gt("balance", 0).order("balance", { ascending: false }),
        supabase.from("customer_ledger").select("customer_id,entry_type,created_at").eq("business_id", biz).eq("entry_type", "credit_sale").order("created_at", { ascending: true }),
      ]);
      // Age = days since the oldest credit sale still plausibly unpaid (approximation: last repayment not tracked per sale).
      const oldest = new Map<string, string>();
      for (const e of l.data ?? []) if (!oldest.has(e.customer_id)) oldest.set(e.customer_id, e.created_at);
      return (c.data ?? []).map((x) => ({ ...x, age: oldest.has(x.id) ? Math.floor((Date.now() - +new Date(oldest.get(x.id)!)) / 864e5) : 0 }));
    },
  });

  const audit = useQuery({
    queryKey: ["dash-audit", biz], enabled: auditOk,
    queryFn: async () => (await supabase.from("audit_log").select("id,action,entity_type,entity_id,actor_user_id,payload,created_at").eq("business_id", biz).order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  if (!reports) return <AppShell><h1 className="text-3xl font-black">Reports</h1><p className="mt-3 font-bold">Your role can't view reports. Ask the owner or a manager.</p></AppShell>;

  const S = sales.data;
  const revenue = (S?.sales ?? []).reduce((a, x) => a + Number(x.total), 0);
  const vat = (S?.sales ?? []).reduce((a, x) => a + Number(x.tax_total), 0);
  const cogs = (S?.sales ?? []).reduce((a, x) => a + Number(x.cogs_total), 0);
  const net = revenue - vat;
  const profit = net - cogs;
  const margin = net > 0 ? (profit / net) * 100 : 0;
  const tenders = Object.entries((S?.tenders ?? []).reduce<Record<string, number>>((a, t) => ({ ...a, [t.tender_type]: (a[t.tender_type] ?? 0) + Number(t.amount) }), {}));
  const topMap = new Map<string, { name: string; sku: string; qty: number; rev: number; profit: number }>();
  for (const l of S?.lines ?? []) {
    const r = topMap.get(l.sku) ?? { name: l.product_name, sku: l.sku, qty: 0, rev: 0, profit: 0 };
    r.qty += Number(l.qty); r.rev += Number(l.line_total); r.profit += Number(l.line_total) - Number(l.tax_amount) - Number(l.line_cogs);
    topMap.set(l.sku, r);
  }
  const top = [...topMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  const out = (stock.data ?? []).filter((p) => p.qty <= 0);
  const low = (stock.data ?? []).filter((p) => p.qty > 0 && p.low_stock_threshold != null && p.qty <= Number(p.low_stock_threshold));
  const stockValue = (stock.data ?? []).reduce((a, p) => a + Math.max(p.qty, 0) * p.wac, 0);
  const D = deni.data ?? [];
  const exposure = D.reduce((a, c) => a + Number(c.balance), 0);
  const bucket = (lo: number, hi: number) => D.filter((c) => c.age >= lo && c.age <= hi).reduce((a, c) => a + Number(c.balance), 0);

  const exp = (name: string, rows: Record<string, unknown>[]) => { if (!downloadCsv(name, rows)) toast.error("Nothing to export"); };

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Reports</h1>
      <div className="mt-3 flex flex-wrap gap-2">
        {RANGES.map(([l, d]) => <Button key={l} size="lg" variant={days === d ? "default" : "outline"} className="border-2 font-black" onClick={() => setDays(d)}>{l}</Button>)}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[["Revenue (incl. VAT)", kes(revenue)], ["Gross profit", kes(profit)], ["Margin", `${margin.toFixed(1)}%`], ["Receipts", String(S?.sales.length ?? 0)], ["VAT collected", kes(vat)], ["Cost of goods", kes(cogs)], ["Stock value (WAC)", kes(stockValue)], ["Deni owed", kes(exposure)]].map(([l, v]) => (
          <div key={l} className="rounded-xl border-4 border-foreground bg-card p-3"><p className="text-xs font-bold uppercase">{l}</p><p className="text-xl font-black">{sales.isLoading ? "…" : v}</p></div>
        ))}
      </div>
      {!!S?.voided && <p className="mt-2 text-sm font-bold">{S.voided} voided sale(s) excluded.</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Payments</h2>
          <ul className="mt-2 space-y-1">{tenders.map(([k, v]) => <li key={k} className="flex justify-between font-bold"><span>{TENDER[k] ?? k}</span><span>{kes(v)}</span></li>)}
            {!tenders.length && <li className="text-muted-foreground">No payments in this period.</li>}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Cash shows amount tendered; change given is deducted at shift close.</p>
        </section>
        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Fast movers</h2>
          <ul className="mt-2 space-y-1">{top.map((t) => <li key={t.sku} className="flex justify-between gap-2 font-bold"><span className="truncate">{t.name}</span><span className="shrink-0">{t.qty} · {kes(t.profit)}</span></li>)}
            {!top.length && <li className="text-muted-foreground">No items sold yet.</li>}</ul>
        </section>

        <section className="rounded-xl border-4 border-destructive bg-card p-4">
          <h2 className="text-xl font-black">Reorder alerts</h2>
          <p className="font-bold text-destructive">{out.length} out of stock · {low.length} low</p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
            {[...out, ...low].map((p) => <li key={p.id} className="flex justify-between font-bold"><span className="truncate">{p.name}</span><span className={p.qty <= 0 ? "text-destructive" : ""}>{p.qty} {p.unit}</span></li>)}
          </ul>
          <Button asChild size="lg" className="mt-3 w-full font-black"><Link to="/inventory">Receive stock</Link></Button>
        </section>
        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Deni exposure</h2>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center text-sm font-bold">
            {[["0–30d", bucket(0, 30)], ["31–60d", bucket(31, 60)], ["61–90d", bucket(61, 90)], ["90d+", bucket(91, 1e6)]].map(([l, v]) => <div key={l as string} className="rounded-md bg-secondary p-2 text-secondary-foreground"><p>{l}</p><p className="font-black">{kes(v as number)}</p></div>)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Age counted from each customer's oldest credit sale.</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">{D.slice(0, 10).map((c) => <li key={c.id} className="flex justify-between font-bold"><span className="truncate">{c.name}</span><span>{kes(c.balance)} / {kes(c.credit_limit)}</span></li>)}
            {!D.length && <li className="text-muted-foreground">No one owes money.</li>}</ul>
        </section>
      </div>

      {exportOk && (
        <section className="mt-6 rounded-xl border-4 border-foreground bg-secondary p-4 text-secondary-foreground">
          <h2 className="text-xl font-black">Export for accountant (CSV, opens in Excel)</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Button size="lg" className="font-black" onClick={() => exp("sales-register", (S?.sales ?? []).map((s) => ({ receipt: s.receipt_no, date: s.created_at, total: s.total, vat: s.tax_total, discount: s.discount_total, cogs: s.cogs_total })))}>Sales register</Button>
            <Button size="lg" className="font-black" onClick={() => exp("stock-valuation", (stock.data ?? []).map((p) => ({ sku: p.sku, product: p.name, unit: p.unit, qty: p.qty, wac: p.wac, value: (Math.max(p.qty, 0) * p.wac).toFixed(2) })))}>Stock valuation</Button>
            <Button size="lg" className="font-black" onClick={() => exp("deni-debtors", D.map((c) => ({ customer: c.name, phone: c.phone, balance: c.balance, limit: c.credit_limit, age_days: c.age })))}>Deni debtors</Button>
            {auditOk && <Button size="lg" className="font-black" onClick={() => exp("audit-trail", (audit.data ?? []).map((a) => ({ time: a.created_at, action: a.action, entity: a.entity_type, id: a.entity_id, user: a.actor_user_id, details: a.payload })))}>Audit trail</Button>}
          </div>
        </section>
      )}

      {auditOk && (
        <section className="mt-6 rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Audit trail (read-only, cannot be edited)</h2>
          <ul className="mt-2 max-h-96 divide-y-2 overflow-auto">
            {(audit.data ?? []).map((a) => <li key={a.id} className="py-2"><p className="font-black">{a.action}</p><p className="text-sm">{new Date(a.created_at).toLocaleString()} · {a.entity_type}</p></li>)}
            {!audit.data?.length && <li className="text-muted-foreground">No events.</li>}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
