-- =====================================================================
-- TEDARİKÇİ PORTALI (2. nesil) + ÖDEME TAKVİMİ
--  sup_messages      : tedarikçi ↔ laboratuvar yazışması (siparişe bağlanabilir, belge eklenebilir, okundu bilgisi)
--  sup_documents     : iki yönlü belge (irsaliye, fatura, sertifika, katalog, fiyat listesi …) — dosyalar "supplier-files" kovasında
--  sup_price_lists / sup_price_lines : tedarikçinin gönderdiği yeni fiyat listesi; satın alma onaylayınca stok kartı alış fiyatı güncellenir
--  sup_products(cari)  : o firmadan daha önce aldığımız ürünler (sipariş + alış faturası + stok kartı tedarikçisi), son fiyat
--  sup_portal_ledger   : tedarikçinin kendi carisi — faturalı (resmi) ve fişli (faturasız) hesap ayrı
--  fin_payment_plans   : planlanan ödemeler; ödeme takvimi = vadesi gelen alış faturaları (açık tutar) + verilen çek / senet + planlar
--  pay_reminders_run   : günlük görev; vadeden N gün önce ve vade günü bildirim (tedarikçiye isteğe bağlı e-posta / WhatsApp)
--  pur_orders.billing  : faturalı / faturasız (fişli) sipariş. Faturasız siparişin mal kabulü otomatik fişli cariye işlenir.
-- Tekrar çalıştırılabilir. Önce 20270243000000_purchasing_p3.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Faturalı / faturasız sipariş
-- ---------------------------------------------------------------------
alter table pur_orders add column if not exists billing text not null default 'invoice';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pur_orders_billing_chk') then
    alter table pur_orders add constraint pur_orders_billing_chk check (billing in ('invoice', 'slip'));
  end if;
end $$;

create or replace function pur_order_set_billing(p_id uuid, p_billing text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if p_billing not in ('invoice', 'slip') then raise exception 'bad_billing'; end if;
  update pur_orders set billing = p_billing where id = p_id and company_id = lab_company() and status not in ('invoiced', 'cancelled');
end $$;
revoke execute on function pur_order_set_billing(uuid, text) from public, anon;
grant execute on function pur_order_set_billing(uuid, text) to authenticated;

-- Faturasız siparişin mal kabulü firmanın fişli carisine açılır (onayda tutar fişli cariye borç yazılır)
create or replace function stk_rcv_billing_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.po_id is not null and new.party_id is not null
     and exists (select 1 from pur_orders where id = new.po_id and billing = 'slip')
     and exists (select 1 from fin_parties where id = new.party_id and slip_of is null) then
    new.party_id := fin_party_twin(new.party_id);
  end if;
  return new;
end $$;
drop trigger if exists stk_receipts_billing on stk_receipts;
create trigger stk_receipts_billing before insert on stk_receipts for each row execute function stk_rcv_billing_default();

-- ---------------------------------------------------------------------
-- Erişim yardımcıları
-- ---------------------------------------------------------------------
alter table fin_parties add column if not exists portal_show_ledger boolean not null default true;
alter table fin_parties add column if not exists portal_show_slip boolean not null default true;

-- Oturumdaki kişi bu tedarikçinin portal kullanıcısı mı?
create or replace function sup_is_mine(p_party uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from sup_portal_users where user_id = auth.uid() and is_active and party_id = p_party);
$$;
grant execute on function sup_is_mine(uuid) to authenticated;

-- Tedarikçinin kendisi ya da satın alma / finans yetkilisi
create or replace function sup_can(p_party uuid) returns boolean language sql stable security definer set search_path = public as $$
  select sup_is_mine(p_party) or (exists (select 1 from fin_parties where id = p_party and company_id = lab_company()) and (can_module('purchases') or can_module('finance')));
$$;
grant execute on function sup_can(uuid) to authenticated;

create or replace function sup_twin_of(p_main uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from fin_parties where slip_of = p_main limit 1;
$$;
revoke execute on function sup_twin_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Belgeler ve mesajlar
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('supplier-files', 'supplier-files', false, 20971520)
on conflict (id) do nothing;

create table if not exists sup_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  po_id uuid references pur_orders (id) on delete set null,
  side text not null check (side in ('supplier', 'lab')),
  kind text not null default 'other' check (kind in ('invoice', 'waybill', 'price_list', 'certificate', 'catalog', 'quote', 'payment', 'contract', 'other')),
  title text not null check (length(title) between 1 and 200),
  file_path text not null check (length(file_path) <= 400),
  file_name text check (file_name is null or length(file_name) <= 200),
  mime text check (mime is null or length(mime) <= 120),
  size_bytes int,
  note text check (note is null or length(note) <= 500),
  valid_until date,
  user_id uuid default auth.uid(),
  sender_name text check (sender_name is null or length(sender_name) <= 120),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  removed boolean not null default false
);
create index if not exists sup_documents_party_idx on sup_documents (party_id, created_at desc);

create table if not exists sup_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  po_id uuid references pur_orders (id) on delete set null,
  side text not null check (side in ('supplier', 'lab')),
  user_id uuid default auth.uid(),
  sender_name text check (sender_name is null or length(sender_name) <= 120),
  body text not null check (length(body) between 1 and 4000),
  doc_id uuid references sup_documents (id) on delete set null,
  via text[] not null default '{portal}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sup_messages_party_idx on sup_messages (party_id, created_at desc);

alter table sup_documents enable row level security;
alter table sup_messages enable row level security;
drop policy if exists sup_documents_read on sup_documents;
create policy sup_documents_read on sup_documents for select to authenticated using ((select sup_can(party_id)) and not removed);
drop policy if exists sup_messages_read on sup_messages;
create policy sup_messages_read on sup_messages for select to authenticated using ((select sup_can(party_id)));
revoke all on sup_documents, sup_messages from anon;
grant select on sup_documents, sup_messages to authenticated;

-- Gönderenin adı ve tarafı
create or replace function sup_sender(p_party uuid, out side text, out name text) language plpgsql stable security definer set search_path = public as $$
begin
  if sup_is_mine(p_party) then
    side := 'supplier';
    select u.name into name from sup_portal_users u where u.user_id = auth.uid() and u.party_id = p_party and u.is_active limit 1;
  else
    side := 'lab';
    select coalesce(nullif(trim(e.first_name || ' ' || e.last_name), ''), (select raw_user_meta_data->>'full_name' from auth.users where id = auth.uid()), 'Satın alma')
      into name from (select 1) x left join employees e on e.user_id = auth.uid();
  end if;
end $$;
revoke execute on function sup_sender(uuid) from public, anon, authenticated;

-- Yeni olay → karşı tarafa bildirim (laboratuvar tarafı: satın alma kullanıcıları; tedarikçi tarafı: ekranda okunmamış sayısı + e-posta / WhatsApp sunucudan)
create or replace function sup_notify_lab(p_party uuid, p_title text, p_body text, p_tab text) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; n text;
begin
  select company_id, name into c, n from fin_parties where id = p_party;
  perform deliver(c, module_recipients_for(c, 'purchases', 1), left(p_title || ' · ' || coalesce(n, ''), 200), left(coalesce(p_body, ''), 300), '/satinalma/tedarikci/' || p_party || '?t=' || p_tab);
end $$;
revoke execute on function sup_notify_lab(uuid, text, text, text) from public, anon, authenticated;

-- Belge kaydı (dosya sunucu tarafında kovaya yüklendikten sonra)
create or replace function sup_doc_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_party uuid := (p->>'party_id')::uuid; v_id uuid; s record; v_po uuid := nullif(p->>'po_id', '')::uuid;
begin
  if not sup_can(v_party) then raise exception 'not_allowed'; end if;
  if not sup_is_mine(v_party) and not (can_module('purchases', 2) or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if coalesce(p->>'file_path', '') !~ ('^' || v_party::text || '/') then raise exception 'bad_path'; end if;
  if v_po is not null and not exists (select 1 from pur_orders where id = v_po and party_id = v_party) then v_po := null; end if;
  select * into s from sup_sender(v_party);
  insert into sup_documents (company_id, party_id, po_id, side, kind, title, file_path, file_name, mime, size_bytes, note, valid_until, sender_name)
  select f.company_id, v_party, v_po, s.side,
         case when p->>'kind' in ('invoice', 'waybill', 'price_list', 'certificate', 'catalog', 'quote', 'payment', 'contract', 'other') then p->>'kind' else 'other' end,
         left(coalesce(nullif(trim(p->>'title'), ''), p->>'file_name', 'Belge'), 200), p->>'file_path', left(p->>'file_name', 200), left(p->>'mime', 120),
         nullif(p->>'size', '')::int, nullif(left(trim(coalesce(p->>'note', '')), 500), ''), nullif(p->>'valid_until', '')::date, left(s.name, 120)
    from fin_parties f where f.id = v_party
  returning id into v_id;
  if s.side = 'supplier' then perform sup_notify_lab(v_party, 'Tedarikçi belge gönderdi', coalesce(p->>'title', p->>'file_name'), 'belge'); end if;
  return v_id;
end $$;
revoke execute on function sup_doc_add(jsonb) from public, anon;
grant execute on function sup_doc_add(jsonb) to authenticated;

create or replace function sup_doc_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d sup_documents;
begin
  select * into d from sup_documents where id = p_id;
  if d.id is null or not sup_can(d.party_id) then raise exception 'not_allowed'; end if;
  -- herkes yalnız kendi tarafının belgesini kaldırır
  if (d.side = 'supplier') <> sup_is_mine(d.party_id) then raise exception 'not_allowed'; end if;
  update sup_documents set removed = true where id = p_id;
end $$;
revoke execute on function sup_doc_remove(uuid) from public, anon;
grant execute on function sup_doc_remove(uuid) to authenticated;

-- Mesaj gönder
create or replace function sup_message_send(p_party uuid, p_body text, p_po uuid default null, p_doc uuid default null, p_via text[] default '{portal}') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; s record; v_po uuid := p_po;
begin
  if not sup_can(p_party) then raise exception 'not_allowed'; end if;
  if not sup_is_mine(p_party) and not (can_module('purchases', 2) or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'body_required'; end if;
  if v_po is not null and not exists (select 1 from pur_orders where id = v_po and party_id = p_party) then v_po := null; end if;
  select * into s from sup_sender(p_party);
  insert into sup_messages (company_id, party_id, po_id, side, sender_name, body, doc_id, via)
  select f.company_id, p_party, v_po, s.side, left(s.name, 120), left(trim(p_body), 4000),
         (select id from sup_documents where id = p_doc and party_id = p_party), coalesce(p_via, '{portal}')
    from fin_parties f where f.id = p_party
  returning id into v_id;
  if s.side = 'supplier' then perform sup_notify_lab(p_party, 'Tedarikçiden mesaj', left(trim(p_body), 200), 'mesaj'); end if;
  return v_id;
end $$;
revoke execute on function sup_message_send(uuid, text, uuid, uuid, text[]) from public, anon;
grant execute on function sup_message_send(uuid, text, uuid, uuid, text[]) to authenticated;

-- Karşı tarafın mesaj ve belgelerini okundu say
create or replace function sup_mark_read(p_party uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_side text;
begin
  if not sup_can(p_party) then return; end if;
  v_side := case when sup_is_mine(p_party) then 'lab' else 'supplier' end;   -- okunan: karşı tarafın gönderdikleri
  update sup_messages set read_at = now() where party_id = p_party and side = v_side and read_at is null;
  update sup_documents set seen_at = now() where party_id = p_party and side = v_side and seen_at is null;
end $$;
revoke execute on function sup_mark_read(uuid) from public, anon;
grant execute on function sup_mark_read(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Ürünlerim ve fiyat listeleri
-- ---------------------------------------------------------------------
create or replace function sup_products(p_party uuid) returns table (
  key text, item_id uuid, code text, name text, unit text, last_price bigint, currency text, last_date date, qty_12m numeric, times int, current_price bigint, current_currency text)
language plpgsql stable security definer set search_path = public as $$
declare v_twin uuid := sup_twin_of(p_party);
begin
  if not sup_can(p_party) then raise exception 'not_allowed'; end if;
  return query
  with src as (
    select l.item_id, l.name, l.unit, l.unit_price::bigint price, o.currency cur, o.order_date d, l.qty
      from pur_order_lines l join pur_orders o on o.id = l.order_id
     where o.party_id = p_party and o.status not in ('draft', 'pending', 'cancelled')
    union all
    select l.item_id, l.name, l.unit, round(l.unit_price * 100 * (100 - l.discount_pct) / 100)::bigint, i.currency, i.invoice_date, l.qty * case when i.type = 'return' then -1 else 1 end
      from inv_lines l join inv_invoices i on i.id = l.invoice_id
     where i.direction = 'purchase' and i.status <> 'cancelled' and i.party_id in (p_party, v_twin)
    union all
    select r.item_id, r.name, r.unit, r.unit_cost, 'TRY', (r2.created_at at time zone 'Europe/Istanbul')::date, r.qty - r.damaged
      from stk_receipt_lines r join stk_receipts r2 on r2.id = r.receipt_id
     where r2.party_id in (p_party, v_twin) and r2.status = 'confirmed' and r2.po_id is null and r.unit_cost is not null
  ), g as (
    select coalesce(s.item_id::text, lower(btrim(s.name))) k, s.* from src s
  ), agg as (
    select g.k, (array_agg(g.item_id) filter (where g.item_id is not null))[1] item_id,
           (array_agg(g.name order by g.d desc))[1] name, (array_agg(g.unit order by g.d desc))[1] unit,
           (array_agg(g.price order by g.d desc))[1] price, (array_agg(g.cur order by g.d desc))[1] cur, max(g.d) d,
           sum(g.qty) filter (where g.d >= current_date - 365) q12, count(*)::int n
      from g group by g.k
  )
  select a.k, a.item_id, i.code, coalesce(i.name, a.name), coalesce(i.unit, a.unit), a.price, a.cur, a.d, coalesce(a.q12, 0), a.n, i.purchase_price, i.purchase_currency
    from agg a left join stk_items i on i.id = a.item_id
  union all
  select i.id::text, i.id, i.code, i.name, i.unit, null::bigint, null::text, null::date, 0::numeric, 0, i.purchase_price, i.purchase_currency
    from stk_items i
   where i.supplier_party_id = p_party and i.is_active and not exists (select 1 from agg a where a.item_id = i.id)
  order by 8 desc nulls last, 4;
end $$;
revoke execute on function sup_products(uuid) from public, anon;
grant execute on function sup_products(uuid) to authenticated;

create table if not exists sup_price_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  valid_from date not null default current_date,
  note text check (note is null or length(note) <= 1000),
  doc_id uuid references sup_documents (id) on delete set null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'partial', 'rejected')),
  submitted_by uuid default auth.uid(),
  sender_name text,
  submitted_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500)
);
create table if not exists sup_price_lines (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references sup_price_lists (id) on delete cascade,
  sort int not null default 0,
  item_id uuid references stk_items (id) on delete set null,
  code text check (code is null or length(code) <= 60),
  name text not null check (length(name) between 1 and 300),
  unit text not null default 'adet' check (length(unit) <= 20),
  old_price bigint,
  old_currency text,
  new_price bigint not null check (new_price >= 0),
  approved boolean
);
create index if not exists sup_price_lists_party_idx on sup_price_lists (party_id, submitted_at desc);
create index if not exists sup_price_lines_list_idx on sup_price_lines (list_id, sort);
alter table sup_price_lists enable row level security;
alter table sup_price_lines enable row level security;
drop policy if exists sup_price_lists_read on sup_price_lists;
create policy sup_price_lists_read on sup_price_lists for select to authenticated using ((select sup_can(party_id)));
drop policy if exists sup_price_lines_read on sup_price_lines;
create policy sup_price_lines_read on sup_price_lines for select to authenticated using (exists (select 1 from sup_price_lists l where l.id = list_id));
revoke all on sup_price_lists, sup_price_lines from anon;
grant select on sup_price_lists, sup_price_lines to authenticated;

-- Tedarikçi fiyat listesi gönderir: {party_id, title, currency, valid_from, note, doc_id, lines:[{item_id, code, name, unit, old_price, old_currency, new_price}]}
create or replace function sup_price_submit(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_party uuid := (p->>'party_id')::uuid; v_id uuid; l jsonb; i int := 0; s record; v_cur text := coalesce(nullif(p->>'currency', ''), 'TRY');
begin
  if not sup_can(v_party) then raise exception 'not_allowed'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if v_cur not in ('TRY', 'EUR', 'USD', 'GBP', 'CHF') then v_cur := 'TRY'; end if;
  select * into s from sup_sender(v_party);
  insert into sup_price_lists (company_id, party_id, title, currency, valid_from, note, doc_id, sender_name)
  select f.company_id, v_party, left(coalesce(nullif(trim(p->>'title'), ''), 'Fiyat listesi ' || to_char(current_date, 'DD.MM.YYYY')), 160), v_cur,
         coalesce(nullif(p->>'valid_from', '')::date, current_date), nullif(left(trim(coalesce(p->>'note', '')), 1000), ''),
         (select id from sup_documents where id = nullif(p->>'doc_id', '')::uuid and party_id = v_party), left(s.name, 120)
    from fin_parties f where f.id = v_party
  returning id into v_id;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce(nullif(l->>'new_price', '')::bigint, -1) < 0 or coalesce(trim(l->>'name'), '') = '' then continue; end if;
    i := i + 1;
    insert into sup_price_lines (list_id, sort, item_id, code, name, unit, old_price, old_currency, new_price)
    values (v_id, i, (select id from stk_items where id = nullif(l->>'item_id', '')::uuid), nullif(left(l->>'code', 60), ''), left(trim(l->>'name'), 300),
            left(coalesce(nullif(l->>'unit', ''), 'adet'), 20), nullif(l->>'old_price', '')::bigint, nullif(l->>'old_currency', ''), (l->>'new_price')::bigint);
  end loop;
  if i = 0 then raise exception 'lines_required'; end if;
  if s.side = 'supplier' then perform sup_notify_lab(v_party, 'Yeni fiyat listesi', i || ' kalem · ' || v_cur, 'fiyat'); end if;
  return v_id;
end $$;
revoke execute on function sup_price_submit(jsonb) from public, anon;
grant execute on function sup_price_submit(jsonb) to authenticated;

-- Satın alma kararı: p_lines = onaylanan satırlar (null → hepsi). Onaylanan, stok kartına bağlı satırlarda alış fiyatı güncellenir.
create or replace function pur_price_decide(p_list uuid, p_lines uuid[], p_reject boolean default false, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare l sup_price_lists; n int := 0; v_ok int; v_all int;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into l from sup_price_lists where id = p_list and company_id = lab_company() for update;
  if l.id is null then raise exception 'not_found'; end if;
  if l.status <> 'submitted' then raise exception 'already_decided'; end if;
  if p_reject then
    update sup_price_lines set approved = false where list_id = p_list;
  else
    update sup_price_lines set approved = (p_lines is null or id = any (p_lines)) where list_id = p_list;
    update stk_items i set purchase_price = x.new_price, purchase_currency = l.currency, updated_at = now()
      from sup_price_lines x where x.list_id = p_list and x.approved and x.item_id = i.id;
    get diagnostics n = row_count;
  end if;
  select count(*) filter (where approved), count(*) into v_ok, v_all from sup_price_lines where list_id = p_list;
  update sup_price_lists set status = case when v_ok = 0 then 'rejected' when v_ok = v_all then 'approved' else 'partial' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_list;
  insert into sup_messages (company_id, party_id, side, sender_name, body)
  values (l.company_id, l.party_id, 'lab', 'Satın alma',
          case when v_ok = 0 then '"' || l.title || '" fiyat listeniz onaylanmadı.' when v_ok = v_all then '"' || l.title || '" fiyat listeniz onaylandı (' || v_all || ' kalem).'
               else '"' || l.title || '" fiyat listenizin ' || v_ok || '/' || v_all || ' kalemi onaylandı.' end
          || coalesce(' Not: ' || nullif(trim(p_note), ''), ''));
  return n;
end $$;
revoke execute on function pur_price_decide(uuid, uuid[], boolean, text) from public, anon;
grant execute on function pur_price_decide(uuid, uuid[], boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Tedarikçinin carisi: faturalı (resmi) / fişli (faturasız). Tedarikçi gözüyle: (+) alacağınız
-- ---------------------------------------------------------------------
create or replace function sup_portal_ledger(p_party uuid, p_book text default 'invoice', p_from date default null)
returns table (at date, kind text, doc text, description text, owed bigint, paid bigint, balance bigint, currency text)
language plpgsql stable security definer set search_path = public as $$
declare v_p fin_parties; v_id uuid; v_open bigint; v_prev bigint;
begin
  if not sup_can(p_party) then raise exception 'not_allowed'; end if;
  select * into v_p from fin_parties where id = p_party;
  if sup_is_mine(p_party) and not v_p.portal_show_ledger then raise exception 'ledger_hidden'; end if;
  if p_book = 'slip' then
    if sup_is_mine(p_party) and not v_p.portal_show_slip then raise exception 'ledger_hidden'; end if;
    v_id := sup_twin_of(p_party);
    if v_id is null then return; end if;
  else
    v_id := p_party;
  end if;
  select opening_balance into v_open from fin_parties where id = v_id;
  -- dönem başına kadar devir
  select coalesce(sum(m.amount), 0) into v_prev from fin_moves m join fin_txns t on t.id = m.txn_id
   where m.party_id = v_id and t.voided_at is null and p_from is not null and t.txn_date < p_from;
  return query
  with mv as (
    select t.txn_date d, t.created_at c,
           case when t.kind in ('purchase_invoice', 'purchase_slip') then 'Fatura' when t.kind = 'purchase_return' then 'İade'
                when t.kind = 'opening' then 'Devir' when t.kind in ('cheque_out', 'cheque_endorse') then 'Çek / senet'
                when t.kind = 'payment' then 'Ödeme' when t.kind in ('sale_invoice', 'sale_return') then 'Satış faturası' else 'Hareket' end k,
           t.doc_no doc,
           case when t.kind = 'purchase_slip' then coalesce(nullif(t.description, ''), 'Fiş')
                when t.ref_type = 'mirror' then 'Ödeme'
                else coalesce(nullif(t.description, ''), '') end descr,
           m.amount a
      from fin_moves m join fin_txns t on t.id = m.txn_id
     where m.party_id = v_id and t.voided_at is null and (p_from is null or t.txn_date >= p_from)
  )
  select null::date, 'Devir', null::text, case when p_from is null then 'Açılış bakiyesi' else 'Önceki dönemden devir' end,
         greatest(-(v_open + v_prev), 0)::bigint, greatest(v_open + v_prev, 0)::bigint, (-(v_open + v_prev))::bigint, v_p.currency
   where v_open + v_prev <> 0
  union all
  select mv.d, case when mv.k = 'Fatura' and p_book = 'slip' then 'Fiş' else mv.k end, mv.doc, mv.descr,
         greatest(-mv.a, 0)::bigint, greatest(mv.a, 0)::bigint,
         (-(v_open + v_prev + sum(mv.a) over (order by mv.d, mv.c rows unbounded preceding)))::bigint, v_p.currency
    from mv
  order by 1 nulls first;
end $$;
revoke execute on function sup_portal_ledger(uuid, text, date) from public, anon;
grant execute on function sup_portal_ledger(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- Ödeme planı ve takvimi
-- ---------------------------------------------------------------------
alter table pur_settings add column if not exists pay_remind_days int not null default 3;
alter table pur_settings add column if not exists remind_supplier boolean not null default false;

create table if not exists fin_payment_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  due_date date not null,
  amount bigint not null check (amount > 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  method text not null default 'transfer' check (method in ('transfer', 'cash', 'cheque', 'note', 'card', 'other')),
  note text check (note is null or length(note) <= 300),
  status text not null default 'planned' check (status in ('planned', 'paid', 'cancelled')),
  remind_days int not null default 3 check (remind_days between 0 and 60),
  notify_supplier boolean not null default false,
  show_supplier boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists fin_payment_plans_due_idx on fin_payment_plans (company_id, status, due_date);
alter table fin_payment_plans enable row level security;
drop policy if exists fin_payment_plans_read on fin_payment_plans;
create policy fin_payment_plans_read on fin_payment_plans for select to authenticated
  using (((select can_module('finance')) or (select can_module('purchases'))) and company_id = (select lab_company()) or (show_supplier and (select sup_is_mine(party_id))));
revoke all on fin_payment_plans from anon;
grant select on fin_payment_plans to authenticated;

create table if not exists fin_pay_reminders (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table fin_pay_reminders enable row level security;
revoke all on fin_pay_reminders from anon, authenticated;

create or replace function pay_plan_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_party uuid := (p->>'party_id')::uuid;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_parties where id = v_party and company_id = lab_company()) then raise exception 'party_required'; end if;
  -- fişli cari seçildiyse asıl cariye bağlanır (takvim firma bazında)
  v_party := coalesce((select slip_of from fin_parties where id = v_party), v_party);
  if coalesce(nullif(p->>'amount', '')::bigint, 0) <= 0 then raise exception 'amount_required'; end if;
  if v_id is null then
    insert into fin_payment_plans (party_id, due_date, amount, currency, method, note, remind_days, notify_supplier, show_supplier)
    values (v_party, (p->>'due_date')::date, (p->>'amount')::bigint, coalesce(nullif(p->>'currency', ''), 'TRY'), coalesce(nullif(p->>'method', ''), 'transfer'),
            nullif(left(trim(coalesce(p->>'note', '')), 300), ''), coalesce(nullif(p->>'remind_days', '')::int, 3),
            coalesce((p->>'notify_supplier')::boolean, false), coalesce((p->>'show_supplier')::boolean, true))
    returning id into v_id;
  else
    update fin_payment_plans set party_id = v_party, due_date = (p->>'due_date')::date, amount = (p->>'amount')::bigint, currency = coalesce(nullif(p->>'currency', ''), 'TRY'),
           method = coalesce(nullif(p->>'method', ''), 'transfer'), note = nullif(left(trim(coalesce(p->>'note', '')), 300), ''), remind_days = coalesce(nullif(p->>'remind_days', '')::int, 3),
           notify_supplier = coalesce((p->>'notify_supplier')::boolean, false), show_supplier = coalesce((p->>'show_supplier')::boolean, true)
     where id = v_id and company_id = lab_company() and status = 'planned';
  end if;
  return v_id;
end $$;
revoke execute on function pay_plan_save(jsonb) from public, anon;
grant execute on function pay_plan_save(jsonb) to authenticated;

create or replace function pay_plan_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  if p_status not in ('planned', 'paid', 'cancelled') then raise exception 'bad_status'; end if;
  update fin_payment_plans set status = p_status, paid_at = case when p_status = 'paid' then now() end where id = p_id and company_id = lab_company();
end $$;
revoke execute on function pay_plan_status(uuid, text) from public, anon;
grant execute on function pay_plan_status(uuid, text) to authenticated;

-- Takvim kalemleri (izin denetimi yok: çağıranlar denetler)
--  invoice: işlenmiş alış faturasının açık kısmı (ödemeler en eski faturadan düşülür), vade = fatura vadesi ya da tarih + cari vade günü
--  cheque / note: verdiğimiz, henüz ödenmemiş çek / senet
--  plan: planlanan ödeme
create or replace function pay_items_raw(p_party uuid default null) returns table (
  kind text, ref uuid, party_id uuid, party text, due_date date, amount bigint, currency text, doc text, note text, method text, remind_days int, notify_supplier boolean, show_supplier boolean)
language sql stable security definer set search_path = public as $$
  with parties as (
    select p.id main, p.name, p.currency, p.payment_term_days, p.opening_balance,
           (select t.id from fin_parties t where t.slip_of = p.id limit 1) twin
      from fin_parties p
     where p.company_id = lab_company() and p.slip_of is null and (p_party is null or p.id = p_party)
  ), owed as (
    select x.main, -(x.opening_balance + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = x.main and t.voided_at is null), 0)) owed
      from parties x
  ), inv as (
    select x.main, i.id, i.doc_no, i.invoice_date, coalesce(i.due_date, i.invoice_date + x.payment_term_days) due, x.currency,
           coalesce((select -sum(m.amount) from fin_moves m where m.txn_id = i.fin_txn_id and m.party_id = x.main), 0) t
      from parties x join inv_invoices i on i.party_id = x.main
     where i.direction = 'purchase' and i.type = 'invoice' and i.status = 'posted' and i.fin_txn_id is not null
  ), inv2 as (
    select inv.*, coalesce(sum(inv.t) over (partition by inv.main order by inv.invoice_date desc, inv.id desc rows between unbounded preceding and 1 preceding), 0) newer
      from inv
  )
  select 'invoice', v.id, v.main, x.name, v.due, greatest(0, least(v.t, o.owed - v.newer))::bigint, v.currency, v.doc_no, null::text, null::text, null::int, null::boolean, true
    from inv2 v join owed o on o.main = v.main join parties x on x.main = v.main
   where o.owed - v.newer > 0 and v.t > 0
  union all
  select case when c.doc_type = 'note' then 'note' else 'cheque' end, c.id, x.main, x.name, c.due_date, c.amount, c.currency,
         nullif(concat_ws(' · ', c.serial_no, c.bank_name), ''), c.note, null, null, null, true
    from fin_cheques c join parties x on c.party_id in (x.main, x.twin)
   where c.direction = 'out' and c.status = 'issued'
  union all
  select 'plan', pl.id, x.main, x.name, pl.due_date, pl.amount, pl.currency, null, pl.note, pl.method, pl.remind_days, pl.notify_supplier, pl.show_supplier
    from fin_payment_plans pl join parties x on x.main = pl.party_id
   where pl.status = 'planned';
$$;
revoke execute on function pay_items_raw(uuid) from public, anon, authenticated;

create or replace function pay_calendar(p_from date, p_to date, p_party uuid default null) returns table (
  kind text, ref uuid, party_id uuid, party text, due_date date, amount bigint, currency text, doc text, note text, method text, overdue boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_supplier boolean;
begin
  if p_party is null then
    if not (can_module('finance') or can_module('purchases')) then raise exception 'not_allowed'; end if;
  elsif not sup_can(p_party) then raise exception 'not_allowed';
  end if;
  v_supplier := p_party is not null and sup_is_mine(p_party);
  if v_supplier and not (select portal_show_ledger from fin_parties where id = p_party) then raise exception 'ledger_hidden'; end if;
  return query
  select r.kind, r.ref, r.party_id, r.party, r.due_date, r.amount, r.currency, r.doc, r.note, r.method, r.due_date < current_date
    from pay_items_raw(p_party) r
   where r.amount > 0 and (r.due_date between p_from and p_to or (r.due_date < p_from and p_from <= current_date))
     and (not v_supplier or r.show_supplier)
   order by r.due_date, r.party;
end $$;
revoke execute on function pay_calendar(date, date, uuid) from public, anon;
grant execute on function pay_calendar(date, date, uuid) to authenticated;

-- Günlük hatırlatma (yalnız zamanlanmış görev / service role): bildirimleri yazar, tedarikçiye gidecekleri döndürür
create or replace function pay_reminders_run(p_today date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; c uuid := lab_company(); v_days int; v_sup boolean; v_key text; v_out jsonb := '[]'; v_n int := 0; v_lbl text;
begin
  select coalesce(max(pay_remind_days), 3), coalesce(bool_or(remind_supplier), false) into v_days, v_sup from pur_settings where company_id = c;
  for r in select * from pay_items_raw(null) x where x.amount > 0 and x.due_date between p_today and p_today + 60 loop
    v_key := r.kind || ':' || r.ref || ':' || r.due_date || ':' || case when r.due_date = p_today then 'day' else 'pre' end;
    if r.due_date <> p_today and r.due_date <> p_today + coalesce(r.remind_days, v_days) then continue; end if;
    if exists (select 1 from fin_pay_reminders where key = v_key) then continue; end if;
    insert into fin_pay_reminders (key) values (v_key);
    v_lbl := case r.kind when 'invoice' then 'Fatura vadesi' when 'cheque' then 'Çek ödemesi' when 'note' then 'Senet ödemesi' else 'Planlı ödeme' end;
    perform deliver(c, (select array_agg(distinct u) from unnest(module_recipients_for(c, 'finance', 1) || module_recipients_for(c, 'purchases', 2)) u),
      case when r.due_date = p_today then '⏰ Bugün: ' else '🔔 ' || (r.due_date - p_today) || ' gün sonra: ' end || v_lbl,
      r.party || ' · ' || to_char(r.amount / 100.0, 'FM999G999G990D00') || ' ' || r.currency || coalesce(' · ' || r.doc, '') || ' · vade ' || to_char(r.due_date, 'DD.MM.YYYY'),
      '/satinalma/odeme-takvimi?ay=' || to_char(r.due_date, 'YYYY-MM'));
    v_n := v_n + 1;
    if (r.kind = 'plan' and r.notify_supplier) or (r.kind <> 'plan' and v_sup and r.kind in ('cheque', 'note')) then
      v_out := v_out || jsonb_build_object('party_id', r.party_id, 'party', r.party, 'kind', r.kind, 'label', v_lbl, 'due_date', r.due_date, 'amount', r.amount, 'currency', r.currency, 'doc', r.doc, 'today', r.due_date = p_today);
    end if;
  end loop;
  return jsonb_build_object('notified', v_n, 'supplier', v_out);
end $$;
revoke execute on function pay_reminders_run(date) from public, anon, authenticated;
grant execute on function pay_reminders_run(date) to service_role;

create or replace function pay_settings_save(p_days int, p_supplier boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('purchases', 3) or can_module('finance', 3)) then raise exception 'not_allowed'; end if;
  insert into pur_settings (company_id, pay_remind_days, remind_supplier, updated_at) values (lab_company(), least(greatest(coalesce(p_days, 3), 0), 30), coalesce(p_supplier, false), now())
  on conflict (company_id) do update set pay_remind_days = excluded.pay_remind_days, remind_supplier = excluded.remind_supplier, updated_at = now();
end $$;
revoke execute on function pay_settings_save(int, boolean) from public, anon;
grant execute on function pay_settings_save(int, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Özetler
-- ---------------------------------------------------------------------
create or replace function sup_party_balances(p_party uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'invoice', -(p.opening_balance + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null), 0)),
    'slip', (select -(t2.opening_balance + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = t2.id and t.voided_at is null), 0)) from fin_parties t2 where t2.slip_of = p.id limit 1),
    'currency', p.currency)
  from fin_parties p where p.id = p_party;
$$;
revoke execute on function sup_party_balances(uuid) from public, anon, authenticated;

-- Tedarikçi ana sayfası (tedarikçi gözüyle: (+) alacağınız)
create or replace function sup_home(p_party uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p fin_parties; v_mine boolean; v_side text;
begin
  if not sup_can(p_party) then raise exception 'not_allowed'; end if;
  select * into p from fin_parties where id = p_party;
  v_mine := sup_is_mine(p_party);
  v_side := case when v_mine then 'lab' else 'supplier' end;
  return jsonb_build_object(
    'name', p.name, 'show_ledger', p.portal_show_ledger, 'show_slip', p.portal_show_slip, 'has_slip', exists (select 1 from fin_parties where slip_of = p.id),
    'orders_new', (select count(*) from pur_orders o where o.party_id = p_party and o.status in ('approved', 'sent') and o.sup_ack_at is null and o.sup_declined_at is null),
    'orders_open', (select count(*) from pur_orders o where o.party_id = p_party and o.status in ('approved', 'sent', 'partial')),
    'orders_late', (select count(*) from pur_orders o where o.party_id = p_party and o.status in ('sent', 'partial') and coalesce(o.sup_promised_date, o.expected_date) < current_date),
    'unread', (select count(*) from sup_messages m where m.party_id = p_party and m.side = v_side and m.read_at is null),
    'docs_new', (select count(*) from sup_documents d where d.party_id = p_party and d.side = v_side and d.seen_at is null and not d.removed),
    'prices_pending', (select count(*) from sup_price_lists l where l.party_id = p_party and l.status = 'submitted'),
    'year_total', (select coalesce(sum(o.total_try), 0) from pur_orders o where o.party_id = p_party and o.status not in ('draft', 'pending', 'cancelled') and o.order_date >= date_trunc('year', current_date)),
    'balances', case when v_mine and not p.portal_show_ledger then null
                     when v_mine and not p.portal_show_slip then sup_party_balances(p_party) - 'slip'
                     else sup_party_balances(p_party) end,
    'next_pay', case when v_mine and not p.portal_show_ledger then '[]'::jsonb else
      (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'due_date', r.due_date, 'amount', r.amount, 'currency', r.currency, 'doc', r.doc) order by r.due_date), '[]')
         from (select * from pay_items_raw(p_party) x where x.amount > 0 and (not v_mine or x.show_supplier) order by x.due_date limit 5) r) end,
    'monthly', (select jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'), 't', (select coalesce(sum(o.total_try), 0) from pur_orders o where o.party_id = p_party and o.status not in ('draft', 'pending', 'cancelled') and date_trunc('month', o.order_date) = m)) order by m)
                  from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m)
  );
end $$;
revoke execute on function sup_home(uuid) from public, anon;
grant execute on function sup_home(uuid) to authenticated;

-- ERP: tedarikçi merkezi listesi
create or replace function sup_center() returns table (
  party_id uuid, name text, phone text, email text, portal_users int, last_seen timestamptz, unread int, docs_new int, prices_pending int,
  orders_open int, orders_unseen int, invoice_balance bigint, slip_balance bigint, currency text, next_due date, next_amount bigint, last_order date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  return query
  with sp as (
    select p.* from fin_parties p
     where p.company_id = lab_company() and p.slip_of is null and p.is_active and p.kind in ('supplier', 'both')
       and (exists (select 1 from pur_orders o where o.party_id = p.id) or exists (select 1 from sup_portal_users u where u.party_id = p.id)
            or exists (select 1 from inv_invoices i where i.party_id = p.id and i.direction = 'purchase') or exists (select 1 from fin_parties t where t.slip_of = p.id))
  ), nx as (
    select r.party_id, min(r.due_date) d from pay_items_raw(null) r where r.amount > 0 group by r.party_id
  )
  select sp.id, sp.name, coalesce(sp.order_phone, sp.phone), coalesce(sp.order_email, sp.email),
         (select count(*)::int from sup_portal_users u where u.party_id = sp.id and u.is_active),
         (select max(u.last_seen_at) from sup_portal_users u where u.party_id = sp.id),
         (select count(*)::int from sup_messages m where m.party_id = sp.id and m.side = 'supplier' and m.read_at is null),
         (select count(*)::int from sup_documents d where d.party_id = sp.id and d.side = 'supplier' and d.seen_at is null and not d.removed),
         (select count(*)::int from sup_price_lists l where l.party_id = sp.id and l.status = 'submitted'),
         (select count(*)::int from pur_orders o where o.party_id = sp.id and o.status in ('approved', 'sent', 'partial')),
         (select count(*)::int from pur_orders o where o.party_id = sp.id and o.status in ('approved', 'sent') and o.sup_seen_at is null),
         (sup_party_balances(sp.id)->>'invoice')::bigint, (sup_party_balances(sp.id)->>'slip')::bigint, sp.currency,
         nx.d, (select sum(r.amount)::bigint from pay_items_raw(sp.id) r where r.due_date = nx.d),
         (select max(o.order_date) from pur_orders o where o.party_id = sp.id)
    from sp left join nx on nx.party_id = sp.id
   order by (select count(*) from sup_messages m where m.party_id = sp.id and m.side = 'supplier' and m.read_at is null) desc, nx.d nulls last, sp.name;
end $$;
revoke execute on function sup_center() from public, anon;
grant execute on function sup_center() to authenticated;

create or replace function sup_portal_settings_save(p_party uuid, p_ledger boolean, p_slip boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 3) and not can_module('finance', 3) then raise exception 'not_allowed'; end if;
  update fin_parties set portal_show_ledger = coalesce(p_ledger, true), portal_show_slip = coalesce(p_slip, true) where id = p_party and company_id = lab_company();
end $$;
revoke execute on function sup_portal_settings_save(uuid, boolean, boolean) from public, anon;
grant execute on function sup_portal_settings_save(uuid, boolean, boolean) to authenticated;

-- Tedarikçi kendi carisinin siparişlerini, satırlarını görür (sipariş listesi policy'si 20270119'da)
drop policy if exists pur_order_lines_supplier on pur_order_lines;
create policy pur_order_lines_supplier on pur_order_lines for select to authenticated
  using (exists (select 1 from pur_orders o where o.id = order_id and o.party_id in (select sup_my_parties()) and o.status in ('approved', 'sent', 'partial', 'received', 'invoiced')));

-- ---------------------------------------------------------------------
-- Faturasız siparişler eşleştirme / bütçe / panelde ayrı ele alınır (3. aşama fonksiyonlarının güncel hali)
-- ---------------------------------------------------------------------
create or replace function pur_budget_rows(p_year int) returns table (category_id uuid, month int, actual bigint, committed bigint)
language sql stable security definer set search_path = public as $$
  with a0 as (
    select coalesce(li.category_id,
             fin_category(case when si.kind is not null and si.kind <> 'service' then 'stock' when si.kind = 'service' then 'exp_other' else 'exp_material' end)) cat,
           extract(month from i.invoice_date)::int m,
           sum(round(li.net * i.rate) * case when i.type = 'return' then -1 else 1 end)::bigint v
      from inv_invoices i join inv_lines li on li.invoice_id = i.id left join stk_items si on si.id = li.item_id
     where i.company_id = lab_company() and i.direction = 'purchase' and i.status = 'posted' and extract(year from i.invoice_date)::int = p_year
     group by 1, 2
    union all
    select pur_po_category(o.id), extract(month from o.order_date)::int, sum(pur_po_net_try(o))::bigint
      from pur_orders o
     where o.company_id = lab_company() and o.billing = 'slip' and o.status = 'received' and extract(year from o.order_date)::int = p_year
     group by 1, 2
  ), a as (
    select a0.cat, a0.m, sum(a0.v)::bigint v from a0 group by 1, 2
  ), c as (
    select pur_po_category(o.id) cat, extract(month from o.order_date)::int m, sum(pur_po_net_try(o))::bigint v
      from pur_orders o
     where o.company_id = lab_company() and o.status in ('approved', 'sent', 'partial', 'received') and extract(year from o.order_date)::int = p_year
       and not (o.billing = 'slip' and o.status = 'received')
       and not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status <> 'cancelled')
       and not (o.closed_short and not exists (select 1 from pur_order_lines l where l.order_id = o.id and l.received_qty > 0))
     group by 1, 2
  )
  select coalesce(a.cat, c.cat), coalesce(a.m, c.m), coalesce(a.v, 0), coalesce(c.v, 0)
    from a full join c on c.cat = a.cat and c.m = a.m
   where coalesce(a.cat, c.cat) is not null;
$$;
revoke execute on function pur_budget_rows(int) from public, anon, authenticated;

create or replace function pur_match_list(p_days int default 180) returns table (
  po_id uuid, year int, no int, party_id uuid, party text, order_date date, status text, currency text,
  ordered bigint, received bigint, invoiced bigint, diff bigint, invoices int, issues int, match text, ok_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  return query
  with o as (
    select x.* from pur_orders x
     where x.company_id = lab_company() and x.billing <> 'slip' and x.status in ('approved', 'sent', 'partial', 'received', 'invoiced')
       and (x.order_date >= current_date - greatest(coalesce(p_days, 180), 1) or x.status in ('sent', 'partial', 'received')
            or exists (select 1 from inv_invoices i where i.po_id = x.id and i.status <> 'cancelled' and i.invoice_date >= current_date - greatest(coalesce(p_days, 180), 1)))
  ), s as (
    select o.id,
           sum(round(m.ordered * m.po_price))::bigint ord,
           sum(round(m.basis * m.po_price))::bigint rcv,
           sum(m.inv_amount)::bigint inv,
           count(*) filter (where m.status in ('over_billed', 'price_up', 'extra'))::int iss,
           count(*) filter (where m.status in ('partial', 'not_invoiced'))::int part,
           count(*) filter (where m.status = 'waiting')::int wait
      from o cross join lateral pur_match_lines(o.id) m group by o.id
  ), n as (
    select i.po_id, count(*)::int c from inv_invoices i join o on o.id = i.po_id where i.status <> 'cancelled' group by i.po_id
  )
  select o.id, o.year, o.no, o.party_id, p.name, o.order_date, o.status, o.currency,
         coalesce(s.ord, 0), coalesce(s.rcv, 0), coalesce(s.inv, 0), coalesce(s.inv, 0) - coalesce(s.rcv, 0), coalesce(n.c, 0), coalesce(s.iss, 0),
         case when coalesce(n.c, 0) = 0 then 'waiting'
              when coalesce(s.iss, 0) > 0 and o.match_ok_at is not null and abs((coalesce(s.inv, 0) - coalesce(s.rcv, 0)) - coalesce(o.match_ok_diff, 0)) <= 100 then 'accepted'
              when coalesce(s.iss, 0) > 0 then 'diff'
              when coalesce(s.part, 0) > 0 or coalesce(s.wait, 0) > 0 then 'partial'
              else 'ok' end,
         o.match_ok_note
    from o join fin_parties p on p.id = o.party_id left join s on s.id = o.id left join n on n.po_id = o.id
   order by o.order_date desc, o.no desc;
end $$;
revoke execute on function pur_match_list(int) from public, anon;
grant execute on function pur_match_list(int) to authenticated;

create or replace function pur_unlinked_invoices(p_days int default 120) returns table (
  invoice_id uuid, doc_no text, invoice_date date, party_id uuid, party text, total bigint, currency text, status text, candidates jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  return query
  select i.id, i.doc_no, i.invoice_date, i.party_id, coalesce(p.name, i.party_name), i.total, i.currency, i.status, c.j
    from inv_invoices i
    left join fin_parties p on p.id = i.party_id
    cross join lateral (
      select jsonb_agg(jsonb_build_object('id', o.id, 'no', 'SA-' || o.year || '-' || lpad(o.no::text, 4, '0'), 'total', o.total, 'currency', o.currency,
                                          'date', o.order_date, 'status', o.status, 'has_invoice', exists (select 1 from inv_invoices x where x.po_id = o.id and x.status <> 'cancelled'))
                       order by (exists (select 1 from inv_invoices x where x.po_id = o.id and x.status <> 'cancelled')), abs(o.total - i.total) * case when o.currency = i.currency then 1 else 1000 end) j
        from (select * from pur_orders o2
               where o2.party_id = i.party_id and o2.company_id = i.company_id and o2.billing <> 'slip' and o2.status in ('approved', 'sent', 'partial', 'received', 'invoiced')
                 and o2.order_date <= i.invoice_date + 7 and o2.order_date >= i.invoice_date - 180
               order by o2.order_date desc limit 8) o
    ) c
   where i.company_id = lab_company() and i.direction = 'purchase' and i.type = 'invoice' and i.status <> 'cancelled' and i.po_id is null
     and i.invoice_date >= current_date - greatest(coalesce(p_days, 120), 1) and c.j is not null
   order by i.invoice_date desc;
end $$;
revoke execute on function pur_unlinked_invoices(int) from public, anon;
grant execute on function pur_unlinked_invoices(int) to authenticated;

create or replace function pur_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); d date := (now() at time zone 'Europe/Istanbul')::date; r jsonb; v_extra jsonb := '{}'::jsonb;
begin
  if not (can_module('purchases') or can_module('stock')) then raise exception 'not_allowed'; end if;
  select jsonb_build_object(
    'req_waiting', (select count(*) from stk_requests where company_id = c and status = 'purchase'),
    'lines_to_order', (select count(*) from stk_request_lines l join stk_requests q on q.id = l.request_id where q.company_id = c and q.status in ('approved') and l.to_purchase and l.po_id is null and l.buy_list_id is null),
    'po_draft', (select count(*) from pur_orders where company_id = c and status = 'draft'),
    'po_pending', (select count(*) from pur_orders where company_id = c and status = 'pending'),
    'po_unsent', (select count(*) from pur_orders where company_id = c and status = 'approved'),
    'po_open', (select count(*) from pur_orders where company_id = c and status in ('sent', 'partial')),
    'po_late', (select count(*) from pur_orders where company_id = c and status in ('sent', 'partial') and expected_date < d),
    'po_noinvoice', (select count(*) from pur_orders where company_id = c and status = 'received' and invoice_id is null and billing <> 'slip'),
    'month_total', (select coalesce(sum(total_try), 0) from pur_orders where company_id = c and status not in ('draft', 'cancelled') and order_date >= date_trunc('month', d)::date),
    'prev_total', (select coalesce(sum(total_try), 0) from pur_orders where company_id = c and status not in ('draft', 'cancelled') and order_date >= (date_trunc('month', d) - interval '1 month')::date and order_date < date_trunc('month', d)::date),
    'top_suppliers', (select coalesce(jsonb_agg(x order by x->>'total' desc), '[]') from (
        select jsonb_build_object('name', p.name, 'total', sum(o.total_try), 'n', count(*)) x from pur_orders o join fin_parties p on p.id = o.party_id
         where o.company_id = c and o.status not in ('draft', 'cancelled') and o.order_date >= (d - 90) group by p.name order by sum(o.total_try) desc limit 6) t)
  ) into r;
  if can_module('purchases') or can_module('finance') then
    select jsonb_build_object(
      'match_diff', (select count(*) from pur_match_list(120) m where m.match = 'diff'),
      'inv_unlinked', (select count(*) from pur_unlinked_invoices(90)),
      'budget', (select jsonb_build_object('budget', coalesce(sum(b.amount), 0)) from pur_budgets b where b.company_id = c and b.year = extract(year from d)::int and b.month = extract(month from d)::int),
      'budget_used', (select jsonb_build_object('actual', coalesce(sum(u.actual), 0), 'committed', coalesce(sum(u.committed), 0))
                        from pur_budget_rows(extract(year from d)::int) u where u.month = extract(month from d)::int
                         and u.category_id in (select b.category_id from pur_budgets b where b.company_id = c and b.year = extract(year from d)::int and b.month = extract(month from d)::int)),
      'budget_over', (select count(*) from (select b.category_id from pur_budgets b
                        left join pur_budget_rows(extract(year from d)::int) u on u.category_id = b.category_id and u.month = b.month
                        where b.company_id = c and b.year = extract(year from d)::int and b.month = extract(month from d)::int and coalesce(u.actual, 0) + coalesce(u.committed, 0) > b.amount) z)
    ) into v_extra;
  end if;
  return r || v_extra;
end $$;
revoke execute on function pur_dashboard() from public, anon;
grant execute on function pur_dashboard() to authenticated;

notify pgrst, 'reload schema';
