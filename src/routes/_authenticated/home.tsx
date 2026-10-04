import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { getSelection, resolveContext, ROLE_LABEL, setSelection } from "@/lib/tenant";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({ meta: [{ title: "Home — RONIA Business" }, { name: "description", content: "Your active business and branch." }] }),
  beforeLoad: async () => {
    const sel = getSelection();
    if (!sel) throw redirect({ to: "/select" });
    try {
      // Server decides access; a revoked/suspended member or foreign branch is rejected here.
      return { tenant: await resolveContext(sel) };
    } catch {
      setSelection(null);
      throw redirect({ to: "/unauthorized" });
    }
  },
  component: Home,
});

function Home() {
  const { tenant } = Route.useRouteContext();
  const names = useQuery({
    queryKey: ["ctx-names", tenant.business_id, tenant.branch_id],
    queryFn: async () => {
      const [b, br] = await Promise.all([
        supabase.from("businesses").select("name").eq("id", tenant.business_id).single(),
        tenant.branch_id ? supabase.from("branches").select("name, code").eq("id", tenant.branch_id).single() : Promise.resolve({ data: null }),
      ]);
      return { business: b.data?.name, branch: br.data };
    },
  });

  return (
    <AppShell>
      <div className="rounded-xl border-4 border-foreground bg-secondary p-5 text-secondary-foreground">
        <p className="text-sm font-bold uppercase tracking-widest">Working in</p>
        <h1 className="text-3xl font-black">{names.data?.business ?? "…"}</h1>
        <p className="text-xl font-bold">{names.data?.branch ? `${names.data.branch.name} · ${names.data.branch.code}` : ""}</p>
        <p className="mt-3 inline-block rounded-md bg-foreground px-3 py-1 font-black text-background">{ROLE_LABEL[tenant.role]}</p>
        {tenant.lifecycle_state !== "active" && (
          <p className="mt-3 font-semibold">Business status: {tenant.lifecycle_state === "setup" ? "Setting up" : tenant.lifecycle_state}</p>
        )}
      </div>
      <Button asChild variant="outline" size="lg" className="mt-4 h-14 w-full border-2 text-lg font-bold">
        <Link to="/select">Switch business or branch</Link>
      </Button>
      <h2 className="mt-6 mb-2 text-xl font-black">What you can do here</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tenant.permissions.map((p) => (
          <li key={p} className="rounded-lg border-2 border-foreground bg-card px-3 py-2 font-semibold">{p}</li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">Till, shifts and back office open in the next steps.</p>
    </AppShell>
  );
}
