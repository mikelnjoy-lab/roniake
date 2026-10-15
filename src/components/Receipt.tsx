import { kes } from "@/lib/tenant-guard";

export type ReceiptData = {
  business: string; branch: string; receipt_no: string; created_at: string;
  lines: { product_name: string; qty: number; unit_price: number; discount: number; line_total: number; tax_class: string }[];
  tenders: { tender_type: string; amount: number; reference: string | null }[];
  subtotal: number; discount_total: number; tax_total: number; total: number; change_given: number;
  void?: { reason: string; voided_at: string } | null;
};

const TL: Record<string, string> = { cash: "Cash", mpesa_manual: "M-Pesa", card: "Card", other: "Other", deni: "Deni" };

// Renders only data returned by the server for a completed sale.
export function Receipt({ r, width }: { r: ReceiptData; width: 58 | 80 }) {
  return (
    <div className="receipt mx-auto bg-background p-3 font-mono text-xs text-foreground" style={{ width: width === 58 ? "58mm" : "80mm" }}>
      <p className="text-center text-sm font-bold">{r.business}</p>
      <p className="text-center">{r.branch}</p>
      <p className="text-center">Receipt {r.receipt_no}</p>
      <p className="text-center">{new Date(r.created_at).toLocaleString()}</p>
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
      <p className="flex justify-between font-bold"><span>TOTAL</span><span>{kes(r.total)}</span></p>
      <p className="flex justify-between"><span>incl. VAT</span><span>{Number(r.tax_total).toFixed(2)}</span></p>
      {r.tenders.map((t, i) => <p key={i} className="flex justify-between"><span>{TL[t.tender_type]}{t.reference ? ` ${t.reference}` : ""}</span><span>{Number(t.amount).toFixed(2)}</span></p>)}
      <p className="flex justify-between"><span>Change</span><span>{Number(r.change_given).toFixed(2)}</span></p>
      <hr className="my-1 border-dashed border-foreground" />
      <p className="text-center">eTIMS: not submitted (eTIMS-ready, not KRA-certified)</p>
      <p className="text-center">Thank you</p>
    </div>
  );
}

export async function loadReceipt(supabase: typeof import("@/integrations/supabase/client").supabase, saleId: string): Promise<ReceiptData> {
  const { data: s, error } = await supabase.from("sales").select("*, branches(name, code), businesses(name)").eq("id", saleId).single();
  if (error) throw error;
  const [l, t, v] = await Promise.all([
    supabase.from("sale_lines").select("*").eq("sale_id", saleId).order("line_no"),
    supabase.from("sale_tenders").select("*").eq("sale_id", saleId),
    supabase.from("sale_voids").select("reason,voided_at").eq("sale_id", saleId).maybeSingle(),
  ]);
  const sx = s as typeof s & { branches: { name: string; code: string }; businesses: { name: string } };
  return {
    business: sx.businesses.name, branch: `${sx.branches.name} (${sx.branches.code})`, receipt_no: s.receipt_no, created_at: s.created_at,
    lines: (l.data ?? []) as ReceiptData["lines"], tenders: (t.data ?? []) as ReceiptData["tenders"],
    subtotal: s.subtotal, discount_total: s.discount_total, tax_total: s.tax_total, total: s.total, change_given: s.change_given,
    void: v.data ?? null,
  };
}
