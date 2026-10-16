-- RONIA platform-owner administration, database-backed subscription plans, server-side quotas.
-- Platform owners are NOT business members: being one grants no access to any merchant's sales, stock or customers.

create table public.platform_admins (
  user_id uuid primary key,
  granted_at timestamptz not null default now(),
  granted_by uuid,
  note text,
  revoked_at timestamptz,
  revoked_by uuid
);
grant select on public.platform_admins to authenticated;
grant all on public.platform_admins to service_role;
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.platform_admins where user_id = auth.uid() and revoked_at is null)
$$;
revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

create policy "platform admins read" on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_platform_owner());

create table public.platform_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select on public.platform_audit_log to authenticated;
grant all on public.platform_audit_log to service_role;
alter table public.platform_audit_log enable row level security;
create policy "platform audit read" on public.platform_audit_log for select to authenticated using (public.is_platform_owner());
create trigger platform_audit_immutable before update or delete on public.platform_audit_log for each row execute function public.immutable_row();

create or replace function public.write_platform_audit(_action text, _entity_type text, _entity_id text, _payload jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.platform_audit_log(actor_user_id, action, entity_type, entity_id, payload)
  values (auth.uid(), _action, _entity_type, _entity_id, coalesce(_payload, '{}'::jsonb))
$$;
revoke all on function public.write_platform_audit(text,text,text,jsonb) from public, anon, authenticated;

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;
alter table public.platform_settings enable row level security;
create policy "platform settings read" on public.platform_settings for select to authenticated using (true);
insert into public.platform_settings(key, value) values ('trial_days', '14'::jsonb);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,30}$'),
  name text not null check (length(trim(name)) > 0),
  description text,
  status text not null default 'draft' check (status in ('draft','active','inactive','archived')),
  current_version_id uuid,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans(id),
  version_no int not null,
  state text not null default 'draft' check (state in ('draft','published')),
  price_kes numeric(12,2) not null check (price_kes >= 0),
  billing_period text not null check (billing_period in ('month','quarter','year')),
  max_branches int not null check (max_branches >= 1),
  max_terminals int not null check (max_terminals >= 1),
  max_staff int not null check (max_staff >= 1),
  features jsonb not null default '{}'::jsonb,
  change_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  unique (plan_id, version_no)
);
create unique index plan_versions_one_draft on public.plan_versions(plan_id) where state = 'draft';
alter table public.subscription_plans add constraint subscription_plans_current_version_fk foreign key (current_version_id) references public.plan_versions(id);

grant select on public.subscription_plans, public.plan_versions to authenticated;
grant all on public.subscription_plans, public.plan_versions to service_role;
alter table public.subscription_plans enable row level security;
alter table public.plan_versions enable row level security;
create policy "plans read" on public.subscription_plans for select to authenticated
  using (public.is_platform_owner() or status = 'active');
create policy "plan versions read" on public.plan_versions for select to authenticated
  using (public.is_platform_owner() or state = 'published');

-- Published versions are frozen: price history can never be rewritten.
create or replace function public.plan_version_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if old.state = 'published' then raise exception 'Published plan versions cannot be changed or deleted'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger plan_versions_guard before update or delete on public.plan_versions for each row execute function public.plan_version_guard();

-- Existing subscriptions table: link to plan versions, add trial end. Legacy text label kept.
alter table public.subscriptions
  add column plan_id uuid references public.subscription_plans(id),
  add column plan_version_id uuid references public.plan_versions(id),
  add column trial_ends_at timestamptz,
  add column updated_at timestamptz not null default now();
comment on column public.subscriptions.plan is 'DEPRECATED: legacy label; replaced by plan_id / plan_version_id';

create table public.subscription_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id),
  event text not null,
  plan_id uuid references public.subscription_plans(id),
  plan_version_id uuid references public.plan_versions(id),
  price_kes numeric(12,2),
  billing_period text,
  max_branches int,
  max_terminals int,
  max_staff int,
  status text,
  note text,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
grant select on public.subscription_events to authenticated;
grant all on public.subscription_events to service_role;
alter table public.subscription_events enable row level security;
create policy "subscription events read" on public.subscription_events for select to authenticated
  using (public.is_platform_owner() or public.has_permission(business_id, 'subscription.manage'));
create trigger subscription_events_immutable before update or delete on public.subscription_events for each row execute function public.immutable_row();

insert into public.subscription_events(business_id, event, status, max_branches, max_terminals, max_staff, note)
  select business_id, 'legacy_snapshot', status, max_branches, max_terminals, max_staff, 'State recorded when plan management was introduced'
  from public.subscriptions;

-- New businesses start a full-feature trial whose length comes from platform settings.
create or replace function public.subscription_for_new_business() returns trigger
language plpgsql security definer set search_path = public as $$
declare _days int := coalesce((select (value)::text::int from public.platform_settings where key = 'trial_days'), 14);
begin
  insert into public.subscriptions(business_id, status, trial_ends_at) values (new.id, 'trial', now() + make_interval(days => _days)) on conflict do nothing;
  insert into public.subscription_events(business_id, event, status, note, max_branches, max_terminals, max_staff)
    select new.id, 'trial_started', 'trial', _days || '-day full-feature trial', s.max_branches, s.max_terminals, s.max_staff
    from public.subscriptions s where s.business_id = new.id;
  return new;
end $$;

-- Quotas: branches and active staff are hard limits on ADDING; tills are never blocked (a sale is never interrupted).
create or replace function public.enforce_branch_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare _lim int; _used int;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active then return new; end if;
  select max_branches into _lim from public.subscriptions where business_id = new.business_id for update;
  if _lim is null then return new; end if;
  select count(*) into _used from public.branches where business_id = new.business_id and is_active and id <> new.id;
  if _used >= _lim then raise exception 'Your plan allows % branch(es). Upgrade your plan to add another.', _lim using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger branches_quota before insert or update of is_active on public.branches for each row execute function public.enforce_branch_quota();

create or replace function public.enforce_staff_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare _lim int; _used int;
begin
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;
  select max_staff into _lim from public.subscriptions where business_id = new.business_id for update;
  if _lim is null then return new; end if;
  select count(*) into _used from public.business_memberships where business_id = new.business_id and status = 'active' and id <> new.id;
  if _used >= _lim then raise exception 'Your plan allows % active staff. Upgrade your plan to add another.', _lim using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger memberships_quota before insert or update of status on public.business_memberships for each row execute function public.enforce_staff_quota();

create or replace function public.subscription_overview(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.subscriptions; v public.plan_versions; p public.subscription_plans;
begin
  if not public.is_business_member(_business) then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into s from public.subscriptions where business_id=_business;
  select * into v from public.plan_versions where id = s.plan_version_id;
  select * into p from public.subscription_plans where id = s.plan_id;
  return jsonb_build_object(
    'plan', coalesce(p.name, case when s.status = 'trial' then 'Free trial' else s.plan end),
    'status', s.status, 'period_end', s.period_end, 'trial_ends_at', s.trial_ends_at,
    'price_kes', v.price_kes, 'billing_period', v.billing_period, 'version_no', v.version_no,
    'newer_version_available', p.current_version_id is not null and p.current_version_id <> s.plan_version_id,
    'max_branches', s.max_branches, 'max_terminals', s.max_terminals, 'max_staff', s.max_staff,
    'branches', (select count(*) from public.branches where business_id=_business and is_active),
    'staff', (select count(*) from public.business_memberships where business_id=_business and status='active'),
    'terminals', (select count(distinct device_id) from public.sales where business_id=_business and device_id is not null and created_at > now() - interval '30 days'));
end $$;

-- ===== Platform-owner functions (every one checks is_platform_owner and writes the platform audit) =====
create or replace function public.require_platform_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'RONIA platform owner access required' using errcode = '42501'; end if;
end $$;
revoke all on function public.require_platform_owner() from public, anon, authenticated;

create or replace function public.platform_save_plan(_id uuid, _code text, _name text, _description text, _sort int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare _old public.subscription_plans; _pid uuid;
begin
  perform public.require_platform_owner();
  if coalesce(trim(_name), '') = '' then raise exception 'Plan name is required'; end if;
  if _id is null then
    insert into public.subscription_plans(code, name, description, sort_order, created_by)
      values (lower(trim(_code)), trim(_name), nullif(trim(_description), ''), coalesce(_sort, 0), auth.uid()) returning id into _pid;
    perform public.write_platform_audit('plan.created', 'subscription_plan', _pid::text, jsonb_build_object('code', lower(trim(_code)), 'name', trim(_name)));
    return _pid;
  end if;
  select * into _old from public.subscription_plans where id = _id for update;
  if not found then raise exception 'Plan not found'; end if;
  if _old.status = 'archived' then raise exception 'Archived plans cannot be edited'; end if;
  update public.subscription_plans set name = trim(_name), description = nullif(trim(_description), ''), sort_order = coalesce(_sort, sort_order), updated_at = now() where id = _id;
  perform public.write_platform_audit('plan.updated', 'subscription_plan', _id::text,
    jsonb_build_object('before', jsonb_build_object('name', _old.name, 'description', _old.description), 'after', jsonb_build_object('name', trim(_name), 'description', nullif(trim(_description), ''))));
  return _id;
end $$;

create or replace function public.platform_save_plan_draft(_plan uuid, _price numeric, _period text, _branches int, _terminals int, _staff int, _features jsonb, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _p public.subscription_plans; _vid uuid;
begin
  perform public.require_platform_owner();
  select * into _p from public.subscription_plans where id = _plan for update;
  if not found then raise exception 'Plan not found'; end if;
  if _p.status = 'archived' then raise exception 'Archived plans cannot be edited'; end if;
  if _price is null or _price < 0 then raise exception 'Price must be zero or more'; end if;
  if coalesce(_branches,0) < 1 or coalesce(_terminals,0) < 1 or coalesce(_staff,0) < 1 then raise exception 'Limits must be at least 1'; end if;
  if jsonb_typeof(coalesce(_features, '{}'::jsonb)) <> 'object' then raise exception 'Features must be a set of on/off flags'; end if;
  select id into _vid from public.plan_versions where plan_id = _plan and state = 'draft';
  if _vid is null then
    insert into public.plan_versions(plan_id, version_no, price_kes, billing_period, max_branches, max_terminals, max_staff, features, change_note, created_by)
      values (_plan, coalesce((select max(version_no) from public.plan_versions where plan_id = _plan), 0) + 1, round(_price, 2), _period, _branches, _terminals, _staff, coalesce(_features, '{}'::jsonb), nullif(trim(_note), ''), auth.uid())
      returning id into _vid;
  else
    update public.plan_versions set price_kes = round(_price, 2), billing_period = _period, max_branches = _branches, max_terminals = _terminals, max_staff = _staff,
      features = coalesce(_features, '{}'::jsonb), change_note = nullif(trim(_note), ''), created_by = auth.uid(), created_at = now() where id = _vid;
  end if;
  perform public.write_platform_audit('plan.draft_saved', 'subscription_plan', _plan::text,
    jsonb_build_object('version_id', _vid, 'price_kes', round(_price, 2), 'billing_period', _period, 'max_branches', _branches, 'max_terminals', _terminals, 'max_staff', _staff, 'features', _features));
  return _vid;
end $$;

create or replace function public.platform_discard_plan_draft(_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare _vid uuid;
begin
  perform public.require_platform_owner();
  delete from public.plan_versions where plan_id = _plan and state = 'draft' returning id into _vid;
  if _vid is null then raise exception 'No draft to discard'; end if;
  perform public.write_platform_audit('plan.draft_discarded', 'subscription_plan', _plan::text, jsonb_build_object('version_id', _vid));
end $$;

create or replace function public.platform_preview_plan(_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare _p public.subscription_plans; c public.plan_versions; d public.plan_versions; _changes jsonb := '[]'::jsonb; _subs int;
begin
  perform public.require_platform_owner();
  select * into _p from public.subscription_plans where id = _plan;
  if not found then raise exception 'Plan not found'; end if;
  select * into c from public.plan_versions where id = _p.current_version_id;
  select * into d from public.plan_versions where plan_id = _plan and state = 'draft';
  if d.id is null then raise exception 'No draft changes to preview'; end if;
  select count(*) into _subs from public.subscriptions where plan_id = _plan;
  if c.id is null or c.price_kes is distinct from d.price_kes then _changes := _changes || jsonb_build_object('field','price_kes','from',c.price_kes,'to',d.price_kes); end if;
  if c.id is null or c.billing_period is distinct from d.billing_period then _changes := _changes || jsonb_build_object('field','billing_period','from',c.billing_period,'to',d.billing_period); end if;
  if c.id is null or c.max_branches is distinct from d.max_branches then _changes := _changes || jsonb_build_object('field','max_branches','from',c.max_branches,'to',d.max_branches); end if;
  if c.id is null or c.max_terminals is distinct from d.max_terminals then _changes := _changes || jsonb_build_object('field','max_terminals','from',c.max_terminals,'to',d.max_terminals); end if;
  if c.id is null or c.max_staff is distinct from d.max_staff then _changes := _changes || jsonb_build_object('field','max_staff','from',c.max_staff,'to',d.max_staff); end if;
  if c.id is null or c.features is distinct from d.features then _changes := _changes || jsonb_build_object('field','features','from',c.features,'to',d.features); end if;
  return jsonb_build_object('plan', _p.name, 'from_version', c.version_no, 'to_version', d.version_no, 'changes', _changes,
    'current_subscribers', _subs, 'subscribers_changed_on_publish', 0,
    'policy', 'Publishing applies to new sign-ups only. Existing subscribers keep their price and limits until you move them. Editing a price never charges anyone.');
end $$;

create or replace function public.platform_publish_plan(_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare _p public.subscription_plans; _vid uuid; _preview jsonb;
begin
  perform public.require_platform_owner();
  select * into _p from public.subscription_plans where id = _plan for update;
  if not found then raise exception 'Plan not found'; end if;
  if _p.status = 'archived' then raise exception 'Archived plans cannot be published'; end if;
  _preview := public.platform_preview_plan(_plan);
  select id into _vid from public.plan_versions where plan_id = _plan and state = 'draft';
  update public.plan_versions set state = 'published', published_by = auth.uid(), published_at = now() where id = _vid;
  update public.subscription_plans set current_version_id = _vid, status = case when status = 'draft' then 'inactive' else status end, updated_at = now() where id = _plan;
  perform public.write_platform_audit('plan.published', 'subscription_plan', _plan::text, _preview || jsonb_build_object('version_id', _vid));
  return _preview || jsonb_build_object('version_id', _vid);
end $$;

create or replace function public.platform_set_plan_status(_plan uuid, _status text) returns void
language plpgsql security definer set search_path = public as $$
declare _p public.subscription_plans;
begin
  perform public.require_platform_owner();
  select * into _p from public.subscription_plans where id = _plan for update;
  if not found then raise exception 'Plan not found'; end if;
  if _status not in ('active','inactive','archived') then raise exception 'Unknown status %', _status; end if;
  if _p.status = 'archived' then raise exception 'Archived plans cannot be changed'; end if;
  if _p.status = _status then return; end if;
  if _status = 'active' and _p.current_version_id is null then raise exception 'Publish the plan before activating it'; end if;
  update public.subscription_plans set status = _status, updated_at = now() where id = _plan;
  perform public.write_platform_audit('plan.status_changed', 'subscription_plan', _plan::text, jsonb_build_object('from', _p.status, 'to', _status));
end $$;

create or replace function public.platform_assign_plan(_business uuid, _plan uuid, _note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare _p public.subscription_plans; v public.plan_versions; s public.subscriptions;
begin
  perform public.require_platform_owner();
  select * into _p from public.subscription_plans where id = _plan;
  if not found or _p.status <> 'active' then raise exception 'Only active plans can be assigned'; end if;
  select * into v from public.plan_versions where id = _p.current_version_id;
  select * into s from public.subscriptions where business_id = _business for update;
  if not found then raise exception 'Business not found'; end if;
  update public.subscriptions set plan_id = _plan, plan_version_id = v.id, status = 'active',
    max_branches = v.max_branches, max_terminals = v.max_terminals, max_staff = v.max_staff, updated_at = now() where business_id = _business;
  insert into public.subscription_events(business_id, event, plan_id, plan_version_id, price_kes, billing_period, max_branches, max_terminals, max_staff, status, note, actor_user_id)
    values (_business, 'plan_assigned', _plan, v.id, v.price_kes, v.billing_period, v.max_branches, v.max_terminals, v.max_staff, 'active', nullif(trim(_note), ''), auth.uid());
  perform public.write_platform_audit('subscription.plan_assigned', 'business', _business::text,
    jsonb_build_object('plan', _p.code, 'version_id', v.id, 'previous_plan_id', s.plan_id, 'previous_status', s.status, 'note', _note));
  return jsonb_build_object('plan', _p.name, 'version_no', v.version_no, 'price_kes', v.price_kes);
end $$;

create or replace function public.platform_move_subscribers(_plan uuid) returns int
language plpgsql security definer set search_path = public as $$
declare _p public.subscription_plans; v public.plan_versions; _n int := 0; r record;
begin
  perform public.require_platform_owner();
  select * into _p from public.subscription_plans where id = _plan;
  if not found or _p.current_version_id is null then raise exception 'Plan has no published version'; end if;
  select * into v from public.plan_versions where id = _p.current_version_id;
  for r in select business_id from public.subscriptions where plan_id = _plan and plan_version_id is distinct from v.id for update loop
    update public.subscriptions set plan_version_id = v.id, max_branches = v.max_branches, max_terminals = v.max_terminals, max_staff = v.max_staff, updated_at = now() where business_id = r.business_id;
    insert into public.subscription_events(business_id, event, plan_id, plan_version_id, price_kes, billing_period, max_branches, max_terminals, max_staff, status, actor_user_id)
      select r.business_id, 'version_moved', _plan, v.id, v.price_kes, v.billing_period, v.max_branches, v.max_terminals, v.max_staff, s.status, auth.uid() from public.subscriptions s where s.business_id = r.business_id;
    _n := _n + 1;
  end loop;
  perform public.write_platform_audit('plan.subscribers_moved', 'subscription_plan', _plan::text, jsonb_build_object('version_id', v.id, 'count', _n));
  return _n;
end $$;

create or replace function public.platform_set_trial_days(_days int) returns void
language plpgsql security definer set search_path = public as $$
declare _old jsonb;
begin
  perform public.require_platform_owner();
  if _days is null or _days < 1 or _days > 90 then raise exception 'Trial must be between 1 and 90 days'; end if;
  select value into _old from public.platform_settings where key = 'trial_days';
  update public.platform_settings set value = to_jsonb(_days), updated_by = auth.uid(), updated_at = now() where key = 'trial_days';
  perform public.write_platform_audit('settings.trial_days', 'platform_setting', 'trial_days', jsonb_build_object('from', _old, 'to', _days));
end $$;

create or replace function public.platform_list_businesses()
returns table(business_id uuid, name text, created_at timestamptz, lifecycle_state public.business_lifecycle, plan_id uuid, plan_name text, version_no int, current_version_no int,
  price_kes numeric, status text, trial_ends_at timestamptz, max_branches int, max_terminals int, max_staff int, branches bigint, staff bigint, terminals bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_platform_owner();
  return query select b.id, b.name, b.created_at, b.lifecycle_state, s.plan_id, p.name, v.version_no, cv.version_no, v.price_kes, s.status, s.trial_ends_at,
    s.max_branches, s.max_terminals, s.max_staff,
    (select count(*) from public.branches x where x.business_id = b.id and x.is_active),
    (select count(*) from public.business_memberships m where m.business_id = b.id and m.status = 'active'),
    (select count(distinct sa.device_id) from public.sales sa where sa.business_id = b.id and sa.device_id is not null and sa.created_at > now() - interval '30 days')
  from public.businesses b join public.subscriptions s on s.business_id = b.id
  left join public.subscription_plans p on p.id = s.plan_id
  left join public.plan_versions v on v.id = s.plan_version_id
  left join public.plan_versions cv on cv.id = p.current_version_id
  order by b.created_at desc;
end $$;

create or replace function public.platform_list_owners()
returns table(user_id uuid, email text, granted_at timestamptz, note text, revoked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_platform_owner();
  return query select a.user_id, u.email::text, a.granted_at, a.note, a.revoked_at from public.platform_admins a left join auth.users u on u.id = a.user_id order by a.granted_at;
end $$;

create or replace function public.platform_grant_owner(_email text, _note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare _uid uuid;
begin
  perform public.require_platform_owner();
  select id into _uid from auth.users where lower(email) = lower(trim(_email));
  if _uid is null then raise exception 'No RONIA account uses that email. Ask them to sign up first.'; end if;
  insert into public.platform_admins(user_id, granted_by, note) values (_uid, auth.uid(), _note)
    on conflict (user_id) do update set revoked_at = null, revoked_by = null, granted_by = auth.uid(), granted_at = now(), note = excluded.note;
  perform public.write_platform_audit('platform.owner_granted', 'platform_admin', _uid::text, jsonb_build_object('note', _note));
  return _uid;
end $$;

create or replace function public.platform_revoke_owner(_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_owner();
  perform 1 from public.platform_admins where revoked_at is null for update;
  if (select count(*) from public.platform_admins where revoked_at is null and user_id <> _user) = 0 then raise exception 'You cannot remove the last platform owner'; end if;
  update public.platform_admins set revoked_at = now(), revoked_by = auth.uid() where user_id = _user and revoked_at is null;
  if not found then raise exception 'Not an active platform owner'; end if;
  perform public.write_platform_audit('platform.owner_revoked', 'platform_admin', _user::text, '{}'::jsonb);
end $$;

-- One-time bootstrap. Callable ONLY by the database operator (never by app users), and only while no platform owner exists.
create or replace function public.bootstrap_platform_owner(_email text, _note text default 'initial bootstrap') returns uuid
language plpgsql security definer set search_path = public as $$
declare _uid uuid;
begin
  perform 1 from public.platform_admins for update;
  if exists (select 1 from public.platform_admins where revoked_at is null) then raise exception 'A platform owner already exists; use platform_grant_owner from the admin area'; end if;
  select id into _uid from auth.users where lower(email) = lower(trim(_email)) and email_confirmed_at is not null;
  if _uid is null then raise exception 'No confirmed RONIA account uses that email'; end if;
  insert into public.platform_admins(user_id, note) values (_uid, _note)
    on conflict (user_id) do update set revoked_at = null, revoked_by = null, granted_at = now(), note = excluded.note;
  insert into public.platform_audit_log(actor_user_id, action, entity_type, entity_id, payload)
    values (null, 'platform.bootstrap', 'platform_admin', _uid::text, jsonb_build_object('note', _note));
  return _uid;
end $$;
revoke all on function public.bootstrap_platform_owner(text,text) from public, anon, authenticated;

revoke all on function public.platform_save_plan(uuid,text,text,text,int), public.platform_save_plan_draft(uuid,numeric,text,int,int,int,jsonb,text),
  public.platform_discard_plan_draft(uuid), public.platform_preview_plan(uuid), public.platform_publish_plan(uuid), public.platform_set_plan_status(uuid,text),
  public.platform_assign_plan(uuid,uuid,text), public.platform_move_subscribers(uuid), public.platform_set_trial_days(int), public.platform_list_businesses(),
  public.platform_list_owners(), public.platform_grant_owner(text,text), public.platform_revoke_owner(uuid) from public, anon;
grant execute on function public.platform_save_plan(uuid,text,text,text,int), public.platform_save_plan_draft(uuid,numeric,text,int,int,int,jsonb,text),
  public.platform_discard_plan_draft(uuid), public.platform_preview_plan(uuid), public.platform_publish_plan(uuid), public.platform_set_plan_status(uuid,text),
  public.platform_assign_plan(uuid,uuid,text), public.platform_move_subscribers(uuid), public.platform_set_trial_days(int), public.platform_list_businesses(),
  public.platform_list_owners(), public.platform_grant_owner(text,text), public.platform_revoke_owner(uuid) to authenticated;

-- Initial editable plan defaults (configuration, changeable from the admin area without code changes).
insert into public.subscription_plans(code, name, description, status, sort_order) values
  ('starter', 'Starter', 'One shop, one till', 'active', 1),
  ('business', 'Business', 'Growing shops with a few branches', 'active', 2),
  ('growth', 'Growth', 'Larger multi-branch businesses', 'active', 3);
insert into public.plan_versions(plan_id, version_no, state, price_kes, billing_period, max_branches, max_terminals, max_staff, features, change_note, published_at)
  select p.id, 1, 'published', d.price, 'month', d.br, d.ti, d.st,
    '{"deni":true,"mpesa":true,"etims":true,"purchasing":true,"reports_export":true}'::jsonb, 'Initial default', now()
  from public.subscription_plans p join (values ('starter', 999, 1, 1, 3), ('business', 2499, 3, 5, 10), ('growth', 4999, 10, 15, 30)) d(code, price, br, ti, st) on d.code = p.code;
update public.subscription_plans sp set current_version_id = v.id from public.plan_versions v where v.plan_id = sp.id and v.version_no = 1;