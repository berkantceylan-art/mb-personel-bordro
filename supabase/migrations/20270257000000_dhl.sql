-- =====================================================================
-- DHL Express entegrasyonu
--  * Otomatik takip (DHL Shipment Tracking – Unified API): durum, son olay, tahmini teslim
--  * MyDHL API: giden gönderi / ithalat (alım) gönderisi açma, etiket + ticari fatura PDF, kurye çağırma, fiyat sorma
--  * dhl_settings: gönderici (laboratuvar) adresi ve varsayılanlar
-- Tekrar çalıştırılabilir.
-- =====================================================================

alter table shipments add column if not exists country_code char(2);
alter table shipments add column if not exists postal_code text check (postal_code is null or length(postal_code) <= 20);
alter table shipments add column if not exists email text check (email is null or length(email) <= 200);
alter table shipments add column if not exists dhl_status text;                  -- pre-transit | transit | delivered | failure | unknown
alter table shipments add column if not exists dhl_last_event text;
alter table shipments add column if not exists dhl_last_event_at timestamptz;
alter table shipments add column if not exists dhl_location text;
alter table shipments add column if not exists dhl_eta date;
alter table shipments add column if not exists dhl_checked_at timestamptz;
alter table shipments add column if not exists dhl_error text;
alter table shipments add column if not exists dhl_events jsonb;                 -- son olaylar [{at, text, place, code}]
alter table shipments add column if not exists dhl_created boolean not null default false;   -- gönderi MyDHL API ile açıldı
alter table shipments add column if not exists dhl_product text;
alter table shipments add column if not exists dhl_pickup_ref text;
alter table shipments add column if not exists dhl_weight numeric(8, 3);
alter table shipments add column if not exists dhl_cost bigint;
alter table shipments add column if not exists dhl_cost_currency text;
create index if not exists shipments_dhl_poll_idx on shipments (dhl_checked_at nulls first)
  where carrier = 'dhl' and tracking_no is not null and status not in ('arrived', 'opened', 'job_created', 'delivered', 'returned', 'cancelled');

create table if not exists dhl_settings (
  company_id uuid primary key references companies (id) on delete cascade,
  test_mode boolean not null default true,
  shipper_company text not null default 'MB Dental',
  shipper_name text,
  address1 text,
  address2 text,
  city text,
  county text,
  postal_code text,
  country_code char(2) not null default 'TR',
  phone text,
  email text,
  product_code text not null default 'P',                    -- P = EXPRESS WORLDWIDE (paket)
  hs_code text not null default '902129',                    -- diş protezi (ısmarlama tıbbi cihaz)
  item_desc text not null default 'Custom-made dental prosthesis (medical device)',
  incoterm text not null default 'DAP',
  currency text not null default 'EUR',
  default_value numeric(10, 2) not null default 50,
  default_weight numeric(6, 3) not null default 0.5,
  length_cm int not null default 20,
  width_cm int not null default 15,
  height_cm int not null default 10,
  pickup_close text not null default '18:00',
  pickup_location text not null default 'Resepsiyon',
  updated_at timestamptz not null default now()
);
alter table dhl_settings enable row level security;
drop policy if exists dhl_settings_rw on dhl_settings;
create policy dhl_settings_rw on dhl_settings for all to authenticated using (can_logistics()) with check (can_logistics());

-- Durum geçmişine kaynak: DHL otomatik güncellemesi "DHL" olarak görünsün
create or replace function shipments_status_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text := nullif(current_setting('app.ship_source', true), '');
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into shipment_events (shipment_id, status, source, note)
    values (new.id, new.status, coalesce(v_src, case when can_logistics() then 'manual' else 'portal' end), nullif(current_setting('app.ship_note', true), ''));
  end if;
  return new;
end $$;

-- DHL takip sonucunu uygula (cron ve "şimdi sorgula" düğmesi). Durum yalnız ileri gider.
create or replace function dhl_apply_track(p_id uuid, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare s shipments; v_new shipment_status; v_order text[] := array['expected', 'ready', 'in_transit', 'at_customs', 'out_for_delivery', 'arrived', 'delivered'];
begin
  if auth.uid() is not null and not can_logistics() then raise exception 'not_allowed'; end if;
  select * into s from shipments where id = p_id for update;
  if not found then return null; end if;
  v_new := nullif(p->>'status', '')::shipment_status;
  -- açıldı / iş kaydı / iade / iptal edilmiş paketin durumuna dokunma; geri gitme
  if v_new is not null and (s.status in ('opened', 'job_created', 'returned', 'cancelled', 'delivered')
      or array_position(v_order, v_new::text) <= coalesce(array_position(v_order, s.status::text), 0)) then
    v_new := null;
  end if;
  perform set_config('app.ship_source', 'dhl', true);
  perform set_config('app.ship_note', coalesce(p->>'event', ''), true);
  update shipments set
    status = coalesce(v_new, status),
    dhl_status = coalesce(p->>'dhl_status', dhl_status),
    dhl_last_event = coalesce(p->>'event', dhl_last_event),
    dhl_last_event_at = coalesce((p->>'event_at')::timestamptz, dhl_last_event_at),
    dhl_location = coalesce(p->>'place', dhl_location),
    dhl_eta = coalesce((p->>'eta')::date, dhl_eta),
    dhl_events = coalesce(p->'events', dhl_events),
    dhl_error = p->>'error',
    dhl_checked_at = now()
  where id = p_id;
  -- durum değişmedi ama yeni bir DHL olayı geldiyse geçmişe not düş
  if v_new is null and p->>'event' is not null and p->>'event' is distinct from s.dhl_last_event then
    insert into shipment_events (shipment_id, status, source, note) values (p_id, null, 'dhl', left(p->>'event', 1000));
  end if;
  perform set_config('app.ship_source', '', true);
  perform set_config('app.ship_note', '', true);
  return v_new::text;
end $$;
revoke execute on function dhl_apply_track(uuid, jsonb) from public, anon;
grant execute on function dhl_apply_track(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
