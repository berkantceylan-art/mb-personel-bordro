-- Personel kayıt sihirbazı: belge türleri adımlara bağlanır, otomatik doldurulan
-- şablonlar (iş sözleşmesi, KVKK, İSG formları…) belge türüne eşlenir.
-- Sözleşmelerde kullanılan şirket bilgileri companies tablosunda tutulur.

alter table companies
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists tax_office text,
  add column if not exists tax_no text,
  add column if not exists sgk_registration_no text;

-- Şirket bilgileri sadece sahip tarafından değiştirilir (mevcut companies_owner politikası)

alter table document_types
  -- 2 e-Devlet/kimlik · 3 sözleşmeler · 4 İSG · 5 sağlık · 6 işe giriş formları · null = sihirbazda yok (çıkış vb.)
  add column if not exists onboarding_step smallint check (onboarding_step between 2 and 6),
  -- Otomatik doldurulan şablon dosyasının anahtarı (apps/web/src/templates/ozluk)
  add column if not exists template_key text,
  add column if not exists description text;

-- Mevcut varsayılan türler: adım ve şablon
update document_types set onboarding_step = 2 where company_id is null and name in ('Kimlik fotokopisi', 'Nüfus kayıt örneği', 'İkametgah belgesi', 'Adli sicil kaydı', 'Diploma', 'Ehliyet fotokopisi', 'Askerlik durum belgesi', 'Vesikalık fotoğraf');
update document_types set onboarding_step = 3, template_key = 'is-sozlesmesi', description = 'Belirsiz süreli iş sözleşmesi; iki nüsha, her sayfası imzalanır' where company_id is null and name = 'İş sözleşmesi';
update document_types set onboarding_step = 3 where company_id is null and name in ('SGK işe giriş bildirgesi', 'Aile durum bildirimi', 'BES bilgilendirme / cayma formu');
update document_types set onboarding_step = 3, template_key = 'kvkk-acik-riza' where company_id is null and name = 'KVKK aydınlatma ve açık rıza formu';
update document_types set onboarding_step = 5 where company_id is null and name = 'İşe giriş sağlık raporu';
update document_types set onboarding_step = 4 where company_id is null and name = 'Temel İSG eğitim sertifikası';
update document_types set onboarding_step = 6 where company_id is null and name = 'Zimmet tutanağı';

-- Yeni türler
insert into document_types (company_id, name, category, required, has_expiry, sort_order, onboarding_step, template_key, description)
select * from (values
  (null::uuid, 'SGK hizmet dökümü',                               'ozluk',  false, false, 48, 2, null, 'e-Devlet → SGK Tescil ve Hizmet Dökümü'),
  (null::uuid, 'Personel gizlilik sözleşmesi',                    'ozluk',  true,  false, 61, 3, 'gizlilik-sozlesmesi', 'İki nüsha imzalanır'),
  (null::uuid, 'Fazla çalışma ve denkleştirme muvafakatnamesi',   'ozluk',  true,  false, 62, 3, 'fazla-calisma-muvafakat', 'İş Kanunu md. 41; her yıl yenilenmesi önerilir'),
  (null::uuid, 'Yıllık izin bölünerek kullandırma muvafakatnamesi','ozluk', true,  false, 63, 3, 'yillik-izin-bolme-muvafakat', null),
  (null::uuid, 'Yıllık izin erken talep formu',                   'ozluk',  false, false, 64, 3, 'yillik-izin-erken-talep', 'Yalnız izin hakkı doğmadan izin kullanacaklar için'),
  (null::uuid, 'İSG talimatı ve taahhütname',                     'isg',    true,  false, 111, 4, 'isg-talimat-taahhut', 'Tebliğ eden ve çalışan imzalar'),
  (null::uuid, 'Kişisel koruyucu malzeme teslim ve taahhüt belgesi','isg',  true,  false, 112, 4, 'kkd-taahhut', 'Teslim edilen malzemeler tabloya elle yazılır'),
  (null::uuid, 'İSG eğitim katılım formu · genel konular',        'isg',    true,  false, 113, 4, 'isg-egitim-genel', 'Eğitim tarihi ve süresi eğitmen tarafından yazılır'),
  (null::uuid, 'İSG eğitim katılım formu · teknik konular',       'isg',    true,  false, 114, 4, 'isg-egitim-teknik', null),
  (null::uuid, 'İSG eğitim katılım formu · sağlık konuları',      'isg',    true,  false, 115, 4, 'isg-egitim-saglik', null),
  (null::uuid, 'Kimyasal risk eğitimi katılım formu',             'isg',    true,  false, 116, 4, 'isg-egitim-kimyasal', null),
  (null::uuid, 'Temel İSG eğitimi sınavı',                        'isg',    true,  false, 117, 4, 'isg-sinav', 'Sınav kâğıdı çıktı alınır, personel çözer, kâğıt taranıp yüklenir'),
  (null::uuid, 'İşe giriş / periyodik muayene formu',             'saglik', true,  true,  109, 5, 'ise-giris-muayene', 'İşyeri hekimi doldurur ve imzalar'),
  (null::uuid, 'Aşı kartı / kan grubu kartı',                     'saglik', false, false, 118, 5, null, null),
  (null::uuid, 'İş başvuru ve bilgi formu',                       'ozluk',  true,  false, 5,   6, 'is-basvuru-formu', 'Personel eksik alanları elle tamamlar ve imzalar')
) as v(company_id, name, category, required, has_expiry, sort_order, onboarding_step, template_key, description)
where not exists (select 1 from document_types d where d.company_id is null and d.name = v.name);

-- Personel kayıt sihirbazı tamamlanma durumu
alter table employees add column if not exists onboarding_done_at timestamptz;
