import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Receipt, branchReceiptSettingsQuery, type ReceiptData, type ReceiptSettings } from "@/components/Receipt";
import { PrinterSetup } from "@/components/PrinterSetup";
import { supabase } from "@/integrations/supabase/client";
import { can, requireTenant } from "@/lib/tenant-guard";

export const Route = createFileRoute("/_authenticated/receipt-settings")({
  head: () => ({ meta: [
    { title: "Receipt settings — RONIA Business" },
    { name: "description", content: "Set up this branch's receipt: name, contacts, footer and paper size." },
    { property: "og:title", content: "Receipt settings — RONIA Business" },
    { property: "og:description", content: "Branch-specific receipt setup." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: requireTenant,
  component: ReceiptSettingsPage,
});

const TOGGLES: [keyof ReceiptSettings, string][] = [
  ["show_business_name", "Show registered business name"], ["show_branch_name", "Show branch name & code"],
  ["show_address", "Show address"], ["show_phone", "Show phone"], ["show_footer", "Show footer"], ["show_cashier", "Show cashier name"], ["show_logo", "Show logo"],
];

function ReceiptSettingsPage() {
  const { tenant } = Route.useRouteContext();
  const branch = tenant.branch_id!;
  const qc = useQueryClient();
  const canEdit = can(tenant.permissions, "branch.manage");
  const q = useQuery(branchReceiptSettingsQuery(supabase, branch));
  const meta = useQuery({
    queryKey: ["branch-meta", branch],
    queryFn: async () => (await supabase.from("branches").select("name, code, businesses(name, kra_pin)").eq("id", branch).single()).data,
  });
  const [f, setF] = useState<ReceiptSettings>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);

  const set = (k: keyof ReceiptSettings, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const width = (f.paper_width ?? 80) as 58 | 80;
  const biz = meta.data?.businesses as unknown as { name: string; kra_pin: string | null } | undefined;

  const sample: ReceiptData = {
    sample: true, business: biz?.name ?? "Business", kra_pin: biz?.kra_pin, branch: meta.data ? `${meta.data.name} (${meta.data.code})` : "Branch",
    receipt_no: "SAMPLE-0001", created_at: new Date().toISOString(), cashier: "Cashier name",
    lines: [{ product_name: "Sample item", qty: 2, unit_price: 100, discount: 0, line_total: 200, tax_class: "A" }],
    tenders: [{ tender_type: "cash", amount: 100, reference: null }, { tender_type: "mpesa_manual", amount: 100, reference: "SAMPLE" }],
    subtotal: 200, discount_total: 0, tax_total: 27.59, total: 200, change_given: 0, settings: f,
  };

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("save_branch_receipt_settings", { _branch: branch, _s: f as never });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved for this branch only. Past receipts keep their original look.");
    qc.invalidateQueries({ queryKey: ["receipt-settings", branch] });
  }

  return (
    <AppShell wide>
      <h1 className="text-3xl font-black">Receipt settings</h1>
      <p className="font-bold">Branch: {meta.data?.name ?? "…"} — changes apply only to this branch.</p>
      {!canEdit && <p className="mt-2 rounded-lg border-4 border-destructive p-2 font-bold">View only. Ask an Owner or Manager to change these settings.</p>}
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <fieldset disabled={!canEdit || busy} className="space-y-3">
          {([["display_name", "Name on receipt"], ["phone", "Phone"], ["address", "Address"], ["logo_url", "Logo link (https://…)"]] as const).map(([k, l]) => (
            <div key={k}><Label htmlFor={k} className="font-bold">{l}</Label>
              <Input id={k} className="h-12 text-lg" value={(f[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} /></div>
          ))}
          <div><Label htmlFor="footer" className="font-bold">Footer message</Label>
            <textarea id="footer" maxLength={300} className="min-h-24 w-full rounded-md border-2 border-input bg-background p-2 text-lg" value={f.footer ?? ""} onChange={(e) => set("footer", e.target.value)} /></div>
          <div className="flex gap-2">
            {[58, 80].map((w) => <Button key={w} type="button" size="lg" variant={width === w ? "default" : "outline"} onClick={() => set("paper_width", w)}>{w}mm paper</Button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[...TOGGLES, ["auto_print", "Open print after sale"] as [keyof ReceiptSettings, string]].map(([k, l]) => (
              <label key={k} className="flex min-h-12 items-center gap-2 rounded-md border-2 border-foreground px-3 font-bold">
                <input type="checkbox" className="size-5" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} />{l}
              </label>
            ))}
          </div>
          <p className="text-sm">Totals, VAT, payments, receipt number, voids, returns and the eTIMS notice always print and cannot be hidden. The legal business name and KRA PIN always come from the Business.</p>
          {canEdit && <Button size="lg" className="h-14 w-full text-lg font-black" onClick={save}>Save receipt settings</Button>}
        </fieldset>
        <div>
          <p className="mb-2 rounded-md bg-secondary p-2 font-bold text-secondary-foreground">Preview only (simulated on screen). It does not prove your printer works.</p>
          <div className="border-2 border-foreground"><Receipt r={sample} width={width} /></div>
          <p className="mt-1 text-sm">A test is only successful if a paper receipt actually comes out of your printer and looks right.</p>
          <div className="mt-3 print:hidden"><PrinterSetup sample={sample} width={width} /></div>
        </div>
      </div>
    </AppShell>
  );
}
