-- RONIA BUSINESS — Partial item returns & refunds suite. Ends by RAISING its report, so it always rolls back.
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
  ua uuid := '00000000-0000-4000-f000-00000000000a'; ub uuid := '00000000-0000-4000-f000-00000000000b';
  uc uuid := '00000000-0000-4000-f000-00000000000c';
  biz_a uuid; br_a uuid; p1 uuid; p2 uuid; cust uuid; sh_c uuid; sh_o uuid;
  s1 uuid; s2 uuid; s3 uuid; l1 bigint; l2 bigint; l3 bigint; ref1 uuid := gen_random_uuid();
  r jsonb; r2 jsonb; n int; x numeric; y numeric; raised boolean; msg text;
begin
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Ret Test A', 'A1', 'RA1');
  select id into br_a from public.branches where business_id = biz_a;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a]);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'R1', 'Soap', 'pc', 116, 'A') returning id into p1;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'R2', 'Juice', 'pc', 100, 'B') returning id into p2;
  insert into public.customers(business_id, name, credit_enabled, credit_limit) values (biz_a, 'Wanjiku', true, 5000) returning id into cust;
  perform public.receive_stock(br_a, p1, 10, 60);
  perform public.receive_stock(br_a, p2, 10, 50);
  perform pg_temp.as_user(ub);
  perform public.create_business('Ret Test B', 'B1', 'RB1');

  perform pg_temp.as_user(uc);
  sh_c := public.open_shift(br_a, 1000);
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 3), jsonb_build_object('product_id', p2, 'qty', 2)), '[{"type":"cash","amount":548}]'); s1 := (r->>'sale_id')::uuid;
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 4)), '[{"type":"deni","amount":400}]', null, cust); s2 := (r->>'sale_id')::uuid;
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)), '[{"type":"mpesa_manual","amount":100,"reference":"QRT555XYZ1"}]'); s3 := (r->>'sale_id')::uuid;
  select id into l1 from public.sale_lines where sale_id = s1 and product_id = p1;
  select id into l2 from public.sale_lines where sale_id = s1 and product_id = p2;
  select id into l3 from public.sale_lines where sale_id = s2;

  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 1)), 'cash', 'damaged', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-01 cashier cannot process a return', raised);
  perform pg_temp.as_user(ub);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 1)), 'cash', 'hostile', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-02 other business cannot return our sale', raised);

  perform pg_temp.as_user(ua);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 1)), 'cash', 'damaged', null, gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('RET-03 cash refund needs the refunder''s open shift', raised, msg);
  sh_o := public.open_shift(br_a, 500);
  r := public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 1)), 'cash', 'damaged wrapper', null, ref1);
  perform pg_temp.ok('RET-04 one of three soaps refunded at 116', r->>'status' = 'created' and (r->>'refund_amount')::numeric = 116, r::text);
  perform pg_temp.ok('RET-05 return number derived from receipt', r->>'return_no' like '%-R1', r->>'return_no');
  select qty_on_hand, wac into x, y from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('RET-06 soap back in stock (10-3+1=8) at unchanged cost 60', x = 8 and y = 60, x||' @ '||y);
  select cogs_reversed, tax_amount into x, y from public.sale_returns where id = (r->>'return_id')::uuid;
  perform pg_temp.ok('RET-07 cost reversed at original 60 and VAT 16 reversed', x = 60 and y = 16, x||' / '||y);
  r2 := public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 1)), 'cash', 'damaged wrapper', null, ref1);
  select count(*) into n from public.sale_returns where sale_id = s1;
  perform pg_temp.ok('RET-08 repeated submission replays, refund recorded once', r2->>'status' = 'replay' and n = 1, n::text);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 3)), 'cash', 'too many', null, gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('RET-09 cannot return more than sold minus already returned', raised, msg);
  r := public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 2), jsonb_build_object('sale_line_id', l2, 'qty', 1)), 'cash', 'customer changed mind', null, gen_random_uuid());
  perform pg_temp.ok('RET-10 second return of remaining items (232+100=332)', (r->>'refund_amount')::numeric = 332 and r->>'return_no' like '%-R2', r::text);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l3, 'qty', 1)), 'cash', 'wrong sale', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-11 item from a different sale refused', raised);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l2, 'qty', 0)), 'cash', 'zero', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-12 zero quantity refused', raised);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l2, 'qty', 1)), 'cash', '', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-13 reason required', raised);
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l2, 'qty', 1)), 'card', 'card refund', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-14 unsupported refund method refused', raised);

  -- Deni refund
  begin perform public.return_sale_items(s1, jsonb_build_array(jsonb_build_object('sale_line_id', l2, 'qty', 1)), 'deni', 'not deni sale', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-15 Deni refund refused for a cash sale', raised);
  r := public.return_sale_items(s2, jsonb_build_array(jsonb_build_object('sale_line_id', l3, 'qty', 1)), 'deni', 'expired', null, gen_random_uuid());
  select balance into x from public.customers where id = cust;
  select coalesce(sum(case when entry_type in ('repayment','void_reversal','return_credit') then -amount else amount end),0) into y from public.customer_ledger where customer_id = cust;
  perform pg_temp.ok('RET-16 Deni balance reduced 400 -> 300 and equals ledger', x = 300 and y = 300, x||'/'||y);

  -- M-Pesa refund
  begin perform public.return_sale_items(s3, jsonb_build_array(jsonb_build_object('sale_line_id', (select id from public.sale_lines where sale_id = s3), 'qty', 1)), 'mpesa_manual', 'leaking', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-17 M-Pesa refund needs reversal code', raised);
  r := public.return_sale_items(s3, jsonb_build_array(jsonb_build_object('sale_line_id', (select id from public.sale_lines where sale_id = s3), 'qty', 1)), 'mpesa_manual', 'leaking', 'qrv999abc1', gen_random_uuid());
  perform pg_temp.ok('RET-18 M-Pesa refund with code recorded', (r->>'refund_amount')::numeric = 100);

  -- voided sale
  perform public.void_sale(s3, 'test void');
  begin perform public.return_sale_items(s2, jsonb_build_array(jsonb_build_object('sale_line_id', l3, 'qty', 1)), 'deni', 'after', null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-19 non-voided sale still returnable after another void', not raised);

  -- blind close: owner refunded 116 + 332 cash from own shift
  r := public.close_shift(sh_o, 52);
  select expected_cash, variance into x, y from public.shifts where id = sh_o;
  perform pg_temp.ok('RET-20 refunding shift expected = 500 - 448 = 52', x = 52 and y = 0, x||' var '||y);
  perform pg_temp.as_user(uc);
  r := public.close_shift(sh_c, 1548);
  perform pg_temp.as_user(ua);
  select expected_cash into x from public.shifts where id = sh_c;
  perform pg_temp.ok('RET-21 selling cashier''s drawer unaffected by another person''s refund (1548)', x = 1548, x::text);

  select count(*) into n from public.audit_log where business_id = biz_a and action = 'sale.return';
  perform pg_temp.ok('RET-22 every return audited (5)', n = 5, n::text);
  perform pg_temp.as_admin();
  begin update public.sale_returns set refund_amount = 1 where sale_id = s1; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-23 returns immutable', raised);
  begin delete from public.sale_return_lines where business_id = biz_a; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('RET-24 return lines immutable', raised);
  select count(*) into n from public.branch_stock bs where bs.business_id = biz_a and bs.qty_on_hand <> (select coalesce(sum(m.qty),0) from public.stock_movements m where m.branch_id = bs.branch_id and m.product_id = bs.product_id);
  perform pg_temp.ok('RET-25 on-hand equals sum of movements', n = 0, n::text);
  perform pg_temp.as_user(ub);
  select count(*) into n from public.sale_returns where business_id = biz_a;
  perform pg_temp.ok('RET-26 other business sees no returns', n = 0, n::text);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE6_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
