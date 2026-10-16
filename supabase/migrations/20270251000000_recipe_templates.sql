-- =====================================================================
-- ÜRETİM REÇETESİ SİHİRBAZI
--  Her protez ürününü (Fransızca ad + Türkçe ad) bir reçete şablonuna eşler ve reçeteyi (malzeme + üretim adımları) oluşturur.
--  Şablonlar: zirkon, zirkon üstü porselen, e.max pres / CAD, lamine, metal-porselen (Noritake), metal kron, post-core,
--             geçici PMMA, kompozit inley, implant üstü zirkon, tam protez, akrilik parsiyel, iskelet (Cr-Co), iskelet dizim,
--             tamir, diş ekleme, mum prova, kapanış mumu, bireysel kaşık, sert / yumuşak plak, ortodonti aparey (vidalı),
--             wax-up, alçı model, 3D model, hizmet (malzemesiz).
--  Miktarlar sektörde tipik değerlerdir; fiyatlar Ekim 2026 tahmini (kuruş). Alış yapıldıkça ortalama alış fiyatı kullanılır.
--  prd_recipe_guess(ad)        : anahtar kelime kuralı → şablon
--  prd_recipe_refresh()        : planı olmayan ürünlere kural ile şablon atar
--  prd_recipe_set / _bulk      : elle / yapay zekâ ataması
--  prd_recipe_apply_all()      : reçetesi olmayan (ya da şablondan oluşmuş ve şablonu değişmiş) ürünlere reçeteyi yazar
--  Elle girilmiş reçeteler (şablondan oluşmamış) korunur.
-- Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists prd_tpl (
  key text primary key,
  name text not null,
  description text not null,
  per text not null default 'üye' check (per in ('üye', 'iş')),
  sort int not null default 0
);
create table if not exists prd_tpl_items (
  code text primary key,
  name text not null,
  unit text not null,
  kind text not null,
  price bigint not null default 0        -- kuruş / birim (tahmini)
);
create table if not exists prd_tpl_lines (
  tpl text not null references prd_tpl (key) on delete cascade,
  code text not null references prd_tpl_items (code) on delete cascade,
  qty numeric(12, 3) not null,
  waste numeric(5, 2) not null default 0,
  note text,
  primary key (tpl, code)
);
create table if not exists prd_tpl_stations (
  code text primary key,
  name text not null,
  kind text not null,
  color text not null,
  sort int not null,
  rate bigint                            -- kuruş / dakika
);
create table if not exists prd_tpl_steps (
  tpl text not null references prd_tpl (key) on delete cascade,
  station text not null references prd_tpl_stations (code) on delete cascade,
  minutes int not null,
  primary key (tpl, station)
);
create table if not exists prd_recipe_plan (
  product_id uuid primary key references lab_products (id) on delete cascade,
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  tpl text references prd_tpl (key) on delete set null,
  source text not null default 'kural' check (source in ('kural', 'ai', 'elle')),
  applied_tpl text,
  applied_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table prd_tpl enable row level security;
alter table prd_tpl_items enable row level security;
alter table prd_tpl_lines enable row level security;
alter table prd_tpl_stations enable row level security;
alter table prd_tpl_steps enable row level security;
alter table prd_recipe_plan enable row level security;
drop policy if exists prd_tpl_read on prd_tpl;
drop policy if exists prd_tpl_items_read on prd_tpl_items;
drop policy if exists prd_tpl_lines_read on prd_tpl_lines;
drop policy if exists prd_tpl_stations_read on prd_tpl_stations;
drop policy if exists prd_tpl_steps_read on prd_tpl_steps;
drop policy if exists prd_recipe_plan_read on prd_recipe_plan;
create policy prd_tpl_read on prd_tpl for select to authenticated using (true);
create policy prd_tpl_items_read on prd_tpl_items for select to authenticated using (true);
create policy prd_tpl_lines_read on prd_tpl_lines for select to authenticated using (true);
create policy prd_tpl_stations_read on prd_tpl_stations for select to authenticated using (true);
create policy prd_tpl_steps_read on prd_tpl_steps for select to authenticated using (true);
create policy prd_recipe_plan_read on prd_recipe_plan for select to authenticated using (company_id = (select lab_company()) and (select prd_cost_can()));
revoke all on prd_tpl, prd_tpl_items, prd_tpl_lines, prd_tpl_stations, prd_tpl_steps, prd_recipe_plan from anon;
grant select on prd_tpl, prd_tpl_items, prd_tpl_lines, prd_tpl_stations, prd_tpl_steps, prd_recipe_plan to authenticated;

-- ---------------------------------------------------------------------
-- Şablon verisi (her çalıştırmada yenilenir)
-- ---------------------------------------------------------------------
delete from prd_tpl_lines; delete from prd_tpl_steps;

insert into prd_tpl (key, name, description, per, sort) values
  ('zirkon',        'Monolitik zirkon kron / köprü üyesi', 'Full zirkon, monolitik zirkonyum kron veya köprü üyesi (CAD/CAM kazıma, sinter, boya-glaze). FR: full zircon, zircone monolithique, couronne zircone', 'üye', 10),
  ('zirkon_por',    'Zirkon üstü porselen (tabakalı)', 'Zirkonyum altyapı üzerine porselen yığma (layered / cut-back). FR: zircone céramique, zircone stratifiée, zircone cosmétique', 'üye', 20),
  ('emax_press',    'E.max pres kron / inley / onley', 'Lityum disilikat pres (IPS e.max Press) kron, inley, onley. FR: e.max, disilicate, céramique pressée, empress', 'üye', 30),
  ('emax_cad',      'E.max CAD kron', 'Lityum disilikat CAD/CAM blok kazıma + kristalizasyon. FR: e.max CAD, bloc disilicate', 'üye', 40),
  ('lamine',        'Lamine (veneer)', 'Porselen / e.max lamine veneer. FR: facette, facette céramique, veneer', 'üye', 50),
  ('pfm',           'Metal destekli porselen (Noritake, Cr-Co döküm)', 'Metal-seramik kron / köprü üyesi: Cr-Co döküm altyapı + Noritake EX-3 porselen. FR: couronne céramo-métallique, CCM, couronne céramique, bridge céramique', 'üye', 60),
  ('metal_kron',    'Tam metal döküm kron', 'Porselensiz Cr-Co döküm kron. FR: couronne coulée, couronne métallique, tout métal', 'üye', 70),
  ('postcore',      'Döküm post-core (kor)', 'Kanal içi döküm pivot / kor. FR: inlay-core, faux moignon, pivot, tenon', 'üye', 80),
  ('gecici',        'Geçici kron (PMMA)', 'CAD/CAM PMMA geçici kron / köprü. FR: provisoire, couronne provisoire, temporaire, PMMA', 'üye', 90),
  ('kompozit',      'Kompozit inley / onley / kron', 'Laboratuvar kompoziti ile inley, onley, kron. FR: inlay composite, onlay composite, composite', 'üye', 100),
  ('implant',       'İmplant üstü zirkon (Ti-base)', 'Ti-base üzerine zirkon vidalı / simante implant üstü kron. FR: couronne sur implant, transvissée, pilier, scellée sur implant', 'üye', 110),
  ('tam_protez',    'Tam protez (1 çene)', 'Total / tam akrilik protez, ısıyla polimerize kaide, akrilik dişler. FR: prothèse complète, complet résine, total', 'iş', 120),
  ('parsiyel',      'Akrilik parsiyel protez', 'Akrilik kaideli, telli kroşeli parsiyel protez (esnek / flexible dahil). FR: partiel résine, prothèse partielle, flexible', 'iş', 130),
  ('iskelet',       'İskelet protez metal (Cr-Co)', 'Cr-Co döküm iskelet (çatı): dublikat, revetman, döküm, elektrolitik parlatma. FR: stellite, châssis, squelettique', 'iş', 140),
  ('iskelet_dizim', 'İskelet protez dizim + akrilik bitim', 'Hazır iskelet üzerine diş dizimi ve akrilik bitim. FR: montage stellite, finition stellite, dents sur stellite', 'iş', 150),
  ('tamir',         'Protez tamiri / kaide yenileme', 'Kırık tamiri, besleme, kaide yenileme (soğuk akrilik). FR: réparation, rebasage, fracture, soudure', 'iş', 160),
  ('dis_ekleme',    'Proteze diş / kroşe ekleme', 'Mevcut proteze diş veya kroşe ekleme. FR: adjonction dent, ajout crochet', 'iş', 170),
  ('mum_prova',     'Mum prova (dizim)', 'Kaide plağı üzerinde mum dizim provası. FR: cire d''essayage, montage cire, essayage', 'iş', 180),
  ('kapanis',       'Kapanış mumu (ölçü kaidesi)', 'Kaide plağı + mum kapanış duvarı. FR: maquette d''occlusion, bourrelet, cire d''occlusion', 'iş', 190),
  ('kasik',         'Bireysel ölçü kaşığı', 'Işıkla sertleşen bireysel kaşık. FR: porte-empreinte individuel, PEI', 'iş', 200),
  ('plak_sert',     'Sert plak (gece / bruksizm splint)', 'Termoform sert plak + akrilik düzeltme. FR: gouttière occlusale, gouttière de bruxisme, splint', 'iş', 210),
  ('plak_yumusak',  'Yumuşak plak / beyazlatma / pekiştirme', 'Termoform yumuşak / şeffaf plak: beyazlatma kaşığı, Essix pekiştirme, sporcu koruyucu. FR: gouttière de blanchiment, contention, protège-dents', 'iş', 220),
  ('ortodonti',     'Hareketli ortodontik aparey', 'Akrilik + tel ortodontik plak (Hawley, yer tutucu, aktivatör). FR: appareil orthodontique amovible, plaque de Hawley, mainteneur d''espace', 'iş', 230),
  ('ortodonti_vida','Vidalı ortodontik aparey (genişletme)', 'Genişletme vidalı ortodontik plak. FR: plaque à vérin, disjoncteur, expansion', 'iş', 240),
  ('wax_up',        'Teşhis wax-up', 'Teşhis amaçlı mum modelaj (diş başına). FR: wax-up, cire diagnostique', 'üye', 250),
  ('model',         'Alçı model (çalışma / karşıt)', 'Çalışma, karşıt veya teşhis alçı modeli. FR: modèle d''étude, modèle, antagoniste', 'iş', 260),
  ('model_3d',      '3D yazıcı model', 'Ağız içi taramadan 3D baskı model. FR: modèle imprimé 3D, impression 3D', 'iş', 270),
  ('hizmet',        'Hizmet (malzeme yok)', 'Malzeme tüketmeyen kalemler: rötuş, kargo, nakliye, renk alma, fotoğraf, indirim, yeniden yapım. FR: retouche, transport, livraison, frais, teinte, remise, refait', 'iş', 900)
on conflict (key) do update set name = excluded.name, description = excluded.description, per = excluded.per, sort = excluded.sort;

insert into prd_tpl_items (code, name, unit, kind, price) values
  ('RC-ALCI4', 'Tip 4 sert alçı (güdük / model)', 'g', 'raw', 86),
  ('RC-KAIDE', 'Kaide alçısı (tip 3)', 'g', 'raw', 25),
  ('RC-PIN', 'Model pini', 'adet', 'consumable', 600),
  ('RC-SPACER', 'Güdük sertleştirici + die spacer (payı)', 'üye', 'consumable', 800),
  ('RC-MUM', 'Modelaj / daldırma / servikal mum', 'g', 'material', 1200),
  ('RC-KANAL', 'Döküm kanal mumu', 'g', 'material', 600),
  ('RC-REV', 'Fosfat bağlı revetman (Cr-Co)', 'g', 'raw', 95),
  ('RC-REVLIK', 'Revetman likidi', 'ml', 'raw', 228),
  ('RC-CRCO', 'Cr-Co seramik döküm alaşımı', 'g', 'raw', 2000),
  ('RC-POTA', 'Döküm potası (payı)', 'üye', 'consumable', 1000),
  ('RC-KUM', 'Kumlama kumu Al2O3 110 µm', 'g', 'consumable', 30),
  ('RC-FREZ', 'Seperatör + karbit frez aşınma payı', 'üye', 'consumable', 8000),
  ('RC-NOP', 'Noritake EX-3 opak (pasta)', 'g', 'material', 14000),
  ('RC-NBD', 'Noritake EX-3 body (dentin)', 'g', 'material', 9500),
  ('RC-NEN', 'Noritake EX-3 enamel / insizal', 'g', 'material', 9500),
  ('RC-NGL', 'Noritake glaze + boya', 'g', 'material', 12000),
  ('RC-NLIK', 'Porselen modelaj likidi', 'ml', 'material', 600),
  ('RC-ELMAS', 'Elmas frez, lastik, cila payı', 'üye', 'consumable', 4000),
  ('RC-PAKET', 'Paket (kutu, poşet, etiket, dezenfektan)', 'üye', 'packaging', 2500),
  ('RC-ZRDISK', 'Zirkonyum disk 98×14 mm (multilayer)', 'adet', 'raw', 600000),
  ('RC-ZRFREZ', 'Kazıma frezi aşınma payı (CAD/CAM)', 'üye', 'consumable', 3000),
  ('RC-ZRSTAIN', 'Zirkon boya + glaze', 'g', 'material', 15000),
  ('RC-ZRLINER', 'Zirkon liner / shade base', 'g', 'material', 15000),
  ('RC-CZRBD', 'Noritake CZR body (zirkon üstü)', 'g', 'material', 9500),
  ('RC-CZREN', 'Noritake CZR enamel', 'g', 'material', 9500),
  ('RC-EMXP', 'IPS e.max Press ingot (L)', 'adet', 'raw', 170000),
  ('RC-PRSVEST', 'Pres revetmanı (IPS PressVEST)', 'g', 'raw', 120),
  ('RC-PRSLIK', 'Pres revetman likidi', 'ml', 'raw', 300),
  ('RC-PRSPLUN', 'Pres pistonu / manşet payı', 'üye', 'consumable', 1500),
  ('RC-INVEX', 'Invex likit (revetman temizleme)', 'ml', 'consumable', 100),
  ('RC-EMXST', 'e.max boya + glaze (Ivocolor)', 'g', 'material', 20000),
  ('RC-EMXCAD', 'IPS e.max CAD blok', 'adet', 'raw', 140000),
  ('RC-PMMA', 'PMMA disk 98×20 mm (geçici)', 'adet', 'raw', 250000),
  ('RC-KOMP', 'Laboratuvar kompoziti (inley / onley)', 'g', 'material', 4000),
  ('RC-TIBASE', 'Ti-base (implant bağlantı parçası)', 'adet', 'material', 150000),
  ('RC-YAPIS', 'Ti-base yapıştırıcı simanı (payı)', 'üye', 'consumable', 4000),
  ('RC-AKRSIC', 'Isıyla polimerize akrilik toz (protez kaidesi)', 'g', 'raw', 120),
  ('RC-AKRSICL', 'Isıyla polimerize akrilik likit', 'ml', 'raw', 100),
  ('RC-AKRSOG', 'Soğuk akrilik toz (tamir / ortodonti)', 'g', 'raw', 150),
  ('RC-AKRSOGL', 'Soğuk akrilik likit', 'ml', 'raw', 120),
  ('RC-DISSET', 'Akrilik protez dişi (takım, 28 diş)', 'takım', 'material', 60000),
  ('RC-DISTEK', 'Akrilik protez dişi (tek)', 'adet', 'material', 2500),
  ('RC-KAIDEPL', 'Kaide plağı (shellac / ışıkla sertleşen)', 'adet', 'consumable', 1500),
  ('RC-MUMPL', 'Pembe plak mumu', 'g', 'material', 300),
  ('RC-IZOL', 'Alçı izolasyon (separatör)', 'ml', 'consumable', 200),
  ('RC-POLISAJ', 'Protez cila (pomza, pasta, fırça payı)', 'iş', 'consumable', 3000),
  ('RC-TEL', 'Paslanmaz kroşe / ortodonti teli', 'm', 'material', 500),
  ('RC-VIDA', 'Ortodontik genişletme vidası', 'adet', 'material', 15000),
  ('RC-TRMSERT', 'Termoform plak (sert, 2 mm)', 'adet', 'material', 6000),
  ('RC-TRMYUM', 'Termoform plak (yumuşak / şeffaf)', 'adet', 'material', 5000),
  ('RC-DUBL', 'Dublikasyon jeli / silikonu (payı)', 'iş', 'consumable', 5000),
  ('RC-CRCOI', 'Cr-Co iskelet döküm alaşımı', 'g', 'raw', 1600),
  ('RC-ISKMUM', 'İskelet mum profilleri + retansiyon ağı', 'iş', 'material', 8000),
  ('RC-ELKPOL', 'Elektrolitik parlatma payı', 'iş', 'consumable', 3000),
  ('RC-KASIK', 'Kaşık rezini (ışıkla sertleşen plak)', 'adet', 'material', 4000),
  ('RC-3DRES', 'Model rezini (3D yazıcı)', 'ml', 'raw', 400)
on conflict (code) do update set name = excluded.name, unit = excluded.unit, kind = excluded.kind, price = excluded.price;

insert into prd_tpl_stations (code, name, kind, color, sort, rate) values
  ('MDL', 'Model / alçı', 'model', '#8B6F47', 10, 450),
  ('CAD', 'CAD tasarım', 'cad', '#2563EB', 20, 650),
  ('FRZ', 'Kazıma (frez)', 'milling', '#0891B2', 30, 500),
  ('3DP', '3D baskı', 'printing', '#0EA5E9', 32, 450),
  ('MUM', 'Mum modelaj', 'casting', '#B45309', 15, 550),
  ('DOK', 'Revetman + döküm', 'casting', '#9A3412', 25, 550),
  ('PRS', 'Pres seramik', 'casting', '#C2410C', 27, 600),
  ('SNT', 'Sinterleme / kristalizasyon', 'sintering', '#DC2626', 40, 450),
  ('MTS', 'Metal tesviye + oksit', 'finishing', '#475569', 35, 550),
  ('POR', 'Porselen / seramik', 'porcelain', '#DB2777', 50, 800),
  ('DIZ', 'Diş dizimi / mum prova', 'other', '#A16207', 45, 650),
  ('AKR', 'Akrilik / muflalama', 'other', '#BE185D', 48, 500),
  ('TRM', 'Termoform', 'other', '#0F766E', 46, 450),
  ('ORT', 'Ortodonti tel bükümü', 'other', '#4338CA', 47, 600),
  ('BIT', 'Bitirme / cila', 'finishing', '#7C3AED', 60, 650),
  ('QC', 'Kalite kontrol', 'qc', '#059669', 70, 600),
  ('PAK', 'Paketleme', 'packing', '#64748B', 80, 350)
on conflict (code) do update set name = excluded.name, kind = excluded.kind, color = excluded.color, sort = excluded.sort, rate = excluded.rate;

insert into prd_tpl_lines (tpl, code, qty, waste, note) values
  -- Monolitik zirkon (1 disk ≈ 16 üye)
  ('zirkon', 'RC-ALCI4', 40, 10, 'Model / güdük'), ('zirkon', 'RC-KAIDE', 30, 10, 'Kaide'), ('zirkon', 'RC-PIN', 1, 0, null),
  ('zirkon', 'RC-ZRDISK', 0.06, 10, '98 mm disk ≈ 16 üye'), ('zirkon', 'RC-ZRFREZ', 1, 0, null), ('zirkon', 'RC-ZRSTAIN', 0.1, 20, 'Boya + glaze'),
  ('zirkon', 'RC-ELMAS', 0.5, 0, 'Tesviye / cila'), ('zirkon', 'RC-PAKET', 1, 0, null),
  -- Zirkon üstü porselen
  ('zirkon_por', 'RC-ALCI4', 40, 10, null), ('zirkon_por', 'RC-KAIDE', 30, 10, null), ('zirkon_por', 'RC-PIN', 1, 0, null),
  ('zirkon_por', 'RC-ZRDISK', 0.05, 10, 'İnceltilmiş altyapı'), ('zirkon_por', 'RC-ZRFREZ', 1, 0, null), ('zirkon_por', 'RC-ZRLINER', 0.05, 20, null),
  ('zirkon_por', 'RC-CZRBD', 1.0, 20, 'Dentin yığma'), ('zirkon_por', 'RC-CZREN', 0.4, 20, 'Mine / insizal'), ('zirkon_por', 'RC-NGL', 0.1, 20, 'Glaze'),
  ('zirkon_por', 'RC-NLIK', 0.5, 0, null), ('zirkon_por', 'RC-ELMAS', 1, 0, null), ('zirkon_por', 'RC-PAKET', 1, 0, null),
  -- E.max pres (L ingot ≈ 1–2 üye)
  ('emax_press', 'RC-ALCI4', 40, 10, null), ('emax_press', 'RC-KAIDE', 30, 10, null), ('emax_press', 'RC-PIN', 1, 0, null), ('emax_press', 'RC-SPACER', 1, 0, null),
  ('emax_press', 'RC-MUM', 1.2, 10, 'Tam kontur mum'), ('emax_press', 'RC-KANAL', 0.3, 0, null), ('emax_press', 'RC-EMXP', 0.7, 5, 'L ingot ≈ 1–2 üye'),
  ('emax_press', 'RC-PRSVEST', 100, 10, '100 g manşet'), ('emax_press', 'RC-PRSLIK', 22, 10, null), ('emax_press', 'RC-PRSPLUN', 1, 0, null),
  ('emax_press', 'RC-INVEX', 5, 0, 'Reaksiyon tabakası'), ('emax_press', 'RC-KUM', 10, 0, 'Cam boncuk / kumlama'), ('emax_press', 'RC-EMXST', 0.1, 20, 'Boya + glaze'),
  ('emax_press', 'RC-ELMAS', 1, 0, null), ('emax_press', 'RC-PAKET', 1, 0, null),
  -- E.max CAD
  ('emax_cad', 'RC-ALCI4', 40, 10, null), ('emax_cad', 'RC-KAIDE', 30, 10, null), ('emax_cad', 'RC-PIN', 1, 0, null),
  ('emax_cad', 'RC-EMXCAD', 1, 5, '1 blok = 1 üye'), ('emax_cad', 'RC-ZRFREZ', 1, 0, null), ('emax_cad', 'RC-EMXST', 0.1, 20, null),
  ('emax_cad', 'RC-ELMAS', 1, 0, null), ('emax_cad', 'RC-PAKET', 1, 0, null),
  -- Lamine
  ('lamine', 'RC-ALCI4', 40, 10, null), ('lamine', 'RC-KAIDE', 30, 10, null), ('lamine', 'RC-PIN', 1, 0, null), ('lamine', 'RC-SPACER', 1, 0, null),
  ('lamine', 'RC-MUM', 0.6, 10, null), ('lamine', 'RC-KANAL', 0.3, 0, null), ('lamine', 'RC-EMXP', 0.5, 5, 'İnce restorasyon'),
  ('lamine', 'RC-PRSVEST', 100, 10, null), ('lamine', 'RC-PRSLIK', 22, 10, null), ('lamine', 'RC-PRSPLUN', 1, 0, null), ('lamine', 'RC-INVEX', 5, 0, null),
  ('lamine', 'RC-EMXST', 0.1, 20, null), ('lamine', 'RC-ELMAS', 1, 0, null), ('lamine', 'RC-PAKET', 1, 0, null),
  -- Metal destekli porselen (Noritake EX-3, Cr-Co)
  ('pfm', 'RC-ALCI4', 50, 10, 'Model ve güdük'), ('pfm', 'RC-KAIDE', 40, 10, 'Model kaidesi'), ('pfm', 'RC-PIN', 1, 0, 'Güdük pini'),
  ('pfm', 'RC-SPACER', 1, 0, 'Üye başına pay'), ('pfm', 'RC-MUM', 1.5, 10, 'Kron mum modelajı'), ('pfm', 'RC-KANAL', 0.5, 0, 'Kanal ve rezervuar'),
  ('pfm', 'RC-REV', 90, 10, 'Manşet başına pay'), ('pfm', 'RC-REVLIK', 22, 10, '100 g tozda ~25 ml'), ('pfm', 'RC-CRCO', 4, 15, 'Net tüketim'),
  ('pfm', 'RC-POTA', 1, 0, '1 pota ≈ 30 döküm'), ('pfm', 'RC-KUM', 25, 0, 'Metal kumlama'), ('pfm', 'RC-FREZ', 1, 0, 'Metal tesviye'),
  ('pfm', 'RC-NOP', 0.3, 20, '2 kat opak'), ('pfm', 'RC-NBD', 1.0, 20, 'Dentin yığma'), ('pfm', 'RC-NEN', 0.4, 20, 'Mine / insizal'),
  ('pfm', 'RC-NGL', 0.1, 20, 'Glaze ve karakterizasyon'), ('pfm', 'RC-NLIK', 0.5, 0, 'Yığma likidi'), ('pfm', 'RC-ELMAS', 1, 0, 'Porselen tesviye ve cila'),
  ('pfm', 'RC-PAKET', 1, 0, 'Sevk paketi'),
  -- Tam metal kron
  ('metal_kron', 'RC-ALCI4', 40, 10, null), ('metal_kron', 'RC-KAIDE', 30, 10, null), ('metal_kron', 'RC-PIN', 1, 0, null), ('metal_kron', 'RC-SPACER', 1, 0, null),
  ('metal_kron', 'RC-MUM', 1.5, 10, null), ('metal_kron', 'RC-KANAL', 0.5, 0, null), ('metal_kron', 'RC-REV', 90, 10, null), ('metal_kron', 'RC-REVLIK', 22, 10, null),
  ('metal_kron', 'RC-CRCO', 5, 15, 'Tam kontur metal'), ('metal_kron', 'RC-POTA', 1, 0, null), ('metal_kron', 'RC-KUM', 25, 0, null), ('metal_kron', 'RC-FREZ', 1, 0, null),
  ('metal_kron', 'RC-ELMAS', 1, 0, 'Cila'), ('metal_kron', 'RC-PAKET', 1, 0, null),
  -- Post-core
  ('postcore', 'RC-ALCI4', 30, 10, null), ('postcore', 'RC-MUM', 0.8, 10, 'Kanal mumu / patern'), ('postcore', 'RC-KANAL', 0.3, 0, null),
  ('postcore', 'RC-REV', 60, 10, null), ('postcore', 'RC-REVLIK', 15, 10, null), ('postcore', 'RC-CRCO', 2, 15, null), ('postcore', 'RC-POTA', 1, 0, null),
  ('postcore', 'RC-KUM', 15, 0, null), ('postcore', 'RC-FREZ', 0.5, 0, null), ('postcore', 'RC-PAKET', 1, 0, null),
  -- Geçici PMMA
  ('gecici', 'RC-ALCI4', 30, 10, null), ('gecici', 'RC-KAIDE', 20, 10, null), ('gecici', 'RC-PMMA', 0.05, 10, '98 mm disk ≈ 20 üye'),
  ('gecici', 'RC-ZRFREZ', 0.5, 0, null), ('gecici', 'RC-POLISAJ', 0.3, 0, null), ('gecici', 'RC-PAKET', 1, 0, null),
  -- Kompozit
  ('kompozit', 'RC-ALCI4', 40, 10, null), ('kompozit', 'RC-KAIDE', 30, 10, null), ('kompozit', 'RC-PIN', 1, 0, null), ('kompozit', 'RC-SPACER', 1, 0, null),
  ('kompozit', 'RC-KOMP', 0.4, 20, 'Tabakalama'), ('kompozit', 'RC-ELMAS', 0.5, 0, null), ('kompozit', 'RC-PAKET', 1, 0, null),
  -- İmplant üstü zirkon
  ('implant', 'RC-ALCI4', 50, 10, 'Dişeti maskeli model'), ('implant', 'RC-KAIDE', 40, 10, null), ('implant', 'RC-ZRDISK', 0.07, 10, null),
  ('implant', 'RC-ZRFREZ', 1, 0, null), ('implant', 'RC-ZRSTAIN', 0.1, 20, null), ('implant', 'RC-TIBASE', 1, 0, 'Hekim gönderdiyse satırı silin'),
  ('implant', 'RC-YAPIS', 1, 0, null), ('implant', 'RC-ELMAS', 0.5, 0, null), ('implant', 'RC-PAKET', 1, 0, null),
  -- Tam protez (1 çene)
  ('tam_protez', 'RC-KAIDE', 650, 10, 'Model ~250 g + mufla ~400 g'), ('tam_protez', 'RC-KAIDEPL', 1, 0, null), ('tam_protez', 'RC-MUMPL', 20, 10, 'Dizim mumu'),
  ('tam_protez', 'RC-DISSET', 0.5, 0, '14 diş (yarım takım)'), ('tam_protez', 'RC-IZOL', 5, 0, null), ('tam_protez', 'RC-AKRSIC', 30, 15, 'Toz:likit ≈ 23 g / 10 ml'),
  ('tam_protez', 'RC-AKRSICL', 12, 10, null), ('tam_protez', 'RC-POLISAJ', 1, 0, null), ('tam_protez', 'RC-ELMAS', 1, 0, 'Frez / lastik'), ('tam_protez', 'RC-PAKET', 1, 0, null),
  -- Akrilik parsiyel
  ('parsiyel', 'RC-KAIDE', 500, 10, null), ('parsiyel', 'RC-KAIDEPL', 1, 0, null), ('parsiyel', 'RC-MUMPL', 10, 10, null), ('parsiyel', 'RC-DISTEK', 4, 0, 'Ortalama 4 diş'),
  ('parsiyel', 'RC-TEL', 0.3, 0, 'Kroşeler'), ('parsiyel', 'RC-IZOL', 5, 0, null), ('parsiyel', 'RC-AKRSIC', 20, 15, null), ('parsiyel', 'RC-AKRSICL', 8, 10, null),
  ('parsiyel', 'RC-POLISAJ', 1, 0, null), ('parsiyel', 'RC-ELMAS', 1, 0, null), ('parsiyel', 'RC-PAKET', 1, 0, null),
  -- İskelet (Cr-Co çatı)
  ('iskelet', 'RC-ALCI4', 150, 10, 'Ana model'), ('iskelet', 'RC-DUBL', 1, 0, 'Dublikat'), ('iskelet', 'RC-REV', 350, 10, 'Revetman model'),
  ('iskelet', 'RC-REVLIK', 80, 10, null), ('iskelet', 'RC-ISKMUM', 1, 0, null), ('iskelet', 'RC-KANAL', 3, 0, null), ('iskelet', 'RC-CRCOI', 18, 25, 'Net iskelet ağırlığı'),
  ('iskelet', 'RC-POTA', 1, 0, null), ('iskelet', 'RC-KUM', 60, 0, null), ('iskelet', 'RC-FREZ', 1, 0, null), ('iskelet', 'RC-ELKPOL', 1, 0, null), ('iskelet', 'RC-PAKET', 1, 0, null),
  -- İskelet dizim + bitim
  ('iskelet_dizim', 'RC-MUMPL', 10, 10, null), ('iskelet_dizim', 'RC-DISTEK', 6, 0, 'Ortalama 6 diş'), ('iskelet_dizim', 'RC-KAIDE', 400, 10, 'Mufla'),
  ('iskelet_dizim', 'RC-IZOL', 5, 0, null), ('iskelet_dizim', 'RC-AKRSIC', 15, 15, null), ('iskelet_dizim', 'RC-AKRSICL', 6, 10, null),
  ('iskelet_dizim', 'RC-POLISAJ', 1, 0, null), ('iskelet_dizim', 'RC-ELMAS', 1, 0, null), ('iskelet_dizim', 'RC-PAKET', 1, 0, null),
  -- Tamir / kaide yenileme
  ('tamir', 'RC-KAIDE', 300, 10, null), ('tamir', 'RC-IZOL', 3, 0, null), ('tamir', 'RC-AKRSOG', 10, 15, null), ('tamir', 'RC-AKRSOGL', 5, 10, null),
  ('tamir', 'RC-POLISAJ', 0.5, 0, null), ('tamir', 'RC-ELMAS', 0.5, 0, null), ('tamir', 'RC-PAKET', 1, 0, null),
  -- Diş / kroşe ekleme
  ('dis_ekleme', 'RC-KAIDE', 300, 10, null), ('dis_ekleme', 'RC-IZOL', 3, 0, null), ('dis_ekleme', 'RC-DISTEK', 1, 0, null), ('dis_ekleme', 'RC-TEL', 0.1, 0, 'Kroşe gerekirse'),
  ('dis_ekleme', 'RC-AKRSOG', 6, 15, null), ('dis_ekleme', 'RC-AKRSOGL', 3, 10, null), ('dis_ekleme', 'RC-POLISAJ', 0.5, 0, null), ('dis_ekleme', 'RC-PAKET', 1, 0, null),
  -- Mum prova (dişler bitimde kullanılır, burada sayılmaz)
  ('mum_prova', 'RC-KAIDEPL', 1, 0, null), ('mum_prova', 'RC-MUMPL', 20, 10, null), ('mum_prova', 'RC-PAKET', 1, 0, null),
  -- Kapanış mumu
  ('kapanis', 'RC-KAIDEPL', 1, 0, null), ('kapanis', 'RC-MUMPL', 25, 10, 'Mum duvar'), ('kapanis', 'RC-PAKET', 1, 0, null),
  -- Bireysel kaşık
  ('kasik', 'RC-KAIDE', 250, 10, 'Model'), ('kasik', 'RC-MUMPL', 5, 0, 'Boşluk mumu'), ('kasik', 'RC-KASIK', 1, 0, null), ('kasik', 'RC-ELMAS', 0.3, 0, null), ('kasik', 'RC-PAKET', 1, 0, null),
  -- Sert plak
  ('plak_sert', 'RC-KAIDE', 200, 10, 'Model'), ('plak_sert', 'RC-TRMSERT', 1, 5, null), ('plak_sert', 'RC-AKRSOG', 5, 15, 'Kapanış düzeltme'), ('plak_sert', 'RC-AKRSOGL', 3, 10, null),
  ('plak_sert', 'RC-POLISAJ', 0.5, 0, null), ('plak_sert', 'RC-PAKET', 1, 0, null),
  -- Yumuşak plak / beyazlatma / pekiştirme
  ('plak_yumusak', 'RC-KAIDE', 200, 10, 'Model'), ('plak_yumusak', 'RC-TRMYUM', 1, 5, null), ('plak_yumusak', 'RC-PAKET', 1, 0, null),
  -- Ortodonti aparey
  ('ortodonti', 'RC-KAIDE', 250, 10, 'Model'), ('ortodonti', 'RC-TEL', 0.5, 10, 'Kroşe + labial ark'), ('ortodonti', 'RC-AKRSOG', 15, 15, null),
  ('ortodonti', 'RC-AKRSOGL', 8, 10, null), ('ortodonti', 'RC-POLISAJ', 1, 0, null), ('ortodonti', 'RC-PAKET', 1, 0, null),
  ('ortodonti_vida', 'RC-KAIDE', 250, 10, 'Model'), ('ortodonti_vida', 'RC-TEL', 0.4, 10, null), ('ortodonti_vida', 'RC-VIDA', 1, 0, null),
  ('ortodonti_vida', 'RC-AKRSOG', 18, 15, null), ('ortodonti_vida', 'RC-AKRSOGL', 9, 10, null), ('ortodonti_vida', 'RC-POLISAJ', 1, 0, null), ('ortodonti_vida', 'RC-PAKET', 1, 0, null),
  -- Wax-up (diş başına)
  ('wax_up', 'RC-ALCI4', 20, 10, null), ('wax_up', 'RC-KAIDE', 15, 10, null), ('wax_up', 'RC-MUM', 1.5, 10, null),
  -- Model
  ('model', 'RC-KAIDE', 200, 10, null), ('model', 'RC-PAKET', 0.5, 0, null),
  ('model_3d', 'RC-3DRES', 30, 10, 'Çene başına'), ('model_3d', 'RC-PAKET', 0.5, 0, null)
on conflict do nothing;

insert into prd_tpl_steps (tpl, station, minutes) values
  ('zirkon', 'MDL', 10), ('zirkon', 'CAD', 12), ('zirkon', 'FRZ', 6), ('zirkon', 'SNT', 3), ('zirkon', 'BIT', 15), ('zirkon', 'QC', 3), ('zirkon', 'PAK', 2),
  ('zirkon_por', 'MDL', 10), ('zirkon_por', 'CAD', 12), ('zirkon_por', 'FRZ', 6), ('zirkon_por', 'SNT', 3), ('zirkon_por', 'POR', 40), ('zirkon_por', 'BIT', 12), ('zirkon_por', 'QC', 3), ('zirkon_por', 'PAK', 2),
  ('emax_press', 'MDL', 12), ('emax_press', 'MUM', 18), ('emax_press', 'PRS', 10), ('emax_press', 'POR', 15), ('emax_press', 'BIT', 10), ('emax_press', 'QC', 3), ('emax_press', 'PAK', 2),
  ('emax_cad', 'MDL', 10), ('emax_cad', 'CAD', 12), ('emax_cad', 'FRZ', 8), ('emax_cad', 'SNT', 3), ('emax_cad', 'POR', 10), ('emax_cad', 'BIT', 8), ('emax_cad', 'QC', 3), ('emax_cad', 'PAK', 2),
  ('lamine', 'MDL', 12), ('lamine', 'MUM', 20), ('lamine', 'PRS', 10), ('lamine', 'POR', 20), ('lamine', 'BIT', 12), ('lamine', 'QC', 3), ('lamine', 'PAK', 2),
  ('pfm', 'MDL', 12), ('pfm', 'MUM', 18), ('pfm', 'DOK', 8), ('pfm', 'MTS', 20), ('pfm', 'POR', 40), ('pfm', 'BIT', 12), ('pfm', 'QC', 3), ('pfm', 'PAK', 2),
  ('metal_kron', 'MDL', 12), ('metal_kron', 'MUM', 18), ('metal_kron', 'DOK', 8), ('metal_kron', 'MTS', 25), ('metal_kron', 'BIT', 10), ('metal_kron', 'QC', 3), ('metal_kron', 'PAK', 2),
  ('postcore', 'MDL', 10), ('postcore', 'MUM', 12), ('postcore', 'DOK', 8), ('postcore', 'MTS', 12), ('postcore', 'QC', 2), ('postcore', 'PAK', 2),
  ('gecici', 'MDL', 8), ('gecici', 'CAD', 10), ('gecici', 'FRZ', 6), ('gecici', 'BIT', 10), ('gecici', 'QC', 2), ('gecici', 'PAK', 2),
  ('kompozit', 'MDL', 12), ('kompozit', 'POR', 25), ('kompozit', 'BIT', 10), ('kompozit', 'QC', 3), ('kompozit', 'PAK', 2),
  ('implant', 'MDL', 15), ('implant', 'CAD', 18), ('implant', 'FRZ', 6), ('implant', 'SNT', 3), ('implant', 'BIT', 20), ('implant', 'QC', 5), ('implant', 'PAK', 2),
  ('tam_protez', 'MDL', 15), ('tam_protez', 'DIZ', 45), ('tam_protez', 'AKR', 50), ('tam_protez', 'BIT', 30), ('tam_protez', 'QC', 5), ('tam_protez', 'PAK', 3),
  ('parsiyel', 'MDL', 15), ('parsiyel', 'ORT', 15), ('parsiyel', 'DIZ', 30), ('parsiyel', 'AKR', 40), ('parsiyel', 'BIT', 25), ('parsiyel', 'QC', 5), ('parsiyel', 'PAK', 3),
  ('iskelet', 'MDL', 20), ('iskelet', 'MUM', 45), ('iskelet', 'DOK', 15), ('iskelet', 'MTS', 50), ('iskelet', 'BIT', 20), ('iskelet', 'QC', 5), ('iskelet', 'PAK', 2),
  ('iskelet_dizim', 'DIZ', 35), ('iskelet_dizim', 'AKR', 40), ('iskelet_dizim', 'BIT', 25), ('iskelet_dizim', 'QC', 5), ('iskelet_dizim', 'PAK', 2),
  ('tamir', 'MDL', 10), ('tamir', 'AKR', 25), ('tamir', 'BIT', 15), ('tamir', 'QC', 3), ('tamir', 'PAK', 2),
  ('dis_ekleme', 'MDL', 10), ('dis_ekleme', 'DIZ', 10), ('dis_ekleme', 'AKR', 20), ('dis_ekleme', 'BIT', 15), ('dis_ekleme', 'QC', 3), ('dis_ekleme', 'PAK', 2),
  ('mum_prova', 'DIZ', 30), ('mum_prova', 'QC', 2), ('mum_prova', 'PAK', 2),
  ('kapanis', 'MDL', 10), ('kapanis', 'DIZ', 15), ('kapanis', 'PAK', 2),
  ('kasik', 'MDL', 10), ('kasik', 'AKR', 15), ('kasik', 'BIT', 8), ('kasik', 'PAK', 2),
  ('plak_sert', 'MDL', 12), ('plak_sert', 'TRM', 10), ('plak_sert', 'BIT', 20), ('plak_sert', 'QC', 3), ('plak_sert', 'PAK', 2),
  ('plak_yumusak', 'MDL', 10), ('plak_yumusak', 'TRM', 8), ('plak_yumusak', 'BIT', 10), ('plak_yumusak', 'QC', 2), ('plak_yumusak', 'PAK', 2),
  ('ortodonti', 'MDL', 12), ('ortodonti', 'ORT', 30), ('ortodonti', 'AKR', 20), ('ortodonti', 'BIT', 20), ('ortodonti', 'QC', 3), ('ortodonti', 'PAK', 2),
  ('ortodonti_vida', 'MDL', 12), ('ortodonti_vida', 'ORT', 30), ('ortodonti_vida', 'AKR', 25), ('ortodonti_vida', 'BIT', 20), ('ortodonti_vida', 'QC', 3), ('ortodonti_vida', 'PAK', 2),
  ('wax_up', 'MDL', 8), ('wax_up', 'MUM', 20), ('wax_up', 'QC', 2),
  ('model', 'MDL', 12), ('model', 'PAK', 2),
  ('model_3d', 'CAD', 8), ('model_3d', '3DP', 5), ('model_3d', 'BIT', 5), ('model_3d', 'PAK', 2)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Ad normalleştirme + kural tabanlı eşleştirme (Fransızca + Türkçe anahtar kelimeler)
-- ---------------------------------------------------------------------
create or replace function prd_norm(p text) returns text language sql immutable as $$
  select regexp_replace(translate(replace(lower(coalesce(p, '')), chr(775), ''),
         'àâäáãåéèêëíìîïóòôöõúùûüçñışğœ', 'aaaaaaeeeeiiiiooooouuuucnisgo'), '[^a-z0-9.+ ]+', ' ', 'g');
$$;

create or replace function prd_recipe_guess(p_name text) returns text language plpgsql immutable as $$
declare t text := ' ' || prd_norm(p_name) || ' ';
begin
  if t ~ '(wax.?up|cire diagnost|diagnostik mum|teshis mum)' then return 'wax_up'; end if;
  if t ~ '(stellite|chassis|squelet|iskelet|skelet)' and t ~ '(montage|dizim|finition|bitim|dents?|akrilik|resine)' then return 'iskelet_dizim'; end if;
  if t ~ '(stellite|chassis|squelet|iskelet|skelet|cr.?co.{0,12}(partiel|parsiyel))' then return 'iskelet'; end if;
  if t ~ '(porte.?empreinte|\mpei\M|kasik|individuel)' then return 'kasik'; end if;
  if t ~ '(bourrelet|maquette d.?occlusion|cire d.?occlusion|kapanis|mum duvar|ölcü kaidesi|olcu kaidesi)' then return 'kapanis'; end if;
  if t ~ '(cire|essayage|mum prova|\mprova\M|try.?in)' then return 'mum_prova'; end if;
  if t ~ '(adjonction|ajout|dis ekleme|krose ekleme|ekleme)' then return 'dis_ekleme'; end if;
  if t ~ '(repar|tamir|rebasage|rebase|kaide yenileme|besleme|soudure|fractur|kirik|refection base)' then return 'tamir'; end if;
  if t ~ '(disjoncteur|expansion|verin|\mvis\M|genisletme|quad.?helix|vidali)' and t !~ '(implant|transvis|visse)' then return 'ortodonti_vida'; end if;
  if t ~ '(ortho|hawley|activateur|aktivator|mainteneur|yer tutucu|aparey|twin.?block|plaque amovible|appareil amovible)' then return 'ortodonti'; end if;
  if t ~ '(blanchiment|beyazlatma|contention|essix|retainer|pekistirme|souple|yumusak|protege.?dent|sporcu|bleaching)' then return 'plak_yumusak'; end if;
  if t ~ '(goutti|splint|\mplak\M|bruxis|bruksizm|occlusal|night.?guard|gece plag|michigan)' then return 'plak_sert'; end if;
  if t ~ '(implant|pilier|abutment|transvis|vissee|visse|ti.?base|implant ustu)' then return 'implant'; end if;
  if t ~ '(complet|\mtotal|tam protez|total protez|prothese complete|full denture|immediat)' then return 'tam_protez'; end if;
  if t ~ '(partiel|partial|parsiyel|flexible|flexi|valplast|esnek|resine|akrilik protez)' then return 'parsiyel'; end if;
  if t ~ '(inlay.?core|faux.?moignon|pivot|tenon|post.?core|\mkor\M|dowel|kanal ici)' then return 'postcore'; end if;
  if t ~ '(provisoire|temporaire|gecici|\mpmma\M|\mtemp)' then return 'gecici'; end if;
  if t ~ '(facette|veneer|lamin)' then return 'lamine'; end if;
  if t ~ '(e.?max|disilicat|lityum|lithium)' and t ~ '(cad|bloc|blok|frez)' then return 'emax_cad'; end if;
  if t ~ '(e.?max|disilicat|lityum|lithium|empress|pressee|pres seramik|ceramique press)' then return 'emax_press'; end if;
  if t ~ '(composite|kompozit)' then return 'kompozit'; end if;
  if t ~ '(zirc|zirk)' and t ~ '(ceram|porsel|strati|layer|cut.?back|cosmet|tabakal)' then return 'zirkon_por'; end if;
  if t ~ '(zirc|zirk|monolit|full contour)' then return 'zirkon'; end if;
  if t ~ '(inlay|onlay|inley|onley)' then return 'emax_press'; end if;
  if t ~ '(coulee|tout metal|full metal|metal kron|metal crown|couronne metal|dokum kron|tam metal)' and t !~ '(ceram|porsel)' then return 'metal_kron'; end if;
  if t ~ '(ceram|porsel|\mccm\M|metal.?ceram|metal destekli|\mpfm\M|noritake)' then return 'pfm'; end if;
  if t ~ '(couronne|\mkron|bridge|kopru|element|\munite|\muye\M|dent sur)' then return 'pfm'; end if;
  if t ~ '(\m3d\M|imprim|baski|print)' then return 'model_3d'; end if;
  if t ~ '(modele|\mmodel|etude|antagon|alci|platre)' then return 'model'; end if;
  if t ~ '(retouche|rotus|transport|livraison|frais|\mport\M|kargo|kurye|remise|indirim|divers|teinte|renk|photo|foto|refait|refaire|yeniden|garanti|forfait|supplement|urgence|acil|scan|tarama|design|tasarim|teslim)' then return 'hizmet'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Reçete yazıcı (yetki kontrolü çağırandadır)
-- ---------------------------------------------------------------------
create or replace function prd_recipe_apply_core(p_product uuid, p_tpl text) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid; r record; v_item uuid; v_st uuid; n int := 0;
begin
  select coalesce(company_id, lab_company()) into c from lab_products where id = p_product;
  if c is null then return 0; end if;
  delete from stk_boms where lab_product_id = p_product;
  delete from prd_route_steps where lab_product_id = p_product;
  if p_tpl is not null then
    for r in select l.*, i.name, i.unit, i.kind, i.price from prd_tpl_lines l join prd_tpl_items i on i.code = l.code where l.tpl = p_tpl loop
      select id into v_item from stk_items where company_id = c and lower(code) = lower(r.code) limit 1;
      if v_item is null then
        insert into stk_items (company_id, code, name, kind, unit, purchase_price, purchase_currency, note)
        values (c, r.code, r.name, r.kind, r.unit, r.price, 'TRY', 'Reçete şablonu · tahmini fiyat, alış yapınca güncellenir')
        returning id into v_item;
      end if;
      insert into stk_boms (lab_product_id, item_id, qty, waste_pct, note) values (p_product, v_item, r.qty, r.waste, r.note)
      on conflict (lab_product_id, item_id) do update set qty = excluded.qty, waste_pct = excluded.waste_pct, note = excluded.note;
      n := n + 1;
    end loop;
    for r in select s.minutes, st.* from prd_tpl_steps s join prd_tpl_stations st on st.code = s.station where s.tpl = p_tpl loop
      select id into v_st from prd_stations where company_id = c and upper(code) = r.code limit 1;
      if v_st is null then
        insert into prd_stations (company_id, code, name, kind, color, sort, labor_rate_min) values (c, r.code, r.name, r.kind, r.color, r.sort, r.rate) returning id into v_st;
      else
        update prd_stations set labor_rate_min = coalesce(labor_rate_min, r.rate) where id = v_st;
      end if;
      insert into prd_route_steps (lab_product_id, station_id, sort, std_minutes, consume) values (p_product, v_st, r.sort, r.minutes, false)
      on conflict (lab_product_id, station_id) do update set std_minutes = excluded.std_minutes, sort = excluded.sort;
    end loop;
  end if;
  insert into prd_recipe_plan (product_id, company_id, tpl, applied_tpl, applied_at) values (p_product, c, p_tpl, coalesce(p_tpl, 'hizmet'), now())
  on conflict (product_id) do update set applied_tpl = coalesce(p_tpl, 'hizmet'), applied_at = now();
  insert into prd_cost_settings (company_id) values (c) on conflict (company_id) do nothing;
  return n;
end $$;
revoke execute on function prd_recipe_apply_core(uuid, text) from public, anon, authenticated;

create or replace function prd_recipe_can_edit() returns boolean language sql stable as $$
  select auth.uid() is null or can_module('production', 2) or can_module('stock', 2);
$$;

-- Planı olmayan ürünlere kural ile şablon atar; kural kaynaklı planları yeniler (ad değişmiş olabilir)
create or replace function prd_recipe_refresh() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_new int; n_upd int;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  insert into prd_recipe_plan (product_id, company_id, tpl, source)
  select p.id, coalesce(p.company_id, lab_company()), prd_recipe_guess(p.name || ' ' || coalesce(p.name_tr, '') || ' ' || coalesce(p.material, '')), 'kural'
    from lab_products p
   where (p.company_id = lab_company() or p.company_id is null)
     and not exists (select 1 from prd_recipe_plan x where x.product_id = p.id)
  on conflict (product_id) do nothing;
  get diagnostics n_new = row_count;
  update prd_recipe_plan x set tpl = g.tpl, updated_at = now()
    from (select p.id, prd_recipe_guess(p.name || ' ' || coalesce(p.name_tr, '') || ' ' || coalesce(p.material, '')) tpl from lab_products p) g
   where g.id = x.product_id and x.source = 'kural' and x.tpl is distinct from g.tpl;
  get diagnostics n_upd = row_count;
  return jsonb_build_object('new', n_new, 'updated', n_upd);
end $$;
revoke execute on function prd_recipe_refresh() from public, anon;
grant execute on function prd_recipe_refresh() to authenticated;

-- Reçetesi olmayan ya da şablondan oluşmuş ve şablonu değişmiş ürünlere uygular. p_force: şablondan oluşmuşları yeniden yazar.
create or replace function prd_recipe_apply_all(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n_app int := 0; n_skip int := 0; n_none int := 0; n_svc int := 0;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  perform prd_recipe_refresh();
  for r in
    select x.product_id, x.tpl, x.applied_tpl,
           exists (select 1 from stk_boms b where b.lab_product_id = x.product_id) or exists (select 1 from prd_route_steps s where s.lab_product_id = x.product_id) as has_recipe
      from prd_recipe_plan x join lab_products p on p.id = x.product_id
     where x.company_id = lab_company() and p.is_active
  loop
    if r.tpl is null then n_none := n_none + 1; continue; end if;
    if r.has_recipe and r.applied_tpl is null then n_skip := n_skip + 1; continue; end if;            -- elle girilmiş reçete: dokunma
    if r.applied_tpl is not null and r.applied_tpl = r.tpl and not p_force then continue; end if;   -- zaten uygulanmış
    perform prd_recipe_apply_core(r.product_id, case when r.tpl = 'hizmet' then null else r.tpl end);
    if r.tpl = 'hizmet' then n_svc := n_svc + 1; else n_app := n_app + 1; end if;
  end loop;
  return jsonb_build_object('applied', n_app, 'service', n_svc, 'kept_manual', n_skip, 'unmatched', n_none);
end $$;
revoke execute on function prd_recipe_apply_all(boolean) from public, anon;
grant execute on function prd_recipe_apply_all(boolean) to authenticated;

-- Tek ürüne şablon ata (elle) ve uygula
create or replace function prd_recipe_set(p_product uuid, p_tpl text, p_apply boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from lab_products where id = p_product and (company_id = lab_company() or company_id is null)) then raise exception 'not_found'; end if;
  if p_tpl is not null and not exists (select 1 from prd_tpl where key = p_tpl) then raise exception 'bad_template'; end if;
  insert into prd_recipe_plan (product_id, company_id, tpl, source) values (p_product, lab_company(), p_tpl, 'elle')
  on conflict (product_id) do update set tpl = excluded.tpl, source = 'elle', updated_at = now();
  if p_apply and p_tpl is not null then n := prd_recipe_apply_core(p_product, case when p_tpl = 'hizmet' then null else p_tpl end); end if;
  return n;
end $$;
revoke execute on function prd_recipe_set(uuid, text, boolean) from public, anon;
grant execute on function prd_recipe_set(uuid, text, boolean) to authenticated;

-- Yapay zekâ eşleştirmesi: [{id, tpl}] — elle seçilenlere dokunmaz
create or replace function prd_recipe_set_bulk(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  for e in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if (e->>'tpl') is not null and not exists (select 1 from prd_tpl where key = e->>'tpl') then continue; end if;
    insert into prd_recipe_plan (product_id, company_id, tpl, source)
    select l.id, lab_company(), e->>'tpl', 'ai' from lab_products l where l.id = (e->>'id')::uuid and (l.company_id = lab_company() or l.company_id is null)
    on conflict (product_id) do update set tpl = excluded.tpl, source = 'ai', updated_at = now() where prd_recipe_plan.source <> 'elle';
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function prd_recipe_set_bulk(jsonb) from public, anon;
grant execute on function prd_recipe_set_bulk(jsonb) to authenticated;

-- Ekran listesi
create or replace function prd_recipe_wizard() returns table (
  id uuid, code text, name text, name_tr text, material text, per_unit boolean, is_active boolean, tpl text, source text, applied_tpl text,
  lines int, steps int, has_manual boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not prd_cost_can() then raise exception 'not_allowed'; end if;
  return query
  select p.id, p.code, p.name, p.name_tr, p.material, p.per_unit, p.is_active, x.tpl, x.source, x.applied_tpl,
         (select count(*)::int from stk_boms b where b.lab_product_id = p.id), (select count(*)::int from prd_route_steps s where s.lab_product_id = p.id),
         (x.applied_tpl is null and exists (select 1 from stk_boms b where b.lab_product_id = p.id))
    from lab_products p left join prd_recipe_plan x on x.product_id = p.id
   where p.company_id = lab_company() or p.company_id is null
   order by p.is_active desc, p.sort, p.name;
end $$;
revoke execute on function prd_recipe_wizard() from public, anon;
grant execute on function prd_recipe_wizard() to authenticated;

-- İlk çalıştırma: kural ile eşleştir ve reçetesi olmayan tüm aktif ürünlere reçete yaz
select prd_recipe_apply_all(false);

notify pgrst, 'reload schema';
