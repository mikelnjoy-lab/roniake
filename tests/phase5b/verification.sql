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
  ua uuid := '00000000-0000-4000-f000-00000000000a'; ub uuid := '00000000-0000-4000-f000-00000000000b';
  uc uuid := '00000000-0000-4000-f000-00000000000c'; ud uuid := '00000000-0000-4000-f000-00000000000d';
  um uuid := '00000000-0000-4000-f000-00000000000e';
  biz_a uuid; br_a uuid; biz_b uuid; br_b uuid; p1 uuid; p2 uuid; sup uuid; sup_b uuid;
  po uuid; po2 uuid; r jsonb; n int; x numeric; y numeric; raised boolean; msg text; inv1 uuid; inv2 uuid; ref uuid; pref uuid;
  wac_before numeric; cogs_before numeric; st text;
begin
  perform pg_temp.as_user(ua);
  biz_a := public.create_business('PO Test A', 'A1', 'PA1');
  select id into br_a from public.branches where business_id = biz_a;
  perform public.add_business_member(biz_a, uc, 'cashier', array[br_a]);
  perform public.add_business_member(biz_a, ud, 'auditor', array[br_a]);
  perform public.add_business_member(biz_a, um, 'manager', array[br_a]);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'P1', 'Oil', 'pc', 300, 'B') returning id into p1;
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'P2', 'Flour', 'pc', 150, 'B') returning id into p2;
  perform public.receive_stock(br_a, p1, 10, 200);
  sup := public.save_supplier(biz_a, null, 'Bidco Kenya', null, null, 30);
  perform pg_temp.as_user(ub);
  biz_b := public.create_business('PO Test B', 'B1', 'PB1');
  select id into br_b from public.branches where business_id = biz_b;
  sup_b := public.save_supplier(biz_b, null, 'B Dist', null, null, 0);

  -- PO creation / lifecycle
  perform pg_temp.as_user(ua);
  ref := gen_random_uuid();
  r := public.create_purchase_order(br_a, sup, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',20,'unit_cost',260), jsonb_build_object('product_id',p2,'qty',10,'unit_cost',100)), 'weekly', ref);
  po := (r->>'po_id')::uuid;
  perform pg_temp.ok('PO-01 order created as draft PO-00001 total 6200', r->>'po_no' = 'PO-00001' and (r->>'expected_total')::numeric = 6200 and (select status from public.purchase_orders where id = po) = 'draft', r::text);
  r := public.create_purchase_order(br_a, sup, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',20,'unit_cost',260)), 'weekly', ref);
  select count(*) into n from public.purchase_orders where business_id = biz_a;
  perform pg_temp.ok('PO-02 repeated create replays, one order exists', r->>'status' = 'replay' and n = 1, n::text);
  begin perform public.create_purchase_order(br_a, sup, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1,'unit_cost',1), jsonb_build_object('product_id',p1,'qty',1,'unit_cost',1)), null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PO-03 same product twice on order refused', raised);
  begin perform public.create_purchase_order(br_a, sup_b, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1,'unit_cost',1)), null, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PO-04 supplier of another business refused', raised);
  begin perform public.receive_purchase_order(po, 'D-1', current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1,'unit_cost',260)), gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('PO-05 draft order cannot be received', raised, msg);

  perform pg_temp.as_user(uc);
  begin perform public.approve_purchase_order(po); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PO-06 cashier cannot approve', raised);
  perform pg_temp.as_user(ud);
  begin perform public.approve_purchase_order(po); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PO-07 auditor cannot approve', raised);
  perform pg_temp.as_user(um);
  r := public.approve_purchase_order(po);
  perform pg_temp.ok('PO-08 manager approves order', r->>'status' = 'approved' and (select status from public.purchase_orders where id = po) = 'approved');

  -- partial delivery, WAC 10@200 + 8@260 = (2000+2080)/18 = 226.6667
  perform pg_temp.as_user(ua);
  ref := gen_random_uuid();
  r := public.receive_purchase_order(po, 'INV-A1', current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',8,'unit_cost',260)), ref);
  inv1 := (r->>'invoice_id')::uuid;
  perform pg_temp.ok('GRN-PO-01 partial delivery posts invoice 2080, order partially received', r->>'status'='created' and (r->>'total_cost')::numeric = 2080 and r->>'po_status' = 'partially_received', r::text);
  select qty_on_hand, wac into x, y from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('GRN-PO-02 stock 18 and WAC updated by existing rule', x = 18 and round(y,4) = 226.6667, x||' @ '||y);
  select qty_received into x from public.purchase_order_lines where po_id = po and product_id = p1;
  perform pg_temp.ok('GRN-PO-03 order line shows 8 of 20 received', x = 8, x::text);
  perform pg_temp.ok('GRN-PO-04 invoice linked to order', (select purchase_order_id from public.purchase_invoices where id = inv1) = po);
  r := public.receive_purchase_order(po, 'INV-A1', current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',8,'unit_cost',260)), ref);
  select qty_on_hand into x from public.branch_stock where branch_id = br_a and product_id = p1;
  select qty_received into y from public.purchase_order_lines where po_id = po and product_id = p1;
  perform pg_temp.ok('GRN-PO-05 resubmitted delivery replays, stock and order unchanged', r->>'status' = 'replay' and x = 18 and y = 8, r::text);
  begin perform public.receive_purchase_order(po, 'inv-a1 ', current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1,'unit_cost',260)), gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('GRN-PO-06 same supplier invoice cannot be posted twice', raised, msg);
  begin perform public.receive_purchase_order(po, 'INV-A2', current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',13,'unit_cost',260)), gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('GRN-PO-07 over-receiving (13 > 12 remaining) refused', raised and msg like 'over-receiving%', msg);
  select qty_on_hand into x from public.branch_stock where branch_id = br_a and product_id = p1;
  perform pg_temp.ok('GRN-PO-08 refused over-receipt left stock at 18 and no invoice', x = 18 and not exists (select 1 from public.purchase_invoices where invoice_no = 'INV-A2' and business_id = biz_a), x::text);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz_a, 'P3', 'Salt', 'pc', 50, 'B') returning id into pref;
  begin perform public.receive_purchase_order(po, 'INV-A3', current_date, jsonb_build_array(jsonb_build_object('product_id',pref,'qty',1,'unit_cost',10)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-PO-09 item not on order refused', raised);
  r := public.receive_purchase_order(po, 'INV-A4', current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'qty',12,'unit_cost',255), jsonb_build_object('product_id',p2,'qty',10,'unit_cost',100)), gen_random_uuid());
  inv2 := (r->>'invoice_id')::uuid;
  perform pg_temp.ok('GRN-PO-10 final delivery completes order (actual invoice cost 255 used)', r->>'po_status' = 'received' and (r->>'total_cost')::numeric = 4060, r::text);
  begin perform public.receive_purchase_order(po, 'INV-A5', current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'qty',1,'unit_cost',100)), gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-PO-11 fully received order refuses more', raised);
  begin perform public.cancel_purchase_order(po, 'too late'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('GRN-PO-12 fully received order cannot be cancelled', raised);

  -- cancellation
  r := public.create_purchase_order(br_a, sup, jsonb_build_array(jsonb_build_object('product_id',p2,'qty',5,'unit_cost',100)), null, gen_random_uuid());
  po2 := (r->>'po_id')::uuid;
  perform public.approve_purchase_order(po2);
  perform public.receive_purchase_order(po2, 'INV-C1', current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'qty',2,'unit_cost',100)), gen_random_uuid());
  begin perform public.cancel_purchase_order(po2, ''); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('CAN-01 cancelling requires a reason', raised);
  r := public.cancel_purchase_order(po2, 'Supplier out of stock');
  perform pg_temp.ok('CAN-02 partially received order cancelled, received qty kept', r->>'status' = 'cancelled' and (select qty_received from public.purchase_order_lines where po_id = po2) = 2);
  begin perform public.receive_purchase_order(po2, 'INV-C2', current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'qty',1,'unit_cost',100)), gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('CAN-03 cancelled order cannot be received', raised, msg);
  perform pg_temp.ok('CAN-04 second number PO-00002', (select po_no from public.purchase_orders where id = po2) = 'PO-00002');

  -- payments / balances. Invoices: 2080 + 4060 + 200 = 6340
  select outstanding into x from public.supplier_balances(biz_a) where supplier_id = sup;
  perform pg_temp.ok('PAY-01 outstanding equals invoices total 6340', x = 6340, x::text);
  perform pg_temp.as_user(uc);
  begin perform public.record_supplier_payment(inv1, 100, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-02 cashier cannot pay suppliers', raised);
  perform pg_temp.as_user(ud);
  begin perform public.record_supplier_payment(inv1, 100, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-03 auditor cannot pay suppliers', raised);
  perform pg_temp.as_user(ua);
  pref := gen_random_uuid();
  r := public.record_supplier_payment(inv1, 1000, 'mpesa', 'qwe123abc', current_date, pref);
  perform pg_temp.ok('PAY-04 part payment recorded, invoice outstanding 1080', r->>'status' = 'created' and (r->>'outstanding')::numeric = 1080, r::text);
  r := public.record_supplier_payment(inv1, 1000, 'mpesa', 'qwe123abc', current_date, pref);
  select count(*) into n from public.supplier_payments where invoice_id = inv1;
  perform pg_temp.ok('PAY-05 repeated submission replays, one payment', r->>'status' = 'replay' and n = 1, n::text);
  begin perform public.record_supplier_payment(inv2, 50, 'mpesa', 'QWE123ABC', current_date, gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('PAY-06 same M-Pesa code cannot be used twice', raised, msg);
  begin perform public.record_supplier_payment(inv1, 1080.01, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('PAY-07 overpayment refused', raised, msg);
  begin perform public.record_supplier_payment(inv1, -5, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-08 negative amount refused', raised);
  begin perform public.record_supplier_payment(inv1, 10, 'bank', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-09 bank payment needs a reference', raised);
  begin perform public.record_supplier_payment(inv1, 10, 'cash', null, current_date + 10, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-10 future-dated payment refused', raised);
  perform pg_temp.as_user(um);
  perform public.record_supplier_payment(inv1, 1080, 'cash', null, current_date, gen_random_uuid());
  perform pg_temp.as_user(ua);
  select invoiced, paid, outstanding into x, y, msg from public.supplier_balances(biz_a) where supplier_id = sup;
  perform pg_temp.ok('PAY-11 balance derived: invoiced 6340, paid 2080, outstanding 4260', x = 6340 and y = 2080 and msg::numeric = 4260, x||'/'||y||'/'||msg);
  begin perform public.record_supplier_payment(inv1, 1, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-12 fully paid invoice refuses more', raised);
  begin insert into public.supplier_payments(business_id, branch_id, supplier_id, invoice_id, amount, method, paid_on, client_ref, actor_user_id) values (biz_a, br_a, sup, inv2, 4060, 'cash', current_date, gen_random_uuid(), ua); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-13 payments cannot be inserted directly', raised);
  begin update public.purchase_order_lines set qty_received = 20 where po_id = po2; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PAY-14 order lines cannot be edited directly', raised);

  -- isolation
  perform pg_temp.as_user(ub);
  select count(*) into n from public.purchase_orders where business_id = biz_a;
  perform pg_temp.ok('ISO-01 other business sees no orders', n = 0, n::text);
  select count(*) into n from public.supplier_payments where business_id = biz_a;
  perform pg_temp.ok('ISO-02 other business sees no payments', n = 0, n::text);
  select count(*) into n from public.supplier_balances(biz_a);
  perform pg_temp.ok('ISO-03 other business gets no balances', n = 0, n::text);
  begin perform public.approve_purchase_order(po2); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-04 other business cannot act on order', raised);
  begin perform public.record_supplier_payment(inv2, 1, 'cash', null, current_date, gen_random_uuid()); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-05 other business cannot pay invoice', raised);
  perform pg_temp.as_user(uc);
  select count(*) into n from public.purchase_orders where business_id = biz_a;
  perform pg_temp.ok('ISO-06 cashier sees no orders', n = 0, n::text);
  perform pg_temp.as_user(ud);
  select count(*) into n from public.supplier_payments where business_id = biz_a;
  perform pg_temp.ok('ISO-07 auditor can read payments (2)', n = 2, n::text);

  -- audit + immutability
  perform pg_temp.as_admin();
  select count(*) into n from public.audit_log where business_id = biz_a and action in ('po.created','po.approved','po.cancelled');
  perform pg_temp.ok('AUD-01 order lifecycle audited (2 created + 2 approved + 1 cancelled)', n = 5, n::text);
  select count(*) into n from public.audit_log where business_id = biz_a and action = 'supplier.payment';
  perform pg_temp.ok('AUD-02 each payment audited (2)', n = 2, n::text);
  select count(*) into n from public.audit_log where business_id = biz_a and action = 'purchase.received' and payload->>'purchase_order_id' is not null;
  perform pg_temp.ok('AUD-03 order deliveries audited with order link (3)', n = 3, n::text);
  begin update public.supplier_payments set amount = 1 where invoice_id = inv1; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-04 payments immutable even for admin', raised);
  begin delete from public.purchase_orders where id = po; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-05 orders cannot be deleted', raised);
  begin update public.purchase_orders set status = 'approved' where id = po2; raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('AUD-06 cancelled order cannot be reopened', raised);
  select count(*) into n from public.stock_movements m where m.business_id = biz_a and m.ref_type = 'purchase_invoice'
    and m.unit_cost <> (select l.unit_cost from public.purchase_invoice_lines l where l.invoice_id::text = m.ref_id and l.product_id = m.product_id);
  perform pg_temp.ok('AUD-07 stock movement costs equal invoice line costs', n = 0, n::text);
  select count(*) into n from public.branch_stock bs where bs.business_id = biz_a and bs.qty_on_hand <> (select coalesce(sum(m.qty),0) from public.stock_movements m where m.branch_id = bs.branch_id and m.product_id = bs.product_id);
  perform pg_temp.ok('AUD-08 on-hand equals sum of movements', n = 0, n::text);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by id) into rep from t_results;
  raise exception E'PURCHASING_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
