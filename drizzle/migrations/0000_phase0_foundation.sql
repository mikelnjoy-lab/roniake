-- RONIA BUSINESS — Phase 0 Foundation Bootstrap
-- Tenancy: organization -> business -> branch. Authorization lives in the DB (RLS + security definer helpers).

create type public.business_role as enum ('owner','manager','cashier','auditor');
create type public.membership_status as enum ('invited','active','suspended','revoked');
create type public.business_lifecycle as enum ('setup','active','suspended','closed');

create table public.profiles (
  id uuid primary key,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 120),
  legal_name text,
  kra_pin text check (kra_pin is null or kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  phone text,
  email text,
  physical_address text,
  currency text not null default 'KES',
  timezone text not null default 'Africa/Nairobi',
  lifecycle_state public.business_lifecycle not null default 'setup',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.businesses(organization_id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 120),
  code text not null check (code ~ '^[A-Z0-9-]{2,16}$'),
  physical_address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);
create index on public.branches(business_id);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null,
  role public.business_role not null,
  status public.membership_status not null default 'active',
  all_branches boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index on public.business_memberships(user_id);

create table public.membership_branches (
  membership_id uuid not null references public.business_memberships(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (membership_id, branch_id)
);

create table public.role_permissions (
  role public.business_role not null,
  permission text not null,
  primary key (role, permission)
);
insert into public.role_permissions(role, permission) values
 ('owner','business.view'),('owner','business.manage'),('owner','branch.manage'),('owner','members.view'),('owner','members.manage'),('owner','members.manage_owner'),('owner','audit.view'),('owner','catalog.manage'),('owner','inventory.manage'),('owner','pos.sell'),('owner','pos.discount'),('owner','shift.view_expected'),('owner','reports.view'),('owner','reports.export'),('owner','deni.manage'),('owner','mpesa.configure'),('owner','etims.configure'),('owner','subscription.manage'),('owner','support.grant'),
 ('manager','business.view'),('manager','branch.manage'),('manager','members.view'),('manager','members.manage'),('manager','audit.view'),('manager','catalog.manage'),('manager','inventory.manage'),('manager','pos.sell'),('manager','pos.discount'),('manager','shift.view_expected'),('manager','reports.view'),('manager','reports.export'),('manager','deni.manage'),
 ('cashier','business.view'),('cashier','pos.sell'),
 ('auditor','business.view'),('auditor','members.view'),('auditor','audit.view'),('auditor','reports.view'),('auditor','shift.view_expected');

create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log(business_id, created_at desc);

create table public.idempotency_keys (
  business_id uuid not null references public.businesses(id) on delete restrict,
  scope text not null,
  idem_key text not null check (length(idem_key) between 8 and 128),
  request_hash text not null,
  actor_user_id uuid not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (business_id, scope, idem_key)
);

grant select on public.organizations, public.businesses, public.branches, public.business_memberships, public.membership_branches, public.role_permissions, public.audit_log to authenticated;
grant update on public.businesses, public.branches, public.business_memberships to authenticated;
grant insert on public.branches to authenticated;
grant all on public.organizations, public.businesses, public.branches, public.business_memberships, public.membership_branches, public.role_permissions, public.audit_log, public.idempotency_keys to service_role;

alter table public.organizations enable row level security;
alter table public.businesses enable row level security;
alter table public.branches enable row level security;
alter table public.business_memberships enable row level security;
alter table public.membership_branches enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_log enable row level security;
alter table public.idempotency_keys enable row level security;

create or replace function public.member_role(_business uuid)
returns public.business_role language sql stable security definer set search_path = public as $$
  select m.role from public.business_memberships m
  join public.businesses b on b.id = m.business_id
  where m.business_id = _business and m.user_id = auth.uid() and m.status = 'active' and b.lifecycle_state <> 'closed'
$$;

create or replace function public.is_business_member(_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.member_role(_business) is not null
$$;

create or replace function public.has_permission(_business uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.role_permissions rp where rp.role = public.member_role(_business) and rp.permission = _permission)
$$;

create or replace function public.can_access_branch(_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.branches br
    join public.business_memberships m on m.business_id = br.business_id and m.user_id = auth.uid() and m.status = 'active'
    join public.businesses b on b.id = br.business_id and b.lifecycle_state <> 'closed'
    where br.id = _branch
      and (m.role in ('owner','manager','auditor') or m.all_branches
           or exists (select 1 from public.membership_branches mb where mb.membership_id = m.id and mb.branch_id = br.id))
  )
$$;

create or replace function public.write_audit(_business uuid, _branch uuid, _action text, _entity_type text, _entity_id text, _payload jsonb, _request_id text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(business_id, branch_id, actor_user_id, action, entity_type, entity_id, payload, request_id)
  values (_business, _branch, auth.uid(), _action, _entity_type, _entity_id, coalesce(_payload,'{}'::jsonb), _request_id)
$$;
revoke execute on function public.write_audit(uuid,uuid,text,text,text,jsonb,text) from public, anon, authenticated;

create or replace function public.audit_log_immutable() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_update before update or delete on public.audit_log for each row execute function public.audit_log_immutable();

create policy "org visible to members" on public.organizations for select to authenticated
  using (exists (select 1 from public.businesses b where b.organization_id = organizations.id and public.is_business_member(b.id)));

create policy "business visible to members" on public.businesses for select to authenticated using (public.is_business_member(id));
create policy "business managed by owner" on public.businesses for update to authenticated
  using (public.has_permission(id, 'business.manage')) with check (public.has_permission(id, 'business.manage'));

create policy "branch visible if accessible" on public.branches for select to authenticated using (public.can_access_branch(id));
create policy "branch create" on public.branches for insert to authenticated with check (public.has_permission(business_id, 'branch.manage'));
create policy "branch update" on public.branches for update to authenticated
  using (public.has_permission(business_id, 'branch.manage')) with check (public.has_permission(business_id, 'branch.manage'));

create policy "membership own or viewer" on public.business_memberships for select to authenticated
  using (user_id = auth.uid() or public.has_permission(business_id, 'members.view'));
create policy "membership update by managers" on public.business_memberships for update to authenticated
  using (public.has_permission(business_id, 'members.manage')) with check (public.has_permission(business_id, 'members.manage'));

create policy "membership branches visible" on public.membership_branches for select to authenticated
  using (exists (select 1 from public.business_memberships m where m.id = membership_id and (m.user_id = auth.uid() or public.has_permission(m.business_id, 'members.view'))));

create policy "permissions readable" on public.role_permissions for select to authenticated using (true);

create policy "audit visible to authorized" on public.audit_log for select to authenticated using (public.has_permission(business_id, 'audit.view'));

create or replace function public.guard_membership_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.business_id <> old.business_id or new.user_id <> old.user_id then
    raise exception 'membership identity is immutable';
  end if;
  if (new.role = 'owner' or old.role = 'owner') and new.role is distinct from old.role and not public.has_permission(new.business_id, 'members.manage_owner') then
    raise exception 'only owners may grant or remove the owner role';
  end if;
  if old.role = 'owner' and old.status = 'active' and (new.role <> 'owner' or new.status <> 'active')
     and (select count(*) from public.business_memberships where business_id = old.business_id and role='owner' and status='active') <= 1 then
    raise exception 'business must keep at least one active owner';
  end if;
  new.updated_at := now();
  perform public.write_audit(new.business_id, null, 'membership.updated', 'business_membership', new.id::text,
    jsonb_build_object('from', jsonb_build_object('role', old.role, 'status', old.status), 'to', jsonb_build_object('role', new.role, 'status', new.status)));
  return new;
end $$;
create trigger membership_guard before update on public.business_memberships for each row execute function public.guard_membership_update();

create or replace function public.guard_business_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id <> old.organization_id or new.created_by <> old.created_by then
    raise exception 'business ownership columns are immutable';
  end if;
  new.updated_at := now();
  perform public.write_audit(new.id, null, 'business.updated', 'business', new.id::text,
    jsonb_build_object('lifecycle_from', old.lifecycle_state, 'lifecycle_to', new.lifecycle_state));
  return new;
end $$;
create trigger business_guard before update on public.businesses for each row execute function public.guard_business_update();

create or replace function public.audit_branch_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.business_id <> old.business_id then raise exception 'branch business is immutable'; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger branch_guard before insert or update on public.branches for each row execute function public.audit_branch_change();

create or replace function public.audit_branch_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit(new.business_id, new.id, 'branch.' || lower(tg_op), 'branch', new.id::text, jsonb_build_object('name', new.name, 'code', new.code, 'is_active', new.is_active));
  return null;
end $$;
create trigger branch_audit after insert or update on public.branches for each row execute function public.audit_branch_after();

create or replace function public.create_business(_name text, _branch_name text, _branch_code text default 'MAIN')
returns uuid language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _org uuid; _biz uuid; _branch uuid;
begin
  if _uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.organizations(name, created_by) values (_name, _uid) returning id into _org;
  insert into public.businesses(organization_id, name, created_by) values (_org, _name, _uid) returning id into _biz;
  insert into public.business_memberships(business_id, user_id, role, status, all_branches, created_by)
    values (_biz, _uid, 'owner', 'active', true, _uid);
  insert into public.branches(business_id, name, code) values (_biz, _branch_name, upper(_branch_code)) returning id into _branch;
  perform public.write_audit(_biz, _branch, 'business.created', 'business', _biz::text, jsonb_build_object('name', _name));
  return _biz;
end $$;
revoke execute on function public.create_business(text,text,text) from public, anon;
grant execute on function public.create_business(text,text,text) to authenticated;

create or replace function public.resolve_tenant_context(_business uuid, _branch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _role public.business_role; _state public.business_lifecycle;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  _role := public.member_role(_business);
  if _role is null then raise exception 'not a member of this business' using errcode = '42501'; end if;
  select lifecycle_state into _state from public.businesses where id = _business;
  if _branch is not null then
    if not exists (select 1 from public.branches where id = _branch and business_id = _business and is_active) or not public.can_access_branch(_branch) then
      raise exception 'branch not accessible' using errcode = '42501';
    end if;
  end if;
  return jsonb_build_object(
    'user_id', auth.uid(), 'business_id', _business, 'branch_id', _branch, 'role', _role, 'lifecycle_state', _state,
    'permissions', (select coalesce(jsonb_agg(permission order by permission), '[]'::jsonb) from public.role_permissions where role = _role));
end $$;
revoke execute on function public.resolve_tenant_context(uuid,uuid) from public, anon;
grant execute on function public.resolve_tenant_context(uuid,uuid) to authenticated;

create or replace function public.add_business_member(_business uuid, _user uuid, _role public.business_role, _branch_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare _mem uuid; _b uuid;
begin
  if not public.has_permission(_business, 'members.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _role = 'owner' and not public.has_permission(_business, 'members.manage_owner') then raise exception 'only owners may grant the owner role' using errcode = '42501'; end if;
  insert into public.business_memberships(business_id, user_id, role, status, created_by) values (_business, _user, _role, 'active', auth.uid()) returning id into _mem;
  foreach _b in array coalesce(_branch_ids, '{}') loop
    if not exists (select 1 from public.branches where id = _b and business_id = _business) then raise exception 'branch does not belong to business'; end if;
    insert into public.membership_branches(membership_id, branch_id) values (_mem, _b);
  end loop;
  perform public.write_audit(_business, null, 'membership.created', 'business_membership', _mem::text, jsonb_build_object('user_id', _user, 'role', _role));
  return _mem;
end $$;
revoke execute on function public.add_business_member(uuid,uuid,public.business_role,uuid[]) from public, anon;
grant execute on function public.add_business_member(uuid,uuid,public.business_role,uuid[]) to authenticated;

create or replace function public.claim_idempotency(_business uuid, _scope text, _key text, _request_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _row public.idempotency_keys;
begin
  if not public.is_business_member(_business) then raise exception 'not a member of this business' using errcode = '42501'; end if;
  insert into public.idempotency_keys(business_id, scope, idem_key, request_hash, actor_user_id)
    values (_business, _scope, _key, _request_hash, auth.uid()) on conflict do nothing;
  if found then return jsonb_build_object('status','new'); end if;
  select * into _row from public.idempotency_keys where business_id = _business and scope = _scope and idem_key = _key;
  if _row.request_hash <> _request_hash then raise exception 'idempotency key reused with different payload' using errcode = '22023'; end if;
  return jsonb_build_object('status','replay','response', _row.response);
end $$;
revoke execute on function public.claim_idempotency(uuid,text,text,text) from public, anon;
grant execute on function public.claim_idempotency(uuid,text,text,text) to authenticated;

create or replace function public.complete_idempotency(_business uuid, _scope text, _key text, _response jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.idempotency_keys set response = _response
   where business_id = _business and scope = _scope and idem_key = _key and actor_user_id = auth.uid() and response is null;
  if not found then raise exception 'idempotency record not found or already completed'; end if;
end $$;
revoke execute on function public.complete_idempotency(uuid,text,text,jsonb) from public, anon;
grant execute on function public.complete_idempotency(uuid,text,text,jsonb) to authenticated;

revoke execute on function public.member_role(uuid), public.is_business_member(uuid), public.has_permission(uuid,text), public.can_access_branch(uuid) from public, anon;
grant execute on function public.member_role(uuid), public.is_business_member(uuid), public.has_permission(uuid,text), public.can_access_branch(uuid) to authenticated;
