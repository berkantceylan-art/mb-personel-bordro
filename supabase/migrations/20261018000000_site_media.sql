-- =====================================================================
-- Web sitesi: medya kütüphanesi
--
-- site-media deposundaki her dosyanın kaydı (alt metin, ölçü, boyut).
-- Admin panelinden yüklenen dosyalar uygulama tarafından buraya kaydedilir.
-- Kütüphane yalnız site editörlerine görünür; sitede dosyalar doğrudan
-- depodan (herkese açık adres) gösterilir.
-- =====================================================================

create table cms_media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique check (path ~ '^[a-z0-9-]+/[^/]+$'),
  mime text,
  size bigint,
  width integer,
  height integer,
  title text,
  alt jsonb not null default '{}'::jsonb check (is_i18n_text(alt)),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on cms_media (created_at desc);

create trigger cms_media_touch before update on cms_media for each row execute function cms_touch();

alter table cms_media enable row level security;
create policy cms_media_editor_all on cms_media for all to authenticated
  using (can_manage_site()) with check (can_manage_site());
grant select, insert, update, delete on cms_media to authenticated;

-- Depoda hâlihazırda duran dosyaları kütüphaneye al
insert into cms_media (path, mime, size, created_at, created_by, updated_by)
select o.name, o.metadata->>'mimetype', nullif(o.metadata->>'size', '')::bigint, o.created_at, o.owner, o.owner
from storage.objects o
where o.bucket_id = 'site-media' and o.name ~ '^[a-z0-9-]+/[^/]+$'
on conflict (path) do nothing;

-- Eski sitedeki .mov videolar ve GIF'ler de yüklenebilsin
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml', 'video/mp4', 'video/webm', 'video/quicktime']
where id = 'site-media';
