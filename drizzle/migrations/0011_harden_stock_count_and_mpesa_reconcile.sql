-- Stock count: refuse the same product twice in one count (header totals and variances would be wrong).
create or replace function public.apply_stock_count(_branch uuid, _lines jsonb, _note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _id uuid := gen_random_uuid(); _l record; _p public.products; _sys numeric; _wac numeric; _n int := 0; _adj int := 0; _dup int;
begin
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  if _lines is null or jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then raise exception 'count at least one product'; end if;
  select count(*) - count(distinct x.product_id) into _dup from jsonb_to_recordset(_lines) as x(product_id uuid, counted numeric);
  if _dup > 0 then raise exception 'each product can appear only once in a count'; end if;
  select count(*), count(*) filter (where x.counted <> coalesce(s.qty_on_hand, 0)) into _n, _adj
    from jsonb_to_recordset(_lines) as x(product_id uuid, counted numeric)
    left join public.branch_stock s on s.branch_id = _branch and s.product_id = x.product_id;
  insert into public.stock_counts(id, business_id, branch_id, note, lines_counted, lines_adjusted, actor_user_id) values (_id, _biz, _branch, _note, _n, _adj, auth.uid());
  for _l in select * from jsonb_to_recordset(_lines) as x(product_id uuid, counted numeric) loop
    _p := public.product_in_business(_l.product_id, _biz);
    if not _p.track_stock then raise exception '% does not track stock', _p.name; end if;
    if _l.counted is null or _l.counted < 0 then raise exception 'counted quantity must be zero or more'; end if;
    _sys := null; _wac := null;
    select qty_on_hand, wac into _sys, _wac from public.branch_stock where branch_id = _branch and product_id = _p.id for update;
    _sys := coalesce(_sys,0); _wac := coalesce(_wac,0);
    insert into public.stock_count_lines(count_id, business_id, product_id, system_qty, counted_qty, variance, unit_cost) values (_id, _biz, _p.id, _sys, _l.counted, _l.counted - _sys, _wac);
    if _l.counted <> _sys then
      perform public.apply_stock_movement(_biz, _branch, _p.id, 'adjustment', _l.counted - _sys, null, 'stock_count', _id::text, coalesce(_note, 'stock count'));
    end if;
  end loop;
  perform public.write_audit(_biz, _branch, 'stock.counted', 'stock_count', _id::text, jsonb_build_object('lines', _n, 'adjusted', _adj, 'note', _note));
  return jsonb_build_object('count_id', _id, 'lines', _n, 'adjusted', _adj);
end $$;

-- M-Pesa reconciliation: writing is limited to owners/managers (auditors stay read-only).
insert into public.role_permissions(role, permission)
select r::public.business_role, 'mpesa.reconcile' from unnest(array['owner','manager']) r
where not exists (select 1 from public.role_permissions p where p.role = r::public.business_role and p.permission = 'mpesa.reconcile');

drop function if exists public.reconcile_mpesa(bigint, text, text);
create function public.reconcile_mpesa(_tender bigint, _status text, _note text default null, _statement_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _t public.sale_tenders; _branch uuid; _last text; _code text; _clash int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into _t from public.sale_tenders where id = _tender for update;
  if _t.id is null or _t.tender_type <> 'mpesa_manual' then raise exception 'M-Pesa payment not found'; end if;
  select branch_id into _branch from public.sales where id = _t.sale_id;
  if not public.has_permission(_t.business_id, 'mpesa.reconcile') or not public.can_access_branch_row(_t.business_id, _branch) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if _status not in ('verified', 'flagged') then raise exception 'invalid status'; end if;
  if _statement_amount is not null and _statement_amount <= 0 then raise exception 'statement amount must be more than zero'; end if;
  if _status = 'flagged' and length(coalesce(trim(_note), '')) < 3 then raise exception 'Explain the mismatch'; end if;
  if _status = 'verified' then
    if _statement_amount is not null and round(_statement_amount, 2) <> _t.amount then
      raise exception 'statement amount % does not match % — mark it as a mismatch instead', round(_statement_amount,2), _t.amount;
    end if;
    if exists (select 1 from public.sale_voids v where v.sale_id = _t.sale_id) then
      raise exception 'this sale was voided — mark it as a mismatch if money was received';
    end if;
    _code := upper(trim(coalesce(_t.reference, '')));
    select count(*) into _clash from public.sale_tenders o
      where o.business_id = _t.business_id and o.id <> _t.id and o.tender_type = 'mpesa_manual' and upper(trim(o.reference)) = _code
        and (select r.status from public.mpesa_reconciliations r where r.sale_tender_id = o.id order by r.created_at desc, r.id desc limit 1) = 'verified';
    if _clash > 0 then raise exception 'code % is already verified on another sale', _code; end if;
  end if;
  select r.status into _last from public.mpesa_reconciliations r where r.sale_tender_id = _tender order by r.created_at desc, r.id desc limit 1;
  if _last = _status then return jsonb_build_object('status', _status, 'changed', false); end if;
  insert into public.mpesa_reconciliations(business_id, sale_tender_id, status, note, actor_user_id)
    values (_t.business_id, _tender, _status, nullif(trim(_note), ''), auth.uid());
  perform public.write_audit(_t.business_id, _branch, 'mpesa.' || _status, 'sale_tender', _tender::text,
    jsonb_build_object('reference', _t.reference, 'amount', _t.amount, 'statement_amount', _statement_amount, 'previous', _last, 'note', _note), null);
  return jsonb_build_object('status', _status, 'changed', true, 'previous', _last);
end $$;
revoke all on function public.reconcile_mpesa(bigint, text, text, numeric) from public, anon;
grant execute on function public.reconcile_mpesa(bigint, text, text, numeric) to authenticated;