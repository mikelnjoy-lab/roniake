import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { kes } from "@/lib/tenant-guard";
import { eatToday, fmtEat } from "@/lib/eat";

// Manual loans/debts that did NOT come from a POS sale. They never create sales,
// revenue, stock movements or COGS; POS Deni stays in customers.balance / customer_ledger.
const TYPES: Record<string, string> = { cash_loan: "Cash loan", salary_advance: "Salary advance", goods_outside_pos: "Goods given outside till", other: "Other" };
type Debt = { id: string; customer_id: string; customer_name: string; debt_type: string; principal: number; paid: number; outstanding: number;
  incurred_on: string; due_on: string | null; reason: string; reference: string | null; notes: string | null; recorded_by_email: string | null; created_at: string; status: string };
type Customer = { id: string; name: string; phone: string | null; balance: number };

export function ManualDebtBook({ businessId, customers, manage }: { businessId: string; customers: Customer[]; manage: boolean }) {
  const qc = useQueryClient();
  const reg = useQuery({
    queryKey: ["manual-debts", businessId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("manual_debt_register", { _business: businessId });
      if (error) throw error;
      return (data ?? []) as Debt[];
    },
  });
  const [view, setView] = useState<"open" | "overdue" | "settled" | "all" | "people">("open");
  const [person, setPerson] = useState<string | null>(null);
  const [repayFor, setRepayFor] = useState<string | null>(null);
  const today = eatToday();
  const blank = { customer: "", type: "cash_loan", amount: "", incurred: today, due: "", reason: "", reference: "", notes: "" };
  const [f, setF] = useState(blank);
  const [ref, setRef] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["manual-debts"] }); qc.invalidateQueries({ queryKey: ["manual-statement"] }); };

  const debts = reg.data ?? [];
  const shown = view === "all" || view === "people" ? debts : view === "open" ? debts.filter((d) => d.status !== "settled") : debts.filter((d) => d.status === view);
  const people = useMemo(() => customers.map((c) => {
    const loans = debts.filter((d) => d.customer_id === c.id).reduce((a, d) => a + Number(d.outstanding), 0);
    return { ...c, loans, pos: Number(c.balance), combined: Number(c.balance) + loans };
  }).filter((p) => p.loans > 0 || p.pos > 0), [customers, debts]);
  const totLoans = debts.reduce((a, d) => a + Number(d.outstanding), 0);
  const totOverdue = debts.filter((d) => d.status === "overdue").reduce((a, d) => a + Number(d.outstanding), 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!f.customer) { toast.error("Choose the person"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("record_manual_debt", {
      _customer: f.customer, _type: f.type, _principal: Number(f.amount), _incurred_on: f.incurred,
      _due_on: (f.due || null) as string, _reason: f.reason, _reference: f.reference, _notes: f.notes, _client_ref: ref,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success((data as { status: string }).status === "replay" ? "Already recorded" : "Loan recorded");
    setF(blank); setRef(crypto.randomUUID()); refresh();
  }

  return (
    <section className="mt-8">
      <h2 className="text-2xl font-black">Loans & other debts (not from the till)</h2>
      <p className="font-bold">Outstanding {kes(totLoans)}{totOverdue > 0 && <span className="text-destructive"> · overdue {kes(totOverdue)}</span>}</p>
      <p className="text-sm">These are kept separate from till Deni. They are not sales: no stock, profit or sales totals change.</p>

      {manage && (
        <form onSubmit={create} className="mt-3 grid gap-3 rounded-xl border-4 border-foreground bg-card p-4 sm:grid-cols-2">
          <div><Label>Person</Label>
            <select required value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} className="h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg">
              <option value="">Choose… (add new people above)</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
            </select></div>
          <div><Label>Type</Label>
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="h-12 w-full rounded-md border-2 border-input bg-background px-3 text-lg">
              {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><Label>Amount (KES)</Label><Input required type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Loan date</Label><Input required type="date" max={today} value={f.incurred} onChange={(e) => setF({ ...f, incurred: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Due date (optional)</Label><Input type="date" min={f.incurred} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Reason</Label><Input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Reference (optional)</Label><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className="h-12 text-lg" /></div>
          <div><Label>Notes (optional)</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="h-12 text-lg" /></div>
          <Button disabled={busy} size="lg" className="h-14 text-lg font-black sm:col-span-2">{busy ? "Saving…" : "Record loan"}</Button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {([["open", "Open"], ["overdue", "Overdue"], ["settled", "Paid off"], ["all", "All"], ["people", "By person"]] as const).map(([k, l]) => (
          <Button key={k} variant={view === k ? "default" : "outline"} className="h-11 border-2 font-bold" onClick={() => setView(k)}>{l}</Button>
        ))}
      </div>
      {reg.error && <p className="mt-2 font-bold text-destructive">{(reg.error as Error).message}</p>}

      {view === "people" ? (
        <ul className="mt-3 space-y-2">{people.map((p) => (
          <li key={p.id} className="rounded-xl border-2 border-foreground bg-card p-3">
            <button className="flex w-full justify-between text-left" onClick={() => setPerson(person === p.id ? null : p.id)}>
              <span><b className="text-lg">{p.name}</b><span className="block text-sm">Till Deni {kes(p.pos)} · Loans {kes(p.loans)}</span></span>
              <span className="text-xl font-black">{kes(p.combined)}</span>
            </button>
            {person === p.id && <Statement customerId={p.id} debts={debts.filter((d) => d.customer_id === p.id)} />}
          </li>))}
          {!people.length && <li className="p-4 text-center text-muted-foreground">Nobody owes anything.</li>}
        </ul>
      ) : (
        <ul className="mt-3 space-y-2">{shown.map((d) => (
          <li key={d.id} className="rounded-xl border-2 border-foreground bg-card p-3">
            <div className="flex justify-between gap-2">
              <span><b className="text-lg">{d.customer_name}</b> · {TYPES[d.debt_type]}
                <span className="block text-sm">{d.reason}{d.reference ? ` · ref ${d.reference}` : ""} · lent {d.incurred_on}{d.due_on ? ` · due ${d.due_on}` : ""} · by {d.recorded_by_email ?? "—"}</span>
                {d.notes && <span className="block text-sm italic">{d.notes}</span>}
                <span className="block text-sm">Lent {kes(d.principal)} · repaid {kes(d.paid)}</span></span>
              <span className="text-right"><span className={`block text-xl font-black ${d.status === "overdue" ? "text-destructive" : ""}`}>{kes(d.outstanding)}</span>
                <span className="text-sm font-bold uppercase">{d.status === "settled" ? "Paid off" : d.status}</span></span>
            </div>
            {manage && d.status !== "settled" && (repayFor === d.id
              ? <RepayForm debt={d} onDone={() => { setRepayFor(null); refresh(); }} />
              : <Button variant="outline" className="mt-2 border-2 font-bold" onClick={() => setRepayFor(d.id)}>Record repayment</Button>)}
          </li>))}
          {!shown.length && <li className="p-4 text-center text-muted-foreground">{reg.isLoading ? "Loading…" : "No loans here."}</li>}
        </ul>
      )}
    </section>
  );
}

function RepayForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const [p, setP] = useState({ amount: "", method: "cash" as "cash" | "mpesa_manual" | "card" | "other", ref: "", on: eatToday() });
  const [cref] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { data, error } = await supabase.rpc("record_manual_debt_repayment", { _debt: debt.id, _amount: Number(p.amount), _method: p.method, _reference: p.ref, _paid_on: p.on, _client_ref: cref });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const d = data as { status: string; outstanding?: number };
    toast.success(d.status === "replay" ? "Already recorded" : `Repayment saved · still owed ${kes(d.outstanding ?? 0)}`);
    onDone();
  }
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-5">
      <Input type="number" min="0.01" max={debt.outstanding} step="0.01" placeholder={`Max ${debt.outstanding}`} value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} className="h-12 text-lg" />
      <select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value as typeof p.method })} className="h-12 rounded-md border-2 border-input bg-background px-3 text-lg">
        <option value="cash">Cash</option><option value="mpesa_manual">M-Pesa</option><option value="card">Card</option><option value="other">Other</option>
      </select>
      <Input placeholder={p.method === "mpesa_manual" ? "M-Pesa code" : "Reference"} value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value.toUpperCase() })} className="h-12 text-lg uppercase" />
      <Input type="date" min={debt.incurred_on} max={eatToday()} value={p.on} onChange={(e) => setP({ ...p, on: e.target.value })} className="h-12 text-lg" />
      <Button disabled={busy} className="h-12 font-black" onClick={go}>{busy ? "Saving…" : "Save"}</Button>
    </div>
  );
}

function Statement({ customerId, debts }: { customerId: string; debts: Debt[] }) {
  const st = useQuery({
    queryKey: ["manual-statement", customerId],
    queryFn: async () => {
      const [pos, rep] = await Promise.all([
        supabase.from("customer_ledger").select("id,entry_type,amount,reference,tender_type,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100),
        supabase.from("manual_debt_repayments").select("id,debt_id,amount,method,reference,paid_on,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }),
      ]);
      return { pos: pos.data ?? [], rep: rep.data ?? [] };
    },
  });
  return (
    <div className="mt-3 grid gap-3 border-t-2 border-border pt-3 md:grid-cols-2">
      <div><p className="font-black">Till Deni (from sales)</p>
        <ul className="space-y-1 text-sm">{(st.data?.pos ?? []).map((l) => (
          <li key={l.id} className="rounded border border-border px-2 py-1">{fmtEat(l.created_at)} · {l.entry_type === "credit_sale" ? `Sale ${l.reference ?? ""}` : l.entry_type === "repayment" ? `Repayment (${l.tender_type})` : `${l.entry_type} ${l.reference ?? ""}`} · <b>{kes(l.amount)}</b></li>))}
          {!st.data?.pos.length && <li className="text-muted-foreground">None</li>}</ul></div>
      <div><p className="font-black">Loans</p>
        <ul className="space-y-1 text-sm">{debts.map((d) => (
          <li key={d.id} className="rounded border border-border px-2 py-1">
            <b>{d.incurred_on} · {TYPES[d.debt_type]} {kes(d.principal)}</b> — owed {kes(d.outstanding)}
            {(st.data?.rep ?? []).filter((r) => r.debt_id === d.id).map((r) => <span key={r.id} className="block">↳ {r.paid_on} repaid {kes(r.amount)} ({r.method}{r.reference ? ` ${r.reference}` : ""})</span>)}
          </li>))}
          {!debts.length && <li className="text-muted-foreground">None</li>}</ul></div>
    </div>
  );
}
