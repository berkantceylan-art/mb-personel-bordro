-- Bildirim tercihleri (kategori bazında telefon bildirimi kapatma), uzaktan oturum kapatma, büyük yazı tercihi

create table if not exists notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push boolean not null default true,              -- telefon bildirimi genel
  -- kapatılan kategoriler: talep, odeme, puantaj, duyuru, mesaj, zimmet, diger
  muted text[] not null default '{}',
  big_text boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table notification_prefs enable row level security;
drop policy if exists np_self on notification_prefs;
create policy np_self on notification_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bağlantıdan kategori
create or replace function notif_category(p_link text) returns text language sql immutable as $$
  select case
    when p_link like '/benim/hareketler%' or p_link like '/benim/bordro%' then 'odeme'
    when p_link like '/benim/puantaj%' or p_link like '/puantaj%' then 'puantaj'
    when p_link like '/duyurular%' then 'duyuru'
    when p_link like '/mesajlar%' then 'mesaj'
    when p_link like '/benim/zimmet%' or p_link like '/zimmet%' then 'zimmet'
    when p_link like '/talepler%' or p_link like '/benim%' or p_link like '/fazla-mesai%' or p_link like '/yemek%' then 'talep'
    else 'diger' end;
$$;

-- deliver: tercihlerine göre telefon bildirimi gitmeyenler listede yine görünür (pushed_at önceden dolu)
create or replace function deliver(p_company uuid, p_users uuid[], p_title text, p_body text, p_link text, p_store boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare targets uuid[]; push_targets uuid[]; cat text := notif_category(p_link);
begin
  select coalesce(array_agg(distinct u), '{}') into targets
  from unnest(coalesce(p_users, '{}')) u
  where u is not null and u is distinct from auth.uid();
  if cardinality(targets) = 0 then return; end if;
  select coalesce(array_agg(u), '{}') into push_targets
  from unnest(targets) u
  where not exists (select 1 from notification_prefs np where np.user_id = u and (not np.push or cat = any (np.muted)));
  insert into notifications (company_id, user_id, title, body, link, silent, pushed_at)
  select p_company, u, p_title, left(coalesce(p_body, ''), 300), p_link, not p_store, case when u = any (push_targets) then null else now() end from unnest(targets) u;
  if cardinality(push_targets) > 0 then
    perform push_to(push_targets, p_title, left(coalesce(p_body, ''), 180), p_link);
  end if;
end $$;
revoke execute on function deliver(uuid, uuid[], text, text, text, boolean) from public, anon, authenticated;

-- Uzaktan oturum kapatma: İK personelin tüm oturumlarını düşürür (telefon kaybı vb.)
create or replace function force_signout(p_employee uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
declare e employees; n int := 0;
begin
  select * into e from employees where id = p_employee;
  if e.id is null then raise exception 'Personel bulunamadı'; end if;
  if not can_manage_hr(e.company_id) then raise exception 'Yetkiniz yok'; end if;
  if e.user_id is null then return json_build_object('sessions', 0); end if;
  delete from auth.sessions where user_id = e.user_id;
  get diagnostics n = row_count;
  delete from auth.refresh_tokens where user_id = e.user_id::text;
  delete from web_push_subscriptions where user_id = e.user_id;
  delete from push_tokens where user_id = e.user_id;
  return json_build_object('sessions', n);
end $$;
revoke execute on function force_signout(uuid) from public, anon;
