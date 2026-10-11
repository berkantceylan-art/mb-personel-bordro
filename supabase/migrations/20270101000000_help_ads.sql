-- =====================================================================
-- YARDIM MERKEZİ, GÜNCELLEME DUYURULARI, VİDEOLAR VE ANA SAYFA REKLAMLARI
--  cms_announcement_kind 'update' : güncelleme duyurusu (sitede Yardım › Yenilikler ve portalda bildirim + üst bant)
--  cms_slides.builtin             : sitede kodla çizilen hazır reklam ('portal-promo', 'portal-tracking'); görsel gerekmez
--  cms_slides.locales             : reklamın gösterileceği diller (boş = hepsi)
--  cms_help_videos                : Yardım sayfasındaki kullanım videoları (yüklenen mp4 ya da YouTube/Vimeo linki), hesap türüne göre
--  Hazır iki reklam eklenir ("vakanızı sistemden gönderin"); ERP › Site içerikleri'nden durdurulabilir, tarihlenebilir.
-- Tekrar çalıştırılabilir. Önce 20261016000000_site_cms.sql ve 20261129000000_site_growth.sql.
-- Not: Supabase SQL Editor'de tek seferde çalıştırılabilir ('update' değeri bu dosyada kullanılmaz).
-- =====================================================================

alter type cms_announcement_kind add value if not exists 'update';

alter table cms_slides add column if not exists builtin text;
alter table cms_slides add column if not exists locales text[] not null default '{}';
do $$ begin
  alter table cms_slides add constraint cms_slides_builtin_check check (builtin is null or builtin in ('portal-promo', 'portal-tracking'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cms_slides add constraint cms_slides_locales_check check (locales <@ array['tr', 'en', 'fr']::text[]);
exception when duplicate_object then null; end $$;
create unique index if not exists cms_slides_builtin_uq on cms_slides (builtin) where builtin is not null;

-- Hazır reklamlar (kodla çizilir; başlık boş kalırsa sitedeki varsayılan metin kullanılır)
insert into cms_slides (placement, builtin, button_href, sort, is_active)
select 'home', b, '/portal/kayit', s, true from (values ('portal-promo', -20), ('portal-tracking', -10)) v(b, s)
where not exists (select 1 from cms_slides x where x.builtin = v.b);

-- Yardım videoları
create table if not exists cms_help_videos (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null default '{}'::jsonb check (is_i18n_text(title)),
  description jsonb not null default '{}'::jsonb check (is_i18n_text(description)),
  target_types text[] not null default '{}' check (target_types <@ array['doctor_tr', 'doctor_foreign', 'clinic', 'agency']::text[]),
  video_path text check (video_path is null or length(video_path) <= 300),        -- site-media içindeki dosya
  video_url text check (video_url is null or video_url ~ '^https://'),            -- YouTube / Vimeo
  poster_path text check (poster_path is null or length(poster_path) <= 300),
  sort integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (video_path is not null or video_url is not null)
);
drop trigger if exists cms_help_videos_touch on cms_help_videos;
create trigger cms_help_videos_touch before update on cms_help_videos for each row execute function cms_touch();
drop trigger if exists audit_cms_help_videos on cms_help_videos;
create trigger audit_cms_help_videos after insert or update or delete on cms_help_videos for each row execute function audit_trigger();
alter table cms_help_videos enable row level security;
drop policy if exists cms_help_videos_public_read on cms_help_videos;
create policy cms_help_videos_public_read on cms_help_videos for select to anon, authenticated using (is_active and deleted_at is null);
drop policy if exists cms_help_videos_editor_all on cms_help_videos;
create policy cms_help_videos_editor_all on cms_help_videos for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_help_videos to anon;
grant select, insert, update, delete on cms_help_videos to authenticated;

notify pgrst, 'reload schema';
