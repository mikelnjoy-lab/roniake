import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Receipt, loadReceipt } from "@/components/Receipt";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Sales — RONIA Business" }, { name: "description", content: "Today's sales and receipts." }] }),
  beforeLoad: requireTenant,
  component: Sales,
});

function Sales() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const [open, setOpen] = useState<string | null>(null);
  const [width, setWidth] = useState<58 | 80>(80);
  const sales = useQuery({
    queryKey: ["sales", branch],
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from("sales").select("id,receipt_no,total,tax_total,cogs_total,created_at").eq("branch_id", branch).gte("created_at", start.toISOString()).order("created_at", { ascending: false });
      if (error) throw error;
      const ids = data.map((s) => s.id);
      const t = ids.length ? (await supabase.from("sale_tenders").select("tender_type,amount,sale_id").in("sale_id", ids)).data ?? [] : [];
      return { sales: data, tenders: t };
    },
  });
  const receipt = useQuery({ queryKey: ["receipt", open], enabled: !!open, queryFn: () => loadReceipt(supabase, open!) });
  const s = sales.data?.sales ?? [];
  const total = s.reduce((a, x) => a + Number(x.total), 0);
  const by = (k: string) => (sales.data?.tenders ?? []).filter((t) => t.tender_type === k).reduce((a, t) => a + Number(t.amount), 0);
  const reports = can(tenant.permissions, "reports.view");

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Today's sales {reports ? "" : "(mine)"}</h1>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Sales", kes(total)], ["Receipts", String(s.length)], ["Cash (tendered)", kes(by("cash"))], ["M-Pesa", kes(by("mpesa_manual"))]].map(([l, v]) => (
          <div key={l} className="rounded-xl border-4 border-foreground bg-card p-3"><p className="text-sm font-bold uppercase">{l}</p><p className="text-2xl font-black">{v}</p></div>
        ))}
      </div>
      {reports && <p className="mt-2 font-bold">Gross profit today: {kes(total - s.reduce((a, x) => a + Number(x.tax_total) + Number(x.cogs_total), 0))} (excl. VAT)</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ul className="space-y-2">{s.map((x) => (
          <li key={x.id}><button onClick={() => setOpen(x.id)} className={`flex w-full justify-between rounded-lg border-2 px-3 py-3 text-left font-bold ${open === x.id ? "border-primary bg-secondary" : "border-foreground bg-card"}`}>
            <span>{x.receipt_no} · {new Date(x.created_at).toLocaleTimeString()}</span><span>{kes(x.total)}</span></button></li>))}
          {!s.length && <li className="text-muted-foreground">{sales.isLoading ? "Loading…" : "No sales yet today."}</li>}
        </ul>
        {open && receipt.data && (
          <div>
            <div className="mb-2 flex gap-2 print:hidden">
              <Button variant={width === 58 ? "default" : "outline"} onClick={() => setWidth(58)}>58mm</Button>
              <Button variant={width === 80 ? "default" : "outline"} onClick={() => setWidth(80)}>80mm</Button>
              <Button onClick={() => window.print()} className="font-black">Print</Button>
            </div>
            <div className="border-2 border-foreground"><Receipt r={receipt.data} width={width} /></div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
