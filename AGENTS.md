<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Rules
- Database verification suites live in `tests/phaseN/verification.sql`; run them through the migration tool with `begin;`/`rollback;` removed — each suite ends by raising its report, so nothing is ever applied. Why: psql here cannot execute functions, and the forced error guarantees real store data is never touched.
- Offline sales: one IndexedDB queue keyed by client_txn_id; sync runs one at a time, and rejected sales are never auto-retried — they stay visible on the till until retried or dismissed by a manager. Why: a rejected offline sale means goods may have left unrecorded.
- Platform owners live in `platform_admins` and act only through `platform_*` security-definer functions that write `platform_audit_log`; they are never business members. Why: platform administration must not grant access to merchant data.
- Plan prices/limits live in immutable published `plan_versions`; subscriptions pin a version and only move by explicit platform action. Why: price edits must never silently change or charge existing subscribers.
- Receipt rendering (Receipt.tsx / printing/escpos.ts) stays separate from printer transports (printing/transports.ts); printer config is per device. Why: one receipt engine across browser, bridge and Android.
- Manual loans live in manual_debts/manual_debt_repayments, never in sales or customer_ledger. Why: loans must not affect revenue, stock or POS Deni balances.
