-- İşe alım (ATS): ilanlar, adaylar, aşama geçmişi, mülakat puanları, tavsiye.
-- Web sitesi ve mobil başvurular sunucu tarafında (service role) yazılır; adayın kendisi
-- yalnız takip bağlantısındaki gizli anahtarla durumunu görür (candidate_status RPC).

create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  slug text not null,
  title text not null,
  department_id uuid references departments(id) on delete set null,
  description text,
  requirements text,
  employment_type text not null default 'Tam zamanlı',
  experience text,
  location text,
  headcount int not null default 1 check (headcount > 0),
  referral_bonus bigint check (referral_bonus is null or referral_bonus >= 0),   -- kuruş
  status text not null default 'open' check (status in ('draft', 'open', 'closed')),
  closes_on date,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);

create sequence if not exists candidate_no_seq;

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  posting_id uuid references job_postings(id) on delete set null,
  tracking_code text not null unique default ('B-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('candidate_no_seq')::text, 4, '0')),
  access_token uuid not null default gen_random_uuid() unique,
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text,
  birth_date date,
  district text,
  military text,
  start_when text,
  education text,
  experience text,
  last_employer text,
  expected_wage bigint,
  skills text[] not null default '{}',
  about text,
  source text not null default 'web' check (source in ('web', 'mobile', 'manual', 'referral', 'iskur', 'other')),
  heard_from text,
  referrer_employee_id uuid references employees(id) on delete set null,
  referrer_name text,
  kvkk_consent_at timestamptz,
  keep_in_pool boolean not null default false,
  stage text not null default 'new' check (stage in ('new', 'screen', 'interview', 'trial', 'offer', 'hired', 'rejected', 'withdrawn')),
  stage_changed_at timestamptz not null default now(),
  reject_reason text,
  interview_at timestamptz,
  interview_place text,
  candidate_reply text check (candidate_reply in ('confirmed', 'reschedule')),
  candidate_reply_at timestamptz,
  score numeric(3,2),
  cv_path text,
  file_paths text[] not null default '{}',
  employee_id uuid references employees(id) on delete set null,
  purge_after date not null default (current_date + 180),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists candidates_company_stage_idx on candidates (company_id, stage);
create index if not exists candidates_phone_idx on candidates (phone, created_at);

create table if not exists candidate_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  kind text not null check (kind in ('created', 'stage', 'note', 'interview', 'reply', 'message')),
  from_stage text,
  to_stage text,
  body text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists candidate_events_idx on candidate_events (candidate_id, created_at);

create table if not exists candidate_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  criterion text not null,
  score int not null check (score between 1 and 5),
  note text,
  scored_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (candidate_id, criterion, scored_by)
);

-- Yetki: sahip, muhasebe, İK her şeyi; şef yalnız kendi bölümünün ilanlarına gelen adayları görür ve puanlar
create or replace function can_see_candidate(p_candidate uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from candidates c left join job_postings j on j.id = c.posting_id
    where c.id = p_candidate and (
      has_role(c.company_id, array['owner', 'accountant', 'hr']::app_role[])
      or (has_role(c.company_id, array['branch_manager']::app_role[]) and j.department_id is not null and can_see_department(c.company_id, j.department_id))
    )
  );
$$;

alter table job_postings enable row level security;
alter table candidates enable row level security;
alter table candidate_events enable row level security;
alter table candidate_scores enable row level security;

drop policy if exists jp_read on job_postings;
create policy jp_read on job_postings for select using (is_member(company_id));
drop policy if exists jp_write on job_postings;
create policy jp_write on job_postings for all
  using (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]))
  with check (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]));

drop policy if exists cand_read on candidates;
create policy cand_read on candidates for select using (can_see_candidate(id));
drop policy if exists cand_write on candidates;
create policy cand_write on candidates for all
  using (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]) or can_see_candidate(id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]));

drop policy if exists ce_read on candidate_events;
create policy ce_read on candidate_events for select using (can_see_candidate(candidate_id));
drop policy if exists ce_write on candidate_events;
create policy ce_write on candidate_events for insert with check (can_see_candidate(candidate_id));

drop policy if exists cs_read on candidate_scores;
create policy cs_read on candidate_scores for select using (can_see_candidate(candidate_id));
drop policy if exists cs_write on candidate_scores;
create policy cs_write on candidate_scores for all
  using (can_see_candidate(candidate_id) and scored_by = auth.uid())
  with check (can_see_candidate(candidate_id) and scored_by = auth.uid());

-- Aşama değişince geçmişe yaz; puan ortalamasını güncelle
create or replace function trg_candidate_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into candidate_events (company_id, candidate_id, kind, to_stage, body, created_by)
    values (new.company_id, new.id, 'created', new.stage, 'Başvuru alındı (' || case new.source when 'web' then 'web sitesi' when 'mobile' then 'mobil' when 'referral' then 'çalışan tavsiyesi' when 'iskur' then 'İŞKUR' when 'manual' then 'elle eklendi' else 'diğer' end || ')', auth.uid());
    return new;
  end if;
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    insert into candidate_events (company_id, candidate_id, kind, from_stage, to_stage, body, created_by)
    values (new.company_id, new.id, 'stage', old.stage, new.stage, new.reject_reason, auth.uid());
    -- Reddedilen / çekilen: havuzda tutulmayacaksa 6 ay, tutulacaksa 1 yıl sonra silinir
    if new.stage in ('rejected', 'withdrawn') then
      new.purge_after := current_date + case when new.keep_in_pool then 365 else 180 end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists candidate_stage_ins on candidates;
create trigger candidate_stage_ins after insert on candidates for each row execute function trg_candidate_stage();
drop trigger if exists candidate_stage_upd on candidates;
create trigger candidate_stage_upd before update on candidates for each row execute function trg_candidate_stage();

create or replace function trg_candidate_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.candidate_id, old.candidate_id);
begin
  update candidates set score = (select round(avg(score)::numeric, 2) from candidate_scores where candidate_id = cid) where id = cid;
  return null;
end $$;
drop trigger if exists candidate_score_trg on candidate_scores;
create trigger candidate_score_trg after insert or update or delete on candidate_scores for each row execute function trg_candidate_score();

-- Yeni başvuruda İK'ya ve ilanın bölüm şefine bildirim
create or replace function trg_candidate_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare users uuid[]; t text;
begin
  select title into t from job_postings where id = new.posting_id;
  select coalesce(array_agg(distinct m.user_id), '{}') into users from memberships m
  where m.company_id = new.company_id and (m.role in ('owner', 'hr')
    or (m.role = 'branch_manager' and exists (
      select 1 from membership_departments md join job_postings j on j.id = new.posting_id
      where md.user_id = m.user_id and md.company_id = m.company_id and md.department_id = j.department_id)));
  perform deliver(new.company_id, users,
    case when new.source = 'referral' then 'Çalışan tavsiyesi: yeni aday' else 'Yeni iş başvurusu' end,
    new.first_name || ' ' || new.last_name || ' · ' || coalesce(t, 'Genel başvuru'), '/ise-alim/' || new.id);
  return new;
end $$;
drop trigger if exists candidate_notify on candidates;
create trigger candidate_notify after insert on candidates for each row execute function trg_candidate_notify();

-- Aday takip sayfası: gizli anahtarla yalnız kendi başvurusunun özetini döner (giriş gerektirmez)
create or replace function candidate_status(p_token uuid)
returns table (tracking_code text, first_name text, title text, stage text, stage_changed_at timestamptz, created_at timestamptz,
               interview_at timestamptz, interview_place text, candidate_reply text, company_name text)
language sql stable security definer set search_path = public as $$
  select c.tracking_code, c.first_name, coalesce(j.title, 'Genel başvuru'), c.stage, c.stage_changed_at, c.created_at,
         c.interview_at, c.interview_place, c.candidate_reply, co.name
  from candidates c left join job_postings j on j.id = c.posting_id join companies co on co.id = c.company_id
  where c.access_token = p_token;
$$;
grant execute on function candidate_status(uuid) to anon, authenticated;

create or replace function candidate_reply(p_token uuid, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare c candidates;
begin
  if p_reply not in ('confirmed', 'reschedule') then raise exception 'Geçersiz yanıt'; end if;
  select * into c from candidates where access_token = p_token;
  if c.id is null or c.interview_at is null then raise exception 'Davet bulunamadı'; end if;
  update candidates set candidate_reply = p_reply, candidate_reply_at = now() where id = c.id;
  insert into candidate_events (company_id, candidate_id, kind, body)
  values (c.company_id, c.id, 'reply', case when p_reply = 'confirmed' then 'Aday mülakata geleceğini onayladı' else 'Aday başka bir gün istedi' end);
  perform deliver(c.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = c.company_id and role in ('owner', 'hr')),
    case when p_reply = 'confirmed' then 'Aday mülakatı onayladı' else 'Aday başka gün istiyor' end,
    c.first_name || ' ' || c.last_name, '/ise-alim/' || c.id);
end $$;
grant execute on function candidate_reply(uuid, text) to anon, authenticated;

-- Çalışan arkadaşını önerir (mobil)
create or replace function refer_candidate(p_posting uuid, p_first text, p_last text, p_phone text, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare e employees; code text;
begin
  select * into e from employees where user_id = auth.uid() and status <> 'terminated' limit 1;
  if e.id is null then raise exception 'Personel kaydınız bulunamadı'; end if;
  if coalesce(trim(p_first), '') = '' or coalesce(trim(p_phone), '') = '' then raise exception 'Ad ve telefon zorunlu'; end if;
  if p_posting is not null and not exists (select 1 from job_postings where id = p_posting and company_id = e.company_id and status = 'open') then
    raise exception 'İlan kapalı';
  end if;
  insert into candidates (company_id, posting_id, first_name, last_name, phone, about, source, referrer_employee_id, referrer_name)
  values (e.company_id, p_posting, trim(p_first), coalesce(nullif(trim(p_last), ''), '-'), trim(p_phone), nullif(trim(p_note), ''), 'referral', e.id, e.first_name || ' ' || e.last_name)
  returning tracking_code into code;
  return code;
end $$;
grant execute on function refer_candidate(uuid, text, text, text, text) to authenticated;

-- Personelin kendi tavsiyeleri (yalnız aşama)
create or replace function my_referrals()
returns table (tracking_code text, name text, title text, stage text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.tracking_code, c.first_name || ' ' || c.last_name, coalesce(j.title, 'Genel'), c.stage, c.created_at
  from candidates c left join job_postings j on j.id = c.posting_id
  where c.referrer_employee_id in (select id from employees where user_id = auth.uid())
  order by c.created_at desc;
$$;
grant execute on function my_referrals() to authenticated;

-- Depo: aday dosyaları belgeler kovasında <company>/candidates/<candidate>/ altında; okuma İK/şef
drop policy if exists "documents_candidate_read" on storage.objects;
create policy "documents_candidate_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[2] = 'candidates' and can_see_candidate(((storage.foldername(name))[3])::uuid));
