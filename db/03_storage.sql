-- =============================================================================
--  APA ENGINEERING SERVICES - PROJECT MANAGEMENT SYSTEM
--  File 03 of 04 : STORAGE BUCKETS AND POLICIES
--
--  Three private buckets are created. Files are uploaded by the Express server
--  (which forwards the signed-in user's token) and are read back through
--  short-lived signed URLs, never through a public URL.
--
--    site-plans       : client site / floor plans  (PDF, JPG, PNG - max 5 MB)
--    progress-photos  : site progress photos       (JPG, PNG, WEBP - max 5 MB)
--    attachments      : quotations and other docs  (PDF, images, Office - max 10 MB)
--
--  Object path convention enforced by the policies:
--      <bucket>/<auth.uid()>/<timestamp>-<filename>
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BUCKETS
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('site-plans', 'site-plans', false, 5242880,
    array['application/pdf', 'image/jpeg', 'image/png']),
  ('progress-photos', 'progress-photos', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('attachments', 'attachments', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 2. POLICIES ON storage.objects
--    Uploads must land inside a folder named after the uploader's user id, so a
--    user can never overwrite or probe another user's folder.
-- -----------------------------------------------------------------------------
drop policy if exists apa_storage_read on storage.objects;
create policy apa_storage_read
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('site-plans', 'progress-photos', 'attachments')
    and public.is_staff_or_admin()
  );

drop policy if exists apa_storage_upload_own_folder on storage.objects;
create policy apa_storage_upload_own_folder
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('site-plans', 'progress-photos', 'attachments')
    and public.is_staff_or_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists apa_storage_update_own on storage.objects;
create policy apa_storage_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('site-plans', 'progress-photos', 'attachments')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  )
  with check (
    bucket_id in ('site-plans', 'progress-photos', 'attachments')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists apa_storage_delete on storage.objects;
create policy apa_storage_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('site-plans', 'progress-photos', 'attachments')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- =============================================================================
--  END OF 03_storage.sql  --  next: run 04_seed.sql
-- =============================================================================
