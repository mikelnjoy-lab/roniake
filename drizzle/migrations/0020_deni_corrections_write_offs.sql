-- Workstream A: append-only corrections for manual (non-POS) debts.
create table public.manual_debt_reversals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  debt_id uuid not null references public.manual_debts(id) on delete restrict,
  repayment_id uuid references public.manual_debt_repayments(id) on delete restrict,
  kind text not null check (kind in ('debt','repayment')),
  reason text not null check (length(trim(reason)) >= 5),
  client_ref uuid not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, client_ref),
  check ((kind = 'repayment') = (repayment_id is not null))
);
create unique index manual_debt_reversals_one_debt on public.manual_debt_reversals(debt_id) where kind = 'debt';
create unique index manual_debt_reversals_one_repayment on public.manual_debt_reversals(repayment_id) where repayment_id is not null;
grant select on public.manual_debt_reversals to authenticated;
grant all on public.manual_debt_reversals to service_role;
alter table public.manual_debt_reversals enable row level security;
create policy "manual reversals visible to deni/report roles" on public.manual_debt_reversals for select to authenticated
  using (public.has_permission(business_id, 'deni.manage') or public.has_permission(business_id, 'reports.view'));
create trigger manual_debt_reversals_immutable before update or delete on public.manual_debt_reversals for each row execute function public.immutable_row();

create table public.manual_debt_write_offs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  debt_id uuid not null references public.manual_debts(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount numeric not null check (amount > 0),
  reason text not null check (length(trim(reason)) >= 5),
  client_ref uuid not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, client_ref)
);
create index on public.manual_debt_write_offs(debt_id);
grant select on public.manual_debt_write_offs to authenticated;
grant all on public.manual_debt_write_offs to service_role;
alter table public.manual_debt_write_offs enable row level security;
create policy "manual write-offs visible to deni/report roles" on public.manual_debt_write_offs for select to authenticated
  using (public.has_permission(business_id, 'deni.manage') or public.has_permission(business_id, 'reports.view'));
create trigger manual_debt_write_offs_immutable before update or delete on public.manual_debt_write_offs for each row execute function public.immutable_row();

-- Authoritative per-debt figures, derived from the append-only rows only.
create or replace function public.manual_debt_figures(_debt uuid)
returns table(principal numeric, repaid numeric, written_off numeric, reversed boolean, collectable numeric, outstanding numeric, recovered numeric)
language sql stable security definer set search_path = public as $$
  with d as (select m.principal from manual_debts m where m.id = _debt),
  r as (select coalesce(sum(p.amount),0) v from manual_debt_repayments p
        where p.debt_id = _debt and not exists (select 1 from manual_debt_reversals x where x.repayment_id = p.id)),
  w as (select coalesce(sum(amount),0) v from manual_debt_write_offs where debt_id = _debt),
  x as (select exists(select 1 from manual_debt_reversals where debt_id = _debt and kind = 'debt') v)
  select d.principal, r.v, w.v, x.v,
    case when x.v then 0 else d.principal - r.v end,
    case when x.v then 0 else greatest(d.principal - r.v - w.v, 0) end,
    greatest(r.v + w.v - d.principal, 0)
  from d, r, w, x
$$;
revoke all on function public.manual_debt_figures(uuid) from public, anon, authenticated;

-- Repayment now honours reversals/write-offs; recovery after write-off is allowed up to the amount still collectable.
create or replace function public.record_manual_debt_repayment(_debt uuid, _amount numeric, _method public.tender_type,
  _reference text, _paid_on date, _client_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d manual_debts; fg record; _id uuid;
begin
  select * into d from manual_debts where id = _debt for update;
  if d.id is null or not public.has_permission(d.business_id, 'deni.manage') then raise exception 'not authorized'; end if;
  if _client_ref is null then raise exception 'client_ref required'; end if;
  select id into _id from manual_debt_repayments where business_id = d.business_id and client_ref = _client_ref;
  if _id is not null then return jsonb_build_object('id', _id, 'status', 'replay'); end if;
  if _method = 'deni' then raise exception 'invalid repayment method'; end if;
  if _amount is null or _amount <= 0 or _amount <> round(_amount, 2) then raise exception 'amount must be positive (max 2 decimals)'; end if;
  if _method = 'mpesa_manual' and length(trim(coalesce(_reference,''))) < 6 then raise exception 'M-Pesa code required'; end if;
  if _paid_on is null or _paid_on > (now() at time zone 'Africa/Nairobi')::date or _paid_on < d.incurred_on then raise exception 'invalid payment date'; end if;
  select * into fg from public.manual_debt_figures(d.id);
  if fg.reversed then raise exception 'this loan entry was reversed; repayments are not accepted'; end if;
  if _amount > fg.collectable then raise exception 'repayment % exceeds amount still owed or recoverable %', _amount, fg.collectable; end if;
  insert into manual_debt_repayments(business_id, debt_id, customer_id, amount, method, reference, paid_on, client_ref, recorded_by)
  values (d.business_id, d.id, d.customer_id, _amount, _method, nullif(upper(trim(_reference)),''), _paid_on, _client_ref, auth.uid())
  returning id into _id;
  select * into fg from public.manual_debt_figures(d.id);
  perform public.write_audit(d.business_id, null, case when fg.written_off > 0 then 'deni.manual_debt_recovered' else 'deni.manual_debt_repaid' end,
    'manual_debt', d.id::text, jsonb_build_object('repayment', _id, 'amount', _amount, 'method', _method, 'outstanding_after', fg.outstanding, 'recovered_after', fg.recovered), _client_ref::text);
  return jsonb_build_object('id', _id, 'status', 'created', 'outstanding', fg.outstanding, 'recovered', fg.recovered);
end $$;

-- Owner-only bad-debt write-off. Not a repayment, sale or revenue.
create or replace function public.write_off_manual_debt(_debt uuid, _amount numeric, _reason text, _client_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d manual_debts; fg record; _id uuid;
begin
  select * into d from manual_debts where id = _debt for update;
  if d.id is null or not public.has_permission(d.business_id, 'business.manage') then raise exception 'not authorized: only the Business Owner can write off debt'; end if;
  if _client_ref is null then raise exception 'client_ref required'; end if;
  select id into _id from manual_debt_write_offs where business_id = d.business_id and client_ref = _client_ref;
  if _id is not null then return jsonb_build_object('id', _id, 'status', 'replay'); end if;
  if length(trim(coalesce(_reason,''))) < 5 then raise exception 'a written reason is required'; end if;
  select * into fg from public.manual_debt_figures(d.id);
  if fg.reversed then raise exception 'reversed entries cannot be written off'; end if;
  if _amount is null then _amount := fg.outstanding; end if;
  if _amount <= 0 or _amount <> round(_amount, 2) then raise exception 'amount must be positive (max 2 decimals)'; end if;
  if _amount > fg.outstanding then raise exception 'write-off % exceeds outstanding %', _amount, fg.outstanding; end if;
  insert into manual_debt_write_offs(business_id, debt_id, customer_id, amount, reason, client_ref, recorded_by)
  values (d.business_id, d.id, d.customer_id, _amount, trim(_reason), _client_ref, auth.uid()) returning id into _id;
  perform public.write_audit(d.business_id, null, 'deni.manual_debt_written_off', 'manual_debt', d.id::text,
    jsonb_build_object('write_off', _id, 'amount', _amount, 'reason', trim(_reason), 'outstanding_before', fg.outstanding, 'outstanding_after', fg.outstanding - _amount), _client_ref::text);
  return jsonb_build_object('id', _id, 'status', 'created', 'outstanding', fg.outstanding - _amount);
end $$;

-- Reverse an accidental loan entry (only when nothing live depends on it) or an accidental repayment.
create or replace function public.reverse_manual_debt_entry(_debt uuid, _repayment uuid, _reason text, _client_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d manual_debts; rp manual_debt_repayments; fg record; _id uuid; _kind text;
begin
  select * into d from manual_debts where id = _debt for update;
  if d.id is null or not public.has_permission(d.business_id, 'deni.manage') then raise exception 'not authorized'; end if;
  if _client_ref is null then raise exception 'client_ref required'; end if;
  select id into _id from manual_debt_reversals where business_id = d.business_id and client_ref = _client_ref;
  if _id is not null then return jsonb_build_object('id', _id, 'status', 'replay'); end if;
  if length(trim(coalesce(_reason,''))) < 5 then raise exception 'a written reason is required'; end if;
  select * into fg from public.manual_debt_figures(d.id);
  if fg.reversed then raise exception 'this loan entry is already reversed'; end if;
  if _repayment is null then
    _kind := 'debt';
    if fg.repaid > 0 then raise exception 'reverse its repayments first'; end if;
    if fg.written_off > 0 then raise exception 'written-off loans cannot be reversed'; end if;
  else
    _kind := 'repayment';
    select * into rp from manual_debt_repayments where id = _repayment and debt_id = d.id;
    if rp.id is null then raise exception 'repayment does not belong to this loan'; end if;
    if exists (select 1 from manual_debt_reversals where repayment_id = rp.id) then raise exception 'repayment already reversed'; end if;
    if fg.written_off > 0 and fg.principal - (fg.repaid - rp.amount) - fg.written_off < 0 then
      raise exception 'reversing this repayment would make the written-off amount exceed the loan';
    end if;
  end if;
  insert into manual_debt_reversals(business_id, debt_id, repayment_id, kind, reason, client_ref, recorded_by)
  values (d.business_id, d.id, _repayment, _kind, trim(_reason), _client_ref, auth.uid()) returning id into _id;
  select * into fg from public.manual_debt_figures(d.id);
  perform public.write_audit(d.business_id, null, 'deni.manual_' || _kind || '_reversed', 'manual_debt', d.id::text,
    jsonb_build_object('reversal', _id, 'repayment', _repayment, 'original_amount', case when _kind='debt' then d.principal else rp.amount end,
      'reason', trim(_reason), 'outstanding_after', fg.outstanding), _client_ref::text);
  return jsonb_build_object('id', _id, 'status', 'created', 'outstanding', fg.outstanding);
end $$;

drop function public.manual_debt_register(uuid);
create function public.manual_debt_register(_business uuid)
returns table(id uuid, customer_id uuid, customer_name text, debt_type text, principal numeric, paid numeric, written_off numeric,
  recovered numeric, outstanding numeric, incurred_on date, due_on date, reason text, reference text, notes text,
  recorded_by uuid, recorded_by_email text, created_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  select d.id, d.customer_id, c.name, d.debt_type, d.principal, f.repaid, f.written_off, f.recovered, f.outstanding,
    d.incurred_on, d.due_on, d.reason, d.reference, d.notes, d.recorded_by, u.email::text, d.created_at,
    case when f.reversed then 'reversed'
         when f.outstanding <= 0 and f.written_off > 0 then 'written_off'
         when f.outstanding <= 0 then 'settled'
         when d.due_on is not null and d.due_on < (now() at time zone 'Africa/Nairobi')::date then 'overdue'
         else 'open' end
  from manual_debts d join customers c on c.id = d.customer_id
  cross join lateral public.manual_debt_figures(d.id) f
  left join auth.users u on u.id = d.recorded_by
  where d.business_id = _business
    and (public.has_permission(_business, 'deni.manage') or public.has_permission(_business, 'reports.view'))
  order by d.created_at desc
$$;
revoke all on function public.manual_debt_register(uuid) from public, anon;
grant execute on function public.manual_debt_register(uuid) to authenticated;
revoke all on function public.write_off_manual_debt(uuid,numeric,text,uuid) from public, anon;
grant execute on function public.write_off_manual_debt(uuid,numeric,text,uuid) to authenticated;
revoke all on function public.reverse_manual_debt_entry(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.reverse_manual_debt_entry(uuid,uuid,text,uuid) to authenticated;