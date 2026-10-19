create table public.branch_receipt_settings (
  branch_id uuid primary key references public.branches(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  version int not null default 1,
  display_name text check (display_name is null or length(display_name) <= 80),
  phone text check (phone is null or length(phone) <= 40),
  address text check (address is null or length(address) <= 160),
  footer text check (footer is null or length(footer) <= 300),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  show_logo boolean not null default false,
  show_phone boolean not null default true,
  show_address boolean not null default true,
  show_cashier boolean not null default false,
  show_footer boolean not null default true,
  paper_width int not null default 80 check (paper_width in (58, 80)),
  auto_print boolean not null default false,
  copies int not null default 1 check (copies between 1 and 3),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.branch_receipt_settings to authenticated;
grant all on public.branch_receipt_settings to service_role;
alter table public.branch_receipt_settings enable row level security;
create policy "branch members read receipt settings" on public.branch_receipt_settings
  for select to authenticated using (public.can_access_branch_row(business_id, branch_id));

insert into public.branch_receipt_settings(branch_id, business_id, display_name, address)
select id, business_id, name, physical_address from public.branches
on conflict do nothing;

create or replace function public.branch_receipt_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.branch_receipt_settings(branch_id, business_id, display_name, address)
  values (new.id, new.business_id, new.name, new.physical_address) on conflict do nothing;
  return new;
end $$;
create trigger branch_receipt_default after insert on public.branches
  for each row execute function public.branch_receipt_default();

create or replace function public.save_branch_receipt_settings(_branch uuid, _s jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare _biz uuid; _v int;
begin
  _biz := public.branch_business_checked(_branch, 'branch.manage');
  update public.branch_receipt_settings set
    display_name = nullif(trim(_s->>'display_name'), ''),
    phone = nullif(trim(_s->>'phone'), ''),
    address = nullif(trim(_s->>'address'), ''),
    footer = nullif(trim(_s->>'footer'), ''),
    logo_url = nullif(trim(_s->>'logo_url'), ''),
    show_logo = coalesce((_s->>'show_logo')::boolean, false),
    show_phone = coalesce((_s->>'show_phone')::boolean, true),
    show_address = coalesce((_s->>'show_address')::boolean, true),
    show_cashier = coalesce((_s->>'show_cashier')::boolean, false),
    show_footer = coalesce((_s->>'show_footer')::boolean, true),
    paper_width = coalesce((_s->>'paper_width')::int, 80),
    auto_print = coalesce((_s->>'auto_print')::boolean, false),
    copies = coalesce((_s->>'copies')::int, 1),
    version = version + 1, updated_by = auth.uid(), updated_at = now()
  where branch_id = _branch and business_id = _biz
  returning version into _v;
  if _v is null then raise exception 'Receipt settings not found for branch'; end if;
  perform public.write_audit(_biz, _branch, 'branch.receipt_settings_updated', 'branch', _branch::text, _s || jsonb_build_object('version', _v), null);
  return _v;
end $$;
revoke execute on function public.save_branch_receipt_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_branch_receipt_settings(uuid, jsonb) to authenticated;
revoke execute on function public.branch_receipt_default() from public, anon, authenticated;

-- Historical snapshot: frozen onto each sale when posted.
alter table public.sales add column receipt_snapshot jsonb;
create or replace function public.sale_receipt_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select to_jsonb(s) - 'updated_by' - 'business_id' - 'branch_id' into new.receipt_snapshot
  from public.branch_receipt_settings s where s.branch_id = new.branch_id;
  return new;
end $$;
create trigger sale_receipt_snapshot before insert on public.sales
  for each row execute function public.sale_receipt_snapshot();
revoke execute on function public.sale_receipt_snapshot() from public, anon, authenticated;