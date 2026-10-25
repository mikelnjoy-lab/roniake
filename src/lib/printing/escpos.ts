import type { ReceiptData } from "@/components/Receipt";

// Pure ESC/POS rendering from the same ReceiptData (incl. frozen snapshot settings)
// the on-screen receipt uses. No transport code here.
const TL: Record<string, string> = { cash: "Cash", mpesa_manual: "M-Pesa", card: "Card", other: "Other", deni: "Deni" };
const ESC = 0x1b, GS = 0x1d;

class Buf {
  b: number[] = [];
  raw(...n: number[]) { this.b.push(...n); return this; }
  text(s: string) {
    // ASCII-safe: thermal code pages vary, so replace non-ASCII characters.
    for (const ch of s.normalize("NFKD")) { const c = ch.charCodeAt(0); if (c < 128) this.b.push(c); else if (c > 0x36f || c < 0x300) this.b.push(0x3f); }
    return this;
  }
  line(s = "") { return this.text(s).raw(0x0a); }
  align(a: 0 | 1 | 2) { return this.raw(ESC, 0x61, a); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  big(on: boolean) { return this.raw(GS, 0x21, on ? 0x11 : 0); }
}

export function receiptToEscPos(r: ReceiptData, width: 58 | 80, opts: { copyLabel?: string } = {}): Uint8Array {
  const cols = width === 58 ? 32 : 48;
  const s = r.settings ?? {};
  const pad = (l: string, rt: string) => { const sp = cols - l.length - rt.length; return sp >= 1 ? l + " ".repeat(sp) + rt : `${l.slice(0, cols - rt.length - 1)} ${rt}`; };
  const wrap = (t: string) => { const out: string[] = []; for (let i = 0; i < t.length; i += cols) out.push(t.slice(i, i + cols)); return out.length ? out : [""]; };
  const hr = "-".repeat(cols);
  const n = (v: number) => Number(v).toFixed(2);
  const b = new Buf().raw(ESC, 0x40);
  const title = s.display_name?.trim() || r.business;
  b.align(1);
  if (r.sample) b.bold(true).line("SAMPLE - NOT A SALE").bold(false);
  if (opts.copyLabel) b.line(opts.copyLabel);
  b.bold(true).big(true); wrap(title).forEach((l) => b.line(l)); b.big(false).bold(false);
  if (title !== r.business) wrap(r.business).forEach((l) => b.line(l));
  if (r.kra_pin) b.line(`PIN ${r.kra_pin}`);
  b.line(r.branch);
  if (s.show_address !== false && s.address) wrap(s.address).forEach((l) => b.line(l));
  if (s.show_phone !== false && s.phone) b.line(`Tel ${s.phone}`);
  b.line(`Receipt ${r.receipt_no}`);
  b.line(new Date(r.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }));
  if (s.show_cashier && r.cashier) b.line(`Served by ${r.cashier}`);
  if (r.void) b.bold(true).line("*** VOIDED ***").line(r.void.reason).bold(false);
  b.align(0).line(hr);
  for (const l of r.lines) {
    wrap(l.product_name).forEach((x) => b.line(x));
    b.line(pad(`${Number(l.qty)} x ${n(l.unit_price)} [${l.tax_class}]`, n(l.line_total)));
    if (Number(l.discount) > 0) b.line(pad("  discount", `-${n(l.discount)}`));
  }
  b.line(hr);
  if (Number(r.discount_total) > 0) b.line(pad("Discounts", `-${n(r.discount_total)}`));
  b.bold(true).line(pad("TOTAL KES", n(r.total))).bold(false);
  b.line(pad("incl. VAT", n(r.tax_total)));
  for (const t of r.tenders) b.line(pad(`${TL[t.tender_type] ?? t.tender_type}${t.reference ? ` ${t.reference}` : ""}`, n(t.amount)));
  b.line(pad("Change", n(r.change_given)));
  if (r.tenders.some((t) => t.tender_type === "deni")) b.align(1).line("On credit (Deni) - balance owed").align(0);
  for (const x of r.returns ?? []) b.line(pad(`RETURN ${x.return_no}`, `-${n(x.refund_amount)}`));
  b.line(hr).align(1);
  wrap("eTIMS: not submitted (eTIMS-ready, not KRA-certified)").forEach((l) => b.line(l));
  wrap("RONIA receipt - not a KRA fiscal invoice").forEach((l) => b.line(l));
  if (s.show_footer !== false && s.footer) s.footer.split("\n").forEach((p) => wrap(p).forEach((l) => b.line(l)));
  b.raw(0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00); // feed + partial cut (ignored by printers without cutter)
  return new Uint8Array(b.b);
}
