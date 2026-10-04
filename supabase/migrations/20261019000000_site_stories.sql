-- =====================================================================
-- Web sitesi: hikâyeler (anasayfada Instagram tarzı kısa içerikler)
--
-- Her hikâye bir ya da daha çok kareden oluşur. Kareler sıralı bir dizi:
--   [{"path": "medya/<uuid>-video.mp4", "caption": {"tr": "...", "en": "..."}}]
-- path: site-media deposundaki dosya (görsel ya da video).
-- =====================================================================

create or replace function is_story_frames(v jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(v) = 'array'
    and jsonb_array_length(v) <= 30
    and not exists (
      select 1 from jsonb_array_elements(v) f
      where jsonb_typeof(f) <> 'object'
         or jsonb_typeof(f->'path') <> 'string'
         or not is_i18n_text(coalesce(f->'caption', '{}'::jsonb))
    );
$$;

create table cms_stories (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null default '{}'::jsonb check (is_i18n_text(title)),
  cover_path text,
  frames jsonb not null default '[]'::jsonb check (is_story_frames(frames)),
  link_href text check (link_href is null or link_href ~ '^(/|https://)'),
  link_label jsonb not null default '{}'::jsonb check (is_i18n_text(link_label)),
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
create index on cms_stories (sort) where deleted_at is null;

create trigger cms_stories_touch before update on cms_stories for each row execute function cms_touch();
create trigger audit_cms_stories after insert or update or delete on cms_stories for each row execute function audit_trigger();

alter table cms_stories enable row level security;
create policy cms_stories_public_read on cms_stories for select to anon, authenticated
  using (
    deleted_at is null and is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );
create policy cms_stories_editor_all on cms_stories for all to authenticated
  using (can_manage_site()) with check (can_manage_site());
grant select on cms_stories to anon;
grant select, insert, update, delete on cms_stories to authenticated;

-- Çöp kutusu temizliği hikâyeleri de kapsasın
create or replace function cms_purge_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  delete from cms_slides where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_announcements where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_products where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_stories where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke execute on function cms_purge_trash() from public, anon, authenticated;
