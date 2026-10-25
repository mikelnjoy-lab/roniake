import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ReceiptData } from "@/components/Receipt";
import { printReceipt } from "@/lib/printing/print";

export function PrintButton({ r, width, label = "Print receipt", reprint = true }: { r: ReceiptData; width: 58 | 80; label?: string; reprint?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button className="font-black" disabled={busy} onClick={async () => {
      setBusy(true);
      const res = await printReceipt(r, width, { reprint });
      setBusy(false);
      if (res.error) toast.error(`Printer: ${res.error}. Opened the print dialog instead.`);
      else if (res.via !== "browser") toast.success("Sent to printer");
    }}>{busy ? "Printing…" : label}</Button>
  );
}
