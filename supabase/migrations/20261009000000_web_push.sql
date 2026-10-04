-- =====================================================================
-- Migration 7: Telefonda web uygulaması (PWA) için bildirimler
-- Ana ekrana eklenen web uygulamasına (iPhone iOS 16.4+, Android) push gönderilir.
-- =====================================================================

-- Web uygulamasının adresi (alan adı değişirse yalnız burayı güncelleyin)
create or replace function app_base_url() returns text language sql immutable as $$
  select 'https://mb-personel-bordro.vercel.app'::text;
$$;

create table if not exists web_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists web_push_subscriptions_user on web_push_subscriptions (user_id);
alter table web_push_subscriptions enable row level security;
drop policy if exists wps_own on web_push_subscriptions;
create policy wps_own on web_push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mesaj bildirimleri listede görünmez (silent), ama telefona gider; pushed_at tekrar gönderimi engeller
alter table notifications add column if not exists silent boolean not null default false;
alter table notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unread on notifications (user_id) where read_at is null and not silent;

create or replace function deliver(p_company uuid, p_users uuid[], p_title text, p_body text, p_link text, p_store boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare targets uuid[];
begin
  select coalesce(array_agg(distinct u), '{}') into targets
  from unnest(coalesce(p_users, '{}')) u
  where u is not null and u is distinct from auth.uid();
  if cardinality(targets) = 0 then return; end if;
  insert into notifications (company_id, user_id, title, body, link, silent)
  select p_company, u, p_title, left(coalesce(p_body, ''), 300), p_link, not p_store from unnest(targets) u;
  perform push_to(targets, p_title, left(coalesce(p_body, ''), 180), p_link);  -- Expo (mağaza uygulaması) için
end $$;
revoke execute on function deliver(uuid, uuid[], text, text, text, boolean) from public, anon, authenticated;

-- Yeni bildirim → web uygulamasının /api/push servisine haber ver (servis service_role ile okuyup gönderir)
create or replace function trg_notification_webpush() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from web_push_subscriptions where user_id = new.user_id) then
    begin
      execute 'select net.http_post(url := $1, body := $2, headers := $3)'
        using app_base_url() || '/api/push', jsonb_build_object('id', new.id), '{"Content-Type": "application/json"}'::jsonb;
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists notifications_webpush on notifications;
create trigger notifications_webpush after insert on notifications for each row execute function trg_notification_webpush();
