-- =====================================================================
-- Denetim 4. adım: şirkete özel mevzuat ayarları
-- Mali müşavir görüşüne göre Yönetim > Mevzuat ayarlarından değiştirilir.
-- =====================================================================

create table if not exists company_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  -- Resmi tatil çalışması: maaşa EK, çalışılan saat × saat ücreti × bu kat (İş K. 47 → 1)
  holiday_extra_rate numeric(3,2) not null default 1 check (holiday_extra_rate between 0 and 3),
  -- Fazla mesai süresi yuvarlama: HALF_HOUR (yönetmelik) | EXACT
  overtime_rounding text not null default 'HALF_HOUR' check (overtime_rounding in ('HALF_HOUR', 'EXACT')),
  -- Fazla mesai esası: WEEKLY (haftalık 45 saat, İş K. 41) | DAILY (vardiya süresini aşan)
  overtime_basis text not null default 'WEEKLY' check (overtime_basis in ('WEEKLY', 'DAILY')),
  -- SGK işveren payı teşvik puanı: imalat 5, diğer 2, yok 0
  sgk_incentive_points numeric(3,1) not null default 5 check (sgk_incentive_points between 0 and 10),
  -- İcra 1/4'ü nafaka düşüldükten sonra kalan netten (İİK 83 yorumu)
  garnishment_after_alimony boolean not null default true,
  -- İcra 1/4'ü BES kesintisi sonrası netten
  garnishment_after_bes boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table company_settings enable row level security;

drop policy if exists cs_read on company_settings;
create policy cs_read on company_settings for select using (is_member(company_id));
drop policy if exists cs_write on company_settings;
create policy cs_write on company_settings for all
  using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

drop trigger if exists audit_company_settings on company_settings;
create trigger audit_company_settings after insert or update or delete on company_settings
  for each row execute function audit_trigger();

-- Mevcut şirketlere varsayılan satır
insert into company_settings (company_id) select id from companies on conflict do nothing;

notify pgrst, 'reload schema';
