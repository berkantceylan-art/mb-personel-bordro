-- =====================================================================
-- Web sitesi: site ayarları ve gelen kutusu
--
-- site_settings: tek satırlık ayar kaydı (iletişim, sosyal medya, SEO...).
--   Herkes okuyabilir (sitede gösterilen bilgiler), yalnız editörler yazar.
-- cms_messages: sitedeki iletişim / vaka formlarından gelen mesajlar.
--   Ziyaretçi yalnız submit_site_message() ile yazabilir (doğrulama + hız sınırı);
--   okuma/yönetme yalnız editörler.
-- =====================================================================

create table site_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
insert into site_settings (id) values (1) on conflict do nothing;

create trigger site_settings_touch before update on site_settings for each row execute function cms_touch();
create trigger audit_site_settings after insert or update or delete on site_settings for each row execute function audit_trigger();

alter table site_settings enable row level security;
create policy site_settings_public_read on site_settings for select to anon, authenticated using (true);
create policy site_settings_editor_write on site_settings for update to authenticated
  using (can_manage_site()) with check (can_manage_site());
grant select on site_settings to anon, authenticated;
grant update on site_settings to authenticated;

-- ---------------------------------------------------------------------
-- Gelen kutusu
-- ---------------------------------------------------------------------
create type cms_message_status as enum ('new', 'read', 'archived');
create type cms_message_topic as enum ('general', 'case', 'price', 'partner');

create table cms_messages (
  id uuid primary key default gen_random_uuid(),
  topic cms_message_topic not null default 'general',
  status cms_message_status not null default 'new',
  name text not null check (length(name) between 1 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  company text check (company is null or length(company) <= 160),
  country text check (country is null or length(country) <= 80),
  message text not null check (length(message) between 1 and 5000),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  locale text check (locale in ('tr', 'en', 'fr')),
  page text check (page is null or length(page) <= 300),
  ip_hash text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on cms_messages (status, created_at desc);
create index on cms_messages (ip_hash, created_at desc);

create trigger cms_messages_touch before update on cms_messages for each row execute function cms_touch();

alter table cms_messages enable row level security;
create policy cms_messages_editor_all on cms_messages for all to authenticated
  using (can_manage_site()) with check (can_manage_site());
grant select, update, delete on cms_messages to authenticated;

-- Ziyaretçi mesajı: doğrulama + aynı adresten 10 dakikada en fazla 5 mesaj
create or replace function submit_site_message(
  p_topic text, p_name text, p_email text, p_phone text, p_company text, p_country text,
  p_message text, p_meta jsonb, p_locale text, p_page text, p_ip_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_recent int;
begin
  if p_ip_hash is not null then
    select count(*) into v_recent from cms_messages
      where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
    if v_recent >= 5 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;
  insert into cms_messages (topic, name, email, phone, company, country, message, meta, locale, page, ip_hash)
  values (
    case when p_topic in ('general', 'case', 'price', 'partner') then p_topic::cms_message_topic else 'general' end,
    left(trim(p_name), 120), left(trim(p_email), 200),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''), nullif(left(trim(coalesce(p_company, '')), 160), ''),
    nullif(left(trim(coalesce(p_country, '')), 80), ''), left(trim(p_message), 5000),
    case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end,
    case when p_locale in ('tr', 'en', 'fr') then p_locale else null end,
    left(p_page, 300), left(p_ip_hash, 64)
  ) returning id into v_id;
  return v_id;
end $$;
revoke execute on function submit_site_message(text, text, text, text, text, text, text, jsonb, text, text, text) from public;
grant execute on function submit_site_message(text, text, text, text, text, text, text, jsonb, text, text, text) to anon, authenticated;

-- Okunmamış mesaj sayısı (admin menüsü için)
create or replace function cms_unread_messages() returns integer
language sql stable security invoker set search_path = public as $$
  select count(*)::int from cms_messages where status = 'new';
$$;
grant execute on function cms_unread_messages() to authenticated;
