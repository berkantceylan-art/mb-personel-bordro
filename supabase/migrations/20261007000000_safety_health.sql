-- =====================================================================
-- Migration 5: İş sağlığı ve güvenliği, sağlık muayeneleri
-- =====================================================================

alter table companies
  add column if not exists hazard_class text not null default 'COK' check (hazard_class in ('AZ', 'TEHLIKELI', 'COK')),
  add column if not exists nace_code text;

-- ---------------------------------------------------------------------
-- Tür tanımları (eğitim ve muayene)
-- ---------------------------------------------------------------------
create table compliance_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  category text not null check (category in ('TRAINING', 'HEALTH')),
  code text not null,
  name text not null,
  validity_months int,
  validity_by_class jsonb,
  min_hours numeric(5,1),
  required boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 100
);
alter table compliance_types enable row level security;
create policy ct_read on compliance_types for select using (company_id is null or is_member(company_id));
create policy ct_write on compliance_types for all
  using (company_id is not null and has_role(company_id, array['owner', 'hr', 'safety']::app_role[]))
  with check (company_id is not null and has_role(company_id, array['owner', 'hr', 'safety']::app_role[]));

insert into compliance_types (company_id, category, code, name, validity_months, validity_by_class, min_hours, required, sort_order) values
  (null, 'TRAINING', 'TEMEL_ISG', 'Temel İSG eğitimi', 36, '{"COK":12,"TEHLIKELI":24,"AZ":36}', null, true, 10),
  (null, 'TRAINING', 'ISE_BASLAMA', 'İşe başlama / oryantasyon eğitimi', null, null, 2, true, 20),
  (null, 'TRAINING', 'YANGIN', 'Yangın ve acil durum eğitimi', 12, null, 2, true, 30),
  (null, 'TRAINING', 'KKD', 'Kişisel koruyucu donanım kullanımı', 12, null, 1, true, 40),
  (null, 'TRAINING', 'KIMYASAL', 'Kimyasal madde ve toz maruziyeti', 12, null, 2, true, 50),
  (null, 'TRAINING', 'ILK_YARDIM', 'İlk yardım sertifikası', 36, null, 16, false, 60),
  (null, 'TRAINING', 'TATBIKAT', 'Acil durum tatbikatı', 12, null, null, false, 70),
  (null, 'HEALTH', 'ISE_GIRIS', 'İşe giriş muayenesi', null, null, null, true, 10),
  (null, 'HEALTH', 'PERIYODIK', 'Periyodik muayene', 60, '{"COK":12,"TEHLIKELI":36,"AZ":60}', null, true, 20),
  (null, 'HEALTH', 'AKCIGER', 'Akciğer grafisi', 12, null, null, true, 30),
  (null, 'HEALTH', 'SFT', 'Solunum fonksiyon testi (SFT)', 12, null, null, true, 40),
  (null, 'HEALTH', 'ODYOMETRI', 'Odyometri (işitme testi)', 12, null, null, true, 50),
  (null, 'HEALTH', 'KAN', 'Hemogram / kan tahlili', 12, null, null, false, 60),
  (null, 'HEALTH', 'GOZ', 'Göz muayenesi', 12, null, null, false, 70);

-- ---------------------------------------------------------------------
-- Personel eğitim kayıtları
-- ---------------------------------------------------------------------
create table training_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  type_id uuid not null references compliance_types(id),
  done_on date not null,
  hours numeric(5,1),
  trainer text,
  provider text,
  expires_on date,
  certificate_path text,
  session_id uuid,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on training_records (employee_id, type_id, done_on desc);
alter table training_records enable row level security;
create policy tr_read on training_records for select using (can_see_employee(employee_id));
create policy tr_write on training_records for all
  using (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]));

-- ---------------------------------------------------------------------
-- Sağlık muayeneleri (özel nitelikli kişisel veri: sınırlı erişim)
-- ---------------------------------------------------------------------
create table health_exams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  type_id uuid not null references compliance_types(id),
  exam_date date not null,
  result text check (result in ('UYGUN', 'SARTLI', 'UYGUN_DEGIL')),
  restrictions text,
  doctor text,
  institution text,
  expires_on date,
  report_path text,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on health_exams (employee_id, type_id, exam_date desc);
alter table health_exams enable row level security;
create policy he_read on health_exams for select
  using (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy he_write on health_exams for all
  using (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]));

-- ---------------------------------------------------------------------
-- KKD zimmet
-- ---------------------------------------------------------------------
create table ppe_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  item text not null,
  size text,
  quantity int not null default 1,
  issued_on date not null,
  renew_months int,
  returned_on date,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table ppe_issues enable row level security;
create policy ppe_read on ppe_issues for select using (can_see_employee(employee_id));
create policy ppe_write on ppe_issues for all
  using (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]));

-- ---------------------------------------------------------------------
-- İş kazası / ramak kala
-- ---------------------------------------------------------------------
create table safety_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  kind text not null check (kind in ('KAZA', 'RAMAK_KALA', 'MESLEK_HASTALIGI')),
  occurred_at timestamptz not null,
  location text,
  description text not null,
  injury text,
  lost_days int,
  sgk_notified_on date,
  actions_taken text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table safety_incidents enable row level security;
create policy si_read on safety_incidents for select using (has_role(company_id, array['owner', 'hr', 'safety', 'branch_manager']::app_role[]));
create policy si_write on safety_incidents for all
  using (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr', 'safety']::app_role[]));

create trigger audit_training after insert or update or delete on training_records for each row execute function audit_trigger();
create trigger audit_health after insert or update or delete on health_exams for each row execute function audit_trigger();
create trigger audit_incident after insert or update or delete on safety_incidents for each row execute function audit_trigger();

-- İstirahat raporunun belgesi izin kaydında tutulur (leave_requests.document_path)
-- İSG uzmanı da rapor kayıtlarını görebilsin
create policy leave_safety_read on leave_requests for select using (has_role(company_id, array['safety']::app_role[]));
