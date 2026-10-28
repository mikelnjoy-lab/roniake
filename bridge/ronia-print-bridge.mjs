#!/usr/bin/env node
// RONIA local network ESC/POS print bridge.
// Zero dependencies — Node.js 18+ on Windows, macOS or Linux.
// Receives already-rendered ESC/POS bytes from the RONIA web app and forwards them
// to a LAN thermal printer (raw TCP, usually port 9100). It never renders receipts
// and never talks to the RONIA database: printing cannot create, reverse or repeat a sale.
//
// Security defaults:
//  - binds 127.0.0.1 only (set RONIA_BRIDGE_HOST to expose on the LAN deliberately)
//  - every request except OPTIONS needs the X-Ronia-Bridge-Token header
//  - CORS + Origin check against an allowlist
//  - destinations must be literal private IPv4 addresses (no hostnames → no DNS rebinding),
//    on an allowed port; loopback, link-local/metadata, multicast and public IPs are refused
//  - optional RONIA_PRINTERS allowlist pins exact printer IP:port pairs
//  - payload limited to 256 KB; 5 s connect/write timeout; duplicate job_id ignored for 10 min
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const VERSION = "1.0.0";
const DEFAULT_ORIGINS = [
  "https://roniake.lovable.app",
  "https://id-preview--028a63fe-05e6-4fed-be9d-7a872da2bf2f.lovable.app",
  "http://localhost:8080",
];

export function loadSettings(env = process.env) {
  const cfgPath = env.RONIA_BRIDGE_CONFIG || path.join(os.homedir(), ".ronia-print-bridge.json");
  let file = {};
  try { file = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { /* first run */ }
  let token = env.RONIA_BRIDGE_TOKEN || file.token;
  let created = false;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    created = true;
    try { fs.writeFileSync(cfgPath, JSON.stringify({ ...file, token }, null, 2), { mode: 0o600 }); } catch (e) {
      console.error(`Could not save token to ${cfgPath}: ${e.message}`);
    }
  }
  const list = (v, d) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : d);
  return {
    cfgPath, token, created,
    host: env.RONIA_BRIDGE_HOST || file.host || "127.0.0.1",
    port: Number(env.RONIA_BRIDGE_PORT || file.port || 9180),
    origins: list(env.RONIA_ALLOWED_ORIGINS, file.origins || DEFAULT_ORIGINS),
    ports: list(env.RONIA_PRINTER_PORTS, file.printerPorts || ["9100", "9101", "9102", "9103"]).map(Number),
    printers: list(env.RONIA_PRINTERS, file.printers || []),      // e.g. "192.168.1.50:9100"
    allowLoopback: env.RONIA_BRIDGE_ALLOW_LOOPBACK_TARGETS === "1", // tests only
  };
}

/** Returns null when allowed, otherwise the refusal reason. */
export function checkDestination(host, port, s) {
  if (typeof host !== "string" || net.isIP(host) !== 4) return "Printer address must be an IPv4 number like 192.168.1.50 (names are not accepted)";
  if (!Number.isInteger(port) || !s.ports.includes(port)) return `Printer port ${port} is not allowed (allowed: ${s.ports.join(", ")})`;
  const [a, b] = host.split(".").map(Number);
  const loop = a === 127;
  const priv = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (loop && !s.allowLoopback) return "Loopback addresses are refused";
  if (!priv && !(loop && s.allowLoopback)) return "Only private shop-network addresses (10.x, 172.16–31.x, 192.168.x) are allowed";
  if (s.printers.length && !s.printers.includes(`${host}:${port}`)) return "This printer is not on the bridge's printer list";
  return null;
}

export function sendToPrinter(host, port, data, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (err) => { if (done) return; done = true; sock.destroy(); err ? reject(err) : resolve(); };
    sock.setTimeout(timeoutMs, () => finish(new Error("Printer did not respond (timeout) — is it on and on this network?")));
    sock.on("error", (e) => finish(new Error(e.code === "ECONNREFUSED" ? "Printer refused the connection — wrong port or printer busy" :
      e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH" ? "Printer unreachable — check IP address and Wi-Fi/cable" : e.message)));
    sock.on("connect", () => {
      if (!data || !data.length) return finish();
      sock.end(data, () => finish());
    });
  });
}

export function createBridge(s) {
  const jobs = new Map(); // job_id -> time
  const started = Date.now();
  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    const originOk = !origin || s.origins.includes(origin);
    const send = (code, body) => {
      const h = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
      if (origin && originOk) Object.assign(h, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, X-Ronia-Bridge-Token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600" });
      res.writeHead(code, h); res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (!originOk) return send(403, { ok: false, error: `Origin ${origin} is not allowed by this bridge` });
    if (req.method === "OPTIONS") return send(204);
    const tok = String(req.headers["x-ronia-bridge-token"] || "");
    const a = Buffer.from(tok), b = Buffer.from(s.token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(401, { ok: false, error: "Wrong or missing bridge token" });

    const url = new URL(req.url, "http://bridge");
    if (req.method === "GET" && url.pathname === "/health")
      return send(200, { ok: true, version: VERSION, platform: process.platform, uptime_s: Math.round((Date.now() - started) / 1000) });
    if (req.method !== "POST" || !["/print", "/test"].includes(url.pathname)) return send(404, { ok: false, error: "Not found" });
    if (!(req.headers["content-type"] || "").startsWith("application/json")) return send(415, { ok: false, error: "JSON required" });

    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 400_000) { send(413, { ok: false, error: "Receipt too large" }); req.destroy(); } else chunks.push(c); });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(400, { ok: false, error: "Bad JSON" }); }
      const port = Number(body.port ?? 9100);
      const why = checkDestination(body.host, port, s);
      if (why) return send(400, { ok: false, error: why });
      try {
        if (url.pathname === "/test") { await sendToPrinter(body.host, port, Buffer.alloc(0)); return send(200, { ok: true, reachable: true }); }
        const data = Buffer.from(String(body.data_base64 || ""), "base64");
        if (!data.length) return send(400, { ok: false, error: "Empty receipt" });
        if (data.length > 256_000) return send(413, { ok: false, error: "Receipt too large" });
        const now = Date.now();
        for (const [k, t] of jobs) if (now - t > 600_000) jobs.delete(k);
        if (body.job_id && jobs.has(body.job_id)) return send(200, { ok: true, duplicate: true });
        await sendToPrinter(body.host, port, data);
        if (body.job_id) jobs.set(String(body.job_id), now);
        return send(200, { ok: true, bytes: data.length });
      } catch (e) {
        return send(502, { ok: false, error: e.message });
      }
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const s = loadSettings();
  createBridge(s).listen(s.port, s.host, () => {
    console.log(`RONIA print bridge ${VERSION} listening on http://${s.host}:${s.port}`);
    if (s.host !== "127.0.0.1" && s.host !== "localhost") console.warn("WARNING: exposed beyond this computer. Keep it off the public internet.");
    console.log(`Allowed web origins: ${s.origins.join(", ")}`);
    console.log(`Allowed printer ports: ${s.ports.join(", ")}${s.printers.length ? ` · printers: ${s.printers.join(", ")}` : ""}`);
    console.log(s.created ? `NEW bridge token (enter it in RONIA → Receipt settings): ${s.token}` : `Bridge token stored in ${s.cfgPath}`);
  });
}
