# Roniake

This is a new project RONIA BUSINESS

RONIA BUSINESS — START ACTUAL PRODUCT BUILD & CONTROLLED PRODUCTION PILOT

Build the real production RONIA BUSINESS application:

1. AUTHENTICATION & BUSINESS ENTRY
- Sign in, session establishment, business membership resolution.
- Business selection where a user belongs to multiple Businesses.
- Active Business context, branch selection, role/permission resolution (Owner, Manager, Cashier, Auditor).
- Secure logout, session expiration, unauthorized-access handling.

2. BUSINESS OWNER / ADMIN EXPERIENCE (BACK OFFICE)
- Business overview, branch overview.
- Sales reporting, payment/tender reporting, inventory reporting.
- Stock audit, stock adjustments, product/catalog management.
- Customer/Deni credit management, cashier/shift visibility, M-Pesa visibility, eTIMS status visibility.
- Report generation, authorized exports, audit logging, subscription/usage status.

3. REAL POS EXPERIENCE
- Barcode scanning, SKU/product search, variable-weight barcode handling.
- Cart, quantity changes, discounts according to permission.
- Customer selection, Deni where enabled.
- Cash payment, M-Pesa payment, other configured tender types, split tender.
- Hold/park ticket, resume ticket, sale completion, receipt generation.
- Shift management, blind cash closing, offline operation, synchronization, conflict/review states.
- Fast, minimal taps for Kenyan SME cashiers.

4. OFFLINE-FIRST USER EXPERIENCE
- Online/offline indicator, pending synchronization queue.
- Successfully synchronized transactions, conflicts requiring review, retry status.
- IndexedDB offline local storage.

5. M-PESA EXPERIENCE
- Business-specific M-Pesa configuration (Till / PayBill).
- Assisted onboarding, STK Push, C2B/Till/PayBill reconciliation, manual M-Pesa workflows, reversals.
- Transaction status, failure/retry visibility.
- Direct merchant settlement, zero fund pooling.

6. eTIMS EXPERIENCE (eTIMS-READY SOFTWARE ARCHITECTURE)
- eTIMS connection/configuration state, taxpayer PIN, branch/device state.
- Fiscal document status, submission state, retry state, failure state.
- Internal RONIA receipt identity distinct from KRA fiscal number.
- Clearly marked eTIMS-ready software architecture (distinguished from official external KRA certification).

7. INVENTORY & STOCK CONTROL EXPERIENCE
- Product/catalog management, branch stock visibility, stock movements.
- Weighted Average Cost (WAC), bulk breaking.
- Stock audits: count entry, variance calculation, authorized adjustment, audit history, low-stock alerts.
- Immutable historical transaction COGS.

8. DENI / CUSTOMER CREDIT EXPERIENCE
- Customer credit balance, credit limit, credit sale, repayment, credit ledger history.
- Default-off architecture, merchant-configured safeguards.

9. CASHIER & SHIFT EXPERIENCE
- Start shift, opening float, POS activity, parked tickets, sales, payment records.
- End shift, blind cash declaration, variance calculation.

10. SUBSCRIPTION & SUPPORT ACCESS
- Plan status, trial/paid state, soft-cap tracking.
- Merchant-approved temporary support access with explicit business scope and expiration.

11. MOBILE & DEVICE EXPERIENCE
- Optimized for Android phones/tablets, desktop browsers, touch-friendly POS controls.

12. CONTROLLED PILOT ONBOARDING
- Guided setup: Business identity, branch configuration, product catalog, user roles, POS terminal, M-Pesa settings, eTIMS profile.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://roniake.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/028a63fe-05e6-4fed-be9d-7a872da2bf2f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
