-- RONIA BUSINESS — Stock count + M-Pesa reconciliation suite. Ends by RAISING its report, so it always rolls back.
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
  ua uuid := '00000000-0000-4000-d000-00000000000a'; ub uuid := '00000000-0000-4000-d000-00000000000b';
  uc uuid := '00000000-0000-4000-d000-00000000000c'; ud uuid := '00000000-0000-4000-d000-00000000000d';
  um uuid := '00000000-0000-4000-d000-00000000000e';
  biz_a uuid; br_a uuid; br_a2 uuid; biz_b uuid; br_b uuid; p1 uuid; p2 uuid; pb uuid;
  r jsonb; n int; x numeric; y numeric; v0 numeric; raised boolean; msg text; cid uuid;
  s1 uuid; s2 uuid; s3 uuid; t1 bigint; t2 bigint; t3 bigint;
begin
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Count Test A', 'A1', 'CA1');
  select id into br_a from public.branches where business_id = biz_a;
  insert into public.branches(business_id, name, code) values (biz_a, 'A2', 'CA2') returning id into br_a2;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a]);
  perform public.add_business_member(biz_a, ud, 'auditor', array[br_a]);
  perform public.add_business_member(biz_a, um, 'manager', array[br_a2]);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'C1', 'Rice 1kg', 'pc', 200, 'B') returning id into p1;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'C2', 'Salt', 'pc', 50, 'B') returning id into p2;
  perform public.receive_stock(br_a, p1, 10, 120);
  perform public.receive_stock(br_a, p2, 5, 20);
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('Count Test B', 'B1', 'CB1');
  select id into br_b from public.branches where business_id = biz_b;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_b, 'BX', 'B', 'pc', 10, 'B') returning id into pb;

  -- ===== stock counts =====
  perform pg_temp.as_user(ua);
  r := public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 7), jsonb_build_object('product_id', p2, 'counted', 5)), 'month end');
  cid := (r->>'count_id')::uuid;
  perform pg_temp.ok('CNT-01 count returns 2 lines, 1 corrected', (r->>'lines')::int = 2 and (r->>'adjusted')::int = 1, r::text);
  select qty_on_hand, wac into x, y from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('CNT-02 shortage sets on-hand to counted (7)', x = 7, x::text);
  perform pg_temp.ok('CNT-03 shortage keeps average cost (120)', y = 120, y::text);
  select qty, unit_cost into x, y from public.stock_movements where ref_type = 'stock_count' and ref_id = cid::text and product_id = p1;
  perform pg_temp.ok('CNT-04 movement records -3 at cost 120 (value -360)', x = -3 and y = 120, x||' @ '||y);
  select count(*) into n from public.stock_movements where ref_type = 'stock_count' and ref_id = cid::text;
  perform pg_temp.ok('CNT-05 unchanged item gets no movement', n = 1, n::text);
  select system_qty, counted_qty, variance, unit_cost into x, y, v0, msg from public.stock_count_lines where count_id = cid and product_id = p1;
  perform pg_temp.ok('CNT-06 count line keeps system 10 / counted 7 / variance -3', x = 10 and y = 7 and v0 = -3, x||'/'||y||'/'||v0);
  r := public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 9)));
  select qty_on_hand, wac into x, y from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('CNT-07 surplus adds at current average cost (9 @ 120)', x = 9 and y = 120, x||' @ '||y);
  r := public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 9)));
  select qty_on_hand into x from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('CNT-08 repeated identical count corrects nothing', (r->>'adjusted')::int = 0 and x = 9, r::text);
  begin perform public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 5), jsonb_build_object('product_id', p1, 'counted', 6))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-09 same product twice in one count refused', raised);
  begin perform public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', -1))); raised := false; exception when others then raised := true; end;
  select qty_on_hand into x from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('CNT-10 negative count refused, stock unchanged', raised and x = 9, x::text);
  begin perform public.apply_stock_count(br_a, '[]'::jsonb); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-11 empty count refused', raised);
  begin perform public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', pb, 'counted', 1))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-12 product of another business refused', raised);
  begin perform public.apply_stock_count(br_b, jsonb_build_array(jsonb_build_object('product_id', pb, 'counted', 1))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-13 count in another business''s branch refused', raised);
  select count(*) into n from public.audit_log where business_id = biz_a and action = 'stock.counted';
  perform pg_temp.ok('CNT-14 each count written to activity log (3)', n = 3, n::text);
  perform pg_temp.as_user(uc);
  begin perform public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 0))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-15 cashier cannot apply a count', raised);
  perform pg_temp.as_user(ud);
  begin perform public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 0))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-16 auditor cannot apply a count', raised);
  select count(*) into n from public.stock_counts where business_id = biz_a;
  perform pg_temp.ok('CNT-17 auditor can read count history', n = 3, n::text);
  perform pg_temp.as_user(um);
  begin perform public.apply_stock_count(br_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'counted', 0))); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-18 manager cannot count a branch not assigned to them', raised);
  perform pg_temp.as_user(ub);
  select count(*) into n from public.stock_counts where business_id = biz_a;
  perform pg_temp.ok('CNT-19 other business sees no counts', n = 0, n::text);
  perform pg_temp.as_admin();
  begin update public.stock_count_lines set counted_qty = 100 where count_id = cid; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CNT-20 count lines immutable', raised);
  select count(*) into n from public.branch_stock bs where bs.business_id = biz_a and bs.qty_on_hand <> (select coalesce(sum(m.qty),0) from public.stock_movements m where m.branch_id = bs.branch_id and m.product_id = bs.product_id);
  perform pg_temp.ok('CNT-21 on-hand still equals sum of movements', n = 0, n::text);

  -- ===== M-Pesa reconciliation =====
  perform pg_temp.as_user(uc);
  perform public.open_shift(br_a, 0);
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)), '[{"type":"mpesa_manual","amount":50,"reference":"QAA111BBB1"}]'); s1 := (r->>'sale_id')::uuid;
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)), '[{"type":"mpesa_manual","amount":50,"reference":"QAA111BBB1"}]'); s2 := (r->>'sale_id')::uuid;
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)), '[{"type":"mpesa_manual","amount":50,"reference":"QCC333DDD3"}]'); s3 := (r->>'sale_id')::uuid;
  select id into t1 from public.sale_tenders where sale_id = s1;
  select id into t2 from public.sale_tenders where sale_id = s2;
  select id into t3 from public.sale_tenders where sale_id = s3;
  begin perform public.reconcile_mpesa(t1, 'verified'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-01 cashier cannot reconcile', raised);
  perform pg_temp.as_user(ud);
  begin perform public.reconcile_mpesa(t1, 'verified'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-02 auditor cannot reconcile (read-only)', raised);
  perform pg_temp.as_user(ub);
  begin perform public.reconcile_mpesa(t1, 'verified'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-03 other business cannot reconcile', raised);
  select count(*) into n from public.sale_tenders where business_id = biz_a;
  perform pg_temp.ok('MP-04 other business sees no M-Pesa payments', n = 0, n::text);
  perform pg_temp.as_user(um);
  begin perform public.reconcile_mpesa(t1, 'verified'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-05 manager of another branch cannot reconcile', raised);

  perform pg_temp.as_user(ua);
  r := public.reconcile_mpesa(t1, 'verified', null, 50);
  perform pg_temp.ok('MP-06 matching amount verified', r->>'status' = 'verified' and (r->>'changed')::boolean, r::text);
  r := public.reconcile_mpesa(t1, 'verified', null, 50);
  select count(*) into n from public.mpesa_reconciliations where sale_tender_id = t1;
  perform pg_temp.ok('MP-07 retry of same status is a no-op (one record)', not (r->>'changed')::boolean and n = 1, n::text);
  begin perform public.reconcile_mpesa(t2, 'verified'); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('MP-08 duplicate code cannot be verified twice', raised, msg);
  r := public.reconcile_mpesa(t2, 'flagged', 'same code as another sale');
  perform pg_temp.ok('MP-09 duplicate code can be flagged', r->>'status' = 'flagged');
  begin perform public.reconcile_mpesa(t3, 'verified', null, 40); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('MP-10 statement amount differing from sale refused for verify', raised, msg);
  begin perform public.reconcile_mpesa(t3, 'verified', null, -5); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-11 negative statement amount refused', raised);
  begin perform public.reconcile_mpesa(t3, 'flagged', ''); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-12 flag without reason refused', raised);
  begin perform public.reconcile_mpesa(t3, 'paid'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-13 unknown status refused', raised);
  r := public.reconcile_mpesa(t3, 'flagged', 'not on statement yet', 40);
  r := public.reconcile_mpesa(t3, 'verified', null, 50);
  perform pg_temp.ok('MP-14 flagged -> verified transition allowed once resolved', r->>'status' = 'verified' and r->>'previous' = 'flagged', r::text);
  select count(*) into n from public.mpesa_reconciliations where sale_tender_id = t3;
  perform pg_temp.ok('MP-15 full history kept (2 records)', n = 2, n::text);
  select id into t1 from public.sale_tenders where sale_id = s1;
  begin perform public.reconcile_mpesa((select min(id) from public.sale_tenders where business_id = biz_a and tender_type = 'cash'), 'verified'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-16 non-M-Pesa payment cannot be reconciled', raised);
  perform public.void_sale(s2, 'duplicate code');
  begin perform public.reconcile_mpesa(t2, 'verified'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-17 voided sale cannot be marked verified', raised);
  select count(*) into n from public.audit_log where business_id = biz_a and action in ('mpesa.verified','mpesa.flagged');
  perform pg_temp.ok('MP-18 every status change audited (4), no-op retry not audited', n = 4, n::text);
  perform pg_temp.as_user(ud);
  select count(*) into n from public.mpesa_reconciliations where business_id = biz_a;
  perform pg_temp.ok('MP-19 auditor can read reconciliation history', n = 4, n::text);
  perform pg_temp.as_admin();
  begin update public.mpesa_reconciliations set status = 'verified' where sale_tender_id = t2; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-20 reconciliation records immutable', raised);
  perform pg_temp.as_user(ua);
  begin insert into public.mpesa_reconciliations(business_id, sale_tender_id, status, actor_user_id) values (biz_a, t2, 'verified', ua); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('MP-21 reconciliation cannot be inserted directly by app users', raised);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE4_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
