create or replace function public.storage_path_project_id(objname text)
returns uuid
language sql
stable
as $$
  select case
    when objname like 'projects/%' then nullif(split_part(objname, '/', 2), '')::uuid
    else null
  end
$$;

create or replace function public.can_read_checklist_attachment(objname text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where (
        p.id = public.storage_path_project_id(objname)
        or p.id = (
          select ci.project_id from public.checklist_items ci
          where ci.id::text = split_part(objname, '/', 1)
        )
      )
      and (
        p.tenant_id = public.get_user_tenant_id(auth.uid())
        or public.get_user_role(auth.uid()) in ('super_admin', 'superadmin')
      )
  )
$$;

create or replace function public.can_read_merchant_portal_file(objname text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id::text = split_part(objname, '/', 1)
      and (
        p.tenant_id = public.get_user_tenant_id(auth.uid())
        or public.get_user_role(auth.uid()) in ('super_admin', 'superadmin')
      )
  )
$$;

revoke execute on function public.can_read_checklist_attachment(text) from anon;
revoke execute on function public.can_read_merchant_portal_file(text) from anon;
revoke execute on function public.storage_path_project_id(text) from anon;

drop policy if exists "Signed-in users read BRD exports" on storage.objects;
drop policy if exists "Signed-in users read checklist attachments" on storage.objects;
drop policy if exists "Signed-in users read merchant portal files" on storage.objects;

create policy "Owners read BRD exports"
on storage.objects for select to authenticated
using (bucket_id = 'brd-exports' and owner = auth.uid());

create policy "Tenant members read checklist attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'checklist-attachments'
  and (owner = auth.uid() or public.can_read_checklist_attachment(name))
);

create policy "Tenant members read merchant portal files"
on storage.objects for select to authenticated
using (
  bucket_id = 'merchant-portal-files'
  and (owner = auth.uid() or public.can_read_merchant_portal_file(name))
);