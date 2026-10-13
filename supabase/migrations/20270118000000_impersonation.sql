-- Kullanıcı olarak görüntüleme: şirket sahibi, ERP kullanıcılarının ve klinik / hekim portal hesaplarının ekranını
-- şifre sormadan, YALNIZ GÖRÜNTÜLEME modunda açar. Her açılış kaydedilir, kişiye bildirim gider.
-- Salt okunurluk veritabanında zorlanır: görüntüleme oturumu (JWT session_id) hiçbir tabloya ve dosyaya yazamaz.
-- Tekrar çalıştırılabilir.

create table if not exists impersonation_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  admin_id uuid not null,
  admin_name text,
  target_id uuid not null,
  target_name text,
  target_kind text not null check (target_kind in ('erp', 'portal')),
  reason text,
  started_at timestamptz not null default now(),
  claimed_at timestamptz,
  session_id uuid,
  ended_at timestamptz
);
create index if not exists impersonation_log_session on impersonation_log (session_id) where session_id is not null;
create index if not exists impersonation_log_company on impersonation_log (company_id, started_at desc);
alter table impersonation_log enable row level security;
revoke all on impersonation_log from anon;
grant select on impersonation_log to authenticated;
drop policy if exists impersonation_log_owner on impersonation_log;
create policy impersonation_log_owner on impersonation_log for select to authenticated
  using (exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = impersonation_log.company_id and m.role = 'owner'));

-- Bu istek bir görüntüleme oturumundan mı geliyor?
create or replace function imp_readonly()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from impersonation_log
    where session_id = nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid
  );
$$;

-- Başlat: yalnız şirket sahibi; hedef bu şirketin ERP kullanıcısı ya da portal üyesi olmalı
create or replace function imp_start(p_target uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  me_name text;
  t_name text;
  t_kind text;
  t_email text;
  lang text;
  v uuid;
begin
  if imp_readonly() then raise exception 'readonly_session'; end if;
  select company_id, coalesce(display_name, '') into c, me_name from memberships where user_id = auth.uid() and role = 'owner' order by created_at limit 1;
  if c is null then raise exception 'not_owner'; end if;
  if p_target = auth.uid() then raise exception 'self'; end if;
  select email into t_email from auth.users where id = p_target;
  if t_email is null then raise exception 'no_email'; end if;
  select coalesce(nullif(display_name, ''), t_email), 'erp' into t_name, t_kind from memberships where user_id = p_target and company_id = c;
  if t_kind is null then
    select coalesce(nullif(pm.display_name, ''), pa.name, t_email) || coalesce(' · ' || pa.name, ''), 'portal' into t_name, t_kind
    from portal_members pm join portal_accounts pa on pa.id = pm.account_id where pm.user_id = p_target limit 1;
  end if;
  if t_kind is null then raise exception 'not_member'; end if;
  if me_name = '' then select coalesce(email, 'Yönetici') into me_name from auth.users where id = auth.uid(); end if;

  insert into impersonation_log (company_id, admin_id, admin_name, target_id, target_name, target_kind, reason)
  values (c, auth.uid(), me_name, p_target, t_name, t_kind, nullif(trim(p_reason), ''))
  returning id into v;

  if t_kind = 'erp' then
    insert into notifications (company_id, user_id, title, body, link)
    values (c, p_target, 'Yöneticiniz hesabınızı görüntüledi',
            me_name || ', ' || to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') ||
            ' itibarıyla hesabınızı yalnız görüntüleme modunda açtı. Bu modda sizin adınıza hiçbir işlem yapılamaz.', null);
  else
    select coalesce(pa.language, 'tr') into lang from portal_members pm join portal_accounts pa on pa.id = pm.account_id where pm.user_id = p_target limit 1;
    insert into notifications (company_id, user_id, title, body, link)
    values (c, p_target,
      case lang when 'en' then 'The laboratory manager viewed your account' when 'fr' then 'Le responsable du laboratoire a consulté votre compte' else 'Laboratuvar yöneticisi hesabınızı görüntüledi' end,
      case lang
        when 'en' then 'Your account was opened in view-only mode on ' || to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') || ' (Istanbul time). No action can be taken on your behalf in this mode.'
        when 'fr' then 'Votre compte a été ouvert en mode lecture seule le ' || to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') || ' (heure d''Istanbul). Aucune action ne peut être effectuée en votre nom dans ce mode.'
        else to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') || ' itibarıyla hesabınız yalnız görüntüleme modunda açıldı. Bu modda sizin adınıza hiçbir işlem yapılamaz.'
      end, '/portal/bildirimler');
  end if;
  return jsonb_build_object('id', v, 'email', t_email, 'kind', t_kind, 'name', t_name);
end $$;

-- Hedef oturum açıldıktan hemen sonra (hedef kullanıcı olarak) çağrılır: oturumu görüntüleme oturumu olarak işaretler
create or replace function imp_claim(p_log uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sid uuid := nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid;
  r impersonation_log;
begin
  if sid is null then raise exception 'no_session'; end if;
  update impersonation_log set claimed_at = now(), session_id = sid
  where id = p_log and target_id = auth.uid() and claimed_at is null and started_at > now() - interval '10 minutes'
  returning * into r;
  if r.id is null then raise exception 'invalid_claim'; end if;
  -- oturum en geç 1 saatte kendiliğinden kapanır
  begin
    execute 'update auth.sessions set not_after = now() + interval ''1 hour'' where id = $1' using sid;
  exception when others then null;
  end;
  return jsonb_build_object('admin', r.admin_name, 'target', r.target_name);
end $$;

-- Banner için: bu oturum görüntüleme oturumuysa bilgisi
create or replace function imp_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', admin_name, 'target', target_name, 'kind', target_kind, 'started', started_at, 'expires', claimed_at + interval '1 hour')
  from impersonation_log
  where session_id = nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid
  limit 1;
$$;

-- Bitir (görüntüleme oturumundan çağrılır): kaydı kapatır, oturumu iptal eder, yöneticinin e-postasını döner
create or replace function imp_end_self()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sid uuid := nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid;
  r impersonation_log;
  em text;
begin
  select * into r from impersonation_log where session_id = sid limit 1;
  if r.id is null then return null; end if;
  update impersonation_log set ended_at = coalesce(ended_at, now()) where id = r.id;
  begin
    execute 'delete from auth.sessions where id = $1' using sid;
  exception when others then null;
  end;
  select email into em from auth.users where id = r.admin_id;
  return jsonb_build_object('admin_email', em, 'kind', r.target_kind);
end $$;

revoke all on function imp_start(uuid, text), imp_claim(uuid), imp_end_self(), imp_status(), imp_readonly() from public, anon;
grant execute on function imp_start(uuid, text), imp_claim(uuid), imp_end_self(), imp_status(), imp_readonly() to authenticated;

-- Salt okunur zorlama: RLS açık her tabloya kısıtlayıcı (restrictive) yazma politikaları
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists imp_ro_ins on public.%I', t.relname);
    execute format('drop policy if exists imp_ro_upd on public.%I', t.relname);
    execute format('drop policy if exists imp_ro_del on public.%I', t.relname);
    execute format('create policy imp_ro_ins on public.%I as restrictive for insert to authenticated with check (not (select imp_readonly()))', t.relname);
    execute format('create policy imp_ro_upd on public.%I as restrictive for update to authenticated using (not (select imp_readonly()))', t.relname);
    execute format('create policy imp_ro_del on public.%I as restrictive for delete to authenticated using (not (select imp_readonly()))', t.relname);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists imp_ro_ins on storage.objects;
    drop policy if exists imp_ro_upd on storage.objects;
    drop policy if exists imp_ro_del on storage.objects;
    create policy imp_ro_ins on storage.objects as restrictive for insert to authenticated with check (not (select public.imp_readonly()));
    create policy imp_ro_upd on storage.objects as restrictive for update to authenticated using (not (select public.imp_readonly()));
    create policy imp_ro_del on storage.objects as restrictive for delete to authenticated using (not (select public.imp_readonly()));
  end if;
end $$;
