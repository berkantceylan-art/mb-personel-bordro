-- =====================================================================
-- ISMARLAMA CİHAZ UYGUNLUK BEYANI (MDR Ek XIII / Tıbbi Cihaz Yönetmeliği)
--  companies: laboratuvar ruhsat no, ÜTS firma no, mevzuata uygunluk sorumlusu
--  Beyan her iş için çıktıdan üretilir (malzeme lotlarıyla); bu dosya yalnız şirket alanlarını ekler.
-- Tekrar çalıştırılabilir.
-- =====================================================================
alter table companies add column if not exists lab_license_no text check (lab_license_no is null or length(lab_license_no) <= 80);
alter table companies add column if not exists uts_firm_no text check (uts_firm_no is null or length(uts_firm_no) <= 80);
alter table companies add column if not exists mdr_person text check (mdr_person is null or length(mdr_person) <= 120);
alter table companies add column if not exists mdr_person_title text check (mdr_person_title is null or length(mdr_person_title) <= 120);

-- Beyan çıktısında iş malzemeleri: üretim / laboratuvar yetkilisi okur (tablo RLS'i zaten var); sayfa tek sorguda alsın
create or replace function mdr_job_materials(p_jobs uuid[]) returns table (job_id uuid, item text, code text, lot_no text, expiry_date date, qty numeric, unit text)
language sql stable security definer set search_path = public as $$
  select m.job_id, i.name, i.code, m.lot_no, m.expiry_date, m.qty, i.unit
  from prd_job_materials m join stk_items i on i.id = m.item_id
  where m.job_id = any (p_jobs) and (can_logistics() or can_module('production') or can_module('sales'))
  order by m.created_at;
$$;
revoke execute on function mdr_job_materials(uuid[]) from public, anon;
grant execute on function mdr_job_materials(uuid[]) to authenticated;

notify pgrst, 'reload schema';
