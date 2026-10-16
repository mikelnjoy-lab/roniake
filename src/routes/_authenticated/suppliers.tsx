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

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [
    { title: "Suppliers & deliveries — RONIA Business" },
    { name: "description", content: "Supplier list and deliveries received against supplier invoices." },
    { property: "og:title", content: "Suppliers & deliveries — RONIA Business" },
    { property: "og:description", content: "Keep suppliers and receive stock against their invoices." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: Suppliers,
});

type Line = { product: string; qty: string; cost: string };
const emptySup = { id: "", name: "", phone: "", pin: "", terms: "0", active: true };

function Suppliers() {
  const { tenant } = Route.useRouteContext();
  const biz = tenant.business_id;
  const branch = tenant.branch_id!;
  const qc = useQueryClient();
  const manage = can(tenant.permissions, "inventory.manage");
  const view = manage || can(tenant.permissions, "reports.view");

  const data = useQuery({
    queryKey: ["suppliers", biz, branch], enabled: view,
    queryFn: async () => {
      const [s, p, i] = await Promise.all([
        supabase.from("suppliers").select("*").eq("business_id", biz).order("name"),
        supabase.from("products").select("id,name,sku,track_stock").eq("business_id", biz).eq("track_stock", true).order("name"),
        supabase.from("purchase_invoices").select("*").eq("branch_id", branch).order("created_at", { ascending: false }).limit(30),
      ]);
      if (s.error) throw s.error;
      return { suppliers: s.data ?? [], products: p.data ?? [], invoices: i.data ?? [] };
    },
  });

  const [sup, setSup] = useState(emptySup);
  const [inv, setInv] = useState({ supplier: "", no: "", date: new Date().toISOString().slice(0, 10) });
  const [lines, setLines] = useState<Line[]>([{ product: "", qty: "", cost: "" }]);
  const [ref, setRef] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  if (!view) return <AppShell><h1 className="text-3xl font-black">Suppliers</h1><p className="mt-3 font-bold">Your role can't view suppliers.</p></AppShell>;

  const suppliers = data.data?.suppliers ?? [];
  const products = data.data?.products ?? [];
  const supName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "";
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("save_supplier", {
      _business: biz, _id: (sup.id || null) as string, _name: sup.name, _phone: sup.phone, _kra_pin: sup.pin, _terms: Number(sup.terms || 0), _active: sup.active,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Supplier saved"); setSup(emptySup); qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  async function receive(e: React.FormEvent) {
    e.preventDefault();
    const clean = lines.filter((l) => l.product);
    if (!inv.supplier || !inv.no.trim() || !clean.length) { toast.error("Choose supplier, invoice number and at least one item"); return; }
    setBusy(true);
    const { data: r, error } = await supabase.rpc("receive_purchase_invoice", {
      _branch: branch, _supplier: inv.supplier, _invoice_no: inv.no, _invoice_date: inv.date,
      _lines: clean.map((l) => ({ product_id: l.product, qty: Number(l.qty), unit_cost: Number(l.cost) })) as never, _client_ref: ref,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const d = r as { status: string; total_cost: number };
    toast.success(d.status === "replay" ? "Already received — nothing added twice" : `Delivery received: ${kes(d.total_cost)}`);
    setInv({ ...inv, no: "" }); setLines([{ product: "", qty: "", cost: "" }]); setRef(crypto.randomUUID());
    qc.invalidateQueries({ queryKey: ["suppliers"] }); qc.invalidateQueries({ queryKey: ["stock"] });
  }

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Suppliers & deliveries</h1>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {manage && (
          <form onSubmit={receive} className="rounded-xl border-4 border-foreground bg-card p-4">
            <h2 className="text-xl font-black">Receive a delivery</h2>
            <p className="text-sm">Enter the items exactly as on the supplier's invoice. The same invoice can't be received twice.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-3"><Label>Supplier</Label>
                <select required value={inv.supplier} onChange={(e) => setInv({ ...inv, supplier: e.target.value })} className="h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg">
                  <option value="">Choose…</option>{suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div className="sm:col-span-2"><Label>Invoice number</Label><Input required value={inv.no} onChange={(e) => setInv({ ...inv, no: e.target.value })} className="h-12 text-lg" /></div>
              <div><Label>Invoice date</Label><Input required type="date" value={inv.date} onChange={(e) => setInv({ ...inv, date: e.target.value })} className="h-12" /></div>
            </div>
            <div className="mt-3 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_6rem_2.5rem] gap-1">
                  <select value={l.product} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, product: e.target.value } : x))} className="h-12 rounded-md border-2 border-input bg-background px-2">
                    <option value="">Item…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <Input type="number" step="0.001" min="0" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} className="h-12" />
                  <Input type="number" step="0.01" min="0" placeholder="Cost each" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} className="h-12" />
                  <Button type="button" variant="outline" className="h-12 px-0 font-black" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}>×</Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" className="mt-2 h-12 w-full border-2 font-bold" onClick={() => setLines([...lines, { product: "", qty: "", cost: "" }])}>+ Add item</Button>
            <p className="mt-3 text-xl font-black">Invoice total: {kes(total)}</p>
            <Button size="lg" disabled={busy} className="mt-2 h-14 w-full text-lg font-black">Receive delivery</Button>
          </form>
        )}

        <section className="rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Suppliers</h2>
          {manage && (
            <form onSubmit={saveSupplier} className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input required placeholder="Supplier name" value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} className="h-12 sm:col-span-2" />
              <Input placeholder="Phone" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} className="h-12" />
              <Input placeholder="KRA PIN (optional)" value={sup.pin} onChange={(e) => setSup({ ...sup, pin: e.target.value })} className="h-12" />
              <label className="font-bold">Pay within (days)<Input type="number" min="0" max="365" value={sup.terms} onChange={(e) => setSup({ ...sup, terms: e.target.value })} className="h-12" /></label>
              <label className="flex items-center gap-2 font-bold"><input type="checkbox" className="size-6" checked={sup.active} onChange={(e) => setSup({ ...sup, active: e.target.checked })} />Active</label>
              <Button size="lg" className="h-12 font-black">{sup.id ? "Update supplier" : "Add supplier"}</Button>
              {sup.id && <Button type="button" variant="outline" className="h-12" onClick={() => setSup(emptySup)}>Cancel</Button>}
            </form>
          )}
          <ul className="mt-3 space-y-1">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-lg border-2 border-border px-3 py-2">
                <span><b>{s.name}</b>{!s.is_active && " (inactive)"}<span className="block text-sm">{s.phone ?? ""} {s.kra_pin ? `· ${s.kra_pin}` : ""} · pay in {s.payment_terms_days} days</span></span>
                {manage && <Button variant="outline" onClick={() => setSup({ id: s.id, name: s.name, phone: s.phone ?? "", pin: s.kra_pin ?? "", terms: String(s.payment_terms_days), active: s.is_active })}>Edit</Button>}
              </li>
            ))}
            {!suppliers.length && <li className="text-muted-foreground">{data.isLoading ? "Loading…" : "No suppliers yet."}</li>}
          </ul>
        </section>
      </div>

      <h2 className="mt-6 text-xl font-black">Deliveries received at this branch</h2>
      <ul className="mt-2 space-y-1">
        {(data.data?.invoices ?? []).map((i) => (
          <li key={i.id} className="rounded-lg border-2 border-border bg-card px-3 py-2 text-sm">
            <b>{supName(i.supplier_id)}</b> · invoice {i.invoice_no} · {i.invoice_date} · {i.line_count} items · <b>{kes(i.total_cost)}</b>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
