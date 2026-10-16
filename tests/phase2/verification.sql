-- RONIA BUSINESS — High-risk invariants suite (sales, stock, shifts, Deni, voids, audit, cross-tenant).
-- Always ends by RAISING its report, so every run rolls back and leaves no data behind.
-- Uses fake user ids and its own temporary businesses; never touches real store records.
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
  ua uuid := '00000000-0000-4000-b000-00000000000a'; ub uuid := '00000000-0000-4000-b000-00000000000b';
  uc uuid := '00000000-0000-4000-b000-00000000000c'; uc2 uuid := '00000000-0000-4000-b000-00000000000d';
  biz_a uuid; biz_b uuid; br_a1 uuid; br_a2 uuid; br_b1 uuid;
  p_oil uuid; p_crate uuid; p_soda uuid; p_b uuid; cust uuid; cust_b uuid; sh uuid; sh2 uuid;
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid();
  r jsonb; r2 jsonb; n int; x numeric; y numeric; raised boolean; msg text; s1 uuid; s3 uuid;
begin
  -- setup through real RPCs
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Inv Test A', 'A1', 'IA1');
  select id into br_a1 from public.branches where business_id = biz_a;
  insert into public.branches(business_id, name, code) values (biz_a, 'A2', 'IA2') returning id into br_a2;
  perform pg_temp.ok('BR-NEW owner creates second branch in own business', br_a2 is not null);
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a1]);
  perform public.add_business_member(biz_a, uc2, 'cashier', array[br_a1]);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'OIL1', 'Oil 1L', 'pc', 300, 'B') returning id into p_oil;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'CRT24', 'Soda crate 24', 'crate', 1200, 'B') returning id into p_crate;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class, parent_product_id, units_per_parent) values (biz_a, 'SODA', 'Soda 500ml', 'pc', 60, 'B', p_crate, 24) returning id into p_soda;
  insert into public.customers(business_id, name, phone, credit_enabled, credit_limit) values (biz_a, 'Mama Njeri', '0700000001', true, 1000) returning id into cust;
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('Inv Test B', 'B1', 'IB1');
  select id into br_b1 from public.branches where business_id = biz_b;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_b, 'BX', 'B item', 'pc', 50, 'B') returning id into p_b;
  insert into public.customers(business_id, name, credit_enabled, credit_limit) values (biz_b, 'B cust', true, 5000) returning id into cust_b;

  -- WAC
  perform pg_temp.as_user(ua);
  perform public.receive_stock(br_a1, p_oil, 10, 200);
  r := public.receive_stock(br_a1, p_oil, 10, 260);
  perform pg_temp.ok('WAC-01 weighted average after two receipts = 230', (r->>'wac')::numeric = 230, r->>'wac');
  -- bulk breaking conservation
  perform public.receive_stock(br_a1, p_crate, 2, 1000);
  r := public.break_bulk(br_a1, p_soda, 1);
  select qty_on_hand, wac into x, y from public.branch_stock where branch_id = br_a1 and product_id = p_soda;
  perform pg_temp.ok('BULK-01 one crate becomes 24 units', x = 24, x::text);
  perform pg_temp.ok('BULK-02 value conserved (24 x unit cost = crate cost)', abs(x*y - 1000) < 0.01, (x*y)::text);
  select qty_on_hand into x from public.branch_stock where branch_id = br_a1 and product_id = p_crate;
  perform pg_temp.ok('BULK-03 crate stock reduced to 1', x = 1, x::text);
  begin perform public.break_bulk(br_a1, p_soda, 0.5); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BULK-04 fractional pack break refused', raised);

  -- cross-tenant denial
  begin perform public.receive_stock(br_b1, p_b, 5, 10); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-S1 owner A cannot receive stock into branch of B', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_b, 'qty', 1)), '[{"type":"cash","amount":50}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-S2 product of B cannot be sold in A', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1)), '[{"type":"deni","amount":300}]', null, cust_b); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-S3 customer of B cannot be charged in A', raised);
  select count(*) into n from public.sales where business_id = biz_b;
  perform pg_temp.ok('ISO-S4 owner A sees no sales of B', n = 0);
  select count(*) into n from public.customers where business_id = biz_b;
  perform pg_temp.ok('ISO-S5 owner A sees no customers of B', n = 0);
  select count(*) into n from public.branch_stock where business_id = biz_b;
  perform pg_temp.ok('ISO-S6 owner A sees no stock of B', n = 0);

  -- direct table writes denied
  begin update public.branch_stock set qty_on_hand = 999 where branch_id = br_a1; get diagnostics n = row_count; raised := n = 0; exception when others then raised := true; end;
  perform pg_temp.ok('DIR-01 stock cannot be edited directly', raised);
  begin insert into public.sales(business_id, branch_id, receipt_no, client_txn_id, payload_hash, cashier_id, subtotal, discount_total, tax_total, total, tendered_total, change_given, cogs_total)
    values (biz_a, br_a1, 'FAKE', gen_random_uuid(), 'x', ua, 1,0,0,1,1,0,0); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('DIR-02 sales cannot be inserted directly', raised);
  begin update public.customers set balance = 12345 where id = cust; exception when others then null; end;
  select balance into x from public.customers where id = cust;
  raised := x = 0;
  perform pg_temp.ok('DIR-03 Deni balance cannot be edited directly', raised, x::text);

  -- cashier: shift + sale + idempotency
  perform pg_temp.as_user(uc);
  begin perform public.post_sale(br_a2, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1)), '[{"type":"cash","amount":300}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('BR-S1 cashier cannot sell in unassigned branch', raised);
  sh := public.open_shift(br_a1, 500);
  begin perform public.open_shift(br_a1, 100); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SHIFT-01 only one open shift per cashier per branch', raised);
  r := public.post_sale(br_a1, t1, jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 2)), '[{"type":"cash","amount":1000}]', 'dev1');
  s1 := (r->>'sale_id')::uuid;
  perform pg_temp.ok('SAL-01 sale created with server price (2 x 300)', r->>'status' = 'created' and (r->>'total')::numeric = 600, r::text);
  perform pg_temp.ok('SAL-02 change 400 from cash', (r->>'change_given')::numeric = 400);
  r2 := public.post_sale(br_a1, t1, jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 2)), '[{"type":"cash","amount":1000}]', 'dev1');
  perform pg_temp.ok('IDEM-S1 duplicate submission replays the same receipt', r2->>'status' = 'replay' and r2->>'receipt_no' = r->>'receipt_no');
  select count(*) into n from public.sales where client_txn_id = t1;
  perform pg_temp.ok('IDEM-S2 duplicate submission creates no second sale', n = 1, n::text);
  select l.qty_on_hand into x from public.branch_stock_levels(br_a1) l where l.product_id = p_oil;
  perform pg_temp.ok('IDEM-S3 duplicate submission deducts stock once (20-2=18)', x = 18, x::text);
  begin perform public.post_sale(br_a1, t1, jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 3)), '[{"type":"cash","amount":1000}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('IDEM-S4 same id with different contents rejected', raised);
  select line_cogs into x from public.sale_lines where sale_id = s1;
  perform pg_temp.ok('COGS-01 COGS frozen at WAC 230 x 2 = 460', x = 460, x::text);

  -- out of stock + atomicity
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 19)), '[{"type":"cash","amount":6000}]'); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('STOCK-01 selling more than on hand refused', raised and msg like 'OUT_OF_STOCK%', msg);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 10), jsonb_build_object('product_id', p_oil, 'qty', 10)), '[{"type":"cash","amount":6000}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('STOCK-02 split lines summed for stock check', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1)), '[{"type":"cash","amount":100}]'); raised := false; exception when others then raised := true; end;
  select l.qty_on_hand into x from public.branch_stock_levels(br_a1) l where l.product_id = p_oil;
  perform pg_temp.ok('ATOM-01 rejected sale (underpaid) leaves stock unchanged', raised and x = 18, x::text);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1, 'discount', 50)), '[{"type":"cash","amount":250}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('DISC-01 cashier cannot discount', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1)), '[{"type":"mpesa_manual","amount":300}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MPESA-01 M-Pesa tender needs transaction code', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1)), '[{"type":"mpesa_manual","amount":500,"reference":"QWE123RTY9"}]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('TEND-01 change cannot come from M-Pesa', raised);

  -- split tender + Deni
  r := public.post_sale(br_a1, t2, jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 2)), '[{"type":"mpesa_manual","amount":200,"reference":"QWE123RTY9"},{"type":"deni","amount":400}]', 'dev1', cust);
  perform pg_temp.ok('DENI-01 split M-Pesa + Deni sale accepted', r->>'status' = 'created', r::text);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 3)), '[{"type":"deni","amount":900}]', null, cust); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('DENI-02 credit limit enforced (400+900 > 1000)', raised);
  r := public.post_sale(br_a1, t3, jsonb_build_array(jsonb_build_object('product_id', p_oil, 'qty', 1)), '[{"type":"cash","amount":300}]', 'dev1');
  s3 := (r->>'sale_id')::uuid;

  -- receive at a new cost; old COGS must not move
  perform pg_temp.as_user(ua);
  perform public.receive_stock(br_a1, p_oil, 10, 500);
  perform pg_temp.as_admin();
  begin update public.sale_lines set line_cogs = 0 where sale_id = s1; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('COGS-02 sale lines immutable even for privileged role', raised);
  perform pg_temp.as_user(ua);
  select line_cogs into x from public.sale_lines where sale_id = s1;
  perform pg_temp.ok('COGS-03 historical COGS unchanged after new receipt', x = 460, x::text);

  -- Deni repayment + ledger integrity
  r := public.record_deni_repayment(cust, 150, 'cash');
  begin perform public.record_deni_repayment(cust, 1000, 'cash'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('DENI-03 repayment above balance refused', raised);
  begin perform public.record_deni_repayment(cust, 10, 'deni'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('DENI-04 repayment with Deni refused', raised);
  select balance into x from public.customers where id = cust;
  select coalesce(sum(case when entry_type='repayment' then amount when entry_type='void_reversal' then -amount else amount end),0) into y from public.customer_ledger where customer_id = cust;
  perform pg_temp.ok('DENI-05 balance (250) equals ledger sum', x = 250 and y = 250, x||'/'||y);

  -- voids
  perform pg_temp.as_user(uc);
  begin perform public.void_sale(s3, 'wrong item'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('VOID-01 cashier cannot void', raised);
  perform pg_temp.as_user(ua);
  select qty_on_hand into x from public.branch_stock where branch_id = br_a1 and product_id = p_oil;
  perform public.void_sale(s3, 'customer changed mind');
  select qty_on_hand into y from public.branch_stock where branch_id = br_a1 and product_id = p_oil;
  perform pg_temp.ok('VOID-02 void returns 1 unit to stock', y = x + 1, x||'->'||y);
  begin perform public.void_sale(s3, 'again'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('VOID-03 double void refused', raised);
  select count(*) into n from public.sales where id = s3;
  perform pg_temp.ok('VOID-04 voided sale is kept, not deleted', n = 1);

  -- blind close
  perform pg_temp.as_user(uc2);
  begin perform public.close_shift(sh, 0); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SHIFT-02 another cashier cannot close my shift', raised);
  perform pg_temp.as_user(uc);
  select count(*) into n from public.shifts;
  perform pg_temp.ok('SHIFT-03 cashier cannot read shift table (expected cash hidden)', n = 0, n::text);
  r := public.close_shift(sh, 1100);
  perform pg_temp.ok('SHIFT-04 blind close returns no expected/variance to cashier', not (r ? 'expected') and not (r ? 'variance'), r::text);
  perform pg_temp.as_user(ua);
  select expected_cash, variance into x, y from public.shifts where id = sh;
  -- float 500 + sale1 cash 600 net (voided sale 3 excluded) = 1100
  perform pg_temp.ok('SHIFT-05 expected cash = float + net cash, voids excluded (1100)', x = 1100 and y = 0, x||' var '||y);
  begin perform public.close_shift(sh, 1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SHIFT-06 closed shift cannot be closed again', raised);

  -- ledger integrity across everything
  select count(*) into n from public.branch_stock bs where bs.business_id = biz_a and bs.qty_on_hand <> (select coalesce(sum(m.qty),0) from public.stock_movements m where m.branch_id = bs.branch_id and m.product_id = bs.product_id);
  perform pg_temp.ok('LEDGER-01 on-hand equals sum of stock movements', n = 0, n::text);
  select count(*) into n from public.branch_stock where business_id = biz_a and qty_on_hand < 0;
  perform pg_temp.ok('LEDGER-02 no negative stock', n = 0);
  select count(*) into n from public.sales s where s.business_id = biz_a and s.cogs_total <> (select sum(line_cogs) from public.sale_lines l where l.sale_id = s.id);
  perform pg_temp.ok('LEDGER-03 sale COGS equals sum of line COGS', n = 0);
  select count(*) into n from public.audit_log where business_id = biz_a and action in ('sale.completed','sale.void','shift.open','shift.close','deni.repayment','stock.received','stock.bulk_broken');
  perform pg_temp.ok('AUD-S1 sales, voids, shifts, Deni and stock audited', n >= 10, n::text);
  perform pg_temp.as_admin();
  begin update public.customer_ledger set amount = 0 where customer_id = cust; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-S2 Deni ledger immutable', raised);
  begin delete from public.stock_movements where business_id = biz_a; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-S3 stock movements immutable', raised);
  begin delete from public.sale_voids where sale_id = s3; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-S4 void records immutable', raised);

  -- support + mpesa permissions
  perform pg_temp.as_user(uc);
  begin perform public.grant_support_access(biz_a, 'read_only', 'help me please', 2); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SUP-01 cashier cannot grant support access', raised);
  perform pg_temp.as_user(ua);
  begin perform public.grant_support_access(biz_a, 'read_only', 'help me please', 48); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SUP-02 support access over 24h refused', raised);
  begin perform public.save_mpesa_config(biz_a, null, 'till', null, '123456', null, null, 'live_ready'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MPESA-02 Live Ready cannot be self-declared', raised);
  perform pg_temp.as_user(ub);
  begin perform public.void_sale(s1, 'hostile void'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-S7 owner B cannot void sale of A', raised);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE2_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
