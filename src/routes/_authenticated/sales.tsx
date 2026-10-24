import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Receipt, loadReceipt } from "@/components/Receipt";
import { PrintButton } from "@/components/PrintButton";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";
import { downloadCsv } from "@/lib/csv";
import { eatRange, fmtEat, presetRange } from "@/lib/eat";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Sales history — RONIA Business" }, { name: "description", content: "Sales history with date, time, branch, cashier, payment and status filters." }] }),
  beforeLoad: requireTenant,
  component: Sales,
});

const REASONS = ["Customer return", "Cashier ringing error", "Damaged goods", "Payment dispute"];
const PAGE = 50;
const STATUS: Record<string, string> = { completed: "Completed", voided: "Voided", refunded: "Refunded", partially_refunded: "Part refunded" };
type HistRow = { id: string; receipt_no: string; total: number; created_at: string; branch_code: string; cashier_id: string; status: string; refunded: number };
type Hist = { total_count: number; rows: HistRow[]; cashiers: { id: string; email: string | null }[];
  summary: { receipts: number; voided: number; gross: number; refunds: number; tax: number; cogs: number | null; tenders: Record<string, number>; refunds_by_type: Record<string, number> } };

function Sales() {
  const { tenant } = Route.useRouteContext();
  const qc = useQueryClient();
  const reports = can(tenant.permissions, "reports.view");
  const canVoid = can(tenant.permissions, "sales.void");
  const [open, setOpen] = useState<string | null>(null);
  const [width, setWidth] = useState<58 | 80>(80);
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const t0 = presetRange("today");
  const [f, setF] = useState({ start: t0.start, end: t0.end, startTime: "", endTime: "", branch: tenant.branch_id ?? "", cashier: "", tender: "", status: "" });
  const [page, setPage] = useState(0);
  const set = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setPage(0); };
  const branches = useQuery({
    queryKey: ["branches-list", tenant.business_id], enabled: reports,
    queryFn: async () => (await supabase.from("branches").select("id,name,code").eq("business_id", tenant.business_id).order("name")).data ?? [],
  });
  const valid = !!f.start && !!f.end && eatRange(f.start, f.end, f.startTime, f.endTime).to > eatRange(f.start, f.end, f.startTime, f.endTime).from;
  const args = () => {
    const { from, to } = eatRange(f.start, f.end, f.startTime, f.endTime);
    return { _business: tenant.business_id, _branch: (f.branch || null) as string, _from: from.toISOString(), _to: to.toISOString(),
      _cashier: (f.cashier || null) as string, _tender: (f.tender || null) as string, _status: (f.status || null) as string };
  };
  const sales = useQuery({
    queryKey: ["sales", tenant.business_id, f, page], enabled: valid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_history", { ...args(), _limit: PAGE, _offset: page * PAGE });
      if (error) throw error;
      return data as unknown as Hist;
    },
  });
  const receipt = useQuery({ queryKey: ["receipt", open], enabled: !!open, queryFn: () => loadReceipt(supabase, open!) });
  useEffect(() => { const w = receipt.data?.settings?.paper_width; if (w) setWidth(w); }, [receipt.data]);
  const sm = sales.data?.summary;
  const all = sales.data?.rows ?? [];
  const refunds = Number(sm?.refunds ?? 0);
  const total = Number(sm?.gross ?? 0) - refunds;
  const by = (k: string) => Number(sm?.tenders?.[k] ?? 0) - Number(sm?.refunds_by_type?.[k] ?? 0);
  const cashierName = (id: string) => sales.data?.cashiers.find((c) => c.id === id)?.email ?? id.slice(0, 8);
  const pages = Math.max(1, Math.ceil((sales.data?.total_count ?? 0) / PAGE));

  async function exportCsv() {
    const out: Record<string, unknown>[] = [];
    for (let p = 0; p < 50; p++) {
      const { data, error } = await supabase.rpc("sales_history", { ...args(), _limit: 200, _offset: p * 200 });
      if (error) { toast.error(error.message); return; }
      const d = data as unknown as Hist;
      out.push(...d.rows.map((r) => ({ receipt: r.receipt_no, time_eat: fmtEat(r.created_at), branch: r.branch_code, cashier: cashierName(r.cashier_id), status: r.status, total: r.total, refunded: r.refunded })));
      if (d.rows.length < 200) break;
    }
    if (!downloadCsv(`sales-${f.start}_${f.end}`, out)) toast.error("Nothing to export for these filters");
  }

  async function doVoid() {
    if (!open || reason.trim().length < 3) { toast.error("Choose or type a reason"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("void_sale", { _sale: open, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Sale voided — stock returned to shelf");
    setVoiding(false); setReason("");
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["receipt", open] });
  }

  const inp = "h-12 rounded-lg border-2 border-foreground bg-background px-2 text-base";
  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Sales history {reports ? "" : "(mine)"}</h1>
      <div className="mt-3 rounded-xl border-4 border-foreground bg-card p-3 print:hidden">
        <div className="flex flex-wrap gap-2">
          {([["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"]] as const).map(([k, l]) => (
            <Button key={k} variant="outline" className="h-11 border-2 font-bold" onClick={() => { const r = presetRange(k); set({ start: r.start, end: r.end, startTime: "", endTime: "" }); }}>{l}</Button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-sm font-bold">From date<input type="date" value={f.start} onChange={(e) => set({ start: e.target.value })} className={`${inp} w-full`} /></label>
          <label className="text-sm font-bold">From time<input type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} className={`${inp} w-full`} /></label>
          <label className="text-sm font-bold">To date<input type="date" value={f.end} onChange={(e) => set({ end: e.target.value })} className={`${inp} w-full`} /></label>
          <label className="text-sm font-bold">To time<input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} className={`${inp} w-full`} /></label>
          {reports && <label className="text-sm font-bold">Branch<select value={f.branch} onChange={(e) => set({ branch: e.target.value })} className={`${inp} w-full`}>
            <option value="">All my branches</option>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></label>}
          {reports && <label className="text-sm font-bold">Cashier<select value={f.cashier} onChange={(e) => set({ cashier: e.target.value })} className={`${inp} w-full`}>
            <option value="">All cashiers</option>{(sales.data?.cashiers ?? []).map((c) => <option key={c.id} value={c.id}>{c.email ?? c.id.slice(0, 8)}</option>)}</select></label>}
          <label className="text-sm font-bold">Payment<select value={f.tender} onChange={(e) => set({ tender: e.target.value })} className={`${inp} w-full`}>
            <option value="">Any</option><option value="cash">Cash</option><option value="mpesa_manual">M-Pesa</option><option value="deni">Deni</option><option value="card">Card</option><option value="other">Other</option></select></label>
          <label className="text-sm font-bold">Status<select value={f.status} onChange={(e) => set({ status: e.target.value })} className={`${inp} w-full`}>
            <option value="">Any</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <p className="mt-2 text-sm">Times are Nairobi time (EAT). End time includes that whole minute; leave times empty for whole days.</p>
        {!valid && <p className="mt-1 font-bold text-destructive">The end must be after the start.</p>}
        {reports && can(tenant.permissions, "reports.export") && <Button variant="outline" className="mt-2 border-2 font-bold" onClick={exportCsv}>Export these sales (CSV)</Button>}
      </div>
      {sales.error && <p className="mt-2 font-bold text-destructive">Could not load sales: {(sales.error as Error).message}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Net sales", kes(total)], ["Receipts", String(sm?.receipts ?? 0)], ["Cash (net)", kes(by("cash"))], ["M-Pesa (net)", kes(by("mpesa_manual"))]].map(([l, v]) => (
          <div key={l} className="rounded-xl border-4 border-foreground bg-card p-3"><p className="text-sm font-bold uppercase">{l}</p><p className="text-2xl font-black">{v}</p></div>
        ))}
      </div>
      <p className="mt-2 font-bold">VAT {kes(sm?.tax ?? 0)} · Deni {kes(by("deni"))}{reports && sm?.cogs != null ? ` · Gross profit ${kes(total - Number(sm.tax) - Number(sm.cogs))} (excl. VAT)` : ""}{sm?.voided ? ` · ${sm.voided} voided` : ""}{refunds ? ` · ${kes(refunds)} refunded` : ""}</p>
      {f.tender && <p className="text-sm">Payment filter keeps whole sales that used this method; totals cover those sales.</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><ul className="space-y-2">{all.map((x) => (
          <li key={x.id}><button onClick={() => { setOpen(x.id); setVoiding(false); }} className={`flex w-full justify-between rounded-lg border-2 px-3 py-3 text-left font-bold ${open === x.id ? "border-primary bg-secondary" : "border-foreground bg-card"} ${x.status === "voided" ? "opacity-60" : ""}`}>
            <span>{x.receipt_no} · {fmtEat(x.created_at)}{reports && <span className="block text-sm font-normal">{x.branch_code} · {cashierName(x.cashier_id)}</span>}{x.status !== "completed" && <span className="ml-2 text-destructive">{STATUS[x.status]}</span>}</span><span className={x.status === "voided" ? "line-through" : ""}>{kes(x.total)}</span></button></li>))}
          {!all.length && <li className="text-muted-foreground">{sales.isLoading ? "Loading…" : "No sales match these filters."}</li>}
        </ul>
        {pages > 1 && <div className="mt-2 flex items-center justify-between">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="font-bold">Page {page + 1} of {pages}</span>
          <Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
        </div>
        {open && receipt.data && (
          <div>
            <div className="mb-2 flex flex-wrap gap-2 print:hidden">
              <Button variant={width === 58 ? "default" : "outline"} onClick={() => setWidth(58)}>58mm</Button>
              <Button variant={width === 80 ? "default" : "outline"} onClick={() => setWidth(80)}>80mm</Button>
              <PrintButton r={receipt.data} width={width} label="Reprint" />
              {!receipt.data.void && (canVoid
                ? <>
                    <Button variant="destructive" className="font-black" onClick={() => { setVoiding(true); setReturning(false); }}>Void sale</Button>
                    <Button variant="outline" className="border-2 font-black" onClick={() => { setReturning(true); setVoiding(false); }}>Return items</Button>
                  </>
                : <span className="self-center text-sm font-bold">Need a void or return? Ask a manager.</span>)}
            </div>
            {returning && !receipt.data.void && (
              <ReturnPanel saleId={open} onDone={() => { setReturning(false); qc.invalidateQueries({ queryKey: ["sales"] }); }} />
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
