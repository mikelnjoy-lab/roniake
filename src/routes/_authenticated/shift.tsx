import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { can, kes, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/shift")({
  head: () => ({ meta: [{ title: "Shift — RONIA Business" }, { name: "description", content: "Open and close your till shift." }] }),
  beforeLoad: requireTenant,
  component: Shift,
});

type Open = { id: string; opened_at: string; opening_float: number } | null;
export const shiftQuery = (branch: string) => ({
  queryKey: ["my-shift", branch],
  queryFn: async (): Promise<Open> => {
    const { data, error } = await supabase.rpc("my_open_shift", { _branch: branch });
    if (error) throw error;
    return (data as Open) ?? null;
  },
});

function Shift() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const qc = useQueryClient();
  const shift = useQuery(shiftQuery(branch));
  const reviewer = can(tenant.permissions, "shift.view_expected");
  const history = useQuery({
    queryKey: ["shifts", branch], enabled: reviewer,
    queryFn: async () => (await supabase.from("shifts").select("*").eq("branch_id", branch).order("opened_at", { ascending: false }).limit(20)).data ?? [],
  });
  const [amt, setAmt] = useState("");
  const [result, setResult] = useState<{ counted: number; expected?: number; variance?: number } | null>(null);

  const openShift = async () => {
    const { error } = await supabase.rpc("open_shift", { _branch: branch, _float: Number(amt || 0) });
    if (error) { toast.error(error.message); return; }
    setAmt(""); toast.success("Shift opened"); qc.invalidateQueries({ queryKey: ["my-shift"] });
  };
  const closeShift = async () => {
    if (!shift.data || amt === "") { toast.error("Enter the cash you counted"); return; }
    const { data, error } = await supabase.rpc("close_shift", { _shift: shift.data.id, _counted: Number(amt) });
    if (error) { toast.error(error.message); return; }
    setResult(data as { counted: number; expected?: number; variance?: number }); setAmt("");
    qc.invalidateQueries({ queryKey: ["my-shift"] }); qc.invalidateQueries({ queryKey: ["shifts"] });
  };

  return (
    <AppShell>
      <h1 className="text-3xl font-black">My shift</h1>
      {result && (
        <div className="mt-3 rounded-xl border-4 border-foreground bg-secondary p-4 text-secondary-foreground">
          <p className="text-xl font-black">Shift closed. You declared {kes(result.counted)}.</p>
          {result.expected !== undefined && <p className="font-bold">Expected {kes(result.expected)} · Difference {kes(result.variance)}</p>}
        </div>
      )}
      {shift.isLoading ? <p className="mt-4">Loading…</p> : shift.data ? (
        <div className="mt-4 rounded-xl border-4 border-foreground bg-card p-4">
          <p className="text-lg font-bold">Open since {new Date(shift.data.opened_at).toLocaleString()}</p>
          <p>Opening float: {kes(shift.data.opening_float)}</p>
          <Payouts shiftId={shift.data.id} />
          <h2 className="mt-4 text-xl font-black">Close shift — count your cash</h2>
          <p className="text-sm text-muted-foreground">Count the drawer and enter the total. The expected amount is not shown to cashiers.</p>
          <Input type="number" step="0.01" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Cash counted" className="mt-2 h-14 text-2xl" />
          <Button size="lg" variant="destructive" onClick={closeShift} className="mt-3 h-14 w-full text-lg font-black">Close shift</Button>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border-4 border-foreground bg-card p-4">
          <h2 className="text-xl font-black">Open a shift</h2>
          <Input type="number" step="0.01" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Opening cash float" className="mt-2 h-14 text-2xl" />
          <Button size="lg" onClick={openShift} className="mt-3 h-14 w-full text-lg font-black">Open shift</Button>
        </div>
      )}
      {reviewer && (
        <>
          <h2 className="mt-6 text-xl font-black">Branch shifts</h2>
          <ul className="mt-2 space-y-1">{(history.data ?? []).map((s) => (
            <li key={s.id} className="rounded-lg border-2 border-border bg-card px-3 py-2 text-sm">
              <b>{new Date(s.opened_at).toLocaleString()}</b> · {s.status}
              {s.status === "closed" && <> · counted {kes(s.counted_cash)} · expected {kes(s.expected_cash)} · <span className={Number(s.variance) < 0 ? "font-black text-destructive" : "font-black"}>diff {kes(s.variance)}</span></>}
            </li>))}</ul>
        </>
      )}
    </AppShell>
  );
}

const CATS = [
  ["supplies", "Supplies"], ["transport", "Transport"], ["cleaning", "Cleaning"],
  ["staff_meal", "Staff meal"], ["supplier_payment", "Supplier payment"], ["other", "Other"],
] as const;

function Payouts({ shiftId }: { shiftId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["payouts", shiftId],
    queryFn: async () => {
      const { data, error } = await supabase.from("shift_payouts").select("id, amount, category, reason, created_at").eq("shift_id", shiftId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState<string>("supplies");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const a = Number(amount);
    if (!(a > 0)) { toast.error("Enter the amount taken out"); return; }
    if (reason.trim().length < 3) { toast.error("Say what the cash was for"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("record_shift_payout", { _shift: shiftId, _amount: a, _category: cat, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setAmount(""); setReason(""); toast.success("Cash out recorded");
    qc.invalidateQueries({ queryKey: ["payouts", shiftId] });
  };
  const total = (list.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  return (
    <div className="mt-4 rounded-xl border-2 border-border p-3">
      <h2 className="text-xl font-black">Cash taken out of the drawer</h2>
      <p className="text-sm text-muted-foreground">Record every shilling paid out (petty cash) so your shift balances. It cannot be changed later.</p>
      <div className="mt-2 grid grid-cols-3 gap-2">{CATS.map(([v, l]) => (
        <Button key={v} type="button" variant={cat === v ? "default" : "outline"} onClick={() => setCat(v)} className="h-12 font-bold">{l}</Button>
      ))}</div>
      <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (KES)" className="mt-2 h-12 text-xl" />
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was it for?" maxLength={200} className="mt-2 h-12" />
      <Button size="lg" onClick={save} disabled={busy} className="mt-2 h-12 w-full font-black">Record cash out</Button>
      {(list.data ?? []).length > 0 && (
        <ul className="mt-3 space-y-1">
          {(list.data ?? []).map((p) => (
            <li key={p.id} className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span>{CATS.find((c) => c[0] === p.category)?.[1]} — {p.reason}</span><b>{kes(p.amount)}</b>
            </li>
          ))}
          <li className="flex justify-between px-3 text-sm font-black"><span>Total taken out</span><span>{kes(total)}</span></li>
        </ul>
      )}
    </div>
  );
}
