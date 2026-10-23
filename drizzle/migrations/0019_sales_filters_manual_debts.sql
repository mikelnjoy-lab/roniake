-- Task 1: server-side filtered sales history (EAT boundaries computed by client as UTC instants)
create or replace function public.sales_history(
  _business uuid, _branch uuid, _from timestamptz, _to timestamptz,
  _cashier uuid default null, _tender text default null, _status text default null,
  _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _reports boolean; _me uuid := auth.uid(); _res jsonb;
begin
  if _me is null or not public.is_business_member(_business) then raise exception 'not authorized'; end if;
  if _from is null or _to is null or _to <= _from then raise exception 'invalid period'; end if;
  if _to - _from > interval '400 days' then raise exception 'period too long (max 400 days)'; end if;
  _reports := public.has_permission(_business, 'reports.view');
  if _branch is not null and not public.can_access_branch_row(_business, _branch) then raise exception 'branch not accessible'; end if;
  if _branch is null and not _reports then raise exception 'all-branch view needs reports permission'; end if;
  if not _reports then _cashier := _me; end if;  -- non-report users only see their own sales
  _limit := least(greatest(coalesce(_limit,50),1),200);

  with base as (
    select s.*,
      exists(select 1 from sale_voids v where v.sale_id = s.id) as is_void,
      coalesce((select sum(r.refund_amount) from sale_returns r where r.sale_id = s.id),0) as refunded,
      coalesce((select sum(r.tax_amount) from sale_returns r where r.sale_id = s.id),0) as ret_tax,
      coalesce((select sum(r.cogs_reversed) from sale_returns r where r.sale_id = s.id),0) as ret_cogs
    from sales s
    where s.business_id = _business
      and (_branch is null or s.branch_id = _branch)
      and (_branch is not null or public.can_access_branch_row(_business, s.branch_id))
      and s.created_at >= _from and s.created_at < _to
      and (_cashier is null or s.cashier_id = _cashier)
      and (_tender is null or exists(select 1 from sale_tenders t where t.sale_id = s.id and t.tender_type::text = _tender))
  ), st as (
    select b.*, case when b.is_void then 'voided'
      when b.refunded >= b.total and b.refunded > 0 then 'refunded'
      when b.refunded > 0 then 'partially_refunded' else 'completed' end as hstatus
    from base b
  ), f as (select * from st where _status is null or hstatus = _status)
  select jsonb_build_object(
    'total_count', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select f.id, f.receipt_no, f.total, f.created_at, f.branch_id, f.cashier_id, f.hstatus as status, f.refunded,
          (select br.code from branches br where br.id = f.branch_id) as branch_code
        from f order by f.created_at desc limit _limit offset greatest(_offset,0)) x), '[]'::jsonb),
    'summary', jsonb_build_object(
      'receipts', (select count(*) from f where not is_void),
      'voided', (select count(*) from f where is_void),
      'gross', (select coalesce(sum(total),0) from f where not is_void),
      'refunds', (select coalesce(sum(refunded),0) from f where not is_void),
      'tax', (select coalesce(sum(tax_total - ret_tax),0) from f where not is_void),
      'cogs', case when _reports then (select coalesce(sum(cogs_total - ret_cogs),0) from f where not is_void) end,
      'tenders', coalesce((select jsonb_object_agg(tender_type, amt) from (
          select t.tender_type::text as tender_type, sum(t.amount) as amt from sale_tenders t join f on f.id = t.sale_id
          where not f.is_void group by 1) q), '{}'::jsonb),
      'refunds_by_type', coalesce((select jsonb_object_agg(refund_type, amt) from (
          select r.refund_type::text as refund_type, sum(r.refund_amount) as amt from sale_returns r join f on f.id = r.sale_id
          where not f.is_void group by 1) q), '{}'::jsonb)
    ),
    'cashiers', coalesce((select jsonb_agg(jsonb_build_object('id', c.cashier_id, 'email', u.email)) from
        (select distinct cashier_id from sales where business_id = _business and (_branch is null or branch_id = _branch)
           and (_reports or cashier_id = _me) and created_at >= _from - interval '90 days') c
        left join auth.users u on u.id = c.cashier_id), '[]'::jsonb)
  ) into _res;
  return _res;
end $$;
revoke all on function public.sales_history(uuid,uuid,timestamptz,timestamptz,uuid,text,text,int,int) from public, anon;
grant execute on function public.sales_history(uuid,uuid,timestamptz,timestamptz,uuid,text,text,int,int) to authenticated;
create index if not exists sales_business_created_idx on public.sales(business_id, created_at desc);

-- Task 2: manual debts / loans (not sales: no stock, COGS or revenue)
create table public.manual_debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  debt_type text not null check (debt_type in ('cash_loan','salary_advance','goods_outside_pos','other')),
  principal numeric not null check (principal > 0),
  incurred_on date not null,
  due_on date,
  reason text not null,
  reference text,
  notes text,
  client_ref uuid not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, client_ref)
);
create index on public.manual_debts(customer_id);
grant select on public.manual_debts to authenticated;
grant all on public.manual_debts to service_role;
alter table public.manual_debts enable row level security;
create policy "manual debts visible to deni/report roles" on public.manual_debts for select to authenticated
  using (public.has_permission(business_id, 'deni.manage') or public.has_permission(business_id, 'reports.view'));
create trigger manual_debts_immutable before update or delete on public.manual_debts for each row execute function public.immutable_row();

create table public.manual_debt_repayments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  debt_id uuid not null references public.manual_debts(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount numeric not null check (amount > 0),
  method public.tender_type not null,
  reference text,
  paid_on date not null,
  client_ref uuid not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, client_ref)
);
create index on public.manual_debt_repayments(debt_id);
grant select on public.manual_debt_repayments to authenticated;
grant all on public.manual_debt_repayments to service_role;
alter table public.manual_debt_repayments enable row level security;
create policy "manual repayments visible to deni/report roles" on public.manual_debt_repayments for select to authenticated
  using (public.has_permission(business_id, 'deni.manage') or public.has_permission(business_id, 'reports.view'));
create trigger manual_debt_repayments_immutable before update or delete on public.manual_debt_repayments for each row execute function public.immutable_row();

create or replace function public.record_manual_debt(_customer uuid, _type text, _principal numeric, _incurred_on date,
  _due_on date, _reason text, _reference text, _notes text, _client_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _biz uuid; _id uuid;
begin
  select business_id into _biz from customers where id = _customer;
  if _biz is null or not public.has_permission(_biz, 'deni.manage') then raise exception 'not authorized'; end if;
  if _client_ref is null then raise exception 'client_ref required'; end if;
  select id into _id from manual_debts where business_id = _biz and client_ref = _client_ref;
  if _id is not null then return jsonb_build_object('id', _id, 'status', 'replay'); end if;
  if _principal is null or _principal <= 0 then raise exception 'amount must be positive'; end if;
  if _principal <> round(_principal, 2) then raise exception 'amount max 2 decimals'; end if;
  if _incurred_on is null or _incurred_on > (now() at time zone 'Africa/Nairobi')::date then raise exception 'loan date cannot be in the future'; end if;
  if _due_on is not null and _due_on < _incurred_on then raise exception 'due date before loan date'; end if;
  if length(trim(coalesce(_reason,''))) < 3 then raise exception 'reason required'; end if;
  insert into manual_debts(business_id, customer_id, debt_type, principal, incurred_on, due_on, reason, reference, notes, client_ref, recorded_by)
  values (_biz, _customer, _type, _principal, _incurred_on, _due_on, trim(_reason), nullif(trim(_reference),''), nullif(trim(_notes),''), _client_ref, auth.uid())
  returning id into _id;
  perform public.write_audit(_biz, null, 'deni.manual_debt_recorded', 'manual_debt', _id::text,
    jsonb_build_object('customer', _customer, 'type', _type, 'principal', _principal, 'due_on', _due_on), _client_ref::text);
  return jsonb_build_object('id', _id, 'status', 'created');
end $$;

create or replace function public.record_manual_debt_repayment(_debt uuid, _amount numeric, _method public.tender_type,
  _reference text, _paid_on date, _client_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d manual_debts; _paid numeric; _left numeric; _id uuid;
begin
  select * into d from manual_debts where id = _debt for update;  -- serialises concurrent allocations
  if d.id is null or not public.has_permission(d.business_id, 'deni.manage') then raise exception 'not authorized'; end if;
  if _client_ref is null then raise exception 'client_ref required'; end if;
  select id into _id from manual_debt_repayments where business_id = d.business_id and client_ref = _client_ref;
  if _id is not null then return jsonb_build_object('id', _id, 'status', 'replay'); end if;
  if _method = 'deni' then raise exception 'invalid repayment method'; end if;
  if _amount is null or _amount <= 0 or _amount <> round(_amount, 2) then raise exception 'amount must be positive (max 2 decimals)'; end if;
  if _method = 'mpesa_manual' and length(trim(coalesce(_reference,''))) < 6 then raise exception 'M-Pesa code required'; end if;
  if _paid_on is null or _paid_on > (now() at time zone 'Africa/Nairobi')::date or _paid_on < d.incurred_on then raise exception 'invalid payment date'; end if;
  select coalesce(sum(amount),0) into _paid from manual_debt_repayments where debt_id = d.id;
  _left := d.principal - _paid;
  if _amount > _left then raise exception 'repayment % exceeds outstanding %', _amount, _left; end if;
  insert into manual_debt_repayments(business_id, debt_id, customer_id, amount, method, reference, paid_on, client_ref, recorded_by)
  values (d.business_id, d.id, d.customer_id, _amount, _method, nullif(upper(trim(_reference)),''), _paid_on, _client_ref, auth.uid())
  returning id into _id;
  perform public.write_audit(d.business_id, null, 'deni.manual_debt_repaid', 'manual_debt', d.id::text,
    jsonb_build_object('repayment', _id, 'amount', _amount, 'method', _method, 'outstanding_after', _left - _amount), _client_ref::text);
  return jsonb_build_object('id', _id, 'status', 'created', 'outstanding', _left - _amount);
end $$;

create or replace function public.manual_debt_register(_business uuid)
returns table(id uuid, customer_id uuid, customer_name text, debt_type text, principal numeric, paid numeric, outstanding numeric,
  incurred_on date, due_on date, reason text, reference text, notes text, recorded_by uuid, recorded_by_email text, created_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  select d.id, d.customer_id, c.name, d.debt_type, d.principal, coalesce(p.paid,0), d.principal - coalesce(p.paid,0),
    d.incurred_on, d.due_on, d.reason, d.reference, d.notes, d.recorded_by, u.email::text, d.created_at,
    case when d.principal - coalesce(p.paid,0) <= 0 then 'settled'
         when d.due_on is not null and d.due_on < (now() at time zone 'Africa/Nairobi')::date then 'overdue'
         else 'open' end
  from manual_debts d join customers c on c.id = d.customer_id
  left join (select debt_id, sum(amount) paid from manual_debt_repayments group by debt_id) p on p.debt_id = d.id
  left join auth.users u on u.id = d.recorded_by
  where d.business_id = _business
    and (public.has_permission(_business, 'deni.manage') or public.has_permission(_business, 'reports.view'))
  order by d.created_at desc
$$;
revoke all on function public.record_manual_debt(uuid,text,numeric,date,date,text,text,text,uuid) from public, anon;
revoke all on function public.record_manual_debt_repayment(uuid,numeric,public.tender_type,text,date,uuid) from public, anon;
revoke all on function public.manual_debt_register(uuid) from public, anon;
grant execute on function public.record_manual_debt(uuid,text,numeric,date,date,text,text,text,uuid) to authenticated;
grant execute on function public.record_manual_debt_repayment(uuid,numeric,public.tender_type,text,date,uuid) to authenticated;
grant execute on function public.manual_debt_register(uuid) to authenticated;
