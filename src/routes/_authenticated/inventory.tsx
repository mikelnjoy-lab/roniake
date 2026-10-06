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

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Stock — RONIA Business" }, { name: "description", content: "Branch stock, deliveries and adjustments." }] }),
  beforeLoad: requireTenant,
  component: Inventory,
});

type Mode = "receive" | "adjust" | "break";

function Inventory() {
  const { tenant } = Route.useRouteContext();
  const qc = useQueryClient();
  const branch = tenant.branch_id!;
  const allowed = can(tenant.permissions, "inventory.manage") || can(tenant.permissions, "reports.view");
  const manage = can(tenant.permissions, "inventory.manage");
  const data = useQuery({
    queryKey: ["stock", branch],
    enabled: allowed,
    queryFn: async () => {
      const [p, s, m] = await Promise.all([
        supabase.from("products").select("id,name,sku,unit,track_stock,parent_product_id,low_stock_threshold").eq("business_id", tenant.business_id).order("name"),
        supabase.from("branch_stock").select("*").eq("branch_id", branch),
        supabase.from("stock_movements").select("*").eq("branch_id", branch).order("created_at", { ascending: false }).limit(30),
      ]);
      if (p.error) throw p.error;
      return { products: p.data, stock: new Map((s.data ?? []).map((r) => [r.product_id, r])), moves: m.data ?? [] };
    },
  });
  const [mode, setMode] = useState<Mode | null>(null);
  const [f, setF] = useState({ product: "", qty: "", cost: "", ref: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["stock"] });

  if (!allowed) return <AppShell><p className="text-xl font-bold">Your role can't view stock.</p></AppShell>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(f.qty);
    const r = mode === "receive"
      ? await supabase.rpc("receive_stock", { _branch: branch, _product: f.product, _qty: qty, _unit_cost: Number(f.cost), _reference: f.ref || undefined })
      : mode === "adjust"
        ? await supabase.rpc("adjust_stock", { _branch: branch, _product: f.product, _qty_delta: qty, _reason: f.ref })
        : await supabase.rpc("break_bulk", { _branch: branch, _child_product: f.product, _parent_qty: qty });
    if (r.error) { toast.error(r.error.message); return; }
    toast.success("Stock updated");
    setF({ product: "", qty: "", cost: "", ref: "" }); setMode(null); refresh();
  };
  const products = data.data?.products ?? [];
  const pickable = mode === "break" ? products.filter((p) => p.parent_product_id) : products.filter((p) => p.track_stock);
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Stock</h1>
      {manage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(["receive", "adjust", "break"] as Mode[]).map((m) => (
            <Button key={m} size="lg" variant={mode === m ? "default" : "outline"} className="h-12 border-2 text-lg font-black" onClick={() => setMode(mode === m ? null : m)}>
              {m === "receive" ? "Receive delivery" : m === "adjust" ? "Adjust stock" : "Break a pack"}
            </Button>
          ))}
        </div>
      )}
      {mode && (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl border-4 border-foreground bg-card p-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>{mode === "break" ? "Single item to fill" : "Product"}</Label>
            <select required value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} className="h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg">
              <option value="">Choose…</option>{pickable.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select></div>
          <div><Label>{mode === "adjust" ? "Change (+ or −)" : mode === "break" ? "Packs to break" : "Quantity received"}</Label>
            <Input required type="number" step="0.001" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className="h-12 text-lg" /></div>
          {mode === "receive" && <div><Label>Cost per unit (KES)</Label><Input required type="number" step="0.01" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} className="h-12 text-lg" /></div>}
          {mode !== "break" && <div className="sm:col-span-2"><Label>{mode === "adjust" ? "Reason (required)" : "Supplier invoice / reference"}</Label>
            <Input required={mode === "adjust"} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} className="h-12 text-lg" /></div>}
          <Button size="lg" className="h-14 text-lg font-black sm:col-span-2">Save</Button>
        </form>
      )}
      <div className="mt-4 overflow-x-auto rounded-xl border-2 border-foreground">
        <table className="w-full text-left">
          <thead className="bg-foreground text-background"><tr><th className="p-3">Product</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Avg cost</th><th className="p-3 text-right">Value</th></tr></thead>
          <tbody>{products.filter((p) => p.track_stock).map((p) => {
            const s = data.data?.stock.get(p.id); const qty = Number(s?.qty_on_hand ?? 0);
            const low = qty < 0 || (p.low_stock_threshold != null && qty <= Number(p.low_stock_threshold));
            return <tr key={p.id} className="border-t-2 border-border"><td className="p-3 font-bold">{p.name}</td>
              <td className={`p-3 text-right font-black ${low ? "text-destructive" : ""}`}>{qty} {p.unit}</td>
              <td className="p-3 text-right">{kes(s?.wac)}</td><td className="p-3 text-right">{kes(qty * Number(s?.wac ?? 0))}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <h2 className="mt-6 text-xl font-black">Recent stock history</h2>
      <ul className="mt-2 space-y-1">{(data.data?.moves ?? []).map((m) => (
        <li key={m.id} className="rounded-lg border-2 border-border bg-card px-3 py-2 text-sm">
          <b>{new Date(m.created_at).toLocaleString()}</b> · {m.movement_type} · {name(m.product_id)} · {Number(m.qty) > 0 ? "+" : ""}{m.qty} → {m.qty_after}{m.note ? ` · ${m.note}` : ""}
        </li>))}</ul>
    </AppShell>
  );
}
