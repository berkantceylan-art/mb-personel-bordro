-- =====================================================================
-- Kargo, gümrük ve kurye takibi (ERP · Lojistik)
--
-- shipments        : gelen / giden paket (DHL, UPS, gümrük, bizim kurye, hekimin kuryesi...)
-- shipment_events  : durum geçmişi (elle, portal, tarama, ileride DHL/UPS otomatik)
-- shipment_files   : açılış fotoğrafı, gümrük belgesi, teslim imzası
-- shipment-files   : gizli depo; yol = <gönderi_id>/<uuid>-<dosya>
--
-- Yetki: ERP'de sahip, muhasebe, İK, şef ya da memberships.logistics_access işaretli kişi.
-- Portal hesabı kendi paketlerini görür; "kargoya verdim" ve "kurye ile alın" bildirimini RPC ile yapar.
-- Tekrar çalıştırılabilir.
-- =====================================================================

alter table memberships add column if not exists logistics_access boolean not null default false;

do $t$ begin
  create type shipment_direction as enum ('in', 'out');
exception when duplicate_object then null; end $t$;
do $t$ begin
  create type shipment_carrier as enum ('dhl', 'ups', 'customs', 'our_courier', 'client_courier', 'post', 'other');
exception when duplicate_object then null; end $t$;
do $t$ begin
  create type shipment_status as enum (
    'expected',          -- haber verildi / alım talebi
    'in_transit',        -- yolda
    'at_customs',        -- gümrükte
    'out_for_delivery',  -- dağıtımda / kurye yolda
    'arrived',           -- laboratuvara ulaştı (gelen) / alıcıya ulaştı (giden: delivered)
    'opened',            -- açıldı, içerik kontrol edildi
    'job_created',       -- iş kaydı açıldı
    'ready',             -- giden: sevke hazır
    'delivered',         -- giden: teslim edildi
    'returned',          -- iade
    'cancelled'
  );
exception when duplicate_object then null; end $t$;

create or replace function can_logistics() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and (m.role in ('owner', 'accountant', 'hr', 'branch_manager') or m.logistics_access)
  );
$$;

create sequence if not exists shipment_no start 1;

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  no bigint not null unique default nextval('shipment_no'),
  company_id uuid references companies (id) on delete cascade,
  direction shipment_direction not null,
  carrier shipment_carrier not null,
  status shipment_status not null default 'expected',
  tracking_no text check (tracking_no is null or length(tracking_no) between 3 and 60),
  portal_account_id uuid references portal_accounts (id) on delete set null,
  portal_case_id uuid references portal_cases (id) on delete set null,
  party_name text check (party_name is null or length(party_name) <= 160),   -- portal dışı gönderen / alıcı
  country text check (country is null or length(country) <= 60),
  city text check (city is null or length(city) <= 80),
  address text check (address is null or length(address) <= 400),
  phone text check (phone is null or length(phone) <= 40),
  package_count smallint not null default 1 check (package_count between 1 and 99),
  contents text[] not null default '{}',
  expected_on date,
  courier_date date,                                                             -- bizim kurye: alım / teslim günü
  courier_slot text check (courier_slot is null or courier_slot in ('morning', 'afternoon', 'any')),
  arrived_at timestamptz,
  opened_at timestamptz,
  delivered_at timestamptz,
  customs_broker text check (customs_broker is null or length(customs_broker) <= 120),
  customs_ref text check (customs_ref is null or length(customs_ref) <= 80),   -- beyanname / dosya no
  customs_cost bigint check (customs_cost is null or customs_cost >= 0),      -- kuruş / cent
  customs_currency text not null default 'TRY' check (customs_currency in ('TRY', 'EUR', 'USD')),
  note text check (note is null or length(note) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_status_idx on shipments (direction, status, created_at desc);
create index if not exists shipments_tracking_idx on shipments (lower(tracking_no));
create index if not exists shipments_account_idx on shipments (portal_account_id, created_at desc);
create index if not exists shipments_courier_idx on shipments (courier_date) where carrier = 'our_courier';

create table if not exists shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references shipments (id) on delete cascade,
  status shipment_status,
  note text check (note is null or length(note) <= 1000),
  source text not null default 'manual' check (source in ('manual', 'portal', 'scan', 'dhl', 'ups', 'system')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shipment_events_idx on shipment_events (shipment_id, id);

create table if not exists shipment_files (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments (id) on delete cascade,
  path text not null,
  kind text not null default 'photo' check (kind in ('photo', 'document', 'signature')),
  name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shipment_files_idx on shipment_files (shipment_id);

-- Güncelleme zamanı ve durum değişince geçmişe otomatik satır
create or replace function shipments_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'arrived' and new.arrived_at is null then new.arrived_at := now(); end if;
    if new.status = 'opened' and new.opened_at is null then new.opened_at := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists shipments_touch on shipments;
create trigger shipments_touch before insert or update on shipments for each row execute function shipments_touch();

create or replace function shipments_status_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into shipment_events (shipment_id, status, source, note)
    values (new.id, new.status, case when can_logistics() then 'manual' else 'portal' end, null);
  end if;
  return new;
end $$;
drop trigger if exists shipments_status_event on shipments;
create trigger shipments_status_event after insert or update of status on shipments for each row execute function shipments_status_event();

drop trigger if exists audit_shipments on shipments;
create trigger audit_shipments after insert or update or delete on shipments for each row execute function audit_trigger();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table shipments enable row level security;
alter table shipment_events enable row level security;
alter table shipment_files enable row level security;

drop policy if exists shipments_read on shipments;
create policy shipments_read on shipments for select to authenticated
  using (can_logistics() or (portal_account_id is not null and is_portal_member(portal_account_id)));
drop policy if exists shipments_write on shipments;
create policy shipments_write on shipments for all to authenticated using (can_logistics()) with check (can_logistics());

drop policy if exists shipment_events_read on shipment_events;
create policy shipment_events_read on shipment_events for select to authenticated
  using (exists (select 1 from shipments s where s.id = shipment_id));   -- shipments RLS'i süzer
drop policy if exists shipment_events_write on shipment_events;
create policy shipment_events_write on shipment_events for insert to authenticated with check (can_logistics());

drop policy if exists shipment_files_read on shipment_files;
create policy shipment_files_read on shipment_files for select to authenticated using (can_logistics());
drop policy if exists shipment_files_write on shipment_files;
create policy shipment_files_write on shipment_files for all to authenticated using (can_logistics()) with check (can_logistics());

-- Lojistik ekibi gönderi formunda portal hesaplarını (ad, ülke, adres için) görebilsin
drop policy if exists portal_accounts_logistics_read on portal_accounts;
create policy portal_accounts_logistics_read on portal_accounts for select to authenticated using (can_logistics());
drop policy if exists portal_cases_logistics_read on portal_cases;
create policy portal_cases_logistics_read on portal_cases for select to authenticated using (can_logistics());

-- Depo
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shipment-files', 'shipment-files', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists "shipment_files_obj_read" on storage.objects;
create policy "shipment_files_obj_read" on storage.objects for select to authenticated using (bucket_id = 'shipment-files' and can_logistics());
drop policy if exists "shipment_files_obj_write" on storage.objects;
create policy "shipment_files_obj_write" on storage.objects for insert to authenticated with check (bucket_id = 'shipment-files' and can_logistics());
drop policy if exists "shipment_files_obj_delete" on storage.objects;
create policy "shipment_files_obj_delete" on storage.objects for delete to authenticated using (bucket_id = 'shipment-files' and can_logistics());

-- ---------------------------------------------------------------------
-- Portal: "kargoya verdim" ve "kurye ile alın" bildirimi
-- ---------------------------------------------------------------------
create or replace function portal_announce_shipment(
  p_account uuid,
  p_carrier text,
  p_tracking text,
  p_count int default 1,
  p_case uuid default null,
  p_note text default null,
  p_courier_date date default null,
  p_courier_slot text default null,
  p_address text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  acc portal_accounts;
  sid uuid;
  carrier shipment_carrier;
begin
  if not is_portal_active(p_account) then raise exception 'not_allowed'; end if;
  select * into acc from portal_accounts where id = p_account;
  if p_carrier not in ('dhl', 'ups', 'post', 'client_courier', 'our_courier', 'other') then raise exception 'carrier'; end if;
  carrier := p_carrier::shipment_carrier;
  if carrier = 'our_courier' then
    if p_courier_date is null or p_courier_date < current_date then raise exception 'courier_date'; end if;
  elsif carrier in ('dhl', 'ups') and coalesce(length(trim(p_tracking)), 0) < 6 then
    raise exception 'tracking';
  end if;
  if p_case is not null and not exists (select 1 from portal_cases where id = p_case and account_id = p_account) then
    raise exception 'case';
  end if;
  -- Kötüye kullanım sınırı: hesap başına günde 30 bildirim
  if (select count(*) from shipments where portal_account_id = p_account and created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into shipments (company_id, direction, carrier, status, tracking_no, portal_account_id, portal_case_id, party_name,
                         country, city, address, phone, package_count, note, courier_date, courier_slot, created_by)
  values ((select id from companies order by created_at limit 1), 'in', carrier,
          (case when carrier = 'our_courier' then 'expected' else 'in_transit' end)::shipment_status,
          nullif(upper(regexp_replace(coalesce(p_tracking, ''), '\s', '', 'g')), ''),
          p_account, p_case, coalesce(acc.company, acc.name), acc.country, acc.city,
          left(coalesce(nullif(trim(p_address), ''), null), 400), acc.phone,
          greatest(1, least(coalesce(p_count, 1), 99)), left(nullif(trim(p_note), ''), 2000),
          p_courier_date, case when p_courier_slot in ('morning', 'afternoon', 'any') then p_courier_slot else null end, auth.uid())
  returning id into sid;
  return sid;
end $$;
revoke execute on function portal_announce_shipment(uuid, text, text, int, uuid, text, date, text, text) from public, anon;
grant execute on function portal_announce_shipment(uuid, text, text, int, uuid, text, date, text, text) to authenticated;

notify pgrst, 'reload schema';
