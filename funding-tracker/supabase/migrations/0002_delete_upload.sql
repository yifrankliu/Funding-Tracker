-- Delete an upload (and its allocations). If it had superseded an earlier upload for the
-- same source/year/period, that earlier upload becomes accepted again.
-- Admins may delete any upload; officers may delete uploads for their own sources.

drop policy if exists "uploads: admins delete" on public.uploads;
create policy "uploads: delete own sources"
  on public.uploads for delete to authenticated
  using (public.can_write_source(source_id));

drop policy if exists "allocations: admins delete" on public.allocations;
create policy "allocations: delete own sources"
  on public.allocations for delete to authenticated
  using (public.can_write_source(source_id));

create policy "uploads bucket: officers+admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and public.can_edit_clubs());

create or replace function public.delete_upload(p_upload_id uuid)
returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_up        public.uploads%rowtype;
  v_prev_id   uuid;
begin
  select * into v_up from public.uploads where id = p_upload_id;
  if not found then
    raise exception 'Upload not found';
  end if;
  if not public.can_write_source(v_up.source_id) then
    raise exception 'You do not have permission to delete uploads for this funding source';
  end if;

  -- Restore the most recent upload this one had superseded, if any.
  if v_up.status = 'accepted' then
    select id into v_prev_id
      from public.uploads
     where superseded_by = p_upload_id
     order by created_at desc
     limit 1;
    if v_prev_id is not null then
      update public.uploads set status = 'accepted', superseded_by = null where id = v_prev_id;
    end if;
  end if;

  -- Anything that pointed at this upload as its successor now points nowhere.
  update public.uploads set superseded_by = null where superseded_by = p_upload_id and id <> coalesce(v_prev_id, p_upload_id);

  delete from public.uploads where id = p_upload_id;   -- allocations cascade
  return v_up.storage_path;
end;
$$;
