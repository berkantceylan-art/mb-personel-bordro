-- Mevzuat güncellemesi: 7578 sayılı Kanun (RG 01.05.2026, yürürlük 01.05.2026)
-- Babalık izni 5 → 10 gün; analık izni toplam 24 hafta; koruyucu aileye 10 gün ücretsiz izin
update leave_types set name = 'Babalık izni (10 gün)' where code = 'BABALIK' and company_id is null;
update leave_types set name = 'Doğum (analık) izni · 8 hafta önce + 16 hafta sonra' where code = 'DOGUM' and company_id is null;
insert into leave_types (company_id, code, name, paid, deducts_annual, is_sick_leave, color, sort_order)
select null, 'KORUYUCU', 'Koruyucu aile izni (10 gün, ücretsiz)', false, false, false, '#FCE7F3', 85
where not exists (select 1 from leave_types where company_id is null and code = 'KORUYUCU');
