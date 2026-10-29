// Printer transports. Each sends raw ESC/POS bytes; none renders receipts.
// Status is only "connected" after a real handshake (USB claim, GATT connect, bridge/native reply).
/* eslint-disable @typescript-eslint/no-explicit-any */

export type TransportKind = "browser" | "webusb" | "bluetooth" | "bridge" | "android";
export type PrinterConfig = { kind: TransportKind; bridgeUrl?: string; bridgeToken?: string; printerHost?: string; printerPort?: number; androidTarget?: string; label?: string };
export type PrinterStatus = "not_configured" | "configured" | "connecting" | "connected" | "unavailable" | "failed";

const KEY = "ronia.printer.v1"; // per device: printers are physical to this device
export function loadConfig(): PrinterConfig {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "") as PrinterConfig; } catch { return { kind: "browser" }; }
}
export function saveConfig(c: PrinterConfig) { localStorage.setItem(KEY, JSON.stringify(c)); }

/** Contract for the future native Android shell (exposed via addJavascriptInterface / Capacitor plugin). */
export type RoniaAndroidPrinter = {
  listPrinters(): string;                                    // JSON [{id,name,type:"usb"|"bluetooth"|"network"}]
  print(target: string, base64EscPos: string): string;       // JSON {ok:boolean,error?:string}
  testConnection(target: string): string;                    // JSON {ok:boolean,error?:string}
  printJob?(target: string, base64EscPos: string, jobId: string): string; // duplicate-safe print
  requestPermissions?(): string;                             // JSON {ok, granted, prompted?}
  cancel?(): string;
};
export function androidBridge(): RoniaAndroidPrinter | null {
  return typeof window !== "undefined" ? ((window as any).RoniaAndroidPrinter ?? null) : null;
}

export function support() {
  const n: any = typeof navigator !== "undefined" ? navigator : {};
  return {
    webusb: !!n.usb && window.isSecureContext,
    bluetooth: !!n.bluetooth && window.isSecureContext,
    android: !!androidBridge(),
    bridge: true,
  };
}

// ---- WebUSB (Chromium desktop / Android Chrome with OTG; printer must expose a vendor/printer-class bulk OUT endpoint)
let usbDev: any = null;
let usbEp = 0;
async function usbOpen(dev: any) {
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  for (const intf of dev.configuration.interfaces) {
    const alt = intf.alternates[0];
    const out = alt.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
    if (out) { await dev.claimInterface(intf.interfaceNumber); usbDev = dev; usbEp = out.endpointNumber; return; }
  }
  throw new Error("No printable USB endpoint. On Windows the OS printer driver may hold the device — use the print bridge instead.");
}
export async function usbPair() { const d = await (navigator as any).usb.requestDevice({ filters: [] }); await usbOpen(d); return d.productName || "USB printer"; }
async function usbReconnect() {
  if (usbDev?.opened) return;
  const devs: any[] = await (navigator as any).usb.getDevices();
  if (!devs.length) throw new Error("USB printer not paired or unplugged. Tap Connect.");
  await usbOpen(devs[0]);
}

// ---- Web Bluetooth (BLE printers only; classic-Bluetooth SPP printers are NOT reachable from browsers)
const BLE_SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455"];
let bleChar: any = null;
export async function blePair() {
  const dev = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  dev.addEventListener("gattserverdisconnected", () => { bleChar = null; });
  const srv = await dev.gatt.connect();
  for (const uuid of BLE_SERVICES) {
    try {
      const svc = await srv.getPrimaryService(uuid);
      for (const c of await svc.getCharacteristics()) if (c.properties.write || c.properties.writeWithoutResponse) { bleChar = c; return dev.name || "Bluetooth printer"; }
    } catch { /* try next service */ }
  }
  dev.gatt.disconnect();
  throw new Error("This Bluetooth device has no known printer service.");
}
async function bleWrite(data: Uint8Array) {
  if (!bleChar) throw new Error("Bluetooth printer disconnected. Tap Connect to pair again (browsers need a tap to reconnect).");
  for (let i = 0; i < data.length; i += 180) {
    const part = data.slice(i, i + 180);
    if (bleChar.properties.writeWithoutResponse) await bleChar.writeValueWithoutResponse(part); else await bleChar.writeValue(part);
  }
}

// ---- Local print bridge (bridge/ronia-print-bridge.mjs): Ethernet/Wi-Fi raw port 9100
// Contract: header X-Ronia-Bridge-Token; GET /health; POST /test {host,port}; POST /print {host,port,data_base64,job_id}
const b64 = (u: Uint8Array) => { let s = ""; u.forEach((c) => (s += String.fromCharCode(c))); return btoa(s); };
async function bridgeCall(c: PrinterConfig, path: string, body?: unknown) {
  if (!c.bridgeUrl) throw new Error("Bridge address not set");
  if (!c.bridgeToken) throw new Error("Bridge token not set — copy it from the bridge window");
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  const headers: Record<string, string> = { "X-Ronia-Bridge-Token": c.bridgeToken };
  let res: Response;
  try {
    res = await fetch(c.bridgeUrl.replace(/\/$/, "") + path, body ? { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal } : { headers, signal: ctl.signal });
  } catch (e) {
    throw new Error((e as Error).name === "AbortError" ? "Print bridge did not answer (timeout)" : "Print bridge not running or blocked — start it on this computer");
  } finally { clearTimeout(t); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || `Bridge replied ${res.status}`);
  return j as { ok: true; duplicate?: boolean };
}
const needHost = (c: PrinterConfig) => { if (!c.printerHost) throw new Error("Printer IP not set"); return { host: c.printerHost.trim(), port: c.printerPort ?? 9100 }; };

function androidCall(fn: "print" | "testConnection", c: PrinterConfig, data?: Uint8Array, jobId?: string) {
  const a = androidBridge();
  if (!a) throw new Error("Not running inside the RONIA Android app");
  if (!c.androidTarget) throw new Error("Choose a printer in the Android app first");
  const raw = fn === "testConnection" ? a.testConnection(c.androidTarget)
    : a.printJob && jobId ? a.printJob(c.androidTarget, b64(data!), jobId) : a.print(c.androidTarget, b64(data!));
  const r = JSON.parse(raw) as { ok: boolean; error?: string };
  if (!r.ok) throw new Error(r.error || "Android printer error");
}

/** Verifies the configured printer is really reachable. */
export async function verify(c: PrinterConfig): Promise<void> {
  if (c.kind === "webusb") return usbReconnect();
  if (c.kind === "bluetooth") { if (!bleChar) throw new Error("Bluetooth printer not connected"); return; }
  if (c.kind === "bridge") { await bridgeCall(c, "/health"); await bridgeCall(c, "/test", needHost(c)); return; }
  if (c.kind === "android") return androidCall("testConnection", c);
}

/** Sends bytes. Throws on any failure so callers can fall back to the browser print dialog. */
export async function sendRaw(c: PrinterConfig, data: Uint8Array, jobId: string = crypto.randomUUID()): Promise<void> {
  if (c.kind === "webusb") { await usbReconnect(); const r = await usbDev.transferOut(usbEp, data); if (r.status !== "ok") throw new Error(`USB transfer ${r.status}`); return; }
  if (c.kind === "bluetooth") return bleWrite(data);
  if (c.kind === "bridge") { await bridgeCall(c, "/print", { ...needHost(c), data_base64: b64(data), job_id: jobId }); return; }
  if (c.kind === "android") return androidCall("print", c, data, jobId);
  throw new Error("Browser printing uses the print dialog");
}
