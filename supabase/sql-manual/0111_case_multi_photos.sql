-- 0111 — several photos per case-taking slot (30 Oct 2026)
--
-- Case-taking doctor: "sirf ek hi picture upload ho rahi hai" — a case paper
-- often runs to 2-3 pages, reports to several sheets. Each slot now keeps a
-- list of photos. The single *_photo_url columns stay (= the first photo) so
-- every older reader keeps working; existing photos are copied into the lists.
alter table public.visits add column if not exists case_photo_urls text[];
alter table public.visits add column if not exists tongue_photo_urls text[];
alter table public.visits add column if not exists reports_photo_urls text[];

update public.visits set case_photo_urls = array[case_photo_url]
  where case_photo_url is not null and case_photo_url <> '' and case_photo_urls is null;
update public.visits set tongue_photo_urls = array[tongue_photo_url]
  where tongue_photo_url is not null and tongue_photo_url <> '' and tongue_photo_urls is null;
update public.visits set reports_photo_urls = array[reports_photo_url]
  where reports_photo_url is not null and reports_photo_url <> '' and reports_photo_urls is null;

insert into schema_migrations (filename, notes) values
  ('0111_case_multi_photos', 'visits.case/tongue/reports_photo_urls text[] — several photos per case-taking slot')
on conflict (filename) do nothing;
