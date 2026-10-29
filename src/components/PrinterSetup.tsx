import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReceiptData } from "@/components/Receipt";
import { receiptToEscPos } from "@/lib/printing/escpos";
import { androidBridge, blePair, loadConfig, saveConfig, sendRaw, support, usbPair, verify, type PrinterConfig, type PrinterStatus, type TransportKind } from "@/lib/printing/transports";

const LABEL: Record<TransportKind, string> = { browser: "Print dialog (any printer)", webusb: "USB (direct)", bluetooth: "Bluetooth LE (direct)", bridge: "Network / Wi-Fi via print bridge", android: "RONIA Android app" };
const STATUS: Record<PrinterStatus, string> = { not_configured: "Not set up", configured: "Saved — not checked yet", connecting: "Checking…", connected: "Connected (verified just now)", unavailable: "Not available on this device", failed: "Failed" };

// Per-device printer setup. The sample receipt is rendered by the shared engine.
export function PrinterSetup({ sample, width }: { sample: ReceiptData; width: 58 | 80 }) {
  const [c, setC] = useState<PrinterConfig>({ kind: "browser" });
  const [st, setSt] = useState<PrinterStatus>("configured");
  const [msg, setMsg] = useState("");
  const [sup, setSup] = useState({ webusb: false, bluetooth: false, android: false, bridge: true });
  const [targets, setTargets] = useState<{ id: string; name: string; type: string }[]>([]);
  const refreshTargets = () => { const a = androidBridge(); if (a) { try { setTargets(JSON.parse(a.listPrinters())); } catch { /* ignore */ } } };
  useEffect(() => { setC(loadConfig()); setSup(support()); refreshTargets(); }, []);
  const avail = (k: TransportKind) => k === "browser" || k === "bridge" || sup[k as "webusb" | "bluetooth" | "android"];
  const update = (n: PrinterConfig) => { setC(n); saveConfig(n); setSt(avail(n.kind) ? "configured" : "unavailable"); setMsg(""); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setSt("connecting"); setMsg("");
    try { await fn(); setSt("connected"); setMsg(ok); } catch (e) { setSt("failed"); setMsg((e as Error).message); }
  };

  return (
    <div className="rounded-xl border-4 border-foreground bg-card p-4">
      <h2 className="text-xl font-black">Receipt printer (this device)</h2>
      <p className="text-sm">Saved on this phone/computer only. Each till sets up its own printer.</p>
      <div className="mt-2 grid gap-2">
        {(Object.keys(LABEL) as TransportKind[]).map((k) => (
          <label key={k} className={`flex items-center gap-2 rounded-lg border-2 p-2 font-bold ${avail(k) ? "border-foreground" : "border-border opacity-50"}`}>
            <input type="radio" className="size-5" disabled={!avail(k)} checked={c.kind === k} onChange={() => update({ ...c, kind: k })} />
            {LABEL[k]}{!avail(k) && <span className="text-sm font-normal"> — not supported here</span>}
          </label>
        ))}
      </div>
      {c.kind === "bridge" && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-3"><Label>Bridge token</Label><Input type="password" autoComplete="off" value={c.bridgeToken ?? ""} placeholder="Shown in the bridge window when it starts" onChange={(e) => update({ ...c, bridgeToken: e.target.value.trim() })} /></div>
          <div><Label>Bridge address</Label><Input value={c.bridgeUrl ?? ""} placeholder="http://localhost:9180" onChange={(e) => update({ ...c, bridgeUrl: e.target.value })} /></div>
          <div><Label>Printer IP</Label><Input value={c.printerHost ?? ""} placeholder="192.168.1.50" onChange={(e) => update({ ...c, printerHost: e.target.value })} /></div>
          <div><Label>Port</Label><Input type="number" value={c.printerPort ?? 9100} onChange={(e) => update({ ...c, printerPort: Number(e.target.value) })} /></div>
          <p className="text-sm sm:col-span-3">Browsers cannot open raw network connections to a printer. Run the RONIA print bridge on this computer (see the setup guide), then paste its token here. The bridge only sends to private shop-network printer addresses.</p>
        </div>
      )}
      {c.kind === "android" && (
        <div className="mt-2">
          <div className="mb-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="border-2 font-bold" onClick={() => { const a = androidBridge(); try { const r = JSON.parse(a?.requestPermissions?.() ?? "{}"); setMsg(r.granted ? "Bluetooth permission already allowed." : "Answer the Android prompt, then tap Refresh list."); } catch { /* old shell */ } }}>Allow Bluetooth</Button>
            <Button type="button" variant="outline" className="border-2 font-bold" onClick={refreshTargets}>Refresh list</Button>
          </div>
          <p className="mb-1 text-sm">Pair Bluetooth printers first in Android Settings → Bluetooth. Plug USB printers in with an OTG cable.</p>
          <Label>Printer</Label>
          <select value={c.androidTarget ?? ""} onChange={(e) => update({ ...c, androidTarget: e.target.value })} className="h-12 w-full rounded-md border-2 border-input bg-background px-3">
            <option value="">Choose…</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
          </select>
          <Label className="mt-2 block">Or network printer (IP:port)</Label>
          <Input placeholder="192.168.1.50:9100" defaultValue={c.androidTarget?.startsWith("net:") ? c.androidTarget.slice(4) : ""} onBlur={(e) => e.target.value.trim() && update({ ...c, androidTarget: `net:${e.target.value.trim()}` })} /></div>
      )}
      {c.kind === "bluetooth" && <p className="mt-2 text-sm">Works only with Bluetooth Low Energy printers in Chrome. Many cheap “classic” Bluetooth printers need the Android app instead. You must tap Connect again after reloading the page.</p>}
      {c.kind === "webusb" && <p className="mt-2 text-sm">Works in Chrome/Edge. On Windows, a printer with an installed driver is usually blocked — use the print bridge for those.</p>}
      {c.kind === "browser" && <p className="mt-2 text-sm">Uses the device's print dialog. We cannot see whether the paper actually printed.</p>}

      <p className={`mt-3 font-black ${st === "failed" || st === "unavailable" ? "text-destructive" : ""}`}>Status: {STATUS[st]}</p>
      {msg && <p className="text-sm">{msg}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {c.kind === "webusb" && <Button variant="outline" className="border-2 font-bold" onClick={() => run(async () => { const n = await usbPair(); update({ ...c, label: n }); }, "USB printer opened.")}>Connect USB printer</Button>}
        {c.kind === "bluetooth" && <Button variant="outline" className="border-2 font-bold" onClick={() => run(async () => { const n = await blePair(); update({ ...c, label: n }); }, "Bluetooth printer paired.")}>Connect Bluetooth printer</Button>}
        {(c.kind === "bridge" || c.kind === "android" || c.kind === "webusb") && <Button variant="outline" className="border-2 font-bold" onClick={() => run(() => verify(c), "Printer answered.")}>Check connection</Button>}
        {c.kind !== "browser"
          ? <Button className="font-black" onClick={() => run(() => sendRaw(c, receiptToEscPos(sample, width)), "Test receipt sent. Check the paper — only you can confirm it printed correctly.")}>Print test receipt</Button>
          : <Button className="font-black" onClick={() => window.print()}>Test print (opens print dialog)</Button>}
      </div>
    </div>
  );
}
