-- =====================================================================
-- Web sitesi içerik yönetimi (admin paneli): slaytlar ve duyurular
--
-- Çok dilli alanlar jsonb olarak tutulur: {"tr": "...", "en": "...", "fr": "..."}
-- Silme önce çöp kutusuna (deleted_at) yapılır; 30 gün sonra kalıcı silinir.
-- Herkese açık okuma: sadece yayında + tarih aralığında + çöpte olmayan kayıtlar.
-- Yazma: owner veya site_editor rolündeki kullanıcılar.
-- =====================================================================

create or replace function can_manage_site()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.role in ('owner', 'site_editor')
  );
$$;

-- Çok dilli metin alanı doğrulaması: sadece tr/en/fr anahtarları, değerler metin
create or replace function is_i18n_text(v jsonb)
returns boolean language sql immutable as $$
  select v is null or (
    jsonb_typeof(v) = 'object'
    and not exists (
      select 1 from jsonb_each(v) e
      where e.key not in ('tr', 'en', 'fr') or jsonb_typeof(e.value) not in ('string', 'null')
    )
  );
$$;

create or replace function cms_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Slaytlar
-- ---------------------------------------------------------------------
create table cms_slides (
  id uuid primary key default gen_random_uuid(),
  placement text not null default 'home' check (placement ~ '^[a-z0-9-]{1,40}$'),
  title jsonb not null default '{}'::jsonb check (is_i18n_text(title)),
  subtitle jsonb not null default '{}'::jsonb check (is_i18n_text(subtitle)),
  button_label jsonb not null default '{}'::jsonb check (is_i18n_text(button_label)),
  button_href text check (button_href is null or button_href ~ '^(/|https://)'),
  image_path text,          -- site-media bucket içindeki yol (masaüstü)
  image_mobile_path text,   -- isteğe bağlı mobil görsel
  video_path text,          -- isteğe bağlı arka plan videosu
  sort integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index on cms_slides (placement, sort) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Duyurular
-- ---------------------------------------------------------------------
create type cms_announcement_kind as enum ('banner', 'popup', 'news');
create type cms_audience as enum ('public', 'portal');

create table cms_announcements (
  id uuid primary key default gen_random_uuid(),
  kind cms_announcement_kind not null default 'banner',
  audience cms_audience not null default 'public',
  title jsonb not null default '{}'::jsonb check (is_i18n_text(title)),
  body jsonb not null default '{}'::jsonb check (is_i18n_text(body)),
  link_href text check (link_href is null or link_href ~ '^(/|https://)'),
  image_path text,
  priority integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index on cms_announcements (kind, priority desc) where deleted_at is null;

create trigger cms_slides_touch before update on cms_slides for each row execute function cms_touch();
create trigger cms_announcements_touch before update on cms_announcements for each row execute function cms_touch();
create trigger audit_cms_slides after insert or update or delete on cms_slides for each row execute function audit_trigger();
create trigger audit_cms_announcements after insert or update or delete on cms_announcements for each row execute function audit_trigger();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table cms_slides enable row level security;
alter table cms_announcements enable row level security;

create policy cms_slides_public_read on cms_slides for select to anon, authenticated
  using (
    deleted_at is null and is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );
create policy cms_slides_editor_all on cms_slides for all to authenticated
  using (can_manage_site()) with check (can_manage_site());

create policy cms_announcements_public_read on cms_announcements for select to anon, authenticated
  using (
    deleted_at is null and is_active and audience = 'public'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );
create policy cms_announcements_editor_all on cms_announcements for all to authenticated
  using (can_manage_site()) with check (can_manage_site());

grant select on cms_slides, cms_announcements to anon;
grant select, insert, update, delete on cms_slides, cms_announcements to authenticated;

-- ---------------------------------------------------------------------
-- Medya deposu (herkese açık okuma, editör yazma)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

create policy "site_media_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and can_manage_site());
create policy "site_media_update" on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and can_manage_site());
create policy "site_media_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and can_manage_site());

-- ---------------------------------------------------------------------
-- Çöp kutusu temizliği: 30 günden eski silinmiş kayıtları kalıcı sil
-- (mevcut zamanlanmış görevler pg_cron ile çalışıyorsa buraya bağlanır)
-- ---------------------------------------------------------------------
create or replace function cms_purge_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  delete from cms_slides where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_announcements where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke execute on function cms_purge_trash() from public, anon, authenticated;
