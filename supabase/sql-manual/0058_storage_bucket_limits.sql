-- RF-19: neither storage bucket had a server-side file-size or MIME-type
-- limit. Every upload path in the app (uploadCasePhoto, uploadPatientDocument)
-- goes through compressImageForUpload first, which only compresses files it
-- recognizes as image/* (or HEIC) — anything else is uploaded raw, as-is,
-- with nothing at the DB layer to stop it. Client `<input accept="image/*">`
-- is a UI hint only, not enforcement. Both buckets are private (already
-- confirmed live) and every real object stored today is already
-- image/jpeg under 400KB (post-compression) — these limits match that
-- actual usage with generous headroom for the compression-failure fallback
-- path (raw phone-camera JPEG/HEIC can run 10-20MB).
update storage.buckets
set file_size_limit = 20971520, -- 20 MiB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id in ('case-photos', 'patient-documents');

insert into schema_migrations (filename, notes) values
  ('0058_storage_bucket_limits', 'RF-19: 20MiB file-size cap + image-only MIME allowlist on case-photos and patient-documents buckets')
on conflict (filename) do nothing;
