// Automated checks for the print bridge. Uses a fake TCP "printer" on loopback (allowed only via the test flag).
// Run: node bridge/test-bridge.mjs
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createBridge, loadSettings, checkDestination } from "./ronia-print-bridge.mjs";

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
const received = [];
const printer = net.createServer((s) => { const c = []; s.on("data", (d) => c.push(d)); s.on("end", () => received.push(Buffer.concat(c))); });
await new Promise((r) => printer.listen(0, "127.0.0.1", r));
const pport = printer.address().port;

const s = loadSettings({ RONIA_BRIDGE_TOKEN: "test-token-123", RONIA_BRIDGE_CONFIG: path.join(os.tmpdir(), "rb-test.json"),
  RONIA_PRINTER_PORTS: `9100,${pport}`, RONIA_ALLOWED_ORIGINS: "https://roniake.lovable.app" });
const bridge = createBridge(s);
await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${bridge.address().port}`;
const H = { "Content-Type": "application/json", "X-Ronia-Bridge-Token": "test-token-123", Origin: "https://roniake.lovable.app" };
const call = (p, body, h = H) => fetch(base + p, body ? { method: "POST", headers: h, body: JSON.stringify(body) } : { headers: h }).then(async (r) => ({ status: r.status, h: r.headers, j: await r.json().catch(() => ({})) }));

ok("BIND-01 default bind is 127.0.0.1", loadSettings({ RONIA_BRIDGE_TOKEN: "x", RONIA_BRIDGE_CONFIG: "/tmp/none.json" }).host === "127.0.0.1");
let r = await call("/health");
ok("AUTH-01 health with token", r.status === 200 && r.j.ok);
r = await call("/health", null, { ...H, "X-Ronia-Bridge-Token": "wrong" });
ok("AUTH-02 wrong token refused", r.status === 401);
r = await call("/health", null, { Origin: "https://roniake.lovable.app" });
ok("AUTH-03 missing token refused", r.status === 401);
r = await call("/health", null, { ...H, Origin: "https://evil.example" });
ok("CORS-01 unknown origin refused", r.status === 403 && !r.h.get("access-control-allow-origin"));
const pre = await fetch(base + "/print", { method: "OPTIONS", headers: { Origin: "https://roniake.lovable.app" } });
ok("CORS-02 preflight for allowed origin", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://roniake.lovable.app");

const s2 = { ...s, allowLoopback: false };
ok("SSRF-01 hostname refused", !!checkDestination("printer.local", 9100, s2));
ok("SSRF-02 loopback refused", !!checkDestination("127.0.0.1", 9100, s2));
ok("SSRF-03 cloud metadata refused", !!checkDestination("169.254.169.254", 9100, s2));
ok("SSRF-04 public IP refused", !!checkDestination("8.8.8.8", 9100, s2));
ok("SSRF-05 disallowed port refused", !!checkDestination("192.168.1.50", 22, s2));
ok("SSRF-06 private LAN printer allowed", checkDestination("192.168.1.50", 9100, s2) === null);
ok("SSRF-07 IPv6 refused", !!checkDestination("::1", 9100, s2));
ok("SSRF-08 printer allowlist enforced", !!checkDestination("192.168.1.51", 9100, { ...s2, printers: ["192.168.1.50:9100"] }));
r = await call("/print", { host: "169.254.169.254", port: 9100, data_base64: "AA==" });
ok("SSRF-09 refused through HTTP too", r.status === 400);

// Loopback printer only for the forwarding tests
s.allowLoopback = true;
const bytes = Buffer.from([0x1b, 0x40, 0x48, 0x49, 0x0a]);
r = await call("/print", { host: "127.0.0.1", port: pport, data_base64: bytes.toString("base64"), job_id: "job-1" });
await new Promise((x) => setTimeout(x, 100));
ok("PRINT-01 bytes forwarded unchanged", r.status === 200 && received.length === 1 && received[0].equals(bytes), JSON.stringify(r.j));
r = await call("/print", { host: "127.0.0.1", port: pport, data_base64: bytes.toString("base64"), job_id: "job-1" });
await new Promise((x) => setTimeout(x, 100));
ok("DUP-01 repeated job_id not printed twice", r.j.duplicate === true && received.length === 1);
r = await call("/test", { host: "127.0.0.1", port: pport });
ok("TEST-01 reachability test succeeds", r.status === 200 && r.j.reachable);
printer.close();
await new Promise((x) => setTimeout(x, 50));
r = await call("/print", { host: "127.0.0.1", port: pport, data_base64: bytes.toString("base64"), job_id: "job-2" });
ok("ERR-01 printer off gives clear error", r.status === 502 && /refused|unreachable|timeout/i.test(r.j.error), r.j.error);
r = await call("/print", { host: "127.0.0.1", port: pport, data_base64: "" });
ok("ERR-02 empty receipt refused", r.status === 400);

bridge.close();
const failed = results.filter((x) => !x.pass);
for (const x of results) console.log(`${x.pass ? "PASS" : "FAIL"} ${x.name}${x.detail ? ` [${x.detail}]` : ""}`);
console.log(`BRIDGE_REPORT passed=${results.length - failed.length} failed=${failed.length} total=${results.length}`);
process.exit(failed.length ? 1 : 0);
