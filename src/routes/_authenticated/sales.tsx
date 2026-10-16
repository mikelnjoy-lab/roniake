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
  const [returning, setReturning] = useState(false);
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
      const ret = (await supabase.from("sale_returns").select("refund_amount,tax_amount,cogs_reversed,refund_type").eq("branch_id", branch).gte("created_at", start.toISOString())).data ?? [];
      return { sales: data, tenders: t, voided: new Set(v.map((x) => x.sale_id)), returns: ret };
    },
  });
  const receipt = useQuery({ queryKey: ["receipt", open], enabled: !!open, queryFn: () => loadReceipt(supabase, open!) });
  const voided = sales.data?.voided ?? new Set<string>();
  const all = sales.data?.sales ?? [];
  const s = all.filter((x) => !voided.has(x.id));
  const rets = sales.data?.returns ?? [];
  const refunds = rets.reduce((a, r) => a + Number(r.refund_amount), 0);
  const total = s.reduce((a, x) => a + Number(x.total), 0) - refunds;
  const by = (k: string) => (sales.data?.tenders ?? []).filter((t) => t.tender_type === k && !voided.has(t.sale_id)).reduce((a, t) => a + Number(t.amount), 0)
    - rets.filter((r) => r.refund_type === k).reduce((a, r) => a + Number(r.refund_amount), 0);
  const reports = can(tenant.permissions, "reports.view");
  const canVoid = can(tenant.permissions, "sales.void");

  async function doVoid() {
    if (!open || reason.trim().length < 3) { toast.error("Choose or type a reason"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("void_sale", { _sale: open, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
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
      {reports && <p className="mt-2 font-bold">Gross profit today: {kes(total - s.reduce((a, x) => a + Number(x.tax_total) + Number(x.cogs_total), 0) + rets.reduce((a, r) => a + Number(r.tax_amount) + Number(r.cogs_reversed), 0))} (excl. VAT){voided.size ? ` · ${voided.size} voided` : ""}{refunds ? ` · ${kes(refunds)} refunded` : ""}</p>}
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
                ? <>
                    <Button variant="destructive" className="font-black" onClick={() => { setVoiding(true); setReturning(false); }}>Void sale</Button>
                    <Button variant="outline" className="border-2 font-black" onClick={() => { setReturning(true); setVoiding(false); }}>Return items</Button>
                  </>
                : <span className="self-center text-sm font-bold">Need a void or return? Ask a manager.</span>)}
            </div>
            {returning && !receipt.data.void && (
              <ReturnPanel saleId={open} onDone={() => { setReturning(false); qc.invalidateQueries({ queryKey: ["sales", branch] }); }} />
            )}
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

function ReturnPanel({ saleId, onDone }: { saleId: string; onDone: () => void }) {
  const lines = useQuery({
    queryKey: ["return-lines", saleId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sale_lines").select("id,product_name,qty,line_total").eq("sale_id", saleId).order("line_no");
      if (error) throw error;
      const ids = (data ?? []).map((l) => l.id);
      const done = ids.length ? (await supabase.from("sale_return_lines").select("sale_line_id,qty").in("sale_line_id", ids)).data ?? [] : [];
      return (data ?? []).map((l) => ({ ...l, left: Number(l.qty) - done.filter((d) => d.sale_line_id === l.id).reduce((a, d) => a + Number(d.qty), 0) }));
    },
  });
  const [qty, setQty] = useState<Record<number, string>>({});
  const [type, setType] = useState<"cash" | "mpesa_manual" | "deni">("cash");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [ref] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const est = (lines.data ?? []).reduce((a, l) => a + (Number(qty[l.id]) || 0) * Number(l.line_total) / Number(l.qty), 0);

  async function submit() {
    const picked = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ sale_line_id: Number(k), qty: Number(v) }));
    if (!picked.length) { toast.error("Enter how many of each item came back"); return; }
    if (reason.trim().length < 3) { toast.error("Give a reason"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("return_sale_items", { _sale: saleId, _lines: picked as never, _refund_type: type, _reason: reason.trim(), _reference: code, _client_ref: ref });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const d = data as { return_no: string; refund_amount: number; status: string };
    toast.success(d.status === "replay" ? "Already recorded" : `Return ${d.return_no}: refund ${kes(d.refund_amount)}`);
    onDone();
  }

  return (
    <div className="mb-3 rounded-xl border-4 border-foreground bg-card p-3 print:hidden">
      <p className="font-black">Which items came back?</p>
      <ul className="mt-2 space-y-1">{(lines.data ?? []).map((l) => (
        <li key={l.id} className="flex items-center justify-between gap-2">
          <span className="font-bold">{l.product_name}<span className="block text-sm font-normal">sold {Number(l.qty)} · can return {l.left}</span></span>
          <input type="number" min="0" max={l.left} step="0.001" disabled={l.left <= 0} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className="h-12 w-24 rounded-lg border-2 border-foreground bg-background px-2 text-lg" />
        </li>))}</ul>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {([["cash", "Cash"], ["mpesa_manual", "M-Pesa"], ["deni", "Deni credit"]] as const).map(([k, l]) => (
          <Button key={k} variant={type === k ? "default" : "outline"} className="h-12 font-bold" onClick={() => setType(k)}>{l}</Button>
        ))}
      </div>
      {type === "mpesa_manual" && <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="M-Pesa reversal code" className="mt-2 h-12 w-full rounded-lg border-2 border-foreground bg-background px-3" />}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. damaged, expired)" className="mt-2 h-12 w-full rounded-lg border-2 border-foreground bg-background px-3" />
      <p className="mt-2 text-sm">Cash refunds come out of your own open shift drawer. Items go back on the shelf at their original cost.</p>
      <p className="mt-1 text-lg font-black">Refund about {kes(est)}</p>
      <Button className="mt-2 h-12 w-full font-black" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Confirm return"}</Button>
    </div>
  );
}
