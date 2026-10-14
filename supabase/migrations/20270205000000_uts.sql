-- =====================================================================
-- ÜTS (Ürün Takip Sistemi) entegrasyonu
--  stk_items.uts_*           : ÜTS takibindeki ürün, ürün numarası (UNO = GTIN / UDI-DI), lot ya da seri takibi,
--                              akış: 'use' (işte kullanılır → kullanım bildirimi) / 'transfer' (işle hekime gider → verme bildirimi)
--  fin_parties / lab_customers .uts_kurum_no : karşı kurumun ÜTS kurum numarası
--  uts_settings              : açık / kapalı, hangi bildirim otomatik, test / canlı ortam, başlangıç tarihi
--  uts_notifications         : bildirim kuyruğu (alma, kullanım, verme, ısmarlama); ERP zamanlanmış görevi gönderir
--     mal kabul onayı              → alma
--     iş malzemesi (kullanım akışı) → kullanım
--     iş teslim (delivered)         → verme (transfer akışlı malzemeler) + ısmarlama ürün bildirimi
--     malzeme işten silinirse       → bekleyen bildirim iptal; gönderilmişse "ÜTS'de iptal gerekli"
--  stk_rcv_scan_udi()        : GS1 karekod (GTIN + lot + SKT + seri) ile mal kabul; farklı lot / seri ayrı satır
--  Kontrol Merkezi           : adm_extra_rules() kancası (ÜTS hataları, bekleyenler, eksik ürün numarası)
-- Tekrar çalıştırılabilir. Önce 20270204000000_site_pages_plus.sql.
-- =====================================================================

alter table stk_items add column if not exists uts_tracked boolean not null default false;
alter table stk_items add column if not exists uts_product_no text check (uts_product_no is null or uts_product_no ~ '^[0-9A-Za-z]{1,25}$');
alter table stk_items add column if not exists uts_kind text not null default 'lot' check (uts_kind in ('lot', 'serial'));
alter table stk_items add column if not exists uts_flow text not null default 'use' check (uts_flow in ('use', 'transfer'));
create index if not exists stk_items_uts_no_idx on stk_items (company_id, uts_product_no) where uts_product_no is not null;

alter table fin_parties add column if not exists uts_kurum_no text check (uts_kurum_no is null or uts_kurum_no ~ '^[0-9]{1,20}$');
alter table lab_customers add column if not exists uts_kurum_no text check (uts_kurum_no is null or uts_kurum_no ~ '^[0-9]{1,20}$');
alter table stk_receipt_lines add column if not exists serial_no text check (serial_no is null or length(serial_no) <= 60);
alter table stk_receipt_lines add column if not exists gtin text check (gtin is null or gtin ~ '^[0-9]{8,14}$');

create table if not exists uts_settings (
  company_id uuid primary key references companies (id) on delete cascade,
  enabled boolean not null default false,
  auto_alma boolean not null default true,
  auto_kullanim boolean not null default true,
  auto_verme boolean not null default true,
  auto_ismarlama boolean not null default true,
  env text not null default 'test' check (env in ('test', 'live')),
  start_date date not null default current_date,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table uts_settings enable row level security;
drop policy if exists uts_settings_read on uts_settings;
create policy uts_settings_read on uts_settings for select to authenticated using (company_id = lab_company() and (can_module('stock') or can_module('production')));
grant select on uts_settings to authenticated;

create or replace function uts_on(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled and case p_kind when 'alma' then s.auto_alma when 'kullanim' then s.auto_kullanim when 'verme' then s.auto_verme when 'ismarlama' then s.auto_ismarlama else false end
                   and current_date >= s.start_date from uts_settings s where s.company_id = lab_company()), false);
$$;
revoke execute on function uts_on(text) from public, anon;

create table if not exists uts_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  kind text not null check (kind in ('alma', 'kullanim', 'verme', 'ismarlama')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'error', 'manual', 'cancelled', 'cancel_needed')),
  source_key text not null,
  item_id uuid references stk_items (id) on delete set null,
  item_name text,
  product_no text,
  lot_no text,
  serial_no text,
  qty numeric(14, 3),
  expiry_date date,
  counterparty_no text,
  counterparty_name text,
  job_id uuid references jobs (id) on delete set null,
  receipt_id uuid references stk_receipts (id) on delete set null,
  payload jsonb not null default '{}',
  env text,
  uts_ref text check (uts_ref is null or length(uts_ref) <= 120),
  response jsonb,
  error text check (error is null or length(error) <= 2000),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  event_date date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  done_by uuid,
  unique (company_id, source_key)
);
create index if not exists uts_notifications_status_idx on uts_notifications (company_id, status, next_try_at);
create index if not exists uts_notifications_job_idx on uts_notifications (job_id);
alter table uts_notifications enable row level security;
drop policy if exists uts_notifications_read on uts_notifications;
create policy uts_notifications_read on uts_notifications for select to authenticated using (company_id = lab_company() and (can_module('stock') or can_module('production')));
grant select on uts_notifications to authenticated;
drop trigger if exists audit_uts_notifications on uts_notifications;
create trigger audit_uts_notifications after update or delete on uts_notifications for each row execute function audit_trigger();

-- Ortak: kuyruğa ekle (aynı kaynak ikinci kez eklenmez)
create or replace function uts_enqueue(p_kind text, p_key text, p_item uuid, p_lot text, p_qty numeric, p_expiry date, p_cp_no text, p_cp_name text, p_job uuid, p_receipt uuid, p_payload jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare it stk_items; v_serial boolean;
begin
  if p_item is not null then select * into it from stk_items where id = p_item; end if;
  v_serial := coalesce(it.uts_kind = 'serial', false);
  insert into uts_notifications (kind, source_key, item_id, item_name, product_no, lot_no, serial_no, qty, expiry_date, counterparty_no, counterparty_name, job_id, receipt_id, payload)
  values (p_kind, p_key, p_item, it.name, it.uts_product_no, case when v_serial then null else p_lot end, case when v_serial then p_lot end,
          case when v_serial then 1 else p_qty end, p_expiry, p_cp_no, p_cp_name, p_job, p_receipt, coalesce(p_payload, '{}'))
  on conflict (company_id, source_key) do nothing;
end $$;
revoke execute on function uts_enqueue(text, text, uuid, text, numeric, date, text, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- 1) Mal kabul onayı → alma bildirimi
create or replace function uts_on_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record; p fin_parties; n int;
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' or not uts_on('alma') then return new; end if;
  select * into p from fin_parties where id = new.party_id;
  for l in select rl.*, i.uts_kind from stk_receipt_lines rl join stk_items i on i.id = rl.item_id
           where rl.receipt_id = new.id and i.uts_tracked and rl.qty - rl.damaged > 0 loop
    if l.uts_kind = 'serial' then
      perform uts_enqueue('alma', 'rcv:' || l.id, l.item_id, coalesce(l.serial_no, l.lot_no), 1, l.expiry_date, p.uts_kurum_no, p.name, null, new.id,
                          jsonb_build_object('doc', stk_rcv_no(new), 'supplier_doc', new.supplier_doc));
    else
      perform uts_enqueue('alma', 'rcv:' || l.id, l.item_id, l.lot_no, l.qty - l.damaged, l.expiry_date, p.uts_kurum_no, p.name, null, new.id,
                          jsonb_build_object('doc', stk_rcv_no(new), 'supplier_doc', new.supplier_doc));
    end if;
  end loop;
  return new;
exception when others then return new;
end $$;
drop trigger if exists uts_on_receipt on stk_receipts;
create trigger uts_on_receipt after update of status on stk_receipts for each row execute function uts_on_receipt();

-- 2) İş malzemesi → kullanım (kullanım akışı); silinirse iptal
create or replace function uts_on_job_material() returns trigger
language plpgsql security definer set search_path = public as $$
declare it stk_items; j jobs;
begin
  if tg_op = 'DELETE' then
    update uts_notifications set status = case when status in ('sent', 'manual') then 'cancel_needed' else 'cancelled' end,
           error = case when status in ('sent', 'manual') then 'Malzeme işten kaldırıldı: ÜTS''de bu bildirimi iptal edin.' else error end
    where company_id = lab_company() and source_key = 'mat:' || old.id and status not in ('cancelled', 'cancel_needed');
    return old;
  end if;
  if new.qty <= 0 or not uts_on('kullanim') then return new; end if;
  select * into it from stk_items where id = new.item_id;
  if not coalesce(it.uts_tracked, false) or it.uts_flow <> 'use' then return new; end if;
  select * into j from jobs where id = new.job_id;
  perform uts_enqueue('kullanim', 'mat:' || new.id, new.item_id, new.lot_no, new.qty, new.expiry_date, null, null, new.job_id, null,
                      jsonb_build_object('job_no', j.no, 'patient', j.patient, 'doctor', j.doctor_name));
  return new;
exception when others then return coalesce(new, old);
end $$;
drop trigger if exists uts_on_job_material on prd_job_materials;
create trigger uts_on_job_material after insert or delete on prd_job_materials for each row execute function uts_on_job_material();

-- 3) İş teslim edildi → verme (transfer akışlı malzemeler) + ısmarlama ürün bildirimi
create or replace function uts_on_job_delivered() returns trigger
language plpgsql security definer set search_path = public as $$
declare c lab_customers; m record; v_items text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into c from lab_customers where id = new.customer_id;
  if uts_on('verme') then
    for m in select pm.* from prd_job_materials pm join stk_items i on i.id = pm.item_id where pm.job_id = new.id and pm.qty > 0 and i.uts_tracked and i.uts_flow = 'transfer' loop
      perform uts_enqueue('verme', 'ver:' || m.id, m.item_id, m.lot_no, m.qty, m.expiry_date, c.uts_kurum_no, c.name, new.id, null,
                          jsonb_build_object('job_no', new.no, 'patient', new.patient, 'doctor', new.doctor_name));
    end loop;
  end if;
  if uts_on('ismarlama') then
    select string_agg(ji.name || case when ji.qty > 1 then ' ×' || ji.qty else '' end, ', ' order by ji.name) into v_items from job_items ji where ji.job_id = new.id;
    perform uts_enqueue('ismarlama', 'job:' || new.id, null, null, 1, null, c.uts_kurum_no, c.name, new.id, null,
      jsonb_build_object('job_no', new.no, 'patient', new.patient, 'doctor', new.doctor_name, 'device', coalesce(v_items, 'Ismarlama diş protezi'),
                         'teeth', (select string_agg(k, ' ' order by k) from jsonb_object_keys(coalesce(new.teeth, '{}')) k), 'shade', new.shade,
                         'in_date', new.in_date, 'delivered_at', coalesce(new.delivered_at, now())::date,
                         'materials', (select coalesce(jsonb_agg(jsonb_build_object('item', i.name, 'uts_no', i.uts_product_no, 'lot', pm.lot_no) order by i.name), '[]')
                                       from prd_job_materials pm join stk_items i on i.id = pm.item_id where pm.job_id = new.id and pm.qty > 0)));
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists uts_on_job_delivered on jobs;
create trigger uts_on_job_delivered after update of status on jobs for each row execute function uts_on_job_delivered();

-- ---------------------------------------------------------------------
-- Ekran işlemleri (depo düzey 2; ayarlar düzey 3)
-- ---------------------------------------------------------------------
create or replace function uts_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('stock', 3) or adm_allowed()) then raise exception 'not_allowed'; end if;
  insert into uts_settings (company_id, enabled, auto_alma, auto_kullanim, auto_verme, auto_ismarlama, env, start_date, updated_by, updated_at)
  values (lab_company(), coalesce((p->>'enabled')::boolean, false), coalesce((p->>'auto_alma')::boolean, true), coalesce((p->>'auto_kullanim')::boolean, true),
          coalesce((p->>'auto_verme')::boolean, true), coalesce((p->>'auto_ismarlama')::boolean, true),
          case when p->>'env' = 'live' then 'live' else 'test' end, coalesce(nullif(p->>'start_date', '')::date, current_date), auth.uid(), now())
  on conflict (company_id) do update set enabled = excluded.enabled, auto_alma = excluded.auto_alma, auto_kullanim = excluded.auto_kullanim, auto_verme = excluded.auto_verme,
    auto_ismarlama = excluded.auto_ismarlama, env = excluded.env, start_date = excluded.start_date, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function uts_settings_save(jsonb) from public, anon;
grant execute on function uts_settings_save(jsonb) to authenticated;

-- İşlem: retry (tekrar dene) · manual (ÜTS ekranından elle yapıldı, p_ref = ÜTS bildirim no) · cancel (gönderme) · cancelled_in_uts (ÜTS'de iptal edildi)
create or replace function uts_action(p_id uuid, p_action text, p_ref text default null, p_patch jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare n uts_notifications;
begin
  if not (can_module('stock', 2) or can_module('production', 2)) then raise exception 'not_allowed'; end if;
  select * into n from uts_notifications where id = p_id and company_id = lab_company() for update;
  if n.id is null then raise exception 'not_found'; end if;
  if p_action = 'retry' then
    if n.status not in ('error', 'pending') then raise exception 'bad_status'; end if;
    update uts_notifications set status = 'pending', next_try_at = now(), error = null,
      lot_no = case when p_patch ? 'lot_no' then nullif(left(trim(p_patch->>'lot_no'), 60), '') else lot_no end,
      serial_no = case when p_patch ? 'serial_no' then nullif(left(trim(p_patch->>'serial_no'), 60), '') else serial_no end,
      product_no = case when p_patch ? 'product_no' then nullif(left(trim(p_patch->>'product_no'), 25), '') else product_no end,
      counterparty_no = case when p_patch ? 'counterparty_no' then nullif(regexp_replace(p_patch->>'counterparty_no', '\D', '', 'g'), '') else counterparty_no end,
      qty = coalesce(nullif(p_patch->>'qty', '')::numeric, qty)
    where id = p_id;
  elsif p_action = 'manual' then
    if n.status in ('sent', 'cancelled') then raise exception 'bad_status'; end if;
    update uts_notifications set status = 'manual', uts_ref = nullif(left(trim(coalesce(p_ref, '')), 120), ''), sent_at = now(), done_by = auth.uid(), error = null where id = p_id;
  elsif p_action = 'cancel' then
    if n.status not in ('pending', 'error') then raise exception 'bad_status'; end if;
    update uts_notifications set status = 'cancelled', done_by = auth.uid() where id = p_id;
  elsif p_action = 'cancelled_in_uts' then
    if n.status <> 'cancel_needed' then raise exception 'bad_status'; end if;
    update uts_notifications set status = 'cancelled', done_by = auth.uid(), error = null where id = p_id;
  else raise exception 'bad_action'; end if;
end $$;
revoke execute on function uts_action(uuid, text, text, jsonb) from public, anon;
grant execute on function uts_action(uuid, text, text, jsonb) to authenticated;

-- Elle bildirim ekle (geçmiş kayıtlar ya da otomatik akış dışı işlemler)
create or replace function uts_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; it stk_items; v_kind text := p->>'kind';
begin
  if not (can_module('stock', 2) or can_module('production', 2)) then raise exception 'not_allowed'; end if;
  if v_kind not in ('alma', 'kullanim', 'verme', 'ismarlama') then raise exception 'bad_kind'; end if;
  if nullif(p->>'item_id', '') is not null then select * into it from stk_items where id = (p->>'item_id')::uuid and company_id = lab_company(); end if;
  insert into uts_notifications (kind, source_key, item_id, item_name, product_no, lot_no, serial_no, qty, expiry_date, counterparty_no, counterparty_name, job_id, payload)
  values (v_kind, 'man:' || gen_random_uuid(), it.id, coalesce(it.name, nullif(left(trim(p->>'item_name'), 200), '')),
          coalesce(nullif(trim(p->>'product_no'), ''), it.uts_product_no), nullif(left(trim(p->>'lot_no'), 60), ''), nullif(left(trim(p->>'serial_no'), 60), ''),
          coalesce(nullif(p->>'qty', '')::numeric, 1), nullif(p->>'expiry_date', '')::date, nullif(regexp_replace(coalesce(p->>'counterparty_no', ''), '\D', '', 'g'), ''),
          nullif(left(trim(p->>'counterparty_name'), 200), ''), nullif(p->>'job_id', '')::uuid, jsonb_build_object('note', nullif(left(trim(p->>'note'), 300), '')))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function uts_add(jsonb) from public, anon;
grant execute on function uts_add(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Gönderim (ERP zamanlanmış görevi, sunucu anahtarıyla)
-- ---------------------------------------------------------------------
create or replace function uts_due(p_limit int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select n.id from uts_notifications n join uts_settings s on s.company_id = n.company_id
    where s.enabled and n.status = 'pending' and n.next_try_at <= now() and n.kind <> 'ismarlama'
    order by n.created_at limit p_limit for update of n skip locked)
  update uts_notifications n set status = 'sending', attempts = attempts + 1 from picked where n.id = picked.id;
  select coalesce(jsonb_agg(to_jsonb(n) || jsonb_build_object('own_no', c.uts_firm_no, 'env_setting', s.env) order by n.created_at), '[]') into v
  from uts_notifications n join companies c on c.id = n.company_id join uts_settings s on s.company_id = n.company_id where n.status = 'sending';
  return v;
end $$;
revoke execute on function uts_due(int) from public, anon, authenticated;

create or replace function uts_result(p_id uuid, p_ok boolean, p_ref text, p_response jsonb, p_error text, p_env text) returns void
language plpgsql security definer set search_path = public as $$
declare n uts_notifications;
begin
  update uts_notifications set
    status = case when p_ok then 'sent' else 'error' end,
    uts_ref = case when p_ok then nullif(left(p_ref, 120), '') else uts_ref end,
    response = p_response, env = p_env, error = case when p_ok then null else left(p_error, 2000) end,
    sent_at = case when p_ok then now() else sent_at end,
    next_try_at = now() + interval '1 hour'
  where id = p_id and status = 'sending' returning * into n;
  if n.id is not null and not p_ok and n.attempts = 1 then
    begin
      perform deliver(n.company_id, module_recipients('stock', 2), '⚠ ÜTS bildirimi alınmadı · ' || n.kind,
        coalesce(n.item_name, '') || coalesce(' · lot ' || n.lot_no, '') || coalesce(' · seri ' || n.serial_no, '') || ' · ' || left(coalesce(p_error, ''), 300), '/stok/uts?durum=error');
    exception when others then null; end;
  end if;
end $$;
revoke execute on function uts_result(uuid, boolean, text, jsonb, text, text) from public, anon, authenticated;

-- Takılı kalan "gönderiliyor" kayıtlarını geri al (görev yarıda kesildiyse)
create or replace function uts_unstick() returns int language sql security definer set search_path = public as $$
  with u as (update uts_notifications set status = 'pending' where status = 'sending' and next_try_at < now() - interval '15 minutes' returning 1) select count(*)::int from u;
$$;
revoke execute on function uts_unstick() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function uts_due(int) to service_role;
    grant execute on function uts_result(uuid, boolean, text, jsonb, text, text) to service_role;
    grant execute on function uts_unstick() to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- GS1 / UDI karekodla mal kabul
-- ---------------------------------------------------------------------
create or replace function stk_find_by_gtin(p_gtin text) returns stk_items
language sql stable security definer set search_path = public as $$
  select i.* from stk_items i
  where i.company_id = lab_company() and p_gtin ~ '^[0-9]{8,14}$'
    and (i.uts_product_no = p_gtin or i.barcode = p_gtin
         or (i.uts_product_no ~ '^[0-9]+$' and ltrim(i.uts_product_no, '0') = ltrim(p_gtin, '0'))
         or (i.barcode ~ '^[0-9]+$' and ltrim(i.barcode, '0') = ltrim(p_gtin, '0')))
  order by (i.uts_product_no = p_gtin) desc nulls last, (i.barcode = p_gtin) desc nulls last, i.is_active desc limit 1;
$$;
revoke execute on function stk_find_by_gtin(text) from public, anon, authenticated;

create or replace function stk_rcv_scan_udi(p_id uuid, p_gtin text, p_lot text, p_expiry date, p_serial text, p_qty numeric default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r stk_receipts; it stk_items; v_line stk_receipt_lines; base stk_receipt_lines; v_sort int; v_key text; v_serial boolean; v_qty numeric;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into r from stk_receipts where id = p_id and company_id = lab_company() for update;
  if r.id is null or r.status <> 'open' then raise exception 'bad_status'; end if;
  it := stk_find_by_gtin(p_gtin);
  if it.id is null then raise exception 'gtin_not_found:%', p_gtin; end if;
  if it.uts_tracked and it.uts_product_no is null then update stk_items set uts_product_no = lpad(p_gtin, 14, '0') where id = it.id; end if;
  v_serial := it.uts_kind = 'serial' and nullif(trim(coalesce(p_serial, '')), '') is not null;
  v_key := nullif(left(trim(case when it.uts_kind = 'serial' then coalesce(nullif(trim(p_serial), ''), p_lot) else coalesce(nullif(trim(p_lot), ''), p_serial) end), 60), '');
  v_qty := case when it.uts_kind = 'serial' then 1 else greatest(coalesce(p_qty, 1), 0) end;
  if it.uts_kind = 'serial' and v_key is not null and exists (select 1 from stk_receipt_lines where receipt_id = p_id and item_id = it.id and lot_no = v_key) then
    raise exception 'serial_dup:%', v_key;
  end if;
  -- Aynı ürün + aynı lot satırı varsa üstüne ekle (seri takipte her seri ayrı satır)
  if it.uts_kind <> 'serial' then
    select * into v_line from stk_receipt_lines where receipt_id = p_id and item_id = it.id and lot_no is not distinct from v_key order by sort limit 1;
  end if;
  if v_line.id is null then
    -- Lotu boş satır (siparişten gelen) varsa ona yaz
    select * into v_line from stk_receipt_lines where receipt_id = p_id and item_id = it.id and lot_no is null order by (qty < expected) desc, sort limit 1;
    if v_line.id is not null then
      update stk_receipt_lines set lot_no = v_key, expiry_date = coalesce(p_expiry, expiry_date), serial_no = case when v_serial then v_key else serial_no end, gtin = p_gtin,
             qty = qty + v_qty, scanned_at = now() where id = v_line.id returning * into v_line;
    else
      -- Farklı lot / seri: sipariş satırından kalan beklentiyi yeni satıra böl
      select * into base from stk_receipt_lines where receipt_id = p_id and item_id = it.id and po_line_id is not null and expected > qty order by sort limit 1;
      select coalesce(max(sort), -1) + 1 into v_sort from stk_receipt_lines where receipt_id = p_id;
      if base.id is not null then
        update stk_receipt_lines set expected = qty where id = base.id;
        insert into stk_receipt_lines (receipt_id, sort, po_line_id, item_id, name, unit, expected, qty, lot_no, expiry_date, serial_no, gtin, unit_cost, scanned_at)
        values (p_id, v_sort, base.po_line_id, it.id, it.name, it.unit, base.expected - base.qty, v_qty, v_key, p_expiry, case when v_serial then v_key end, p_gtin, base.unit_cost, now())
        returning * into v_line;
      else
        insert into stk_receipt_lines (receipt_id, sort, item_id, name, unit, expected, qty, lot_no, expiry_date, serial_no, gtin, unit_cost, scanned_at)
        values (p_id, v_sort, it.id, it.name, it.unit, 0, v_qty, v_key, p_expiry, case when v_serial then v_key end, p_gtin, case when it.purchase_currency = 'TRY' then it.purchase_price end, now())
        returning * into v_line;
      end if;
    end if;
  else
    update stk_receipt_lines set qty = qty + v_qty, expiry_date = coalesce(expiry_date, p_expiry), scanned_at = now() where id = v_line.id returning * into v_line;
  end if;
  return jsonb_build_object('line', v_line.id, 'name', v_line.name, 'qty', v_line.qty, 'expected', v_line.expected, 'unit', v_line.unit, 'lot_no', v_line.lot_no,
                            'expiry_date', v_line.expiry_date, 'serial', v_serial, 'track_lot', it.track_lot, 'track_expiry', it.track_expiry, 'unexpected', v_line.expected = 0, 'uts', it.uts_tracked);
end $$;
revoke execute on function stk_rcv_scan_udi(uuid, text, text, date, text, numeric) from public, anon;
grant execute on function stk_rcv_scan_udi(uuid, text, text, date, text, numeric) to authenticated;

-- Mal kabul onayı: bir sipariş satırı birden çok lot satırına bölünmüşse hepsi toplanır
create or replace function stk_rcv_confirm(p_id uuid, p_add_stock boolean, p_signer text, p_png text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_receipts; l record; v_all boolean; it stk_items;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  if p_add_stock is null then raise exception 'stock_choice_required'; end if;
  select * into r from stk_receipts where id = p_id and company_id = lab_company() for update;
  if r.id is null or r.status <> 'open' then raise exception 'bad_status'; end if;
  if not exists (select 1 from stk_receipt_lines where receipt_id = p_id and qty > 0) then raise exception 'no_qty'; end if;
  if coalesce(p_png, '') not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  if p_add_stock then
    for l in select * from stk_receipt_lines where receipt_id = p_id and item_id is not null and qty - damaged > 0 loop
      select * into it from stk_items where id = l.item_id;
      if (it.track_lot or it.uts_tracked) and l.lot_no is null then raise exception 'lot_required:%', l.name; end if;
      if it.track_expiry and l.expiry_date is null then raise exception 'expiry_required:%', l.name; end if;
      perform stk_move_sys(l.item_id, r.warehouse_id, l.qty - l.damaged, 'purchase', coalesce(l.unit_cost, it.purchase_price, 0), l.lot_no, l.expiry_date, current_date,
                           'receipt', r.id, null, r.party_id, left(stk_rcv_no(r) || coalesce(' · ' || r.supplier_doc, '') || ' (faturasız mal kabul)', 300));
    end loop;
  end if;
  if r.po_id is not null then
    update pur_order_lines pl set received_qty = least(pl.qty, pl.received_qty + x.got)
    from (select po_line_id, sum(qty - damaged) got from stk_receipt_lines where receipt_id = p_id and po_line_id is not null and qty - damaged > 0 group by po_line_id) x
    where x.po_line_id = pl.id;
    select bool_and(received_qty >= qty) into v_all from pur_order_lines where order_id = r.po_id;
    update pur_orders set status = case when v_all then 'received' else 'partial' end, received_at = case when v_all then now() else received_at end
    where id = r.po_id and status in ('approved', 'sent', 'partial');
  end if;
  update stk_receipts set status = 'confirmed', add_to_stock = p_add_stock, signer_name = left(coalesce(nullif(trim(p_signer), ''), 'Depo'), 160), signature = p_png,
         note = coalesce(nullif(left(trim(p_note), 500), ''), note), confirmed_by = auth.uid(), confirmed_at = now() where id = p_id;
  perform deliver(r.company_id, module_recipients('purchases', 2),
    'Mal kabul yapıldı · ' || stk_rcv_no(r),
    coalesce((select name from fin_parties where id = r.party_id), 'Tedarikçi') || ' · ' || (select count(*) from stk_receipt_lines where receipt_id = p_id and qty > 0) || ' kalem · '
      || case when p_add_stock then 'stoğa girdi (faturasız)' else 'fatura bekleniyor' end
      || case when exists (select 1 from stk_receipt_lines where receipt_id = p_id and (qty <> expected and expected > 0 or damaged > 0)) then ' · eksik / fazla / hasarlı var' else '' end,
    '/stok/mal-kabul/' || p_id);
end $$;
revoke execute on function stk_rcv_confirm(uuid, boolean, text, text, text) from public, anon;
grant execute on function stk_rcv_confirm(uuid, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Kontrol Merkezi: ek kurallar kancası
-- ---------------------------------------------------------------------
create or replace function adm_extra_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'uts_error', 'area', 'stok', 'sev', 'high', 'title', 'ÜTS''ye iletilemeyen bildirim', 'hint', 'Hata mesajını okuyun: lot / kurum no düzeltip tekrar deneyin ya da ÜTS''de elle yapıp işaretleyin.', 'fix', '/stok/uts?durum=error',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, ''iş #'' || (n.payload->>''job_no''), '''') || coalesce('' · lot '' || n.lot_no, '''') || coalesce('' · seri '' || n.serial_no, '''') label, ''/stok/uts?durum=error'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''error'''),
    jsonb_build_object('key', 'uts_cancel', 'area', 'stok', 'sev', 'high', 'title', 'ÜTS''de iptal edilmesi gereken bildirim', 'hint', 'Malzeme işten kaldırıldı ama bildirim ÜTS''ye gitmişti.', 'fix', '/stok/uts?durum=cancel_needed',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, '''') || coalesce('' · lot '' || coalesce(n.lot_no, n.serial_no), '''') label, ''/stok/uts?durum=cancel_needed'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''cancel_needed'''),
    jsonb_build_object('key', 'uts_stale', 'area', 'stok', 'sev', 'medium', 'title', '24 saattir bekleyen ÜTS bildirimi', 'hint', 'Ismarlama bildirimleri ÜTS ekranından elle yapılır; diğerleri için ÜTS bağlantısını kontrol edin.', 'fix', '/stok/uts',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, ''iş #'' || (n.payload->>''job_no''), '''') || '' · '' || to_char(n.created_at, ''DD.MM'') label, ''/stok/uts'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''pending'' and n.created_at < now() - interval ''24 hours'''),
    jsonb_build_object('key', 'uts_no_number', 'area', 'stok', 'sev', 'medium', 'title', 'ÜTS takibinde ama ürün numarası (UNO) girilmemiş stok kartı', 'hint', 'Ürünün karekodundaki (01) numarasını karta girin.', 'fix', '/stok/urunler',
      'sql', 'select i.id::text id, i.name label, ''/stok/urunler/'' || i.id link from stk_items i where i.company_id = lab_company() and i.is_active and i.uts_tracked and coalesce(i.uts_product_no, '''') = '''''),
    jsonb_build_object('key', 'uts_no_kurum', 'area', 'stok', 'sev', 'low', 'title', 'ÜTS kurum no eksik: bildirimi bekleyen tedarikçi / klinik', 'hint', 'Cari ya da hekim kartına ÜTS kurum numarasını girin.', 'fix', '/stok/uts',
      'sql', 'select coalesce(n.counterparty_name, ''?'') id, coalesce(n.counterparty_name, ''Karşı kurum'') || '' · '' || count(*) || '' bildirim'' label, ''/stok/uts'' link from uts_notifications n where n.company_id = lab_company() and n.status in (''pending'', ''error'') and n.kind in (''alma'', ''verme'') and coalesce(n.counterparty_no, '''') = '''' group by n.counterparty_name')
  ) where exists (select 1 from uts_settings s where s.company_id = lab_company() and s.enabled);
$$;
revoke execute on function adm_extra_rules() from public, anon, authenticated;

-- adm_compute'a kanca: kurallar listesine adm_extra_rules() eklenir (bir kez)
do $$
declare d text;
begin
  select pg_get_functiondef('adm_compute()'::regprocedure) into d;
  if d is not null and position('adm_extra_rules' in d) = 0 then
    d := replace(d, E'  for r in select * from jsonb_array_elements(rules) loop', E'  rules := rules || coalesce(adm_extra_rules(), ''[]'');\n  for r in select * from jsonb_array_elements(rules) loop');
    if position('adm_extra_rules' in d) > 0 then execute d; end if;
  end if;
exception when undefined_function then null;
end $$;

notify pgrst, 'reload schema';
