-- =====================================================================
-- GENEL MUHASEBE · Paket 1: çekirdek
--  ledger modülü (yetki)                     : sahip ve muhasebeci varsayılan "yönetir"
--  gl_accounts                                : hesap planı (Tek Düzen Hesap Planı 7/A ana hesapları + alt hesaplar);
--                                               kasa / banka / kart ve cariler için alt hesap kendiliğinden açılır (120.0001 …)
--  gl_maps                                    : eşleştirme: ERP hesabı / cari / kategori / hesap türü / cari türü / özel kaynak → hesap
--  gl_settings                                : açık-kapalı, başlangıç tarihi, dönem kilidi, muhasebe dışı kategori kodları
--  gl_vouchers / gl_lines                     : muhasebe fişleri (mahsup, tahsil, tediye, açılış, kapanış); borç = alacak denetimi
--  Otomatik muhasebeleştirme                  : her finans işlemi (fatura, e-fatura, tahsilat, ödeme, banka, kart, çek, kredi,
--                                               maaş ödemesi, amortisman …) kaydedilince arka planda fişe döner; iptalinde fiş iptal,
--                                               kilitli dönemde ters kayıt. Fişli cari, iç hesap, yansıtma kayıtları muhasebe dışı.
--  gl_backfill / gl_repost_pending            : geçmiş kayıtları fişe çevir; eşleşmeyenleri yeniden dene
--  gl_voucher_save / gl_voucher_cancel        : elle fiş
--  gl_opening_draft                           : başlangıç tarihindeki ERP bakiyelerinden açılış fişi taslağı
-- Tekrar çalıştırılabilir. Önce 20270205000000_uts.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) ledger modülü
-- ---------------------------------------------------------------------
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'module_permissions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%module%in%';
  if c is not null then execute format('alter table module_permissions drop constraint %I', c); end if;
end $$;
alter table module_permissions add constraint module_permissions_module_check
  check (module in ('hr', 'attendance', 'payroll', 'safety', 'lab', 'finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users', 'ledger'));

create or replace function all_modules() returns text[] language sql immutable as $$
  select array['hr', 'attendance', 'payroll', 'safety', 'lab', 'finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users', 'ledger'];
$$;

create or replace function module_default_level(p_role text, p_logistics boolean, p_module text) returns smallint
language sql immutable as $$
  select greatest(
    case p_role
      when 'owner' then 3
      when 'accountant' then case
        when p_module in ('finance', 'sales', 'purchases', 'expenses', 'assets', 'payroll', 'ledger') then 3
        when p_module in ('stock', 'hr', 'attendance', 'lab') then 2
        when p_module in ('production', 'safety') then 1 else 0 end
      when 'branch_manager' then case
        when p_module in ('stock', 'production', 'hr', 'attendance', 'lab') then 2
        when p_module in ('sales', 'purchases', 'expenses', 'assets', 'safety') then 1 else 0 end
      when 'hr' then case
        when p_module in ('hr', 'attendance', 'safety') then 3
        when p_module in ('lab', 'users') then 2
        when p_module in ('assets', 'expenses', 'payroll') then 1 else 0 end
      when 'safety' then case when p_module = 'safety' then 3 when p_module in ('hr', 'attendance') then 1 else 0 end
      else 0 end,
    case when coalesce(p_logistics, false) and p_module in ('stock', 'production', 'lab') then 2 else 0 end
  )::smallint;
$$;

-- ---------------------------------------------------------------------
-- 1) Hesap planı
-- ---------------------------------------------------------------------
create table if not exists gl_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  code text not null check (code ~ '^[1-9][0-9]{2}(\.[0-9A-Za-z]{1,8}){0,4}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  parent_id uuid references gl_accounts (id) on delete restrict,
  kind text not null check (kind in ('asset', 'liability', 'equity', 'income', 'expense', 'cost', 'memo')),
  normal_side char(1) not null default 'D' check (normal_side in ('D', 'C')),
  postable boolean not null default true,
  currency text check (currency is null or currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  link_type text check (link_type is null or link_type in ('fin_account', 'party')),
  link_id uuid,
  is_system boolean not null default false,
  is_active boolean not null default true,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (company_id, code)
);
create unique index if not exists gl_accounts_link_uidx on gl_accounts (company_id, link_type, link_id) where link_id is not null;
create index if not exists gl_accounts_parent_idx on gl_accounts (parent_id);

create or replace function gl_kind_of(p_code text) returns text language sql immutable as $$
  select case left(p_code, 1) when '1' then 'asset' when '2' then 'asset' when '3' then 'liability' when '4' then 'liability' when '5' then 'equity'
    when '6' then case when left(p_code, 2) in ('60', '64', '67') then 'income' when left(p_code, 2) = '69' then 'equity' else 'expense' end
    when '7' then 'cost' else 'memo' end;
$$;
-- Normal bakiye: aktif / gider borç; pasif / gelir alacak; (-) düzenleyici hesaplar ters; 7xx yansıtma (çift son hane) alacak
create or replace function gl_side_of(p_code text, p_name text) returns char language sql immutable as $$
  select case
    when left(p_code, 1) = '7' then case when substr(p_code, 3, 1) in ('1', '3', '5', '7', '9') then 'C' else 'D' end
    when p_name ~ '\(-\)' then case when left(p_code, 1) in ('1', '2', '6') then 'C' else 'D' end
    when left(p_code, 1) in ('1', '2') then 'D'
    when left(p_code, 1) in ('3', '4', '5') then 'C'
    when left(p_code, 2) in ('60', '64', '67') then 'C'
    when left(p_code, 1) = '6' then 'D'
    else 'D' end::char;
$$;

-- Alt hesap eklenince üst hesap kayıt kabul etmez (bilgi amaçlı; otomatik kayıt her zaman en alt hesaba)
create or replace function gl_accounts_parent_flag() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then update gl_accounts set postable = false where id = new.parent_id and postable; end if;
  return new;
end $$;
drop trigger if exists gl_accounts_parent_flag on gl_accounts;
create trigger gl_accounts_parent_flag after insert or update of parent_id on gl_accounts for each row execute function gl_accounts_parent_flag();

-- Tek Düzen Hesap Planı ana hesapları (3 haneli)
create or replace function gl_tdhp() returns table (code text, name text) language sql immutable as $$
  select * from (values
  ('100','Kasa'),('101','Alınan Çekler'),('102','Bankalar'),('103','Verilen Çekler ve Ödeme Emirleri (-)'),('108','Diğer Hazır Değerler'),
  ('110','Hisse Senetleri'),('111','Özel Kesim Tahvil Senet ve Bonoları'),('112','Kamu Kesimi Tahvil Senet ve Bonoları'),('118','Diğer Menkul Kıymetler'),('119','Menkul Kıymetler Değer Düşüklüğü Karşılığı (-)'),
  ('120','Alıcılar'),('121','Alacak Senetleri'),('122','Alacak Senetleri Reeskontu (-)'),('124','Kazanılmamış Finansal Kiralama Faiz Gelirleri (-)'),('126','Verilen Depozito ve Teminatlar'),('127','Diğer Ticari Alacaklar'),('128','Şüpheli Ticari Alacaklar'),('129','Şüpheli Ticari Alacaklar Karşılığı (-)'),
  ('131','Ortaklardan Alacaklar'),('132','İştiraklerden Alacaklar'),('133','Bağlı Ortaklıklardan Alacaklar'),('135','Personelden Alacaklar'),('136','Diğer Çeşitli Alacaklar'),('137','Diğer Alacak Senetleri Reeskontu (-)'),('138','Şüpheli Diğer Alacaklar'),('139','Şüpheli Diğer Alacaklar Karşılığı (-)'),
  ('150','İlk Madde ve Malzeme'),('151','Yarı Mamuller - Üretim'),('152','Mamuller'),('153','Ticari Mallar'),('157','Diğer Stoklar'),('158','Stok Değer Düşüklüğü Karşılığı (-)'),('159','Verilen Sipariş Avansları'),
  ('180','Gelecek Aylara Ait Giderler'),('181','Gelir Tahakkukları'),
  ('190','Devreden KDV'),('191','İndirilecek KDV'),('192','Diğer KDV'),('193','Peşin Ödenen Vergiler ve Fonlar'),('195','İş Avansları'),('196','Personel Avansları'),('197','Sayım ve Tesellüm Noksanları'),('198','Diğer Çeşitli Dönen Varlıklar'),('199','Diğer Dönen Varlıklar Karşılığı (-)'),
  ('220','Alıcılar'),('221','Alacak Senetleri'),('226','Verilen Depozito ve Teminatlar'),('231','Ortaklardan Alacaklar'),('235','Personelden Alacaklar'),('236','Diğer Çeşitli Alacaklar'),
  ('240','Bağlı Menkul Kıymetler'),('242','İştirakler'),('245','Bağlı Ortaklıklar'),
  ('250','Arazi ve Arsalar'),('251','Yeraltı ve Yerüstü Düzenleri'),('252','Binalar'),('253','Tesis, Makine ve Cihazlar'),('254','Taşıtlar'),('255','Demirbaşlar'),('256','Diğer Maddi Duran Varlıklar'),('257','Birikmiş Amortismanlar (-)'),('258','Yapılmakta Olan Yatırımlar'),('259','Verilen Avanslar'),
  ('260','Haklar'),('261','Şerefiye'),('262','Kuruluş ve Örgütlenme Giderleri'),('263','Araştırma ve Geliştirme Giderleri'),('264','Özel Maliyetler'),('267','Diğer Maddi Olmayan Duran Varlıklar'),('268','Birikmiş Amortismanlar (-)'),('269','Verilen Avanslar'),
  ('280','Gelecek Yıllara Ait Giderler'),('281','Gelir Tahakkukları'),('291','Gelecek Yıllarda İndirilecek KDV'),('292','Diğer KDV'),('294','Elden Çıkarılacak Stoklar ve Maddi Duran Varlıklar'),('295','Peşin Ödenen Vergi ve Fonlar'),
  ('300','Banka Kredileri'),('301','Finansal Kiralama İşlemlerinden Borçlar'),('302','Ertelenmiş Finansal Kiralama Borçlanma Maliyetleri (-)'),('303','Uzun Vadeli Kredilerin Anapara Taksitleri ve Faizleri'),('304','Tahvil Anapara Borç, Taksit ve Faizleri'),('309','Diğer Mali Borçlar'),
  ('320','Satıcılar'),('321','Borç Senetleri'),('322','Borç Senetleri Reeskontu (-)'),('326','Alınan Depozito ve Teminatlar'),('329','Diğer Ticari Borçlar'),
  ('331','Ortaklara Borçlar'),('332','İştiraklere Borçlar'),('333','Bağlı Ortaklıklara Borçlar'),('335','Personele Borçlar'),('336','Diğer Çeşitli Borçlar'),('337','Diğer Borç Senetleri Reeskontu (-)'),
  ('340','Alınan Sipariş Avansları'),('349','Alınan Diğer Avanslar'),
  ('360','Ödenecek Vergi ve Fonlar'),('361','Ödenecek Sosyal Güvenlik Kesintileri'),('368','Vadesi Geçmiş, Ertelenmiş veya Taksitlendirilmiş Vergi ve Diğer Yükümlülükler'),('369','Ödenecek Diğer Yükümlülükler'),
  ('370','Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları'),('371','Dönem Kârının Peşin Ödenen Vergi ve Diğer Yükümlülükleri (-)'),('372','Kıdem Tazminatı Karşılığı'),('373','Maliyet Giderleri Karşılığı'),('379','Diğer Borç ve Gider Karşılıkları'),
  ('380','Gelecek Aylara Ait Gelirler'),('381','Gider Tahakkukları'),
  ('391','Hesaplanan KDV'),('392','Diğer KDV'),('393','Merkez ve Şubeler Cari Hesabı'),('397','Sayım ve Tesellüm Fazlaları'),('399','Diğer Çeşitli Yabancı Kaynaklar'),
  ('400','Banka Kredileri'),('401','Finansal Kiralama İşlemlerinden Borçlar'),('405','Çıkarılmış Tahviller'),('409','Diğer Mali Borçlar'),('420','Satıcılar'),('421','Borç Senetleri'),('426','Alınan Depozito ve Teminatlar'),('429','Diğer Ticari Borçlar'),
  ('431','Ortaklara Borçlar'),('436','Diğer Çeşitli Borçlar'),('440','Alınan Sipariş Avansları'),('472','Kıdem Tazminatı Karşılığı'),('479','Diğer Borç ve Gider Karşılıkları'),('480','Gelecek Yıllara Ait Gelirler'),('481','Gider Tahakkukları'),
  ('492','Gelecek Yıllara Ertelenen veya Terkin Edilecek KDV'),('499','Diğer Çeşitli Uzun Vadeli Yabancı Kaynaklar'),
  ('500','Sermaye'),('501','Ödenmemiş Sermaye (-)'),('502','Sermaye Düzeltmesi Olumlu Farkları'),('503','Sermaye Düzeltmesi Olumsuz Farkları (-)'),
  ('520','Hisse Senedi İhraç Primleri'),('522','Maddi Duran Varlık Yeniden Değerleme Artışları'),('529','Diğer Sermaye Yedekleri'),
  ('540','Yasal Yedekler'),('541','Statü Yedekleri'),('542','Olağanüstü Yedekler'),('548','Diğer Kâr Yedekleri'),('549','Özel Fonlar'),
  ('570','Geçmiş Yıllar Kârları'),('580','Geçmiş Yıllar Zararları (-)'),('590','Dönem Net Kârı'),('591','Dönem Net Zararı (-)'),
  ('600','Yurtiçi Satışlar'),('601','Yurtdışı Satışlar'),('602','Diğer Gelirler'),('610','Satıştan İadeler (-)'),('611','Satış İskontoları (-)'),('612','Diğer İndirimler (-)'),
  ('620','Satılan Mamuller Maliyeti (-)'),('621','Satılan Ticari Mallar Maliyeti (-)'),('622','Satılan Hizmet Maliyeti (-)'),('623','Diğer Satışların Maliyeti (-)'),
  ('630','Araştırma ve Geliştirme Giderleri (-)'),('631','Pazarlama, Satış ve Dağıtım Giderleri (-)'),('632','Genel Yönetim Giderleri (-)'),
  ('640','İştiraklerden Temettü Gelirleri'),('641','Bağlı Ortaklıklardan Temettü Gelirleri'),('642','Faiz Gelirleri'),('643','Komisyon Gelirleri'),('644','Konusu Kalmayan Karşılıklar'),('645','Menkul Kıymet Satış Kârları'),('646','Kambiyo Kârları'),('647','Reeskont Faiz Gelirleri'),('648','Enflasyon Düzeltmesi Kârları'),('649','Diğer Olağan Gelir ve Kârlar'),
  ('653','Komisyon Giderleri (-)'),('654','Karşılık Giderleri (-)'),('655','Menkul Kıymet Satış Zararları (-)'),('656','Kambiyo Zararları (-)'),('657','Reeskont Faiz Giderleri (-)'),('658','Enflasyon Düzeltmesi Zararları (-)'),('659','Diğer Olağan Gider ve Zararlar (-)'),
  ('660','Kısa Vadeli Borçlanma Giderleri (-)'),('661','Uzun Vadeli Borçlanma Giderleri (-)'),('671','Önceki Dönem Gelir ve Kârları'),('679','Diğer Olağandışı Gelir ve Kârlar'),
  ('680','Çalışmayan Kısım Gider ve Zararları (-)'),('681','Önceki Dönem Gider ve Zararları (-)'),('689','Diğer Olağandışı Gider ve Zararlar (-)'),
  ('690','Dönem Kârı veya Zararı'),('691','Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)'),('692','Dönem Net Kârı veya Zararı'),('697','Yıllara Yaygın İnşaat Enflasyon Düzeltme Hesabı'),('698','Enflasyon Düzeltme Hesabı'),
  ('710','Direkt İlk Madde ve Malzeme Giderleri'),('711','Direkt İlk Madde ve Malzeme Yansıtma Hesabı'),('720','Direkt İşçilik Giderleri'),('721','Direkt İşçilik Giderleri Yansıtma Hesabı'),
  ('730','Genel Üretim Giderleri'),('731','Genel Üretim Giderleri Yansıtma Hesabı'),('740','Hizmet Üretim Maliyeti'),('741','Hizmet Üretim Maliyeti Yansıtma Hesabı'),
  ('750','Araştırma ve Geliştirme Giderleri'),('751','Araştırma ve Geliştirme Giderleri Yansıtma Hesabı'),('760','Pazarlama, Satış ve Dağıtım Giderleri'),('761','Pazarlama, Satış ve Dağıtım Giderleri Yansıtma Hesabı'),
  ('770','Genel Yönetim Giderleri'),('771','Genel Yönetim Giderleri Yansıtma Hesabı'),('780','Finansman Giderleri'),('781','Finansman Giderleri Yansıtma Hesabı'),
  ('900','Borçlu Nazım Hesaplar'),('901','Alacaklı Nazım Hesaplar')
  ) v(code, name);
$$;

-- Hesap grupları (rapor başlıkları: 1 ve 2 haneli)
create or replace function gl_group_name(p_code text) returns text language sql immutable as $$
  select case p_code
    when '1' then 'DÖNEN VARLIKLAR' when '2' then 'DURAN VARLIKLAR' when '3' then 'KISA VADELİ YABANCI KAYNAKLAR' when '4' then 'UZUN VADELİ YABANCI KAYNAKLAR'
    when '5' then 'ÖZKAYNAKLAR' when '6' then 'GELİR TABLOSU HESAPLARI' when '7' then 'MALİYET HESAPLARI' when '9' then 'NAZIM HESAPLAR'
    when '10' then 'Hazır Değerler' when '11' then 'Menkul Kıymetler' when '12' then 'Ticari Alacaklar' when '13' then 'Diğer Alacaklar' when '15' then 'Stoklar'
    when '17' then 'Yıllara Yaygın İnşaat ve Onarım Maliyetleri' when '18' then 'Gelecek Aylara Ait Giderler ve Gelir Tahakkukları' when '19' then 'Diğer Dönen Varlıklar'
    when '22' then 'Ticari Alacaklar' when '23' then 'Diğer Alacaklar' when '24' then 'Mali Duran Varlıklar' when '25' then 'Maddi Duran Varlıklar'
    when '26' then 'Maddi Olmayan Duran Varlıklar' when '27' then 'Özel Tükenmeye Tabi Varlıklar' when '28' then 'Gelecek Yıllara Ait Giderler ve Gelir Tahakkukları' when '29' then 'Diğer Duran Varlıklar'
    when '30' then 'Mali Borçlar' when '32' then 'Ticari Borçlar' when '33' then 'Diğer Borçlar' when '34' then 'Alınan Avanslar' when '35' then 'Yıllara Yaygın İnşaat ve Onarım Hakedişleri'
    when '36' then 'Ödenecek Vergi ve Diğer Yükümlülükler' when '37' then 'Borç ve Gider Karşılıkları' when '38' then 'Gelecek Aylara Ait Gelirler ve Gider Tahakkukları' when '39' then 'Diğer Kısa Vadeli Yabancı Kaynaklar'
    when '40' then 'Mali Borçlar' when '42' then 'Ticari Borçlar' when '43' then 'Diğer Borçlar' when '44' then 'Alınan Avanslar' when '47' then 'Borç ve Gider Karşılıkları'
    when '48' then 'Gelecek Yıllara Ait Gelirler ve Gider Tahakkukları' when '49' then 'Diğer Uzun Vadeli Yabancı Kaynaklar'
    when '50' then 'Ödenmiş Sermaye' when '52' then 'Sermaye Yedekleri' when '54' then 'Kâr Yedekleri' when '57' then 'Geçmiş Yıllar Kârları' when '58' then 'Geçmiş Yıllar Zararları (-)' when '59' then 'Dönem Net Kârı (Zararı)'
    when '60' then 'Brüt Satışlar' when '61' then 'Satış İndirimleri (-)' when '62' then 'Satışların Maliyeti (-)' when '63' then 'Faaliyet Giderleri (-)'
    when '64' then 'Diğer Faaliyetlerden Olağan Gelir ve Kârlar' when '65' then 'Diğer Faaliyetlerden Olağan Gider ve Zararlar (-)' when '66' then 'Finansman Giderleri (-)'
    when '67' then 'Olağandışı Gelir ve Kârlar' when '68' then 'Olağandışı Gider ve Zararlar (-)' when '69' then 'Dönem Net Kârı veya Zararı'
    when '71' then 'Direkt İlk Madde ve Malzeme Giderleri' when '72' then 'Direkt İşçilik Giderleri' when '73' then 'Genel Üretim Giderleri' when '74' then 'Hizmet Üretim Maliyeti'
    when '75' then 'Araştırma ve Geliştirme Giderleri' when '76' then 'Pazarlama, Satış ve Dağıtım Giderleri' when '77' then 'Genel Yönetim Giderleri' when '78' then 'Finansman Giderleri'
    else null end;
$$;

-- ---------------------------------------------------------------------
-- 2) Ayarlar ve eşleştirme
-- ---------------------------------------------------------------------
create table if not exists gl_settings (
  company_id uuid primary key references companies (id) on delete cascade,
  enabled boolean not null default false,
  start_date date not null default date_trunc('year', current_date)::date,
  lock_date date,
  exclude_codes text[] not null default array['internal_collection', 'slip_mirror'],
  export_format text not null default 'luca' check (export_format in ('luca', 'zirve', 'generic')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- source: fin_account | party | category (key = id) · account_kind | party_kind | category_code | category_kind | ref (key = metin)
create table if not exists gl_maps (
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  source text not null check (source in ('fin_account', 'party', 'category', 'account_kind', 'party_kind', 'category_code', 'category_kind', 'ref')),
  key text not null check (length(key) between 1 and 80),
  account_id uuid not null references gl_accounts (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (company_id, source, key)
);

-- Şirket için hesap planı ve varsayılan eşleştirmeler (bir kez; mevcut kayıtlar korunur)
create or replace function gl_seed(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  insert into gl_accounts (company_id, code, name, kind, normal_side, is_system)
  select p_company, t.code, t.name, gl_kind_of(t.code), gl_side_of(t.code, t.name), true from gl_tdhp() t
  on conflict (company_id, code) do nothing;
  insert into gl_settings (company_id) values (p_company) on conflict do nothing;
  for r in select * from (values
    ('account_kind', 'cash', '100'), ('account_kind', 'bank', '102'), ('account_kind', 'pos', '108'), ('account_kind', 'credit_card', '309'),
    ('account_kind', 'loan', '300'), ('account_kind', 'partner', '331'), ('account_kind', 'advance', '196'), ('account_kind', 'cheque_in', '101'), ('account_kind', 'cheque_out', '103'),
    ('party_kind', 'customer', '120'), ('party_kind', 'both', '120'), ('party_kind', 'supplier', '320'), ('party_kind', 'other', '336'),
    ('category_code', 'sales_prosthesis', '600'), ('category_code', 'sales_goods', '600'), ('category_code', 'income_other', '649'), ('category_code', 'income_interest', '642'),
    ('category_code', 'fx_gain', '646'), ('category_code', 'fx_loss', '656'), ('category_code', 'exp_interest', '780'), ('category_code', 'exp_bank', '780'),
    ('category_code', 'exp_marketing', '760'), ('category_code', 'exp_cargo', '760'), ('category_code', 'cogs', '621'), ('category_code', 'vat_in', '191'), ('category_code', 'vat_out', '391'),
    ('category_code', 'stock', '150'), ('category_code', 'fixed_assets', '255'), ('category_code', 'capital', '500'), ('category_code', 'exp_depreciation', '770'),
    ('category_kind', 'income', '600'), ('category_kind', 'expense', '770'), ('category_kind', 'vat_in', '191'), ('category_kind', 'vat_out', '391'), ('category_kind', 'stock', '150'),
    ('ref', 'payroll:exp_salary', '335'), ('ref', 'payroll_bank:exp_salary', '335'), ('ref', 'payroll_remit:sgk', '361'), ('ref', 'payroll_remit:vergi', '360'),
    ('ref', 'payroll_remit:bes', '369'), ('ref', 'payroll_remit:icra', '369'), ('ref', 'depreciation:fixed_assets', '257'), ('ref', 'export_sales', '601')
  ) v(source, key, code) loop
    insert into gl_maps (company_id, source, key, account_id)
    select p_company, r.source, r.key, a.id from gl_accounts a where a.company_id = p_company and a.code = r.code
    on conflict do nothing;
  end loop;
end $$;
revoke execute on function gl_seed(uuid) from public, anon, authenticated;

do $$ declare c record; begin
  for c in select id from companies loop perform gl_seed(c.id); end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Fişler
-- ---------------------------------------------------------------------
create table if not exists gl_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null,
  no int not null,
  journal_no int,                                   -- yevmiye madde no (dönem numaralandırmasında verilir)
  voucher_date date not null,
  kind text not null default 'mahsup' check (kind in ('mahsup', 'tahsil', 'tediye', 'acilis', 'kapanis')),
  source text not null default 'auto' check (source in ('auto', 'manual', 'opening', 'closing', 'fx', 'payroll', 'reversal')),
  status text not null default 'posted' check (status in ('posted', 'pending', 'excluded', 'cancelled')),
  description text check (description is null or length(description) <= 500),
  issues text check (issues is null or length(issues) <= 1000),
  doc_type text check (doc_type is null or doc_type in ('invoice', 'check', 'note', 'receipt', 'voucher', 'other')),
  doc_no text check (doc_no is null or length(doc_no) <= 60),
  doc_date date,
  fin_txn_id uuid unique references fin_txns (id) on delete set null,
  reversal_of uuid references gl_vouchers (id) on delete set null,
  total bigint not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, year, no)
);
create index if not exists gl_vouchers_date_idx on gl_vouchers (company_id, voucher_date, no);
create index if not exists gl_vouchers_status_idx on gl_vouchers (company_id, status);

create table if not exists gl_lines (
  id bigint generated by default as identity primary key,
  voucher_id uuid not null references gl_vouchers (id) on delete cascade,
  sort int not null default 0,
  account_id uuid not null references gl_accounts (id) on delete restrict,
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  currency text not null default 'TRY',
  fx_amount bigint,
  rate numeric(18, 6),
  description text check (description is null or length(description) <= 300),
  party_id uuid references fin_parties (id) on delete set null,
  fin_move_id bigint,
  check (debit = 0 or credit = 0)
);
create index if not exists gl_lines_voucher_idx on gl_lines (voucher_id, sort);
create index if not exists gl_lines_account_idx on gl_lines (account_id);

create or replace function gl_next_no(p_company uuid, p_year int) returns int language sql volatile security definer set search_path = public as $$
  select coalesce(max(no), 0) + 1 from gl_vouchers where company_id = p_company and year = p_year;
$$;
revoke execute on function gl_next_no(uuid, int) from public, anon, authenticated;

-- Borç = alacak (fiş kesinleşince, işlem sonunda)
create or replace function gl_balance_check() returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.voucher_id, old.voucher_id); d bigint; c bigint; st text;
begin
  select status into st from gl_vouchers where id = v;
  if st is distinct from 'posted' then return null; end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from gl_lines where voucher_id = v;
  if d <> c then raise exception 'gl_unbalanced:% / %', d, c; end if;
  update gl_vouchers set total = d where id = v and total <> d;
  return null;
end $$;
drop trigger if exists gl_balance_check on gl_lines;
create constraint trigger gl_balance_check after insert or update or delete on gl_lines deferrable initially deferred for each row execute function gl_balance_check();

-- Kilitli dönem: o tarihe kadar fiş eklenemez / değişmez
create or replace function gl_locked(p_company uuid, p_date date) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_date <= (select lock_date from gl_settings where company_id = p_company), false);
$$;
create or replace function gl_lock_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('gl.unlock', true) = 'on' then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and gl_locked(old.company_id, old.voucher_date) and (tg_op = 'DELETE' or new.status <> old.status or new.voucher_date <> old.voucher_date) then
    raise exception 'gl_locked';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and gl_locked(new.company_id, new.voucher_date) and new.status = 'posted' and (tg_op = 'INSERT' or new.voucher_date <> old.voucher_date) then
    raise exception 'gl_locked';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists gl_lock_guard on gl_vouchers;
create trigger gl_lock_guard before insert or update or delete on gl_vouchers for each row execute function gl_lock_guard();

alter table gl_accounts enable row level security;
alter table gl_settings enable row level security;
alter table gl_maps enable row level security;
alter table gl_vouchers enable row level security;
alter table gl_lines enable row level security;
drop policy if exists gl_accounts_read on gl_accounts;
create policy gl_accounts_read on gl_accounts for select to authenticated using (company_id = lab_company() and (can_module('ledger') or can_module('finance')));
drop policy if exists gl_settings_read on gl_settings;
create policy gl_settings_read on gl_settings for select to authenticated using (company_id = lab_company() and can_module('ledger'));
drop policy if exists gl_maps_read on gl_maps;
create policy gl_maps_read on gl_maps for select to authenticated using (company_id = lab_company() and can_module('ledger'));
drop policy if exists gl_vouchers_read on gl_vouchers;
create policy gl_vouchers_read on gl_vouchers for select to authenticated using (company_id = lab_company() and can_module('ledger'));
drop policy if exists gl_lines_read on gl_lines;
create policy gl_lines_read on gl_lines for select to authenticated using (exists (select 1 from gl_vouchers v where v.id = voucher_id));
grant select on gl_accounts, gl_settings, gl_maps, gl_vouchers, gl_lines to authenticated;
drop trigger if exists audit_gl_vouchers on gl_vouchers;
create trigger audit_gl_vouchers after insert or update or delete on gl_vouchers for each row execute function audit_trigger();
drop trigger if exists audit_gl_accounts on gl_accounts;
create trigger audit_gl_accounts after insert or update or delete on gl_accounts for each row execute function audit_trigger();

-- ---------------------------------------------------------------------
-- 4) Hesap çözümleme
-- ---------------------------------------------------------------------
create or replace function gl_map_get(p_company uuid, p_source text, p_key text) returns uuid language sql stable security definer set search_path = public as $$
  select account_id from gl_maps where company_id = p_company and source = p_source and key = p_key;
$$;

-- Bir kök hesabın altında bağlı (kasa / banka / cari) alt hesap: varsa onu, yoksa açar
create or replace function gl_link_account(p_company uuid, p_root uuid, p_type text, p_id uuid, p_name text, p_currency text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; r gl_accounts; n int; w int;
begin
  select id into v from gl_accounts where company_id = p_company and link_type = p_type and link_id = p_id;
  if v is not null then return v; end if;
  select * into r from gl_accounts where id = p_root;
  if r.id is null then return null; end if;
  -- kök zaten bağlı bir alt hesapsa (elle eşleştirilmiş) onu kullan
  if r.link_id is not null or (r.code ~ '\.' and not exists (select 1 from gl_accounts c where c.parent_id = r.id)) then return r.id; end if;
  w := case when p_type = 'party' then 4 else 3 end;
  select coalesce(max(nullif(regexp_replace(substr(code, length(r.code) + 2), '\D', '', 'g'), '')::int), 0) + 1 into n
  from gl_accounts where company_id = p_company and parent_id = r.id and code ~ ('^' || replace(r.code, '.', '\.') || '\.[0-9]+$');
  insert into gl_accounts (company_id, code, name, parent_id, kind, normal_side, currency, link_type, link_id)
  values (p_company, r.code || '.' || lpad(n::text, w, '0'), left(coalesce(nullif(trim(p_name), ''), r.name), 160), r.id, r.kind, r.normal_side,
          case when p_currency is not null and p_currency <> 'TRY' then p_currency end, p_type, p_id)
  on conflict do nothing
  returning id into v;
  if v is null then select id into v from gl_accounts where company_id = p_company and link_type = p_type and link_id = p_id; end if;
  return v;
end $$;
revoke execute on function gl_link_account(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;

create or replace function gl_resolve(p_company uuid, m fin_moves, t fin_txns) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; a fin_accounts; p fin_parties; c fin_categories; k text;
begin
  if m.account_id is not null then
    select * into a from fin_accounts where id = m.account_id;
    v := gl_map_get(p_company, 'fin_account', a.id::text);
    if v is not null then return gl_link_account(p_company, v, 'fin_account', a.id, a.name || coalesce(' · ' || nullif(a.currency, 'TRY'), ''), a.currency); end if;
    v := gl_map_get(p_company, 'account_kind', a.kind);
    if v is null then return null; end if;
    return gl_link_account(p_company, v, 'fin_account', a.id, a.name || coalesce(' · ' || nullif(a.currency, 'TRY'), ''), a.currency);
  elsif m.party_id is not null then
    select * into p from fin_parties where id = m.party_id;
    v := coalesce(gl_map_get(p_company, 'party', p.id::text), gl_map_get(p_company, 'party_kind', p.kind));
    if v is null then return null; end if;
    return gl_link_account(p_company, v, 'party', p.id, p.name, p.currency);
  else
    select * into c from fin_categories where id = m.category_id;
    -- özel kaynak: maaş ödemesi → 335, SGK / vergi ödemesi → 361 / 360, amortisman karşılığı → 257
    if t.ref_type = 'payroll_remit' then
      select r.kind into k from payroll_remittances r where r.id = t.ref_id;
      v := gl_map_get(p_company, 'ref', 'payroll_remit:' || coalesce(k, ''));
      if v is not null then return v; end if;
    elsif t.ref_type is not null then
      v := gl_map_get(p_company, 'ref', t.ref_type || ':' || c.code);
      if v is not null then return v; end if;
    end if;
    v := coalesce(gl_map_get(p_company, 'category', c.id::text), gl_map_get(p_company, 'category_code', c.code));
    if v is null and c.parent_id is not null then
      v := coalesce(gl_map_get(p_company, 'category', c.parent_id::text), gl_map_get(p_company, 'category_code', (select code from fin_categories where id = c.parent_id)));
    end if;
    if v is null and c.kind not in ('equity', 'other') then v := gl_map_get(p_company, 'category_kind', c.kind); end if;
    -- yurt dışı müşteriye satış → 601
    if v is not null and (select code from gl_accounts where id = v) = '600' and t.party_id is not null
       and coalesce((select upper(country) from fin_parties where id = t.party_id), 'TR') not in ('TR', 'TÜRKİYE', 'TURKIYE', 'TURKEY', '') then
      v := coalesce(gl_map_get(p_company, 'ref', 'export_sales'), v);
    end if;
    return v;
  end if;
end $$;
revoke execute on function gl_resolve(uuid, fin_moves, fin_txns) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Otomatik muhasebeleştirme
-- ---------------------------------------------------------------------
create or replace function gl_post_txn(p_txn uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t fin_txns; s gl_settings; v gl_vouchers; m fin_moves; acc uuid; miss text[] := '{}'; v_id uuid; v_kind text := 'mahsup';
  v_doc_type text; v_doc_no text; v_doc_date date; excl text; n int := 0; cash_in boolean := false; cash_out boolean := false; inv record; v_rd date; dsum bigint; csum bigint;
begin
  select * into t from fin_txns where id = p_txn;
  if t.id is null then return null; end if;
  select * into s from gl_settings where company_id = t.company_id;
  if s.company_id is null or not s.enabled or t.txn_date < s.start_date then return null; end if;
  select * into v from gl_vouchers where fin_txn_id = t.id;

  -- iptal edilen işlem
  if t.voided_at is not null then
    if v.id is null or v.status = 'cancelled' then return v.id; end if;
    if v.status = 'posted' and gl_locked(t.company_id, v.voucher_date) then
      if not exists (select 1 from gl_vouchers where reversal_of = v.id) then
        v_rd := greatest(current_date, s.lock_date + 1);
        insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, doc_type, doc_no, doc_date, reversal_of)
        values (t.company_id, extract(year from v_rd)::int, gl_next_no(t.company_id, extract(year from v_rd)::int), v_rd, 'mahsup', 'reversal', 'posted',
                left('Ters kayıt · ' || coalesce(v.description, ''), 500), v.doc_type, v.doc_no, v.doc_date, v.id)
        returning id into v_id;
        insert into gl_lines (voucher_id, sort, account_id, debit, credit, currency, fx_amount, rate, description, party_id)
        select v_id, sort, account_id, credit, debit, currency, -fx_amount, rate, description, party_id from gl_lines where voucher_id = v.id;
      end if;
      return v.id;
    end if;
    update gl_vouchers set status = 'cancelled', issues = null, updated_at = now() where id = v.id;
    return v.id;
  end if;
  if v.id is not null and (v.status = 'cancelled' or (v.status = 'posted' and gl_locked(t.company_id, v.voucher_date))) then return v.id; end if;

  -- muhasebe dışı (resmi olmayan) kayıtlar
  excl := case
    when t.ref_type in ('mirror', 'sup_slip') then 'Fişli / yansıtma kaydı'
    when t.kind = 'purchase_slip' then 'Fişli alım'
    when exists (select 1 from fin_moves mm join fin_categories c on c.id = mm.category_id where mm.txn_id = t.id and c.code = any (s.exclude_codes)) then 'Muhasebe dışı kategori (iç hesap / yansıtma)'
    when exists (select 1 from fin_moves mm join fin_parties p on p.id = mm.party_id where mm.txn_id = t.id and p.slip_of is not null) then 'Fişli cari'
    when exists (select 1 from fin_parties p where p.id = t.party_id and p.slip_of is not null) then 'Fişli cari'
  end;

  -- belge bilgisi
  if t.ref_type = 'invoice' then
    select doc_no, invoice_date, no into inv from inv_invoices where id = t.ref_id;
    v_doc_type := 'invoice'; v_doc_no := coalesce(inv.doc_no, t.doc_no, 'F-' || inv.no); v_doc_date := coalesce(inv.invoice_date, t.txn_date);
  elsif t.kind like 'cheque%' then v_doc_type := 'check'; v_doc_no := t.doc_no; v_doc_date := t.txn_date;
  elsif t.kind in ('collection', 'payment') then v_doc_type := 'receipt'; v_doc_no := t.doc_no; v_doc_date := t.txn_date;
  else v_doc_type := 'other'; v_doc_no := coalesce(t.doc_no, 'ERP-' || t.no); v_doc_date := t.txn_date;
  end if;

  if v.id is null then
    insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, doc_type, doc_no, doc_date, fin_txn_id)
    values (t.company_id, extract(year from t.txn_date)::int, gl_next_no(t.company_id, extract(year from t.txn_date)::int), t.txn_date, 'mahsup', 'auto', 'pending',
            left(coalesce(t.description, t.kind), 500), v_doc_type, left(v_doc_no, 60), v_doc_date, t.id)
    returning * into v;
  end if;
  delete from gl_lines where voucher_id = v.id;

  if excl is not null then
    update gl_vouchers set status = 'excluded', issues = excl, voucher_date = t.txn_date, updated_at = now() where id = v.id;
    return v.id;
  end if;

  for m in select * from fin_moves where txn_id = t.id and amount_try <> 0 order by id loop
    acc := gl_resolve(t.company_id, m, t);
    if acc is null then
      miss := miss || coalesce((select 'Kasa/banka: ' || name from fin_accounts where id = m.account_id),
                               (select 'Cari: ' || name from fin_parties where id = m.party_id),
                               (select 'Kategori: ' || name || ' (' || code || ')' from fin_categories where id = m.category_id), '?');
      continue;
    end if;
    if m.account_id is not null and (select kind from fin_accounts where id = m.account_id) = 'cash' then
      if m.amount_try > 0 then cash_in := true; else cash_out := true; end if;
    end if;
    n := n + 1;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, currency, fx_amount, rate, description, party_id, fin_move_id)
    values (v.id, n, acc, greatest(m.amount_try, 0), greatest(-m.amount_try, 0), m.currency, case when m.currency <> 'TRY' then m.amount end,
            case when m.currency <> 'TRY' then m.rate end, left(coalesce(m.description, t.description), 300), coalesce(m.party_id, t.party_id), m.id);
  end loop;

  if cardinality(miss) > 0 or n = 0 then
    delete from gl_lines where voucher_id = v.id;
    update gl_vouchers set status = 'pending', issues = left(case when n = 0 and cardinality(miss) = 0 then 'Tutar yok' else 'Eşleştirme yok: ' || array_to_string(array(select distinct x from unnest(miss) x), ', ') end, 1000),
           voucher_date = t.txn_date, updated_at = now() where id = v.id;
    return v.id;
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into dsum, csum from gl_lines where voucher_id = v.id;
  if dsum <> csum then
    delete from gl_lines where voucher_id = v.id;
    update gl_vouchers set status = 'pending', issues = 'Borç / alacak tutmuyor: ' || dsum || ' / ' || csum, updated_at = now() where id = v.id;
    return v.id;
  end if;
  v_kind := case when cash_in and not cash_out then 'tahsil' when cash_out and not cash_in then 'tediye' else 'mahsup' end;
  update gl_vouchers set status = 'posted', issues = null, kind = v_kind, voucher_date = t.txn_date, description = left(coalesce(t.description, t.kind), 500),
         doc_type = v_doc_type, doc_no = left(v_doc_no, 60), doc_date = v_doc_date, updated_at = now() where id = v.id;
  return v.id;
end $$;
revoke execute on function gl_post_txn(uuid) from public, anon, authenticated;

-- Tetikleyici: işlem sonunda (satırlar yazıldıktan sonra) çalışır; muhasebe hatası finans işlemini asla engellemez
create or replace function gl_on_fin() returns trigger language plpgsql security definer set search_path = public as $$
declare v_txn uuid := (case when tg_table_name = 'fin_txns' then to_jsonb(coalesce(new, old))->>'id' else to_jsonb(coalesce(new, old))->>'txn_id' end)::uuid;
begin
  begin
    perform gl_post_txn(v_txn);
  exception when others then
    begin
      insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, issues, fin_txn_id)
      select t.company_id, extract(year from t.txn_date)::int, gl_next_no(t.company_id, extract(year from t.txn_date)::int), t.txn_date, 'mahsup', 'auto', 'pending',
             left(coalesce(t.description, t.kind), 500), left('Hata: ' || sqlerrm, 1000), t.id
      from fin_txns t join gl_settings s on s.company_id = t.company_id where t.id = v_txn and s.enabled and t.txn_date >= s.start_date
      on conflict (fin_txn_id) do update set status = 'pending', issues = excluded.issues where gl_vouchers.status <> 'cancelled';
    exception when others then null; end;
  end;
  return null;
end $$;
drop trigger if exists gl_on_fin_txn on fin_txns;
create constraint trigger gl_on_fin_txn after insert or update on fin_txns deferrable initially deferred for each row execute function gl_on_fin();
drop trigger if exists gl_on_fin_move on fin_moves;
create constraint trigger gl_on_fin_move after insert or update or delete on fin_moves deferrable initially deferred for each row execute function gl_on_fin();

-- Geçmiş kayıtları fişe çevir (başlangıç tarihinden itibaren)
create or replace function gl_backfill(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s gl_settings; r record; n int := 0;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  select * into s from gl_settings where company_id = lab_company();
  if not coalesce(s.enabled, false) then raise exception 'gl_disabled'; end if;
  for r in select id from fin_txns where company_id = lab_company() and txn_date >= greatest(coalesce(p_from, s.start_date), s.start_date) and txn_date <= coalesce(p_to, current_date)
           and voided_at is null and not exists (select 1 from gl_vouchers v where v.fin_txn_id = fin_txns.id and v.status in ('posted', 'excluded'))
           order by txn_date, no loop
    perform gl_post_txn(r.id); n := n + 1;
  end loop;
  return jsonb_build_object('processed', n, 'posted', (select count(*) from gl_vouchers where company_id = lab_company() and status = 'posted'),
                            'pending', (select count(*) from gl_vouchers where company_id = lab_company() and status = 'pending'));
end $$;
revoke execute on function gl_backfill(date, date) from public, anon;
grant execute on function gl_backfill(date, date) to authenticated;

create or replace function gl_repost_pending() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  for r in select fin_txn_id from gl_vouchers where company_id = lab_company() and status = 'pending' and fin_txn_id is not null loop
    perform gl_post_txn(r.fin_txn_id); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function gl_repost_pending() from public, anon;
grant execute on function gl_repost_pending() to authenticated;

-- ---------------------------------------------------------------------
-- 6) Ekran işlemleri
-- ---------------------------------------------------------------------
create or replace function gl_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  perform gl_seed(lab_company());
  update gl_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    start_date = coalesce(nullif(p->>'start_date', '')::date, start_date),
    export_format = coalesce(nullif(p->>'export_format', ''), export_format),
    exclude_codes = case when p ? 'exclude_codes' then array(select jsonb_array_elements_text(p->'exclude_codes')) else exclude_codes end,
    updated_by = auth.uid(), updated_at = now()
  where company_id = lab_company();
end $$;
revoke execute on function gl_settings_save(jsonb) from public, anon;
grant execute on function gl_settings_save(jsonb) to authenticated;

-- Hesap ekle / düzenle: { id?, code, name, note?, is_active? }
create or replace function gl_account_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_code text := trim(p->>'code'); v_parent uuid; v_pcode text; a gl_accounts;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if v_code !~ '^[1-9][0-9]{2}(\.[0-9A-Za-z]{1,8}){0,4}$' then raise exception 'gl_bad_code'; end if;
  if length(trim(coalesce(p->>'name', ''))) = 0 then raise exception 'gl_name_required'; end if;
  v_pcode := case when v_code ~ '\.' then regexp_replace(v_code, '\.[^.]+$', '') end;
  if v_pcode is not null then
    select id into v_parent from gl_accounts where company_id = lab_company() and code = v_pcode;
    if v_parent is null then raise exception 'gl_parent_missing:%', v_pcode; end if;
  end if;
  if v_id is null then
    insert into gl_accounts (company_id, code, name, parent_id, kind, normal_side, note, currency)
    values (lab_company(), v_code, left(trim(p->>'name'), 160), v_parent, gl_kind_of(v_code), gl_side_of(v_code, p->>'name'), nullif(left(trim(p->>'note'), 500), ''),
            nullif(p->>'currency', ''))
    returning id into v_id;
  else
    select * into a from gl_accounts where id = v_id and company_id = lab_company();
    if a.id is null then raise exception 'not_found'; end if;
    if a.code <> v_code and exists (select 1 from gl_lines where account_id = v_id) then raise exception 'gl_code_used'; end if;
    update gl_accounts set code = v_code, name = left(trim(p->>'name'), 160), parent_id = v_parent, kind = gl_kind_of(v_code), normal_side = gl_side_of(v_code, p->>'name'),
           note = nullif(left(trim(p->>'note'), 500), ''), is_active = coalesce((p->>'is_active')::boolean, is_active) where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function gl_account_save(jsonb) from public, anon;
grant execute on function gl_account_save(jsonb) to authenticated;

create or replace function gl_account_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if exists (select 1 from gl_lines where account_id = p_id) then raise exception 'gl_account_used'; end if;
  if exists (select 1 from gl_accounts where parent_id = p_id) then raise exception 'gl_account_has_children'; end if;
  delete from gl_accounts where id = p_id and company_id = lab_company();
  update gl_accounts a set postable = true where a.company_id = lab_company() and not a.postable and not exists (select 1 from gl_accounts c where c.parent_id = a.id);
end $$;
revoke execute on function gl_account_delete(uuid) from public, anon;
grant execute on function gl_account_delete(uuid) to authenticated;

-- Eşleştirme: p_code boşsa kaldırır
create or replace function gl_map_save(p_source text, p_key text, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is null then
    delete from gl_maps where company_id = lab_company() and source = p_source and key = p_key;
    return;
  end if;
  select id into v from gl_accounts where company_id = lab_company() and code = trim(p_code);
  if v is null then raise exception 'gl_account_missing:%', p_code; end if;
  insert into gl_maps (company_id, source, key, account_id) values (lab_company(), p_source, p_key, v)
  on conflict (company_id, source, key) do update set account_id = excluded.account_id, updated_at = now();
end $$;
revoke execute on function gl_map_save(text, text, text) from public, anon;
grant execute on function gl_map_save(text, text, text) to authenticated;

-- Elle fiş: { id?, date, kind, description, doc_type?, doc_no?, doc_date?, lines: [{ code, debit, credit, description }] }  (tutarlar kuruş)
create or replace function gl_voucher_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v gl_vouchers; d date := (p->>'date')::date; l jsonb; a gl_accounts; n int := 0; dsum bigint := 0; csum bigint := 0;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if d is null then raise exception 'gl_date_required'; end if;
  if gl_locked(lab_company(), d) then raise exception 'gl_locked'; end if;
  if v_id is not null then
    select * into v from gl_vouchers where id = v_id and company_id = lab_company() for update;
    if v.id is null then raise exception 'not_found'; end if;
    if v.source = 'auto' then raise exception 'gl_auto_voucher'; end if;
    if v.status = 'cancelled' or gl_locked(lab_company(), v.voucher_date) then raise exception 'gl_locked'; end if;
    update gl_vouchers set voucher_date = d,
           kind = coalesce(nullif(p->>'kind', ''), kind), description = nullif(left(trim(p->>'description'), 500), ''),
           doc_type = nullif(p->>'doc_type', ''), doc_no = nullif(left(trim(p->>'doc_no'), 60), ''), doc_date = nullif(p->>'doc_date', '')::date, updated_at = now()
    where id = v_id;
    delete from gl_lines where voucher_id = v_id;
  else
    insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, doc_type, doc_no, doc_date)
    values (lab_company(), extract(year from d)::int, gl_next_no(lab_company(), extract(year from d)::int), d,
            case when p->>'kind' in ('mahsup', 'tahsil', 'tediye', 'acilis', 'kapanis') then p->>'kind' else 'mahsup' end,
            case when p->>'kind' = 'acilis' then 'opening' when p->>'kind' = 'kapanis' then 'closing' else 'manual' end, 'posted',
            nullif(left(trim(p->>'description'), 500), ''), nullif(p->>'doc_type', ''), nullif(left(trim(p->>'doc_no'), 60), ''), nullif(p->>'doc_date', '')::date)
    returning id into v_id;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    if coalesce((l->>'debit')::bigint, 0) = 0 and coalesce((l->>'credit')::bigint, 0) = 0 then continue; end if;
    select * into a from gl_accounts where company_id = lab_company() and code = trim(l->>'code');
    if a.id is null then raise exception 'gl_account_missing:%', l->>'code'; end if;
    if not a.postable then raise exception 'gl_not_postable:%', a.code; end if;
    n := n + 1;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, description, party_id)
    values (v_id, n, a.id, greatest(coalesce((l->>'debit')::bigint, 0), 0), greatest(coalesce((l->>'credit')::bigint, 0), 0), nullif(left(trim(l->>'description'), 300), ''),
            case when a.link_type = 'party' then a.link_id end);
    dsum := dsum + greatest(coalesce((l->>'debit')::bigint, 0), 0); csum := csum + greatest(coalesce((l->>'credit')::bigint, 0), 0);
  end loop;
  if n < 2 then raise exception 'gl_min_lines'; end if;
  if dsum <> csum then raise exception 'gl_unbalanced:% / %', dsum, csum; end if;
  return v_id;
end $$;
revoke execute on function gl_voucher_save(jsonb) from public, anon;
grant execute on function gl_voucher_save(jsonb) to authenticated;

create or replace function gl_voucher_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v gl_vouchers;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  select * into v from gl_vouchers where id = p_id and company_id = lab_company() for update;
  if v.id is null then raise exception 'not_found'; end if;
  if v.source = 'auto' and v.status = 'posted' then raise exception 'gl_auto_voucher'; end if;
  if gl_locked(lab_company(), v.voucher_date) then raise exception 'gl_locked'; end if;
  update gl_vouchers set status = 'cancelled', updated_at = now() where id = p_id;
end $$;
revoke execute on function gl_voucher_cancel(uuid) from public, anon;
grant execute on function gl_voucher_cancel(uuid) to authenticated;

-- Açılış fişi taslağı: başlangıç tarihinden önceki ERP bakiyeleri (kasa, banka, kart, kredi, cari) → açılış fişi; fark karşı hesaba
create or replace function gl_opening_draft(p_counter text default '500') returns uuid
language plpgsql security definer set search_path = public as $$
declare s gl_settings; r record; v_id uuid; acc uuid; n int := 0; d bigint := 0; c bigint := 0; cnt uuid; fake fin_moves; t fin_txns;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  select * into s from gl_settings where company_id = lab_company();
  if exists (select 1 from gl_vouchers where company_id = lab_company() and source = 'opening' and status = 'posted' and voucher_date = s.start_date) then raise exception 'gl_opening_exists'; end if;
  select id into cnt from gl_accounts where company_id = lab_company() and code = p_counter;
  if cnt is null then raise exception 'gl_account_missing:%', p_counter; end if;
  insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, doc_type)
  values (lab_company(), extract(year from s.start_date)::int, gl_next_no(lab_company(), extract(year from s.start_date)::int), s.start_date, 'acilis', 'opening', 'pending',
          'Açılış fişi (ERP bakiyelerinden taslak · karşı hesap ' || p_counter || ')', 'other')
  returning id into v_id;
  for r in
    select m.account_id, m.party_id, sum(m.amount_try) bal from fin_moves m join fin_txns x on x.id = m.txn_id
    where x.company_id = lab_company() and x.voided_at is null and m.move_date < s.start_date and (m.account_id is not null or m.party_id is not null)
      and x.ref_type is distinct from 'mirror'
      and not exists (select 1 from fin_parties p where p.id = m.party_id and p.slip_of is not null)
    group by m.account_id, m.party_id having sum(m.amount_try) <> 0
  loop
    fake.account_id := r.account_id; fake.party_id := r.party_id; fake.category_id := null;
    acc := gl_resolve(lab_company(), fake, t);
    if acc is null then continue; end if;
    n := n + 1;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, description, party_id)
    values (v_id, n, acc, greatest(r.bal, 0), greatest(-r.bal, 0), 'Açılış bakiyesi', r.party_id);
    d := d + greatest(r.bal, 0); c := c + greatest(-r.bal, 0);
  end loop;
  if d <> c then
    n := n + 1;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, description) values (v_id, n, cnt, greatest(c - d, 0), greatest(d - c, 0), 'Açılış farkı');
  end if;
  update gl_vouchers set status = 'posted', issues = 'Taslak: mali müşavir kontrol etmeli (stok, demirbaş, sermaye ayrıca girilir)' where id = v_id;
  return v_id;
end $$;
revoke execute on function gl_opening_draft(text) from public, anon;
grant execute on function gl_opening_draft(text) to authenticated;

-- Özet (ana sayfa)
create or replace function gl_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'settings', (select to_jsonb(s) from gl_settings s where s.company_id = lab_company()),
    'posted', (select count(*) from gl_vouchers where company_id = lab_company() and status = 'posted'),
    'pending', (select count(*) from gl_vouchers where company_id = lab_company() and status = 'pending'),
    'excluded', (select count(*) from gl_vouchers where company_id = lab_company() and status = 'excluded'),
    'unposted', (select count(*) from fin_txns x join gl_settings s on s.company_id = x.company_id
                 where x.company_id = lab_company() and s.enabled and x.voided_at is null and x.txn_date >= s.start_date
                   and not exists (select 1 from gl_vouchers v where v.fin_txn_id = x.id)),
    'accounts', (select count(*) from gl_accounts where company_id = lab_company()),
    'month', (select jsonb_build_object('debit', coalesce(sum(l.debit), 0), 'vouchers', count(distinct v.id)) from gl_vouchers v join gl_lines l on l.voucher_id = v.id
              where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date >= date_trunc('month', current_date)::date)
  ) end;
$$;
revoke execute on function gl_overview() from public, anon;
grant execute on function gl_overview() to authenticated;

notify pgrst, 'reload schema';
