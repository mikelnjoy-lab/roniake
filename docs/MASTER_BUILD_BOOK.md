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
| Support | Support staff sign-in using a grant | — | PARTIAL |
| Ops | Backups / disaster recovery | platform-managed database backups only; no restore drill | PARTIAL |

Test totals: phase0 49/49, phase1 47/47, phase2 57/57, phase3 16/16, phase4 42/42, phase5 32/32, phase6 26/26 = **269/269** (phases 4–6 run once each after fixes; earlier phases not re-run this round).

Defects found and fixed this round:
- Stock count accepted the same product twice in one count (wrong totals) — now refused.
- Auditors could mark M-Pesa payments verified/flagged (write access for a read-only role) — new mpesa.reconcile permission, owners/managers only.
- M-Pesa: same code could be verified on two sales; voided sales could be verified; statement amount was never compared; repeated clicks wrote duplicate records — all fixed.
- Two test assumptions corrected (not system defects): managers cover all branches by design; tax class B is the 16% class.

Remaining order: (1) purchase orders and supplier payables, (2) support staff sign-in, (3) backup restore drill, (4) browser tests for offline sync, till and reports.
