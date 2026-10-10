-- =====================================================================
-- Portal ↔ laboratuvar bağlantısı
--  1) Laboratuvar ekibine telefon bildirimi: yeni portal vakası, hekim mesajı, hekimin kargo / kurye bildirimi
--  2) İş kaydı ve giden kargo durumları portal vakasına otomatik yansır (hekim canlı görür)
-- Tekrar çalıştırılabilir. Önce 20261124 (kargo) ve 20261125 (iş kayıt) çalıştırılmış olmalı.
-- =====================================================================

-- Bildirim alacak laboratuvar kullanıcıları: sahip, şef ve "Laboratuvar / kargo" yetkilileri
create or replace function lab_recipients() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from memberships m
  where m.role in ('owner', 'branch_manager') or m.logistics_access;
$$;
revoke execute on function lab_recipients() from public, anon, authenticated;

create or replace function lab_company() returns uuid
language sql stable security definer set search_path = public as $$
  select id from companies order by created_at limit 1;
$$;

-- Yeni portal vakası → bildirim (bağlantı: iş kaydını vaka bilgileriyle açar)
create or replace function notify_portal_case() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(company, name) into who from portal_accounts where id = new.account_id;
  perform deliver(lab_company(), lab_recipients(), 'Yeni portal vakası #' || new.no,
                  coalesce(who, '') || ' · ' || new.patient_ref, '/isler/yeni?vaka=' || new.id);
  return new;
exception when others then return new;   -- bildirim hatası vaka kaydını engellemesin
end $$;
drop trigger if exists notify_portal_case on portal_cases;
create trigger notify_portal_case after insert on portal_cases for each row execute function notify_portal_case();

-- Hekimden mesaj → bildirim
create or replace function notify_portal_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c portal_cases; who text;
begin
  if new.kind <> 'message' or new.from_lab then return new; end if;
  select * into c from portal_cases where id = new.case_id;
  select coalesce(company, name) into who from portal_accounts where id = c.account_id;
  perform deliver(lab_company(), lab_recipients(), 'Hekim mesajı · vaka #' || c.no,
                  coalesce(who, '') || ': ' || left(coalesce(new.body, ''), 140), '/isler?q=' || c.patient_ref);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_portal_message on portal_case_events;
create trigger notify_portal_message after insert on portal_case_events for each row execute function notify_portal_message();

-- Hekimin kargo / kurye bildirimi → bildirim
create or replace function notify_portal_shipment() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.portal_account_id is null or new.direction <> 'in' or can_logistics() then return new; end if;
  select coalesce(company, name) into who from portal_accounts where id = new.portal_account_id;
  perform deliver(lab_company(), lab_recipients(),
                  case when new.carrier = 'our_courier' then 'Kurye talebi' else 'Kargo bildirimi' end,
                  coalesce(who, '') || ' · ' ||
                  case when new.carrier = 'our_courier' then to_char(new.courier_date, 'DD.MM.YYYY') else upper(new.carrier::text) || ' ' || coalesce(new.tracking_no, '') end
                  || ' · ' || new.package_count || ' paket',
                  '/kargo/' || new.id);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_portal_shipment on shipments;
create trigger notify_portal_shipment after insert on shipments for each row execute function notify_portal_shipment();

-- İş kaydı durumu → portal vakası durumu
create or replace function sync_job_to_case() returns trigger
language plpgsql security definer set search_path = public as $$
declare target portal_case_status;
begin
  if new.portal_case_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.portal_case_id is not distinct from old.portal_case_id then return new; end if;
  target := case new.status
    when 'open' then 'production'
    when 'tryin' then 'production'
    when 'ready' then 'quality'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
  end;
  -- Geri gitme: kargoda / teslim edilmiş vakayı üretime çekme
  update portal_cases set status = target
  where id = new.portal_case_id and status is distinct from target
    and not (status in ('shipped', 'delivered') and target in ('production', 'quality'));
  return new;
end $$;
drop trigger if exists sync_job_to_case on jobs;
create trigger sync_job_to_case after insert or update on jobs for each row execute function sync_job_to_case();

-- Giden kargo → portal vakası "kargoda / teslim edildi" + takip numarası
create or replace function sync_shipment_to_case() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if new.direction <> 'out' then return new; end if;
  cid := coalesce(new.portal_case_id, (select portal_case_id from jobs where shipment_id = new.id limit 1));
  if cid is null then return new; end if;
  if new.status in ('in_transit', 'at_customs', 'out_for_delivery') then
    update portal_cases set status = 'shipped', tracking = coalesce(new.tracking_no, tracking) where id = cid and status not in ('shipped', 'delivered', 'cancelled');
  elsif new.status = 'delivered' then
    update portal_cases set status = 'delivered' where id = cid and status <> 'delivered';
  end if;
  return new;
end $$;
drop trigger if exists sync_shipment_to_case on shipments;
create trigger sync_shipment_to_case after insert or update of status on shipments for each row execute function sync_shipment_to_case();

notify pgrst, 'reload schema';
