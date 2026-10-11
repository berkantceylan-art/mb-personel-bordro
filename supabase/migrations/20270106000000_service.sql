-- =====================================================================
-- ARIZA / TAMİR / BAKIM + TEKNİK SERVİS
--  svc_technicians : teknik servis personeli (şirket içi). Teknik servis ekranını görür, tüm demirbaşları görür.
--  svc_tickets     : arıza bildirimi, dış servise gönderim (ör. yazıcı), periyodik bakım
--  svc_photos      : önce / sonra fotoğrafları (sıkıştırılmış JPEG dataURL)
--  svc_events      : geçmiş
-- Akış:
--  reported      bildirildi → satın alma sorumlusu onaylar (teknisyene ya da dış servise atar) ya da reddeder
--  approved      atandı; teknisyen başlar / dış servise gönderilir
--  in_progress   işlemde / serviste
--  done          yapıldı (sonra fotoğrafı + ücret); ücret varsa satın alma onayı beklenir, yoksa kapanır
--  cost_approved ücret onaylandı → muhasebe ödemesi bekleniyor
--  closed        kapandı (ödendi ya da ücretsiz)
--  rejected / cancelled
-- Yetkiler: bildirim = şirketteki herkes; onay / atama / ücret onayı = purchases ≥ 2 (ya da assets ≥ 3);
--           ödeme = finance ≥ 2; işlem = atanan teknisyen (dış serviste satın alma).
-- Bakım: assets.next_maintenance yaklaşan demirbaşlar için svc_maintenance_due() kendiliğinden bakım kaydı açar (günlük iş).
-- Tekrar çalıştırılabilir. Önce 20261206000000_expenses_assets.sql.
-- =====================================================================

create table if not exists svc_technicians (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  user_id uuid not null references auth.users (id) on delete cascade,
  phone text check (phone is null or length(phone) <= 40),
  skills text check (skills is null or length(skills) <= 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists svc_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  kind text not null default 'repair' check (kind in ('repair', 'external', 'maintenance')),
  asset_id uuid references assets (id) on delete set null,
  title text not null check (length(title) between 2 and 160),
  description text check (description is null or length(description) <= 2000),
  location text check (location is null or length(location) <= 120),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'reported' check (status in ('reported', 'approved', 'in_progress', 'done', 'cost_approved', 'closed', 'rejected', 'cancelled')),
  reported_by uuid default auth.uid() references auth.users (id) on delete set null,
  technician_user uuid references auth.users (id) on delete set null,
  vendor text check (vendor is null or length(vendor) <= 160),
  due_date date,
  approved_by uuid, approved_at timestamptz,
  started_at timestamptz,
  done_at timestamptz, done_by uuid,
  done_note text check (done_note is null or length(done_note) <= 2000),
  cost bigint not null default 0 check (cost >= 0),          -- kuruş, KDV dahil
  vat_rate numeric(5, 2) not null default 20,
  cost_note text check (cost_note is null or length(cost_note) <= 500),
  cost_approved_by uuid, cost_approved_at timestamptz,
  paid_by uuid, paid_at timestamptz,
  pay_account_id uuid references fin_accounts (id) on delete set null,
  fin_txn_id uuid references fin_txns (id) on delete set null,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, year, no)
);
create index if not exists svc_tickets_status_idx on svc_tickets (company_id, status, created_at desc);
create index if not exists svc_tickets_tech_idx on svc_tickets (technician_user, status);
create index if not exists svc_tickets_asset_idx on svc_tickets (asset_id, created_at desc);
create index if not exists svc_tickets_reporter_idx on svc_tickets (reported_by, created_at desc);

create table if not exists svc_photos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references svc_tickets (id) on delete cascade,
  stage text not null check (stage in ('before', 'after')),
  data text not null check (data like 'data:image/jpeg;base64,%' and length(data) <= 900000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists svc_photos_ticket_idx on svc_photos (ticket_id, stage);

create table if not exists svc_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references svc_tickets (id) on delete cascade,
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  action text not null,
  note text
);
create index if not exists svc_events_ticket_idx on svc_events (ticket_id, at);

alter table svc_technicians enable row level security;
alter table svc_tickets enable row level security;
alter table svc_photos enable row level security;
alter table svc_events enable row level security;

create or replace function svc_is_tech() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from svc_technicians t where t.user_id = auth.uid() and t.company_id = lab_company() and t.is_active);
$$;
revoke execute on function svc_is_tech() from public, anon;
grant execute on function svc_is_tech() to authenticated;

create or replace function svc_is_buyer() returns boolean
language sql stable security definer set search_path = public as $$
  select can_module('purchases', 2) or can_module('assets', 3);
$$;
revoke execute on function svc_is_buyer() from public, anon;
grant execute on function svc_is_buyer() to authenticated;

create or replace function svc_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from svc_tickets t where t.id = p_id and t.company_id = lab_company()
    and (t.reported_by = auth.uid() or t.technician_user = auth.uid() or svc_is_tech() or can_module('purchases') or can_module('assets') or can_module('finance')));
$$;
revoke execute on function svc_visible(uuid) from public, anon;
grant execute on function svc_visible(uuid) to authenticated;

drop policy if exists svc_technicians_read on svc_technicians;
create policy svc_technicians_read on svc_technicians for select to authenticated using (company_id = lab_company());
drop policy if exists svc_technicians_write on svc_technicians;
create policy svc_technicians_write on svc_technicians for all to authenticated using (company_id = lab_company() and svc_is_buyer()) with check (company_id = lab_company() and svc_is_buyer());
grant select, insert, update, delete on svc_technicians to authenticated;
drop policy if exists svc_tickets_read on svc_tickets;
create policy svc_tickets_read on svc_tickets for select to authenticated using (svc_visible(id));
drop policy if exists svc_photos_read on svc_photos;
create policy svc_photos_read on svc_photos for select to authenticated using (svc_visible(ticket_id));
drop policy if exists svc_events_read on svc_events;
create policy svc_events_read on svc_events for select to authenticated using (svc_visible(ticket_id));
grant select on svc_tickets, svc_photos, svc_events to authenticated;

-- ---------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------
create or replace function svc_no(t svc_tickets) returns text language sql immutable as $$
  select 'SV-' || t.year || '-' || lpad(t.no::text, 4, '0');
$$;

create or replace function svc_log(p_id uuid, p_action text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into svc_events (ticket_id, action, note) values (p_id, p_action, nullif(trim(p_note), ''));
  update svc_tickets set updated_at = now() where id = p_id;
$$;
revoke execute on function svc_log(uuid, text, text) from public, anon, authenticated;

create or replace function svc_buyers() returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(select distinct unnest(module_recipients('purchases', 2) || module_recipients('assets', 3)));
$$;
revoke execute on function svc_buyers() from public, anon, authenticated;

create or replace function svc_notify(p_id uuid, p_users uuid[], p_title text, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets; v_asset text;
begin
  select * into t from svc_tickets where id = p_id;
  select name || coalesce(' · ' || code, '') into v_asset from assets where id = t.asset_id;
  perform deliver(t.company_id, array(select distinct u from unnest(p_users) u where u is not null), p_title || ' · ' || svc_no(t),
    left(t.title || coalesce(' · ' || v_asset, '') || coalesce(' · ' || t.location, ''), 200), coalesce(p_link, '/servis/' || t.id));
end $$;
revoke execute on function svc_notify(uuid, uuid[], text, text) from public, anon, authenticated;

create or replace function svc_add_photos(p_id uuid, p_stage text, p_photos jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x text; n int := 0;
begin
  for x in select * from jsonb_array_elements_text(coalesce(p_photos, '[]'::jsonb)) loop
    exit when n >= 6;
    if x like 'data:image/jpeg;base64,%' and length(x) <= 900000 then
      insert into svc_photos (ticket_id, stage, data) values (p_id, p_stage, x);
      n := n + 1;
    end if;
  end loop;
end $$;
revoke execute on function svc_add_photos(uuid, text, jsonb) from public, anon, authenticated;

-- Demirbaş servis sonrası: zimmetliyse zimmetli, değilse boşta
create or replace function svc_asset_back(p_asset uuid) returns void
language sql security definer set search_path = public as $$
  update assets set status = case when exists (select 1 from asset_assignments a where a.asset_id = p_asset and a.returned_on is null) then 'ASSIGNED' else 'AVAILABLE' end, updated_at = now()
  where id = p_asset and status = 'MAINTENANCE';
$$;
revoke execute on function svc_asset_back(uuid) from public, anon, authenticated;

-- Kapanışta demirbaş bakım geçmişine işle; periyodik bakımsa sonraki bakım tarihini ilerlet
create or replace function svc_close(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets; a assets; v_next date;
begin
  select * into t from svc_tickets where id = p_id;
  update svc_tickets set status = 'closed', closed_at = now() where id = p_id;
  if t.asset_id is not null then
    select * into a from assets where id = t.asset_id;
    v_next := case when t.kind = 'maintenance' and a.maintenance_interval_months is not null then (coalesce(t.done_at, now())::date + make_interval(months => a.maintenance_interval_months))::date else a.next_maintenance end;
    insert into asset_maintenance (asset_id, done_on, kind, description, cost, next_due, fin_txn_id)
    values (t.asset_id, coalesce(t.done_at, now())::date, case when t.kind = 'maintenance' then 'maintenance' else 'repair' end,
            left(svc_no(t) || ' · ' || t.title || coalesce(' · ' || t.vendor, '') || coalesce(' · ' || t.done_note, ''), 500), t.cost, v_next, t.fin_txn_id);
    update assets set next_maintenance = v_next, updated_at = now() where id = t.asset_id;
    perform svc_asset_back(t.asset_id);
  end if;
end $$;
revoke execute on function svc_close(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- İşlemler
-- ---------------------------------------------------------------------
-- Arıza bildir: { asset_id?, title, description?, location?, priority?, photos?: [jpeg dataURL] }
create or replace function svc_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_year int := extract(year from now())::int; v_asset uuid := nullif(p ->> 'asset_id', '')::uuid;
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = lab_company()) then raise exception 'not_allowed'; end if;
  if v_asset is not null and not exists (select 1 from assets where id = v_asset and company_id = lab_company()) then raise exception 'asset_not_found'; end if;
  if length(trim(coalesce(p ->> 'title', ''))) < 2 then raise exception 'title_required'; end if;
  insert into svc_tickets (year, no, kind, asset_id, title, description, location, priority)
  values (v_year, lab_next_no('sv', v_year), case when p ->> 'kind' = 'external' then 'external' else 'repair' end, v_asset, left(trim(p ->> 'title'), 160), nullif(left(trim(p ->> 'description'), 2000), ''),
          nullif(left(trim(p ->> 'location'), 120), ''), case when p ->> 'priority' in ('low', 'normal', 'high', 'urgent') then p ->> 'priority' else 'normal' end)
  returning id into v_id;
  perform svc_add_photos(v_id, 'before', p -> 'photos');
  perform svc_log(v_id, 'create', p ->> 'description');
  perform svc_notify(v_id, svc_buyers(), case when p ->> 'priority' = 'urgent' then '🔴 Acil arıza bildirimi' else 'Yeni arıza / tamir bildirimi' end);
  return v_id;
end $$;
revoke execute on function svc_create(jsonb) from public, anon;
grant execute on function svc_create(jsonb) to authenticated;

create or replace function svc_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets;
begin
  select * into t from svc_tickets where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if not (t.reported_by = auth.uid() or svc_is_buyer()) then raise exception 'not_allowed'; end if;
  if t.status not in ('reported', 'approved') then raise exception 'bad_status'; end if;
  update svc_tickets set status = 'cancelled', closed_at = now() where id = p_id;
  perform svc_log(p_id, 'cancel');
  if t.technician_user is not null then perform svc_notify(p_id, array[t.technician_user], 'Servis kaydı iptal edildi'); end if;
end $$;
revoke execute on function svc_cancel(uuid) from public, anon;
grant execute on function svc_cancel(uuid) to authenticated;

-- Satın alma kararı: p_mode 'tech' (teknisyene ata) | 'external' (dış servise) | 'reject'
create or replace function svc_approve(p_id uuid, p_mode text, p_tech uuid default null, p_vendor text default null, p_due date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets;
begin
  if not svc_is_buyer() then raise exception 'not_allowed'; end if;
  select * into t from svc_tickets where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if p_mode = 'reject' then
    if t.status <> 'reported' then raise exception 'bad_status'; end if;
    if nullif(trim(p_note), '') is null then raise exception 'note_required'; end if;
    update svc_tickets set status = 'rejected', decision_note = left(trim(p_note), 500), closed_at = now() where id = p_id;
    perform svc_log(p_id, 'reject', p_note);
    perform svc_notify(p_id, array[t.reported_by], 'Arıza bildiriminiz reddedildi');
    return;
  end if;
  -- Bildirildi ya da onaylı (yeniden atama)
  if t.status not in ('reported', 'approved') then raise exception 'bad_status'; end if;
  if p_mode = 'tech' then
    if p_tech is null or not exists (select 1 from svc_technicians where user_id = p_tech and company_id = lab_company() and is_active) then raise exception 'tech_required'; end if;
    update svc_tickets set status = 'approved', kind = case when kind = 'maintenance' then kind else 'repair' end, technician_user = p_tech, vendor = null,
           due_date = coalesce(p_due, due_date), decision_note = coalesce(nullif(left(trim(p_note), 500), ''), decision_note), approved_by = auth.uid(), approved_at = now() where id = p_id;
    perform svc_log(p_id, case when t.status = 'approved' then 'reassign' else 'approve_tech' end, req_user_name(p_tech) || coalesce(' · ' || nullif(trim(p_note), ''), ''));
    perform svc_notify(p_id, array[p_tech], 'Size servis işi atandı', '/teknik-servis');
  elsif p_mode = 'external' then
    if nullif(trim(p_vendor), '') is null then raise exception 'vendor_required'; end if;
    update svc_tickets set status = 'approved', kind = case when kind = 'maintenance' then kind else 'external' end, technician_user = null, vendor = left(trim(p_vendor), 160),
           due_date = coalesce(p_due, due_date), decision_note = coalesce(nullif(left(trim(p_note), 500), ''), decision_note), approved_by = auth.uid(), approved_at = now() where id = p_id;
    perform svc_log(p_id, 'approve_external', trim(p_vendor) || coalesce(' · ' || nullif(trim(p_note), ''), ''));
  else
    raise exception 'bad_action';
  end if;
  if t.status = 'reported' and t.reported_by is not null then perform svc_notify(p_id, array[t.reported_by], 'Arıza bildiriminiz onaylandı'); end if;
end $$;
revoke execute on function svc_approve(uuid, text, uuid, text, date, text) from public, anon;
grant execute on function svc_approve(uuid, text, uuid, text, date, text) to authenticated;

create or replace function svc_can_work(t svc_tickets) returns boolean
language sql stable security definer set search_path = public as $$
  select (t.technician_user is not null and t.technician_user = auth.uid()) or (t.technician_user is null and svc_is_buyer()) or (svc_is_buyer() and svc_is_tech());
$$;
revoke execute on function svc_can_work(svc_tickets) from public, anon, authenticated;

-- Başla / servise gönder
create or replace function svc_start(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets;
begin
  select * into t from svc_tickets where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if not svc_can_work(t) then raise exception 'not_allowed'; end if;
  if t.status <> 'approved' then raise exception 'bad_status'; end if;
  update svc_tickets set status = 'in_progress', started_at = now() where id = p_id;
  if t.asset_id is not null then update assets set status = 'MAINTENANCE', updated_at = now() where id = t.asset_id and status in ('AVAILABLE', 'ASSIGNED'); end if;
  perform svc_log(p_id, case when t.kind = 'external' then 'sent' else 'start' end, p_note);
end $$;
revoke execute on function svc_start(uuid, text) from public, anon;
grant execute on function svc_start(uuid, text) to authenticated;

-- Yapıldı: not, ücret (kuruş, KDV dahil), sonra fotoğrafları. Ücret yoksa doğrudan kapanır.
create or replace function svc_done(p_id uuid, p_note text, p_cost bigint, p_photos jsonb default '[]', p_cost_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets; v_cost bigint := greatest(coalesce(p_cost, 0), 0);
begin
  select * into t from svc_tickets where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if not svc_can_work(t) then raise exception 'not_allowed'; end if;
  if t.status not in ('approved', 'in_progress') then raise exception 'bad_status'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'note_required'; end if;
  update svc_tickets set status = 'done', done_at = now(), done_by = auth.uid(), done_note = left(trim(p_note), 2000), cost = v_cost,
         cost_note = nullif(left(trim(p_cost_note), 500), ''), started_at = coalesce(started_at, now()) where id = p_id;
  perform svc_add_photos(p_id, 'after', p_photos);
  perform svc_log(p_id, 'done', trim(p_note) || case when v_cost > 0 then ' · ücret ' || to_char(v_cost / 100.0, 'FM999G999G990D00') || ' TL' else '' end);
  if v_cost = 0 then
    perform svc_close(p_id);
    perform svc_log(p_id, 'closed', 'Ücretsiz');
    perform svc_notify(p_id, array(select distinct unnest(svc_buyers() || array[t.reported_by])), 'Servis işi tamamlandı');
  else
    perform svc_notify(p_id, svc_buyers(), 'Servis ücreti onay bekliyor');
    if t.reported_by is not null then perform svc_notify(p_id, array[t.reported_by], 'Bildirdiğiniz arıza giderildi'); end if;
  end if;
end $$;
revoke execute on function svc_done(uuid, text, bigint, jsonb, text) from public, anon;
grant execute on function svc_done(uuid, text, bigint, jsonb, text) to authenticated;

-- Satın alma: ücreti onayla (tutar düzeltilebilir) ya da geri gönder
create or replace function svc_cost(p_id uuid, p_action text, p_cost bigint default null, p_vat numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets;
begin
  if not svc_is_buyer() then raise exception 'not_allowed'; end if;
  select * into t from svc_tickets where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if t.status <> 'done' then raise exception 'bad_status'; end if;
  if p_action = 'approve' then
    update svc_tickets set status = 'cost_approved', cost = coalesce(greatest(p_cost, 0), cost), vat_rate = coalesce(p_vat, vat_rate),
           cost_approved_by = auth.uid(), cost_approved_at = now(), decision_note = coalesce(nullif(left(trim(p_note), 500), ''), decision_note) where id = p_id;
    perform svc_log(p_id, 'cost_approve', p_note);
    perform svc_notify(p_id, module_recipients('finance', 2), 'Servis ödemesi bekliyor', '/servis/' || p_id);
  elsif p_action = 'return' then
    if nullif(trim(p_note), '') is null then raise exception 'note_required'; end if;
    update svc_tickets set status = 'in_progress', decision_note = left(trim(p_note), 500) where id = p_id;
    perform svc_log(p_id, 'cost_return', p_note);
    if t.technician_user is not null then perform svc_notify(p_id, array[t.technician_user], 'Servis işi geri gönderildi', '/teknik-servis'); end if;
  else
    raise exception 'bad_action';
  end if;
end $$;
revoke execute on function svc_cost(uuid, text, bigint, numeric, text) from public, anon;
grant execute on function svc_cost(uuid, text, bigint, numeric, text) to authenticated;

-- Muhasebe: ödeme (kasa / banka / kart) → gider kaydı, iş kapanır
create or replace function svc_pay(p_id uuid, p_account uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t svc_tickets; acc fin_accounts; v_txn uuid; v_vat bigint; v_date date := coalesce(p_date, current_date); v_desc text;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  select * into t from svc_tickets where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if t.status <> 'cost_approved' then raise exception 'bad_status'; end if;
  select * into acc from fin_accounts where id = p_account and company_id = lab_company() and kind in ('cash', 'bank', 'credit_card');
  if acc.id is null then raise exception 'account_required'; end if;
  if fin_category('exp_maintenance') is null or fin_category('vat_in') is null then raise exception 'category_missing'; end if;
  v_vat := case when t.vat_rate > 0 then round(t.cost * t.vat_rate / (100 + t.vat_rate)) else 0 end;
  v_desc := left('Servis / tamir · ' || svc_no(t) || ' · ' || t.title || coalesce(' · ' || t.vendor, ''), 300);
  v_txn := fin_post_sys(jsonb_build_object('kind', case when acc.kind = 'credit_card' then 'card_spend' else 'expense' end, 'txn_date', v_date,
                                           'description', v_desc, 'amount', t.cost, 'currency', 'TRY', 'account_id', acc.id, 'ref_type', 'service', 'ref_id', t.id),
    jsonb_build_array(
      jsonb_build_object('account_id', acc.id, 'amount', -fin_conv(t.cost, 'TRY', acc.currency, v_date), 'currency', acc.currency, 'rate', fin_rate(acc.currency, v_date)),
      jsonb_build_object('category_id', fin_category('exp_maintenance'), 'amount', t.cost - v_vat, 'currency', 'TRY', 'rate', 1),
      jsonb_build_object('category_id', fin_category('vat_in'), 'amount', v_vat, 'currency', 'TRY', 'rate', 1)));
  update svc_tickets set paid_by = auth.uid(), paid_at = now(), pay_account_id = acc.id, fin_txn_id = v_txn where id = p_id;
  perform svc_close(p_id);
  perform svc_log(p_id, 'paid', acc.name);
  perform svc_notify(p_id, array(select distinct u from unnest(array[t.cost_approved_by, t.technician_user]) u where u is not null), 'Servis ödemesi yapıldı');
  return v_txn;
end $$;
revoke execute on function svc_pay(uuid, uuid, date) from public, anon;
grant execute on function svc_pay(uuid, uuid, date) to authenticated;

-- Fotoğraf ekle (bildiren, teknisyen ya da satın alma)
create or replace function svc_photo(p_id uuid, p_stage text, p_data text) returns void
language plpgsql security definer set search_path = public as $$
declare t svc_tickets;
begin
  select * into t from svc_tickets where id = p_id and company_id = lab_company();
  if t.id is null or not (t.reported_by = auth.uid() or svc_can_work(t) or svc_is_buyer()) then raise exception 'not_allowed'; end if;
  if p_stage not in ('before', 'after') then raise exception 'bad_action'; end if;
  if (select count(*) from svc_photos where ticket_id = p_id) >= 12 then raise exception 'too_many_photos'; end if;
  perform svc_add_photos(p_id, p_stage, jsonb_build_array(p_data));
end $$;
revoke execute on function svc_photo(uuid, text, text) from public, anon;
grant execute on function svc_photo(uuid, text, text) to authenticated;

-- Periyodik bakım: zamanı yaklaşan (3 gün) demirbaşlara bakım kaydı aç
create or replace function svc_maintenance_due() returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; v_id uuid; v_year int := extract(year from now())::int; v_company uuid;
begin
  for a in select x.* from assets x
           where x.next_maintenance is not null and x.next_maintenance <= current_date + 3 and x.disposed_on is null and x.status not in ('LOST', 'RETIRED')
             and (auth.uid() is null or x.company_id = lab_company())
             and not exists (select 1 from svc_tickets t where t.asset_id = x.id and t.kind = 'maintenance' and t.status not in ('closed', 'rejected', 'cancelled'))
           order by x.next_maintenance limit 200 loop
    v_company := a.company_id;
    insert into lab_doc_seq (company_id, kind, year, last) values (v_company, 'sv', v_year, 1)
    on conflict (company_id, kind, year) do update set last = lab_doc_seq.last + 1;
    insert into svc_tickets (company_id, year, no, kind, asset_id, title, location, due_date, reported_by, status)
    values (v_company, v_year, (select last from lab_doc_seq where company_id = v_company and kind = 'sv' and year = v_year), 'maintenance', a.id,
            left('Periyodik bakım · ' || a.name, 160), a.location, a.next_maintenance, null, 'reported')
    returning id into v_id;
    insert into svc_events (ticket_id, by_user, action, note) values (v_id, null, 'scheduled', 'Bakım tarihi ' || to_char(a.next_maintenance, 'DD.MM.YYYY'));
    perform deliver(v_company, array(select distinct u from unnest(
        array(select m.user_id from memberships m where m.company_id = v_company and (module_level_for(m.user_id, 'purchases') >= 2 or module_level_for(m.user_id, 'assets') >= 3))) u),
      'Bakım zamanı · ' || a.name, 'Periyodik bakım ' || to_char(a.next_maintenance, 'DD.MM.YYYY') || ' · servise / teknisyene atayın', '/servis/' || v_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function svc_maintenance_due() from public, anon;
grant execute on function svc_maintenance_due() to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function svc_maintenance_due() to service_role; end if; end $$;

-- Teknisyen adayları (kullanıcı listesi) ve teknisyen listesi adlarıyla
create or replace function svc_tech_list() returns table (user_id uuid, name text, phone text, skills text, is_active boolean, open_jobs int)
language sql stable security definer set search_path = public as $$
  select t.user_id, req_user_name(t.user_id), t.phone, t.skills, t.is_active,
         (select count(*)::int from svc_tickets s where s.technician_user = t.user_id and s.status in ('approved', 'in_progress'))
  from svc_technicians t where t.company_id = lab_company() order by t.is_active desc, 2;
$$;
revoke execute on function svc_tech_list() from public, anon;
grant execute on function svc_tech_list() to authenticated;

notify pgrst, 'reload schema';
