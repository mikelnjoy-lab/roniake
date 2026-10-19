-- RONIA — Live platform-owner bootstrap checks against the real account. Ends by RAISING, so nothing is applied.
create temp table t_results (id serial, test text, passed boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_id_seq to public;
create function pg_temp.as_user(_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.ok(_t text, _p boolean, _d text default null) returns void language sql as $$
  insert into t_results(test, passed, detail) values (_t, coalesce(_p,false), _d) $$;

do $$
declare
  po uuid; merchant uuid; n int; raised boolean; before_audit int; plan uuid;
begin
  perform pg_temp.as_admin();
  select id into po from auth.users where lower(email) = 'michaelmwangi2@gmail.com';
  select m.user_id into merchant from public.business_memberships m where m.role = 'owner' and m.status = 'active' and m.user_id <> po limit 1;
  select count(*) into n from public.platform_admins where revoked_at is null;
  perform pg_temp.ok('LIVE-01 exactly one active platform owner', n = 1, n::text);
  select count(*) into n from public.business_memberships where user_id = po;
  perform pg_temp.ok('LIVE-02 platform owner has no merchant memberships', n = 0, n::text);
  select count(*) into n from public.platform_audit_log where action = 'platform.bootstrap' and entity_id = po::text;
  perform pg_temp.ok('LIVE-03 bootstrap audited', n = 1, n::text);
  begin perform public.bootstrap_platform_owner('someone@else.test'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('LIVE-04 bootstrap cannot run a second time', raised);

  perform pg_temp.as_user(po);
  perform pg_temp.ok('LIVE-05 owner is recognised', public.is_platform_owner());
  select count(*) into n from public.platform_list_businesses();
  perform pg_temp.ok('LIVE-06 owner can list merchant subscriptions', n >= 1, n::text);
  select count(*) into n from public.sales;
  perform pg_temp.ok('LIVE-07 owner cannot read merchant sales', n = 0, n::text);
  select count(*) into n from public.products;
  perform pg_temp.ok('LIVE-08 owner cannot read merchant products', n = 0, n::text);
  select count(*) into n from public.customers;
  perform pg_temp.ok('LIVE-09 owner cannot read merchant Deni customers', n = 0, n::text);
  select count(*) into n from public.shifts;
  perform pg_temp.ok('LIVE-10 owner cannot read merchant shifts', n = 0, n::text);
  select count(*) into before_audit from public.platform_audit_log;
  perform public.platform_set_trial_days(14);
  select count(*) into n from public.platform_audit_log;
  perform pg_temp.ok('LIVE-11 admin change is audited', n = before_audit + 1, (n - before_audit)::text);

  perform pg_temp.as_user(merchant);
  perform pg_temp.ok('LIVE-12 merchant owner not recognised as platform owner', not public.is_platform_owner());
  begin perform * from public.platform_list_businesses(); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('LIVE-13 merchant blocked from listing merchants', raised);
  begin perform public.platform_set_trial_days(30); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('LIVE-14 merchant blocked from changing trial', raised);
  begin perform public.platform_grant_owner('michaelmwangi2@gmail.com', 'x'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('LIVE-15 merchant blocked from granting owners', raised);
  select id into plan from public.subscription_plans limit 1;
  begin perform public.platform_publish_plan(plan); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('LIVE-16 merchant blocked from publishing plans', raised);
  select count(*) into n from public.platform_audit_log;
  perform pg_temp.ok('LIVE-17 merchant cannot read platform audit', n = 0, n::text);
  begin insert into public.platform_admins(user_id) values (merchant); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('LIVE-18 merchant cannot insert themselves as platform owner', raised);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by passed, id) into rep from t_results;
  raise exception E'LIVE_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
