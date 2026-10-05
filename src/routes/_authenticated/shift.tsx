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
  const [result, setResult] = useState<Record<string, number | string> | null>(null);

  const openShift = async () => {
    const { error } = await supabase.rpc("open_shift", { _branch: branch, _float: Number(amt || 0) });
    if (error) return toast.error(error.message);
    setAmt(""); toast.success("Shift opened"); qc.invalidateQueries({ queryKey: ["my-shift"] });
  };
  const closeShift = async () => {
    if (!shift.data || amt === "") return toast.error("Enter the cash you counted");
    const { data, error } = await supabase.rpc("close_shift", { _shift: shift.data.id, _counted: Number(amt) });
    if (error) return toast.error(error.message);
    setResult(data as Record<string, number>); setAmt("");
    qc.invalidateQueries({ queryKey: ["my-shift"] }); qc.invalidateQueries({ queryKey: ["shifts"] });
  };

  return (
    <AppShell>
      <h1 className="text-3xl font-black">My shift</h1>
      {result && (
        <div className="mt-3 rounded-xl border-4 border-foreground bg-secondary p-4 text-secondary-foreground">
          <p className="text-xl font-black">Shift closed. You declared {kes(result.counted)}.</p>
          {"expected" in result && <p className="font-bold">Expected {kes(result.expected)} · Difference {kes(result.variance)}</p>}
        </div>
      )}
      {shift.isLoading ? <p className="mt-4">Loading…</p> : shift.data ? (
        <div className="mt-4 rounded-xl border-4 border-foreground bg-card p-4">
          <p className="text-lg font-bold">Open since {new Date(shift.data.opened_at).toLocaleString()}</p>
          <p>Opening float: {kes(shift.data.opening_float)}</p>
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
