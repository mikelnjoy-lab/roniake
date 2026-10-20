-- RONIA BUSINESS — Branch receipt settings suite. Ends by RAISING its report, so it always rolls back.
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
  uo uuid := '00000000-0000-4000-f000-00000000000a'; um uuid := '00000000-0000-4000-f000-00000000000b';
  uc uuid := '00000000-0000-4000-f000-00000000000c'; ux uuid := '00000000-0000-4000-f000-00000000000d';
  biz uuid; biz_x uuid; br_a uuid; br_b uuid; br_c uuid; br_x uuid; p1 uuid; cust uuid; sh uuid;
  s_split uuid; s_deni uuid; s_old uuid; l1 bigint; r jsonb; n int; v int; raised boolean; msg text; snap jsonb; w int;
begin
  perform pg_temp.as_user(uo);
  biz := public.create_business('Rcpt Test', 'Utensils', 'RUT1');
  select id into br_a from public.branches where business_id = biz;
  perform pg_temp.as_admin();
  update public.subscriptions set max_branches = 10 where business_id = biz;
  perform pg_temp.as_user(uo);
  insert into public.branches(business_id, name, code, physical_address) values (biz, 'Charcoal', 'RCH1', 'Kariobangi') returning id into br_b;
  perform public.add_business_member(biz, um, 'manager', array[br_a]);
  perform public.add_business_member(biz, uc, 'cashier', array[br_a]);
  perform pg_temp.as_user(ux);
  biz_x := public.create_business('Other Shop', 'X1', 'ROX1');
  select id into br_x from public.branches where business_id = biz_x;

  -- defaults
  perform pg_temp.as_admin();
  select count(*) into n from public.branch_receipt_settings where branch_id in (br_a, br_b);
  perform pg_temp.ok('DEF-01 every new branch gets default receipt settings', n = 2, n::text);
  select paper_width into w from public.branch_receipt_settings where branch_id = br_b;
  perform pg_temp.ok('DEF-02 default paper is 80mm', w = 80);
  perform pg_temp.ok('DEF-03 default display name = branch name, address copied',
    exists (select 1 from public.branch_receipt_settings where branch_id = br_b and display_name = 'Charcoal' and address = 'Kariobangi'));

  -- owner edits A; B unchanged
  perform pg_temp.as_user(uo);
  v := public.save_branch_receipt_settings(br_a, '{"display_name":"Utensil World","footer":"No returns after 7 days","paper_width":58,"show_phone":false}');
  perform pg_temp.ok('PERM-01 owner can save branch A settings', v = 2, v::text);
  perform pg_temp.ok('ISO-01 branch B untouched by branch A change',
    exists (select 1 from public.branch_receipt_settings where branch_id = br_b and display_name = 'Charcoal' and paper_width = 80 and footer is null and version = 1));
  perform public.save_branch_receipt_settings(br_b, '{"display_name":"Makaa Bora","paper_width":80}');
  perform pg_temp.ok('ISO-02 owner configures branch B independently',
    (select display_name from public.branch_receipt_settings where branch_id = br_b) = 'Makaa Bora'
    and (select display_name from public.branch_receipt_settings where branch_id = br_a) = 'Utensil World');
  perform pg_temp.ok('ID-01 Business legal name not changed by branch branding', (select name from public.businesses where id = biz) = 'Rcpt Test');

  -- manager: only own branches
  perform pg_temp.as_user(um);
  begin perform public.save_branch_receipt_settings(br_a, '{"display_name":"Mgr edit","paper_width":80}'); raised := false; exception when others then raised := true; msg := sqlerrm; end;
  perform pg_temp.ok('PERM-02 manager can edit assigned branch', not raised, msg);
  begin perform public.save_branch_receipt_settings(br_b, '{"display_name":"hack"}'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PERM-03 manager cannot edit unassigned branch', raised);
  select count(*) into n from public.branch_receipt_settings where branch_id = br_b;
  perform pg_temp.ok('PERM-04 manager cannot even read unassigned branch settings', n = 0, n::text);

  -- cashier: read only
  perform pg_temp.as_user(uc);
  begin perform public.save_branch_receipt_settings(br_a, '{"display_name":"hack"}'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('PERM-05 cashier cannot edit receipt settings', raised);
  select count(*) into n from public.branch_receipt_settings where branch_id = br_a;
  perform pg_temp.ok('PERM-06 cashier can read own branch settings for printing', n = 1);
  begin update public.branch_receipt_settings set footer = 'x' where branch_id = br_a; get diagnostics n = row_count; raised := n = 0; exception when others then raised := true; end;
  perform pg_temp.ok('PERM-07 no direct table writes (RPC only)', raised);

  -- cross business
  perform pg_temp.as_user(ux);
  begin perform public.save_branch_receipt_settings(br_a, '{"display_name":"hack"}'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('ISO-03 other business cannot edit', raised);
  select count(*) into n from public.branch_receipt_settings where business_id = biz;
  perform pg_temp.ok('ISO-04 other business cannot read', n = 0, n::text);

  -- audit
  perform pg_temp.as_admin();
  select count(*) into n from public.audit_log where business_id = biz and action = 'branch.receipt_settings_updated';
  perform pg_temp.ok('AUD-01 every settings change audited', n = 3, n::text);

  -- sales: snapshot frozen
  perform pg_temp.as_user(uo);
  insert into public.products(business_id, sku, name, unit, selling_price, tax_class) values (biz, 'RS1', 'Sufuria', 'pc', 100, 'B') returning id into p1;
  insert into public.customers(business_id, name, credit_enabled, credit_limit) values (biz, 'Achieng', true, 5000) returning id into cust;
  perform public.receive_stock(br_a, p1, 20, 60);
  sh := public.open_shift(br_a, 0);
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 3)),
     '[{"type":"cash","amount":100},{"type":"mpesa_manual","amount":200,"reference":"QRT123ABCD"}]'); s_split := (r->>'sale_id')::uuid;
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2)), '[{"type":"deni","amount":200}]', null, cust); s_deni := (r->>'sale_id')::uuid;
  select receipt_snapshot into snap from public.sales where id = s_split;
  perform pg_temp.ok('SNAP-01 split-payment sale stores branch receipt snapshot', snap->>'display_name' = 'Mgr edit' and (snap->>'paper_width')::int = 80, snap::text);
  perform pg_temp.ok('SNAP-02 split tenders intact (2 tenders, 300 total)',
    (select count(*) from public.sale_tenders where sale_id = s_split) = 2 and (select total from public.sales where id = s_split) = 300);
  perform pg_temp.ok('SNAP-03 Deni sale also snapshotted', (select receipt_snapshot->>'display_name' from public.sales where id = s_deni) = 'Mgr edit');

  perform public.save_branch_receipt_settings(br_a, '{"display_name":"Renamed Later","paper_width":58,"footer":"New footer"}');
  select receipt_snapshot into snap from public.sales where id = s_split;
  perform pg_temp.ok('HIST-01 later edits do not change old sale snapshot (reprint accuracy)', snap->>'display_name' = 'Mgr edit' and snap->>'footer' is null);
  perform pg_temp.ok('HIST-02 sale financials unchanged by settings edit', (select total from public.sales where id = s_split) = 300 and (select tax_total from public.sales where id = s_split) > 0);
  r := public.post_sale(br_a, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), '[{"type":"cash","amount":100}]');
  perform pg_temp.ok('HIST-03 new sale uses new settings', (select receipt_snapshot->>'display_name' from public.sales where id = (r->>'sale_id')::uuid) = 'Renamed Later'
    and (select (receipt_snapshot->>'paper_width')::int from public.sales where id = (r->>'sale_id')::uuid) = 58);

  -- partial return & void keep snapshot
  select id into l1 from public.sale_lines where sale_id = s_split;
  perform public.return_sale_items(s_split, jsonb_build_array(jsonb_build_object('sale_line_id', l1, 'qty', 1)), 'cash', 'chipped', null, gen_random_uuid());
  perform pg_temp.ok('RET-01 partial return recorded; snapshot preserved',
    (select count(*) from public.sale_returns where sale_id = s_split) = 1 and (select receipt_snapshot->>'display_name' from public.sales where id = s_split) = 'Mgr edit');
  perform public.void_sale(s_deni, 'test void');
  perform pg_temp.ok('VOID-01 voided sale keeps snapshot and void record',
    exists (select 1 from public.sale_voids where sale_id = s_deni) and (select receipt_snapshot->>'display_name' from public.sales where id = s_deni) = 'Mgr edit');
  begin update public.sales set receipt_snapshot = '{}' where id = s_split; get diagnostics n = row_count; raised := n = 0; exception when others then raised := true; end;
  perform pg_temp.ok('HIST-04 snapshot cannot be rewritten by users', raised);

  -- validation
  begin perform public.save_branch_receipt_settings(br_a, '{"paper_width":100}'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('VAL-01 only 58/80mm accepted', raised);
  begin perform public.save_branch_receipt_settings(br_a, '{"logo_url":"javascript:alert(1)"}'); raised := false; exception when others then raised := true; end;
  perform pg_temp.ok('VAL-02 logo must be https link', raised);
end $$;

do $$
declare rep text; p int; f int;
begin
  perform pg_temp.as_admin();
  select count(*) filter (where passed), count(*) filter (where not passed) into p, f from t_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || coalesce(' ['||detail||']',''), E'\n' order by passed, id) into rep from t_results;
  raise exception E'RECEIPTS_REPORT passed=% failed=% total=%\n%', p, f, p+f, rep;
end $$;
