-- =====================================================================
-- KİŞİSEL MASAÜSTÜ: kısayol simgeleri, yapışkan notlar, hatırlatmalar
--  user_dashboard.shortcuts : [{href, label, icon}] kişinin masaüstü simgeleri (yetkisi olan sayfalar)
--  user_notes               : kişisel notlar (renk, sabitleme, sıra)
--  user_reminders           : tarih-saatli hatırlatmalar (tekrar: yok / her gün / iş günleri / haftalık / aylık)
--  rem_fire()               : zamanı gelen hatırlatmaları bildirime ve telefona gönderir; tekrarlıları ileri alır.
--                             Uygulama açıkken her dakika, ayrıca günlük zamanlanmış işte çağrılır.
-- Herkes yalnız kendi kayıtlarını görür (RLS). Tekrar çalıştırılabilir. Önce 20261214000000_dashboard.sql.
-- =====================================================================

alter table user_dashboard add column if not exists shortcuts jsonb not null default '[]'::jsonb;
do $$ begin
  alter table user_dashboard add constraint user_dashboard_shortcuts_check check (jsonb_typeof(shortcuts) = 'array' and jsonb_array_length(shortcuts) <= 40);
exception when duplicate_object then null; end $$;

create table if not exists user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  color text not null default 'yellow' check (color in ('yellow', 'blue', 'green', 'pink', 'purple', 'gray')),
  pinned boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_notes_user_idx on user_notes (user_id, pinned desc, sort, updated_at desc);

create table if not exists user_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  note text check (note is null or length(note) <= 1000),
  remind_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  link text check (link is null or (link ~ '^/' and length(link) <= 300)),
  done_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_reminders_user_idx on user_reminders (user_id, done_at, remind_at);
create index if not exists user_reminders_due_idx on user_reminders (remind_at) where done_at is null and notified_at is null;

alter table user_notes enable row level security;
alter table user_reminders enable row level security;
drop policy if exists user_notes_self on user_notes;
create policy user_notes_self on user_notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists user_reminders_self on user_reminders;
create policy user_reminders_self on user_reminders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and company_id = lab_company());
grant select, insert, update, delete on user_notes, user_reminders to authenticated;

-- Bir sonraki tekrar zamanı (İstanbul saatiyle)
create or replace function rem_next(p_at timestamptz, p_repeat text) returns timestamptz
language plpgsql immutable as $$
declare t timestamp := p_at at time zone 'Europe/Istanbul';
begin
  if p_repeat = 'daily' then t := t + interval '1 day';
  elsif p_repeat = 'weekly' then t := t + interval '7 days';
  elsif p_repeat = 'monthly' then t := t + interval '1 month';
  elsif p_repeat = 'weekdays' then
    t := t + interval '1 day';
    while extract(isodow from t) in (6, 7) loop t := t + interval '1 day'; end loop;
  else return null;
  end if;
  return t at time zone 'Europe/Istanbul';
end $$;

-- Zamanı gelen hatırlatmaları gönder (kişinin kendisine de gider; bildirim tercihlerine uyar)
create or replace function rem_fire() returns int
language plpgsql security definer set search_path = public as $$
declare r user_reminders; n int := 0; v_next timestamptz; v_push boolean;
begin
  for r in select * from user_reminders where done_at is null and notified_at is null and remind_at <= now() order by remind_at limit 200 for update skip locked loop
    v_push := not exists (select 1 from notification_prefs np where np.user_id = r.user_id and not np.push);
    insert into notifications (company_id, user_id, title, body, link, silent, pushed_at)
    values (r.company_id, r.user_id, '⏰ ' || r.title, left(coalesce(r.note, ''), 300), coalesce(r.link, '/'), false, case when v_push then null else now() end);
    if v_push then perform push_to(array[r.user_id], '⏰ ' || r.title, left(coalesce(r.note, 'Hatırlatma'), 180), coalesce(r.link, '/')); end if;
    if r.repeat <> 'none' then
      v_next := r.remind_at;
      loop v_next := rem_next(v_next, r.repeat); exit when v_next > now(); end loop;
      update user_reminders set remind_at = v_next where id = r.id;
    else
      update user_reminders set notified_at = now() where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function rem_fire() from public, anon;
grant execute on function rem_fire() to authenticated;

notify pgrst, 'reload schema';
