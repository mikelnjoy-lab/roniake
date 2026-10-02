-- Root cause: branches SELECT policy called can_access_branch(id), which re-reads public.branches.
-- During INSERT ... RETURNING the new row is not yet visible to that STABLE function's snapshot,
-- so the RETURNING check failed. Evaluate access from the row's own columns instead.
create or replace function public.can_access_branch_row(_business uuid, _branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_memberships m
    join public.businesses b on b.id = m.business_id and b.lifecycle_state <> 'closed'
    where m.business_id = _business and m.user_id = auth.uid() and m.status = 'active'
      and (m.role in ('owner','manager','auditor') or m.all_branches
           or exists (select 1 from public.membership_branches mb where mb.membership_id = m.id and mb.branch_id = _branch))
  )
$$;
revoke execute on function public.can_access_branch_row(uuid,uuid) from public, anon;
grant execute on function public.can_access_branch_row(uuid,uuid) to authenticated;

create or replace function public.can_access_branch(_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_access_branch_row(br.business_id, br.id) from public.branches br where br.id = _branch), false)
$$;

drop policy "branch visible if accessible" on public.branches;
create policy "branch visible if accessible" on public.branches for select to authenticated
  using (public.can_access_branch_row(business_id, id));
