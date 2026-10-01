# RONIA BUSINESS — Master Build Book (implementation project)

Statuses: ⬜ NOT STARTED · 🟡 IN PROGRESS · 🟢 COMPLETED · 🔵 VERIFIED · 🔴 BLOCKED · ⚠️ REQUIRES REVIEW

Reference specs (Master Architecture v2.0.0, Implementation Plan v1.1.0, Build Book v2.4.0) were locked in earlier planning but **are not stored in this project**. Earlier verification results do not count here. Every phase has to be verified again against this project's own database.

## Phase 0 — Foundation Bootstrap — 🟡 IN PROGRESS (gate NOT passed)

| Item | Status | Notes |
|---|---|---|
| Database/schema (org → business → branch, memberships, role matrix) | 🟢 | migration `phase0_foundation` |
| Authentication (backend enabled) | 🟡 | sign-in screens not built yet |
| Business boundaries + RLS | 🟢 | security-definer helpers, no frontend filtering |
| Roles/permissions (Owner, Manager, Cashier, Auditor) | 🟢 | `role_permissions`; cashier lacks `shift.view_expected` (blind close) |
| Branch security | 🟢 | cashiers limited to assigned branches |
| Server-derived tenant context | 🟢 | `resolve_tenant_context` RPC |
| Audit log (append-only) | 🟢 | triggers block update/delete |
| Idempotency | 🟢 | `claim_idempotency` / `complete_idempotency` |
| Phase 0 verification suite | 🟢 | `tests/phase0/verification.sql`, 50 checks, always rolls back |
| Verification run against this database | 🔴 | First run stopped during setup: creating a second branch failed with an RLS error. The SELECT policy is applied to the new row returned by `INSERT ... RETURNING` and doesn't allow it. Fix needed, then re-run. |

## Production Application Assembly & Controlled Pilot
Authentication ⬜ · Business selection ⬜ · Branch selection ⬜ · Guided setup ⬜ · User/role management ⬜ · POS ⬜ · Shifts ⬜ · Receipts ⬜ · Offline UX ⬜ · Inventory UX ⬜ · Back Office ⬜ · Customers/Deni ⬜ · M-Pesa UX ⬜ (manual first; Daraja credentials pending) · eTIMS UX ⬜ · Subscription UX ⬜ · Support-access UX ⬜ · Deployment ⬜ · Infrastructure prerequisites ⬜ · External approvals 🔴 (Daraja production, KRA eTIMS) · Controlled pilot onboarding ⬜
