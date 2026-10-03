-- RONIA BUSINESS — Phase 1: Core Domain & Transaction Engine
-- Catalog, branch stock with Weighted Average Cost, immutable stock ledger, and the sale-posting engine.
-- All writes to stock and sales go through security-definer functions; the price and cost used are the server's, never the client's.

create type public.stock_movement_type as enum ('receipt','sale','adjustment','break_out','break_in');
create type public.tender_type as enum ('cash','mpesa_manual','card','other');

-- ---------- Catalog ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  sku text not null check (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
  barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z]{4,32}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  unit text not null default 'pc' check (unit in ('pc','kg','g','l','ml','m','pack','box','crate','bag')),
  selling_price numeric(14,2) not null check (selling_price >= 0),
  tax_class text not null default 'B' check (tax_class in ('A','B','C','D','E')),
  is_weighted boolean not null default false,
  plu_code text check (plu_code is null or plu_code ~ '^[0-9]{4,6}$'),
  track_stock boolean not null default true,
  parent_product_id uuid references public.products(id) on delete restrict,
  units_per_parent numeric(14,3) check (units_per_parent is null or units_per_parent > 0),
  low_stock_threshold numeric(14,3) check (low_stock_threshold is null or low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku),
  unique (business_id, barcode),
  unique (business_id, plu_code),
  check ((parent_product_id is null) = (units_per_parent is null)),
  check (parent_product_id is null or parent_product_id <> id)
);
create index on public.products(business_id);

-- ---------- Stock ----------
create table public.branch_stock (
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  qty_on_hand numeric(14,3) not null default 0,
  wac numeric(14,4) not null default 0 check (wac >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id)
);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type public.stock_movement_type not null,
  qty numeric(14,3) not null check (qty <> 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  qty_after numeric(14,3) not null,
  wac_after numeric(14,4) not null,
  ref_type text,
  ref_id text,
  note text,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index on public.stock_movements(branch_id, product_id, id);

-- ---------- Sales ----------
create table public.receipt_counters (
  branch_id uuid primary key references public.branches(id) on delete restrict,
  last_no bigint not null default 0
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  receipt_no text not null,
  client_txn_id uuid not null,
  payload_hash text not null,
  device_id text,
  cashier_id uuid not null,
  status text not null default 'completed' check (status = 'completed'),
  subtotal numeric(14,2) not null,
  discount_total numeric(14,2) not null,
  tax_total numeric(14,2) not null,
  total numeric(14,2) not null check (total >= 0),
  tendered_total numeric(14,2) not null,
  change_given numeric(14,2) not null check (change_given >= 0),
  cogs_total numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (business_id, client_txn_id),
  unique (business_id, receipt_no)
);
create index on public.sales(branch_id, created_at desc);

create table public.sale_lines (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  line_no int not null,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  sku text not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null,
  tax_class text not null,
  tax_amount numeric(14,2) not null,
  unit_cost numeric(14,4) not null,
  line_cogs numeric(14,2) not null,
  unique (sale_id, line_no)
);

create table public.sale_tenders (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  tender_type public.tender_type not null,
  amount numeric(14,2) not null check (amount > 0),
  reference text
);

-- ---------- Grants (explicit; no anon) ----------
grant select, insert, update on public.products to authenticated;
grant select on public.branch_stock, public.stock_movements, public.sales, public.sale_lines, public.sale_tenders to authenticated;
grant all on public.products, public.branch_stock, public.stock_movements, public.receipt_counters, public.sales, public.sale_lines, public.sale_tenders to service_role;

alter table public.products enable row level security;
alter table public.branch_stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.receipt_counters enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_tenders enable row level security;

-- ---------- Policies ----------
create policy "catalog visible to members" on public.products for select to authenticated using (public.is_business_member(business_id));
create policy "catalog create" on public.products for insert to authenticated with check (public.has_permission(business_id, 'catalog.manage'));
create policy "catalog update" on public.products for update to authenticated
  using (public.has_permission(business_id, 'catalog.manage')) with check (public.has_permission(business_id, 'catalog.manage'));

create policy "stock visible to inventory/report roles" on public.branch_stock for select to authenticated
  using (public.can_access_branch_row(business_id, branch_id)
         and (public.has_permission(business_id, 'inventory.manage') or public.has_permission(business_id, 'reports.view')));
create policy "movements visible to inventory/report roles" on public.stock_movements for select to authenticated
  using (public.can_access_branch_row(business_id, branch_id)
         and (public.has_permission(business_id, 'inventory.manage') or public.has_permission(business_id, 'reports.view')));

create policy "sales visible" on public.sales for select to authenticated
  using (public.can_access_branch_row(business_id, branch_id)
         and (public.has_permission(business_id, 'reports.view') or cashier_id = auth.uid()));
create policy "sale lines visible" on public.sale_lines for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy "sale tenders visible" on public.sale_tenders for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

-- ---------- Guards ----------
create or replace function public.immutable_row() returns trigger language plpgsql set search_path = public as $$
begin raise exception '% is immutable', tg_table_name; end $$;
create trigger stock_movements_immutable before update or delete on public.stock_movements for each row execute function public.immutable_row();
create trigger sales_immutable before update or delete on public.sales for each row execute function public.immutable_row();
create trigger sale_lines_immutable before update or delete on public.sale_lines for each row execute function public.immutable_row();
create trigger sale_tenders_immutable before update or delete on public.sale_tenders for each row execute function public.immutable_row();

create or replace function public.guard_product() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.business_id <> old.business_id then raise exception 'product business is immutable'; end if;
    new.updated_at := now();
  end if;
  if new.parent_product_id is not null and not exists (
       select 1 from public.products p where p.id = new.parent_product_id and p.business_id = new.business_id and p.parent_product_id is null) then
    raise exception 'parent product must be a top-level product in the same business';
  end if;
  if new.plu_code is not null and not new.is_weighted then raise exception 'PLU codes are only for weighted products'; end if;
  return new;
end $$;
create trigger product_guard before insert or update on public.products for each row execute function public.guard_product();

create or replace function public.audit_product() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit(new.business_id, null, 'product.created', 'product', new.id::text, jsonb_build_object('sku', new.sku, 'price', new.selling_price));
  elsif new.selling_price is distinct from old.selling_price or new.is_active is distinct from old.is_active or new.tax_class is distinct from old.tax_class then
    perform public.write_audit(new.business_id, null, 'product.updated', 'product', new.id::text,
      jsonb_build_object('price_from', old.selling_price, 'price_to', new.selling_price, 'active', new.is_active, 'tax_class', new.tax_class));
  end if;
  return null;
end $$;
create trigger product_audit after insert or update on public.products for each row execute function public.audit_product();

-- ---------- Stock engine (internal) ----------
-- Inbound with cost blends WAC; outbound leaves WAC unchanged and is costed at current WAC.
create or replace function public.apply_stock_movement(_business uuid, _branch uuid, _product uuid, _type public.stock_movement_type,
  _qty numeric, _unit_cost numeric, _ref_type text, _ref_id text, _note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare _q numeric; _w numeric; _cost numeric; _new_q numeric; _new_w numeric;
begin
  insert into public.branch_stock(business_id, branch_id, product_id) values (_business, _branch, _product) on conflict do nothing;
  select qty_on_hand, wac into _q, _w from public.branch_stock where branch_id = _branch and product_id = _product for update;
  _new_q := _q + _qty;
  if _qty > 0 and _unit_cost is not null then
    _cost := _unit_cost;
    _new_w := case when _q <= 0 then _unit_cost else round((_q * _w + _qty * _unit_cost) / _new_q, 4) end;
  else
    _cost := _w;
    _new_w := _w;
  end if;
  update public.branch_stock set qty_on_hand = _new_q, wac = _new_w, updated_at = now() where branch_id = _branch and product_id = _product;
  insert into public.stock_movements(business_id, branch_id, product_id, movement_type, qty, unit_cost, qty_after, wac_after, ref_type, ref_id, note, actor_user_id)
    values (_business, _branch, _product, _type, _qty, _cost, _new_q, _new_w, _ref_type, _ref_id, _note, auth.uid());
  return _cost;
end $$;
revoke execute on function public.apply_stock_movement(uuid,uuid,uuid,public.stock_movement_type,numeric,numeric,text,text,text) from public, anon, authenticated;

create or replace function public.branch_business_checked(_branch uuid, _permission text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare _biz uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select business_id into _biz from public.branches where id = _branch and is_active;
  if _biz is null or not public.can_access_branch_row(_biz, _branch) or not public.has_permission(_biz, _permission) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return _biz;
end $$;
revoke execute on function public.branch_business_checked(uuid,text) from public, anon, authenticated;

create or replace function public.product_in_business(_product uuid, _business uuid) returns public.products
language plpgsql stable security definer set search_path = public as $$
declare _p public.products;
begin
  select * into _p from public.products where id = _product and business_id = _business;
  if not found then raise exception 'product not found in this business' using errcode = '42501'; end if;
  return _p;
end $$;
revoke execute on function public.product_in_business(uuid,uuid) from public, anon, authenticated;

-- ---------- Inventory RPCs ----------
create or replace function public.receive_stock(_branch uuid, _product uuid, _qty numeric, _unit_cost numeric, _reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _p public.products; _row public.branch_stock;
begin
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  _p := public.product_in_business(_product, _biz);
  if not _p.track_stock then raise exception 'product does not track stock'; end if;
  if _qty is null or _qty <= 0 then raise exception 'quantity must be positive'; end if;
  if _unit_cost is null or _unit_cost < 0 then raise exception 'unit cost must be zero or more'; end if;
  perform public.apply_stock_movement(_biz, _branch, _product, 'receipt', _qty, _unit_cost, 'receipt', _reference, null);
  select * into _row from public.branch_stock where branch_id = _branch and product_id = _product;
  perform public.write_audit(_biz, _branch, 'stock.received', 'product', _product::text, jsonb_build_object('qty', _qty, 'unit_cost', _unit_cost, 'reference', _reference));
  return jsonb_build_object('qty_on_hand', _row.qty_on_hand, 'wac', _row.wac);
end $$;

create or replace function public.adjust_stock(_branch uuid, _product uuid, _qty_delta numeric, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _p public.products; _row public.branch_stock;
begin
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  _p := public.product_in_business(_product, _biz);
  if not _p.track_stock then raise exception 'product does not track stock'; end if;
  if _qty_delta is null or _qty_delta = 0 then raise exception 'adjustment must be non-zero'; end if;
  if _reason is null or length(trim(_reason)) < 3 then raise exception 'a reason is required for adjustments'; end if;
  perform public.apply_stock_movement(_biz, _branch, _product, 'adjustment', _qty_delta, null, 'adjustment', null, _reason);
  select * into _row from public.branch_stock where branch_id = _branch and product_id = _product;
  perform public.write_audit(_biz, _branch, 'stock.adjusted', 'product', _product::text, jsonb_build_object('qty_delta', _qty_delta, 'reason', _reason));
  return jsonb_build_object('qty_on_hand', _row.qty_on_hand, 'wac', _row.wac);
end $$;

-- Bulk breaking: move N parent units into N * units_per_parent child units at the parent's WAC split per unit.
create or replace function public.break_bulk(_branch uuid, _child_product uuid, _parent_qty numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _child public.products; _parent_cost numeric; _ref text := gen_random_uuid()::text;
begin
  _biz := public.branch_business_checked(_branch, 'inventory.manage');
  _child := public.product_in_business(_child_product, _biz);
  if _child.parent_product_id is null then raise exception 'product has no parent pack'; end if;
  if _parent_qty is null or _parent_qty <= 0 or _parent_qty <> trunc(_parent_qty) then raise exception 'parent quantity must be a whole positive number'; end if;
  _parent_cost := public.apply_stock_movement(_biz, _branch, _child.parent_product_id, 'break_out', -_parent_qty, null, 'break_bulk', _ref, null);
  perform public.apply_stock_movement(_biz, _branch, _child_product, 'break_in', _parent_qty * _child.units_per_parent,
    round(_parent_cost / _child.units_per_parent, 4), 'break_bulk', _ref, null);
  perform public.write_audit(_biz, _branch, 'stock.bulk_broken', 'product', _child_product::text,
    jsonb_build_object('parent_product_id', _child.parent_product_id, 'parent_qty', _parent_qty, 'child_qty', _parent_qty * _child.units_per_parent));
  return jsonb_build_object('child_qty_added', _parent_qty * _child.units_per_parent, 'unit_cost', round(_parent_cost / _child.units_per_parent, 4));
end $$;

-- ---------- Sale posting engine ----------
-- Idempotent on (business, client_txn_id): offline retries replay the original sale; a different payload under the same id is rejected.
-- Prices come from the catalog, cost from current WAC (frozen on the line as immutable COGS). Stock may go negative (offline sales are
-- never refused for stock) — negative on-hand is surfaced for review rather than blocking a completed sale.
create or replace function public.post_sale(_branch uuid, _client_txn_id uuid, _lines jsonb, _tenders jsonb, _device_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _biz uuid; _hash text; _existing public.sales; _sale uuid := gen_random_uuid();
  _l record; _t record; _p public.products; _n int := 0;
  _gross numeric; _disc numeric; _net numeric; _tax numeric; _cost numeric;
  _subtotal numeric := 0; _disc_total numeric := 0; _tax_total numeric := 0; _total numeric := 0; _cogs numeric := 0;
  _cash numeric := 0; _noncash numeric := 0; _change numeric; _code text; _no bigint; _receipt text;
  _out jsonb := '[]'::jsonb; _line jsonb;
begin
  _biz := public.branch_business_checked(_branch, 'pos.sell');
  if _client_txn_id is null then raise exception 'client transaction id is required'; end if;
  _hash := md5(_branch::text || '|' || coalesce(_lines::text,'') || '|' || coalesce(_tenders::text,''));

  select * into _existing from public.sales where business_id = _biz and client_txn_id = _client_txn_id;
  if found then
    if _existing.payload_hash <> _hash then raise exception 'transaction id reused with different contents' using errcode = '22023'; end if;
    return jsonb_build_object('status','replay','sale_id',_existing.id,'receipt_no',_existing.receipt_no,'total',_existing.total,'change_given',_existing.change_given);
  end if;

  if _lines is null or jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then raise exception 'a sale needs at least one line'; end if;
  if _tenders is null or jsonb_typeof(_tenders) <> 'array' or jsonb_array_length(_tenders) = 0 then raise exception 'a sale needs at least one tender'; end if;

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
    if _t.type = 'mpesa_manual' and (_t.reference is null or _t.reference !~ '^[A-Z0-9]{8,12}$') then
      raise exception 'M-Pesa tenders need the M-Pesa transaction code';
    end if;
  end loop;
  if _noncash > _total then raise exception 'non-cash tenders cannot exceed the sale total'; end if;
  if _cash + _noncash < _total then raise exception 'tendered amount is less than the sale total'; end if;
  _change := _cash + _noncash - _total;
  if _change > _cash then raise exception 'change can only be given from cash'; end if;

  insert into public.receipt_counters(branch_id, last_no) values (_branch, 1)
    on conflict (branch_id) do update set last_no = public.receipt_counters.last_no + 1 returning last_no into _no;
  select code into _code from public.branches where id = _branch;
  _receipt := _code || '-' || lpad(_no::text, 6, '0');

  insert into public.sales(id, business_id, branch_id, receipt_no, client_txn_id, payload_hash, device_id, cashier_id,
      subtotal, discount_total, tax_total, total, tendered_total, change_given, cogs_total)
    values (_sale, _biz, _branch, _receipt, _client_txn_id, _hash, _device_id, auth.uid(),
      _subtotal, _disc_total, _tax_total, _total, _cash + _noncash, _change, _cogs);

  for _line in select * from jsonb_array_elements(_out) loop
    insert into public.sale_lines(sale_id, business_id, line_no, product_id, product_name, sku, qty, unit_price, discount, line_total, tax_class, tax_amount, unit_cost, line_cogs)
      values (_sale, _biz, (_line->>'line_no')::int, (_line->>'product_id')::uuid, _line->>'name', _line->>'sku', (_line->>'qty')::numeric,
        (_line->>'unit_price')::numeric, (_line->>'discount')::numeric, (_line->>'line_total')::numeric, _line->>'tax_class',
        (_line->>'tax')::numeric, (_line->>'unit_cost')::numeric, (_line->>'cogs')::numeric);
  end loop;
  insert into public.sale_tenders(sale_id, business_id, tender_type, amount, reference)
    select _sale, _biz, x.type, x.amount, x.reference from jsonb_to_recordset(_tenders) as x(type public.tender_type, amount numeric, reference text);

  perform public.write_audit(_biz, _branch, 'sale.completed', 'sale', _sale::text, jsonb_build_object('receipt_no', _receipt, 'total', _total), _client_txn_id::text);
  return jsonb_build_object('status','created','sale_id',_sale,'receipt_no',_receipt,'total',_total,'tax_total',_tax_total,'change_given',_change);
end $$;

revoke execute on function public.receive_stock(uuid,uuid,numeric,numeric,text), public.adjust_stock(uuid,uuid,numeric,text),
  public.break_bulk(uuid,uuid,numeric), public.post_sale(uuid,uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.receive_stock(uuid,uuid,numeric,numeric,text), public.adjust_stock(uuid,uuid,numeric,text),
  public.break_bulk(uuid,uuid,numeric), public.post_sale(uuid,uuid,jsonb,jsonb,text) to authenticated;
