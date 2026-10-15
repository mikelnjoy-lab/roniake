alter type public.tender_type add value if not exists 'deni';

-- ---------- Customers & Deni ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(trim(name)) >= 2),
  phone text,
  credit_enabled boolean not null default false,
  credit_limit numeric not null default 0 check (credit_limit >= 0),
  balance numeric not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index customers_business_phone on public.customers(business_id, phone) where phone is not null;
grant select on public.customers to authenticated;
grant insert (business_id, name, phone, credit_enabled, credit_limit) on public.customers to authenticated;
grant update (name, phone, credit_enabled, credit_limit) on public.customers to authenticated;
grant all on public.customers to service_role;
alter table public.customers enable row level security;
create policy "customers visible to members" on public.customers for select to authenticated using (public.is_business_member(business_id));
create policy "customers created by deni managers" on public.customers for insert to authenticated with check (public.has_permission(business_id, 'deni.manage'));
create policy "customers updated by deni managers" on public.customers for update to authenticated using (public.has_permission(business_id, 'deni.manage')) with check (public.has_permission(business_id, 'deni.manage'));

create table public.customer_ledger (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  entry_type text not null check (entry_type in ('credit_sale','repayment')),
  amount numeric not null,
  balance_after numeric not null,
  sale_id uuid references public.sales(id),
  tender_type public.tender_type,
  reference text,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index on public.customer_ledger(customer_id, created_at desc);
grant select on public.customer_ledger to authenticated;
grant all on public.customer_ledger to service_role;
alter table public.customer_ledger enable row level security;
create policy "ledger visible to deni/report roles" on public.customer_ledger for select to authenticated
  using (public.has_permission(business_id, 'deni.manage') or public.has_permission(business_id, 'reports.view'));
create trigger customer_ledger_immutable before update or delete on public.customer_ledger for each row execute function public.immutable_row();

create or replace function public.record_deni_repayment(_customer uuid, _amount numeric, _type public.tender_type, _reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _c public.customers;
begin
  select * into _c from public.customers where id = _customer for update;
  if not found or not public.has_permission(_c.business_id, 'deni.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount is null or _amount <= 0 or round(_amount,2) <> _amount then raise exception 'repayment must be positive with at most 2 decimals'; end if;
  if _type = 'deni' then raise exception 'repayment cannot be paid with Deni'; end if;
  if _type = 'mpesa_manual' and (_reference is null or upper(_reference) !~ '^[A-Z0-9]{8,12}$') then raise exception 'M-Pesa repayments need the M-Pesa transaction code'; end if;
  if _amount > _c.balance then raise exception 'repayment is more than the amount owed'; end if;
  update public.customers set balance = balance - _amount where id = _customer;
  insert into public.customer_ledger(business_id, customer_id, entry_type, amount, balance_after, tender_type, reference, actor_user_id)
    values (_c.business_id, _customer, 'repayment', -_amount, _c.balance - _amount, _type, upper(_reference), auth.uid());
  perform public.write_audit(_c.business_id, null, 'deni.repayment', 'customer', _customer::text, jsonb_build_object('amount', _amount, 'type', _type));
  return jsonb_build_object('balance', _c.balance - _amount);
end $$;

-- ---------- Sale engine: strict stock + Deni ----------
drop function public.post_sale(uuid,uuid,jsonb,jsonb,text);
create or replace function public.post_sale(_branch uuid, _client_txn_id uuid, _lines jsonb, _tenders jsonb, _device_id text default null, _customer uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _biz uuid; _hash text; _existing public.sales; _sale uuid := gen_random_uuid();
  _l record; _t record; _p public.products; _n int := 0; _onhand numeric;
  _gross numeric; _disc numeric; _net numeric; _tax numeric; _cost numeric;
  _subtotal numeric := 0; _disc_total numeric := 0; _tax_total numeric := 0; _total numeric := 0; _cogs numeric := 0;
  _cash numeric := 0; _noncash numeric := 0; _deni numeric := 0; _change numeric; _code text; _no bigint; _receipt text;
  _out jsonb := '[]'::jsonb; _line jsonb; _c public.customers;
begin
  _biz := public.branch_business_checked(_branch, 'pos.sell');
  if _client_txn_id is null then raise exception 'client transaction id is required'; end if;
  _hash := md5(_branch::text || '|' || coalesce(_lines::text,'') || '|' || coalesce(_tenders::text,'') || '|' || coalesce(_customer::text,''));

  select * into _existing from public.sales where business_id = _biz and client_txn_id = _client_txn_id;
  if found then
    if _existing.payload_hash <> _hash then raise exception 'transaction id reused with different contents' using errcode = '22023'; end if;
    return jsonb_build_object('status','replay','sale_id',_existing.id,'receipt_no',_existing.receipt_no,'total',_existing.total,'change_given',_existing.change_given);
  end if;

  if _lines is null or jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then raise exception 'a sale needs at least one line'; end if;
  if _tenders is null or jsonb_typeof(_tenders) <> 'array' or jsonb_array_length(_tenders) = 0 then raise exception 'a sale needs at least one tender'; end if;

  -- Strict stock: total requested per product must be on hand (rows locked to stop two tills overselling).
  for _l in select x.product_id, sum(x.qty) qty from jsonb_to_recordset(_lines) as x(product_id uuid, qty numeric) group by x.product_id loop
    _p := public.product_in_business(_l.product_id, _biz);
    if _p.track_stock then
      select qty_on_hand into _onhand from public.branch_stock where branch_id = _branch and product_id = _p.id for update;
      if coalesce(_onhand, 0) < _l.qty then
        raise exception 'OUT_OF_STOCK: % has only % in stock (asked for %)', _p.name, coalesce(_onhand,0), _l.qty using errcode = 'P0001';
      end if;
    end if;
  end loop;

  for _l in select * from jsonb_to_recordset(_lines) as x(product_id uuid, qty numeric, discount numeric) loop
    _n := _n + 1;
    _p := public.product_in_business(_l.product_id, _biz);
    if not _p.is_active then raise exception 'product % is inactive', _p.sku; end if;
    if _l.qty is null or _l.qty <= 0 then raise exception 'quantity must be positive'; end if;
    if round(_l.qty, 3) <> _l.qty then raise exception 'quantity has more than 3 decimals'; end if;
    if not _p.is_weighted and _l.qty <> trunc(_l.qty) then raise exception 'product % is sold in whole units', _p.sku; end if;
    _disc := round(coalesce(_l.discount, 0), 2);
    if _disc < 0 then raise exception 'discount cannot be negative'; end if;
    if _disc > 0 and not public.has_permission(_biz, 'pos.discount') then raise exception 'discount not permitted' using errcode = '42501'; end if;
    _gross := round(_p.selling_price * _l.qty, 2);
    if _disc > _gross then raise exception 'discount exceeds line value'; end if;
    _net := _gross - _disc;
    _tax := case _p.tax_class when 'B' then round(_net * 16 / 116, 2) when 'E' then round(_net * 8 / 108, 2) else 0 end;
    if _p.track_stock then
      _cost := public.apply_stock_movement(_biz, _branch, _p.id, 'sale', -_l.qty, null, 'sale', _sale::text, null);
    else
      _cost := 0;
    end if;
    _subtotal := _subtotal + _gross; _disc_total := _disc_total + _disc; _tax_total := _tax_total + _tax; _total := _total + _net;
    _cogs := _cogs + round(_cost * _l.qty, 2);
    _out := _out || jsonb_build_object('line_no', _n, 'product_id', _p.id, 'name', _p.name, 'sku', _p.sku, 'qty', _l.qty, 'unit_price', _p.selling_price,
      'discount', _disc, 'line_total', _net, 'tax_class', _p.tax_class, 'tax', _tax, 'unit_cost', _cost, 'cogs', round(_cost * _l.qty, 2));
  end loop;

  for _t in select * from jsonb_to_recordset(_tenders) as x(type public.tender_type, amount numeric, reference text) loop
    if _t.amount is null or _t.amount <= 0 or round(_t.amount, 2) <> _t.amount then raise exception 'tender amounts must be positive with at most 2 decimals'; end if;
    if _t.type = 'cash' then _cash := _cash + _t.amount; else _noncash := _noncash + _t.amount; end if;
    if _t.type::text = 'deni' then _deni := _deni + _t.amount; end if;
    if _t.type = 'mpesa_manual' and (_t.reference is null or _t.reference !~ '^[A-Z0-9]{8,12}$') then
      raise exception 'M-Pesa tenders need the M-Pesa transaction code';
    end if;
  end loop;
  if _noncash > _total then raise exception 'non-cash tenders cannot exceed the sale total'; end if;
  if _cash + _noncash < _total then raise exception 'tendered amount is less than the sale total'; end if;
  _change := _cash + _noncash - _total;
  if _change > _cash then raise exception 'change can only be given from cash'; end if;

  if _customer is not null then
    select * into _c from public.customers where id = _customer and business_id = _biz for update;
    if not found then raise exception 'customer not found in this business'; end if;
  end if;
  if _deni > 0 then
    if _c.id is null then raise exception 'Deni needs a customer'; end if;
    if not _c.credit_enabled then raise exception 'Deni is not enabled for %', _c.name; end if;
    if _c.balance + _deni > _c.credit_limit then raise exception 'Deni limit exceeded for % (owes %, limit %)', _c.name, _c.balance, _c.credit_limit; end if;
  end if;

  insert into public.receipt_counters(branch_id, last_no) values (_branch, 1)
    on conflict (branch_id) do update set last_no = public.receipt_counters.last_no + 1 returning last_no into _no;
  select code into _code from public.branches where id = _branch;
  _receipt := _code || '-' || lpad(_no::text, 6, '0');

  insert into public.sales(id, business_id, branch_id, receipt_no, client_txn_id, payload_hash, device_id, cashier_id,
      subtotal, discount_total, tax_total, total, tendered_total, change_given, cogs_total, customer_id)
    values (_sale, _biz, _branch, _receipt, _client_txn_id, _hash, _device_id, auth.uid(),
      _subtotal, _disc_total, _tax_total, _total, _cash + _noncash, _change, _cogs, _customer);

  for _line in select * from jsonb_array_elements(_out) loop
    insert into public.sale_lines(sale_id, business_id, line_no, product_id, product_name, sku, qty, unit_price, discount, line_total, tax_class, tax_amount, unit_cost, line_cogs)
      values (_sale, _biz, (_line->>'line_no')::int, (_line->>'product_id')::uuid, _line->>'name', _line->>'sku', (_line->>'qty')::numeric,
        (_line->>'unit_price')::numeric, (_line->>'discount')::numeric, (_line->>'line_total')::numeric, _line->>'tax_class',
        (_line->>'tax')::numeric, (_line->>'unit_cost')::numeric, (_line->>'cogs')::numeric);
  end loop;
  insert into public.sale_tenders(sale_id, business_id, tender_type, amount, reference)
    select _sale, _biz, x.type, x.amount, x.reference from jsonb_to_recordset(_tenders) as x(type public.tender_type, amount numeric, reference text);

  if _deni > 0 then
    update public.customers set balance = balance + _deni where id = _c.id;
    insert into public.customer_ledger(business_id, customer_id, entry_type, amount, balance_after, sale_id, tender_type, reference, actor_user_id)
      values (_biz, _c.id, 'credit_sale', _deni, _c.balance + _deni, _sale, 'deni', _receipt, auth.uid());
  end if;

  perform public.write_audit(_biz, _branch, 'sale.completed', 'sale', _sale::text, jsonb_build_object('receipt_no', _receipt, 'total', _total, 'deni', _deni), _client_txn_id::text);
  return jsonb_build_object('status','created','sale_id',_sale,'receipt_no',_receipt,'total',_total,'tax_total',_tax_total,'change_given',_change);
end $$;

alter table public.sales add column if not exists customer_id uuid references public.customers(id);

-- Stock levels visible to tills (quantities only, no cost)
create or replace function public.branch_stock_levels(_branch uuid)
returns table(product_id uuid, qty_on_hand numeric) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.branch_business_checked(_branch, 'pos.sell');
  return query select s.product_id, s.qty_on_hand from public.branch_stock s where s.branch_id = _branch;
end $$;

-- ---------- Stock counts ----------
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  note text,
  lines_counted int not null,
  lines_adjusted int not null,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create table public.stock_count_lines (
  id bigint generated always as identity primary key,
  count_id uuid not null references public.stock_counts(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id),
  system_qty numeric not null,
  counted_qty numeric not null,
  variance numeric not null,
  unit_cost numeric not null
);
grant select on public.stock_counts, public.stock_count_lines to authenticated;
grant all on public.stock_counts, public.stock_count_lines to service_role;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
create policy "counts visible" on public.stock_counts for select to authenticated using (public.can_access_branch_row(business_id, branch_id) and (public.has_permission(business_id,'inventory.manage') or public.has_permission(business_id,'reports.view')));
create policy "count lines visible" on public.stock_count_lines for select to authenticated using (exists (select 1 from public.stock_counts c where c.id = stock_count_lines.count_id));
create trigger stock_counts_immutable before update or delete on public.stock_counts for each row execute function public.immutable_row();
create trigger stock_count_lines_immutable before update or delete on public.stock_count_lines for each row execute function public.immutable_row();

create or replace function public.apply_stock_count(_branch uuid, _lines jsonb, _note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _id uuid := gen_random_uuid(); _l record; _p public.products; _sys numeric; _wac numeric; _n int := 0; _adj int := 0;
begin
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  if _lines is null or jsonb_array_length(_lines) = 0 then raise exception 'count at least one product'; end if;
  insert into public.stock_counts(id, business_id, branch_id, note, lines_counted, lines_adjusted, actor_user_id) values (_id, _biz, _branch, _note, 0, 0, auth.uid());
  for _l in select * from jsonb_to_recordset(_lines) as x(product_id uuid, counted numeric) loop
    _p := public.product_in_business(_l.product_id, _biz);
    if not _p.track_stock then raise exception '% does not track stock', _p.name; end if;
    if _l.counted is null or _l.counted < 0 then raise exception 'counted quantity must be zero or more'; end if;
    select coalesce(qty_on_hand,0), coalesce(wac,0) into _sys, _wac from public.branch_stock where branch_id = _branch and product_id = _p.id for update;
    _sys := coalesce(_sys,0); _wac := coalesce(_wac,0);
    _n := _n + 1;
    insert into public.stock_count_lines(count_id, business_id, product_id, system_qty, counted_qty, variance, unit_cost) values (_id, _biz, _p.id, _sys, _l.counted, _l.counted - _sys, _wac);
    if _l.counted <> _sys then
      _adj := _adj + 1;
      perform public.apply_stock_movement(_biz, _branch, _p.id, 'adjustment', _l.counted - _sys, null, 'stock_count', _id::text, coalesce(_note, 'stock count'));
    end if;
  end loop;
  -- header counters set once via security-definer bypass of immutability: re-insert not allowed, so store via audit
  perform public.write_audit(_biz, _branch, 'stock.counted', 'stock_count', _id::text, jsonb_build_object('lines', _n, 'adjusted', _adj, 'note', _note));
  return jsonb_build_object('count_id', _id, 'lines', _n, 'adjusted', _adj);
end $$;

-- ---------- Staff ----------
create or replace function public.invite_member_by_email(_business uuid, _email text, _role public.business_role, _branch_ids uuid[] default '{}', _all_branches boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare _uid uuid; _mem uuid;
begin
  if not public.has_permission(_business, 'members.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  select id into _uid from auth.users where lower(email) = lower(trim(_email));
  if _uid is null then raise exception 'No RONIA account uses %. Ask them to sign up first, then add them.', _email; end if;
  if exists (select 1 from public.business_memberships where business_id = _business and user_id = _uid) then raise exception 'This person is already in the business'; end if;
  if not _all_branches and coalesce(array_length(_branch_ids,1),0) = 0 then raise exception 'Choose at least one branch'; end if;
  _mem := public.add_business_member(_business, _uid, _role, case when _all_branches then '{}'::uuid[] else _branch_ids end);
  if _all_branches then update public.business_memberships set all_branches = true where id = _mem; end if;
  return _mem;
end $$;

create or replace function public.list_members(_business uuid)
returns table(membership_id uuid, user_id uuid, email text, role public.business_role, status public.membership_status, all_branches boolean, branch_names text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(_business, 'members.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  return query select m.id, m.user_id, u.email::text, m.role, m.status, m.all_branches,
    coalesce((select array_agg(b.name order by b.name) from public.membership_branches mb join public.branches b on b.id = mb.branch_id where mb.membership_id = m.id), '{}')
  from public.business_memberships m left join auth.users u on u.id = m.user_id where m.business_id = _business order by m.created_at;
end $$;

revoke execute on function public.post_sale(uuid,uuid,jsonb,jsonb,text,uuid), public.record_deni_repayment(uuid,numeric,public.tender_type,text),
  public.branch_stock_levels(uuid), public.apply_stock_count(uuid,jsonb,text), public.invite_member_by_email(uuid,text,public.business_role,uuid[],boolean),
  public.list_members(uuid) from public, anon;
grant execute on function public.post_sale(uuid,uuid,jsonb,jsonb,text,uuid), public.record_deni_repayment(uuid,numeric,public.tender_type,text),
  public.branch_stock_levels(uuid), public.apply_stock_count(uuid,jsonb,text), public.invite_member_by_email(uuid,text,public.business_role,uuid[],boolean),
  public.list_members(uuid) to authenticated;