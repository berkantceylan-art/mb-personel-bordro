-- Dentalsis eşitleme: dsis_job_seen tablosu ilk sürümde detail_at sütunu olmadan açılmış olabilir; o zaman ayrıntısı çekilen iş
-- "bakıldı" diye işaretlenemez ve her 5 dakikada aynı 200+ iş yeniden çekilip yazılır (veritabanını yorar, sayfaları yavaşlatır).
-- Tekrar çalıştırılabilir.
alter table dsis_job_seen add column if not exists fp text;
alter table dsis_job_seen add column if not exists detail_at timestamptz;
alter table dsis_job_seen add column if not exists seen_at timestamptz not null default now();
create index if not exists dsis_job_seen_detail_idx on dsis_job_seen (detail_at);
notify pgrst, 'reload schema';
select count(*) as izlenen_is, count(detail_at) as ayrintisi_bakilan from dsis_job_seen;
