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
Authentication ⬜ · Business selection ⬜ · Branch selection ⬜ · Guided setup ⬜ · User/role management ⬜ · POS ⬜ · Shifts ⬜ · Receipts ⬜ · Offline UX ⬜ · Inventory UX ⬜ · Back Office ⬜ · Customers/Deni ⬜ · M-Pesa UX ⬜ (manual first; Daraja credentials pending) · eTIMS UX ⬜ · Subscription UX ⬜ · Support-access UX ⬜ · Deployment ⬜ · Infrastructure prerequisites ⬜ · External approvals 🔴 (Daraja production, KRA eTIMS) · Controlled pilot onboarding ⬜
