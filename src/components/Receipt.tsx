import { kes } from "@/lib/tenant-guard";

// Optional, branch-chosen presentation only. Mandatory transaction, payment,
// tax, void and fiscal-status blocks below are always rendered regardless.
export type ReceiptSettings = {
  version?: number;
  display_name?: string | null; phone?: string | null; address?: string | null; footer?: string | null; logo_url?: string | null;
  show_logo?: boolean; show_phone?: boolean; show_address?: boolean; show_cashier?: boolean; show_footer?: boolean;
  show_business_name?: boolean; show_branch_name?: boolean;
  paper_width?: 58 | 80; auto_print?: boolean; copies?: number;
};

export type ReceiptData = {
  business: string; branch: string; receipt_no: string; created_at: string;
  lines: { product_name: string; qty: number; unit_price: number; discount: number; line_total: number; tax_class: string }[];
  tenders: { tender_type: string; amount: number; reference: string | null }[];
  subtotal: number; discount_total: number; tax_total: number; total: number; change_given: number;
  void?: { reason: string; voided_at: string } | null;
  returns?: { return_no: string; refund_amount: number; created_at: string }[] | undefined;
  kra_pin?: string | null | undefined;
  cashier?: string | null;
  settings?: ReceiptSettings | null;
  sample?: boolean;
};

const TL: Record<string, string> = { cash: "Cash", mpesa_manual: "M-Pesa", card: "Card", other: "Other", deni: "Deni" };

export function Receipt({ r, width }: { r: ReceiptData; width: 58 | 80 }) {
  const s = r.settings ?? {};
  const title = s.display_name?.trim() || r.business;
  return (
    <div className="receipt mx-auto bg-background p-3 font-mono text-xs text-foreground" style={{ width: width === 58 ? "58mm" : "80mm" }} data-width={width}>
      {r.sample && <p className="mb-1 border-2 border-foreground text-center font-bold">SAMPLE — NOT A SALE</p>}
      {s.show_logo && s.logo_url && <img src={s.logo_url} alt="" className="mx-auto mb-1 max-h-12" />}
      <p className="text-center text-sm font-bold">{title}</p>
      {/* Legal identity is always the Business's, never the branch trading name */}
      {s.show_business_name !== false && title !== r.business && <p className="text-center">{r.business}</p>}
      {r.kra_pin && <p className="text-center">PIN {r.kra_pin}</p>}
      {s.show_branch_name !== false && <p className="text-center">{r.branch}</p>}
      {s.show_address !== false && s.address && <p className="text-center">{s.address}</p>}
      {s.show_phone !== false && s.phone && <p className="text-center">Tel {s.phone}</p>}
      <p className="text-center">Receipt {r.receipt_no}</p>
      <p className="text-center">{new Date(r.created_at).toLocaleString()}</p>
      {s.show_cashier && r.cashier && <p className="text-center">Served by {r.cashier}</p>}
      {r.void && (
        <div className="my-1 border-2 border-destructive text-center font-bold text-destructive">
          <p className="text-base">*** VOIDED ***</p>
          <p>{new Date(r.void.voided_at).toLocaleString()}</p>
          <p>{r.void.reason}</p>
        </div>
      )}
      <hr className="my-1 border-dashed border-foreground" />
      {r.lines.map((l, i) => (
        <div key={i}>
          <p>{l.product_name}</p>
          <p className="flex justify-between"><span>{Number(l.qty)} × {Number(l.unit_price).toFixed(2)} [{l.tax_class}]</span><span>{Number(l.line_total).toFixed(2)}</span></p>
          {Number(l.discount) > 0 && <p className="flex justify-between"><span>  discount</span><span>-{Number(l.discount).toFixed(2)}</span></p>}
        </div>
      ))}
      <hr className="my-1 border-dashed border-foreground" />
      {Number(r.discount_total) > 0 && <p className="flex justify-between"><span>Discounts</span><span>-{Number(r.discount_total).toFixed(2)}</span></p>}
      <p className="flex justify-between font-bold"><span>TOTAL</span><span>{kes(r.total)}</span></p>
      <p className="flex justify-between"><span>incl. VAT</span><span>{Number(r.tax_total).toFixed(2)}</span></p>
      {r.tenders.map((t, i) => <p key={i} className="flex justify-between"><span>{TL[t.tender_type] ?? t.tender_type}{t.reference ? ` ${t.reference}` : ""}</span><span>{Number(t.amount).toFixed(2)}</span></p>)}
      <p className="flex justify-between"><span>Change</span><span>{Number(r.change_given).toFixed(2)}</span></p>
      {r.tenders.some((t) => t.tender_type === "deni") && <p className="text-center font-bold">On credit (Deni) — balance owed</p>}
      {!!r.returns?.length && (
        <div className="my-1 border-2 border-foreground text-center">
          {r.returns.map((x) => <p key={x.return_no}>RETURN {x.return_no}: -{Number(x.refund_amount).toFixed(2)}</p>)}
        </div>
      )}
      <hr className="my-1 border-dashed border-foreground" />
      <p className="text-center">eTIMS: not submitted (eTIMS-ready, not KRA-certified)</p>
      <p className="text-center">RONIA receipt — not a KRA fiscal invoice</p>
      {s.show_footer !== false && s.footer && <p className="mt-1 whitespace-pre-line text-center">{s.footer}</p>}
    </div>
  );
}

export async function loadReceipt(supabase: typeof import("@/integrations/supabase/client").supabase, saleId: string): Promise<ReceiptData> {
  const { data: s, error } = await supabase.from("sales").select("*, branches(name, code), businesses(name, kra_pin)").eq("id", saleId).single();
  if (error) throw error;
  const [l, t, v, ret, cur] = await Promise.all([
    supabase.from("sale_lines").select("*").eq("sale_id", saleId).order("line_no"),
    supabase.from("sale_tenders").select("*").eq("sale_id", saleId),
    supabase.from("sale_voids").select("reason,voided_at").eq("sale_id", saleId).maybeSingle(),
    supabase.from("sale_returns").select("return_no,refund_amount,created_at").eq("sale_id", saleId).order("created_at"),
    s.receipt_snapshot ? Promise.resolve({ data: null }) : supabase.from("branch_receipt_settings").select("*").eq("branch_id", s.branch_id).maybeSingle(),
  ]);
  const sx = s as typeof s & { branches: { name: string; code: string }; businesses: { name: string; kra_pin: string | null } };
  // Reprints use the settings frozen at sale time; older sales fall back to current branch settings.
  const settings = (s.receipt_snapshot ?? cur.data ?? null) as ReceiptSettings | null;
  return {
    business: sx.businesses.name, kra_pin: sx.businesses.kra_pin, branch: `${sx.branches.name} (${sx.branches.code})`, receipt_no: s.receipt_no, created_at: s.created_at,
    lines: (l.data ?? []) as ReceiptData["lines"], tenders: (t.data ?? []) as ReceiptData["tenders"],
    subtotal: s.subtotal, discount_total: s.discount_total, tax_total: s.tax_total, total: s.total, change_given: s.change_given,
    void: v.data ?? null, returns: (ret.data ?? []) as ReceiptData["returns"], settings,
  };
}

export const branchReceiptSettingsQuery = (supabase: typeof import("@/integrations/supabase/client").supabase, branch: string) => ({
  queryKey: ["receipt-settings", branch],
  queryFn: async () => {
    const { data, error } = await supabase.from("branch_receipt_settings").select("*").eq("branch_id", branch).maybeSingle();
    if (error) throw error;
    return data as (ReceiptSettings & { branch_id: string }) | null;
  },
});
