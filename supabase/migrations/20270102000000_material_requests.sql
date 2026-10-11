-- =====================================================================
-- MALZEME İSTEĞİ (personel → depo → satın alma → depo → personel, çift online imza)
--  stk_requests          : istek başlığı (no MT-YYYY-NNNN, isteyen personel, durum, gerekçe, istenen tarih)
--  stk_request_lines     : kalemler (stok kartı ya da serbest metin, miktar, teslim edilen miktar)
--  stk_request_events    : geçmiş (kim, ne zaman, ne yaptı, not)
--  stk_request_signatures: teslim imzaları (depo sorumlusu + personel), PNG dataURL
-- Durumlar:
--  pending     depoda bekliyor
--  ready       teslime hazır (depoda var ya da satın alındı)
--  purchase    satın alma onayı bekliyor
--  approved    satın alma onayladı, alınıyor
--  delivered   depo teslim etti ve imzaladı, stoktan düştü; personel imzası bekleniyor
--  completed   personel de imzaladı
--  rejected / cancelled
-- RPC'ler: stk_req_catalog, stk_req_create, stk_req_cancel, stk_req_stock (prepare / purchase / reject),
--          stk_req_purchase (approve / reject / bought), stk_req_deliver, stk_req_sign
-- Yetkiler: istek = personel kaydı olan herkes; depo = stock ≥ 2; satın alma onayı = purchases ≥ 3, "alındı" = purchases ≥ 2
-- Tekrar çalıştırılabilir. Önce 20261203000000_stock.sql ve 20261222000000_lots.sql.
-- =====================================================================

create table if not exists stk_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  employee_id uuid not null references employees (id) on delete restrict,
  requested_by uuid not null default auth.uid() references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'ready', 'purchase', 'approved', 'delivered', 'completed', 'rejected', 'cancelled')),
  reason text check (reason is null or length(reason) <= 500),
  needed_by date,
  warehouse_id uuid references stk_warehouses (id) on delete set null,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  delivered_at timestamptz,
  delivered_by uuid references auth.users (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, year, no)
);
create index if not exists stk_requests_status_idx on stk_requests (company_id, status, created_at desc);
create index if not exists stk_requests_emp_idx on stk_requests (employee_id, created_at desc);

create table if not exists stk_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references stk_requests (id) on delete cascade,
  sort int not null default 0,
  item_id uuid references stk_items (id) on delete set null,
  name text not null check (length(name) between 1 and 160),
  unit text not null default 'adet' check (length(unit) <= 20),
  qty numeric(14, 3) not null check (qty > 0),
  issued_qty numeric(14, 3) not null default 0 check (issued_qty >= 0),
  to_purchase boolean not null default false,
  note text check (note is null or length(note) <= 300)
);
create index if not exists stk_request_lines_req_idx on stk_request_lines (request_id, sort);

create table if not exists stk_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references stk_requests (id) on delete cascade,
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  action text not null,
  note text
);
create index if not exists stk_request_events_req_idx on stk_request_events (request_id, at);

create table if not exists stk_request_signatures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references stk_requests (id) on delete cascade,
  role text not null check (role in ('warehouse', 'employee')),
  signer_user uuid default auth.uid(),
  signer_name text not null check (length(signer_name) between 1 and 160),
  png text not null check (png like 'data:image/png;base64,%' and length(png) <= 400000),
  signed_at timestamptz not null default now(),
  unique (request_id, role)
);

alter table stk_requests enable row level security;
alter table stk_request_lines enable row level security;
alter table stk_request_events enable row level security;
alter table stk_request_signatures enable row level security;

-- Okuma: isteyen personel, depo ya da satın alma yetkilisi. Yazma yalnız RPC ile.
create or replace function stk_req_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from stk_requests r where r.id = p_id and r.company_id = lab_company()
    and (is_self_employee(r.employee_id) or can_module('stock') or can_module('purchases')));
$$;
revoke execute on function stk_req_visible(uuid) from public, anon;
grant execute on function stk_req_visible(uuid) to authenticated;

drop policy if exists stk_requests_read on stk_requests;
create policy stk_requests_read on stk_requests for select to authenticated using (stk_req_visible(id));
drop policy if exists stk_request_lines_read on stk_request_lines;
create policy stk_request_lines_read on stk_request_lines for select to authenticated using (stk_req_visible(request_id));
drop policy if exists stk_request_events_read on stk_request_events;
create policy stk_request_events_read on stk_request_events for select to authenticated using (stk_req_visible(request_id));
drop policy if exists stk_request_signatures_read on stk_request_signatures;
create policy stk_request_signatures_read on stk_request_signatures for select to authenticated using (stk_req_visible(request_id));
grant select on stk_requests, stk_request_lines, stk_request_events, stk_request_signatures to authenticated;

-- Yardımcılar
create or replace function stk_req_emp_name(p_emp uuid) returns text language sql stable security definer set search_path = public as $$
  select first_name || ' ' || last_name from employees where id = p_emp;
$$;
revoke execute on function stk_req_emp_name(uuid) from public, anon, authenticated;

create or replace function stk_req_log(p_id uuid, p_action text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into stk_request_events (request_id, action, note) values (p_id, p_action, nullif(trim(p_note), ''));
  update stk_requests set updated_at = now() where id = p_id;
$$;
revoke execute on function stk_req_log(uuid, text, text) from public, anon, authenticated;

create or replace function stk_req_notify(p_id uuid, p_users uuid[], p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests; v_body text;
begin
  select * into r from stk_requests where id = p_id;
  select string_agg(l.name || ' × ' || trim(to_char(l.qty, 'FM999999990.###')) || ' ' || l.unit, ', ' order by l.sort) into v_body from stk_request_lines l where l.request_id = p_id;
  perform deliver(r.company_id, array(select distinct u from unnest(p_users) u where u is not null), p_title || ' · MT-' || r.year || '-' || lpad(r.no::text, 4, '0'),
    coalesce(stk_req_emp_name(r.employee_id), '') || ': ' || left(coalesce(v_body, ''), 180), '/stok/talepler/' || r.id);
end $$;
revoke execute on function stk_req_notify(uuid, uuid[], text) from public, anon, authenticated;

create or replace function stk_req_notify_employee(p_id uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests; v_user uuid;
begin
  select * into r from stk_requests where id = p_id;
  select user_id into v_user from employees where id = r.employee_id;
  if v_user is not null then
    perform deliver(r.company_id, array[v_user], p_title || ' · MT-' || r.year || '-' || lpad(r.no::text, 4, '0'), p_body, '/benim/malzeme');
  end if;
end $$;
revoke execute on function stk_req_notify_employee(uuid, text, text) from public, anon, authenticated;

-- Personelin seçebileceği stok kartları (personel stok tablolarını okuyamaz)
create or replace function stk_req_catalog()
returns table (id uuid, code text, name text, unit text, category text, available boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.code, i.name, i.unit, c.name, coalesce((select sum(s.qty) from stk_stock s where s.item_id = i.id), 0) > 0
  from stk_items i left join stk_categories c on c.id = i.category_id
  where i.company_id = lab_company() and i.is_active and i.kind in ('material', 'raw', 'consumable', 'goods', 'packaging')
    and exists (select 1 from employees e where e.user_id = auth.uid() and e.company_id = lab_company())
  order by i.name;
$$;
revoke execute on function stk_req_catalog() from public, anon;
grant execute on function stk_req_catalog() to authenticated;

-- İstek oluştur: { reason, needed_by, lines: [{ item_id?, name?, qty, unit?, note? }] }
create or replace function stk_req_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_year int := extract(year from now())::int; l jsonb; v_item stk_items; n int := 0; v_name text;
begin
  select id into v_emp from employees where user_id = auth.uid() and company_id = lab_company() and status = 'active' limit 1;
  if v_emp is null then raise exception 'not_employee'; end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'no_lines'; end if;
  if jsonb_array_length(p -> 'lines') > 30 then raise exception 'too_many_lines'; end if;
  insert into stk_requests (year, no, employee_id, reason, needed_by)
  values (v_year, lab_next_no('mt', v_year), v_emp, nullif(left(trim(p ->> 'reason'), 500), ''), nullif(p ->> 'needed_by', '')::date)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_item := null;
    if nullif(l ->> 'item_id', '') is not null then
      select * into v_item from stk_items where id = (l ->> 'item_id')::uuid and company_id = lab_company() and is_active;
    end if;
    v_name := coalesce(v_item.name, nullif(left(trim(l ->> 'name'), 160), ''));
    if v_name is null then raise exception 'line_name'; end if;
    if coalesce((l ->> 'qty')::numeric, 0) <= 0 then raise exception 'line_qty'; end if;
    insert into stk_request_lines (request_id, sort, item_id, name, unit, qty, note)
    values (v_id, n, v_item.id, v_name, coalesce(v_item.unit, nullif(left(trim(l ->> 'unit'), 20), ''), 'adet'), (l ->> 'qty')::numeric, nullif(left(trim(l ->> 'note'), 300), ''));
    n := n + 1;
  end loop;
  perform stk_req_log(v_id, 'create', p ->> 'reason');
  perform stk_req_notify(v_id, module_recipients('stock', 2), 'Yeni malzeme isteği');
  return v_id;
end $$;
revoke execute on function stk_req_create(jsonb) from public, anon;
grant execute on function stk_req_create(jsonb) to authenticated;

-- İsteyen personel, depo işleme almadan iptal edebilir
create or replace function stk_req_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests;
begin
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not is_self_employee(r.employee_id) then raise exception 'not_allowed'; end if;
  if r.status not in ('pending', 'purchase') then raise exception 'bad_status'; end if;
  update stk_requests set status = 'cancelled' where id = p_id;
  perform stk_req_log(p_id, 'cancel');
  perform stk_req_notify(p_id, module_recipients('stock', 2), 'Malzeme isteği iptal edildi');
end $$;
revoke execute on function stk_req_cancel(uuid) from public, anon;
grant execute on function stk_req_cancel(uuid) to authenticated;

-- Depo kararı: prepare (teslime hazır) / purchase (satın almaya gönder; p_lines = satın alınacak kalem id'leri, boşsa hepsi) / reject
create or replace function stk_req_stock(p_id uuid, p_action text, p_note text default null, p_lines uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if p_action = 'prepare' then
    if r.status not in ('pending', 'approved') then raise exception 'bad_status'; end if;
    update stk_requests set status = 'ready', decision_note = coalesce(nullif(trim(p_note), ''), decision_note) where id = p_id;
    perform stk_req_log(p_id, 'prepare', p_note);
    perform stk_req_notify_employee(p_id, 'Malzemeniz teslime hazır', 'Depodan teslim alabilirsiniz; teslimde imzanız istenecek.');
  elsif p_action = 'purchase' then
    if r.status <> 'pending' then raise exception 'bad_status'; end if;
    update stk_request_lines set to_purchase = (p_lines is null or id = any (p_lines)) where request_id = p_id;
    update stk_requests set status = 'purchase', decision_note = nullif(trim(p_note), '') where id = p_id;
    perform stk_req_log(p_id, 'to_purchase', p_note);
    perform stk_req_notify(p_id, module_recipients('purchases', 2), 'Satın alma onayı bekleyen malzeme isteği');
    perform stk_req_notify_employee(p_id, 'Malzeme isteğiniz satın almaya iletildi', 'Depoda yok; satın alma onayından sonra size bildirilecek.');
  elsif p_action = 'reject' then
    if r.status not in ('pending', 'ready') then raise exception 'bad_status'; end if;
    if nullif(trim(p_note), '') is null then raise exception 'note_required'; end if;
    update stk_requests set status = 'rejected', decision_note = trim(p_note) where id = p_id;
    perform stk_req_log(p_id, 'reject', p_note);
    perform stk_req_notify_employee(p_id, 'Malzeme isteğiniz reddedildi', left(trim(p_note), 200));
  else
    raise exception 'bad_action';
  end if;
end $$;
revoke execute on function stk_req_stock(uuid, text, text, uuid[]) from public, anon;
grant execute on function stk_req_stock(uuid, text, text, uuid[]) to authenticated;

-- Satın alma: approve (purchases ≥ 3) / reject (purchases ≥ 3) / bought (purchases ≥ 2: alındı, depoya geldi → teslime hazır)
create or replace function stk_req_purchase(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests;
begin
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if p_action = 'approve' then
    if not can_module('purchases', 3) then raise exception 'not_allowed'; end if;
    if r.status <> 'purchase' then raise exception 'bad_status'; end if;
    update stk_requests set status = 'approved' where id = p_id;
    perform stk_req_log(p_id, 'purchase_approve', p_note);
    perform stk_req_notify(p_id, array(select distinct unnest(module_recipients('stock', 2) || module_recipients('purchases', 2))), 'Satın alma onaylandı');
    perform stk_req_notify_employee(p_id, 'Malzeme isteğiniz için satın alma onaylandı', 'Malzeme geldiğinde depo size bildirecek.');
  elsif p_action = 'reject' then
    if not can_module('purchases', 3) then raise exception 'not_allowed'; end if;
    if r.status <> 'purchase' then raise exception 'bad_status'; end if;
    if nullif(trim(p_note), '') is null then raise exception 'note_required'; end if;
    update stk_requests set status = 'rejected', decision_note = trim(p_note) where id = p_id;
    perform stk_req_log(p_id, 'purchase_reject', p_note);
    perform stk_req_notify(p_id, module_recipients('stock', 2), 'Satın alma reddetti');
    perform stk_req_notify_employee(p_id, 'Malzeme isteğiniz satın almada reddedildi', left(trim(p_note), 200));
  elsif p_action = 'bought' then
    if not (can_module('purchases', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
    if r.status <> 'approved' then raise exception 'bad_status'; end if;
    update stk_requests set status = 'ready' where id = p_id;
    perform stk_req_log(p_id, 'bought', p_note);
    perform stk_req_notify(p_id, module_recipients('stock', 2), 'Satın alınan malzeme depoya geldi');
    perform stk_req_notify_employee(p_id, 'Malzemeniz teslime hazır', 'Depodan teslim alabilirsiniz; teslimde imzanız istenecek.');
  else
    raise exception 'bad_action';
  end if;
end $$;
revoke execute on function stk_req_purchase(uuid, text, text) from public, anon;
grant execute on function stk_req_purchase(uuid, text, text) to authenticated;

-- Teslim: depo sorumlusu imzalar, stoktan düşer (FIFO). p_lines = [{line_id, qty}], p_employee_png = personel aynı ekranda imzaladıysa
create or replace function stk_req_deliver(p_id uuid, p_lines jsonb, p_warehouse uuid, p_signer text, p_png text, p_employee_png text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests; l jsonb; v_line stk_request_lines; v_qty numeric; v_wh uuid; v_any boolean := false;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('pending', 'ready') then raise exception 'bad_status'; end if;
  if coalesce(p_png, '') not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  v_wh := coalesce(p_warehouse, stk_default_warehouse());
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_line from stk_request_lines where id = (l ->> 'line_id')::uuid and request_id = p_id;
    v_qty := coalesce((l ->> 'qty')::numeric, 0);
    if v_line.id is null or v_qty <= 0 then continue; end if;
    if v_qty > v_line.qty * 2 then raise exception 'qty_too_high'; end if;
    if v_line.item_id is not null then
      perform stk_consume_fifo(v_line.item_id, v_wh, v_qty, 'consume', current_date, 'mat_request', p_id, null,
        left('Malzeme isteği MT-' || r.year || '-' || lpad(r.no::text, 4, '0') || ' · ' || coalesce(stk_req_emp_name(r.employee_id), ''), 300));
    end if;
    update stk_request_lines set issued_qty = issued_qty + v_qty where id = v_line.id;
    v_any := true;
  end loop;
  if not v_any then raise exception 'no_qty'; end if;
  insert into stk_request_signatures (request_id, role, signer_name, png) values (p_id, 'warehouse', left(coalesce(nullif(trim(p_signer), ''), 'Depo'), 160), p_png)
  on conflict (request_id, role) do update set png = excluded.png, signer_name = excluded.signer_name, signer_user = auth.uid(), signed_at = now();
  if coalesce(p_employee_png, '') like 'data:image/png;base64,%' then
    insert into stk_request_signatures (request_id, role, signer_user, signer_name, png)
    values (p_id, 'employee', (select user_id from employees where id = r.employee_id), coalesce(stk_req_emp_name(r.employee_id), 'Personel'), p_employee_png)
    on conflict (request_id, role) do update set png = excluded.png, signed_at = now();
    update stk_requests set status = 'completed', warehouse_id = v_wh, delivered_at = now(), delivered_by = auth.uid(), completed_at = now() where id = p_id;
    perform stk_req_log(p_id, 'deliver_signed', 'Personel teslimde imzaladı');
    perform stk_req_notify_employee(p_id, 'Malzemenizi teslim aldınız', 'Teslim tutanağı her iki imzayla kaydedildi.');
  else
    update stk_requests set status = 'delivered', warehouse_id = v_wh, delivered_at = now(), delivered_by = auth.uid() where id = p_id;
    perform stk_req_log(p_id, 'deliver');
    perform stk_req_notify_employee(p_id, 'Malzemeniz teslim edildi, imzanız bekleniyor', 'Benim sayfam › Malzeme isteklerim bölümünden teslim aldığınızı imzalayın.');
  end if;
end $$;
revoke execute on function stk_req_deliver(uuid, jsonb, uuid, text, text, text) from public, anon;
grant execute on function stk_req_deliver(uuid, jsonb, uuid, text, text, text) to authenticated;

-- Personel teslim aldığını kendi sayfasından imzalar
create or replace function stk_req_sign(p_id uuid, p_png text) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests;
begin
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not is_self_employee(r.employee_id) then raise exception 'not_allowed'; end if;
  if r.status <> 'delivered' then raise exception 'bad_status'; end if;
  if coalesce(p_png, '') not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  insert into stk_request_signatures (request_id, role, signer_name, png) values (p_id, 'employee', coalesce(stk_req_emp_name(r.employee_id), 'Personel'), p_png)
  on conflict (request_id, role) do update set png = excluded.png, signed_at = now(), signer_user = auth.uid();
  update stk_requests set status = 'completed', completed_at = now() where id = p_id;
  perform stk_req_log(p_id, 'employee_sign');
  perform stk_req_notify(p_id, case when r.delivered_by is not null then array[r.delivered_by] else module_recipients('stock', 2) end, 'Personel teslim aldığını imzaladı');
end $$;
revoke execute on function stk_req_sign(uuid, text) from public, anon;
grant execute on function stk_req_sign(uuid, text) to authenticated;

notify pgrst, 'reload schema';
