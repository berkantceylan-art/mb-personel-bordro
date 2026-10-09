-- Emekli personel (SGDP): maaş grupları raporu ve personel kartında gösterilir.
-- Emeklilerin resmi neti ücret kaydında "Belirli net" olarak tutulur.
alter table employees add column if not exists is_retired boolean not null default false;
