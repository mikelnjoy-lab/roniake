# RONIA print bridge (network / Wi-Fi thermal printers)

Browsers cannot open a raw connection to a network printer. This small program runs on the shop
computer, accepts already-formatted receipts from the RONIA web app and sends them to the printer
on port 9100. It cannot read or change sales — printing never creates, reverses or repeats a sale.

## Supported platforms
Windows 10/11, macOS 12+, Linux. Requires **Node.js 18 or newer** (https://nodejs.org). No other installs.
Printers: any ESC/POS thermal printer with an Ethernet or Wi-Fi port that accepts raw TCP (normally port 9100).

## Install and start
1. Copy `ronia-print-bridge.mjs` to the shop computer (e.g. `C:\RONIA\`).
2. Open a terminal there and run: `node ronia-print-bridge.mjs`
3. The first start prints a **bridge token** and saves it in `~/.ronia-print-bridge.json` (user-only file).
4. In RONIA → **Receipt settings → Receipt printer (this device)** choose *Network / Wi-Fi via print bridge* and enter:
   - Bridge token: the token above
   - Bridge address: `http://localhost:9180`
   - Printer IP: the printer's address (print a self-test page on the printer to see it), port `9100`
5. Tap **Check connection** (verifies the bridge *and* that the printer answers), then **Print test receipt**.

Start automatically: Windows — Task Scheduler "At log on" running `node C:\RONIA\ronia-print-bridge.mjs`;
macOS — a LaunchAgent; Linux — a systemd user service. Give the printer a fixed IP (DHCP reservation in the router).

## Security defaults
| Protection | Default |
|---|---|
| Listens on | `127.0.0.1:9180` only — not reachable from other machines or the internet |
| Authentication | Every request needs header `X-Ronia-Bridge-Token` (constant-time compare) |
| Web origins (CORS) | Only `https://roniake.lovable.app`, the RONIA preview, and `http://localhost:8080` |
| Printer destinations | Literal private IPv4 only (10.x, 172.16–31.x, 192.168.x). Names, loopback, 169.254.x (cloud metadata), public and IPv6 addresses are refused (blocks SSRF / DNS rebinding) |
| Ports | 9100–9103 only |
| Size / time | 256 KB receipt limit, 5 s timeout |
| Duplicates | A repeated print `job_id` within 10 minutes is acknowledged but not printed again |

## Settings (environment variables or the JSON config file)
| Variable | Meaning |
|---|---|
| `RONIA_BRIDGE_TOKEN` | Use a fixed token instead of the generated one |
| `RONIA_BRIDGE_PORT` | Listen port (default 9180) |
| `RONIA_BRIDGE_HOST` | Listen address. Only change if a tablet must reach this PC over the LAN — then the app page must be allowed by the browser and you must firewall the port. Never port-forward it to the internet |
| `RONIA_ALLOWED_ORIGINS` | Comma list of allowed web origins (set this if you use a custom domain) |
| `RONIA_PRINTERS` | Comma list `ip:port` — when set, only these printers can be used (recommended) |
| `RONIA_PRINTER_PORTS` | Allowed printer ports (default 9100,9101,9102,9103) |

## Troubleshooting
| Message in RONIA | Fix |
|---|---|
| Print bridge not running or blocked | Start the bridge; check the address; some browsers ask to allow "local network access" — allow it |
| Wrong or missing bridge token | Paste the token again (delete `~/.ronia-print-bridge.json` to create a new one) |
| Origin … is not allowed | Add your web address to `RONIA_ALLOWED_ORIGINS` |
| Only private shop-network addresses… | Use the printer's IP number, not a name; it must be on the shop network |
| Printer refused the connection | Wrong port, or another computer is printing; try 9100 |
| Printer unreachable / timeout | Printer off, different Wi-Fi, or wrong IP |

## Automated checks
`node bridge/test-bridge.mjs` — auth, CORS, SSRF refusals, byte-exact forwarding, duplicate jobs, error messages
(uses a fake printer on this machine; it is **not** a physical printer test).
