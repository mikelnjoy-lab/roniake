import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignOut } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kes } from "@/lib/tenant-guard";

// Platform owners are checked on the server for every action; this gate only decides what to show.
export const Route = createFileRoute("/_authenticated/platform")({
  head: () => ({ meta: [
    { title: "RONIA Platform Admin" },
    { name: "description", content: "RONIA platform owner area: subscription plans, merchants and audit." },
    { property: "og:title", content: "RONIA Platform Admin" },
    { property: "og:description", content: "Manage RONIA subscription plans and merchant subscriptions." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.rpc("is_platform_owner");
    if (error || !data) throw redirect({ to: "/unauthorized" });
  },
  component: PlatformPage,
});

const FEATURES = [
  ["deni", "Deni (credit)"], ["mpesa", "M-Pesa"], ["etims", "eTIMS"], ["purchasing", "Purchasing"], ["reports_export", "Report exports"],
] as const;
const PERIOD: Record<string, string> = { month: "per month", quarter: "per quarter", year: "per year" };
const box = "rounded-lg border-4 border-foreground bg-card p-4";
const sel = "h-12 w-full rounded-md border-2 border-foreground bg-background px-3 text-base font-bold";
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Something went wrong");

type Tab = "plans" | "businesses" | "owners" | "audit";

function PlatformPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const signOut = useSignOut();
  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-4 border-foreground bg-foreground px-4 py-3 text-background">
        <span className="flex items-center gap-2 text-xl font-black"><ShieldCheck /> RONIA PLATFORM</span>
        <div className="flex gap-2">
          <Button asChild variant="secondary" size="lg" className="font-bold"><Link to="/select">My shops</Link></Button>
          <Button variant="secondary" size="lg" onClick={signOut} className="font-bold"><LogOut /> Sign out</Button>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b-2 border-foreground bg-card px-2 py-2">
        {(["plans", "businesses", "owners", "audit"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-md px-4 py-2 text-base font-black ${tab === t ? "bg-foreground text-background" : ""}`}>
            {{ plans: "Plans", businesses: "Merchants", owners: "Owners & trial", audit: "Audit" }[t]}
          </button>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-6xl p-4">
        {tab === "plans" && <Plans />}
        {tab === "businesses" && <Businesses />}
        {tab === "owners" && <Owners />}
        {tab === "audit" && <Audit />}
      </main>
    </div>
  );
}

function usePlans() {
  return useQuery({ queryKey: ["pf-plans"], queryFn: async () => {
    const [p, v] = await Promise.all([
      supabase.from("subscription_plans").select("*").order("sort_order"),
      supabase.from("plan_versions").select("*").order("version_no", { ascending: false }),
    ]);
    if (p.error) throw p.error; if (v.error) throw v.error;
    return (p.data ?? []).map((plan) => ({ ...plan, versions: (v.data ?? []).filter((x) => x.plan_id === plan.id) }));
  } });
}

function Plans() {
  const plans = usePlans();
  const [openId, setOpenId] = useState<string | null>(null);
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const qc = useQueryClient();
  async function create() {
    const { data, error } = await supabase.rpc("platform_save_plan", { _id: null as unknown as string, _code: code, _name: name, _description: "" });
    if (error) { err(error); return; }
    toast.success("Plan created as draft"); setCode(""); setName(""); setOpenId(data as string);
    qc.invalidateQueries({ queryKey: ["pf-plans"] });
  }
  const open = plans.data?.find((p) => p.id === openId);
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-black">Subscription plans</h1>
      <p className="font-bold text-muted-foreground">Changes are saved as a draft, previewed, then published. Existing subscribers keep their price and limits until you move them. Editing a price never charges anyone.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {plans.data?.map((p) => {
          const cur = p.versions.find((v) => v.id === p.current_version_id);
          const draft = p.versions.find((v) => v.state === "draft");
          return (
            <button key={p.id} onClick={() => setOpenId(p.id)} className={`${box} text-left ${openId === p.id ? "bg-secondary text-secondary-foreground" : ""}`}>
              <div className="flex justify-between"><span className="text-xl font-black">{p.name}</span><span className="rounded bg-foreground px-2 text-sm font-black uppercase text-background">{p.status}</span></div>
              {cur ? <p className="text-lg font-black">{kes(cur.price_kes)} {PERIOD[cur.billing_period]}</p> : <p className="font-bold">Not published yet</p>}
              {cur && <p className="font-bold">{cur.max_branches} branch · {cur.max_terminals} till · {cur.max_staff} staff · v{cur.version_no}</p>}
              {draft && <p className="mt-1 font-black text-destructive">Unpublished draft v{draft.version_no}</p>}
            </button>
          );
        })}
      </div>
      <div className={`${box} grid gap-3 sm:grid-cols-3`}>
        <label className="font-bold">Short code<Input className="h-12" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. enterprise" /></label>
        <label className="font-bold">Plan name<Input className="h-12" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Enterprise" /></label>
        <Button size="lg" className="h-12 self-end font-black" onClick={create} disabled={!code || !name}>Create new plan</Button>
      </div>
      {open && <PlanEditor key={open.id} plan={open} />}
    </div>
  );
}

type PlanRow = NonNullable<ReturnType<typeof usePlans>["data"]>[number];
type Preview = { changes: { field: string; from: unknown; to: unknown }[]; current_subscribers: number; policy: string; from_version: number | null; to_version: number };

function PlanEditor({ plan }: { plan: PlanRow }) {
  const qc = useQueryClient();
  const cur = plan.versions.find((v) => v.id === plan.current_version_id);
  const draft = plan.versions.find((v) => v.state === "draft");
  const base = draft ?? cur;
  const [name, setName] = useState(plan.name);
  const [desc, setDesc] = useState(plan.description ?? "");
  const [price, setPrice] = useState(String(base?.price_kes ?? 0));
  const [period, setPeriod] = useState(base?.billing_period ?? "month");
  const [br, setBr] = useState(String(base?.max_branches ?? 1));
  const [ti, setTi] = useState(String(base?.max_terminals ?? 1));
  const [st, setSt] = useState(String(base?.max_staff ?? 1));
  const [feat, setFeat] = useState<Record<string, boolean>>((base?.features as Record<string, boolean>) ?? {});
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const archived = plan.status === "archived";
  const refresh = () => qc.invalidateQueries({ queryKey: ["pf-plans"] });
  useEffect(() => setPreview(null), [draft?.id]);

  async function call(fn: () => PromiseLike<{ error: unknown; data?: unknown }>, ok: string) {
    const { error, data } = await fn();
    if (error) { err(error); return null; }
    toast.success(ok); refresh(); return data ?? true;
  }
  const saveInfo = () => call(() => supabase.rpc("platform_save_plan", { _id: plan.id, _code: plan.code, _name: name, _description: desc }), "Plan details saved");
  const saveDraft = () => call(() => supabase.rpc("platform_save_plan_draft", { _plan: plan.id, _price: Number(price), _period: period, _branches: Number(br), _terminals: Number(ti), _staff: Number(st), _features: feat, _note: note }), "Draft saved — preview, then publish");
  async function doPreview() {
    const { data, error } = await supabase.rpc("platform_preview_plan", { _plan: plan.id });
    if (error) { err(error); return; } setPreview(data as unknown as Preview);
  }
  async function publish() {
    if (!confirm("Publish this version? New sign-ups get it now. Existing subscribers are not changed.")) return;
    if (await call(() => supabase.rpc("platform_publish_plan", { _plan: plan.id }), "Published")) setPreview(null);
  }
  const status = (s: string) => {
    if (s === "archived" && !confirm("Archive this plan? It can't be offered or edited again. Current subscribers keep it.")) return;
    call(() => supabase.rpc("platform_set_plan_status", { _plan: plan.id, _status: s }), `Plan ${s}`);
  };
  async function move() {
    if (!confirm("Move every subscriber of this plan to the latest published price and limits?")) return;
    const { data, error } = await supabase.rpc("platform_move_subscribers", { _plan: plan.id });
    if (error) { err(error); return; } toast.success(`${data} subscriber(s) moved`); refresh(); qc.invalidateQueries({ queryKey: ["pf-biz"] });
  }

  return (
    <section className={`${box} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-black">{plan.name} <span className="text-base">({plan.code})</span></h2>
        {!archived && (
          <div className="flex flex-wrap gap-2">
            {plan.status !== "active" && <Button size="lg" className="font-black" onClick={() => status("active")}>Activate</Button>}
            {plan.status === "active" && <Button size="lg" variant="secondary" className="font-black" onClick={() => status("inactive")}>Deactivate</Button>}
            <Button size="lg" variant="destructive" className="font-black" onClick={() => status("archived")}>Archive</Button>
          </div>
        )}
      </div>
      {archived ? <p className="font-black">Archived — kept for history. Existing subscribers stay on it.</p> : (<>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="font-bold">Name<Input className="h-12" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="font-bold sm:col-span-2">Description<Input className="h-12" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <Button variant="outline" size="lg" className="border-2 font-black sm:col-span-3" onClick={saveInfo}>Save name & description</Button>
        </div>
        <h3 className="text-xl font-black">{draft ? `Editing draft v${draft.version_no}` : "Change price, limits or features"}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="font-bold">Price (KES)<Input className="h-12 text-lg" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="font-bold">Billing period<select className={sel} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Yearly</option></select></label>
          <label className="font-bold">Change note<Input className="h-12" value={note} onChange={(e) => setNote(e.target.value)} placeholder="why it changed" /></label>
          <label className="font-bold">Branches<Input className="h-12 text-lg" type="number" min={1} value={br} onChange={(e) => setBr(e.target.value)} /></label>
          <label className="font-bold">Tills<Input className="h-12 text-lg" type="number" min={1} value={ti} onChange={(e) => setTi(e.target.value)} /></label>
          <label className="font-bold">Staff<Input className="h-12 text-lg" type="number" min={1} value={st} onChange={(e) => setSt(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-3">
          {FEATURES.map(([k, label]) => (
            <label key={k} className="flex h-12 items-center gap-2 rounded-md border-2 border-foreground px-3 font-bold">
              <input type="checkbox" className="size-5" checked={!!feat[k]} onChange={(e) => setFeat({ ...feat, [k]: e.target.checked })} />{label}
            </label>
          ))}
        </div>
        <p className="text-sm font-bold text-muted-foreground">Feature switches are recorded on the plan; the app does not yet hide features based on them.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button size="lg" className="h-14 font-black" onClick={saveDraft}>Save draft</Button>
          <Button size="lg" variant="secondary" className="h-14 font-black" disabled={!draft} onClick={doPreview}>Preview changes</Button>
          <Button size="lg" variant="outline" className="h-14 border-2 font-black" disabled={!draft} onClick={() => call(() => supabase.rpc("platform_discard_plan_draft", { _plan: plan.id }), "Draft discarded")}>Discard draft</Button>
        </div>
        {preview && (
          <div className="rounded-lg border-4 border-destructive p-4">
            <p className="text-lg font-black">Preview: v{preview.from_version ?? "—"} → v{preview.to_version}</p>
            <ul className="my-2 font-bold">{preview.changes.map((c) => <li key={c.field}>{c.field}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</li>)}</ul>
            <p className="font-bold">{preview.current_subscribers} current subscriber(s) — none change on publish.</p>
            <p className="text-sm font-bold">{preview.policy}</p>
            <Button size="lg" className="mt-3 h-14 w-full text-lg font-black" onClick={publish}>Publish v{preview.to_version}</Button>
          </div>
        )}
        {cur && <Button variant="outline" size="lg" className="border-2 font-black" onClick={move}>Move existing subscribers to v{cur.version_no}</Button>}
      </>)}
      <h3 className="text-xl font-black">Version history</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm font-bold">
          <thead><tr className="border-b-2 border-foreground"><th className="p-1">Ver</th><th>State</th><th>Price</th><th>Limits (br/till/staff)</th><th>Published</th><th>Note</th></tr></thead>
          <tbody>{plan.versions.map((v) => (
            <tr key={v.id} className="border-b"><td className="p-1">v{v.version_no}{v.id === plan.current_version_id ? " ★" : ""}</td><td>{v.state}</td><td>{kes(v.price_kes)} {PERIOD[v.billing_period]}</td>
              <td>{v.max_branches}/{v.max_terminals}/{v.max_staff}</td><td>{v.published_at ? new Date(v.published_at).toLocaleString() : "—"}</td><td>{v.change_note}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function Businesses() {
  const qc = useQueryClient();
  const plans = usePlans();
  const biz = useQuery({ queryKey: ["pf-biz"], queryFn: async () => {
    const { data, error } = await supabase.rpc("platform_list_businesses"); if (error) throw error; return data ?? [];
  } });
  const [pick, setPick] = useState<Record<string, string>>({});
  const active = (plans.data ?? []).filter((p) => p.status === "active");
  async function assign(id: string, name: string) {
    const plan = pick[id]; if (!plan) { toast.error("Choose a plan"); return; }
    const p = active.find((x) => x.id === plan);
    if (!confirm(`Put ${name} on ${p?.name}? No payment is taken by RONIA here.`)) return;
    const { error } = await supabase.rpc("platform_assign_plan", { _business: id, _plan: plan, _note: "" });
    if (error) { err(error); return; } toast.success("Plan assigned"); qc.invalidateQueries({ queryKey: ["pf-biz"] });
  }
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-black">Merchants</h1>
      <p className="font-bold text-muted-foreground">Plan and usage only. You cannot see any merchant's sales, stock or customers from here.</p>
      {biz.data?.map((b) => {
        const over = b.branches > b.max_branches || b.staff > b.max_staff || b.terminals > b.max_terminals;
        return (
          <div key={b.business_id} className={box}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-xl font-black">{b.name}</span>
              <span className="font-black uppercase">{b.plan_name ?? "Trial"} · {b.status}{b.version_no && b.current_version_no && b.version_no < b.current_version_no ? ` · on v${b.version_no} (latest v${b.current_version_no})` : ""}</span>
            </div>
            <p className="font-bold">Branches {b.branches}/{b.max_branches} · Tills {b.terminals}/{b.max_terminals} · Staff {b.staff}/{b.max_staff}{over && <span className="text-destructive"> · over limit</span>}</p>
            <p className="text-sm font-bold">{b.price_kes != null ? kes(b.price_kes) : "No price"} · {b.status === "trial" ? (b.trial_ends_at ? `trial ends ${new Date(b.trial_ends_at).toLocaleDateString()}` : "pilot trial, no end date") : ""}</p>
            <div className="mt-2 flex gap-2">
              <select className={sel} value={pick[b.business_id] ?? ""} onChange={(e) => setPick({ ...pick, [b.business_id]: e.target.value })}>
                <option value="">Choose plan…</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Button size="lg" className="h-12 font-black" onClick={() => assign(b.business_id, b.name)}>Assign</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Owners() {
  const qc = useQueryClient();
  const owners = useQuery({ queryKey: ["pf-owners"], queryFn: async () => { const { data, error } = await supabase.rpc("platform_list_owners"); if (error) throw error; return data ?? []; } });
  const trial = useQuery({ queryKey: ["pf-trial"], queryFn: async () => (await supabase.from("platform_settings").select("value").eq("key", "trial_days").maybeSingle()).data?.value as number | undefined });
  const [email, setEmail] = useState(""); const [days, setDays] = useState("");
  async function grant() {
    if (!confirm(`Give ${email} full RONIA platform owner access?`)) return;
    const { error } = await supabase.rpc("platform_grant_owner", { _email: email, _note: "added from admin area" });
    if (error) { err(error); return; } toast.success("Platform owner added"); setEmail(""); qc.invalidateQueries({ queryKey: ["pf-owners"] });
  }
  async function revoke(id: string) {
    if (!confirm("Remove this platform owner?")) return;
    const { error } = await supabase.rpc("platform_revoke_owner", { _user: id });
    if (error) { err(error); return; } toast.success("Removed"); qc.invalidateQueries({ queryKey: ["pf-owners"] });
  }
  async function saveTrial() {
    const { error } = await supabase.rpc("platform_set_trial_days", { _days: Number(days) });
    if (error) { err(error); return; } toast.success("Trial length saved for new sign-ups"); setDays(""); qc.invalidateQueries({ queryKey: ["pf-trial"] });
  }
  return (
    <div className="space-y-4">
      <section className={box}>
        <h2 className="mb-2 text-2xl font-black">Platform owners</h2>
        <ul className="mb-3 space-y-1">{owners.data?.map((o) => (
          <li key={o.user_id} className="flex items-center justify-between border-b py-1 font-bold">
            <span>{o.email} {o.revoked_at ? `(removed ${new Date(o.revoked_at).toLocaleDateString()})` : ""}</span>
            {!o.revoked_at && <Button variant="destructive" onClick={() => revoke(o.user_id)}>Remove</Button>}
          </li>
        ))}</ul>
        <div className="flex gap-2">
          <Input className="h-12" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email of an existing RONIA account" />
          <Button size="lg" className="h-12 font-black" disabled={!email} onClick={grant}>Add owner</Button>
        </div>
      </section>
      <section className={box}>
        <h2 className="mb-2 text-2xl font-black">Free trial</h2>
        <p className="font-bold">New businesses get a {trial.data ?? "…"}-day full-feature trial. Changing this does not alter trials already running.</p>
        <div className="mt-2 flex gap-2">
          <Input className="h-12" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} placeholder="days" />
          <Button size="lg" className="h-12 font-black" disabled={!days} onClick={saveTrial}>Save</Button>
        </div>
      </section>
    </div>
  );
}

function Audit() {
  const log = useQuery({ queryKey: ["pf-audit"], queryFn: async () => (await supabase.from("platform_audit_log").select("*").order("created_at", { ascending: false }).limit(200)).data ?? [] });
  return (
    <div className={box}>
      <h1 className="mb-2 text-3xl font-black">Platform audit</h1>
      <ul className="space-y-1 text-sm">{log.data?.map((a) => (
        <li key={a.id} className="border-b py-1 font-bold">{new Date(a.created_at).toLocaleString()} · {a.action} · {a.entity_type} {a.entity_id?.slice(0, 8)} <span className="break-all font-normal">{JSON.stringify(a.payload)}</span></li>
      ))}</ul>
    </div>
  );
}
