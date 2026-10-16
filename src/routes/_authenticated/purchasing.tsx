import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/purchasing")({
  head: () => ({ meta: [
    { title: "Purchase orders & supplier balances — RONIA Business" },
    { name: "description", content: "Order from suppliers, receive deliveries against orders and pay supplier invoices." },
    { property: "og:title", content: "Purchase orders & supplier balances — RONIA Business" },
    { property: "og:description", content: "Orders, deliveries, supplier invoices and payments in one place." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: Purchasing,
});

type Line = { product: string; qty: string; cost: string };
const STATUS: Record<string, string> = { draft: "Waiting approval", approved: "Approved", partially_received: "Part delivered", received: "Fully delivered", cancelled: "Cancelled" };
const sel = "h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg";

function Purchasing() {
  const { tenant } = Route.useRouteContext();
  const biz = tenant.business_id, branch = tenant.branch_id!;
  const qc = useQueryClient();
  const manage = can(tenant.permissions, "inventory.manage");
  const approve = can(tenant.permissions, "purchasing.approve");
  const pay = can(tenant.permissions, "payables.pay");
  const view = manage || can(tenant.permissions, "reports.view");

  const data = useQuery({
    queryKey: ["purchasing", biz, branch], enabled: view,
    queryFn: async () => {
      const [s, p, o, l, i, pm, b] = await Promise.all([
        supabase.from("suppliers").select("id,name,is_active").eq("business_id", biz).order("name"),
        supabase.from("products").select("id,name").eq("business_id", biz).eq("track_stock", true).order("name"),
        supabase.from("purchase_orders").select("*").eq("branch_id", branch).order("created_at", { ascending: false }).limit(30),
        supabase.from("purchase_order_lines").select("*").eq("business_id", biz),
        supabase.from("purchase_invoices").select("id,supplier_id,invoice_no,invoice_date,total_cost,purchase_order_id").eq("branch_id", branch).order("invoice_date", { ascending: false }).limit(100),
        supabase.from("supplier_payments").select("*").eq("branch_id", branch).order("created_at", { ascending: false }),
        supabase.rpc("supplier_balances", { _business: biz }),
      ]);
      for (const r of [s, p, o, l, i, pm, b]) if (r.error) throw r.error;
      return { suppliers: s.data!, products: p.data!, orders: o.data!, lines: l.data!, invoices: i.data!, payments: pm.data!, balances: b.data! };
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["purchasing"] }); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["suppliers"] }); };

  const [po, setPo] = useState({ supplier: "", note: "" });
  const [lines, setLines] = useState<Line[]>([{ product: "", qty: "", cost: "" }]);
  const [poRef, setPoRef] = useState(() => crypto.randomUUID());
  const [recv, setRecv] = useState<{ po: string; no: string; date: string; qty: Record<string, string>; cost: Record<string, string>; ref: string } | null>(null);
  const [payFor, setPayFor] = useState<{ invoice: string; amount: string; method: string; reference: string; date: string; ref: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!view) return <AppShell><h1 className="text-3xl font-black">Purchasing</h1><p className="mt-3 font-bold">Your role can't view purchasing.</p></AppShell>;
  const d = data.data;
  const name = (id: string) => d?.suppliers.find((s) => s.id === id)?.name ?? "";
  const prod = (id: string) => d?.products.find((p) => p.id === id)?.name ?? "Item";
  const paidOn = (inv: string) => (d?.payments ?? []).filter((p) => p.invoice_id === inv).reduce((a, p) => a + Number(p.amount), 0);

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    const clean = lines.filter((l) => l.product);
    if (!po.supplier || !clean.length) { toast.error("Choose a supplier and at least one item"); return; }
    setBusy(true);
    const { data: r, error } = await supabase.rpc("create_purchase_order", { _branch: branch, _supplier: po.supplier, _note: po.note,
      _lines: clean.map((l) => ({ product_id: l.product, qty: Number(l.qty), unit_cost: Number(l.cost) })) as never, _client_ref: poRef });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Order ${(r as { po_no: string }).po_no} saved — waiting approval`);
    setPo({ supplier: "", note: "" }); setLines([{ product: "", qty: "", cost: "" }]); setPoRef(crypto.randomUUID()); refresh();
  }
  async function act(fn: "approve" | "cancel", id: string) {
    let error;
    if (fn === "approve") ({ error } = await supabase.rpc("approve_purchase_order", { _po: id }));
    else { const reason = window.prompt("Why are you cancelling this order?"); if (!reason) return; ({ error } = await supabase.rpc("cancel_purchase_order", { _po: id, _reason: reason })); }
    if (error) { toast.error(error.message); return; }
    toast.success(fn === "approve" ? "Order approved" : "Order cancelled"); refresh();
  }
  async function receive(e: React.FormEvent) {
    e.preventDefault(); if (!recv) return;
    const out = Object.entries(recv.qty).filter(([, q]) => Number(q) > 0).map(([pid, q]) => ({ product_id: pid, qty: Number(q), unit_cost: Number(recv.cost[pid]) }));
    if (!recv.no.trim() || !out.length) { toast.error("Enter the supplier invoice number and quantities delivered"); return; }
    setBusy(true);
    const { data: r, error } = await supabase.rpc("receive_purchase_order", { _po: recv.po, _invoice_no: recv.no, _invoice_date: recv.date, _lines: out as never, _client_ref: recv.ref });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const x = r as { status: string; total_cost: number };
    toast.success(x.status === "replay" ? "Already received — nothing added twice" : `Delivery received: ${kes(x.total_cost)}`);
    setRecv(null); refresh();
  }
  async function recordPay(e: React.FormEvent) {
    e.preventDefault(); if (!payFor) return;
    setBusy(true);
    const { data: r, error } = await supabase.rpc("record_supplier_payment", { _invoice: payFor.invoice, _amount: Number(payFor.amount), _method: payFor.method, _reference: payFor.reference, _paid_on: payFor.date, _client_ref: payFor.ref });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const x = r as { status: string; outstanding?: number };
    toast.success(x.status === "replay" ? "Already recorded" : `Payment recorded. Still owed on invoice: ${kes(x.outstanding)}`);
    setPayFor(null); refresh();
  }

  const today = new Date().toISOString().slice(0, 10);
  const owed = (d?.balances ?? []).filter((b) => Number(b.invoiced) > 0);

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Purchase orders & supplier balances</h1>

      <section className="mt-4 rounded-xl border-4 border-foreground bg-card p-4">
        <h2 className="text-xl font-black">What we owe suppliers</h2>
        <p className="text-sm">Worked out from received invoices minus recorded payments. It can't be typed in or edited.</p>
        <ul className="mt-2 space-y-1">
          {owed.map((b) => (
            <li key={b.supplier_id} className="flex flex-wrap justify-between gap-2 rounded-lg border-2 border-border px-3 py-2">
              <b>{b.supplier_name}</b>
              <span>Invoiced {kes(b.invoiced)} · Paid {kes(b.paid)} · <b>Owed {kes(b.outstanding)}</b>{Number(b.overdue) > 0 && <b className="ml-1 rounded bg-destructive px-1 text-destructive-foreground">Overdue {kes(b.overdue)}</b>}</span>
            </li>
          ))}
          {!owed.length && <li className="text-muted-foreground">{data.isLoading ? "Loading…" : "No supplier invoices yet."}</li>}
        </ul>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {manage && (
          <form onSubmit={createPo} className="rounded-xl border-4 border-foreground bg-card p-4">
            <h2 className="text-xl font-black">New purchase order</h2>
            <Label className="mt-2 block">Supplier</Label>
            <select required value={po.supplier} onChange={(e) => setPo({ ...po, supplier: e.target.value })} className={sel}>
              <option value="">Choose…</option>{d?.suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="mt-3 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_6rem_2.5rem] gap-1">
                  <select value={l.product} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, product: e.target.value } : x))} className="h-12 rounded-md border-2 border-input bg-background px-2">
                    <option value="">Item…</option>{d?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <Input type="number" step="0.001" min="0" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} className="h-12" />
                  <Input type="number" step="0.01" min="0" placeholder="Cost each" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} className="h-12" />
                  <Button type="button" variant="outline" className="h-12 px-0 font-black" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}>×</Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" className="mt-2 h-12 w-full border-2 font-bold" onClick={() => setLines([...lines, { product: "", qty: "", cost: "" }])}>+ Add item</Button>
            <Input placeholder="Note (optional)" value={po.note} onChange={(e) => setPo({ ...po, note: e.target.value })} className="mt-2 h-12" />
            <p className="mt-3 text-xl font-black">Order total: {kes(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0))}</p>
            <Button size="lg" disabled={busy} className="mt-2 h-14 w-full text-lg font-black">Save order</Button>
          </form>
        )}

        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Orders at this branch</h2>
          <ul className="mt-2 space-y-2">
            {(d?.orders ?? []).map((o) => {
              const ls = d!.lines.filter((l) => l.po_id === o.id);
              const open = o.status === "approved" || o.status === "partially_received";
              return (
                <li key={o.id} className="rounded-lg border-2 border-border p-3">
                  <div className="flex flex-wrap justify-between gap-2"><b>{o.po_no} · {name(o.supplier_id)}</b><span className="rounded bg-secondary px-2 font-black text-secondary-foreground">{STATUS[o.status]}</span></div>
                  <ul className="mt-1 text-sm">{ls.map((l) => <li key={l.id}>{prod(l.product_id)}: {Number(l.qty_received)} of {Number(l.qty_ordered)} received @ {kes(l.unit_cost)}</li>)}</ul>
                  {o.cancel_reason && <p className="text-sm">Cancelled: {o.cancel_reason}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {o.status === "draft" && approve && <Button className="h-11 font-black" onClick={() => act("approve", o.id)}>Approve</Button>}
                    {open && manage && <Button className="h-11 font-black" onClick={() => setRecv({ po: o.id, no: "", date: today, ref: crypto.randomUUID(),
                      qty: Object.fromEntries(ls.map((l) => [l.product_id, String(Number(l.qty_ordered) - Number(l.qty_received))])),
                      cost: Object.fromEntries(ls.map((l) => [l.product_id, String(l.unit_cost)])) })}>Receive delivery</Button>}
                    {(o.status === "draft" || open) && approve && <Button variant="outline" className="h-11 border-2 font-bold" onClick={() => act("cancel", o.id)}>Cancel order</Button>}
                  </div>
                  {recv?.po === o.id && (
                    <form onSubmit={receive} className="mt-3 space-y-2 rounded-lg bg-muted p-3">
                      <p className="text-sm font-bold">Enter what actually arrived, from the supplier's invoice. You can't receive more than is left on the order.</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input required placeholder="Supplier invoice no." value={recv.no} onChange={(e) => setRecv({ ...recv, no: e.target.value })} className="h-12" />
                        <Input type="date" required value={recv.date} onChange={(e) => setRecv({ ...recv, date: e.target.value })} className="h-12" />
                      </div>
                      {ls.filter((l) => Number(l.qty_received) < Number(l.qty_ordered)).map((l) => (
                        <div key={l.id} className="grid grid-cols-[1fr_5rem_6rem] items-center gap-1">
                          <span className="text-sm font-bold">{prod(l.product_id)} (left {Number(l.qty_ordered) - Number(l.qty_received)})</span>
                          <Input type="number" step="0.001" min="0" max={Number(l.qty_ordered) - Number(l.qty_received)} value={recv.qty[l.product_id] ?? ""} onChange={(e) => setRecv({ ...recv, qty: { ...recv.qty, [l.product_id]: e.target.value } })} className="h-12" aria-label="Quantity delivered" />
                          <Input type="number" step="0.01" min="0" value={recv.cost[l.product_id] ?? ""} onChange={(e) => setRecv({ ...recv, cost: { ...recv.cost, [l.product_id]: e.target.value } })} className="h-12" aria-label="Invoice cost each" />
                        </div>
                      ))}
                      <div className="flex gap-2"><Button disabled={busy} className="h-12 flex-1 font-black">Confirm delivery</Button><Button type="button" variant="outline" className="h-12" onClick={() => setRecv(null)}>Close</Button></div>
                    </form>
                  )}
                </li>
              );
            })}
            {!d?.orders.length && <li className="text-muted-foreground">No orders yet.</li>}
          </ul>
        </section>
      </div>

      <h2 className="mt-6 text-xl font-black">Supplier invoices & payments</h2>
      <ul className="mt-2 space-y-1">
        {(d?.invoices ?? []).map((i) => {
          const paid = paidOn(i.id), left = Number(i.total_cost) - paid;
          return (
            <li key={i.id} className="rounded-lg border-2 border-border bg-card px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b>{name(i.supplier_id)}</b> · invoice {i.invoice_no} · {i.invoice_date}{i.purchase_order_id && ` · ${d!.orders.find((o) => o.id === i.purchase_order_id)?.po_no ?? "order"}`} · {kes(i.total_cost)} · paid {kes(paid)} · <b>{left > 0 ? `owed ${kes(left)}` : "fully paid"}</b></span>
                {pay && left > 0 && <Button className="h-10 font-black" onClick={() => setPayFor({ invoice: i.id, amount: left.toFixed(2), method: "mpesa", reference: "", date: today, ref: crypto.randomUUID() })}>Record payment</Button>}
              </div>
              {(d?.payments ?? []).filter((p) => p.invoice_id === i.id).map((p) => <div key={p.id} className="pl-3">Paid {kes(p.amount)} by {p.method}{p.reference ? ` (${p.reference})` : ""} on {p.paid_on}</div>)}
              {payFor?.invoice === i.id && (
                <form onSubmit={recordPay} className="mt-2 grid gap-2 rounded-lg bg-muted p-3 sm:grid-cols-5">
                  <Input type="number" step="0.01" min="0.01" max={left} required value={payFor.amount} onChange={(e) => setPayFor({ ...payFor, amount: e.target.value })} className="h-12" aria-label="Amount" />
                  <select value={payFor.method} onChange={(e) => setPayFor({ ...payFor, method: e.target.value })} className="h-12 rounded-md border-2 border-input bg-background px-2">
                    <option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option>
                  </select>
                  <Input placeholder="Code / reference" value={payFor.reference} onChange={(e) => setPayFor({ ...payFor, reference: e.target.value })} className="h-12" />
                  <Input type="date" required value={payFor.date} onChange={(e) => setPayFor({ ...payFor, date: e.target.value })} className="h-12" />
                  <div className="flex gap-1"><Button disabled={busy} className="h-12 flex-1 font-black">Save</Button><Button type="button" variant="outline" className="h-12" onClick={() => setPayFor(null)}>×</Button></div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}
