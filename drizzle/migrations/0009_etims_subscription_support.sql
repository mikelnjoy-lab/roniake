
create table public.etims_configs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict unique,
  kra_pin text check (kra_pin is null or kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  branch_code text check (branch_code is null or branch_code ~ '^[0-9A-Z]{2,6}$'),
  device_type text not null default 'vscu' check (device_type in ('oscu','vscu')),
  device_serial text,
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'not_configured' check (status in ('not_configured','configured','kra_onboarding','kra_approved')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.etims_configs to authenticated;
grant all on public.etims_configs to service_role;
alter table public.etims_configs enable row level security;
create policy "etims config read" on public.etims_configs for select to authenticated
  using (public.has_permission(business_id,'etims.configure') or public.has_permission(business_id,'reports.view'));

create table public.etims_transmissions (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  attempt int not null default 1,
  status text not null check (status in ('queued','sent','accepted','rejected','failed_retry','failed_permanent')),
  kra_invoice_no text,
  error_message text,
  created_at timestamptz not null default now()
);
create index on public.etims_transmissions(business_id, created_at desc);
grant select on public.etims_transmissions to authenticated;
grant all on public.etims_transmissions to service_role;
alter table public.etims_transmissions enable row level security;
create policy "etims tx read" on public.etims_transmissions for select to authenticated
  using (public.has_permission(business_id,'etims.configure') or public.has_permission(business_id,'reports.view'));
create trigger etims_tx_immutable before update or delete on public.etims_transmissions for each row execute function public.immutable_row();

create or replace function public.save_etims_config(_branch uuid, _kra_pin text, _branch_code text, _device_type text, _device_serial text, _environment text, _status text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _biz uuid; _id uuid;
begin
  _biz := public.branch_business_checked(_branch, 'etims.configure');
  if _status = 'kra_approved' and _environment <> 'production' then
    raise exception 'KRA approval only applies to production' using errcode='P0001';
  end if;
  if _status <> 'not_configured' and (_kra_pin is null or _branch_code is null) then
    raise exception 'KRA PIN and branch code are required' using errcode='P0001';
  end if;
  insert into public.etims_configs(business_id, branch_id, kra_pin, branch_code, device_type, device_serial, environment, status, updated_by, updated_at)
  values (_biz, _branch, upper(nullif(trim(_kra_pin),'')), upper(nullif(trim(_branch_code),'')), _device_type, nullif(trim(_device_serial),''), _environment, _status, auth.uid(), now())
  on conflict (branch_id) do update set kra_pin=excluded.kra_pin, branch_code=excluded.branch_code, device_type=excluded.device_type,
    device_serial=excluded.device_serial, environment=excluded.environment, status=excluded.status, updated_by=excluded.updated_by, updated_at=now()
  returning id into _id;
  perform public.write_audit(_biz, _branch, 'etims.config_saved', 'etims_config', _id::text,
    jsonb_build_object('device_type',_device_type,'environment',_environment,'status',_status), null);
  return _id;
end $$;
revoke all on function public.save_etims_config(uuid,text,text,text,text,text,text) from public, anon;
grant execute on function public.save_etims_config(uuid,text,text,text,text,text,text) to authenticated;

create table public.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  plan text not null default 'pilot' check (plan in ('pilot','starter','growth','enterprise')),
  status text not null default 'trial' check (status in ('trial','active','past_due','cancelled')),
  max_branches int not null default 2,
  max_terminals int not null default 3,
  max_staff int not null default 10,
  period_end timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
alter table public.subscriptions enable row level security;
create policy "subscription read" on public.subscriptions for select to authenticated using (public.is_business_member(business_id));

insert into public.subscriptions(business_id) select id from public.businesses on conflict do nothing;

create or replace function public.subscription_for_new_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.subscriptions(business_id) values (new.id) on conflict do nothing; return new; end $$;
create trigger businesses_subscription after insert on public.businesses for each row execute function public.subscription_for_new_business();

create or replace function public.subscription_overview(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.subscriptions;
begin
  if not public.is_business_member(_business) then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into s from public.subscriptions where business_id=_business;
  return jsonb_build_object(
    'plan', s.plan, 'status', s.status, 'period_end', s.period_end,
    'max_branches', s.max_branches, 'max_terminals', s.max_terminals, 'max_staff', s.max_staff,
    'branches', (select count(*) from public.branches where business_id=_business and is_active),
    'staff', (select count(*) from public.business_memberships where business_id=_business and status='active'),
    'terminals', (select count(distinct device_id) from public.sales where business_id=_business and device_id is not null and created_at > now() - interval '30 days'));
end $$;
revoke all on function public.subscription_overview(uuid) from public, anon;
grant execute on function public.subscription_overview(uuid) to authenticated;

create table public.support_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  scope text not null check (scope in ('read_only','troubleshoot')),
  reason text not null check (length(trim(reason)) between 5 and 300),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid
);
create index on public.support_grants(business_id, granted_at desc);
grant select on public.support_grants to authenticated;
grant all on public.support_grants to service_role;
alter table public.support_grants enable row level security;
create policy "support grants read" on public.support_grants for select to authenticated
  using (public.has_permission(business_id,'support.grant') or public.has_permission(business_id,'audit.view'));

create or replace function public.grant_support_access(_business uuid, _scope text, _reason text, _hours int)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if not public.has_permission(_business,'support.grant') then raise exception 'Only the owner can grant support access' using errcode='42501'; end if;
  if _hours not between 1 and 24 then raise exception 'Support access must expire within 24 hours' using errcode='P0001'; end if;
  if exists (select 1 from public.support_grants where business_id=_business and revoked_at is null and expires_at > now()) then
    raise exception 'Support access is already active' using errcode='P0001'; end if;
  insert into public.support_grants(business_id, scope, reason, granted_by, expires_at)
  values (_business, _scope, trim(_reason), auth.uid(), now() + make_interval(hours => _hours)) returning id into _id;
  perform public.write_audit(_business, null, 'support.granted', 'support_grant', _id::text,
    jsonb_build_object('scope',_scope,'hours',_hours,'reason',trim(_reason)), null);
  return _id;
end $$;
revoke all on function public.grant_support_access(uuid,text,text,int) from public, anon;
grant execute on function public.grant_support_access(uuid,text,text,int) to authenticated;

create or replace function public.revoke_support_access(_grant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare _biz uuid;
begin
  select business_id into _biz from public.support_grants where id=_grant;
  if _biz is null or not public.has_permission(_biz,'support.grant') then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.support_grants set revoked_at=now(), revoked_by=auth.uid() where id=_grant and revoked_at is null;
  perform public.write_audit(_biz, null, 'support.revoked', 'support_grant', _grant::text, '{}'::jsonb, null);
end $$;
revoke all on function public.revoke_support_access(uuid) from public, anon;
grant execute on function public.revoke_support_access(uuid) to authenticated;
