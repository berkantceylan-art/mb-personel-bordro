-- =====================================================================
-- İSTEK TÜRLERİ + ALIM LİSTESİ (malzeme isteği altyapısı üzerine)
--  stk_requests.kind:
--    material : depodan malzeme (mevcut akış, MT-)
--    asset    : demirbaş isteği (DT-). Teslimde seçilen demirbaş kişinin zimmetine geçer.
--    supply   : dış sipariş — yazıcı kartuşu, temizlik, kırtasiye vb. (SP-). Tüm kullanıcılar ister;
--               depo onaylar → satın alma onaylar → alım listesi → kurye alır → depo teslim eder.
--  Personel kaydı olmayan yöneticiler de demirbaş / dış sipariş isteyebilir (employee_id boş, requested_by dolu).
--  stk_buy_lists : satın almanın çıkardığı alım listesi (tedarikçiye göre gruplu), kuryeye atanır;
--                  kurye kalem kalem "alındı" işaretler, liste bitince istekler "teslime hazır" olur.
-- Tekrar çalıştırılabilir. Önce 20270102000000_material_requests.sql.
-- =====================================================================

alter table stk_requests add column if not exists kind text not null default 'material';
do $$ begin
  alter table stk_requests add constraint stk_requests_kind_check check (kind in ('material', 'asset', 'supply'));
exception when duplicate_object then null; end $$;
alter table stk_requests alter column employee_id drop not null;
-- Numaralar türe göre ayrı (MT / DT / SP)
alter table stk_requests drop constraint if exists stk_requests_company_id_year_no_key;
do $$ begin
  alter table stk_requests add constraint stk_requests_kind_no_key unique (company_id, kind, year, no);
exception when duplicate_object or duplicate_table then null; end $$;
create index if not exists stk_requests_kind_idx on stk_requests (company_id, kind, status, created_at desc);
create index if not exists stk_requests_requester_idx on stk_requests (requested_by, created_at desc);

-- Alım listesi
create table if not exists stk_buy_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  courier_user uuid references auth.users (id) on delete set null,
  planned_on date,
  note text check (note is null or length(note) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (company_id, year, no)
);
create index if not exists stk_buy_lists_status_idx on stk_buy_lists (company_id, status, created_at desc);

alter table stk_request_lines add column if not exists vendor text check (vendor is null or length(vendor) <= 120);
alter table stk_request_lines add column if not exists est_price bigint check (est_price is null or est_price >= 0);   -- kuruş (birim)
alter table stk_request_lines add column if not exists paid_price bigint check (paid_price is null or paid_price >= 0); -- kuruş (toplam, kurye yazar)
alter table stk_request_lines add column if not exists buy_list_id uuid references stk_buy_lists (id) on delete set null;
alter table stk_request_lines add column if not exists picked_at timestamptz;
alter table stk_request_lines add column if not exists asset_id uuid references assets (id) on delete set null;
create index if not exists stk_request_lines_list_idx on stk_request_lines (buy_list_id);

alter table stk_buy_lists enable row level security;
drop policy if exists stk_buy_lists_read on stk_buy_lists;
create policy stk_buy_lists_read on stk_buy_lists for select to authenticated
  using (company_id = lab_company() and (can_module('purchases') or can_module('stock') or courier_user = auth.uid()));
grant select on stk_buy_lists to authenticated;

-- ---------------------------------------------------------------------
-- Yardımcılar (yeniden tanım: istek sahibi personel ya da kullanıcı)
-- ---------------------------------------------------------------------
create or replace function req_user_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(m.display_name, '') from memberships m where m.user_id = p_user and m.company_id = lab_company() limit 1),
    (select e.first_name || ' ' || e.last_name from employees e where e.user_id = p_user and e.company_id = lab_company() limit 1),
    'Kullanıcı');
$$;
revoke execute on function req_user_name(uuid) from public, anon;
grant execute on function req_user_name(uuid) to authenticated;

create or replace function stk_req_no(r stk_requests) returns text language sql immutable as $$
  select case r.kind when 'asset' then 'DT-' when 'supply' then 'SP-' else 'MT-' end || r.year || '-' || lpad(r.no::text, 4, '0');
$$;

create or replace function stk_req_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from stk_requests r where r.id = p_id and r.company_id = lab_company()
    and (r.requested_by = auth.uid() or (r.employee_id is not null and is_self_employee(r.employee_id)) or can_module('stock') or can_module('purchases')
         or exists (select 1 from stk_request_lines l join stk_buy_lists b on b.id = l.buy_list_id where l.request_id = r.id and b.courier_user = auth.uid())));
$$;

create or replace function stk_req_requester(r stk_requests) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(case when r.employee_id is not null then stk_req_emp_name(r.employee_id) end, req_user_name(r.requested_by));
$$;
revoke execute on function stk_req_requester(stk_requests) from public, anon, authenticated;

create or replace function stk_req_notify(p_id uuid, p_users uuid[], p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests; v_body text;
begin
  select * into r from stk_requests where id = p_id;
  select string_agg(l.name || ' × ' || trim(to_char(l.qty, 'FM999999990.###')) || ' ' || l.unit, ', ' order by l.sort) into v_body from stk_request_lines l where l.request_id = p_id;
  perform deliver(r.company_id, array(select distinct u from unnest(p_users) u where u is not null),
    case r.kind when 'asset' then replace(replace(p_title, 'malzeme isteği', 'demirbaş isteği'), 'malzeme', 'demirbaş') when 'supply' then replace(replace(p_title, 'malzeme isteği', 'sipariş isteği'), 'malzeme', 'sipariş') else p_title end || ' · ' || stk_req_no(r),
    coalesce(stk_req_requester(r), '') || ': ' || left(coalesce(v_body, ''), 180), '/stok/talepler/' || r.id);
end $$;
revoke execute on function stk_req_notify(uuid, uuid[], text) from public, anon, authenticated;

create or replace function stk_req_notify_employee(p_id uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests; v_user uuid; v_title text;
begin
  select * into r from stk_requests where id = p_id;
  select user_id into v_user from employees where id = r.employee_id;
  v_user := coalesce(v_user, r.requested_by);
  -- Başlıklardaki "Malzeme" kelimesi türe göre
  v_title := case r.kind when 'asset' then replace(replace(p_title, 'Malzemeniz', 'Demirbaşınız'), 'Malzeme', 'Demirbaş') when 'supply' then replace(replace(p_title, 'Malzemeniz', 'Siparişiniz'), 'Malzeme isteğiniz', 'Siparişiniz') else p_title end;
  if v_user is not null then
    perform deliver(r.company_id, array[v_user], v_title || ' · ' || stk_req_no(r), p_body, case when r.kind = 'material' and r.employee_id is not null then '/benim/malzeme' else '/istekler' end);
  end if;
end $$;
revoke execute on function stk_req_notify_employee(uuid, text, text) from public, anon, authenticated;

-- Demirbaş / dış sipariş isteği: { kind, reason, needed_by, lines: [{ item_id?, name, qty, unit?, note? }] }
create or replace function stk_req_create2(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_year int := extract(year from now())::int; l jsonb; v_item stk_items; n int := 0; v_name text; v_kind text := coalesce(p ->> 'kind', 'material');
begin
  if v_kind not in ('material', 'asset', 'supply') then raise exception 'bad_kind'; end if;
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = lab_company()) then raise exception 'not_allowed'; end if;
  select id into v_emp from employees where user_id = auth.uid() and company_id = lab_company() and status = 'active' limit 1;
  if v_kind = 'material' and v_emp is null then raise exception 'not_employee'; end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'no_lines'; end if;
  if jsonb_array_length(p -> 'lines') > 30 then raise exception 'too_many_lines'; end if;
  insert into stk_requests (kind, year, no, employee_id, reason, needed_by)
  values (v_kind, v_year, lab_next_no(case v_kind when 'asset' then 'dt' when 'supply' then 'sp' else 'mt' end, v_year), v_emp,
          nullif(left(trim(p ->> 'reason'), 500), ''), nullif(p ->> 'needed_by', '')::date)
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
  perform stk_req_notify(v_id, module_recipients('stock', 2), case v_kind when 'asset' then 'Yeni demirbaş isteği' when 'supply' then 'Yeni sipariş isteği' else 'Yeni malzeme isteği' end);
  return v_id;
end $$;
revoke execute on function stk_req_create2(jsonb) from public, anon;
grant execute on function stk_req_create2(jsonb) to authenticated;

-- İptal: isteyen kişi (personel ya da kullanıcı)
create or replace function stk_req_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests;
begin
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not (r.requested_by = auth.uid() or (r.employee_id is not null and is_self_employee(r.employee_id))) then raise exception 'not_allowed'; end if;
  if r.status not in ('pending', 'purchase') then raise exception 'bad_status'; end if;
  update stk_requests set status = 'cancelled' where id = p_id;
  perform stk_req_log(p_id, 'cancel');
  perform stk_req_notify(p_id, module_recipients('stock', 2), 'İstek iptal edildi');
end $$;

-- Teslim (yeniden tanım): demirbaş isteğinde kalem başına asset_id → zimmet; personel imzası isteyen kişiden
create or replace function stk_req_deliver(p_id uuid, p_lines jsonb, p_warehouse uuid, p_signer text, p_png text, p_employee_png text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests; l jsonb; v_line stk_request_lines; v_qty numeric; v_wh uuid; v_any boolean := false; v_asset assets; v_ack boolean;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('pending', 'ready') then raise exception 'bad_status'; end if;
  if coalesce(p_png, '') not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  v_ack := coalesce(p_employee_png, '') like 'data:image/png;base64,%';
  v_wh := coalesce(p_warehouse, stk_default_warehouse());
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_line from stk_request_lines where id = (l ->> 'line_id')::uuid and request_id = p_id;
    v_qty := coalesce((l ->> 'qty')::numeric, 0);
    if v_line.id is null or v_qty <= 0 then continue; end if;
    if v_qty > v_line.qty * 2 then raise exception 'qty_too_high'; end if;
    if r.kind = 'asset' and nullif(l ->> 'asset_id', '') is not null then
      select * into v_asset from assets where id = (l ->> 'asset_id')::uuid and company_id = r.company_id for update;
      if v_asset.id is null then raise exception 'asset_not_found'; end if;
      if v_asset.status <> 'AVAILABLE' then raise exception 'asset_not_available'; end if;
      if r.employee_id is not null then
        insert into asset_assignments (company_id, asset_id, employee_id, condition_out, note, acknowledged_at)
        values (r.company_id, v_asset.id, r.employee_id, 'Demirbaş isteğiyle teslim', stk_req_no(r), case when v_ack then now() end);
      else
        update assets set status = 'ASSIGNED', note = left(coalesce(note || ' · ', '') || 'Teslim: ' || req_user_name(r.requested_by) || ' (' || stk_req_no(r) || ')', 1000), updated_at = now() where id = v_asset.id;
      end if;
      update stk_request_lines set asset_id = v_asset.id where id = v_line.id;
    elsif v_line.item_id is not null then
      perform stk_consume_fifo(v_line.item_id, v_wh, v_qty, 'consume', current_date, 'mat_request', p_id, null,
        left('İstek ' || stk_req_no(r) || ' · ' || coalesce(stk_req_requester(r), ''), 300));
    end if;
    update stk_request_lines set issued_qty = issued_qty + v_qty where id = v_line.id;
    v_any := true;
  end loop;
  if not v_any then raise exception 'no_qty'; end if;
  insert into stk_request_signatures (request_id, role, signer_name, png) values (p_id, 'warehouse', left(coalesce(nullif(trim(p_signer), ''), 'Depo'), 160), p_png)
  on conflict (request_id, role) do update set png = excluded.png, signer_name = excluded.signer_name, signer_user = auth.uid(), signed_at = now();
  if v_ack then
    insert into stk_request_signatures (request_id, role, signer_user, signer_name, png)
    values (p_id, 'employee', coalesce((select user_id from employees where id = r.employee_id), r.requested_by), coalesce(stk_req_requester(r), 'Personel'), p_employee_png)
    on conflict (request_id, role) do update set png = excluded.png, signed_at = now();
    update stk_requests set status = 'completed', warehouse_id = v_wh, delivered_at = now(), delivered_by = auth.uid(), completed_at = now() where id = p_id;
    perform stk_req_log(p_id, 'deliver_signed', 'Teslim alan teslimde imzaladı');
    perform stk_req_notify_employee(p_id, 'Malzemenizi teslim aldınız', 'Teslim tutanağı her iki imzayla kaydedildi.');
  else
    update stk_requests set status = 'delivered', warehouse_id = v_wh, delivered_at = now(), delivered_by = auth.uid() where id = p_id;
    perform stk_req_log(p_id, 'deliver');
    perform stk_req_notify_employee(p_id, 'Malzemeniz teslim edildi, imzanız bekleniyor', 'İsteklerim sayfasından teslim aldığınızı imzalayın.');
  end if;
end $$;

-- İmza (yeniden tanım): isteyen kişi imzalar; demirbaşsa zimmet teslim onayı da işlenir
create or replace function stk_req_sign(p_id uuid, p_png text) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_requests;
begin
  select * into r from stk_requests where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not (r.requested_by = auth.uid() or (r.employee_id is not null and is_self_employee(r.employee_id))) then raise exception 'not_allowed'; end if;
  if r.status <> 'delivered' then raise exception 'bad_status'; end if;
  if coalesce(p_png, '') not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  insert into stk_request_signatures (request_id, role, signer_name, png) values (p_id, 'employee', coalesce(stk_req_requester(r), 'Personel'), p_png)
  on conflict (request_id, role) do update set png = excluded.png, signed_at = now(), signer_user = auth.uid();
  update stk_requests set status = 'completed', completed_at = now() where id = p_id;
  if r.kind = 'asset' and r.employee_id is not null then
    update asset_assignments a set acknowledged_at = now()
    where a.employee_id = r.employee_id and a.returned_on is null and a.acknowledged_at is null
      and a.asset_id in (select l.asset_id from stk_request_lines l where l.request_id = p_id and l.asset_id is not null);
  end if;
  perform stk_req_log(p_id, 'employee_sign');
  perform stk_req_notify(p_id, case when r.delivered_by is not null then array[r.delivered_by] else module_recipients('stock', 2) end, 'Teslim alan imzaladı');
end $$;

-- ---------------------------------------------------------------------
-- Alım listesi
-- ---------------------------------------------------------------------
-- Satın alma: onaylı isteklerin satın alınacak kalemlerinden liste çıkar ve kuryeye ata
--  p: { request_ids: [..], courier_user, planned_on, note, vendors: { line_id: "tedarikçi" }, prices: { line_id: kuruş } }
create or replace function stk_buy_list_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_year int := extract(year from now())::int; v_courier uuid := nullif(p ->> 'courier_user', '')::uuid; n int; v_reqs uuid[];
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select array_agg(x::uuid) into v_reqs from jsonb_array_elements_text(coalesce(p -> 'request_ids', '[]'::jsonb)) x;
  if v_reqs is null then raise exception 'no_lines'; end if;
  if v_courier is not null and not exists (select 1 from memberships where user_id = v_courier and company_id = lab_company()) then raise exception 'bad_courier'; end if;
  insert into stk_buy_lists (year, no, courier_user, planned_on, note)
  values (v_year, lab_next_no('al', v_year), v_courier, nullif(p ->> 'planned_on', '')::date, nullif(left(trim(p ->> 'note'), 500), ''))
  returning id into v_id;
  update stk_request_lines l set buy_list_id = v_id, picked_at = null,
         vendor = coalesce(nullif(left(trim(p -> 'vendors' ->> l.id::text), 120), ''), l.vendor),
         est_price = coalesce(nullif(p -> 'prices' ->> l.id::text, '')::bigint, l.est_price)
  from stk_requests r
  where r.id = l.request_id and r.company_id = lab_company() and r.id = any (v_reqs) and r.status = 'approved' and l.to_purchase and l.buy_list_id is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no_lines'; end if;
  insert into stk_request_events (request_id, action, note)
  select distinct l.request_id, 'listed', 'AL-' || v_year || '-' || lpad((select no from stk_buy_lists where id = v_id)::text, 4, '0') from stk_request_lines l where l.buy_list_id = v_id;
  if v_courier is not null then
    perform deliver(lab_company(), array[v_courier], 'Size alım listesi atandı', n || ' kalem alınacak', '/alim/' || v_id);
  end if;
  return v_id;
end $$;
revoke execute on function stk_buy_list_create(jsonb) from public, anon;
grant execute on function stk_buy_list_create(jsonb) to authenticated;

create or replace function stk_buy_can(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from stk_buy_lists b where b.id = p_list and b.company_id = lab_company() and (b.courier_user = auth.uid() or can_module('purchases', 2) or can_module('stock', 2)));
$$;
revoke execute on function stk_buy_can(uuid) from public, anon, authenticated;

-- Liste ayrıntısı (kurye satın alma tablolarını okuyamadığı için)
create or replace function stk_buy_list_get(p_list uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b stk_buy_lists;
begin
  select * into b from stk_buy_lists where id = p_list and company_id = lab_company();
  if b.id is null or not (b.courier_user = auth.uid() or can_module('purchases') or can_module('stock')) then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'id', b.id, 'no', 'AL-' || b.year || '-' || lpad(b.no::text, 4, '0'), 'status', b.status, 'planned_on', b.planned_on, 'note', b.note, 'created_at', b.created_at, 'done_at', b.done_at,
    'courier', case when b.courier_user is not null then req_user_name(b.courier_user) end, 'courier_user', b.courier_user, 'created_by', req_user_name(b.created_by),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'qty', l.qty, 'unit', l.unit, 'note', l.note, 'vendor', l.vendor, 'est_price', l.est_price,
                                                   'paid_price', l.paid_price, 'picked_at', l.picked_at, 'request_no', stk_req_no(r), 'request_id', r.id, 'requester', stk_req_requester(r))
                                order by coalesce(l.vendor, 'zzz'), l.name)
                       from stk_request_lines l join stk_requests r on r.id = l.request_id where l.buy_list_id = b.id), '[]'::jsonb));
end $$;
revoke execute on function stk_buy_list_get(uuid) from public, anon;
grant execute on function stk_buy_list_get(uuid) to authenticated;

-- Kuryenin açık listeleri
create or replace function stk_buy_lists_mine() returns table (id uuid, no text, planned_on date, note text, total int, picked int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, 'AL-' || b.year || '-' || lpad(b.no::text, 4, '0'), b.planned_on, b.note,
         (select count(*)::int from stk_request_lines l where l.buy_list_id = b.id), (select count(*)::int from stk_request_lines l where l.buy_list_id = b.id and l.picked_at is not null), b.created_at
  from stk_buy_lists b where b.company_id = lab_company() and b.courier_user = auth.uid() and b.status = 'open' order by b.created_at;
$$;
revoke execute on function stk_buy_lists_mine() from public, anon;
grant execute on function stk_buy_lists_mine() to authenticated;

-- Kurye: kalemi aldı / almadı (ödenen tutar isteğe bağlı, kuruş)
create or replace function stk_buy_pick(p_line uuid, p_picked boolean, p_paid bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_list uuid;
begin
  select buy_list_id into v_list from stk_request_lines where id = p_line;
  if v_list is null or not stk_buy_can(v_list) then raise exception 'not_allowed'; end if;
  if (select status from stk_buy_lists where id = v_list) <> 'open' then raise exception 'bad_status'; end if;
  update stk_request_lines set picked_at = case when p_picked then coalesce(picked_at, now()) end,
         paid_price = case when p_picked then coalesce(p_paid, paid_price) else null end
  where id = p_line;
end $$;
revoke execute on function stk_buy_pick(uuid, boolean, bigint) from public, anon;
grant execute on function stk_buy_pick(uuid, boolean, bigint) to authenticated;

-- Liste bitti: tüm satın alınacak kalemleri alınan istekler "teslime hazır"; alınamayanlar listeden çıkar (yeniden listelenebilir)
create or replace function stk_buy_list_done(p_list uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare b stk_buy_lists; r record; n int := 0;
begin
  select * into b from stk_buy_lists where id = p_list and company_id = lab_company() for update;
  if b.id is null or not stk_buy_can(p_list) then raise exception 'not_allowed'; end if;
  if b.status <> 'open' then raise exception 'bad_status'; end if;
  update stk_buy_lists set status = 'done', done_at = now(), note = coalesce(nullif(trim(p_note), ''), note) where id = p_list;
  for r in select distinct l.request_id from stk_request_lines l where l.buy_list_id = p_list loop
    if not exists (select 1 from stk_request_lines l where l.request_id = r.request_id and l.to_purchase and l.picked_at is null) then
      update stk_requests set status = 'ready' where id = r.request_id and status = 'approved';
      if found then
        perform stk_req_log(r.request_id, 'bought', 'Kurye aldı · AL-' || b.year || '-' || lpad(b.no::text, 4, '0'));
        perform stk_req_notify_employee(r.request_id, 'Malzemeniz teslime hazır', 'Depodan teslim alabilirsiniz; teslimde imzanız istenecek.');
        n := n + 1;
      end if;
    end if;
  end loop;
  update stk_request_lines set buy_list_id = null where buy_list_id = p_list and picked_at is null;
  perform deliver(lab_company(), array(select distinct unnest(module_recipients('stock', 2) || module_recipients('purchases', 2) || array[b.created_by])),
    'Alım listesi tamamlandı · AL-' || b.year || '-' || lpad(b.no::text, 4, '0'), n || ' istek depoya geldi, teslime hazır', '/stok/talepler/alim/' || p_list);
  return n;
end $$;
revoke execute on function stk_buy_list_done(uuid, text) from public, anon;
grant execute on function stk_buy_list_done(uuid, text) to authenticated;

create or replace function stk_buy_list_cancel(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  update stk_buy_lists set status = 'cancelled' where id = p_list and company_id = lab_company() and status = 'open';
  if not found then raise exception 'bad_status'; end if;
  update stk_request_lines set buy_list_id = null, picked_at = null where buy_list_id = p_list;
end $$;
revoke execute on function stk_buy_list_cancel(uuid) from public, anon;
grant execute on function stk_buy_list_cancel(uuid) to authenticated;

-- Kurye adayları: şirket kullanıcıları (lojistik yetkisi olanlar önde)
create or replace function stk_couriers() returns table (user_id uuid, name text, logistics boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, req_user_name(m.user_id), coalesce(m.logistics_access, false)
  from memberships m where m.company_id = lab_company() and can_module('purchases', 2)
  order by coalesce(m.logistics_access, false) desc, 2;
$$;
revoke execute on function stk_couriers() from public, anon;
grant execute on function stk_couriers() to authenticated;

notify pgrst, 'reload schema';
