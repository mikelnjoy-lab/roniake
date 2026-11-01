import { loadConfig, sendRaw } from "./transports";

// Customer Deni statement on receipt-width paper. Read-only: it prints recorded
// facts and never creates, changes or reverses any debt, sale or payment.
export type StatementData = {
  shop: string; business: string; kra_pin?: string | null | undefined; branch?: string | null | undefined; phone?: string | null | undefined;
  customer: string; customer_phone?: string | null | undefined; printed_at: string;
  till_balance: number;
  till: { at: string; label: string; amount: number }[];
  loans: {
    date: string; type: string; principal: number; outstanding: number; status: string; reversed?: string | null;
    entries: { date: string; label: string; amount: number; struck?: boolean }[];
  }[];
};

const n = (v: number) => Number(v).toFixed(2);
const nairobi = (iso: string) => new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "short", timeStyle: "short" });

/** Plain text lines at 32 (58mm) or 48 (80mm) columns, shared by thermal and browser output. */
export function statementLines(d: StatementData, width: 58 | 80): { text: string; center?: boolean; bold?: boolean }[] {
  const cols = width === 58 ? 32 : 48;
  const out: { text: string; center?: boolean; bold?: boolean }[] = [];
  const wrap = (t: string) => { const r: string[] = []; for (let i = 0; i < t.length; i += cols) r.push(t.slice(i, i + cols)); return r.length ? r : [""]; };
  const add = (t: string, o: { center?: boolean; bold?: boolean } = {}) => wrap(t).forEach((x) => out.push({ text: x, ...o }));
  const pad = (l: string, r: string, o: { bold?: boolean } = {}) => {
    const sp = cols - l.length - r.length;
    out.push({ text: sp >= 1 ? l + " ".repeat(sp) + r : `${l.slice(0, cols - r.length - 1)} ${r}`, ...o });
  };
  const hr = () => out.push({ text: "-".repeat(cols) });

  add(d.shop, { center: true, bold: true });
  if (d.business !== d.shop) add(d.business, { center: true });
  if (d.kra_pin) add(`PIN ${d.kra_pin}`, { center: true });
  if (d.branch) add(d.branch, { center: true });
  if (d.phone) add(`Tel ${d.phone}`, { center: true });
  hr();
  add("CUSTOMER STATEMENT", { center: true, bold: true });
  add(d.customer, { center: true, bold: true });
  if (d.customer_phone) add(d.customer_phone, { center: true });
  add(`Printed ${nairobi(d.printed_at)} EAT`, { center: true });
  hr();

  add("TILL DENI (from sales)", { bold: true });
  if (!d.till.length) add("  None");
  for (const t of d.till) { add(t.at); pad(`  ${t.label}`, n(t.amount)); }
  pad("Till Deni owed", n(d.till_balance), { bold: true });
  hr();

  add("LOANS (outside the till)", { bold: true });
  if (!d.loans.length) add("  None");
  let loansOwed = 0;
  for (const l of d.loans) {
    loansOwed += Number(l.outstanding);
    add(`${l.date} ${l.type}`, { bold: true });
    pad("  Lent", n(l.principal));
    if (l.reversed) add(`  REVERSED: ${l.reversed}`);
    for (const e of l.entries) { add(`  ${e.date}`); pad(`   ${e.struck ? "[REVERSED] " : ""}${e.label}`, e.amount ? `-${n(e.amount)}` : ""); }
    pad(`  Owed (${l.status})`, n(l.outstanding));
  }
  pad("Loans owed", n(loansOwed), { bold: true });
  hr();
  pad("TOTAL OWED KES", n(Number(d.till_balance) + loansOwed), { bold: true });
  hr();
  add("Write-offs are not payments.", { center: true });
  add("Statement only - not a receipt", { center: true });
  add("and not a KRA fiscal invoice.", { center: true });
  return out;
}

function toEscPos(lines: ReturnType<typeof statementLines>): Uint8Array {
  const b: number[] = [0x1b, 0x40];
  for (const l of lines) {
    b.push(0x1b, 0x61, l.center ? 1 : 0, 0x1b, 0x45, l.bold ? 1 : 0);
    for (const ch of l.text.normalize("NFKD")) { const c = ch.charCodeAt(0); if (c < 128) b.push(c); else if (c > 0x36f || c < 0x300) b.push(0x3f); }
    b.push(0x0a);
  }
  b.push(0x1b, 0x45, 0, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(b);
}

function browserPrint(lines: ReturnType<typeof statementLines>, width: 58 | 80) {
  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) throw new Error("Allow pop-ups to print the statement");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = lines.map((l) => `<div style="text-align:${l.center ? "center" : "left"};font-weight:${l.bold ? 700 : 400}">${esc(l.text) || "&nbsp;"}</div>`).join("");
  w.document.write(`<!doctype html><title>Statement</title><style>@page{size:${width}mm auto;margin:2mm}body{margin:0;font:11px/1.35 monospace;white-space:pre;width:${width - 4}mm}</style>${body}`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 200);
}

let busy = false;
export async function printStatement(d: StatementData, width: 58 | 80): Promise<{ via: string; error?: string }> {
  if (busy) return { via: "skipped", error: "Already printing" };
  busy = true;
  const lines = statementLines(d, width);
  try {
    const c = loadConfig();
    if (c.kind === "browser") { browserPrint(lines, width); return { via: "browser" }; }
    await sendRaw(c, toEscPos(lines), `statement:${crypto.randomUUID()}`);
    return { via: c.kind };
  } catch (e) {
    try { browserPrint(lines, width); } catch { /* pop-up blocked */ }
    return { via: "browser", error: (e as Error).message };
  } finally { busy = false; }
}
