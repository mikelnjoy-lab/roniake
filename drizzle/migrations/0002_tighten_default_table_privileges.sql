-- Platform default privileges had granted table access to anon/authenticated beyond the intended set.
-- RLS already returned zero rows, but grants must match the design exactly: reset and re-grant explicitly.
revoke all on public.profiles, public.organizations, public.businesses, public.branches, public.business_memberships,
  public.membership_branches, public.role_permissions, public.audit_log, public.idempotency_keys from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select on public.organizations, public.businesses, public.branches, public.business_memberships,
  public.membership_branches, public.role_permissions, public.audit_log to authenticated;
grant update on public.businesses, public.branches, public.business_memberships to authenticated;
grant insert on public.branches to authenticated;
-- idempotency_keys: no direct client access; only claim_/complete_idempotency functions.

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
