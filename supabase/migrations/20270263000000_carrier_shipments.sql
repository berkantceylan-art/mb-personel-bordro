-- =====================================================================
-- Kargo firması konşimento raporu (DHL "Gönderi Detay Raporu" CSV)
--  Ne gönderdik / ne getirttik: tarih, yön (ihracat / ithalat), hizmet (Express Worldwide / 12:00),
--  beyan ağırlığı + hacim ağırlığı, tahmini ücret, ödeyen hesap, durum. Faturalarla konşimento no ile karşılaştırılır.
-- Önce 20270262000000_carrier_invoices.sql. Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists carrier_shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  carrier text not null check (carrier in ('dhl', 'ups')),
  awb text not null check (length(awb) between 3 and 40),
  ship_date date,
  direction text check (direction in ('export', 'import', 'domestic')),
  service text, service_code text,
  party_company text, party_contact text, party_city text, party_country text,   -- ihracatta alıcı, ithalatta gönderen
  pieces int, weight numeric(10, 2), vol_weight numeric(10, 3),
  est_amount bigint, est_currency text,
  account text, status text, reference text, contents text,
  declared_value numeric(12, 2), declared_currency text, incoterm text,
  customer_id uuid references lab_customers (id) on delete set null,
  file_name text,
  updated_at timestamptz not null default now(),
  unique (company_id, carrier, awb)
);
create index if not exists carrier_shipments_date_idx on carrier_shipments (company_id, ship_date desc);
alter table carrier_shipments enable row level security;
drop policy if exists carrier_shipments_rw on carrier_shipments;
create policy carrier_shipments_rw on carrier_shipments for all to authenticated
  using (company_id = lab_company() and (can_logistics() or can_module('finance')))
  with check (company_id = lab_company() and (can_logistics() or can_module('finance', 2)));

-- p: [{awb, ship_date, direction, service, service_code, party_company, party_contact, party_city, party_country, pieces, weight, vol_weight,
--      est_amount, est_currency, account, status, reference, contents, declared_value, declared_currency, incoterm}]
create or replace function carrier_shipments_save(p_carrier text, p jsonb, p_file text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); r jsonb; n int := 0; v_cust uuid;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if p_carrier not in ('dhl', 'ups') then raise exception 'bad_carrier'; end if;
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if carrier_awb(r->>'awb') is null then continue; end if;
    select lc.id into v_cust from lab_customers lc where lc.company_id = c and length(dsis_norm(lc.name)) >= 5
       and (dsis_norm(r->>'party_company') like '%' || dsis_norm(lc.name) || '%' or dsis_norm(lc.name) like '%' || dsis_norm(r->>'party_company') || '%'
            or dsis_norm(r->>'party_contact') like '%' || dsis_norm(lc.name) || '%')
     order by length(lc.name) desc limit 1;
    insert into carrier_shipments (company_id, carrier, awb, ship_date, direction, service, service_code, party_company, party_contact, party_city, party_country,
                                   pieces, weight, vol_weight, est_amount, est_currency, account, status, reference, contents, declared_value, declared_currency, incoterm, customer_id, file_name, updated_at)
    values (c, p_carrier, carrier_awb(r->>'awb'), nullif(r->>'ship_date', '')::date, nullif(r->>'direction', ''), left(r->>'service', 60), left(r->>'service_code', 10),
            left(r->>'party_company', 160), left(r->>'party_contact', 160), left(r->>'party_city', 80), left(r->>'party_country', 10),
            nullif(r->>'pieces', '')::int, nullif(r->>'weight', '')::numeric, nullif(r->>'vol_weight', '')::numeric,
            nullif(r->>'est_amount', '')::bigint, left(r->>'est_currency', 3), left(r->>'account', 60), left(r->>'status', 40), left(r->>'reference', 120),
            left(r->>'contents', 200), nullif(r->>'declared_value', '')::numeric, left(r->>'declared_currency', 3), left(r->>'incoterm', 10), v_cust, left(p_file, 200), now())
    on conflict (company_id, carrier, awb) do update set
      ship_date = excluded.ship_date, direction = excluded.direction, service = excluded.service, service_code = excluded.service_code,
      party_company = excluded.party_company, party_contact = excluded.party_contact, party_city = excluded.party_city, party_country = excluded.party_country,
      pieces = excluded.pieces, weight = excluded.weight, vol_weight = excluded.vol_weight, est_amount = excluded.est_amount, est_currency = excluded.est_currency,
      account = excluded.account, status = excluded.status, reference = excluded.reference, contents = excluded.contents,
      declared_value = excluded.declared_value, declared_currency = excluded.declared_currency, incoterm = excluded.incoterm,
      customer_id = coalesce(carrier_shipments.customer_id, excluded.customer_id), file_name = excluded.file_name, updated_at = now();
    n := n + 1;
  end loop;
  -- fatura satırlarında hekimi bulunamayanlar: konşimento raporundaki karşı taraftan
  update carrier_invoice_items it set customer_id = cs.customer_id
    from carrier_shipments cs, carrier_invoices i
   where i.id = it.invoice_id and i.company_id = c and cs.company_id = c and cs.carrier = i.carrier and cs.awb = it.awb
     and it.customer_id is null and cs.customer_id is not null;
  return jsonb_build_object('rows', n);
end $$;
revoke execute on function carrier_shipments_save(text, jsonb, text) from public, anon;
grant execute on function carrier_shipments_save(text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
