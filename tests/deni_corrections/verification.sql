-- RONIA BUSINESS — Workstream A: manual-debt reversals & write-offs. Ends by RAISING its report, so it always rolls back.
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
  uo uuid := '00000000-0000-4000-d000-00000000000a'; um uuid := '00000000-0000-4000-d000-00000000000b';
  uc uuid := '00000000-0000-4000-d000-00000000000c'; ux uuid := '00000000-0000-4000-d000-00000000000d';
  biz uuid; br uuid; biz_x uuid; cust uuid; d1 uuid; d2 uuid; d3 uuid; rp1 uuid; rp2 uuid; r jsonb; r2 jsonb;
  ref uuid; raised boolean; msg text; n int; o numeric; s text; sales_before int; mv_before int;
begin
  perform pg_temp.as_user(uo);
  biz := public.create_business('Deni Corr Test', 'Main', 'DCT1');
  select id into br from public.branches where business_id = biz;
  perform public.add_business_member(biz, um, 'manager', array[br]);
  perform public.add_business_member(biz, uc, 'cashier', array[br]);
  perform pg_temp.as_user(ux);
  biz_x := public.create_business('Other', 'X', 'DCX1');
  perform pg_temp.as_admin();
  insert into public.customers(business_id, name) values (biz, 'Wanjiku') returning id into cust;
  select count(*) into sales_before from public.sales where business_id = biz;
  select count(*) into mv_before from public.stock_movements where business_id = biz;

  perform pg_temp.as_user(um);
  d1 := (public.record_manual_debt(cust, 'cash_loan', 1000, current_date - 5, null, 'school fees', null, null, gen_random_uuid()))->>'id';
  d2 := (public.record_manual_debt(cust, 'cash_loan', 500, current_date - 5, null, 'typed twice by mistake', null, null, gen_random_uuid()))->>'id';
  d3 := (public.record_manual_debt(cust, 'other', 300, current_date - 5, null, 'bad debt case', null, null, gen_random_uuid()))->>'id';
  rp1 := (public.record_manual_debt_repayment(d1, 200, 'cash', null, current_date, gen_random_uuid()))->>'id';
  rp2 := (public.record_manual_debt_repayment(d1, 100, 'cash', null, current_date, gen_random_uuid()))->>'id';
  select outstanding into o from public.manual_debt_register(biz) where id = d1;
  perform pg_temp.ok('BAL-01 outstanding = principal - repayments', o = 700, o::text);

  -- Repayment reversal
  ref := gen_random_uuid();
  r := public.reverse_manual_debt_entry(d1, rp2, 'cashier keyed wrong loan', ref);
  select outstanding into o from public.manual_debt_register(biz) where id = d1;
  perform pg_temp.ok('REV-01 reversing a repayment restores outstanding', o = 800, o::text);
  perform pg_temp.ok('REV-02 original repayment row still exists (no deletion)', exists(select 1 from public.manual_debt_repayments where id = rp2));
  r2 := public.reverse_manual_debt_entry(d1, rp2, 'cashier keyed wrong loan', ref);
  perform pg_temp.ok('DUP-01 same reversal request replays, no second row', r2->>'status' = 'replay'
    and (select count(*) from public.manual_debt_reversals where repayment_id = rp2) = 1);
  begin perform public.reverse_manual_debt_entry(d1, rp2, 'again different ref', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('DUP-02 a repayment can only be reversed once', raised);
  begin perform public.reverse_manual_debt_entry(d1, rp1, 'no', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('REV-03 written reason is mandatory', raised);
  begin perform public.reverse_manual_debt_entry(d2, rp1, 'wrong loan link', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('REV-04 reversal must reference a repayment of that loan', raised);
  begin perform public.reverse_manual_debt_entry(d1, null, 'loan has payments', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('REV-05 loan with live repayments cannot be reversed', raised);

  -- Loan reversal
  r := public.reverse_manual_debt_entry(d2, null, 'entered twice by mistake', gen_random_uuid());
  select status, outstanding into s, o from public.manual_debt_register(biz) where id = d2;
  perform pg_temp.ok('REV-06 reversed loan shows status reversed, nothing owed', s = 'reversed' and o = 0, s || ' ' || o);
  begin perform public.record_manual_debt_repayment(d2, 10, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('REV-07 reversed loan refuses repayments', raised);

  -- Write-off: owner only
  begin perform public.write_off_manual_debt(d3, 300, 'moved away, unreachable', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-01 manager cannot write off', raised);
  perform pg_temp.as_user(uc);
  begin perform public.write_off_manual_debt(d3, 300, 'moved away, unreachable', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-02 cashier cannot write off', raised);
  begin perform public.reverse_manual_debt_entry(d1, rp1, 'cashier attempt', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUTH-03 cashier cannot reverse', raised);
  select count(*) into n from public.manual_debt_write_offs where business_id = biz;
  perform pg_temp.ok('AUTH-04 cashier cannot read write-offs', n = 0);
  perform pg_temp.as_user(ux);
  begin perform public.write_off_manual_debt(d3, 300, 'cross tenant attempt', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-01 other business owner cannot write off', raised);
  begin perform public.reverse_manual_debt_entry(d1, rp1, 'cross tenant attempt', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-02 other business owner cannot reverse', raised);

  perform pg_temp.as_user(uo);
  begin perform public.write_off_manual_debt(d3, 400, 'too much requested', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('WO-01 write-off cannot exceed outstanding', raised);
  ref := gen_random_uuid();
  r := public.write_off_manual_debt(d3, 300, 'moved away, unreachable', ref);
  r2 := public.write_off_manual_debt(d3, 300, 'moved away, unreachable', ref);
  perform pg_temp.ok('DUP-03 duplicate write-off request replays', r2->>'status' = 'replay' and (select count(*) from public.manual_debt_write_offs where debt_id = d3) = 1);
  select status, outstanding into s, o from public.manual_debt_register(biz) where id = d3;
  perform pg_temp.ok('WO-02 fully written-off loan: status written_off, outstanding 0', s = 'written_off' and o = 0, s || ' ' || o);
  perform pg_temp.ok('WO-03 write-off is not a repayment', (select coalesce(sum(amount),0) from public.manual_debt_repayments where debt_id = d3) = 0);
  begin perform public.reverse_manual_debt_entry(d3, null, 'try reverse after write-off', gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('WO-04 written-off loan cannot be reversed', raised);

  -- Recovery after write-off
  r := public.record_manual_debt_repayment(d3, 120, 'cash', null, current_date, gen_random_uuid());
  select recovered, outstanding into o, msg from public.manual_debt_register(biz) where id = d3;
  perform pg_temp.ok('REC-01 money received after write-off is recorded as recovery', o = 120 and (r->>'outstanding')::numeric = 0, o::text);
  begin perform public.record_manual_debt_repayment(d3, 200, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('REC-02 recovery cannot exceed the original loan', raised);
  perform pg_temp.ok('AUD-00 recovery audited separately',
    exists(select 1 from public.audit_log where business_id = biz and action = 'deni.manual_debt_recovered'));

  -- Audit, immutability, no sales side-effects
  perform pg_temp.as_admin();
  perform pg_temp.ok('AUD-01 write-off audited', exists(select 1 from public.audit_log where business_id = biz and action = 'deni.manual_debt_written_off' and actor_user_id = uo));
  perform pg_temp.ok('AUD-02 repayment reversal audited with reason', exists(select 1 from public.audit_log where business_id = biz and action = 'deni.manual_repayment_reversed' and payload->>'reason' = 'cashier keyed wrong loan'));
  perform pg_temp.ok('AUD-03 loan reversal audited', exists(select 1 from public.audit_log where business_id = biz and action = 'deni.manual_debt_reversed'));
  begin delete from public.manual_debt_write_offs where debt_id = d3; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IMM-01 write-offs cannot be deleted', raised);
  begin update public.manual_debt_reversals set reason = 'edited reason' where debt_id = d2; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IMM-02 reversals cannot be edited', raised);
  begin delete from public.manual_debts where id = d2; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IMM-03 reversed loan row is not deleted', raised);
  perform pg_temp.ok('SEP-01 no sales or stock movements created',
    (select count(*) from public.sales where business_id = biz) = sales_before and (select count(*) from public.stock_movements where business_id = biz) = mv_before);
  perform pg_temp.ok('SEP-02 POS Deni balance untouched', (select balance from public.customers where id = cust) = 0);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by passed, id) into rep from t_results;
  raise exception E'DENI_CORR_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
