alter table public.branch_receipt_settings
  add column show_business_name boolean not null default true,
  add column show_branch_name boolean not null default true;

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
    show_business_name = coalesce((_s->>'show_business_name')::boolean, true),
    show_branch_name = coalesce((_s->>'show_branch_name')::boolean, true),
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