-- İç iletişim platformu: duyurulara tür (bilgilendirme, etkinlik, anket, soru-cevap), okudum-anladım onayı,
-- etkinlik katılım bildirimi, anket oyları (isimsiz seçeneği), soru-cevap (oylama, yanıt)

alter table announcements
  add column if not exists kind text not null default 'info' check (kind in ('info', 'event', 'poll', 'qa')),
  add column if not exists require_ack boolean not null default false,
  add column if not exists event_at timestamptz,
  add column if not exists event_end timestamptz,
  add column if not exists location text,
  add column if not exists capacity int check (capacity is null or capacity > 0),
  add column if not exists poll_multi boolean not null default false,
  add column if not exists anonymous boolean not null default false,
  add column if not exists closes_at timestamptz;

alter table announcement_reads add column if not exists acked_at timestamptz;

create table if not exists event_rsvps (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('yes', 'no', 'maybe')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table if not exists poll_options (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  label text not null,
  sort int not null default 0
);

create table if not exists poll_votes (
  announcement_id uuid not null references announcements(id) on delete cascade,
  option_id uuid not null references poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id)
);

create table if not exists qa_questions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body text not null check (length(body) between 3 and 1000),
  anonymous boolean not null default false,
  answer text,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists qa_votes (
  question_id uuid not null references qa_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  primary key (question_id, user_id)
);

alter table event_rsvps enable row level security;
alter table poll_options enable row level security;
alter table poll_votes enable row level security;
alter table qa_questions enable row level security;
alter table qa_votes enable row level security;

create or replace function can_see_announcement(p_ann uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select announcement_visible(a) from announcements a where a.id = p_ann), false);
$$;
create or replace function is_ann_staff(p_ann uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from announcements a where a.id = p_ann and has_role(a.company_id, array['owner', 'hr', 'branch_manager']::app_role[]));
$$;

drop policy if exists rsvp_own on event_rsvps;
create policy rsvp_own on event_rsvps for all using (user_id = auth.uid() and can_see_announcement(announcement_id)) with check (user_id = auth.uid() and can_see_announcement(announcement_id));
drop policy if exists rsvp_staff on event_rsvps;
create policy rsvp_staff on event_rsvps for select using (is_ann_staff(announcement_id));

drop policy if exists po_read on poll_options;
create policy po_read on poll_options for select using (can_see_announcement(announcement_id));
drop policy if exists po_write on poll_options;
create policy po_write on poll_options for all using (is_ann_staff(announcement_id)) with check (is_ann_staff(announcement_id));

-- Oylar: herkes yalnız kendi oyunu görür; sonuçlar poll_results ile (isimsiz ankette kimlik verilmez)
drop policy if exists pv_own on poll_votes;
create policy pv_own on poll_votes for all using (user_id = auth.uid()) with check (user_id = auth.uid() and can_see_announcement(announcement_id));

drop policy if exists qa_insert on qa_questions;
create policy qa_insert on qa_questions for insert with check (user_id = auth.uid() and can_see_announcement(announcement_id));
drop policy if exists qa_staff on qa_questions;
create policy qa_staff on qa_questions for update using (is_ann_staff(announcement_id)) with check (is_ann_staff(announcement_id));
drop policy if exists qa_own_delete on qa_questions;
create policy qa_own_delete on qa_questions for delete using (user_id = auth.uid() or is_ann_staff(announcement_id));
drop policy if exists qv_own on qa_votes;
create policy qv_own on qa_votes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Anket oyu (çoklu seçim değilse önceki oy silinir); anket kapandıysa reddedilir
create or replace function vote_poll(p_ann uuid, p_options uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = p_ann;
  if a.id is null or not announcement_visible(a) or a.kind <> 'poll' then raise exception 'Anket bulunamadı'; end if;
  if a.closes_at is not null and a.closes_at < now() then raise exception 'Anket kapandı'; end if;
  if not a.poll_multi and coalesce(array_length(p_options, 1), 0) > 1 then raise exception 'Tek seçim yapın'; end if;
  delete from poll_votes where announcement_id = p_ann and user_id = auth.uid();
  insert into poll_votes (announcement_id, option_id, user_id)
  select p_ann, o.id, auth.uid() from poll_options o where o.announcement_id = p_ann and o.id = any (p_options);
end $$;
grant execute on function vote_poll(uuid, uuid[]) to authenticated;

create or replace function poll_results(p_ann uuid)
returns table (option_id uuid, label text, votes bigint, voters text[])
language sql stable security definer set search_path = public as $$
  select o.id, o.label, count(v.user_id),
    case when is_ann_staff(p_ann) and not a.anonymous
      then array_remove(array_agg(coalesce(e.first_name || ' ' || e.last_name, '?') order by e.first_name), null) else '{}'::text[] end
  from poll_options o join announcements a on a.id = o.announcement_id
  left join poll_votes v on v.option_id = o.id
  left join employees e on e.user_id = v.user_id and e.company_id = a.company_id
  where o.announcement_id = p_ann and can_see_announcement(p_ann)
  group by o.id, o.label, o.sort, a.anonymous
  order by o.sort;
$$;
grant execute on function poll_results(uuid) to authenticated;

-- Soru-cevap listesi: isimsiz sorularda soran gizlenir
create or replace function qa_list(p_ann uuid)
returns table (id uuid, body text, author text, mine boolean, votes bigint, voted boolean, answer text, answered_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select q.id, q.body,
    case when q.anonymous then 'İsimsiz' else coalesce((select e.first_name || ' ' || e.last_name from employees e join announcements a on a.id = q.announcement_id where e.user_id = q.user_id and e.company_id = a.company_id limit 1), 'Yönetim') end,
    q.user_id = auth.uid(),
    (select count(*) from qa_votes v where v.question_id = q.id),
    exists (select 1 from qa_votes v where v.question_id = q.id and v.user_id = auth.uid()),
    q.answer, q.answered_at, q.created_at
  from qa_questions q
  where q.announcement_id = p_ann and can_see_announcement(p_ann) and (not q.hidden or is_ann_staff(p_ann))
  order by (q.answer is null) desc, (select count(*) from qa_votes v where v.question_id = q.id) desc, q.created_at;
$$;
grant execute on function qa_list(uuid) to authenticated;

-- Katılım ve okuma özeti (yönetici): kimler okudu / onayladı / katılıyor
create or replace function announcement_audience(p_ann uuid)
returns table (user_id uuid, name text, department text, read_at timestamptz, acked_at timestamptz, rsvp text)
language sql stable security definer set search_path = public as $$
  select e.user_id, e.first_name || ' ' || e.last_name, d.name, r.read_at, r.acked_at, rv.status
  from announcements a
  join employees e on e.company_id = a.company_id and e.user_id is not null and e.status <> 'terminated'
  left join departments d on d.id = e.department_id
  left join announcement_reads r on r.announcement_id = a.id and r.user_id = e.user_id
  left join event_rsvps rv on rv.announcement_id = a.id and rv.user_id = e.user_id
  where a.id = p_ann and is_ann_staff(p_ann)
    and (a.audience = 'ALL' or (a.audience = 'DEPARTMENT' and e.department_id = any (a.department_ids)) or (a.audience = 'BRANCH' and e.branch_id = any (a.branch_ids)))
  order by e.first_name;
$$;
grant execute on function announcement_audience(uuid) to authenticated;

-- Yeni soru gelince yayınlayana, yanıtlanınca sorana bildirim
create or replace function trg_qa_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare a announcements;
begin
  select * into a from announcements where id = new.announcement_id;
  if tg_op = 'INSERT' then
    perform deliver(a.company_id, array[a.created_by], 'Yeni soru', left(new.body, 120), '/duyurular/' || a.id);
  elsif old.answer is null and new.answer is not null then
    perform deliver(a.company_id, array[new.user_id], 'Sorunuz yanıtlandı', a.title, '/duyurular/' || a.id);
  end if;
  return new;
end $$;
drop trigger if exists qa_notify on qa_questions;
create trigger qa_notify after insert or update on qa_questions for each row execute function trg_qa_notify();

-- Etkinlik katılım sayıları (herkes görebilir; kimlik vermez)
create or replace function event_summary(p_ids uuid[])
returns table (announcement_id uuid, yes bigint, maybe bigint, no bigint)
language sql stable security definer set search_path = public as $$
  select a.id, count(*) filter (where r.status = 'yes'), count(*) filter (where r.status = 'maybe'), count(*) filter (where r.status = 'no')
  from announcements a left join event_rsvps r on r.announcement_id = a.id
  where a.id = any (p_ids) and announcement_visible(a)
  group by a.id;
$$;
grant execute on function event_summary(uuid[]) to authenticated;

-- Bildirim başlığı türe göre; bağlantı doğrudan duyuruya
create or replace function trg_announcement_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare users uuid[]; prefix text;
begin
  if not new.push then return new; end if;
  select coalesce(array_agg(m.user_id), '{}') into users
  from memberships m
  left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  where m.company_id = new.company_id
    and (new.audience = 'ALL' or m.role <> 'employee'
      or (new.audience = 'DEPARTMENT' and e.department_id = any (new.department_ids))
      or (new.audience = 'BRANCH' and e.branch_id = any (new.branch_ids)));
  prefix := case new.kind when 'event' then '📅 Etkinlik: ' when 'poll' then '🗳 Anket: ' when 'qa' then '❓ Soru-cevap: ' else '📢 ' end;
  perform deliver(new.company_id, users, prefix || new.title,
    case when new.require_ack then 'Okuyup onaylamanız gerekiyor. ' else '' end || new.body, '/duyurular/' || new.id);
  return new;
end $$;

-- Soru sahibi kendi sorusunu görebilir (silme için); yönetici yanıtı RPC ile verir (isimsiz soruların sahibi gizli kalır)
drop policy if exists qa_own_read on qa_questions;
create policy qa_own_read on qa_questions for select using (user_id = auth.uid());
create or replace function answer_question(p_question uuid, p_answer text, p_hidden boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare q qa_questions;
begin
  select * into q from qa_questions where id = p_question;
  if q.id is null or not is_ann_staff(q.announcement_id) then raise exception 'Yetkiniz yok'; end if;
  update qa_questions set answer = nullif(trim(p_answer), ''), answered_by = auth.uid(), answered_at = now(), hidden = coalesce(p_hidden, false) where id = p_question;
end $$;
grant execute on function answer_question(uuid, text, boolean) to authenticated;
