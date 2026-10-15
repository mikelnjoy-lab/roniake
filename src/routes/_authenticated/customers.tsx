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

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Customers & Deni — RONIA Business" }, { name: "description", content: "Customer credit limits, balances and repayments." }] }),
  beforeLoad: requireTenant,
  component: Customers,
});

function Customers() {
  const { tenant } = Route.useRouteContext();
  const qc = useQueryClient();
  const manage = can(tenant.permissions, "deni.manage");
  const list = useQuery({
    queryKey: ["customers", tenant.business_id],
    queryFn: async () => (await supabase.from("customers").select("*").eq("business_id", tenant.business_id).order("name")).data ?? [],
  });
  const [open, setOpen] = useState<string | null>(null);
  const ledger = useQuery({
    queryKey: ["ledger", open], enabled: !!open && manage,
    queryFn: async () => (await supabase.from("customer_ledger").select("*").eq("customer_id", open!).order("created_at", { ascending: false }).limit(50)).data ?? [],
  });
  const [f, setF] = useState({ name: "", phone: "", limit: "", enabled: false });
  const [pay, setPay] = useState({ amount: "", type: "cash" as "cash" | "mpesa_manual" | "card" | "other", ref: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: ["ledger"] }); };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").insert({ business_id: tenant.business_id, name: f.name.trim(), phone: f.phone.trim() || null, credit_limit: Number(f.limit || 0), credit_enabled: f.enabled });
    if (error) { toast.error(error.message); return; }
    toast.success("Customer added"); setF({ name: "", phone: "", limit: "", enabled: false }); refresh();
  };
  const update = async (id: string, patch: { credit_enabled?: boolean; credit_limit?: number }) => {
    const { error } = await supabase.from("customers").update(patch).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Saved"); refresh(); }
  };
  const repay = async (id: string) => {
    const { error } = await supabase.rpc("record_deni_repayment", { _customer: id, _amount: Number(pay.amount), _type: pay.type, ...(pay.ref ? { _reference: pay.ref.toUpperCase() } : {}) });
    if (error) { toast.error(error.message); return; }
    toast.success("Repayment recorded"); setPay({ amount: "", type: "cash", ref: "" }); refresh();
  };
  const owed = (list.data ?? []).reduce((a, c) => a + Number(c.balance), 0);

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Customers & Deni</h1>
      <p className="mt-1 text-lg font-bold">Total owed: {kes(owed)}</p>
      {manage && (
        <form onSubmit={create} className="mt-3 grid gap-3 rounded-xl border-4 border-foreground bg-card p-4 sm:grid-cols-2">
          <div><Label>Name</Label><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Phone</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="h-12 text-lg" placeholder="07…" /></div>
          <div><Label>Deni limit (KES)</Label><Input type="number" min="0" step="0.01" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} className="h-12 text-lg" /></div>
          <label className="flex items-center gap-2 self-end text-lg font-bold"><input type="checkbox" className="size-6" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Allow Deni</label>
          <Button size="lg" className="h-14 text-lg font-black sm:col-span-2">Add customer</Button>
        </form>
      )}
      <ul className="mt-4 space-y-2">
        {(list.data ?? []).map((c) => (
          <li key={c.id} className="rounded-xl border-2 border-foreground bg-card p-3">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span><b className="text-lg">{c.name}</b> {c.phone && <span className="text-sm">· {c.phone}</span>}
                <span className="block text-sm">{c.credit_enabled ? `Deni on · limit ${kes(c.credit_limit)}` : "Deni off"}</span></span>
              <span className={`text-xl font-black ${Number(c.balance) > 0 ? "text-destructive" : ""}`}>{kes(c.balance)}</span>
            </button>
            {open === c.id && manage && (
              <div className="mt-3 space-y-3 border-t-2 border-border pt-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="border-2 font-bold" onClick={() => update(c.id, { credit_enabled: !c.credit_enabled })}>{c.credit_enabled ? "Turn Deni off" : "Turn Deni on"}</Button>
                  <Button variant="outline" className="border-2 font-bold" onClick={() => { const v = prompt("New Deni limit (KES)", String(c.credit_limit)); if (v !== null && Number(v) >= 0) update(c.id, { credit_limit: Number(v) }); }}>Change limit</Button>
                </div>
                {Number(c.balance) > 0 && (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Input type="number" min="0" step="0.01" placeholder="Amount paid" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="h-12 text-lg" />
                    <select value={pay.type} onChange={(e) => setPay({ ...pay, type: e.target.value as typeof pay.type })} className="h-12 rounded-md border-2 border-input bg-background px-3 text-lg">
                      <option value="cash">Cash</option><option value="mpesa_manual">M-Pesa</option><option value="card">Card</option><option value="other">Other</option>
                    </select>
                    <Input placeholder={pay.type === "mpesa_manual" ? "M-Pesa code" : "Reference"} value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value.toUpperCase() })} className="h-12 text-lg uppercase" />
                    <Button className="h-12 font-black" onClick={() => repay(c.id)}>Record repayment</Button>
                  </div>
                )}
                <ul className="space-y-1 text-sm">{(ledger.data ?? []).map((l) => (
                  <li key={l.id} className="rounded-md border border-border px-2 py-1">
                    {new Date(l.created_at).toLocaleString()} · {l.entry_type === "credit_sale" ? `Deni sale ${l.reference ?? ""}` : l.entry_type === "void_reversal" ? `Voided sale ${l.reference ?? ""}` : `Repayment (${l.tender_type})`} · <b>{Number(l.amount) > 0 ? "+" : ""}{kes(l.amount)}</b> → {kes(l.balance_after)}
                  </li>))}
                  {ledger.data?.length === 0 && <li>No Deni history yet.</li>}
                </ul>
              </div>
            )}
          </li>
        ))}
        {list.data?.length === 0 && <li className="p-6 text-center text-muted-foreground">No customers yet.</li>}
      </ul>
    </AppShell>
  );
}
