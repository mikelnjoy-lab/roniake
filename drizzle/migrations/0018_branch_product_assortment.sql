create table public.branch_products (
  business_id uuid not null references public.businesses(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id)
);
create index branch_products_product_idx on public.branch_products(product_id);
grant select on public.branch_products to authenticated;
grant all on public.branch_products to service_role;
alter table public.branch_products enable row level security;
create policy "branch assortment visible to branch users" on public.branch_products
  for select to authenticated using (public.can_access_branch_row(business_id, branch_id));

-- Backfill: products with stock rows are enabled where stocked; products never stocked anywhere stay enabled in all branches (preserves prior behaviour for untracked items).
insert into public.branch_products(business_id, branch_id, product_id, enabled)
select bs.business_id, bs.branch_id, bs.product_id, true from public.branch_stock bs
on conflict do nothing;
insert into public.branch_products(business_id, branch_id, product_id, enabled)
select p.business_id, b.id, p.id, true from public.products p join public.branches b on b.business_id = p.business_id
where not exists (select 1 from public.branch_stock s where s.product_id = p.id)
on conflict do nothing;

create or replace function public.set_branch_product(_branch uuid, _product uuid, _enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _biz uuid;
begin
  _biz := public.branch_business_checked(_branch, 'catalog.manage');
  perform public.product_in_business(_product, _biz);
  insert into public.branch_products(business_id, branch_id, product_id, enabled, updated_by, updated_at)
  values (_biz, _branch, _product, _enabled, auth.uid(), now())
  on conflict (branch_id, product_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  perform public.write_audit(_biz, _branch, case when _enabled then 'branch_product.enabled' else 'branch_product.disabled' end,
    'product', _product::text, jsonb_build_object('enabled', _enabled), null);
end $$;
revoke all on function public.set_branch_product(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_branch_product(uuid, uuid, boolean) to authenticated;

-- Receiving stock into a branch is an explicit stocking decision: enable it there (never in other branches).
create or replace function public.branch_stock_enables_product() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.branch_products(business_id, branch_id, product_id, enabled, updated_by)
  values (new.business_id, new.branch_id, new.product_id, true, auth.uid())
  on conflict do nothing;
  return new;
end $$;
create trigger branch_stock_enables_product after insert on public.branch_stock
  for each row execute function public.branch_stock_enables_product();

-- Server-side sale guard: a product must be enabled in the sale's branch.
create or replace function public.sale_line_assortment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare _branch uuid;
begin
  select branch_id into _branch from public.sales where id = new.sale_id;
  if not exists (select 1 from public.branch_products bp where bp.branch_id = _branch and bp.product_id = new.product_id and bp.enabled) then
    raise exception 'PRODUCT_NOT_IN_BRANCH: % is not sold in this branch', new.product_name using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sale_line_assortment_guard before insert on public.sale_lines
  for each row execute function public.sale_line_assortment_guard();

-- POS list: active products enabled in the branch, only for users with access to that branch.
create or replace function public.branch_catalog(_branch uuid)
returns setof public.products language sql stable security definer set search_path = public as $$
  select p.* from public.products p
  join public.branches b on b.id = _branch and b.business_id = p.business_id
  join public.branch_products bp on bp.branch_id = _branch and bp.product_id = p.id and bp.enabled
  where p.is_active and public.can_access_branch_row(b.business_id, _branch)
  order by p.name
$$;
revoke all on function public.branch_catalog(uuid) from public, anon;
grant execute on function public.branch_catalog(uuid) to authenticated;