-- Özlük dosyası zorunlu evraklarına askerlik durum belgesi ve adli sicil kaydı eklenir
-- (askerlik belgesi kadın personelde eksik sayılmaz). Tekrar çalıştırılabilir.

insert into document_types (company_id, name, category, required, has_expiry, sort_order)
select null, 'Adli sicil kaydı', 'ozluk', true, false, 35
where not exists (select 1 from document_types where company_id is null and name = 'Adli sicil kaydı');
insert into document_types (company_id, name, category, required, has_expiry, sort_order)
select null, 'Askerlik durum belgesi', 'ozluk', true, false, 47
where not exists (select 1 from document_types where company_id is null and name = 'Askerlik durum belgesi');

update document_types set required = true, category = 'ozluk'
 where name in ('Adli sicil kaydı', 'Askerlik durum belgesi');

notify pgrst, 'reload schema';

select name, required from document_types where name in ('Adli sicil kaydı', 'Askerlik durum belgesi');
