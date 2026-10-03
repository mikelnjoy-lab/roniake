-- RONIA BUSINESS — Phase 1 Verification Suite (Core Domain & Transaction Engine)
-- One transaction, always ROLLS BACK. Simulates real API roles with JWT claims.
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
  ua uuid := '00000000-0000-4000-a000-00000000000a'; -- owner A
  ub uuid := '00000000-0000-4000-a000-00000000000b'; -- owner B
  uc uuid := '00000000-0000-4000-a000-00000000000c'; -- cashier A (branch A1)
  ud uuid := '00000000-0000-4000-a000-00000000000d'; -- auditor A
  biz_a uuid; biz_b uuid; br_a1 uuid; br_a2 uuid;
  p_sugar uuid; p_crate uuid; p_soda uuid; p_meat uuid; p_svc uuid;
  n int; raised boolean; r jsonb; r2 jsonb; txn uuid := gen_random_uuid(); txn2 uuid := gen_random_uuid();
  v numeric; s record;
begin
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Duka A Ltd', 'Main Branch', 'MAIN');
  select id into br_a1 from public.branches where business_id = biz_a;
  insert into public.branches(business_id, name, code) values (biz_a, 'Second', 'BR2') returning id into br_a2;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a1]);
  perform public.add_business_member(biz_a, ud, 'auditor');
  insert into public.products(business_id, sku, barcode, name, selling_price) values (biz_a, 'SUG1', '6161100100011', 'Sugar 1kg', 200) returning id into p_sugar;
  insert into public.products(business_id, sku, name, selling_price, unit) values (biz_a, 'SODA-CR', 'Soda crate', 1100, 'crate') returning id into p_crate;
  insert into public.products(business_id, sku, name, selling_price, parent_product_id, units_per_parent) values (biz_a, 'SODA', 'Soda 500ml', 60, p_crate, 24) returning id into p_soda;
  insert into public.products(business_id, sku, name, selling_price, unit, is_weighted, plu_code) values (biz_a, 'BEEF', 'Beef', 700, 'kg', true, '1001') returning id into p_meat;
  insert into public.products(business_id, sku, name, selling_price, tax_class, track_stock) values (biz_a, 'SVC', 'Delivery', 100, 'A', false) returning id into p_svc;
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('Duka B Ltd', 'B Main', 'MAIN');

  -- ---------- CATALOG ----------
  perform pg_temp.as_user(ua);
  begin insert into public.products(business_id, sku, name, selling_price) values (biz_a, 'SUG1', 'Dup', 1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CAT-01 duplicate SKU rejected', raised);
  begin insert into public.products(business_id, sku, name, selling_price) values (biz_b, 'X1', 'Intruder', 1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CAT-02 owner A cannot add products to business B', raised);
  begin insert into public.products(business_id, sku, name, selling_price, parent_product_id, units_per_parent) values (biz_a, 'S2', 'Nested', 1, p_soda, 2); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CAT-03 pack hierarchy limited to one level', raised);
  perform pg_temp.as_user(uc);
  select count(*) into n from public.products where business_id = biz_a;
  perform pg_temp.ok('CAT-04 cashier can read catalog', n = 5, n::text);
  begin insert into public.products(business_id, sku, name, selling_price) values (biz_a, 'C1', 'Cashier item', 1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CAT-05 cashier cannot create products', raised);
  update public.products set selling_price = 1 where id = p_sugar; get diagnostics n = row_count;
  perform pg_temp.ok('CAT-06 cashier cannot change prices', n = 0);
  perform pg_temp.as_user(ub);
  select count(*) into n from public.products where business_id = biz_a;
  perform pg_temp.ok('CAT-07 owner B cannot see catalog of A', n = 0);

  -- ---------- INVENTORY / WAC ----------
  perform pg_temp.as_user(ua);
  perform public.receive_stock(br_a1, p_sugar, 10, 150, 'GRN-1');
  r := public.receive_stock(br_a1, p_sugar, 10, 170, 'GRN-2');
  perform pg_temp.ok('INV-01 WAC blends receipts (10@150 + 10@170 = 160)', (r->>'wac')::numeric = 160 and (r->>'qty_on_hand')::numeric = 20, r::text);
  perform public.receive_stock(br_a1, p_crate, 2, 960, null);
  r := public.break_bulk(br_a1, p_soda, 1);
  select qty_on_hand into v from public.branch_stock where branch_id = br_a1 and product_id = p_crate;
  perform pg_temp.ok('INV-02 bulk break moves 1 crate into 24 units at 40 each', (r->>'child_qty_added')::numeric = 24 and (r->>'unit_cost')::numeric = 40 and v = 1, r::text);
  begin perform public.adjust_stock(br_a1, p_sugar, -1, ''); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-03 adjustment without reason rejected', raised);
  r := public.adjust_stock(br_a1, p_sugar, -2, 'Damaged bags');
  perform pg_temp.ok('INV-04 authorized adjustment keeps WAC', (r->>'wac')::numeric = 160 and (r->>'qty_on_hand')::numeric = 18, r::text);
  perform public.receive_stock(br_a1, p_meat, 5.5, 500, null);
  begin perform public.receive_stock(br_a1, p_svc, 1, 1, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-05 non-stock product cannot be received', raised);
  perform pg_temp.as_user(uc);
  begin perform public.receive_stock(br_a1, p_sugar, 1, 1, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-06 cashier cannot receive stock', raised);
  begin perform public.adjust_stock(br_a1, p_sugar, 5, 'Found extra'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-07 cashier cannot adjust stock', raised);
  select count(*) into n from public.branch_stock;
  perform pg_temp.ok('INV-08 cashier cannot read stock costs', n = 0);
  perform pg_temp.as_user(ub);
  begin perform public.receive_stock(br_a1, p_sugar, 1, 1, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-09 owner B cannot touch stock of A', raised);
  begin perform public.apply_stock_movement(biz_a, br_a1, p_sugar, 'receipt', 1, 1, null, null, null); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-10 internal stock engine not callable by clients', raised);
  begin insert into public.stock_movements(business_id, branch_id, product_id, movement_type, qty, unit_cost, qty_after, wac_after) values (biz_a, br_a1, p_sugar, 'receipt', 1, 1, 1, 1); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('INV-11 clients cannot write the stock ledger', raised);

end $$;

-- Sales checks run in their own block so a failing setup above is reported, not hidden.
do $$
declare
  ua uuid := '00000000-0000-4000-a000-00000000000a';
  ub uuid := '00000000-0000-4000-a000-00000000000b';
  uc uuid := '00000000-0000-4000-a000-00000000000c';
  ud uuid := '00000000-0000-4000-a000-00000000000d';
  biz_a uuid; br_a1 uuid; br_a2 uuid; p_sugar uuid; p_meat uuid; p_svc uuid;
  n int; raised boolean; r jsonb; r2 jsonb; txn uuid := gen_random_uuid(); v numeric; s public.sales;
  lines jsonb; tenders jsonb;
begin
  perform pg_temp.as_admin();
  select id into biz_a from public.businesses where name = 'Duka A Ltd' order by created_at desc limit 1;
  select id into br_a1 from public.branches where business_id = biz_a and code = 'MAIN';
  select id into br_a2 from public.branches where business_id = biz_a and code = 'BR2';
  select id into p_sugar from public.products where business_id = biz_a and sku = 'SUG1';
  select id into p_meat from public.products where business_id = biz_a and sku = 'BEEF';
  select id into p_svc from public.products where business_id = biz_a and sku = 'SVC';
  lines := jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 2), jsonb_build_object('product_id', p_meat, 'qty', 0.75),
                             jsonb_build_object('product_id', p_svc, 'qty', 1));
  tenders := jsonb_build_array(jsonb_build_object('type','mpesa_manual','amount',500,'reference','SJK3H7X9QA'), jsonb_build_object('type','cash','amount',1000));

  perform pg_temp.as_user(uc);
  r := public.post_sale(br_a1, txn, lines, tenders, 'tablet-1');
  perform pg_temp.ok('SAL-01 cashier posts split-tender sale with server prices (total 1025)', r->>'status' = 'created' and (r->>'total')::numeric = 1025, r::text);
  perform pg_temp.ok('SAL-02 change computed from cash (475)', (r->>'change_given')::numeric = 475, r->>'change_given');
  perform pg_temp.ok('SAL-03 VAT 16% inclusive on class B only (55.17 + 72.41)', (r->>'tax_total')::numeric = 127.58, r->>'tax_total');
  perform pg_temp.ok('SAL-04 receipt number is branch-coded and sequential', r->>'receipt_no' = 'MAIN-000001', r->>'receipt_no');
  r2 := public.post_sale(br_a1, txn, lines, tenders, 'tablet-1');
  perform pg_temp.ok('SAL-05 offline retry replays the same sale', r2->>'status' = 'replay' and r2->>'sale_id' = r->>'sale_id');
  begin perform public.post_sale(br_a1, txn, lines, jsonb_build_array(jsonb_build_object('type','cash','amount',2000))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-06 transaction id reuse with different contents rejected', raised);
  select count(*) into n from public.sales where client_txn_id = txn;
  perform pg_temp.ok('SAL-07 exactly one sale recorded despite retries', n = 1, n::text);

  perform pg_temp.as_admin();
  select * into s from public.sales where client_txn_id = txn;
  perform pg_temp.ok('SAL-08 COGS frozen from WAC (2*160 + 0.75*500 = 695)', s.cogs_total = 695, s.cogs_total::text);
  select qty_on_hand into v from public.branch_stock where branch_id = br_a1 and product_id = p_sugar;
  perform pg_temp.ok('SAL-09 stock decremented (18 - 2 = 16)', v = 16, v::text);
  select qty_on_hand into v from public.branch_stock where branch_id = br_a1 and product_id = p_meat;
  perform pg_temp.ok('SAL-10 weighted item decremented by kg (5.5 - 0.75)', v = 4.75, v::text);
  select count(*) into n from public.branch_stock where product_id = p_svc;
  perform pg_temp.ok('SAL-11 non-stock item creates no stock row', n = 0);

  perform pg_temp.as_user(ua);
  perform public.receive_stock(br_a1, p_sugar, 4, 220, null);
  select sum(line_cogs) into v from public.sale_lines where sale_id = s.id;
  perform pg_temp.ok('SAL-12 later cost changes do not alter recorded COGS', v = 695, v::text);

  perform pg_temp.as_user(uc);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1, 'discount', 10)), jsonb_build_array(jsonb_build_object('type','cash','amount',200))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-13 cashier without permission cannot discount', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1.5)), jsonb_build_array(jsonb_build_object('type','cash','amount',300))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-14 fractional qty rejected for unit items', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1)), jsonb_build_array(jsonb_build_object('type','cash','amount',150))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-15 underpayment rejected', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1)), jsonb_build_array(jsonb_build_object('type','mpesa_manual','amount',300,'reference','SJK3H7X9QB'))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-16 non-cash overpayment (change from M-Pesa) rejected', raised);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1)), jsonb_build_array(jsonb_build_object('type','mpesa_manual','amount',200))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-17 M-Pesa tender requires transaction code', raised);
  begin perform public.post_sale(br_a2, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1)), jsonb_build_array(jsonb_build_object('type','cash','amount',200))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-18 cashier cannot sell in unassigned branch', raised);
  begin update public.sales set total = 1 where client_txn_id = txn; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-19 clients cannot edit sales', raised);
  select count(*) into n from public.sale_lines where sale_id = s.id;
  perform pg_temp.ok('SAL-20 cashier can read own sale lines (receipt)', n = 3, n::text);

  perform pg_temp.as_user(ud);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1)), jsonb_build_array(jsonb_build_object('type','cash','amount',200))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-21 auditor cannot sell', raised);
  select count(*) into n from public.sales where business_id = biz_a;
  perform pg_temp.ok('SAL-22 auditor can read sales', n = 1, n::text);

  perform pg_temp.as_user(ub);
  select count(*) into n from public.sales where business_id = biz_a;
  perform pg_temp.ok('SAL-23 owner B cannot see sales of A', n = 0);
  begin perform public.post_sale(br_a1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p_sugar, 'qty', 1)), jsonb_build_array(jsonb_build_object('type','cash','amount',200))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-24 owner B cannot post sales into A', raised);
  perform pg_temp.as_anon();
  begin perform public.post_sale(br_a1, gen_random_uuid(), '[]', '[]'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-25 signed-out caller cannot post sales', raised);

  perform pg_temp.as_admin();
  begin delete from public.sale_lines where sale_id = s.id; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-26 sale lines immutable even for privileged role', raised);
  begin update public.stock_movements set qty = 99 where branch_id = br_a1; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SAL-27 stock ledger immutable even for privileged role', raised);
  select count(*) into n from public.audit_log where business_id = biz_a and action in ('sale.completed','stock.received','stock.adjusted','stock.bulk_broken','product.created');
  perform pg_temp.ok('SAL-28 sales, stock and catalog changes audited', n >= 12, n::text);
  select count(*) into n from public.branch_stock bs where bs.business_id = biz_a and bs.qty_on_hand <> (select sum(m.qty) from public.stock_movements m where m.branch_id = bs.branch_id and m.product_id = bs.product_id);
  perform pg_temp.ok('SAL-29 on-hand equals sum of ledger movements', n = 0, n::text);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE1_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
rollback;
