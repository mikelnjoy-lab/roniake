-- RONIA BUSINESS — Suppliers + invoice-linked goods receiving suite. Ends by RAISING its report, so it always rolls back.
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
  uc uuid := '00000000-0000-4000-e000-00000000000c'; ud uuid := '00000000-0000-4000-e000-00000000000d';
  biz_a uuid; br_a uuid; biz_b uuid; br_b uuid; p1 uuid; p2 uuid; pb uuid; sup uuid; sup_b uuid; sup2 uuid;
  r jsonb; r2 jsonb; n int; x numeric; y numeric; raised boolean; msg text; ref1 uuid := gen_random_uuid(); inv uuid;
begin
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('Supp Test A', 'A1', 'SA1');
  select id into br_a from public.branches where business_id = biz_a;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a]);
  perform public.add_business_member(biz_a, ud, 'auditor', array[br_a]);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'S1', 'Oil', 'pc', 300, 'B') returning id into p1;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'S2', 'Flour', 'pc', 150, 'B') returning id into p2;
  perform public.receive_stock(br_a, p1, 10, 200);
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('Supp Test B', 'B1', 'SB1');
  select id into br_b from public.branches where business_id = biz_b;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_b, 'BX', 'B', 'pc', 10, 'B') returning id into pb;
  sup_b := public.save_supplier(biz_b, null, 'B Distributors', null, null, 0);

  perform pg_temp.as_user(ua);
  sup := public.save_supplier(biz_a, null, 'Bidco Kenya', '0711000000', 'p051234567q', 30);
  perform pg_temp.ok('SUP-01 owner creates supplier', sup is not null);
  select kra_pin into msg from public.suppliers where id = sup;
  perform pg_temp.ok('SUP-02 KRA PIN stored upper-case', msg = 'P051234567Q', msg);
  begin perform public.save_supplier(biz_a, null, 'bidco kenya ', null, null, 0); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SUP-03 duplicate supplier name refused', raised);
  begin perform public.save_supplier(biz_a, null, 'Bad Pin Ltd', null, '12345', 0); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SUP-04 malformed KRA PIN refused', raised);
  begin perform public.save_supplier(biz_a, sup_b, 'Hijack', null, null, 0); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SUP-05 cannot edit supplier of another business', raised);
  begin insert into public.suppliers(business_id, name) values (biz_a, 'Direct'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('SUP-06 suppliers cannot be inserted directly', raised);

  -- receive: WAC 10@200 + 10@260 = 230
  r := public.receive_purchase_invoice(br_a, sup, 'INV-001', current_date,
        jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 10, 'unit_cost', 260), jsonb_build_object('product_id', p2, 'qty', 4, 'unit_cost', 100.5)), ref1);
  inv := (r->>'invoice_id')::uuid;
  perform pg_temp.ok('GRN-01 invoice received with total 3002', r->>'status' = 'created' and (r->>'total_cost')::numeric = 3002, r::text);
  select qty_on_hand, wac into x, y from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('GRN-02 stock 20, average cost 230', x = 20 and y = 230, x||' @ '||y);
  select count(*) into n from public.stock_movements where ref_type = 'purchase_invoice' and ref_id = inv::text;
  perform pg_temp.ok('GRN-03 one stock movement per line, linked to invoice', n = 2, n::text);
  select coalesce(sum(qty*unit_cost),0) into x from public.stock_movements where ref_type = 'purchase_invoice' and ref_id = inv::text;
  perform pg_temp.ok('GRN-04 stock value added equals invoice total', round(x,2) = 3002, x::text);
  r2 := public.receive_purchase_invoice(br_a, sup, 'INV-001', current_date,
        jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 10, 'unit_cost', 260), jsonb_build_object('product_id', p2, 'qty', 4, 'unit_cost', 100.5)), ref1);
  select qty_on_hand into x from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('GRN-05 resubmitting same delivery replays, stock added once', r2->>'status' = 'replay' and r2->>'invoice_id' = inv::text and x = 20, r2::text);
  begin perform public.receive_purchase_invoice(br_a, sup, ' inv-001', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('GRN-06 same supplier invoice number cannot be received twice', raised, msg);
  sup2 := public.save_supplier(biz_a, null, 'Unga Ltd', null, null, 0);
  r := public.receive_purchase_invoice(br_a, sup2, 'INV-001', current_date, jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1, 'unit_cost', 90)), gen_random_uuid());
  perform pg_temp.ok('GRN-07 same invoice number from a different supplier allowed', r->>'status' = 'created');
  begin perform public.receive_purchase_invoice(br_a, sup, 'INV-002', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 1), jsonb_build_object('product_id', p1, 'qty', 2, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-08 same product twice on invoice refused', raised);
  begin perform public.receive_purchase_invoice(br_a, sup, 'INV-003', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 0, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-09 zero quantity refused', raised);
  begin perform public.receive_purchase_invoice(br_a, sup, 'INV-004', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', -1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-10 negative cost refused', raised);
  begin perform public.receive_purchase_invoice(br_a, sup, 'INV-005', current_date + 30, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-11 future-dated invoice refused', raised);
  begin perform public.receive_purchase_invoice(br_a, sup_b, 'INV-006', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-12 supplier of another business refused', raised);
  begin perform public.receive_purchase_invoice(br_a, sup, 'INV-007', current_date, jsonb_build_array(jsonb_build_object('product_id', pb, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-13 product of another business refused', raised);
  begin perform public.receive_purchase_invoice(br_b, sup, 'INV-008', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-14 cannot receive into another business''s branch', raised);
  select qty_on_hand into x from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('GRN-15 refused deliveries left stock unchanged (20)', x = 20, x::text);
  perform public.save_supplier(biz_a, sup2, 'Unga Ltd', null, null, 0, false);
  begin perform public.receive_purchase_invoice(br_a, sup2, 'INV-009', current_date, jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-16 inactive supplier refused', raised);
  select count(*) into n from public.audit_log where business_id = biz_a and action in ('purchase.received','supplier.created','supplier.updated');
  perform pg_temp.ok('GRN-17 suppliers and deliveries audited (2 received + 2 created + 1 updated)', n = 5, n::text);

  perform pg_temp.as_user(uc);
  begin perform public.receive_purchase_invoice(br_a, sup, 'INV-010', current_date, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 1)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-18 cashier cannot receive deliveries', raised);
  select count(*) into n from public.suppliers where business_id = biz_a;
  perform pg_temp.ok('GRN-19 cashier cannot see suppliers', n = 0, n::text);
  perform pg_temp.as_user(ud);
  begin perform public.save_supplier(biz_a, null, 'Auditor Co', null, null, 0); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-20 auditor cannot create suppliers', raised);
  select count(*) into n from public.purchase_invoices where business_id = biz_a;
  perform pg_temp.ok('GRN-21 auditor can read received invoices', n = 2, n::text);
  perform pg_temp.as_user(ub);
  select count(*) into n from public.purchase_invoices where business_id = biz_a;
  perform pg_temp.ok('GRN-22 other business sees no invoices', n = 0, n::text);
  select count(*) into n from public.suppliers where business_id = biz_a;
  perform pg_temp.ok('GRN-23 other business sees no suppliers', n = 0, n::text);
  perform pg_temp.as_admin();
  begin update public.purchase_invoice_lines set qty = 1 where invoice_id = inv; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-24 invoice lines immutable', raised);
  begin delete from public.purchase_invoices where id = inv; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-25 invoices immutable', raised);
  select count(*) into n from public.branch_stock bs where bs.business_id = biz_a and bs.qty_on_hand <> (select coalesce(sum(m.qty),0) from public.stock_movements m where m.branch_id = bs.branch_id and m.product_id = bs.product_id);
  perform pg_temp.ok('GRN-26 on-hand equals sum of movements', n = 0, n::text);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PHASE5_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
