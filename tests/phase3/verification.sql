-- RONIA BUSINESS — Drawer payouts (petty cash) suite. Ends by RAISING its report, so it always rolls back.
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
  ua uuid := '00000000-0000-4000-c000-00000000000a'; ub uuid := '00000000-0000-4000-c000-00000000000b';
  uc uuid := '00000000-0000-4000-c000-00000000000c'; uc2 uuid := '00000000-0000-4000-c000-00000000000d';
  biz_a uuid; br_a uuid; p uuid; sh uuid; r jsonb; n int; x numeric; y numeric; raised boolean; pid bigint;
begin
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Payout Test A', 'A1', 'PA1');
  select id into br_a from public.branches where business_id = biz_a;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a]);
  perform public.add_business_member(biz_a, uc2, 'cashier', array[br_a]);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'P1', 'Item', 'pc', 500, 'B') returning id into p;
  perform public.receive_stock(br_a, p, 10, 300);
  perform pg_temp.as_user(ub);
  perform public.create_business('Payout Test B', 'B1', 'PB1');

  perform pg_temp.as_user(uc);
  sh := public.open_shift(br_a, 1000);
  perform public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2)), '[{"type":"cash","amount":1000}]');
  pid := public.record_shift_payout(sh, 150, 'transport', 'boda to depot');
  perform pg_temp.ok('PAY-01 cashier records payout from own open shift', pid is not null);
  begin perform public.record_shift_payout(sh, 0, 'other', 'zero'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-02 zero payout refused', raised);
  begin perform public.record_shift_payout(sh, 50, 'other', ''); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-03 payout without reason refused', raised);
  begin perform public.record_shift_payout(sh, 50, 'party', 'bad category'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-04 unknown category refused', raised);
  begin insert into public.shift_payouts(shift_id, business_id, branch_id, amount, category, reason, actor_user_id) values (sh, biz_a, br_a, 10, 'other', 'direct', uc); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-05 payouts cannot be inserted directly', raised);
  select count(*) into n from public.shift_payouts where shift_id = sh;
  perform pg_temp.ok('PAY-06 cashier sees own payout', n = 1, n::text);

  perform pg_temp.as_user(uc2);
  begin perform public.record_shift_payout(sh, 50, 'other', 'not my drawer'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-07 other cashier cannot take from my drawer', raised);
  select count(*) into n from public.shift_payouts where shift_id = sh;
  perform pg_temp.ok('PAY-08 other cashier cannot see my payouts', n = 0, n::text);
  perform pg_temp.as_user(ub);
  begin perform public.record_shift_payout(sh, 50, 'other', 'hostile'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-09 other business cannot record payout', raised);
  select count(*) into n from public.shift_payouts where business_id = biz_a;
  perform pg_temp.ok('PAY-10 other business sees no payouts', n = 0, n::text);

  perform pg_temp.as_user(uc);
  r := public.close_shift(sh, 1850);
  perform pg_temp.ok('PAY-11 blind close still hides expected from cashier', not (r ? 'expected') and not (r ? 'payouts'), r::text);
  begin perform public.record_shift_payout(sh, 10, 'other', 'after close'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-12 payout on closed shift refused', raised);

  perform pg_temp.as_user(ua);
  select expected_cash, variance into x, y from public.shifts where id = sh;
  perform pg_temp.ok('PAY-13 expected = float 1000 + cash 1000 - payout 150 = 1850, variance 0', x = 1850 and y = 0, x||' var '||y);
  select count(*) into n from public.shift_payouts where shift_id = sh;
  perform pg_temp.ok('PAY-14 owner sees the payout', n = 1);
  select count(*) into n from public.audit_log where business_id = biz_a and action = 'shift.payout';
  perform pg_temp.ok('PAY-15 payout written to activity log', n = 1, n::text);
  perform pg_temp.as_admin();
  begin update public.shift_payouts set amount = 1 where id = pid; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-16 payouts immutable', raised);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE3_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
