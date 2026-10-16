import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell, useOnline } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Receipt, loadReceipt } from "@/components/Receipt";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";
import { deviceId, dismissFailed, isNetworkError, listPending, putPending, submitSale, syncPending, type PendingSale } from "@/lib/offline-queue";
import { shiftQuery } from "./shift";

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "Till — RONIA Business" }, { name: "description", content: "Ring up sales fast." }] }),
  beforeLoad: requireTenant,
  component: Pos,
});

type Product = { id: string; name: string; sku: string; barcode: string | null; selling_price: number; is_weighted: boolean; plu_code: string | null; unit: string; is_active: boolean; track_stock: boolean };
type Line = { p: Product; qty: number; discount: number };
type Tender = { type: "cash" | "mpesa_manual" | "card" | "other" | "deni"; amount: string; reference: string };
const HOLD_KEY = "ronia.held-carts";

function Pos() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const qc = useQueryClient();
  const online = useOnline();
  const discountOk = can(tenant.permissions, "pos.discount");
  const shift = useQuery(shiftQuery(branch));
  const products = useQuery({
    queryKey: ["products", tenant.business_id],
    queryFn: async () => (await supabase.from("products").select("*").eq("business_id", tenant.business_id).eq("is_active", true).order("name")).data as Product[] ?? [],
  });
  const stock = useQuery({
    queryKey: ["stock-levels", branch],
    queryFn: async () => { const { data, error } = await supabase.rpc("branch_stock_levels", { _branch: branch }); if (error) throw error; return new Map((data ?? []).map((r) => [r.product_id, Number(r.qty_on_hand)])); },
  });
  const customers = useQuery({
    queryKey: ["customers", tenant.business_id],
    queryFn: async () => (await supabase.from("customers").select("id,name,phone,credit_enabled,credit_limit,balance").eq("business_id", tenant.business_id).order("name")).data ?? [],
  });
  const [customerId, setCustomerId] = useState<string>("");
  const customer = customers.data?.find((c) => c.id === customerId);
  const [cart, setCart] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [paying, setPaying] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([{ type: "cash", amount: "", reference: "" }]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ saleId?: string; pending?: boolean; change?: number } | null>(null);
  const [width, setWidth] = useState<58 | 80>(80);
  const [pending, setPending] = useState(0);
  const [failedSales, setFailedSales] = useState<PendingSale[]>([]);
  const [held, setHeld] = useState<{ at: string; cart: Line[] }[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  const refreshPending = async () => {
    const all = await listPending();
    setPending(all.filter((p) => p.state !== "failed").length);
    setFailedSales(all.filter((p) => p.state === "failed"));
  };
  const runSync = (includeFailed = false) => syncPending({ includeFailed }).then((r) => {
    if (r.synced) toast.success(`${r.synced} offline sale(s) synced`);
    if (r.failed) toast.error(`${r.failed} offline sale(s) rejected — see the red box on the till`);
    refreshPending(); qc.invalidateQueries({ queryKey: ["sales"] });
  });
  useEffect(() => { refreshPending(); setHeld(JSON.parse(localStorage.getItem(HOLD_KEY) ?? "[]")); }, []);
  useEffect(() => { if (online) runSync(); }, [online]);

  const total = useMemo(() => cart.reduce((a, l) => a + Math.round(l.p.selling_price * l.qty * 100) / 100 - l.discount, 0), [cart]);
  const paid = tenders.reduce((a, t) => a + Number(t.amount || 0), 0);
  const nonCash = tenders.filter((t) => t.type !== "cash").reduce((a, t) => a + Number(t.amount || 0), 0);

  const onHand = (p: Product & { track_stock?: boolean }) => (p.track_stock === false ? Infinity : stock.data?.get(p.id) ?? 0);
  const inCart = (id: string, c: Line[] = cart) => c.filter((l) => l.p.id === id).reduce((a, l) => a + l.qty, 0);
  const add = (p: Product, qty = 1) => setCart((c) => {
    if (inCart(p.id, c) + qty > onHand(p) + 1e-9) { toast.error(`${p.name}: only ${onHand(p)} in stock`); return c; }
    const i = c.findIndex((l) => l.p.id === p.id && !p.is_weighted);
    if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
    return [...c, { p, qty, discount: 0 }];
  });

  // Barcode: exact barcode/SKU, or variable-weight "2" + PLU(5) + weight grams(5) + check.
  const scan = (code: string) => {
    const list = products.data ?? [];
    const c = code.trim();
    if (!c) return;
    const hit = list.find((p) => p.barcode === c || p.sku.toLowerCase() === c.toLowerCase());
    if (hit) {
      if (hit.is_weighted) { const w = prompt(`Weight in ${hit.unit} for ${hit.name}`); if (w && Number(w) > 0) add(hit, Math.round(Number(w) * 1000) / 1000); }
      else add(hit);
      setQ(""); return;
    }
    if (/^2\d{12}$/.test(c)) {
      const plu = c.slice(1, 6).replace(/^0+/, "");
      const p = list.find((x) => x.is_weighted && x.plu_code && x.plu_code.replace(/^0+/, "") === plu);
      if (p) { add(p, Number(c.slice(6, 11)) / 1000); setQ(""); return; }
    }
    const matches = list.filter((p) => p.name.toLowerCase().includes(c.toLowerCase()));
    if (matches.length === 1) { add(matches[0]!); setQ(""); } else if (!matches.length) toast.error("No product matches " + c);
  };
  const results = q.length >= 2 ? (products.data ?? []).filter((p) => `${p.name} ${p.sku} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];

  const hold = () => {
    if (!cart.length) return;
    const next = [...held, { at: new Date().toISOString(), cart }];
    setHeld(next); localStorage.setItem(HOLD_KEY, JSON.stringify(next)); setCart([]); toast("Sale held");
  };
  const resume = (i: number): void => {
    if (cart.length) { toast.error("Finish or hold the current sale first"); return; }
    setCart(held[i]!.cart); const next = held.filter((_, j) => j !== i); setHeld(next); localStorage.setItem(HOLD_KEY, JSON.stringify(next));
  };

  const complete = async (): Promise<void> => {
    if (paid + 0.001 < total) { toast.error("Payment is short by " + kes(total - paid)); return; }
    if (nonCash > total + 0.001) { toast.error("Only cash can be more than the total"); return; }
    const deni = tenders.filter((t) => t.type === "deni").reduce((a, t) => a + Number(t.amount || 0), 0);
    if (deni > 0) {
      if (!customer) { toast.error("Choose the customer for Deni"); return; }
      if (!customer.credit_enabled) { toast.error(`Deni is not enabled for ${customer.name}`); return; }
      if (Number(customer.balance) + deni > Number(customer.credit_limit)) { toast.error(`Deni limit reached: owes ${kes(customer.balance)} of ${kes(customer.credit_limit)}`); return; }
      if (!online) { toast.error("Deni sales need a connection"); return; }
    }
    for (const t of tenders) if (t.type === "mpesa_manual" && Number(t.amount) > 0 && !/^[A-Z0-9]{8,12}$/.test(t.reference.trim().toUpperCase())) { toast.error("Enter the M-Pesa code from the customer's message"); return; }
    const payload = {
      client_txn_id: crypto.randomUUID(), branch_id: branch, device_id: deviceId(), customer_id: customerId || null,
      lines: cart.map((l) => ({ product_id: l.p.id, qty: l.qty, discount: l.discount })),
      tenders: tenders.filter((t) => Number(t.amount) > 0).map((t) => ({ type: t.type, amount: Number(t.amount), reference: t.reference.trim().toUpperCase() || null })),
    };
    setBusy(true);
    try {
      const r = await submitSale(payload);
      setDone({ saleId: r.sale_id, change: r.change_given });
      qc.invalidateQueries({ queryKey: ["sales"] }); qc.invalidateQueries({ queryKey: ["stock-levels"] }); qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) {
      if (isNetworkError(e)) {
        await putPending({ ...payload, state: "pending", created_at: new Date().toISOString() });
        await refreshPending();
        setDone({ pending: true, change: Math.max(0, paid - total) });
      } else toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  const next = () => { setCart([]); setCustomerId(""); setTenders([{ type: "cash", amount: "", reference: "" }]); setPaying(false); setDone(null); setTimeout(() => scanRef.current?.focus(), 50); };
  const receipt = useQuery({ queryKey: ["receipt", done?.saleId], enabled: !!done?.saleId, queryFn: () => loadReceipt(supabase, done!.saleId!) });

  if (!shift.isLoading && !shift.data) return (
    <AppShell><div className="rounded-xl border-4 border-foreground bg-secondary p-6 text-center text-secondary-foreground">
      <p className="text-2xl font-black">Open a shift to start selling</p>
      <Button asChild size="lg" className="mt-4 h-14 text-lg font-black"><Link to="/shift">Open shift</Link></Button></div></AppShell>
  );

  if (done) return (
    <AppShell>
      <div className="rounded-xl border-4 border-foreground bg-secondary p-5 text-center text-secondary-foreground">
        <p className="text-3xl font-black">{done.pending ? "Saved offline" : "Sale complete"}</p>
        <p className="mt-2 text-2xl font-black">Change: {kes(done.change)}</p>
        {done.pending && <p className="mt-2 font-bold">Receipt number is issued when the till reconnects. Print from Sales then.</p>}
      </div>
      {receipt.data && <>
        <div className="mt-3 flex gap-2 print:hidden">
          <Button variant={width === 58 ? "default" : "outline"} onClick={() => setWidth(58)}>58mm</Button>
          <Button variant={width === 80 ? "default" : "outline"} onClick={() => setWidth(80)}>80mm</Button>
          <Button onClick={() => window.print()} className="font-black">Print receipt</Button>
        </div>
        <div className="mt-2 border-2 border-foreground"><Receipt r={receipt.data} width={width} /></div>
      </>}
      <Button size="lg" onClick={next} className="mt-4 h-16 w-full text-xl font-black print:hidden">Next customer</Button>
    </AppShell>
  );

  return (
    <AppShell wide right={pending ? <span className="rounded-md bg-accent px-2 py-1 text-sm font-black text-accent-foreground">{pending} to sync</span> : null}>
      {failedSales.length > 0 && (
        <div className="mb-4 rounded-xl border-4 border-destructive bg-card p-3">
          <p className="text-lg font-black text-destructive">{failedSales.length} offline sale(s) were NOT recorded</p>
          <p className="text-sm font-bold">These were rung up offline but refused when the till reconnected. Tell a manager — the goods may have left without a recorded sale.</p>
          <ul className="mt-2 space-y-2">
            {failedSales.map((f) => (
              <li key={f.client_txn_id} className="rounded-lg border-2 border-foreground p-2 text-sm">
                <p className="font-black">{new Date(f.created_at).toLocaleString()} · {kes(f.tenders.reduce((a, t) => a + Number(t.amount), 0))} paid</p>
                <p className="font-bold">Reason: {f.error}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => runSync(true)}>Try again</Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!confirm("Remove this unrecorded sale from this till? Only do this after a manager has dealt with it.")) return;
                    await dismissFailed(f.client_txn_id); refreshPending();
                  }}>Manager has handled it</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div>
          <form onSubmit={(e) => { e.preventDefault(); scan(q); }}>
            <Input ref={scanRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan barcode or type name / code" className="h-16 border-4 border-foreground text-2xl" />
          </form>
          {results.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {results.map((p) => (
                <button key={p.id} onClick={() => { scan(p.sku); }} className="rounded-xl border-2 border-foreground bg-card p-3 text-left active:bg-secondary">
                  <p className="font-black">{p.name}</p><p className="text-sm">{kes(p.selling_price)}{p.is_weighted ? ` / ${p.unit}` : ""}</p>
                  <p className={`text-sm font-black ${onHand(p) <= 0 ? "text-destructive" : ""}`}>{onHand(p) === Infinity ? "" : onHand(p) <= 0 ? "Out of stock" : `${onHand(p)} in stock`}</p>
                </button>
              ))}
            </div>
          )}
          {held.length > 0 && <div className="mt-4"><p className="font-black">Held sales</p><div className="mt-1 flex flex-wrap gap-2">
            {held.map((h, i) => <Button key={h.at} variant="outline" className="border-2 font-bold" onClick={() => resume(i)}>{new Date(h.at).toLocaleTimeString()} · {h.cart.length} items</Button>)}
          </div></div>}
        </div>

        <div className="rounded-xl border-4 border-foreground bg-card p-3">
          <ul className="max-h-[45vh] space-y-2 overflow-y-auto">
            {cart.map((l, i) => (
              <li key={i} className="rounded-lg border-2 border-border p-2">
                <div className="flex justify-between font-bold"><span>{l.p.name}</span><span>{kes(l.p.selling_price * l.qty - l.discount)}</span></div>
                <div className="mt-1 flex items-center gap-2">
                  {!l.p.is_weighted && <Button size="lg" variant="outline" className="h-11 w-11 border-2 text-xl font-black" onClick={() => setCart(cart.map((x, j) => j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</Button>}
                  <span className="min-w-12 text-center text-lg font-black">{l.qty}{l.p.is_weighted ? ` ${l.p.unit}` : ""}</span>
                  {!l.p.is_weighted && <Button size="lg" variant="outline" className="h-11 w-11 border-2 text-xl font-black" onClick={() => { if (inCart(l.p.id) + 1 > onHand(l.p)) { toast.error(`${l.p.name}: only ${onHand(l.p)} in stock`); return; } setCart(cart.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x)); }}>+</Button>}
                  {discountOk && <Input type="number" min="0" step="0.01" placeholder="Disc." value={l.discount || ""} onChange={(e) => setCart(cart.map((x, j) => j === i ? { ...x, discount: Number(e.target.value) || 0 } : x))} className="h-11 w-24" />}
                  <Button variant="destructive" className="ml-auto h-11" onClick={() => setCart(cart.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              </li>
            ))}
            {!cart.length && <li className="p-6 text-center text-muted-foreground">Scan an item to start</li>}
          </ul>
          <div className="mt-3 flex items-end justify-between border-t-4 border-foreground pt-3"><span className="text-xl font-black">TOTAL</span><span className="text-4xl font-black">{kes(total)}</span></div>

          {!paying ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" className="h-14 border-2 text-lg font-black" onClick={hold} disabled={!cart.length}>Hold</Button>
              <Button size="lg" className="h-14 text-lg font-black" disabled={!cart.length} onClick={() => { setTenders([{ type: "cash", amount: total.toFixed(2), reference: "" }]); setPaying(true); }}>Pay</Button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-12 w-full rounded-md border-2 border-foreground bg-background px-3 text-lg font-bold">
                <option value="">No customer (walk-in)</option>
                {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}{c.credit_enabled ? ` · owes ${kes(c.balance)} / ${kes(c.credit_limit)}` : ""}</option>)}
              </select>
              {tenders.map((t, i) => (
                <div key={i} className="rounded-lg border-2 border-foreground p-2">
                  <div className="grid grid-cols-5 gap-1">
                    {(["cash", "mpesa_manual", "card", "other", "deni"] as const).map((k) => (
                      <Button key={k} size="sm" variant={t.type === k ? "default" : "outline"} className="h-11 font-black" onClick={() => setTenders(tenders.map((x, j) => j === i ? { ...x, type: k } : x))}>
                        {k === "mpesa_manual" ? "M-Pesa" : k === "deni" ? "Deni" : k.charAt(0).toUpperCase() + k.slice(1)}
                      </Button>))}
                  </div>
                  <Input type="number" step="0.01" min="0" value={t.amount} onChange={(e) => setTenders(tenders.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="mt-2 h-12 text-xl" placeholder="Amount" />
                  {t.type === "mpesa_manual" && <Input value={t.reference} onChange={(e) => setTenders(tenders.map((x, j) => j === i ? { ...x, reference: e.target.value.toUpperCase() } : x))} className="mt-2 h-12 text-xl uppercase" placeholder="M-Pesa code (confirmed on phone)" />}
                </div>
              ))}
              <Button variant="outline" className="w-full border-2 font-bold" onClick={() => setTenders([...tenders, { type: "mpesa_manual", amount: Math.max(0, total - paid).toFixed(2), reference: "" }])}>+ Split payment</Button>
              <p className="text-lg font-bold">{paid >= total ? `Change: ${kes(paid - total)}` : `Still to pay: ${kes(total - paid)}`}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" className="h-14 border-2 font-black" onClick={() => setPaying(false)}>Back</Button>
                <Button size="lg" className="h-14 text-lg font-black" disabled={busy} onClick={complete}>{busy ? "Saving…" : "Complete sale"}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
