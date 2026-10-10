-- SGK entegrasyonu: işyeri hesapları (şifreler sunucuda AES-256-GCM ile şifreli), işlem günlüğü, vizite raporları,
-- tarayıcı robotu (Chrome eklentisi) için görev kuyruğu ve erişim anahtarları.
-- Şifre sütunları uygulama kullanıcılarına hiçbir şekilde okunamaz; yalnız sunucu (service role) okur.

alter table employees
  add column if not exists sgk_occupation_code text check (sgk_occupation_code is null or sgk_occupation_code ~ '^\d{4}\.\d{2}$'),
  add column if not exists sgk_duty_code int not null default 2 check (sgk_duty_code between 1 and 6),
  add column if not exists sgk_insurance_branch int not null default 0,
  add column if not exists ex_convict boolean not null default false;
alter table companies
  add column if not exists csgb_iskolu int check (csgb_iskolu between 0 and 28),
  add column if not exists sgk_araci_no int not null default 0;

create table if not exists sgk_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null default 'Ana işyeri',
  isyeri_sicil text not null,
  kullanici_adi text not null check (kullanici_adi ~ '^\d{11}$'),
  isyeri_kodu text not null check (isyeri_kodu ~ '^\d{1,4}$'),
  environment text not null default 'test' check (environment in ('test', 'canli')),
  sistem_sifre_enc text,
  isyeri_sifre_enc text,
  ws_sifre_enc text,
  has_sistem boolean not null default false,
  has_isyeri boolean not null default false,
  has_ws boolean not null default false,
  giris_wsdl text,
  cikis_wsdl text,
  vizite_url text,
  last_test_at timestamptz,
  last_test_result text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (company_id, isyeri_sicil)
);
alter table sgk_accounts enable row level security;
drop policy if exists sgk_acc_read on sgk_accounts;
create policy sgk_acc_read on sgk_accounts for select using (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));
-- Şifreli sütunlar: uygulama rolleri hiçbir sütuna doğrudan yazamaz, şifre sütunlarını okuyamaz
revoke all on sgk_accounts from anon, authenticated;
grant select (id, company_id, label, isyeri_sicil, kullanici_adi, isyeri_kodu, environment, has_sistem, has_isyeri, has_ws, giris_wsdl, cikis_wsdl, vizite_url, last_test_at, last_test_result, updated_by, updated_at) on sgk_accounts to authenticated;

create table if not exists sgk_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid references sgk_accounts(id) on delete set null,
  kind text not null,
  employee_id uuid references employees(id) on delete set null,
  environment text,
  status text not null check (status in ('basarili', 'hata', 'bekliyor', 'robot')),
  reference text,
  message text,
  request_summary jsonb,
  response jsonb,
  pdf_path text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists sgk_tx_emp_idx on sgk_transactions (employee_id, kind, created_at desc);
alter table sgk_transactions enable row level security;
drop policy if exists sgk_tx_read on sgk_transactions;
create policy sgk_tx_read on sgk_transactions for select using (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));
drop policy if exists sgk_tx_write on sgk_transactions;
create policy sgk_tx_write on sgk_transactions for insert with check (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));

create table if not exists sgk_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  tc text not null,
  ad_soyad text,
  medula_rapor_id text not null,
  rapor_takip_no text,
  vaka text,
  vaka_adi text,
  poliklinik_tar date,
  baslangic date,
  bitis date,
  ise_baslama date,
  durum text,
  tesis text,
  raw jsonb,
  onay_at timestamptz,
  onay_by uuid references auth.users(id),
  nitelik text,
  leave_request_id uuid references leave_requests(id) on delete set null,
  okundu_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, medula_rapor_id)
);
alter table sgk_reports enable row level security;
drop policy if exists sgk_rep_read on sgk_reports;
create policy sgk_rep_read on sgk_reports for select using (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));
drop policy if exists sgk_rep_write on sgk_reports;
create policy sgk_rep_write on sgk_reports for all using (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[])) with check (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));

-- Robot: kişisel erişim anahtarı (yalnız özeti saklanır) ve görev kuyruğu
create table if not exists sgk_robot_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table sgk_robot_tokens enable row level security;
drop policy if exists sgk_tok_read on sgk_robot_tokens;
create policy sgk_tok_read on sgk_robot_tokens for select using (has_role(company_id, array['owner']::app_role[]));
revoke all on sgk_robot_tokens from anon, authenticated;
grant select (id, company_id, user_id, label, created_at, last_used_at, revoked_at) on sgk_robot_tokens to authenticated;

create table if not exists sgk_robot_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid references sgk_accounts(id) on delete set null,
  kind text not null check (kind in ('giris-yap', 'toplu-giris', 'toplu-cikis', 'is-kazasi', 'vizite', 'serbest')),
  title text not null,
  target_url text,
  payload jsonb not null default '{}',
  status text not null default 'bekliyor' check (status in ('bekliyor', 'calisiyor', 'tamamlandi', 'iptal', 'hata')),
  reference text,
  result_note text,
  employee_ids uuid[] not null default '{}',
  related_id uuid,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  done_at timestamptz
);
alter table sgk_robot_jobs enable row level security;
drop policy if exists sgk_job_read on sgk_robot_jobs;
create policy sgk_job_read on sgk_robot_jobs for select using (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));
drop policy if exists sgk_job_write on sgk_robot_jobs;
create policy sgk_job_write on sgk_robot_jobs for all using (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[])) with check (has_role(company_id, array['owner', 'hr', 'accountant']::app_role[]));
