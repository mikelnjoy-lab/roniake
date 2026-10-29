# RONIA BUSINESS — Master Build Book (implementation project)

Statuses: ⬜ NOT STARTED · 🟡 IN PROGRESS · 🟢 COMPLETED · 🔵 VERIFIED · 🔴 BLOCKED · ⚠️ REQUIRES REVIEW

Reference specs (Master Architecture v2.0.0, Implementation Plan v1.1.0, Build Book v2.4.0) were locked in earlier planning but **are not stored in this project**. Earlier verification results do not count here. Every phase has to be verified again against this project's own database.

## Phase 0 — Foundation Bootstrap — 🔵 VERIFIED (2026-10-02, database checks)

| Item | Status | Notes |
|---|---|---|
| Database/schema (org → business → branch, memberships, role matrix) | 🔵 | migrations 0000–0002 |
| Authentication (backend enabled) | 🔵 | backend auth identity (`auth.uid()`) checked by the suite; sign-in screens belong to Application Assembly |
| Business boundaries + RLS | 🔵 | ISO-01..12 |
| Roles/permissions (Owner, Manager, Cashier, Auditor) | 🔵 | ROLE-01..17; cashier lacks `shift.view_expected` (blind close) |
| Branch security | 🔵 | BR-01..04 |
| Membership status | 🔵 | MEM-01..02 |
| Server-derived tenant context | 🔵 | `resolve_tenant_context` (ISO-11/12, ROLE-01/05, BR-02/04) |
| Audit log (append-only) | 🔵 | AUD-01..06 |
| Idempotency | 🔵 | IDEM-01..05 |
| Phase 0 verification suite | 🔵 | `tests/phase0/verification.sql`: **49 checks** (earlier reports said 50, which was a miscount). Always rolls back. |

### Verification evidence
- **Run 1 (2026-10-01):** stopped during setup with 0 checks run. An Owner could not create a second branch.
  - Cause: the branch SELECT policy called `can_access_branch(id)`, which re-reads `branches`. On `INSERT … RETURNING`, the row being inserted isn't visible to that STABLE function, so the RLS check on the returned row failed.
  - Fix (migration 0001): added `can_access_branch_row(business_id, id)`, which decides access from the row's own columns using the same membership, role and branch-assignment rules. `can_access_branch` now delegates to it. No rule was loosened.
- **Run 2:** 47 passed, 2 failed (AUTH-01, IDEM-05).
  - Cause: the platform's default table privileges gave `anon`/`authenticated` broader access than the design intends. RLS still returned zero rows, but the grants were wider than specified.
  - Fix (migration 0002): revoked all table privileges, re-granted only the intended set, and removed the default privileges in `public`. `idempotency_keys` now has no direct client access.
- **Run 3:** **49 passed, 0 failed.**
- Scope: database-level checks with simulated `anon`/`authenticated` JWT roles. End-to-end sign-in through the app isn't tested yet; that belongs to Application Assembly → Authentication.

## Phase 1 — Core Domain & Transaction Engine — 🔵 VERIFIED (database checks; 2026-10-03)

| Item | Status | Notes |
|---|---|---|
| Catalog (SKU, barcode, unit, price, tax class A–E, weighted/PLU, packs) | 🔵 | migration 0003; CAT-01..07 |
| Branch stock + immutable stock ledger, WAC | 🔵 | INV-01..11, SAL-29 |
| Bulk breaking (pack → units at split WAC) | 🔵 | INV-02 |
| Authorized stock adjustments (reason required, audited) | 🔵 | INV-03/04/07 |
| Sale engine `post_sale`: server prices, permissioned discounts, split tender, cash-only change, M-Pesa manual code, VAT-inclusive tax | 🔵 | SAL-01..04, 13..18 |
| Offline-safe idempotency (client transaction id replay / mismatch reject) | 🔵 | SAL-05..07 |
| Immutable COGS frozen from WAC at sale | 🔵 | SAL-08, SAL-12 |
| Sales/lines/tenders immutable; tenant + branch isolation; audit | 🔵 | SAL-19..28 |
| Phase 1 verification suite | 🔵 | `tests/phase1/verification.sql`: **47 checks, 47 passed, 0 failed** (first run). Always rolls back. |

Not in Phase 1 (later build steps): shifts/blind close, Deni credit sales, sale voids/refunds, stock audits (count sessions), M-Pesa STK/C2B, eTIMS submission. Stock may go negative on sale so offline sales are never refused; negative stock is for review.

## Production Application Assembly & Controlled Pilot
See the 2026-10-16 verification audit below for the current status of each item.

## Application Assembly — Step 1: Authentication & Secure Business Entry — 🟡 IN PROGRESS (built, awaiting live sign-in test)
- Email/password + Google sign-in, sign-up with email confirmation, password reset, secure sign-out (cache cleared, history replaced).
- Protected area gated by session; business list from RLS-scoped active memberships; single business auto-selected; branch list from RLS (`can_access_branch_row`).
- Active context re-resolved server-side via `resolve_tenant_context` on every entry; rejection → /unauthorized and stored selection cleared. Browser stores only the chosen IDs, never permissions.
- First-time users create a business through `create_business` (become Owner).

## Application Assembly — Steps 2–7 (built, awaiting pilot testing) 🟡
- Products screen (catalog, variable-weight PLU, pack-to-unit) — RLS insert via catalog.manage.
- Stock screen: receive (WAC), audited adjustments, bulk break, movement history — existing RPCs.
- Shifts: migration 0004 `phase2_shifts` (open_shift, close_shift, my_open_shift). Blind close: cashiers get only their declared amount; expected/variance returned only with shift.view_expected; shifts table SELECT limited to that permission.
- Till: scan/SKU search, EAN-13 weight barcodes (2+PLU5+grams5), cart, permissioned discounts, cash / M-Pesa manual / card / other, split tender, hold/resume, post_sale.
- Offline: single IndexedDB queue `ronia/pending_sales`, idempotent replay on client_txn_id, online indicator, auto-sync.
- Receipts 58/80mm from server data only; eTIMS shown as "not submitted (eTIMS-ready, not KRA-certified)".
- Sales screen: today's totals, tender split, gross profit (reports.view), receipt reprint.
- Not yet built: Deni credit, refunds/voids, stock counts, staff invites, live M-Pesa STK, eTIMS submission, subscription.

## Step 8 — Stock guard, Deni, Staff, Stock counts — 🟡 IN PROGRESS (built; DB checks for these not yet re-run)
- Owner decision (2026-10-07): **sales must not go below zero stock.** `post_sale` locks stock rows and rejects with OUT_OF_STOCK; the till shows stock and blocks adding beyond it. Offline-queued sales that no longer fit stock are marked failed on sync. Supersedes the Phase 1 "negative stock allowed" note.
- Customers & Deni (migration 0005): customers (default Deni off, limit), immutable customer_ledger, Deni tender with limit check in `post_sale`, `record_deni_repayment`.
- Staff: `invite_member_by_email` (existing account required), `list_members`, suspend/reactivate.
- Stock counts: `apply_stock_count` records count + lines (immutable) and adjusts variances.

## Verification audit — 2026-10-16

All suites run against this project's database, each ending in a forced error so every test record is rolled back. Afterwards: 0 leftover test businesses; real data unchanged (3 products, 9 sales).

| Suite | Result |
|---|---|
| Phase 0 `tests/phase0` (tenancy, roles, branches, audit, idempotency) | **49 / 49 passed** |
| Phase 1 `tests/phase1` (catalog, WAC, bulk break, sale engine) | **47 / 47 passed** — earlier "hangs in psql" was a runner problem, not a defect |
| Phase 2 `tests/phase2` (new: high-risk invariants) | Run 1: 55/57 (2 test bugs — cashier read stock from a table cashiers may not see; fixed to use the till's stock function). Run 2: **57 / 57 passed** |
| **Total** | **153 / 153** |

Phase 2 covers: owner creates a second branch; cross-business denial for stock, sales, products, customers, voids; cashier denied unassigned branch, discounts, voids, support grants; duplicate sale submission replays one receipt and deducts stock once; same id with different contents refused; out-of-stock refused (incl. split lines); refused sale leaves stock untouched; WAC 230 exact; 1 crate → 24 units, value conserved; COGS frozen and unchanged after new cost; Deni limit, repayment rules, balance = ledger; void returns stock, double void refused, sale kept; blind close hides expected/variance from cashier, expected = float + net cash with voids excluded; on-hand = ledger sum, no negative stock, sale COGS = line COGS; ledgers/voids/movements immutable even for privileged role; M-Pesa "Live Ready" cannot be self-declared.

Real store integrity (read-only): stock vs ledger mismatches 0, negative stock 0, Deni balance vs ledger mismatches 0, COGS mismatches 0. 2 shifts currently open.

### Defects found and fixed
- Offline sync: overlapping sync runs could report a successfully recorded sale as "failed"; rejected offline sales were retried forever and could not be seen. Fixed: one sync at a time, duplicate = already recorded, rejected sales shown on the till in red with reason, Try again, and manager dismissal. (Typecheck clean; not yet exercised in a browser.)

### Status by item
| Item | Status |
|---|---|
| Tenancy, roles, branch access, audit, idempotency | 🔵 VERIFIED (DB) |
| Sale engine, stock guard, WAC, bulk break, COGS | 🔵 VERIFIED (DB) |
| Shifts / blind close, Deni, voids | 🔵 VERIFIED (DB) |
| Stock counts, staff invites, M-Pesa reconciliation, eTIMS config, support grants | 🟢 implemented; partially tested (permission checks only) |
| Sign-in, screens, receipts printing, offline UX | 🟢 implemented; used by owner in pilot (real sales exist); no automated UI tests |
| Live M-Pesa STK/C2B | 🔴 BLOCKED — Safaricom Daraja credentials |
| eTIMS submission | 🔴 BLOCKED — KRA approval / device keys |
| Plan limits | ⚠️ REQUIRES REVIEW — real plan names/limits from owner |
| Support staff sign-in | ⬜ NOT STARTED |

### Remaining risks
- Offline sales refused on reconnect (e.g. stock ran out meanwhile) need a manager to act; goods may have left unrecorded.
- No automated browser tests; screen-level behaviour verified only by pilot use.
- Stock counts and M-Pesa reconciliation business rules not yet covered by DB tests.

---

## Requirement Reconciliation Matrix (full scope review)

Status key: VERIFIED (passing automated test) · IMPLEMENTED, NOT VERIFIED · PARTIAL · NOT IMPLEMENTED · EXTERNALLY BLOCKED · REQUIRES DECISION

| Area | Requirement | Evidence | Status |
|---|---|---|---|
| Tenancy | org → business → branch isolation, RLS | phase0 ISO-01..12, phase2 ISO-S1..S7 | VERIFIED |
| Tenancy | Server-derived tenant context | phase0; resolve_tenant_context | VERIFIED |
| Security | Owner/Manager/Cashier/Auditor permissions | phase0 ROLE-01..17, phase2 DISC-01, VOID-01, SUP-01 | VERIFIED |
| Security | Direct table writes blocked | phase2 DIR-01..03 | VERIFIED |
| Audit | Append-only activity log | phase0 AUD-01..06, phase2 AUD-S1..S4 | VERIFIED |
| Auth | Email/Google sign-in, session, logout, unauthorized | live sign-in by owner account | IMPLEMENTED, NOT VERIFIED (no automated UI test) |
| Catalog | SKU, barcode, unit, price, tax A–E | phase1 | VERIFIED |
| Catalog | Variable-weight EAN-13 parsing at till | pos.tsx parser | IMPLEMENTED, NOT VERIFIED |
| Engine | post_sale atomic, server prices, receipt numbers | phase1, phase2 SAL/ATOM | VERIFIED |
| Engine | Split tender, cash-only change, M-Pesa code required | phase2 TEND-01, MPESA-01, DENI-01 | VERIFIED |
| Engine | Idempotent replay / payload mismatch rejection | phase2 IDEM-S1..S4 | VERIFIED |
| Engine | No sale beyond stock | phase2 STOCK-01..02 | VERIFIED |
| Valuation | WAC, bulk breaking value conservation | phase2 WAC-01, BULK-01..04 | VERIFIED |
| Valuation | Immutable COGS at sale | phase2 COGS-01..03, LEDGER-03 | VERIFIED |
| Inventory | Audited adjustments | phase1 | VERIFIED |
| Inventory | Physical stock counts | phase4 CNT-01..21 (21/21); duplicate-product defect fixed | VERIFIED |
| Purchasing | Supplier directory | phase5 SUP-01..06 | VERIFIED |
| Purchasing | Purchase orders, supplier payables | — | NOT IMPLEMENTED |
| Purchasing | Goods received against supplier invoice (idempotent, duplicate invoice blocked) | phase5 GRN-01..26 | VERIFIED |
| Expenses | Petty cash / drawer payouts | phase3 PAY-01..16 (2026 run: 16/16) | VERIFIED |
| Returns | Full-sale void with stock + Deni reversal | phase2 VOID-01..04, DENI-05 | VERIFIED |
| Returns | Partial item return / refund (cash, M-Pesa reversal code, Deni credit) | phase6 RET-01..26 | VERIFIED |
| Shifts | Open, one-open rule, blind close, variance (incl. payouts) | phase2 SHIFT-01..06, phase3 PAY-11/13 | VERIFIED |
| Staff | Invite by email, branch assignment, suspend | invite_member_by_email, staff.tsx | IMPLEMENTED, NOT VERIFIED |
| Deni | Limits, credit sale, repayment, immutable ledger | phase2 DENI-01..05 | VERIFIED |
| Deni | Aging breakdown | dashboard.tsx (client calc) | IMPLEMENTED, NOT VERIFIED |
| Offline | Single IndexedDB queue, serial sync, rejected sales held | offline-queue.ts, pos.tsx | IMPLEMENTED, NOT VERIFIED (no browser test) |
| Reports | KPIs, tender split, fast movers, reorder, exports | dashboard.tsx | IMPLEMENTED, NOT VERIFIED |
| M-Pesa | Till/PayBill config, Live Ready not self-declarable | phase2 MPESA-02 | VERIFIED (guard only) |
| M-Pesa | Manual reconciliation (amount match, duplicate code, transitions, retries) | phase4 MP-01..21; auditor-write defect fixed | VERIFIED |
| M-Pesa | STK Push / C2B | needs Daraja credentials | EXTERNALLY BLOCKED |
| eTIMS | Config, PIN validation, ready vs certified badges | save_etims_config, etims.tsx | IMPLEMENTED, NOT VERIFIED |
| eTIMS | Live KRA transmission | needs KRA device onboarding | EXTERNALLY BLOCKED |
| Plan | Tiers and soft caps | subscriptions; placeholder limits | REQUIRES DECISION |
| Support | Time-limited grants, owner-only, ≤24h | phase2 SUP-01..02 | VERIFIED |
| Purchasing | Purchase orders: create → approve (owner/manager) → part/full receive → cancel with reason; numbered PO-00001 per business | migration 0014; tests/phase5b PO-01..08, GRN-PO-01..12, CAN-01..04 | VERIFIED (DB) |
| Purchasing | Over-receiving refused; items not on order refused; cancelled/draft/fully received orders refuse deliveries | phase5b GRN-PO-07..11, CAN-03 | VERIFIED (DB) |
| Payables | Supplier payments linked to invoices; immutable; duplicate submission replays; duplicate reference refused; overpayment refused | phase5b PAY-02..14 | VERIFIED (DB) |
| Payables | Outstanding/overdue balances derived only from invoices − payments (no stored balance) | supplier_balances(); phase5b PAY-01, PAY-11 | VERIFIED (DB) |
| Purchasing | Orders & owed screen | purchasing.tsx | IMPLEMENTED, NOT VERIFIED (no browser test) |
| Support | Support staff sign-in using a grant | — | REQUIRES DECISION (who RONIA support staff are) |
| Ops | Backups / disaster recovery | platform daily backups exist; no practice restore performed | NOT VERIFIED — restore must be run by the owner from Cloud → Database → Backups into a separate project; recoverability NOT claimed |

Test totals: phase0 49/49, phase1 47/47, phase2 57/57, phase3 16/16, phase4 42/42, phase5 32/32 (re-run after receiving refactor), phase5b 53/53, phase6 26/26 = **322/322**. phase5b passed on first run; phase5 re-run passed unchanged.

Purchasing round notes: direct invoice receiving and order receiving now share one internal posting routine, so WAC, stock movements, duplicate-invoice blocking and audit are identical for both. Historical invoice costs and COGS untouched; actual invoice cost (not order cost) feeds WAC.

Remaining order: (1) support staff sign-in (needs decision), (2) practice backup restore (needs owner action), (3) browser tests for offline sync, till, reports, purchasing.

## Platform-owner administration & plan management — 🔵 VERIFIED (database, 2026-10-17); admin screen built, live sign-in pending owner account
- Separate RONIA Platform Owner role (`platform_admins`), not a business membership: grants no access to merchant sales, stock, staff or customers (ISO-03..06).
- Bootstrap: `bootstrap_platform_owner(email)` runs only by the database operator, only for a confirmed account, only while no owner exists; audited. No public sign-up path, no hard-coded email or password, no RLS bypass. Further owners added/removed from the admin area; last owner cannot be removed.
- Plans in the database (`subscription_plans`, immutable published `plan_versions`): create, edit, draft → preview → publish, activate/deactivate/archive, version history. Defaults: Starter KES 999/mo 1/1/3, Business KES 2,499/mo 3/5/10, Growth KES 4,999/mo 10/15/30 (editable). Trial length in `platform_settings` (14 days); new businesses get a dated trial; the existing two shops keep their pilot trial with no end date (real data untouched).
- Existing-subscriber rule: publishing never changes current subscribers; they keep their price/limits until the platform owner explicitly moves them. No payments are taken — editing a price charges nobody. Billing history in immutable `subscription_events`.
- Quotas on the server: adding a branch or activating staff beyond the plan is refused; lowering a limit removes nothing; tills are reported over limit but sales are never refused.
- Feature flags are stored per version but not yet used to hide features.
- Evidence: `tests/platform/verification.sql` — 67/67 passed (rolled back). Earlier suites not re-run; their fixtures stay within trial limits (≤2 branches, ≤10 staff).
- Pending: platform owner's real email for bootstrap; browser check of `/platform` after bootstrap.

## Platform owner bootstrap — 2026-10-19 (actual results)
- Pre-check: 0 platform owners existed; account michaelmwangi2@gmail.com confirmed, 0 merchant memberships.
- Bootstrap: `bootstrap_platform_owner` run once (migration 0016). Audit row `platform.bootstrap` written. No signup path added; RLS unchanged.
- DB suite `tests/platform/live_owner_verification.sql` (forced rollback): **18/18 passed** — single owner, no merchant memberships, bootstrap not repeatable, owner cannot read merchant sales/products/Deni/shifts, admin change audited, merchant owner blocked from listing merchants, trial change, granting owners, publishing plans, reading platform audit, self-insert.
- Browser (Playwright, localhost): platform owner reached `/platform`; Plans, Merchants (plan/usage only), Owners & trial, Audit tabs rendered with no page errors. Merchant owner opening `/platform` was redirected to `/unauthorized`. **VERIFIED.**
- Observation: Main Enterprises shows Tills 4/3 (over trial limit) — existing data, untouched.
- Real merchant data and open shifts not modified.

## Branch-specific receipt settings — 2026-10-20 (actual results)
- Each branch has its own receipt setup (trading name, phone, address, footer, logo link, optional sections, 58/80mm, auto-print, copies). New branches get safe defaults automatically; existing branches were backfilled.
- Edits only via a server function requiring `branch.manage` plus branch access (Owner/Manager under the locked model, where Managers cover all branches of their Business). Cashiers/Auditors read own-branch only. Every change audited.
- Each new sale freezes the branch settings into the sale at posting time; reprints use that frozen copy, so later edits never change past receipts or financial records. Sales before this change fall back to current branch settings.
- Totals, VAT, tenders, change, receipt number, void banner, returns, Deni notice, eTIMS status and "not a KRA fiscal invoice" always print; legal business name and KRA PIN always come from the Business.
- Tests: `tests/receipts/verification.sql` — 27/27 passed (rollback-only). First run 24/27: 3 failures were test assumptions (expected Managers to be limited to assigned branches, which contradicts the locked Phase 0 model); checks corrected, no code change.
- ✅ Verified: isolation, permissions, defaults, snapshots with split, Deni, void, partial return, reprint stability, validation.
- ⬜ Not verified: physical printer output (58/80mm on real hardware); 58/80mm on-screen layout checked only by browser screenshot where noted; eTIMS/KRA fiscal integration remains not live.

## Branch product assortment (2026-10-22) — VERIFIED (software)
- Root cause: products are business-level and every product query (Till, Products) filtered only by business, so every business product appeared in every branch's Till with 0 stock. No assortment mechanism existed.
- Fix (migration 0018): `branch_products` (branch × product, enabled flag; read via branch-access RLS, writes only via `set_branch_product`, which needs catalog.manage + branch access and is audited). `branch_catalog(_branch)` feeds the Till (search + barcode). A `sale_lines` trigger refuses products not enabled in the sale's branch, so online and offline-replayed sales are enforced server-side. Receiving stock into a branch enables the product in that branch only. New products from the Products screen are enabled in the active branch only. Products stay business-level for owner oversight/reports.
- Backfill: products enabled wherever they already had stock rows; never-stocked products enabled in all branches (prior behaviour). Real data: Main Enterprises' 2 products enabled in Main supermarket only; Ronia business centre now shows none until enabled. No stock, sales or movements changed.
- Tests: tests/assortment/verification.sql 22/22 (rollback-only). Note: SALE-01 was refused by the stock check first; the assortment guard itself is proven by SALE-02. Browser check of the new Products "Sell here" control not yet performed.

---

## Update 2026-10-23 — Sales filters, manual Deni loans, printer connectivity

No automated, browser, Android or physical-printer tests were run for this update (owner instruction: manual verification by Joyce Mwangi). Typecheck only.

### 1. Sales history date/time filters — Implemented — awaiting manual verification
- DB (migration `0019_sales_filters_manual_debts.sql`): `sales_history(_business,_branch,_from,_to,_cashier,_tender,_status,_limit,_offset)` security-definer RPC. Checks business membership; specific branch requires `can_access_branch_row`; all-branch view requires `reports.view` and only includes accessible branches; users without `reports.view` are forced to their own sales; max 400-day period; page size ≤ 200. Returns paged rows, total count, summary (gross, refunds, VAT net of returns, COGS only for report roles, tender and refund splits, voids) and cashier list. Index `sales(business_id, created_at desc)`.
- Status derived from authoritative records: voided (sale_voids), refunded (returns ≥ total), partially_refunded, completed. Timestamp used: sale `created_at` (posting time) only.
- EAT: `src/lib/eat.ts` converts Nairobi wall-clock to UTC half-open ranges; end time inclusive to the minute; date-only covers whole days.
- UI `src/routes/_authenticated/sales.tsx`: presets (today/yesterday/this week/this month), date+time inputs, branch, cashier, payment, status, pagination, filtered CSV export (reports.export), empty/error states. Receipt view, reprint, void and return flows retained.
- `dashboard.tsx`: period start now EAT midnight regardless of device timezone (no other change).
- Known semantics: payment filter keeps whole sales that used that method; summary totals cover those whole sales.

### 2. Manual Deni loans — Implemented — awaiting manual verification
- Tables `manual_debts`, `manual_debt_repayments`: append-only (immutable_row triggers), RLS SELECT for `deni.manage` or `reports.view`, no direct INSERT grants.
- RPCs `record_manual_debt`, `record_manual_debt_repayment` (require `deni.manage`; idempotent by `client_ref`; positive 2-dp amounts; no future dates; due ≥ loan date; repayment ≤ outstanding with `FOR UPDATE` row lock against concurrent over-allocation; M-Pesa code required; audit `deni.manual_debt_recorded` / `deni.manual_debt_repaid`). `manual_debt_register` derives paid/outstanding/status (open/overdue/settled, EAT date).
- Debtors reuse `customers`. POS Deni (customers.balance / customer_ledger) is untouched; combined per-person = POS balance + loan outstanding, each counted once. No sale, revenue, stock movement or COGS is created. No interest/penalties.
- UI: `src/components/ManualDebtBook.tsx` on Customers & Deni page (record loan, open/overdue/paid/all, per-debt repayment, by-person combined balance with statement separating till Deni and loans).
- Not implemented: reversal/write-off of a manual loan or repayment (needs owner decision on policy).

### 3. Receipt printers — Partially implemented — dependencies outstanding
- Shared rendering: `src/lib/printing/escpos.ts` renders ESC/POS from the same `ReceiptData` (frozen sale snapshot for reprints), 32/48 columns for 58/80mm, mandatory blocks always printed, "REPRINT"/copy labels, branch `copies`.
- Transports `src/lib/printing/transports.ts` (per-device config in localStorage): browser print dialog; WebUSB (Chrome/Edge, secure context, bulk OUT endpoint — usually blocked on Windows when an OS driver owns the printer); Web Bluetooth (BLE printers only, Chrome; classic SPP printers unreachable from browsers; re-pair needed after reload); network via local print bridge (browsers cannot open raw TCP 9100); Android native bridge.
- `src/lib/printing/print.ts`: failure falls back to print dialog with error toast; in-flight guard; auto-print once per receipt per session (`shouldAutoPrint`) — printing never re-posts a sale.
- UI: `PrinterSetup` on Receipt settings (transport choice, unsupported options disabled, Connect/Check/Test receipt, status shows "Connected" only after a real handshake/reply); `PrintButton` in POS and Sales.
- Dependency — print bridge: NOT supplied. Must implement `GET /health → {ok:true}` and `POST /print {host,port,data_base64} → {ok:true}`, forward bytes to host:port, allow CORS from the app origin, be served on localhost or https.
- Dependency — Android: no Android shell exists in this project. `native/android/RoniaAndroidPrinter.kt` (USB host, Bluetooth classic RFCOMM/SPP, TCP 9100) is source only, never compiled. Needs a WebView/Capacitor shell registering it as `RoniaAndroidPrinter`, manifest permissions (BLUETOOTH_CONNECT runtime, INTERNET, usb.host) and a USB permission broadcast receiver.
- Physical printers: none tested.

### Manual checks awaiting owner
Sales filters (2:00–5:30 PM EAT range, branch/cashier/payment/status, pagination, CSV); cashier sees only own sales; loan record/repay/over-repay refusal/double-tap replay/overdue; loans absent from sales totals; WebUSB/BLE/bridge/Android test receipts on real printers; auto-print single copy.

---

## Update 2026-10-27 — Parallel workstreams A (Deni corrections), B (print bridge), C (Android printing)

Shared dependencies checked before editing: A touches only the database (new migration) and `ManualDebtBook.tsx`/`customers.tsx`; B and C share `src/lib/printing/transports.ts`, `print.ts` and `PrinterSetup.tsx` (edited once, in sequence: B fields, then C fields). No change to sales, post_sale, receipts, VAT, assortment or subscriptions. No git branches available in this environment; isolation was by file ownership and sequential edits.

### A. Deni correction & write-off policy — **VERIFIED (database)**; UI IMPLEMENTED, awaiting owner browser check
Acceptance criteria: no deletion of posted debts/repayments; Owner-only write-offs; reversals need written reason + reference to original entry; server-side authorization; database duplicate protection; immutable audit; manual loans stay separate from POS Deni; write-off is not a repayment, sale or revenue; recovery after write-off.
Implementation: migration `0020_deni_corrections_write_offs` — tables `manual_debt_reversals` (kind debt|repayment, unique per original entry, client_ref unique) and `manual_debt_write_offs` (client_ref unique), both RLS read-only for deni/report roles, no direct writes, immutable triggers; `manual_debt_figures()` derives repaid (net of reversals), written off, outstanding, recovered; RPCs `write_off_manual_debt` (business.manage = Owner), `reverse_manual_debt_entry` (deni.manage; loan reversal only when no live repayments/write-offs); `record_manual_debt_repayment` now refuses reversed loans and accepts recovery after write-off up to principal minus repayments; `manual_debt_register` adds written_off, recovered, statuses `written_off`/`reversed`. Audit actions: deni.manual_debt_written_off, deni.manual_repayment_reversed, deni.manual_debt_reversed, deni.manual_debt_recovered. UI: "Write off (bad debt)" (owners only), "Correct a mistake", "Record recovery", Written off filter, statement shows reversals/write-offs.
Accounting dependency: no general ledger exists in the locked architecture; write-offs are recorded only as debt-book facts. Any accounting expense treatment (bad-debt expense account) awaits an approved ledger design.
Tests: `tests/deni_corrections/verification.sql` — **32/32 passed** (rollback-only, run 2026-10-27; first run failed on a test-data name constraint, fixed in the test, no code change). Covers balances, reversals, write-offs, duplicates, unauthorized users (manager/cashier/other business), audit, immutability, recovery, no sales/stock side effects.
Outstanding: owner browser check of the new buttons.

### B. Local network ESC/POS print bridge — **IMPLEMENTED; software VERIFIED; physical printer NOT tested**
Acceptance criteria: localhost default; authenticated requests; restricted CORS/origin; destination validation; SSRF protection; ESC/POS forwarding; status, errors, test print; no internet exposure by default; documentation.
Implementation: `bridge/ronia-print-bridge.mjs` (Node 18+, zero deps; 127.0.0.1:9180; token header; origin allowlist; private IPv4 + ports 9100–9103; optional printer allowlist; 256 KB; 5 s timeout; job_id duplicate guard); `bridge/README.md` (install, autostart, security table, troubleshooting). App: bridge token field, Check connection now verifies bridge and printer (`/health` + `/test`), each print press sends job ids.
Tests: `node bridge/test-bridge.mjs` — **20/20 passed** against a fake local printer (auth, CORS, 9 SSRF cases, byte-exact forwarding, duplicate job, printer-off error).
Outstanding: real printer test on shop network; Windows/macOS service install by owner. Risk: anyone with the token on that computer can print; keep RONIA_BRIDGE_HOST at localhost.

### C. Capacitor Android native printer — **IMPLEMENTED (code); NOT compiled; NOT device-tested**
Acceptance criteria: inspect existing adapter; clear printer interface; Bluetooth SPP, USB OTG, Wi-Fi; permissions, failures, disconnection, cancellation, duplicate protection; preserve browser printing and 58/80 mm.
Implementation: Capacitor 7 project in `android/` (appId ke.ronia.business, loads the published app; `capacitor.config.ts`, fallback page `native/capacitor-web/`). Adapter moved and hardened at `android/app/src/main/java/ke/ronia/business/RoniaAndroidPrinter.kt`: requestPermissions(), printJob() with 10-min duplicate guard, cancel(), single-print lock, typed error codes, network target restricted to private IPv4/ports 9100–9103; wired in `MainActivity.java`; manifest Bluetooth/USB permissions; Kotlin gradle plugin added. Web: Allow Bluetooth / Refresh list buttons; duplicate-safe printJob used when available; browser print unchanged.
Tests: none run — no Android SDK here. Physical device results: _none recorded yet_ (record device, Android version, printer model, transport, pass/fail).
Blocked on: owner building the APK in Android Studio (`npx cap sync android && npx cap open android`) and testing with real printers.

### Shared integration & regression
- Printing remains transport-only: no printer path calls post_sale, void or return RPCs (inspected print.ts/transports.ts/Kotlin).
- Typecheck clean after all three workstreams. Prior suites not rerun (unaffected tables/functions; only manual-debt functions were replaced and are covered by the 32-check suite).
- Not performed: browser checks, physical printers, Android build.
