import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Store, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL, resolveContext, setSelection, type TenantContext } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/select")({
  head: () => ({ meta: [{ title: "Choose business — RONIA Business" }, { name: "description", content: "Pick your business and branch." }] }),
  component: SelectPage,
});

type Membership = { business_id: string; role: TenantContext["role"]; businesses: { name: string; lifecycle_state: string } | null };

function SelectPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [businessId, setBusinessId] = useState<string | null>(null);

  // RLS returns only this user's own memberships; status filter keeps suspended/revoked out.
  const memberships = useQuery({
    queryKey: ["my-memberships"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("business_memberships")
        .select("business_id, role, businesses(name, lifecycle_state)")
        .eq("user_id", u.user!.id)
        .eq("status", "active");
      if (error) throw error;
      return data as unknown as Membership[];
    },
  });

  const branches = useQuery({
    queryKey: ["branches", businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, code")
        .eq("business_id", businessId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (memberships.data?.length === 1 && !businessId) setBusinessId(memberships.data[0]!.business_id);
  }, [memberships.data, businessId]);

  async function enter(branchId: string) {
    try {
      const ctx = await resolveContext({ businessId: businessId!, branchId });
      setSelection({ businessId: ctx.business_id, branchId: ctx.branch_id });
      navigate({ to: "/home" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Access denied");
    }
  }

  if (memberships.isLoading) return <AppShell><p className="text-lg font-bold">Loading…</p></AppShell>;
  if (memberships.error) return <AppShell><p className="font-bold text-destructive">Could not load your businesses.</p></AppShell>;

  const list = memberships.data ?? [];

  if (list.length === 0) {
    return (
      <AppShell>
        <CreateBusiness onCreated={(id) => { qc.invalidateQueries({ queryKey: ["my-memberships"] }); setBusinessId(id); }} />
      </AppShell>
    );
  }

  if (!businessId) {
    return (
      <AppShell>
        <h1 className="mb-4 text-3xl font-black">Choose business</h1>
        <div className="flex flex-col gap-3">
          {list.map((m) => (
            <BigRow key={m.business_id} icon={<Store />} title={m.businesses?.name ?? "Business"} sub={ROLE_LABEL[m.role]} onClick={() => setBusinessId(m.business_id)} />
          ))}
        </div>
      </AppShell>
    );
  }

  const biz = list.find((m) => m.business_id === businessId);
  return (
    <AppShell>
      {list.length > 1 && (
        <button className="mb-2 font-bold underline" onClick={() => setBusinessId(null)}>← All businesses</button>
      )}
      <h1 className="text-3xl font-black">{biz?.businesses?.name}</h1>
      <p className="mb-4 text-lg font-semibold text-muted-foreground">Choose your branch</p>
      {branches.isLoading && <p className="font-bold">Loading branches…</p>}
      {branches.data?.length === 0 && (
        <p className="rounded-lg border-2 border-foreground bg-secondary p-4 font-bold">
          You are not assigned to any branch yet. Ask your manager to add you.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {branches.data?.map((b) => (
          <BigRow key={b.id} icon={<MapPin />} title={b.name} sub={b.code} onClick={() => enter(b.id)} />
        ))}
      </div>
    </AppShell>
  );
}

function BigRow({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-20 items-center gap-4 rounded-xl border-4 border-foreground bg-card p-4 text-left shadow-[4px_4px_0_0_var(--foreground)] active:translate-x-1 active:translate-y-1 active:shadow-none">
      <span className="rounded-lg bg-secondary p-3 text-secondary-foreground">{icon}</span>
      <span className="flex-1">
        <span className="block text-xl font-black">{title}</span>
        <span className="block font-semibold text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="size-8" />
    </button>
  );
}

function CreateBusiness({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("Main");
  const [code, setCode] = useState("MAIN");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_business", { _name: name, _branch_name: branch, _branch_code: code });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    onCreated(data as string);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-3xl font-black">Set up your business</h1>
      <p className="font-semibold text-muted-foreground">You'll be the Owner. You can add branches and staff later.</p>
      <div className="flex flex-col gap-2"><Label className="font-bold">Business name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} className="h-14 border-2 text-lg" /></div>
      <div className="flex flex-col gap-2"><Label className="font-bold">First branch name</Label><Input required value={branch} onChange={(e) => setBranch(e.target.value)} className="h-14 border-2 text-lg" /></div>
      <div className="flex flex-col gap-2"><Label className="font-bold">Branch code (on receipts)</Label><Input required maxLength={8} pattern="[A-Za-z0-9]+" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="h-14 border-2 text-lg uppercase" /></div>
      <Button type="submit" disabled={busy} size="lg" className="h-16 text-xl font-black">Create business</Button>
    </form>
  );
}
