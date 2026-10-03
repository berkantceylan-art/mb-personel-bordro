-- Varsayılan özlük belge türleri (tüm şirketler)
insert into document_types (company_id, name, category, required, has_expiry, sort_order) values
  (null, 'Kimlik fotokopisi', 'ozluk', true, false, 10),
  (null, 'Nüfus kayıt örneği', 'ozluk', true, false, 20),
  (null, 'İkametgah belgesi', 'ozluk', true, false, 30),
  (null, 'Diploma', 'ozluk', true, false, 40),
  (null, 'Vesikalık fotoğraf', 'ozluk', true, false, 50),
  (null, 'İş sözleşmesi', 'ozluk', true, false, 60),
  (null, 'SGK işe giriş bildirgesi', 'ozluk', true, false, 70),
  (null, 'KVKK aydınlatma ve açık rıza formu', 'ozluk', true, false, 80),
  (null, 'Aile durum bildirimi', 'ozluk', true, false, 90),
  (null, 'BES bilgilendirme / cayma formu', 'ozluk', false, false, 100),
  (null, 'İşe giriş sağlık raporu', 'saglik', true, true, 110),
  (null, 'Temel İSG eğitim sertifikası', 'isg', true, true, 120),
  (null, 'Zimmet tutanağı', 'ozluk', false, false, 130),
  (null, 'İbraname', 'cikis', false, false, 200),
  (null, 'SGK işten ayrılış bildirgesi', 'cikis', false, false, 210);

-- 2026 yasal parametreleri (kuruş)
insert into legal_params (year, data) values (2026, '{
  "minWageGross": 3303000,
  "sgkFloor": 3303000,
  "sgkCeiling": 29727000,
  "sgkEmployeeRate": 0.14,
  "unemploymentEmployeeRate": 0.01,
  "sgkEmployerRate": 0.2175,
  "sgkEmployerRateDiscounted": 0.1975,
  "unemploymentEmployerRate": 0.02,
  "stampTaxRate": 0.00759,
  "incomeTaxBrackets": [[19000000, 0.15], [40000000, 0.20], [150000000, 0.27], [530000000, 0.35], [null, 0.40]],
  "besDefaultRate": 0.03
}') on conflict (year) do update set data = excluded.data, updated_at = now();
