-- Tedarikçi siparişleri: depo sorumlusu hazırlar → satın alma onaylar → sipariş tedarikçiye e-posta + WhatsApp ile
-- otomatik gider. Tedarikçi bağlantıdan (hesapsız) ya da kendisine tanımlanan kullanıcıyla tedarikçi portalından
-- siparişleri görür, "aldım / termin" ve "sevk ettim" bildirir.
-- Tekrar çalıştırılabilir.

-- 1) Sipariş: tedarikçi bağlantısı, gönderim ve tedarikçi yanıtı
alter table pur_orders add column if not exists supplier_token uuid not null default gen_random_uuid();
create unique index if not exists pur_orders_supplier_token on pur_orders (supplier_token);
alter table pur_orders add column if not exists send_state text not null default 'none';
alter table pur_orders drop constraint if exists pur_orders_send_state_check;
alter table pur_orders add constraint pur_orders_send_state_check check (send_state in ('none', 'queued', 'sent', 'failed', 'manual'));
alter table pur_orders add column if not exists sent_via text[] not null default '{}';
alter table pur_orders add column if not exists send_error text;
alter table pur_orders add column if not exists send_attempts int not null default 0;
alter table pur_orders add column if not exists sup_seen_at timestamptz;
alter table pur_orders add column if not exists sup_ack_at timestamptz;
alter table pur_orders add column if not exists sup_ack_by text;
alter table pur_orders add column if not exists sup_promised_date date;
alter table pur_orders add column if not exists sup_note text;
alter table pur_orders add column if not exists sup_shipped_at timestamptz;
alter table pur_orders add column if not exists sup_waybill text;
alter table pur_orders add column if not exists sup_declined_at timestamptz;

-- 2) Ayarlar: otomatik gönderim, gönderen Gmail hesabı, WhatsApp
alter table pur_settings add column if not exists auto_send boolean not null default true;
alter table pur_settings add column if not exists send_whatsapp boolean not null default true;
alter table pur_settings add column if not exists mail_account_id uuid references mail_accounts (id) on delete set null;
alter table pur_settings add column if not exists cc_email text check (cc_email is null or length(cc_email) <= 200);

-- Sipariş için e-posta / WhatsApp numarası (boşsa cari kartın e-posta / telefonu)
alter table fin_parties add column if not exists order_email text check (order_email is null or length(order_email) <= 200);
alter table fin_parties add column if not exists order_phone text check (order_phone is null or length(order_phone) <= 40);

-- 3) Tedarikçi portal kullanıcıları
create table if not exists sup_portal_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  party_id uuid not null references fin_parties (id) on delete cascade,
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 200),
  phone text check (phone is null or length(phone) <= 40),
  invite_code text unique,
  invite_expires timestamptz,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists sup_portal_users_party on sup_portal_users (party_id);
alter table sup_portal_users enable row level security;
drop policy if exists sup_portal_users_read on sup_portal_users;
create policy sup_portal_users_read on sup_portal_users for select to authenticated using (can_module('purchases') or user_id = auth.uid());
grant select on sup_portal_users to authenticated;
revoke insert, update, delete on sup_portal_users from authenticated;

-- Oturumdaki kişinin tedarikçi carileri
create or replace function sup_my_parties() returns setof uuid
language sql stable security definer set search_path = public as $$
  select party_id from sup_portal_users where user_id = auth.uid() and is_active;
$$;
grant execute on function sup_my_parties() to authenticated;

-- Tedarikçi kendi carisinin onaylanmış siparişlerini görür
drop policy if exists pur_orders_supplier on pur_orders;
create policy pur_orders_supplier on pur_orders for select to authenticated
  using (party_id in (select sup_my_parties()) and status in ('approved', 'sent', 'partial', 'received', 'invoiced'));
drop policy if exists fin_parties_supplier on fin_parties;
create policy fin_parties_supplier on fin_parties for select to authenticated using (id in (select sup_my_parties()));

-- 4) Kaydet / onaya gönder: depo sorumlusu (Stok: düzenler) da sipariş hazırlar
create or replace function pur_can_draft() returns boolean language sql stable as $$
  select can_module('purchases', 2) or can_module('stock', 2);
$$;
grant execute on function pur_can_draft() to authenticated;

create or replace function pur_order_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_old pur_orders; l jsonb; i int := 0; v_cur text := coalesce(nullif(p->>'currency', ''), 'TRY'); v_date date := coalesce(nullif(p->>'order_date', '')::date, current_date);
  v_qty numeric; v_price bigint; v_vr numeric;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if v_id is not null then
    select * into v_old from pur_orders where id = v_id for update;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status not in ('draft') then raise exception 'po_locked'; end if;
  end if;
  if not exists (select 1 from fin_parties where id = nullif(p->>'party_id', '')::uuid) then raise exception 'party_required'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if v_id is null then
    insert into pur_orders (year, no, party_id) values (extract(year from v_date)::int, lab_next_no('po', extract(year from v_date)::int), (p->>'party_id')::uuid) returning id into v_id;
  end if;
  update pur_orders set party_id = (p->>'party_id')::uuid, order_date = v_date, expected_date = nullif(p->>'expected_date', '')::date, currency = v_cur,
    warehouse_id = coalesce(nullif(p->>'warehouse_id', '')::uuid, stk_default_warehouse()), note = nullif(left(coalesce(p->>'note', ''), 1000), ''), reject_reason = null
  where id = v_id;
  delete from pur_order_lines where order_id = v_id;
  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := coalesce(nullif(l->>'qty', '')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    v_price := greatest(coalesce(nullif(l->>'unit_price', '')::bigint, 0), 0);
    v_vr := least(greatest(coalesce(nullif(l->>'vat_rate', '')::numeric, 20), 0), 100);
    i := i + 1;
    insert into pur_order_lines (order_id, sort, item_id, name, qty, unit, unit_price, vat_rate, amount)
    values (v_id, i, nullif(l->>'item_id', '')::uuid, left(coalesce(nullif(trim(l->>'name'), ''), 'Kalem'), 300), v_qty, left(coalesce(nullif(l->>'unit', ''), 'adet'), 20), v_price, v_vr, round(v_qty * v_price));
  end loop;
  if i = 0 then raise exception 'lines_required'; end if;
  perform pur_order_totals(v_id);
  return v_id;
end $$;
grant execute on function pur_order_save(jsonb) to authenticated;

-- Onaya gönder: onay akışı varsa ona göre; depo sorumlusunun hazırladığı sipariş HER ZAMAN satın almanın onayına düşer
create or replace function pur_order_submit(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_limit bigint; v_norate boolean; v_req uuid; u record;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null or o.status <> 'draft' then raise exception 'po_locked'; end if;
  update pur_orders set status = 'pending', submitted_at = now() where id = p_id;
  v_req := apr_start('purchase_order', o.id, o.total_try, null, null,
                     'Satın alma SA-' || o.year || '-' || lpad(o.no::text, 4, '0') || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') || ' · ' || to_char(o.total / 100.0, 'FM999G999G990D00') || ' ' || o.currency,
                     '/alis/siparisler/' || o.id);
  if v_req is not null then return 'pending'; end if;
  if not can_module('purchases', 2) then
    -- depo sorumlusu: satın alma yöneticilerine bildirim
    for u in select m.user_id from memberships m where m.company_id = o.company_id and module_level_for(m.user_id, 'purchases') >= 3 loop
      insert into notifications (company_id, user_id, title, body, link)
      values (o.company_id, u.user_id, 'Onay bekleyen satın alma siparişi',
              'SA-' || o.year || '-' || lpad(o.no::text, 4, '0') || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') || ' · ' || to_char(o.total / 100.0, 'FM999G999G990D00') || ' ' || o.currency,
              '/alis/siparisler/' || o.id);
    end loop;
    return 'pending';
  end if;
  select approval_limit into v_limit from pur_settings where company_id = o.company_id;
  v_norate := o.currency <> 'TRY' and fx_rate(o.currency, o.order_date) is null;
  if can_module('purchases', 3) or (coalesce(v_limit, 0) = 0) or (not v_norate and o.total_try <= v_limit) then
    update pur_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
    return 'approved';
  end if;
  return 'pending';
end $$;
grant execute on function pur_order_submit(uuid) to authenticated;

-- Onaylanınca otomatik gönderim kuyruğu
create or replace function pur_orders_send_queue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.send_state in ('none', 'failed') then
    if coalesce((select auto_send from pur_settings where company_id = new.company_id), true) then
      new.send_state := 'queued';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pur_orders_send_queue on pur_orders;
create trigger pur_orders_send_queue before update of status on pur_orders for each row execute function pur_orders_send_queue();

-- Elle "gönderildi" ya da yeniden gönder
create or replace function pur_order_send_mark(p_id uuid, p_state text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  if p_state = 'queued' then
    update pur_orders set send_state = 'queued', send_error = null where id = p_id and status in ('approved', 'sent', 'partial');
  elsif p_state = 'manual' then
    update pur_orders set send_state = 'manual', status = case when status = 'approved' then 'sent' else status end,
      sent_at = coalesce(sent_at, now()), sent_via = array(select distinct unnest(sent_via || array['manual'])) where id = p_id and status in ('approved', 'sent', 'partial');
  end if;
end $$;
grant execute on function pur_order_send_mark(uuid, text) to authenticated;

-- 5) Tedarikçi tarafı (bağlantı anahtarıyla; hesapsız da çalışır)
create or replace function sup_order_view(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o pur_orders; r jsonb;
begin
  select * into o from pur_orders where supplier_token = p_token and status in ('approved', 'sent', 'partial', 'received', 'invoiced', 'cancelled');
  if o.id is null then return null; end if;
  if o.sup_seen_at is null and not exists (select 1 from memberships where user_id = auth.uid() and company_id = o.company_id) then
    update pur_orders set sup_seen_at = now() where id = o.id;
    o.sup_seen_at := now();
  end if;
  select jsonb_build_object(
    'id', o.id, 'no', 'SA-' || o.year || '-' || lpad(o.no::text, 4, '0'), 'status', o.status, 'order_date', o.order_date, 'expected_date', o.expected_date,
    'currency', o.currency, 'subtotal', o.subtotal, 'vat_total', o.vat_total, 'total', o.total, 'note', o.note,
    'seen_at', o.sup_seen_at, 'ack_at', o.sup_ack_at, 'ack_by', o.sup_ack_by, 'promised_date', o.sup_promised_date, 'sup_note', o.sup_note,
    'shipped_at', o.sup_shipped_at, 'waybill', o.sup_waybill, 'declined_at', o.sup_declined_at,
    'supplier', (select jsonb_build_object('name', name, 'contact', contact_name) from fin_parties where id = o.party_id),
    'company', (select jsonb_build_object('name', c.name, 'address', concat_ws(', ', c.address, c.district, c.city), 'phone', c.phone, 'email', c.email, 'tax_no', c.tax_no, 'tax_office', c.tax_office) from companies c where c.id = o.company_id),
    'warehouse', (select name from stk_warehouses where id = o.warehouse_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'qty', l.qty, 'unit', l.unit, 'unit_price', l.unit_price, 'vat_rate', l.vat_rate, 'amount', l.amount, 'received_qty', l.received_qty,
                                    'code', (select code from stk_items where id = l.item_id)) order by l.sort) from pur_order_lines l where l.order_id = o.id), '[]')
  ) into r;
  return r;
end $$;
grant execute on function sup_order_view(uuid) to anon, authenticated;

create or replace function sup_notify_buyers(o pur_orders, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (company_id, user_id, title, body, link)
  select o.company_id, u, p_title, p_body, '/alis/siparisler/' || o.id
  from (select distinct unnest(array[o.created_by, o.approved_by]) u) x where u is not null;
end $$;
revoke execute on function sup_notify_buyers(pur_orders, text, text) from public, anon, authenticated;

-- Tedarikçi: "siparişi aldım" (termin tarihi + not) ya da "karşılayamıyoruz"
create or replace function sup_order_ack(p_token uuid, p_ok boolean, p_date date, p_note text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_name text := nullif(left(trim(coalesce(p_name, '')), 120), '');
begin
  select * into o from pur_orders where supplier_token = p_token and status in ('approved', 'sent', 'partial') for update;
  if o.id is null then raise exception 'order_closed'; end if;
  if v_name is null then select name into v_name from sup_portal_users where user_id = auth.uid() limit 1; end if;
  if p_ok then
    update pur_orders set sup_ack_at = now(), sup_ack_by = v_name, sup_promised_date = p_date, sup_note = nullif(left(coalesce(p_note, ''), 1000), ''), sup_declined_at = null,
      status = case when status = 'approved' then 'sent' else status end, sent_at = coalesce(sent_at, now())
    where id = o.id;
    perform sup_notify_buyers(o, 'Tedarikçi siparişi onayladı',
      'SA-' || o.year || '-' || lpad(o.no::text, 4, '0') || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') ||
      coalesce(' · termin ' || to_char(p_date, 'DD.MM.YYYY'), '') || coalesce(' · ' || nullif(p_note, ''), ''));
  else
    update pur_orders set sup_declined_at = now(), sup_ack_by = v_name, sup_note = nullif(left(coalesce(p_note, ''), 1000), '') where id = o.id;
    perform sup_notify_buyers(o, 'Tedarikçi siparişi karşılayamıyor',
      'SA-' || o.year || '-' || lpad(o.no::text, 4, '0') || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') || coalesce(' · ' || nullif(p_note, ''), ''));
  end if;
end $$;
grant execute on function sup_order_ack(uuid, boolean, date, text, text) to anon, authenticated;

-- Tedarikçi: "sevk ettim" (irsaliye no + not)
create or replace function sup_order_ship(p_token uuid, p_waybill text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare o pur_orders;
begin
  select * into o from pur_orders where supplier_token = p_token and status in ('approved', 'sent', 'partial') for update;
  if o.id is null then raise exception 'order_closed'; end if;
  update pur_orders set sup_shipped_at = now(), sup_waybill = nullif(left(trim(coalesce(p_waybill, '')), 60), ''),
    sup_note = coalesce(nullif(left(coalesce(p_note, ''), 1000), ''), sup_note), sup_ack_at = coalesce(sup_ack_at, now()),
    status = case when status = 'approved' then 'sent' else status end, sent_at = coalesce(sent_at, now())
  where id = o.id;
  perform sup_notify_buyers(o, 'Tedarikçi siparişi sevk etti',
    'SA-' || o.year || '-' || lpad(o.no::text, 4, '0') || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') ||
    coalesce(' · irsaliye ' || nullif(trim(p_waybill), ''), '') || ' · mal kabulde teslim alın');
end $$;
grant execute on function sup_order_ship(uuid, text, text) to anon, authenticated;

-- 6) Tedarikçi kullanıcıları yönetimi (Alış: düzenler)
create or replace function sup_user_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_code text; r sup_portal_users;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  if v_id is null then
    if not exists (select 1 from fin_parties where id = nullif(p->>'party_id', '')::uuid) then raise exception 'party_required'; end if;
    if coalesce(trim(p->>'email'), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
    v_code := replace(gen_random_uuid()::text, '-', '');
    insert into sup_portal_users (party_id, name, email, phone, invite_code, invite_expires)
    values ((p->>'party_id')::uuid, left(trim(coalesce(nullif(p->>'name', ''), p->>'email')), 120), lower(trim(p->>'email')), nullif(left(trim(coalesce(p->>'phone', '')), 40), ''), v_code, now() + interval '14 days')
    returning * into r;
  elsif p->>'action' = 'reinvite' then
    v_code := replace(gen_random_uuid()::text, '-', '');
    update sup_portal_users set invite_code = v_code, invite_expires = now() + interval '14 days' where id = v_id and user_id is null returning * into r;
  elsif p->>'action' = 'toggle' then
    update sup_portal_users set is_active = not is_active where id = v_id returning * into r;
  elsif p->>'action' = 'delete' then
    delete from sup_portal_users where id = v_id returning * into r;
  end if;
  if r.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object('id', r.id, 'code', r.invite_code, 'email', r.email, 'name', r.name, 'phone', r.phone, 'party_id', r.party_id);
end $$;
grant execute on function sup_user_save(jsonb) to authenticated;

-- Davet bağlantısı (hesapsız): kime ait olduğu
create or replace function sup_invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', u.name, 'email', u.email, 'party', p.name, 'company', c.name)
  from sup_portal_users u join fin_parties p on p.id = u.party_id join companies c on c.id = u.company_id
  where u.invite_code = p_code and u.user_id is null and u.is_active and u.invite_expires > now();
$$;
grant execute on function sup_invite_info(text) to anon, authenticated;

-- Giriş yapmış kişi daveti kendi hesabına bağlar (e-posta aynı olmalı)
create or replace function sup_invite_claim(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare em text;
begin
  select lower(email) into em from auth.users where id = auth.uid();
  update sup_portal_users set user_id = auth.uid(), invite_code = null, last_seen_at = now()
  where invite_code = p_code and user_id is null and is_active and invite_expires > now() and lower(email) = em;
  if not found then raise exception 'invite_invalid'; end if;
end $$;
grant execute on function sup_invite_claim(text) to authenticated;


-- Gönderim ayarları (Alış: yönetir)
create or replace function pur_settings_send_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company();
begin
  if not can_module('purchases', 3) then raise exception 'not_allowed'; end if;
  if nullif(p->>'mail_account_id', '') is not null and not exists (select 1 from mail_accounts where id = (p->>'mail_account_id')::uuid and user_id = auth.uid()) then
    raise exception 'mail_account_not_yours';
  end if;
  insert into pur_settings (company_id) values (c) on conflict (company_id) do nothing;
  update pur_settings set auto_send = coalesce((p->>'auto_send')::boolean, true), send_whatsapp = coalesce((p->>'send_whatsapp')::boolean, true),
    mail_account_id = nullif(p->>'mail_account_id', '')::uuid, cc_email = nullif(left(trim(coalesce(p->>'cc_email', '')), 200), ''), updated_at = now()
  where company_id = c;
end $$;
grant execute on function pur_settings_send_save(jsonb) to authenticated;

notify pgrst, 'reload schema';

create or replace function sup_touch() returns void language sql security definer set search_path = public as $$
  update sup_portal_users set last_seen_at = now() where user_id = auth.uid();
$$;
grant execute on function sup_touch() to authenticated;
