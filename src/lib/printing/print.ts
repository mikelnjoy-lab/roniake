import type { ReceiptData } from "@/components/Receipt";
import { receiptToEscPos } from "./escpos";
import { loadConfig, sendRaw } from "./transports";

const inFlight = new Set<string>();
const AUTO_KEY = "ronia.autoprinted";

/** Prints via the configured transport; falls back to the browser dialog on failure. Never touches sale posting. */
export async function printReceipt(r: ReceiptData, width: 58 | 80, opts: { reprint?: boolean } = {}): Promise<{ via: string; error?: string }> {
  const key = r.receipt_no;
  if (inFlight.has(key)) return { via: "skipped", error: "Already printing this receipt" };
  inFlight.add(key);
  try {
    const c = loadConfig();
    if (c.kind === "browser") { window.print(); return { via: "browser" }; }
    const copies = Math.min(Math.max(r.settings?.copies ?? 1, 1), 3);
    for (let i = 0; i < copies; i++) {
      await sendRaw(c, receiptToEscPos(r, width, { copyLabel: opts.reprint ? "REPRINT" : copies > 1 ? `COPY ${i + 1}/${copies}` : undefined }));
    }
    return { via: c.kind };
  } catch (e) {
    window.print();
    return { via: "browser", error: (e as Error).message };
  } finally { inFlight.delete(key); }
}

/** Auto-print each receipt at most once per device session (guards remounts, retries and offline sync replays). */
export function shouldAutoPrint(receiptNo: string): boolean {
  const done = new Set<string>(JSON.parse(sessionStorage.getItem(AUTO_KEY) ?? "[]"));
  if (done.has(receiptNo)) return false;
  done.add(receiptNo);
  sessionStorage.setItem(AUTO_KEY, JSON.stringify([...done].slice(-200)));
  return true;
}
