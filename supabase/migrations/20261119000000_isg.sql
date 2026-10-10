-- İSG yönetimi: İSG-KATİP görevlendirme takibi, 2026 eğitim yönetmeliği, risk değerlendirmesi, acil durum,
-- İSG kurulu, tespit ve öneri defteri, iş kazası araştırması, periyodik kontroller, ortam ölçümleri, güvenlik bilgi formları.
-- Yazma: sahip, İK, İSG (uzman / hekim kullanıcıları). Okuma: + şef ve muhasebe.

-- Şirket NACE kodu ve tehlike sınıfı (32.50.13 · çok tehlikeli)
update companies set nace_code = '32.50.13', hazard_class = 'COK' where nace_code is null or nace_code = '' or nace_code = '325013';

create or replace function isg_write(p_company uuid) returns boolean language sql stable as $$
  select has_role(p_company, array['owner', 'hr', 'safety']::app_role[]);
$$;
create or replace function isg_read(p_company uuid) returns boolean language sql stable as $$
  select has_role(p_company, array['owner', 'hr', 'safety', 'accountant', 'branch_manager']::app_role[]);
$$;

-- ============================================================ 1) İSG-KATİP
create table if not exists isg_professionals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('uzman', 'hekim', 'dsp')),
  full_name text not null,
  certificate_class text check (certificate_class in ('A', 'B', 'C')),
  certificate_no text,
  phone text,
  email text,
  osgb_name text,
  osgb_no text,
  user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists isg_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  professional_id uuid not null references isg_professionals(id) on delete cascade,
  start_date date not null,
  end_date date,
  monthly_minutes int not null check (monthly_minutes > 0),
  katip_status text not null default 'onay-bekliyor' check (katip_status in ('onay-bekliyor', 'onayli', 'iptal', 'sona-erdi')),
  katip_no text,
  sent_on date,
  approved_on date,
  document_path text,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists isg_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  professional_id uuid not null references isg_professionals(id) on delete cascade,
  visit_date date not null,
  minutes int not null check (minutes > 0 and minutes <= 720),
  topics text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================ 2) Eğitim (RG 02.04.2026 / 33212)
alter table compliance_types add column if not exists min_hours_by_class jsonb;
update compliance_types set name = 'Temel İSG eğitimi', min_hours_by_class = '{"COK":16,"TEHLIKELI":12,"AZ":8}', validity_by_class = '{"COK":12,"TEHLIKELI":24,"AZ":36}', validity_months = 36
  where company_id is null and code = 'TEMEL_ISG';
update compliance_types set name = 'İşe başlama eğitimi (yüz yüze, en az 2 saat)', min_hours = 2 where company_id is null and code = 'ISE_BASLAMA';
insert into compliance_types (company_id, category, code, name, validity_months, min_hours, required, sort_order)
select null, 'TRAINING', 'ILAVE', 'İlave eğitim (iş kazası / meslek hastalığı sonrası)', null, null, false, 80
where not exists (select 1 from compliance_types where company_id is null and code = 'ILAVE');
insert into compliance_types (company_id, category, code, name, validity_months, min_hours, required, sort_order)
select null, 'TRAINING', 'BILGI_YENILEME', 'Bilgi yenileme eğitimi (6 aydan uzun ayrılık sonrası)', null, null, false, 90
where not exists (select 1 from compliance_types where company_id is null and code = 'BILGI_YENILEME');

alter table training_records
  add column if not exists training_kind text check (training_kind in ('ise-baslama', 'temel', 'tekrar', 'ilave', 'bilgi-yenileme', 'diger')),
  add column if not exists method text check (method in ('yuz-yuze', 'uzaktan', 'karma')),
  add column if not exists exam_score int check (exam_score between 0 and 100),
  add column if not exists attempt int,
  add column if not exists topics text[];

create table if not exists training_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  type_id uuid not null references compliance_types(id),
  training_kind text not null check (training_kind in ('ise-baslama', 'temel', 'tekrar', 'ilave', 'bilgi-yenileme', 'diger')),
  held_on date not null,
  start_time time,
  end_time time,
  lesson_hours numeric(4,1) not null,
  method text not null default 'yuz-yuze' check (method in ('yuz-yuze', 'uzaktan', 'karma')),
  trainer_name text not null,
  trainer_title text,
  location text,
  topics text[] not null default '{}',
  exam boolean not null default false,
  employee_ids uuid[] not null default '{}',
  scores jsonb,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Uzaktan eğitim içerikleri ve personel ilerlemesi (yalnız 1-3. konu başlıkları uzaktan verilebilir)
create table if not exists elearning_courses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  topic_group int not null check (topic_group between 1 and 4),
  description text,
  video_url text,
  video_path text,
  duration_min int not null check (duration_min > 0),
  lesson_hours numeric(4,1) not null default 1,
  questions jsonb not null default '[]',
  type_id uuid references compliance_types(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists elearning_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  course_id uuid not null references elearning_courses(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  watched_sec int not null default 0,
  max_position_sec int not null default 0,
  focus_losses int not null default 0,
  prompts_answered int not null default 0,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  completed_at timestamptz,
  exam_score int,
  attempts int not null default 0,
  passed boolean,
  log jsonb not null default '[]',
  unique (course_id, employee_id)
);

-- ============================================================ 3) Risk değerlendirmesi ve acil durum
create table if not exists risk_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  method text not null default '5x5' check (method in ('5x5', 'fine-kinney')),
  done_on date not null,
  valid_until date not null,
  team jsonb not null default '[]',
  status text not null default 'taslak' check (status in ('taslak', 'yururlukte', 'arsiv')),
  announced_at timestamptz,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists risk_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  assessment_id uuid not null references risk_assessments(id) on delete cascade,
  area text not null,
  activity text,
  hazard text not null,
  risk text not null,
  affected text,
  p numeric(5,1) not null,
  s numeric(5,1) not null,
  f numeric(5,1),
  existing_controls text,
  actions text,
  responsible text,
  due_date date,
  done_on date,
  rp numeric(5,1),
  rs numeric(5,1),
  rf numeric(5,1),
  sort int not null default 0
);
create table if not exists emergency_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  done_on date not null,
  valid_until date not null,
  document_path text,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists emergency_drills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  held_on date not null,
  scenario text not null,
  participants int,
  duration_min int,
  findings text,
  document_path text,
  created_at timestamptz not null default now()
);
create table if not exists emergency_team (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  team text not null check (team in ('sondurme', 'kurtarma', 'koruma', 'ilkyardim')),
  trained_on date,
  certificate_until date,
  created_at timestamptz not null default now(),
  unique (employee_id, team)
);

-- ============================================================ 4) İSG kurulu ve tespit-öneri defteri
create table if not exists committee_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  role text not null check (role in ('baskan', 'sekreter', 'uzman', 'hekim', 'ik', 'idari-mali', 'sivil-savunma', 'formen', 'bas-temsilci', 'temsilci')),
  employee_id uuid references employees(id) on delete set null,
  full_name text,
  since date,
  until date,
  created_at timestamptz not null default now()
);
create table if not exists committee_meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  meeting_no int not null,
  held_on date not null,
  agenda text[] not null default '{}',
  attendees text[] not null default '{}',
  notes text,
  decisions jsonb not null default '[]',
  document_path text,
  created_at timestamptz not null default now()
);
create table if not exists isg_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  found_on date not null default current_date,
  author_kind text check (author_kind in ('uzman', 'hekim', 'isveren', 'calisan', 'denetim')),
  author_name text,
  area text,
  description text not null,
  recommendation text,
  level text not null default 'orta' check (level in ('dusuk', 'orta', 'yuksek', 'acil')),
  responsible text,
  due_date date,
  photo_path text,
  status text not null default 'acik' check (status in ('acik', 'islemde', 'kapandi')),
  employer_ack_at timestamptz,
  employer_ack_by uuid references auth.users(id),
  closed_on date,
  close_note text,
  close_photo_path text,
  book_page text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================ 5) Kaza, kontroller, ölçümler, GBF
alter table safety_incidents
  add column if not exists body_part text,
  add column if not exists injury_type text,
  add column if not exists witnesses text,
  add column if not exists hospital text,
  add column if not exists report_days int,
  add column if not exists returned_on date,
  add column if not exists root_cause text,
  add column if not exists corrective_actions text,
  add column if not exists sgk_ref text;

create table if not exists equipment_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  equipment text not null,
  category text not null,
  location text,
  serial_no text,
  period_months int not null check (period_months > 0),
  last_check date,
  next_due date,
  inspector text,
  result text check (result in ('uygun', 'uygun-degil', 'sartli')),
  report_path text,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists env_measurements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,
  measured_on date not null,
  location text,
  value numeric,
  unit text,
  limit_value numeric,
  compliant boolean,
  lab text,
  next_due date,
  report_path text,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists sds_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  product text not null,
  supplier text,
  hazards text,
  used_in text,
  revised_on date,
  document_path text,
  created_at timestamptz not null default now()
);

-- ============================================================ RLS
do $$
declare t text;
begin
  foreach t in array array['isg_professionals', 'isg_assignments', 'isg_visits', 'training_sessions', 'elearning_courses', 'risk_assessments', 'risk_items',
                           'emergency_plans', 'emergency_drills', 'emergency_team', 'committee_members', 'committee_meetings', 'isg_findings',
                           'equipment_checks', 'env_measurements', 'sds_documents'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %1$s_r on %1$s', t);
    execute format('create policy %1$s_r on %1$s for select using (isg_read(company_id))', t);
    execute format('drop policy if exists %1$s_w on %1$s', t);
    execute format('create policy %1$s_w on %1$s for all using (isg_write(company_id)) with check (isg_write(company_id))', t);
  end loop;
end $$;
alter table elearning_progress enable row level security;
drop policy if exists elp_r on elearning_progress;
create policy elp_r on elearning_progress for select using (isg_read(company_id) or is_self_employee(employee_id));
drop policy if exists elp_w on elearning_progress;
create policy elp_w on elearning_progress for all using (isg_write(company_id)) with check (isg_write(company_id));
-- Personel: aktif uzaktan eğitimleri, acil durum ekibindeki yerini ve kurul kararlarını görür
drop policy if exists elc_self on elearning_courses;
create policy elc_self on elearning_courses for select using (active and is_member(company_id));
drop policy if exists et_self on emergency_team;
create policy et_self on emergency_team for select using (is_self_employee(employee_id));
-- Uzman / hekim tespiti ve ziyareti girebilir (yukarıdaki isg_write kapsamında); şef kendi tespitini görebilir (isg_read)

-- İSG dosyaları: <şirket>/isg/... İSG yetkilileri okur/yazar; eğitim videoları <şirket>/isg-egitim/... tüm üyeler okur
drop policy if exists "documents_isg_rw" on storage.objects;
create policy "documents_isg_rw" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[2] in ('isg', 'isg-egitim') and isg_write(((storage.foldername(name))[1])::uuid));
drop policy if exists "documents_isg_read" on storage.objects;
create policy "documents_isg_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (((storage.foldername(name))[2] = 'isg' and isg_read(((storage.foldername(name))[1])::uuid))
                                      or ((storage.foldername(name))[2] = 'isg-egitim' and is_member(((storage.foldername(name))[1])::uuid))));

-- ============================================================ RPC: uzaktan eğitim ilerlemesi (personel)
create or replace function elearning_beat(p_course uuid, p_position int, p_watched int, p_focus_loss boolean default false, p_prompt boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare e employees; c elearning_courses; pr elearning_progress;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Personel kaydı bulunamadı'; end if;
  select * into c from elearning_courses where id = p_course and company_id = e.company_id and active;
  if c.id is null then raise exception 'Eğitim bulunamadı'; end if;
  insert into elearning_progress (company_id, course_id, employee_id) values (e.company_id, c.id, e.id) on conflict (course_id, employee_id) do nothing;
  select * into pr from elearning_progress where course_id = c.id and employee_id = e.id;
  -- İleri sarma engeli: konum en çok izlenen noktanın 15 sn ötesine geçemez; izleme süresi gerçek zamandan hızlı artamaz
  update elearning_progress set
    max_position_sec = greatest(max_position_sec, least(p_position, max_position_sec + 15 + greatest(0, extract(epoch from now() - last_seen_at)::int))),
    watched_sec = least(c.duration_min * 60, watched_sec + least(greatest(p_watched, 0), greatest(5, extract(epoch from now() - last_seen_at)::int + 5))),
    focus_losses = focus_losses + case when p_focus_loss then 1 else 0 end,
    prompts_answered = prompts_answered + case when p_prompt then 1 else 0 end,
    last_seen_at = now()
  where id = pr.id returning * into pr;
  return json_build_object('watched', pr.watched_sec, 'max', pr.max_position_sec, 'required', c.duration_min * 60, 'done', pr.watched_sec >= c.duration_min * 60 * 0.95);
end $$;
grant execute on function elearning_beat(uuid, int, int, boolean, boolean) to authenticated;

-- Sınav: cevaplar sunucuda puanlanır; 60 ve üzeri başarılı; en fazla 3 deneme (ilk + 2 ek sınav). Başarılıysa eğitim kaydı açılır.
create or replace function elearning_submit(p_course uuid, p_answers int[])
returns json language plpgsql security definer set search_path = public as $$
declare e employees; c elearning_courses; pr elearning_progress; q jsonb; i int := 0; ok int := 0; total int; score int; hz text; yrs int;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  select * into c from elearning_courses where id = p_course and company_id = e.company_id and active;
  if c.id is null then raise exception 'Eğitim bulunamadı'; end if;
  select * into pr from elearning_progress where course_id = c.id and employee_id = e.id;
  if pr.id is null or pr.watched_sec < c.duration_min * 60 * 0.95 then raise exception 'Önce eğitimin tamamını izleyin'; end if;
  if pr.passed then raise exception 'Bu eğitimi zaten başarıyla tamamladınız'; end if;
  if pr.attempts >= 3 then raise exception 'Deneme hakkınız doldu; eğitimi yeniden almanız gerekiyor. İSG birimine başvurun.'; end if;
  total := jsonb_array_length(c.questions);
  if total = 0 then score := 100;
  else
    for q in select * from jsonb_array_elements(c.questions) loop
      i := i + 1;
      if p_answers[i] is not null and p_answers[i] = (q ->> 'answer')::int then ok := ok + 1; end if;
    end loop;
    score := round(ok * 100.0 / total);
  end if;
  update elearning_progress set attempts = attempts + 1, exam_score = score, passed = score >= 60,
    completed_at = case when score >= 60 then now() else completed_at end where id = pr.id;
  if score >= 60 and c.type_id is not null then
    select hazard_class into hz from companies where id = e.company_id;
    insert into training_records (company_id, employee_id, type_id, done_on, hours, trainer, provider, training_kind, method, exam_score, attempt, topics, note, created_by)
    values (e.company_id, e.id, c.type_id, current_date, c.lesson_hours, 'Uzaktan eğitim', 'MB Personel uzaktan eğitim', 'diger', 'uzaktan', score, pr.attempts + 1,
            array[c.topic_group || '. konu başlığı'], c.title, auth.uid());
  end if;
  return json_build_object('score', score, 'passed', score >= 60, 'attempts', pr.attempts + 1);
end $$;
grant execute on function elearning_submit(uuid, int[]) to authenticated;

-- Personelin kendi uzaktan eğitim listesi (sorular cevapsız döner)
create or replace function my_elearning()
returns table (id uuid, title text, topic_group int, description text, video_url text, video_path text, duration_min int, lesson_hours numeric, questions jsonb,
               watched_sec int, max_position_sec int, attempts int, exam_score int, passed boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.topic_group, c.description, c.video_url, c.video_path, c.duration_min, c.lesson_hours,
         (select coalesce(jsonb_agg(jsonb_build_object('q', x -> 'q', 'options', x -> 'options')), '[]') from jsonb_array_elements(c.questions) x),
         p.watched_sec, p.max_position_sec, p.attempts, p.exam_score, p.passed
  from elearning_courses c
  join employees e on e.user_id = auth.uid() and e.company_id = c.company_id
  left join elearning_progress p on p.course_id = c.id and p.employee_id = e.id
  where c.active
  order by c.topic_group, c.title;
$$;
grant execute on function my_elearning() to authenticated;

-- Tespit bildirimi: yeni tespit sahibine ve İK'ya, yüksek/acil ise hemen
create or replace function trg_finding_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform deliver(new.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = new.company_id and role in ('owner', 'hr')),
      case new.level when 'acil' then 'ACİL İSG tespiti' when 'yuksek' then 'Yüksek riskli İSG tespiti' else 'Yeni İSG tespiti' end,
      coalesce(new.area || ' · ', '') || left(new.description, 140), '/isg/defter');
  end if;
  return new;
end $$;
drop trigger if exists finding_notify on isg_findings;
create trigger finding_notify after insert on isg_findings for each row execute function trg_finding_notify();

-- İş kazası bildirimi: kayıt girilince sahip ve İK'ya 3 iş günü uyarısı
create or replace function trg_incident_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if new.kind in ('KAZA', 'MESLEK_HASTALIGI') then
    select first_name || ' ' || last_name into n from employees where id = new.employee_id;
    perform deliver(new.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = new.company_id and role in ('owner', 'hr', 'safety')),
      case new.kind when 'KAZA' then 'İş kazası kaydı: SGK bildirimi 3 iş günü' else 'Meslek hastalığı kaydı: SGK bildirimi 3 iş günü' end,
      coalesce(n, '') || ' · ' || left(new.description, 120), '/isg/kaza');
  end if;
  return new;
end $$;
drop trigger if exists incident_notify on safety_incidents;
create trigger incident_notify after insert on safety_incidents for each row execute function trg_incident_notify();
