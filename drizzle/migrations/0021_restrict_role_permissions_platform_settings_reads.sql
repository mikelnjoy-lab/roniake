drop policy if exists "permissions readable" on public.role_permissions;
create policy "permissions readable for own roles" on public.role_permissions
  for select to authenticated
  using (exists (
    select 1 from public.business_memberships m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = role_permissions.role
  ));

drop policy if exists "platform settings read" on public.platform_settings;
create policy "platform settings read by platform owners" on public.platform_settings
  for select to authenticated
  using (public.is_platform_owner());