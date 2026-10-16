-- RONIA BUSINESS — Platform owner, plan management and quota suite. Ends by RAISING its report, so it always rolls back.
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
  ua uuid := '00000000-0000-4000-e000-00000000000a'; ub uuid := '00000000-0000-4000-e000-00000000000b';
  uc uuid := '00000000-0000-4000-e000-00000000000c'; up uuid := '00000000-0000-4000-e000-0000000000f1';
  up2 uuid := '00000000-0000-4000-e000-0000000000f2'; un uuid := '00000000-0000-4000-e000-0000000000f3';
  biz_a uuid; br_a uuid; biz_b uuid; biz_c uuid; plan uuid; v1 uuid; v2 uuid; prod uuid; sh uuid;
  r jsonb; n int; x numeric; raised boolean; msg text; st text; t timestamptz;
begin
  -- fixture accounts (rolled back)
  perform pg_temp.as_admin();
  insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    (up, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pt-platform@ronia.test', now(), now(), now()),
    (up2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pt-platform2@ronia.test', now(), now(), now()),
    (un, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pt-unconfirmed@ronia.test', null, now(), now());
  select count(*) into n from public.platform_admins where revoked_at is null;
  perform pg_temp.ok('BOOT-00 no platform owner exists before bootstrap', n = 0, n::text);

  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Plat Test A', 'A1', 'PTA1');
  select id into br_a from public.branches where business_id = biz_a;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a]);
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('Plat Test B', 'B1', 'PTB1');

  -- trial
  perform pg_temp.as_admin();
  select status, trial_ends_at into st, t from public.subscriptions where business_id = biz_a;
  perform pg_temp.ok('TRIAL-01 new business starts a 14-day trial', st = 'trial' and abs(extract(epoch from (t - (now() + interval '14 days')))) < 60, st || ' ' || t::text);
  select count(*) into n from public.subscription_events where business_id = biz_a and event = 'trial_started';
  perform pg_temp.ok('TRIAL-02 trial start recorded in billing history', n = 1);

  -- unauthorized: merchant owner is not a platform owner
  perform pg_temp.as_user(ua);
  perform pg_temp.ok('AUTH-01 merchant Business Owner is not platform owner', not public.is_platform_owner());
  begin perform public.platform_save_plan(null, 'hack', 'Hack', null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-02 merchant owner cannot create plans', raised);
  begin perform * from public.platform_list_businesses(); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-03 merchant owner cannot list all businesses', raised);
  begin perform public.platform_assign_plan(biz_a, (select id from public.subscription_plans where code='growth'), null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-04 merchant owner cannot assign themselves a plan', raised);
  begin perform public.bootstrap_platform_owner('pt-platform@ronia.test'); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('AUTH-05 app users cannot run the bootstrap', raised, msg);
  begin insert into public.platform_admins(user_id) values (ua); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-06 app users cannot insert themselves as platform owner', raised);
  begin update public.subscriptions set max_branches = 99 where business_id = biz_a; get diagnostics n = row_count; raised := n = 0; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-07 merchant cannot raise own limits directly', raised);
  perform pg_temp.as_user(uc);
  begin perform public.platform_set_trial_days(60); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-08 cashier cannot change platform settings', raised);
  perform pg_temp.as_user(ua);
  select count(*) into n from public.platform_audit_log;
  perform pg_temp.ok('AUTH-09 merchant sees no platform audit rows', n = 0, n::text);

  -- bootstrap (operator only)
  perform pg_temp.as_admin();
  begin perform public.bootstrap_platform_owner('pt-unconfirmed@ronia.test'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BOOT-01 unconfirmed account cannot be bootstrapped', raised);
  begin perform public.bootstrap_platform_owner('nobody@ronia.test'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BOOT-02 unknown email refused', raised);
  perform pg_temp.ok('BOOT-03 operator bootstraps confirmed account', public.bootstrap_platform_owner('PT-Platform@ronia.test') = up);
  begin perform public.bootstrap_platform_owner('pt-platform2@ronia.test'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BOOT-04 second bootstrap refused once an owner exists', raised);
  select count(*) into n from public.platform_audit_log where action = 'platform.bootstrap' and entity_id = up::text;
  perform pg_temp.ok('BOOT-05 bootstrap audited', n = 1);

  -- platform owner: admin rights but NO tenant data access
  perform pg_temp.as_user(up);
  perform pg_temp.ok('ISO-01 bootstrapped account is platform owner', public.is_platform_owner());
  select count(*) into n from public.platform_list_businesses() where business_id in (biz_a, biz_b);
  perform pg_temp.ok('ISO-02 platform owner sees both businesses in the admin list', n = 2);
  select count(*) into n from public.branches where business_id = biz_a;
  perform pg_temp.ok('ISO-03 platform owner cannot read a merchant''s branches', n = 0, n::text);
  select count(*) into n from public.business_memberships where business_id = biz_a;
  perform pg_temp.ok('ISO-04 platform owner cannot read a merchant''s staff', n = 0, n::text);
  begin perform public.resolve_tenant_context(biz_a, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-05 platform owner cannot enter a merchant business', raised);
  begin insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'X', 'X', 'pc', 1, 'B'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-06 platform owner cannot write merchant products', raised);

  -- plan lifecycle
  plan := public.platform_save_plan(null, 'pt-test', 'PT Test', 'suite plan', 9);
  perform pg_temp.ok('PLAN-01 plan created as draft', (select status from public.subscription_plans where id = plan) = 'draft');
  begin perform public.platform_set_plan_status(plan, 'active'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PLAN-02 unpublished plan cannot be activated', raised);
  begin perform public.platform_save_plan_draft(plan, -1, 'month', 1, 1, 1, '{}', null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PLAN-03 negative price refused', raised);
  begin perform public.platform_save_plan_draft(plan, 100, 'month', 0, 1, 1, '{}', null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PLAN-04 zero limit refused', raised);
  begin perform public.platform_save_plan_draft(plan, 100, 'week', 1, 1, 1, '{}', null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PLAN-05 unknown billing period refused', raised);
  v1 := public.platform_save_plan_draft(plan, 1000, 'month', 1, 1, 2, '{"deni":false}', 'first');
  perform pg_temp.ok('PLAN-06 saving draft twice edits the same draft', public.platform_save_plan_draft(plan, 1200, 'month', 1, 1, 2, '{"deni":false}', 'first') = v1);
  r := public.platform_preview_plan(plan);
  perform pg_temp.ok('PLAN-07 preview lists all fields for a first version', jsonb_array_length(r->'changes') = 6, r::text);
  r := public.platform_publish_plan(plan);
  perform pg_temp.ok('PLAN-08 publish makes v1 current, plan inactive', (select current_version_id from public.subscription_plans where id = plan) = v1
    and (select status from public.subscription_plans where id = plan) = 'inactive' and (select state from public.plan_versions where id = v1) = 'published');
  perform pg_temp.as_user(ua);
  select count(*) into n from public.subscription_plans where id = plan;
  perform pg_temp.ok('PLAN-09 merchants cannot see inactive plans', n = 0);
  perform pg_temp.as_user(up);
  perform public.platform_set_plan_status(plan, 'active');
  perform pg_temp.as_user(ua);
  select count(*) into n from public.subscription_plans where id = plan;
  perform pg_temp.ok('PLAN-10 merchants see active plans', n = 1);
  perform pg_temp.as_admin();
  begin update public.plan_versions set price_kes = 1 where id = v1; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PLAN-11 published version frozen even for operator', raised);

  -- existing subscriber behaviour
  perform pg_temp.as_user(up);
  r := public.platform_assign_plan(biz_a, plan, 'pilot customer');
  select max_branches, max_staff, status into n, x, st from public.subscriptions where business_id = biz_a;
  perform pg_temp.ok('SUB-01 assigning plan copies limits and activates', n = 1 and x = 2 and st = 'active' and (r->>'price_kes')::numeric = 1200, r::text);
  perform public.platform_save_plan_draft(plan, 1500, 'month', 2, 3, 4, '{"deni":true}', 'price rise');
  r := public.platform_preview_plan(plan);
  perform pg_temp.ok('SUB-02 preview shows 1 subscriber, 0 changed on publish', (r->>'current_subscribers')::int = 1 and (r->>'subscribers_changed_on_publish')::int = 0
    and jsonb_array_length(r->'changes') = 5, r::text);
  r := public.platform_publish_plan(plan);
  v2 := (r->>'version_id')::uuid;
  select max_branches, (select price_kes from public.plan_versions where id = s.plan_version_id) into n, x from public.subscriptions s where business_id = biz_a;
  perform pg_temp.ok('SUB-03 existing subscriber keeps old price 1200 and limit 1 after publish', n = 1 and x = 1200, n || '/' || x);
  perform pg_temp.ok('SUB-04 old version price unchanged in history', (select price_kes from public.plan_versions where id = v1) = 1200);
  perform pg_temp.as_user(ua);
  r := public.subscription_overview(biz_a);
  perform pg_temp.ok('SUB-05 merchant told a newer version exists', (r->>'newer_version_available')::boolean, r::text);
  perform pg_temp.as_user(up);
  perform pg_temp.ok('SUB-06 explicit move updates 1 subscriber', public.platform_move_subscribers(plan) = 1);
  select max_branches, max_terminals, max_staff into n, x, msg from public.subscriptions where business_id = biz_a;
  perform pg_temp.ok('SUB-07 moved subscriber has new limits 2/3/4', n = 2 and x = 3 and msg = '4');
  select count(*) into n from public.subscription_events where business_id = biz_a and event in ('plan_assigned','version_moved');
  perform pg_temp.ok('SUB-08 billing history keeps both events', n = 2);
  perform pg_temp.ok('SUB-09 moving again changes nobody', public.platform_move_subscribers(plan) = 0);
  select status into st from public.subscriptions where business_id = biz_b;
  perform pg_temp.ok('SUB-10 other business untouched (still trial)', st = 'trial');

  -- cross-tenant billing history
  perform pg_temp.as_user(ub);
  select count(*) into n from public.subscription_events where business_id = biz_a;
  perform pg_temp.ok('ISO-07 other merchant cannot read A''s billing history', n = 0);
  perform pg_temp.as_user(uc);
  select count(*) into n from public.subscription_events where business_id = biz_a;
  perform pg_temp.ok('ISO-08 cashier cannot read billing history', n = 0);
  perform pg_temp.as_user(ua);
  select count(*) into n from public.subscription_events where business_id = biz_a;
  perform pg_temp.ok('ISO-09 business owner reads own billing history', n >= 3, n::text);

  -- quotas (A now 2 branches / 3 tills / 4 staff)
  perform pg_temp.as_user(ua);
  insert into public.branches(business_id, name, code) values (biz_a, 'A2', 'PTA2');
  begin insert into public.branches(business_id, name, code) values (biz_a, 'A3', 'PTA3'); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('QUOTA-01 third branch refused on a 2-branch plan', raised, msg);
  perform public.add_business_member(biz_a, '00000000-0000-4000-e000-0000000000d1', 'cashier', array[br_a]);
  perform public.add_business_member(biz_a, '00000000-0000-4000-e000-0000000000d2', 'cashier', array[br_a]);
  begin perform public.add_business_member(biz_a, '00000000-0000-4000-e000-0000000000d3', 'cashier', array[br_a]); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('QUOTA-02 fifth active staff refused on a 4-staff plan', raised, msg);
  update public.business_memberships set status = 'suspended' where business_id = biz_a and user_id = '00000000-0000-4000-e000-0000000000d2';
  perform public.add_business_member(biz_a, '00000000-0000-4000-e000-0000000000d3', 'cashier', array[br_a]);
  begin update public.business_memberships set status = 'active' where business_id = biz_a and user_id = '00000000-0000-4000-e000-0000000000d2'; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('QUOTA-03 re-activating staff over limit refused; freed seat reusable', raised);
  perform pg_temp.as_user(ub);
  insert into public.branches(business_id, name, code) values (biz_b, 'B2', 'PTB2');
  begin insert into public.branches(business_id, name, code) values (biz_b, 'B3', 'PTB3'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('QUOTA-04 trial limits apply (B capped at 2 branches)', raised);

  -- lower limits below usage: nothing removed, selling continues on any number of tills
  perform pg_temp.as_user(up);
  perform public.platform_save_plan_draft(plan, 1500, 'month', 1, 1, 2, '{}', 'downgrade');
  perform public.platform_publish_plan(plan);
  perform public.platform_move_subscribers(plan);
  perform pg_temp.as_user(ua);
  select count(*) into n from public.branches where business_id = biz_a and is_active;
  perform pg_temp.ok('QUOTA-05 limit cut keeps existing branches', n = 2);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'PT1', 'Soap', 'pc', 100, 'B') returning id into prod;
  perform public.receive_stock(br_a, prod, 10, 60);
  sh := public.open_shift(br_a, 0);
  perform public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 1)), '[{"type":"cash","amount":100}]', 'till-1');
  perform public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 1)), '[{"type":"cash","amount":100}]', 'till-2');
  begin perform public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 1)), '[{"type":"cash","amount":100}]', 'till-3'); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('QUOTA-06 sale on a 3rd till completes on a 1-till plan (never interrupted)', not raised, msg);
  r := public.subscription_overview(biz_a);
  perform pg_temp.ok('QUOTA-07 overview reports tills over limit (3 of 1)', (r->>'terminals')::int = 3 and (r->>'max_terminals')::int = 1, r::text);

  -- archive, settings, owners
  perform pg_temp.as_user(up);
  perform public.platform_set_plan_status(plan, 'archived');
  begin perform public.platform_set_plan_status(plan, 'active'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ARCH-01 archived plan cannot be reactivated', raised);
  begin perform public.platform_save_plan_draft(plan, 1, 'month', 1, 1, 1, '{}', null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ARCH-02 archived plan cannot be edited', raised);
  begin perform public.platform_assign_plan(biz_b, plan, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ARCH-03 archived plan cannot be assigned', raised);
  perform pg_temp.ok('ARCH-04 existing subscriber keeps archived plan', (select plan_id from public.subscriptions where business_id = biz_a) = plan);
  perform public.platform_set_trial_days(7);
  perform pg_temp.as_user(ub);
  biz_c := public.create_business('Plat Test C', 'C1', 'PTC1');
  perform pg_temp.as_admin();
  select trial_ends_at into t from public.subscriptions where business_id = biz_c;
  perform pg_temp.ok('TRIAL-03 trial length is configurable (7 days)', abs(extract(epoch from (t - (now() + interval '7 days')))) < 60);
  select trial_ends_at into t from public.subscriptions where business_id = biz_a;
  perform pg_temp.ok('TRIAL-04 changing trial length does not alter existing trials', abs(extract(epoch from (t - (now() + interval '14 days')))) < 60);

  perform pg_temp.as_user(up);
  begin perform public.platform_revoke_owner(up); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('OWN-01 last platform owner cannot be removed', raised);
  perform public.platform_grant_owner('pt-platform2@ronia.test', 'backup');
  perform public.platform_revoke_owner(up2);
  perform pg_temp.as_user(up2);
  perform pg_temp.ok('OWN-02 revoked owner loses access', not public.is_platform_owner());
  begin perform * from public.platform_list_businesses(); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('OWN-03 revoked owner cannot use admin functions', raised);

  -- audit
  perform pg_temp.as_user(up);
  select count(distinct action) into n from public.platform_audit_log where action in ('platform.bootstrap','plan.created','plan.draft_saved','plan.published','plan.status_changed',
    'subscription.plan_assigned','plan.subscribers_moved','settings.trial_days','platform.owner_granted','platform.owner_revoked');
  perform pg_temp.ok('AUD-01 every admin action type audited (10)', n = 10, n::text);
  select count(*) into n from public.platform_audit_log where action = 'plan.published' and entity_id = plan::text;
  perform pg_temp.ok('AUD-02 each publish audited with its preview (3)', n = 3, n::text);
  perform pg_temp.as_admin();
  begin update public.platform_audit_log set action = 'x' where entity_id = plan::text; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-03 platform audit immutable', raised);
  begin delete from public.subscription_events where business_id = biz_a; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-04 billing history immutable', raised);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PLATFORM_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
