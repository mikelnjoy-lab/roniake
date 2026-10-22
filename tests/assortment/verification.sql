-- RONIA BUSINESS — Branch product assortment suite. Ends by RAISING its report, so it always rolls back.
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
  uo uuid := '00000000-0000-4000-f100-00000000000a'; uca uuid := '00000000-0000-4000-f100-00000000000c';
  ucb uuid := '00000000-0000-4000-f100-00000000000e'; ux uuid := '00000000-0000-4000-f100-00000000000d';
  biz uuid; biz_x uuid; br_a uuid; br_b uuid; br_x uuid; p1 uuid; p2 uuid; r jsonb; n int; raised boolean; msg text;
  wac_a numeric; qty_a numeric; sales_a int; mv_a int;
begin
  perform pg_temp.as_user(uo);
  biz := public.create_business('Assort Test', 'Utensils', 'AUT1');
  select id into br_a from public.branches where business_id = biz;
  perform pg_temp.as_admin();
  update public.subscriptions set max_branches = 10, max_staff = 20 where business_id = biz;
  perform pg_temp.as_user(uo);
  insert into public.branches(business_id, name, code) values (biz, 'Charcoal', 'ACH1') returning id into br_b;
  perform public.add_business_member(biz, uca, 'cashier', array[br_a]);
  perform public.add_business_member(biz, ucb, 'cashier', array[br_b]);
  insert into public.products(business_id, sku, barcode, name, unit, selling_price, tax_class) values (biz, 'AS1', '600111', 'Sufuria', 'pc', 100, 'B') returning id into p1;
  insert into public.products(business_id, sku, barcode, name, unit, selling_price, tax_class) values (biz, 'AS2', '600222', 'Makaa bag', 'bag', 300, 'B') returning id into p2;

  perform pg_temp.ok('NEW-01 a new product is not silently enabled in any branch',
    not exists (select 1 from public.branch_products where product_id in (p1, p2)));
  perform public.set_branch_product(br_a, p1, true);
  perform pg_temp.ok('NEW-02 enabling in A does not enable in B',
    exists (select 1 from public.branch_products where branch_id = br_a and product_id = p1 and enabled)
    and not exists (select 1 from public.branch_products where branch_id = br_b and product_id = p1));
  perform pg_temp.ok('AUD-01 enabling is audited', exists (select 1 from public.audit_log where action = 'branch_product.enabled' and entity_id = p1::text and branch_id = br_a));

  perform public.receive_stock(br_a, p1, 20, 60);
  select count(*) into n from public.branch_catalog(br_a) where id = p1;
  perform pg_temp.ok('POS-01 enabled product listed in branch A catalog', n = 1);
  select count(*) into n from public.branch_catalog(br_b) where id = p1 or barcode = '600111';
  perform pg_temp.ok('POS-02 branch B catalog/barcode lookup does not return A-only product', n = 0, n::text);

  -- Branch B stocking p2 enables it only there
  perform public.receive_stock(br_b, p2, 5, 200);
  perform pg_temp.ok('STK-01 receiving into B enables product only in B',
    exists (select 1 from public.branch_products where branch_id = br_b and product_id = p2 and enabled)
    and not exists (select 1 from public.branch_products where branch_id = br_a and product_id = p2));

  -- Sale in B of A-only product refused server-side
  perform public.open_shift(br_b, 0);
  begin r := public.post_sale(br_b, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), '[{"type":"cash","amount":100}]'); raised := false;
  exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('SALE-01 post_sale refuses a product not sold in the branch (offline replay included)', raised, msg);

  -- Zero-stock enabled product follows the out-of-stock rule, not the assortment rule
  perform public.set_branch_product(br_b, p1, true);
  begin r := public.post_sale(br_b, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), '[{"type":"cash","amount":100}]'); raised := false;
  exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('ZERO-01 enabled but zero stock in B: refused as out of stock', raised and msg not like '%PRODUCT_NOT_IN_BRANCH%', msg);
  select count(*) into n from public.branch_catalog(br_b) where id = p1;
  perform pg_temp.ok('ZERO-02 enabled zero-stock product appears in B catalog', n = 1);
  perform pg_temp.ok('ISO-01 enabling in B copied no stock', not exists (select 1 from public.branch_stock where branch_id = br_b and product_id = p1));

  -- A sales/stock unaffected
  perform public.open_shift(br_a, 0);
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2)), '[{"type":"cash","amount":200}]');
  select qty_on_hand, wac into qty_a, wac_a from public.branch_stock where branch_id = br_a and product_id = p1;
  select count(*) into sales_a from public.sales where branch_id = br_a;
  select count(*) into mv_a from public.stock_movements where branch_id = br_a and product_id = p1;
  perform public.set_branch_product(br_b, p1, false);
  perform public.set_branch_product(br_b, p1, true);
  perform pg_temp.ok('ISO-02 toggling in B leaves A stock, WAC, sales and movements unchanged',
    (select qty_on_hand from public.branch_stock where branch_id = br_a and product_id = p1) = qty_a and qty_a = 18
    and (select wac from public.branch_stock where branch_id = br_a and product_id = p1) = wac_a
    and (select count(*) from public.sales where branch_id = br_a) = sales_a
    and (select count(*) from public.stock_movements where branch_id = br_a and product_id = p1) = mv_a);

  -- Disabling in A keeps history; further sales refused
  perform public.set_branch_product(br_a, p1, false);
  perform pg_temp.ok('HIST-01 disabling keeps historical sale lines', exists (select 1 from public.sale_lines sl join public.sales s on s.id = sl.sale_id where s.branch_id = br_a and sl.product_id = p1));
  begin r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), '[{"type":"cash","amount":100}]'); raised := false;
  exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('SALE-02 disabled product refused in A', raised and msg like '%PRODUCT_NOT_IN_BRANCH%', msg);
  perform public.set_branch_product(br_a, p1, true);

  -- Permissions
  perform pg_temp.as_user(uca);
  begin perform public.set_branch_product(br_a, p2, true); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PERM-01 cashier cannot change assortment', raised);
  select count(*) into n from public.branch_catalog(br_b);
  perform pg_temp.ok('PERM-02 branch A cashier cannot read branch B catalog', n = 0, n::text);
  select count(*) into n from public.branch_products where branch_id = br_b;
  perform pg_temp.ok('PERM-03 branch A cashier cannot read branch B assortment rows', n = 0, n::text);
  begin insert into public.branch_products(business_id, branch_id, product_id) values (biz, br_a, p2); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PERM-04 direct writes to assortment refused', raised);
  perform pg_temp.as_user(ucb);
  select count(*) into n from public.branch_catalog(br_b) where id = p2;
  perform pg_temp.ok('POS-03 branch B cashier sees B product', n = 1);

  perform pg_temp.as_user(ux);
  biz_x := public.create_business('Other Shop', 'X1', 'AOX1');
  select id into br_x from public.branches where business_id = biz_x;
  begin perform public.set_branch_product(br_a, p2, true); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('TEN-01 other business owner cannot change assortment', raised);
  select count(*) into n from public.branch_catalog(br_a);
  perform pg_temp.ok('TEN-02 other business cannot read catalog', n = 0);
  begin perform public.set_branch_product(br_x, p1, true); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('TEN-03 cannot enable a foreign product in own branch', raised);

  perform pg_temp.as_user(uo);
  select count(*) into n from public.products where business_id = biz;
  perform pg_temp.ok('OVR-01 owner keeps business-wide product oversight', n = 2);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by passed, id) into rep from t_results;
  raise exception E'ASSORTMENT_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
