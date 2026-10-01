-- RONIA BUSINESS — Phase 0 Verification Suite
-- Runs entirely inside one transaction and ROLLS BACK: leaves no data behind.
-- Simulates real API roles (anon / authenticated) with JWT claims so RLS and grants are exercised exactly as the app hits them.
begin;

create temp table t_results (id serial, test text, passed boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_id_seq to public;

create function pg_temp.as_user(_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.ok(_t text, _p boolean, _d text default null) returns void language sql as $$
  insert into t_results(test, passed, detail) values (_t, coalesce(_p,false), _d)
$$;

do $$
declare
  ua uuid := '00000000-0000-4000-a000-00000000000a'; -- owner of business A
  ub uuid := '00000000-0000-4000-a000-00000000000b'; -- owner of business B
  uc uuid := '00000000-0000-4000-a000-00000000000c'; -- cashier A, branch A1 only
  ud uuid := '00000000-0000-4000-a000-00000000000d'; -- auditor A
  um uuid := '00000000-0000-4000-a000-00000000000e'; -- manager A
  ux uuid := '00000000-0000-4000-a000-00000000000f'; -- stranger
  biz_a uuid; biz_b uuid; br_a1 uuid; br_a2 uuid; br_b1 uuid;
  n int; raised boolean; msg text; ctx jsonb; r jsonb;
begin
  -- ---------- setup (through real RPCs as real users) ----------
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Duka A Ltd', 'Main Branch', 'MAIN');
  select id into br_a1 from public.branches where business_id = biz_a;
  insert into public.branches(business_id, name, code) values (biz_a, 'Second Branch', 'BR2') returning id into br_a2;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a1]);
  perform public.add_business_member(biz_a, ud, 'auditor');
  perform public.add_business_member(biz_a, um, 'manager');
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('Duka B Ltd', 'B Main', 'MAIN');
  select id into br_b1 from public.branches where business_id = biz_b;

  -- ---------- AUTH ----------
  perform pg_temp.as_anon();
  begin perform count(*) from public.businesses; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-01 anon cannot read businesses', raised);
  begin perform public.create_business('Anon Co', 'X', 'MAIN'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-02 anon cannot create business', raised);
  perform pg_temp.as_user(ux);
  select count(*) into n from public.businesses;
  perform pg_temp.ok('AUTH-03 user with no membership sees zero businesses', n = 0, n::text);

  -- ---------- BUSINESS ISOLATION ----------
  perform pg_temp.as_user(ua);
  select count(*) into n from public.businesses;
  perform pg_temp.ok('ISO-01 owner A sees exactly own business', n = 1, n::text);
  select count(*) into n from public.businesses where id = biz_b;
  perform pg_temp.ok('ISO-02 owner A cannot see business B', n = 0);
  select count(*) into n from public.branches where business_id = biz_b;
  perform pg_temp.ok('ISO-03 owner A cannot see branches of B', n = 0);
  select count(*) into n from public.business_memberships where business_id = biz_b;
  perform pg_temp.ok('ISO-04 owner A cannot see memberships of B', n = 0);
  select count(*) into n from public.audit_log where business_id = biz_b;
  perform pg_temp.ok('ISO-05 owner A cannot see audit log of B', n = 0);
  select count(*) into n from public.organizations;
  perform pg_temp.ok('ISO-06 owner A sees only own organization', n = 1, n::text);
  update public.businesses set name = 'Hijacked' where id = biz_b; get diagnostics n = row_count;
  perform pg_temp.ok('ISO-07 owner A cannot update business B', n = 0);
  begin insert into public.branches(business_id, name, code) values (biz_b, 'Intruder', 'INT'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-08 owner A cannot create branch in B', raised);
  begin update public.branches set business_id = biz_b where id = br_a2; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-09 branch cannot be moved to another business', raised);
  begin perform public.add_business_member(biz_b, ua, 'owner'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-10 owner A cannot add members to B', raised);
  begin perform public.resolve_tenant_context(biz_b, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-11 tenant context refuses foreign business', raised);
  begin perform public.resolve_tenant_context(biz_a, br_b1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-12 tenant context refuses branch from another business', raised);

  -- ---------- ROLES / PERMISSIONS ----------
  ctx := public.resolve_tenant_context(biz_a, br_a1);
  perform pg_temp.ok('ROLE-01 owner context resolves role=owner', ctx->>'role' = 'owner', ctx->>'role');
  perform pg_temp.ok('ROLE-02 owner has business.manage', (ctx->'permissions') ? 'business.manage');
  begin insert into public.business_memberships(business_id, user_id, role) values (biz_a, ux, 'owner'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ROLE-03 direct membership insert is denied', raised);
  begin update public.business_memberships set role = 'manager' where business_id = biz_a and user_id = ua; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ROLE-04 last owner cannot demote self', raised);

  perform pg_temp.as_user(uc);
  ctx := public.resolve_tenant_context(biz_a, br_a1);
  perform pg_temp.ok('ROLE-05 cashier context resolves role=cashier', ctx->>'role' = 'cashier');
  perform pg_temp.ok('ROLE-06 cashier lacks shift.view_expected (blind close)', not ((ctx->'permissions') ? 'shift.view_expected'));
  update public.businesses set name = 'Cashier Co' where id = biz_a; get diagnostics n = row_count;
  perform pg_temp.ok('ROLE-07 cashier cannot update business', n = 0);
  select count(*) into n from public.audit_log;
  perform pg_temp.ok('ROLE-08 cashier cannot read audit log', n = 0);
  select count(*) into n from public.business_memberships;
  perform pg_temp.ok('ROLE-09 cashier sees only own membership', n = 1, n::text);
  begin perform public.add_business_member(biz_a, ux, 'cashier'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ROLE-10 cashier cannot add members', raised);
  begin insert into public.branches(business_id, name, code) values (biz_a, 'Cashier branch', 'CB'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ROLE-11 cashier cannot create branches', raised);

  perform pg_temp.as_user(ud);
  select count(*) into n from public.audit_log where business_id = biz_a;
  perform pg_temp.ok('ROLE-12 auditor can read audit log', n > 0, n::text);
  update public.businesses set name = 'Auditor Co' where id = biz_a; get diagnostics n = row_count;
  perform pg_temp.ok('ROLE-13 auditor cannot update business', n = 0);
  update public.business_memberships set role = 'owner' where user_id = ud; get diagnostics n = row_count;
  perform pg_temp.ok('ROLE-14 auditor cannot change memberships', n = 0);

  perform pg_temp.as_user(um);
  begin perform public.add_business_member(biz_a, ux, 'owner'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ROLE-15 manager cannot grant owner role', raised);
  begin update public.business_memberships set role = 'owner' where business_id = biz_a and user_id = um; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ROLE-16 manager cannot self-promote to owner', raised);
  update public.businesses set lifecycle_state = 'active' where id = biz_a; get diagnostics n = row_count;
  perform pg_temp.ok('ROLE-17 manager cannot change business lifecycle', n = 0);

  -- ---------- BRANCH ISOLATION ----------
  perform pg_temp.as_user(uc);
  select count(*) into n from public.branches;
  perform pg_temp.ok('BR-01 cashier sees only assigned branch', n = 1, n::text);
  begin perform public.resolve_tenant_context(biz_a, br_a2); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BR-02 cashier context refuses unassigned branch', raised);
  perform pg_temp.as_user(um);
  select count(*) into n from public.branches;
  perform pg_temp.ok('BR-03 manager sees all branches of business', n = 2, n::text);
  perform pg_temp.as_user(ua);
  update public.branches set is_active = false where id = br_a2;
  begin perform public.resolve_tenant_context(biz_a, br_a2); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BR-04 inactive branch cannot be entered', raised);

  -- ---------- MEMBERSHIP STATUS ----------
  update public.business_memberships set status = 'suspended' where business_id = biz_a and user_id = uc;
  perform pg_temp.as_user(uc);
  select count(*) into n from public.businesses;
  perform pg_temp.ok('MEM-01 suspended member loses business visibility', n = 0);
  begin perform public.resolve_tenant_context(biz_a, br_a1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MEM-02 suspended member cannot resolve context', raised);

  -- ---------- AUDIT ----------
  perform pg_temp.as_user(ua);
  select count(*) into n from public.audit_log where business_id = biz_a and action in ('business.created','membership.created','membership.updated','branch.insert');
  perform pg_temp.ok('AUD-01 business/branch/membership changes are audited', n >= 5, n::text);
  select count(*) into n from public.audit_log where business_id = biz_a and actor_user_id = ua;
  perform pg_temp.ok('AUD-02 audit records server-derived actor', n > 0);
  begin insert into public.audit_log(business_id, action, entity_type) values (biz_a, 'forged', 'x'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-03 clients cannot insert audit rows', raised);
  begin perform public.write_audit(biz_a, null, 'forged', 'x', null, '{}'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-04 clients cannot call write_audit', raised);
  perform pg_temp.as_admin();
  begin update public.audit_log set action = 'tampered' where business_id = biz_a; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-05 audit log immutable even for privileged role (update)', raised);
  begin delete from public.audit_log where business_id = biz_a; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-06 audit log immutable even for privileged role (delete)', raised);

  -- ---------- IDEMPOTENCY ----------
  perform pg_temp.as_user(ua);
  r := public.claim_idempotency(biz_a, 'test.op', 'key-0001-abcdef', 'hash1');
  perform pg_temp.ok('IDEM-01 first claim is new', r->>'status' = 'new');
  perform public.complete_idempotency(biz_a, 'test.op', 'key-0001-abcdef', '{"result":42}');
  r := public.claim_idempotency(biz_a, 'test.op', 'key-0001-abcdef', 'hash1');
  perform pg_temp.ok('IDEM-02 repeat claim replays stored response', r->>'status' = 'replay' and r->'response'->>'result' = '42');
  begin perform public.claim_idempotency(biz_a, 'test.op', 'key-0001-abcdef', 'hash2'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IDEM-03 key reuse with different payload is rejected', raised);
  perform pg_temp.as_user(ub);
  begin perform public.claim_idempotency(biz_a, 'test.op', 'key-0002-abcdef', 'h'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IDEM-04 non-member cannot claim keys in foreign business', raised);
  begin perform count(*) from public.idempotency_keys; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IDEM-05 idempotency table not directly readable', raised);
end $$;

-- Report: raised as an exception so the whole run ALWAYS rolls back, whatever runner is used.
do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE0_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
rollback;
