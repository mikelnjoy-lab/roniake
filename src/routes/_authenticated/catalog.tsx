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

export const Route = createFileRoute("/_authenticated/catalog")({
  head: () => ({ meta: [{ title: "Products — RONIA Business" }, { name: "description", content: "Your product catalog." }] }),
  beforeLoad: requireTenant,
  component: Catalog,
});

const UNITS = ["pc", "kg", "g", "l", "ml", "m", "pack", "box", "crate", "bag"];
const TAX = [["B", "B · VAT 16%"], ["E", "E · 8%"], ["A", "A · Exempt"], ["C", "C · Zero-rated"], ["D", "D · Non-VAT"]];

function Catalog() {
  const { tenant } = Route.useRouteContext();
  const qc = useQueryClient();
  const manage = can(tenant.permissions, "catalog.manage");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const products = useQuery({
    queryKey: ["products", tenant.business_id],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("business_id", tenant.business_id).order("name");
      if (error) throw error;
      return data;
    },
  });
  const branch = tenant.branch_id;
  const assort = useQuery({
    queryKey: ["branch-products", branch],
    enabled: !!branch,
    queryFn: async () => { const { data, error } = await supabase.from("branch_products").select("product_id,enabled").eq("branch_id", branch!); if (error) throw error; return new Set((data ?? []).filter((r) => r.enabled).map((r) => r.product_id)); },
  });
  const toggle = async (id: string, on: boolean) => {
    const { error } = await supabase.rpc("set_branch_product", { _branch: branch!, _product: id, _enabled: on });
    if (error) { toast.error(error.message); return; }
    toast.success(on ? "Now sold in this branch" : "Removed from this branch's till");
    qc.invalidateQueries({ queryKey: ["branch-products"] }); qc.invalidateQueries({ queryKey: ["products"] });
  };
  const list = (products.data ?? []).filter((p) => !q || `${p.name} ${p.sku} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-3xl font-black">Products</h1>
        {manage && <Button size="lg" className="h-12 text-lg font-black" onClick={() => setOpen(!open)}>{open ? "Close" : "+ Add product"}</Button>}
      </div>
      {open && <ProductForm businessId={tenant.business_id} branchId={branch} parents={products.data ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["products"] }); }} />}
      <Input placeholder="Search name, code or barcode" value={q} onChange={(e) => setQ(e.target.value)} className="mt-4 h-12 border-2 text-lg" />
      <div className="mt-3 overflow-x-auto rounded-xl border-2 border-foreground">
        <table className="w-full text-left">
          <thead className="bg-foreground text-background"><tr><th className="p-3">Name</th><th className="p-3">Code</th><th className="p-3">Barcode</th><th className="p-3">Unit</th><th className="p-3">Tax</th><th className="p-3 text-right">Price</th><th className="p-3">This branch</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t-2 border-border">
                <td className="p-3 font-bold">{p.name}{p.is_weighted && <span className="ml-2 rounded bg-secondary px-1 text-xs">by weight</span>}{p.parent_product_id && <span className="ml-2 rounded bg-muted px-1 text-xs">from pack ×{p.units_per_parent}</span>}</td>
                <td className="p-3">{p.sku}</td><td className="p-3">{p.barcode ?? "—"}</td><td className="p-3">{p.unit}</td><td className="p-3">{p.tax_class}</td>
                <td className="p-3 text-right font-black">{kes(p.selling_price)}</td>
                <td className="p-3">{assort.data?.has(p.id)
                  ? <span className="flex items-center gap-2"><span className="rounded bg-primary px-2 py-1 text-xs font-black text-primary-foreground">Sold here</span>{manage && branch && <Button size="sm" variant="outline" onClick={() => toggle(p.id, false)}>Remove</Button>}</span>
                  : <span className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Not in this branch</span>{manage && branch && <Button size="sm" onClick={() => toggle(p.id, true)}>Sell here</Button>}</span>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{products.isLoading ? "Loading…" : "No products yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function ProductForm({ businessId, branchId, parents, onDone }: { businessId: string; branchId: string | null; parents: { id: string; name: string }[]; onDone: () => void }) {
  const [f, setF] = useState({ name: "", sku: "", barcode: "", unit: "pc", price: "", tax: "B", weighted: false, plu: "", parent: "", per: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data: created, error } = await supabase.from("products").insert({
      business_id: businessId, name: f.name.trim(), sku: f.sku.trim(), barcode: f.barcode.trim() || null, unit: f.unit,
      selling_price: Number(f.price), tax_class: f.tax, is_weighted: f.weighted, plu_code: f.weighted ? f.plu.trim() || null : null,
      parent_product_id: f.parent || null, units_per_parent: f.parent ? Number(f.per) : null,
    }).select("id").single();
    if (!error && created && branchId) {
      const r = await supabase.rpc("set_branch_product", { _branch: branchId, _product: created.id, _enabled: true });
      if (r.error) toast.error("Product saved, but not added to this branch: " + r.error.message);
    }
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Product added");
    onDone();
  };
  const sel = "h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg";
  return (
    <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl border-4 border-foreground bg-card p-4 sm:grid-cols-2">
      <div><Label>Name</Label><Input required value={f.name} onChange={set("name")} className="h-12 text-lg" /></div>
      <div><Label>Product code (SKU)</Label><Input required value={f.sku} onChange={set("sku")} className="h-12 text-lg" /></div>
      <div><Label>Barcode</Label><Input value={f.barcode} onChange={set("barcode")} className="h-12 text-lg" /></div>
      <div><Label>Selling price (KES, VAT incl.)</Label><Input required type="number" step="0.01" min="0" value={f.price} onChange={set("price")} className="h-12 text-lg" /></div>
      <div><Label>Unit</Label><select value={f.unit} onChange={set("unit")} className={sel}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
      <div><Label>Tax class</Label><select value={f.tax} onChange={set("tax")} className={sel}>{TAX.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <label className="flex items-center gap-2 text-lg font-bold"><input type="checkbox" checked={f.weighted} onChange={set("weighted")} className="size-6" /> Sold by weight</label>
      {f.weighted && <div><Label>Scale PLU code</Label><Input value={f.plu} onChange={set("plu")} className="h-12 text-lg" /></div>}
      <div><Label>Broken from pack (optional)</Label><select value={f.parent} onChange={set("parent")} className={sel}><option value="">— none —</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      {f.parent && <div><Label>Units per pack</Label><Input required type="number" min="1" value={f.per} onChange={set("per")} className="h-12 text-lg" /></div>}
      <Button disabled={busy} size="lg" className="h-14 text-lg font-black sm:col-span-2">{busy ? "Saving…" : "Save product"}</Button>
    </form>
  );
}
