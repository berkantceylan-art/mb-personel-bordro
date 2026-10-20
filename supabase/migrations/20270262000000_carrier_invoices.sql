-- =====================================================================
-- Kargo faturaları (DHL / UPS): fatura ↔ konşimento eşleştirme ve kontrol
--  carrier_invoices      : fatura başlığı (PDF / Excel / e-posta)
--  carrier_invoice_items : konşimento (AWB) satırları — ağırlık, taşıma bedeli, ek ücretler
--  Eşleştirme: takip no → kargo gönderisi; gönderi yoksa alıcı adı → hekim
-- Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists carrier_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  carrier text not null check (carrier in ('dhl', 'ups')),
  invoice_no text not null check (length(invoice_no) between 3 and 40),
  ettn text check (ettn is null or length(ettn) <= 60),
  invoice_date date,
  due_date date,
  bill_type text check (bill_type is null or length(bill_type) <= 40),     -- Gönderici ödemeli / Alıcı ödemeli / EXPORT / IMPORT
  account_no text check (account_no is null or length(account_no) <= 40),
  currency text not null default 'TRY',
  total bigint not null default 0,                                       -- kuruş
  vat_total bigint not null default 0,
  eur_total bigint,
  eur_rate numeric(12, 4),
  shipments int not null default 0,
  detail_total bigint not null default 0,                                -- satırların toplamı (kontrol)
  source text not null default 'upload' check (source in ('upload', 'mail')),
  file_name text check (file_name is null or length(file_name) <= 200),
  mail_ref text check (mail_ref is null or length(mail_ref) <= 300),
  status text not null default 'open' check (status in ('open', 'checked', 'disputed')),
  note text check (note is null or length(note) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, carrier, invoice_no)
);

create table if not exists carrier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references carrier_invoices (id) on delete cascade,
  awb text not null check (length(awb) between 3 and 40),
  ship_date date,
  origin text, dest text, dest_country text, product text,
  weight numeric(10, 2),
  weight_basis text,                       -- DHL: A müşteri tartı, V müşteri hacim, B DHL tartı, W DHL hacim, M karma
  base_amount bigint not null default 0,   -- taşıma bedeli (kuruş)
  extras jsonb not null default '[]',      -- [{name, amount}]
  extras_total bigint not null default 0,
  total bigint not null default 0,
  src_currency text, src_amount bigint,    -- UPS: USD / EUR karşılığı
  recipient text, recipient_company text, address text,
  shipment_id uuid references shipments (id) on delete set null,
  customer_id uuid references lab_customers (id) on delete set null,
  disputed boolean not null default false,
  note text check (note is null or length(note) <= 500)
);
create index if not exists carrier_items_awb_idx on carrier_invoice_items (awb);
create index if not exists carrier_items_inv_idx on carrier_invoice_items (invoice_id);
create index if not exists carrier_items_customer_idx on carrier_invoice_items (customer_id);

alter table carrier_invoices enable row level security;
alter table carrier_invoice_items enable row level security;
drop policy if exists carrier_invoices_rw on carrier_invoices;
create policy carrier_invoices_rw on carrier_invoices for all to authenticated
  using (company_id = lab_company() and (can_logistics() or can_module('finance')))
  with check (company_id = lab_company() and (can_logistics() or can_module('finance', 2)));
drop policy if exists carrier_items_rw on carrier_invoice_items;
create policy carrier_items_rw on carrier_invoice_items for all to authenticated
  using (exists (select 1 from carrier_invoices i where i.id = invoice_id and i.company_id = lab_company()) and (can_logistics() or can_module('finance')))
  with check (exists (select 1 from carrier_invoices i where i.id = invoice_id and i.company_id = lab_company()) and (can_logistics() or can_module('finance', 2)));

create or replace function carrier_awb(t text) returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '\s+', '', 'g')), '')
$$;

-- Konşimento → gönderi / hekim eşleştirmesi (tek satır)
create or replace function carrier_item_match(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it carrier_invoice_items; inv carrier_invoices; v_ship shipments; v_cust uuid;
begin
  select * into it from carrier_invoice_items where id = p_item;
  select * into inv from carrier_invoices where id = it.invoice_id;
  select * into v_ship from shipments s where s.company_id = inv.company_id and carrier_awb(s.tracking_no) = carrier_awb(it.awb) order by s.created_at desc limit 1;
  if v_ship.id is not null and v_ship.portal_account_id is not null then
    select id into v_cust from lab_customers where company_id = inv.company_id and portal_account_id = v_ship.portal_account_id limit 1;
  end if;
  if v_cust is null then
    select c.id into v_cust from lab_customers c where c.company_id = inv.company_id and length(dsis_norm(c.name)) >= 5
       and (dsis_norm(it.recipient_company) like '%' || dsis_norm(c.name) || '%' or dsis_norm(it.recipient) like '%' || dsis_norm(c.name) || '%'
            or dsis_norm(c.name) like '%' || dsis_norm(it.recipient_company) || '%' or (v_ship.id is not null and dsis_norm(v_ship.party_name) = dsis_norm(c.name)))
     order by length(c.name) desc limit 1;
  end if;
  update carrier_invoice_items set shipment_id = coalesce(v_ship.id, shipment_id), customer_id = coalesce(customer_id, v_cust) where id = p_item;
end $$;

-- Fatura kaydet (başlık + satırlar). Aynı fatura no tekrar gelirse satırlar yenilenir (eşleştirme / itiraz işaretleri korunur).
-- p: {carrier, invoice_no, ettn, invoice_date, due_date, bill_type, account_no, total, vat_total, eur_total, eur_rate, source, file_name, mail_ref,
--     items: [{awb, ship_date, origin, dest, dest_country, product, weight, weight_basis, base_amount, extras:[{name, amount}], total, src_currency, src_amount, recipient, recipient_company, address}]}
create or replace function carrier_invoice_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_id uuid; r jsonb; v_item uuid; n int := 0; v_old jsonb; v_has_items boolean := jsonb_array_length(coalesce(p->'items', '[]')) > 0;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if p->>'carrier' not in ('dhl', 'ups') or coalesce(p->>'invoice_no', '') = '' then raise exception 'bad_invoice'; end if;
  insert into carrier_invoices (company_id, carrier, invoice_no, ettn, invoice_date, due_date, bill_type, account_no, total, vat_total, eur_total, eur_rate, source, file_name, mail_ref)
  values (c, p->>'carrier', upper(trim(p->>'invoice_no')), nullif(p->>'ettn', ''), nullif(p->>'invoice_date', '')::date, nullif(p->>'due_date', '')::date,
          nullif(left(p->>'bill_type', 40), ''), nullif(left(p->>'account_no', 40), ''), coalesce((p->>'total')::bigint, 0), coalesce((p->>'vat_total')::bigint, 0),
          nullif(p->>'eur_total', '')::bigint, nullif(p->>'eur_rate', '')::numeric, coalesce(nullif(p->>'source', ''), 'upload'), left(p->>'file_name', 200), left(p->>'mail_ref', 300))
  on conflict (company_id, carrier, invoice_no) do update set
    ettn = coalesce(excluded.ettn, carrier_invoices.ettn), invoice_date = coalesce(excluded.invoice_date, carrier_invoices.invoice_date),
    due_date = coalesce(excluded.due_date, carrier_invoices.due_date), bill_type = coalesce(excluded.bill_type, carrier_invoices.bill_type),
    account_no = coalesce(excluded.account_no, carrier_invoices.account_no),
    -- ayrıntı dosyası (UPS Excel) fatura toplamını ezmez; PDF toplamı esastır
    total = case when excluded.total > 0 and (not coalesce((p->>'detail_only')::boolean, false) or carrier_invoices.total = 0) then excluded.total else carrier_invoices.total end,
    vat_total = case when excluded.total > 0 and not coalesce((p->>'detail_only')::boolean, false) then excluded.vat_total else carrier_invoices.vat_total end,
    eur_total = coalesce(excluded.eur_total, carrier_invoices.eur_total), eur_rate = coalesce(excluded.eur_rate, carrier_invoices.eur_rate),
    file_name = coalesce(carrier_invoices.file_name, excluded.file_name)
  returning id into v_id;
  if v_has_items then
    select coalesce(jsonb_object_agg(awb, jsonb_build_object('s', shipment_id, 'c', customer_id, 'd', disputed, 'n', note)), '{}') into v_old from carrier_invoice_items where invoice_id = v_id;
    delete from carrier_invoice_items where invoice_id = v_id;
    for r in select * from jsonb_array_elements(p->'items') loop
      insert into carrier_invoice_items (invoice_id, awb, ship_date, origin, dest, dest_country, product, weight, weight_basis, base_amount, extras, extras_total, total,
                                         src_currency, src_amount, recipient, recipient_company, address, shipment_id, customer_id, disputed, note)
      values (v_id, carrier_awb(r->>'awb'), nullif(r->>'ship_date', '')::date, left(r->>'origin', 10), left(r->>'dest', 10), left(r->>'dest_country', 60), left(r->>'product', 20),
              nullif(r->>'weight', '')::numeric, left(r->>'weight_basis', 4), coalesce((r->>'base_amount')::bigint, 0), coalesce(r->'extras', '[]'),
              coalesce((select sum((x->>'amount')::bigint) from jsonb_array_elements(coalesce(r->'extras', '[]')) x), 0), coalesce((r->>'total')::bigint, 0),
              left(r->>'src_currency', 3), nullif(r->>'src_amount', '')::bigint, left(r->>'recipient', 160), left(r->>'recipient_company', 160), left(r->>'address', 400),
              nullif(v_old->carrier_awb(r->>'awb')->>'s', '')::uuid, nullif(v_old->carrier_awb(r->>'awb')->>'c', '')::uuid,
              coalesce((v_old->carrier_awb(r->>'awb')->>'d')::boolean, false), v_old->carrier_awb(r->>'awb')->>'n')
      returning id into v_item;
      perform carrier_item_match(v_item);
      n := n + 1;
    end loop;
    update carrier_invoices set shipments = n, detail_total = (select coalesce(sum(total), 0) from carrier_invoice_items where invoice_id = v_id) where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'items', n);
end $$;
revoke execute on function carrier_invoice_save(jsonb) from public, anon;
grant execute on function carrier_invoice_save(jsonb) to authenticated;

-- Eşleşmeyenleri yeniden dene (yeni gönderi / hekim girildikten sonra)
create or replace function carrier_rematch() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  for r in select it.id from carrier_invoice_items it join carrier_invoices i on i.id = it.invoice_id
            where i.company_id = lab_company() and (it.shipment_id is null or it.customer_id is null) loop
    perform carrier_item_match(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function carrier_rematch() from public, anon;
grant execute on function carrier_rematch() to authenticated;

notify pgrst, 'reload schema';
