import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Receipt, loadReceipt } from "@/components/Receipt";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Sales — RONIA Business" }, { name: "description", content: "Today's sales, receipts and voids." }] }),
  beforeLoad: requireTenant,
  component: Sales,
});

const REASONS = ["Customer return", "Cashier ringing error", "Damaged goods", "Payment dispute"];

function Sales() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [width, setWidth] = useState<58 | 80>(80);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const sales = useQuery({
    queryKey: ["sales", branch],
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from("sales").select("id,receipt_no,total,tax_total,cogs_total,created_at").eq("branch_id", branch).gte("created_at", start.toISOString()).order("created_at", { ascending: false });
      if (error) throw error;
      const ids = data.map((s) => s.id);
      const t = ids.length ? (await supabase.from("sale_tenders").select("tender_type,amount,sale_id").in("sale_id", ids)).data ?? [] : [];
      const v = ids.length ? (await supabase.from("sale_voids").select("sale_id").in("sale_id", ids)).data ?? [] : [];
      return { sales: data, tenders: t, voided: new Set(v.map((x) => x.sale_id)) };
    },
  });
  const receipt = useQuery({ queryKey: ["receipt", open], enabled: !!open, queryFn: () => loadReceipt(supabase, open!) });
  const voided = sales.data?.voided ?? new Set<string>();
  const all = sales.data?.sales ?? [];
  const s = all.filter((x) => !voided.has(x.id));
  const total = s.reduce((a, x) => a + Number(x.total), 0);
  const by = (k: string) => (sales.data?.tenders ?? []).filter((t) => t.tender_type === k && !voided.has(t.sale_id)).reduce((a, t) => a + Number(t.amount), 0);
  const reports = can(tenant.permissions, "reports.view");
  const canVoid = can(tenant.permissions, "sales.void");

  async function doVoid() {
    if (!open || reason.trim().length < 3) { toast.error("Choose or type a reason"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("void_sale", { _sale: open, _reason: reason.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Sale voided — stock returned to shelf");
    setVoiding(false); setReason("");
    qc.invalidateQueries({ queryKey: ["sales", branch] });
    qc.invalidateQueries({ queryKey: ["receipt", open] });
  }

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Today's sales {reports ? "" : "(mine)"}</h1>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Sales", kes(total)], ["Receipts", String(s.length)], ["Cash (tendered)", kes(by("cash"))], ["M-Pesa", kes(by("mpesa_manual"))]].map(([l, v]) => (
          <div key={l} className="rounded-xl border-4 border-foreground bg-card p-3"><p className="text-sm font-bold uppercase">{l}</p><p className="text-2xl font-black">{v}</p></div>
        ))}
      </div>
      {reports && <p className="mt-2 font-bold">Gross profit today: {kes(total - s.reduce((a, x) => a + Number(x.tax_total) + Number(x.cogs_total), 0))} (excl. VAT){voided.size ? ` · ${voided.size} voided` : ""}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ul className="space-y-2">{all.map((x) => (
          <li key={x.id}><button onClick={() => { setOpen(x.id); setVoiding(false); }} className={`flex w-full justify-between rounded-lg border-2 px-3 py-3 text-left font-bold ${open === x.id ? "border-primary bg-secondary" : "border-foreground bg-card"} ${voided.has(x.id) ? "opacity-60" : ""}`}>
            <span>{x.receipt_no} · {new Date(x.created_at).toLocaleTimeString()}{voided.has(x.id) && <span className="ml-2 text-destructive">VOIDED</span>}</span><span className={voided.has(x.id) ? "line-through" : ""}>{kes(x.total)}</span></button></li>))}
          {!all.length && <li className="text-muted-foreground">{sales.isLoading ? "Loading…" : "No sales yet today."}</li>}
        </ul>
        {open && receipt.data && (
          <div>
            <div className="mb-2 flex flex-wrap gap-2 print:hidden">
              <Button variant={width === 58 ? "default" : "outline"} onClick={() => setWidth(58)}>58mm</Button>
              <Button variant={width === 80 ? "default" : "outline"} onClick={() => setWidth(80)}>80mm</Button>
              <Button onClick={() => window.print()} className="font-black">Print</Button>
              {!receipt.data.void && (canVoid
                ? <Button variant="destructive" className="font-black" onClick={() => setVoiding(true)}>Void sale</Button>
                : <span className="self-center text-sm font-bold">Need a void? Ask a manager.</span>)}
            </div>
            {voiding && (
              <div className="mb-3 rounded-xl border-4 border-destructive bg-card p-3 print:hidden">
                <p className="font-black">Why is this sale being voided?</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {REASONS.map((r) => <Button key={r} variant={reason === r ? "default" : "outline"} className="h-12" onClick={() => setReason(r)}>{r}</Button>)}
                </div>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" className="mt-2 h-12 w-full rounded-lg border-2 border-foreground bg-background px-3" />
                <p className="mt-2 text-sm">Items go back on the shelf, any Deni is taken off the customer's balance, and this is recorded permanently.</p>
                <div className="mt-2 flex gap-2">
                  <Button variant="destructive" className="h-12 flex-1 font-black" disabled={busy} onClick={doVoid}>{busy ? "Voiding…" : "Confirm void"}</Button>
                  <Button variant="outline" className="h-12" onClick={() => setVoiding(false)}>Cancel</Button>
                </div>
              </div>
            )}
            <div className="border-2 border-foreground"><Receipt r={receipt.data} width={width} /></div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
