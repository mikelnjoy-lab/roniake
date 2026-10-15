create or replace function public.apply_stock_count(_branch uuid, _lines jsonb, _note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _id uuid := gen_random_uuid(); _l record; _p public.products; _sys numeric; _wac numeric; _n int := 0; _adj int := 0;
begin
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  if _lines is null or jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then raise exception 'count at least one product'; end if;
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