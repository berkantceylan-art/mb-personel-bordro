-- =====================================================================
-- Finans 2: çek / senet, kredi kartı taksitleri, krediler (ödeme planı), avans ve ortak hesapları
--  fin_conv()              : döviz çevirme (o günün TCMB kuruyla)
--  fin_system_account()    : çek portföyü gibi sistem hesaplarını bul / aç
--  fin_cheques + events    : alınan / verilen çek ve senet; tahsil, ciro, karşılıksız, iade, ödeme, geri alma
--  fin_card_installments   : kartla taksitli harcama → ekstre tahmini
--  fin_loans + installments: kredi kullanımı, taksit ödemesi (anapara / faiz / BSMV ayrımı)
--  fin_advance_account()   : personel iş avansı hesabı
-- Tekrar çalıştırılabilir. Önce 20261202000000_finance_core.sql, 20261203000000_stock.sql.
-- =====================================================================

create or replace function fin_conv(p_amount bigint, p_from text, p_to text, p_date date default current_date) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare a numeric; b numeric;
begin
  if p_amount is null then return null; end if;
  if p_from = p_to then return p_amount; end if;
  a := case when p_from = 'TRY' then 1 else fx_rate(p_from, p_date) end;
  b := case when p_to = 'TRY' then 1 else fx_rate(p_to, p_date) end;
  if a is null then raise exception 'rate_missing:%', p_from; end if;
  if b is null then raise exception 'rate_missing:%', p_to; end if;
  return round(p_amount * a / b);
end $$;
grant execute on function fin_conv(bigint, text, text, date) to authenticated;

create or replace function fin_rate(p_cur text, p_date date default current_date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare r numeric;
begin
  if p_cur = 'TRY' then return 1; end if;
  r := fx_rate(p_cur, p_date);
  if r is null then raise exception 'rate_missing:%', p_cur; end if;
  return r;
end $$;
grant execute on function fin_rate(text, date) to authenticated;

create or replace function fin_system_account(p_kind text, p_currency text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from fin_accounts where company_id = lab_company() and kind = p_kind and currency = p_currency and is_active order by created_at limit 1;
  if v is null then
    insert into fin_accounts (kind, name, currency, sort)
    values (p_kind, case p_kind when 'cheque_in' then 'Alınan çek / senet portföyü' when 'cheque_out' then 'Verilen çek / senetler' else p_kind end || ' (' || p_currency || ')', p_currency, 90)
    returning id into v;
  end if;
  return v;
end $$;
revoke execute on function fin_system_account(text, text) from public, anon, authenticated;

-- iç: işlemi iptal et (finans iptali + bağlı hekim tahsilatı silinir)
create or replace function fin_void_sys(p_txn uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t fin_txns;
begin
  if p_txn is null then return; end if;
  select * into t from fin_txns where id = p_txn for update;
  if t.id is null or t.voided_at is not null then return; end if;
  update fin_txns set voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(p_reason, ''), 300) where id = p_txn;
  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;
end $$;
revoke execute on function fin_void_sys(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Çek / senet
-- ---------------------------------------------------------------------
create table if not exists fin_cheques (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  direction text not null check (direction in ('in', 'out')),
  doc_type text not null default 'cheque' check (doc_type in ('cheque', 'note')),
  serial_no text check (serial_no is null or length(serial_no) <= 40),
  bank_name text check (bank_name is null or length(bank_name) <= 80),
  branch text check (branch is null or length(branch) <= 80),
  account_no text check (account_no is null or length(account_no) <= 40),
  drawer text check (drawer is null or length(drawer) <= 160),          -- keşideci / borçlu
  drawer_tax_no text check (drawer_tax_no is null or length(drawer_tax_no) <= 11),
  amount bigint not null check (amount > 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  issue_date date,
  due_date date not null,
  party_id uuid not null references fin_parties (id) on delete restrict,
  status text not null check (status in ('portfolio', 'deposited', 'collected', 'endorsed', 'bounced', 'returned', 'issued', 'paid', 'cancelled')),
  bank_account_id uuid references fin_accounts (id) on delete set null,
  endorsed_party_id uuid references fin_parties (id) on delete set null,
  receive_txn_id uuid references fin_txns (id) on delete set null,
  image_path text check (image_path is null or length(image_path) <= 300),
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_cheques_due_idx on fin_cheques (direction, status, due_date);
create index if not exists fin_cheques_party_idx on fin_cheques (party_id);

create table if not exists fin_cheque_events (
  id bigint generated by default as identity primary key,
  cheque_id uuid not null references fin_cheques (id) on delete cascade,
  event_date date not null default current_date,
  action text not null check (action in ('received', 'issued', 'deposit', 'collect', 'endorse', 'bounce', 'return', 'pay', 'cancel')),
  prev_status text, new_status text,
  txn_id uuid references fin_txns (id) on delete set null,
  party_id uuid references fin_parties (id) on delete set null,
  account_id uuid references fin_accounts (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fin_cheque_events_idx on fin_cheque_events (cheque_id, id);

drop trigger if exists fin_cheques_touch on fin_cheques;
create trigger fin_cheques_touch before update on fin_cheques for each row execute function lab_touch();
drop trigger if exists audit_fin_cheques on fin_cheques;
create trigger audit_fin_cheques after insert or update or delete on fin_cheques for each row execute function audit_trigger();
alter table fin_cheques enable row level security;
alter table fin_cheque_events enable row level security;
drop policy if exists fin_cheques_read on fin_cheques;
create policy fin_cheques_read on fin_cheques for select to authenticated using (can_module('finance'));
drop policy if exists fin_cheque_events_read on fin_cheque_events;
create policy fin_cheque_events_read on fin_cheque_events for select to authenticated using (can_module('finance'));
grant select on fin_cheques, fin_cheque_events to authenticated;

create or replace function fin_cheque_label(c fin_cheques) returns text language sql immutable as $$
  select (case when c.doc_type = 'note' then 'Senet' else 'Çek' end) || coalesce(' #' || c.serial_no, '') || coalesce(' · ' || c.drawer, '') || ' · vade ' || to_char(c.due_date, 'DD.MM.YYYY');
$$;

-- hekim kartına bağlı cariden alınan çek: hekim ekstresine de tahsilat (yöntem: çek)
create or replace function fin_cheque_labpay(c fin_cheques, p_txn uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare pt fin_parties; v uuid;
begin
  select * into pt from fin_parties where id = c.party_id;
  if pt.lab_customer_id is null or pt.currency not in ('TRY', 'EUR', 'USD') then return; end if;
  insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, fin_txn_id)
  values (pt.lab_customer_id, p_date, fin_conv(c.amount, c.currency, pt.currency, p_date), pt.currency, 'check',
          left(coalesce(c.serial_no, ''), 80), left(fin_cheque_label(c), 500), p_txn)
  returning id into v;
  update fin_txns set lab_payment_id = v where id = p_txn;
end $$;
revoke execute on function fin_cheque_labpay(fin_cheques, uuid, date) from public, anon, authenticated;

-- Yeni çek / senet (alınan: cariden tahsilat; verilen: cariye ödeme)
create or replace function fin_cheque_new(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c fin_cheques; pt fin_parties; v_date date := coalesce(nullif(p->>'date', '')::date, current_date);
  v_port uuid; v_txn uuid; s int;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  select * into pt from fin_parties where id = nullif(p->>'party_id', '')::uuid;
  if pt.id is null then raise exception 'party_required'; end if;
  insert into fin_cheques (direction, doc_type, serial_no, bank_name, branch, account_no, drawer, drawer_tax_no, amount, currency, issue_date, due_date, party_id, status, bank_account_id, image_path, note)
  values (p->>'direction', coalesce(nullif(p->>'doc_type', ''), 'cheque'), nullif(left(p->>'serial_no', 40), ''), nullif(left(p->>'bank_name', 80), ''), nullif(left(p->>'branch', 80), ''),
          nullif(left(p->>'account_no', 40), ''), coalesce(nullif(left(p->>'drawer', 160), ''), case when p->>'direction' = 'in' then pt.name else null end),
          nullif(left(regexp_replace(coalesce(p->>'drawer_tax_no', ''), '\D', '', 'g'), 11), ''),
          (p->>'amount')::bigint, coalesce(nullif(p->>'currency', ''), 'TRY'), nullif(p->>'issue_date', '')::date, (p->>'due_date')::date, pt.id,
          case when p->>'direction' = 'in' then 'portfolio' else 'issued' end, nullif(p->>'bank_account_id', '')::uuid,
          nullif(left(p->>'image_path', 300), ''), nullif(left(p->>'note', 500), ''))
  returning * into c;
  v_port := fin_system_account(case when c.direction = 'in' then 'cheque_in' else 'cheque_out' end, c.currency);
  s := case when c.direction = 'in' then 1 else -1 end;
  v_txn := fin_post_sys(
    jsonb_build_object('kind', case when c.direction = 'in' then 'cheque_in' else 'cheque_out' end, 'txn_date', v_date, 'description', fin_cheque_label(c),
                       'doc_no', c.serial_no, 'amount', c.amount, 'currency', c.currency, 'party_id', pt.id, 'account_id', v_port, 'ref_type', 'cheque', 'ref_id', c.id),
    jsonb_build_array(
      jsonb_build_object('account_id', v_port, 'amount', s * c.amount, 'currency', c.currency, 'rate', fin_rate(c.currency, v_date)),
      jsonb_build_object('party_id', pt.id, 'amount', -s * fin_conv(c.amount, c.currency, pt.currency, v_date), 'currency', pt.currency, 'rate', fin_rate(pt.currency, v_date))));
  update fin_cheques set receive_txn_id = v_txn where id = c.id;
  if c.direction = 'in' then perform fin_cheque_labpay(c, v_txn, v_date); end if;
  insert into fin_cheque_events (cheque_id, event_date, action, new_status, txn_id, party_id)
  values (c.id, v_date, case when c.direction = 'in' then 'received' else 'issued' end, c.status, v_txn, pt.id);
  return c.id;
end $$;
revoke execute on function fin_cheque_new(jsonb) from public, anon;
grant execute on function fin_cheque_new(jsonb) to authenticated;

-- Durum değişikliği: deposit | collect | endorse | bounce | return | pay | cancel
create or replace function fin_cheque_action(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  c fin_cheques; pt fin_parties; pe fin_parties; acc fin_accounts;
  v_date date := coalesce(nullif(p->>'date', '')::date, current_date);
  v_port uuid; v_txn uuid; v_new text; v_kind text; v_lines jsonb; v_party uuid; v_acc uuid;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  select * into c from fin_cheques where id = p_id for update;
  if c.id is null then raise exception 'not_found'; end if;
  select * into pt from fin_parties where id = c.party_id;
  v_port := fin_system_account(case when c.direction = 'in' then 'cheque_in' else 'cheque_out' end, c.currency);

  if c.direction = 'in' and p_action = 'deposit' and c.status = 'portfolio' then
    select * into acc from fin_accounts where id = nullif(p->>'account_id', '')::uuid and kind in ('bank', 'pos');
    if acc.id is null then raise exception 'account_required'; end if;
    v_new := 'deposited'; v_acc := acc.id;
  elsif c.direction = 'in' and p_action = 'collect' and c.status in ('portfolio', 'deposited') then
    select * into acc from fin_accounts where id = coalesce(nullif(p->>'account_id', '')::uuid, c.bank_account_id) and kind in ('bank', 'pos', 'cash');
    if acc.id is null then raise exception 'account_required'; end if;
    v_new := 'collected'; v_kind := 'cheque_collect'; v_acc := acc.id;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', acc.id, 'amount', fin_conv(c.amount, c.currency, acc.currency, v_date), 'currency', acc.currency, 'rate', fin_rate(acc.currency, v_date)),
      jsonb_build_object('account_id', v_port, 'amount', -c.amount, 'currency', c.currency, 'rate', fin_rate(c.currency, v_date)));
  elsif c.direction = 'in' and p_action = 'endorse' and c.status = 'portfolio' then
    select * into pe from fin_parties where id = nullif(p->>'party_id', '')::uuid;
    if pe.id is null then raise exception 'party_required'; end if;
    v_new := 'endorsed'; v_kind := 'cheque_endorse'; v_party := pe.id;
    v_lines := jsonb_build_array(
      jsonb_build_object('party_id', pe.id, 'amount', fin_conv(c.amount, c.currency, pe.currency, v_date), 'currency', pe.currency, 'rate', fin_rate(pe.currency, v_date)),
      jsonb_build_object('account_id', v_port, 'amount', -c.amount, 'currency', c.currency, 'rate', fin_rate(c.currency, v_date)));
  elsif c.direction = 'in' and p_action in ('bounce', 'return') and c.status in ('portfolio', 'deposited', 'endorsed') then
    v_new := case when p_action = 'bounce' then 'bounced' else 'returned' end; v_kind := 'cheque_bounce';
    if c.status = 'endorsed' then
      select * into pe from fin_parties where id = c.endorsed_party_id;
      v_party := pe.id;
      -- ciro edilen firma çeki geri getirdi: ona yine borçluyuz, asıl cari yine bize borçlu
      v_lines := jsonb_build_array(
        jsonb_build_object('party_id', pe.id, 'amount', -fin_conv(c.amount, c.currency, pe.currency, v_date), 'currency', pe.currency, 'rate', fin_rate(pe.currency, v_date)),
        jsonb_build_object('party_id', pt.id, 'amount', fin_conv(c.amount, c.currency, pt.currency, v_date), 'currency', pt.currency, 'rate', fin_rate(pt.currency, v_date)));
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('party_id', pt.id, 'amount', fin_conv(c.amount, c.currency, pt.currency, v_date), 'currency', pt.currency, 'rate', fin_rate(pt.currency, v_date)),
        jsonb_build_object('account_id', v_port, 'amount', -c.amount, 'currency', c.currency, 'rate', fin_rate(c.currency, v_date)));
    end if;
  elsif c.direction = 'out' and p_action = 'pay' and c.status = 'issued' then
    select * into acc from fin_accounts where id = coalesce(nullif(p->>'account_id', '')::uuid, c.bank_account_id) and kind in ('bank', 'cash');
    if acc.id is null then raise exception 'account_required'; end if;
    v_new := 'paid'; v_kind := 'cheque_pay'; v_acc := acc.id;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_port, 'amount', c.amount, 'currency', c.currency, 'rate', fin_rate(c.currency, v_date)),
      jsonb_build_object('account_id', acc.id, 'amount', -fin_conv(c.amount, c.currency, acc.currency, v_date), 'currency', acc.currency, 'rate', fin_rate(acc.currency, v_date)));
  elsif c.direction = 'out' and p_action = 'cancel' and c.status = 'issued' then
    v_new := 'cancelled'; v_kind := 'cheque_out';
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_port, 'amount', c.amount, 'currency', c.currency, 'rate', fin_rate(c.currency, v_date)),
      jsonb_build_object('party_id', pt.id, 'amount', -fin_conv(c.amount, c.currency, pt.currency, v_date), 'currency', pt.currency, 'rate', fin_rate(pt.currency, v_date)));
  else
    raise exception 'bad_status';
  end if;

  if v_lines is not null then
    v_txn := fin_post_sys(
      jsonb_build_object('kind', v_kind, 'txn_date', v_date, 'description', fin_cheque_label(c) || ' · ' ||
                         case p_action when 'collect' then 'tahsil edildi' when 'endorse' then 'ciro: ' || pe.name when 'bounce' then 'karşılıksız' when 'return' then 'iade edildi'
                                       when 'pay' then 'ödendi' when 'cancel' then 'iptal / geri alındı' else p_action end,
                         'doc_no', c.serial_no, 'amount', c.amount, 'currency', c.currency, 'party_id', coalesce(v_party, c.party_id), 'account_id', v_acc, 'ref_type', 'cheque', 'ref_id', c.id),
      v_lines);
  end if;
  -- karşılıksız / iade: hekim ekstresindeki çek tahsilatı kalkar
  if p_action in ('bounce', 'return') and c.receive_txn_id is not null then
    delete from lab_payments where fin_txn_id = c.receive_txn_id;
    update fin_txns set lab_payment_id = null where id = c.receive_txn_id;
  end if;
  update fin_cheques set status = v_new,
    bank_account_id = coalesce(v_acc, bank_account_id),
    endorsed_party_id = case when p_action = 'endorse' then v_party else endorsed_party_id end
  where id = c.id;
  insert into fin_cheque_events (cheque_id, event_date, action, prev_status, new_status, txn_id, party_id, account_id, note)
  values (c.id, v_date, p_action, c.status, v_new, v_txn, v_party, v_acc, nullif(left(p->>'note', 300), ''));
end $$;
revoke execute on function fin_cheque_action(uuid, text, jsonb) from public, anon;
grant execute on function fin_cheque_action(uuid, text, jsonb) to authenticated;

-- Son işlemi geri al (ilk kayıtsa çek tamamen silinir)
create or replace function fin_cheque_undo(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c fin_cheques; e fin_cheque_events;
begin
  if not can_module('finance', 3) then raise exception 'not_allowed'; end if;
  select * into c from fin_cheques where id = p_id for update;
  if c.id is null then raise exception 'not_found'; end if;
  select * into e from fin_cheque_events where cheque_id = c.id order by id desc limit 1;
  if e.action in ('received', 'issued') then
    perform fin_void_sys(e.txn_id, 'Çek kaydı geri alındı');
    delete from fin_cheques where id = c.id;
    return 'deleted';
  end if;
  perform fin_void_sys(e.txn_id, 'Çek işlemi geri alındı');
  if e.action in ('bounce', 'return') and c.receive_txn_id is not null then
    perform fin_cheque_labpay(c, c.receive_txn_id, (select txn_date from fin_txns where id = c.receive_txn_id));
  end if;
  update fin_cheques set status = e.prev_status,
    endorsed_party_id = case when e.action = 'endorse' then null else endorsed_party_id end
  where id = c.id;
  delete from fin_cheque_events where id = e.id;
  return e.prev_status;
end $$;
revoke execute on function fin_cheque_undo(uuid) from public, anon;
grant execute on function fin_cheque_undo(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Kredi kartı: taksitli harcama
-- ---------------------------------------------------------------------
create table if not exists fin_card_installments (
  id bigint generated by default as identity primary key,
  txn_id uuid not null references fin_txns (id) on delete cascade,
  account_id uuid not null references fin_accounts (id) on delete cascade,
  no int not null, of_count int not null,
  statement_date date not null,
  amount bigint not null
);
create index if not exists fin_card_installments_idx on fin_card_installments (account_id, statement_date);
alter table fin_card_installments enable row level security;
drop policy if exists fin_card_installments_read on fin_card_installments;
create policy fin_card_installments_read on fin_card_installments for select to authenticated using (can_module('finance') or can_module('expenses'));
grant select on fin_card_installments to authenticated;

-- p: {account_id, date, amount, installments, party_id | category_id, vat_rate, description, doc_no}
create or replace function fin_card_spend(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a fin_accounts; pt fin_parties; v_date date := coalesce(nullif(p->>'date', '')::date, current_date);
  v_amount bigint := (p->>'amount')::bigint; v_n int := least(greatest(coalesce((p->>'installments')::int, 1), 1), 48);
  v_vr numeric := coalesce(nullif(p->>'vat_rate', '')::numeric, 0); v_vat bigint := 0; v_txn uuid; v_lines jsonb; v_first date; v_each bigint; i int;
begin
  if not (can_module('finance', 2) or can_module('expenses', 2)) then raise exception 'not_allowed'; end if;
  select * into a from fin_accounts where id = nullif(p->>'account_id', '')::uuid and kind = 'credit_card';
  if a.id is null then raise exception 'account_required'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'amount'; end if;
  v_lines := jsonb_build_array(jsonb_build_object('account_id', a.id, 'amount', -v_amount, 'currency', a.currency, 'rate', fin_rate(a.currency, v_date)));
  if nullif(p->>'party_id', '') is not null then
    select * into pt from fin_parties where id = (p->>'party_id')::uuid;
    v_lines := v_lines || jsonb_build_object('party_id', pt.id, 'amount', fin_conv(v_amount, a.currency, pt.currency, v_date), 'currency', pt.currency, 'rate', fin_rate(pt.currency, v_date));
  else
    if v_vr > 0 then v_vat := round(v_amount * v_vr / (100 + v_vr)); end if;
    v_lines := v_lines || jsonb_build_object('category_id', coalesce(nullif(p->>'category_id', '')::uuid, fin_category('exp_other')), 'amount', v_amount - v_vat, 'currency', a.currency, 'rate', fin_rate(a.currency, v_date));
    if v_vat > 0 then v_lines := v_lines || jsonb_build_object('category_id', fin_category('vat_in'), 'amount', v_vat, 'currency', a.currency, 'rate', fin_rate(a.currency, v_date)); end if;
  end if;
  v_txn := fin_post_sys(jsonb_build_object('kind', 'card_spend', 'txn_date', v_date, 'description', coalesce(nullif(p->>'description', ''), 'Kart harcaması') || case when v_n > 1 then ' (' || v_n || ' taksit)' else '' end,
                                           'doc_no', p->>'doc_no', 'amount', v_amount, 'currency', a.currency, 'account_id', a.id, 'party_id', pt.id, 'category_id', nullif(p->>'category_id', '')::uuid), v_lines);
  -- ilk ekstre: kesim gününe kadar yapılan harcama o ayın ekstresine girer
  v_first := make_date(extract(year from v_date)::int, extract(month from v_date)::int, least(coalesce(a.statement_day, 1), 28));
  if extract(day from v_date) > least(coalesce(a.statement_day, 1), 28) then v_first := (v_first + interval '1 month')::date; end if;
  v_each := v_amount / v_n;
  for i in 1..v_n loop
    insert into fin_card_installments (txn_id, account_id, no, of_count, statement_date, amount)
    values (v_txn, a.id, i, v_n, (v_first + make_interval(months => i - 1))::date, case when i = v_n then v_amount - v_each * (v_n - 1) else v_each end);
  end loop;
  return v_txn;
end $$;
revoke execute on function fin_card_spend(jsonb) from public, anon;
grant execute on function fin_card_spend(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Krediler
-- ---------------------------------------------------------------------
create table if not exists fin_loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  account_id uuid not null unique references fin_accounts (id) on delete cascade,
  bank_name text check (bank_name is null or length(bank_name) <= 80),
  loan_no text check (loan_no is null or length(loan_no) <= 40),
  principal bigint not null check (principal > 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  annual_rate numeric(8, 4) not null default 0,
  tax_pct numeric(5, 2) not null default 0,     -- faiz üzerinden BSMV / KKDF
  term int not null check (term between 1 and 240),
  method text not null default 'annuity' check (method in ('annuity', 'equal_principal', 'manual')),
  start_date date not null default current_date,
  disbursed_account_id uuid references fin_accounts (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed')),
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists fin_loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references fin_loans (id) on delete cascade,
  no int not null,
  due_date date not null,
  principal bigint not null default 0,
  interest bigint not null default 0,
  tax bigint not null default 0,
  paid_txn_id uuid references fin_txns (id) on delete set null,
  paid_at date,
  paid_total bigint,
  unique (loan_id, no)
);
create index if not exists fin_loan_installments_due_idx on fin_loan_installments (due_date) where paid_txn_id is null;
alter table fin_loans enable row level security;
alter table fin_loan_installments enable row level security;
drop policy if exists fin_loans_read on fin_loans;
create policy fin_loans_read on fin_loans for select to authenticated using (can_module('finance'));
drop policy if exists fin_loan_installments_read on fin_loan_installments;
create policy fin_loan_installments_read on fin_loan_installments for select to authenticated using (can_module('finance'));
grant select on fin_loans, fin_loan_installments to authenticated;

-- p: {name, bank_name, loan_no, principal, currency, annual_rate, tax_pct, term, method, start_date, disbursed_account_id, existing, note,
--     schedule: [{no, due_date, principal, interest, tax}]}
-- existing=true: devam eden kredi; kalan anapara açılış bakiyesi olur, kullanım kaydı atılmaz
create or replace function fin_loan_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_loan uuid; v_cur text := coalesce(nullif(p->>'currency', ''), 'TRY'); v_principal bigint := (p->>'principal')::bigint;
  v_date date := coalesce(nullif(p->>'start_date', '')::date, current_date); v_existing boolean := coalesce((p->>'existing')::boolean, false);
  b fin_accounts; s jsonb; v_remaining bigint;
begin
  if not can_module('finance', 3) then raise exception 'not_allowed'; end if;
  if jsonb_typeof(p->'schedule') <> 'array' or jsonb_array_length(p->'schedule') = 0 then raise exception 'schedule_required'; end if;
  select coalesce(sum((x->>'principal')::bigint), 0) into v_remaining from jsonb_array_elements(p->'schedule') x;
  insert into fin_accounts (kind, name, currency, bank_name, account_no, opening_balance, opening_date, note)
  values ('loan', left(coalesce(nullif(p->>'name', ''), 'Kredi · ' || coalesce(p->>'bank_name', '')), 120), v_cur, nullif(left(p->>'bank_name', 80), ''), nullif(left(p->>'loan_no', 40), ''),
          case when v_existing then -v_remaining else 0 end, v_date, nullif(left(p->>'note', 500), ''))
  returning id into v_acc;
  insert into fin_loans (account_id, bank_name, loan_no, principal, currency, annual_rate, tax_pct, term, method, start_date, disbursed_account_id, note)
  values (v_acc, nullif(left(p->>'bank_name', 80), ''), nullif(left(p->>'loan_no', 40), ''), v_principal, v_cur, coalesce(nullif(p->>'annual_rate', '')::numeric, 0),
          coalesce(nullif(p->>'tax_pct', '')::numeric, 0), jsonb_array_length(p->'schedule'), coalesce(nullif(p->>'method', ''), 'annuity'), v_date,
          nullif(p->>'disbursed_account_id', '')::uuid, nullif(left(p->>'note', 500), ''))
  returning id into v_loan;
  for s in select * from jsonb_array_elements(p->'schedule') loop
    insert into fin_loan_installments (loan_id, no, due_date, principal, interest, tax)
    values (v_loan, (s->>'no')::int, (s->>'due_date')::date, coalesce((s->>'principal')::bigint, 0), coalesce((s->>'interest')::bigint, 0), coalesce((s->>'tax')::bigint, 0));
  end loop;
  if not v_existing then
    select * into b from fin_accounts where id = nullif(p->>'disbursed_account_id', '')::uuid and kind in ('bank', 'cash');
    if b.id is null then raise exception 'account_required'; end if;
    perform fin_post_sys(jsonb_build_object('kind', 'loan_draw', 'txn_date', v_date, 'description', 'Kredi kullanımı · ' || coalesce(p->>'bank_name', '') || coalesce(' ' || nullif(p->>'loan_no', ''), ''),
                                            'amount', v_principal, 'currency', v_cur, 'account_id', v_acc, 'ref_type', 'loan', 'ref_id', v_loan),
      jsonb_build_array(
        jsonb_build_object('account_id', b.id, 'amount', fin_conv(v_principal, v_cur, b.currency, v_date), 'currency', b.currency, 'rate', fin_rate(b.currency, v_date)),
        jsonb_build_object('account_id', v_acc, 'amount', -v_principal, 'currency', v_cur, 'rate', fin_rate(v_cur, v_date))));
  end if;
  return v_loan;
end $$;
revoke execute on function fin_loan_create(jsonb) from public, anon;
grant execute on function fin_loan_create(jsonb) to authenticated;

-- Taksit öde: banka − toplam; kredi hesabı + anapara; faiz + vergi gider. Fazla ödeme (gecikme faizi) faiz giderine.
create or replace function fin_loan_pay(p_inst uuid, p_account uuid, p_date date, p_total bigint default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i fin_loan_installments; l fin_loans; b fin_accounts; v_total bigint; v_exp bigint; v_txn uuid; v_date date := coalesce(p_date, current_date);
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  select * into i from fin_loan_installments where id = p_inst for update;
  if i.id is null then raise exception 'not_found'; end if;
  if i.paid_txn_id is not null then raise exception 'bad_status'; end if;
  select * into l from fin_loans where id = i.loan_id;
  select * into b from fin_accounts where id = p_account and kind in ('bank', 'cash');
  if b.id is null then raise exception 'account_required'; end if;
  v_total := coalesce(p_total, i.principal + i.interest + i.tax);
  v_exp := v_total - i.principal;
  v_txn := fin_post_sys(jsonb_build_object('kind', 'loan_payment', 'txn_date', v_date, 'description', 'Kredi taksiti ' || i.no || ' · ' || coalesce(l.bank_name, '') || coalesce(' ' || l.loan_no, ''),
                                           'amount', v_total, 'currency', l.currency, 'account_id', l.account_id, 'ref_type', 'loan', 'ref_id', l.id),
    jsonb_build_array(
      jsonb_build_object('account_id', b.id, 'amount', -fin_conv(v_total, l.currency, b.currency, v_date), 'currency', b.currency, 'rate', fin_rate(b.currency, v_date)),
      jsonb_build_object('account_id', l.account_id, 'amount', i.principal, 'currency', l.currency, 'rate', fin_rate(l.currency, v_date)),
      jsonb_build_object('category_id', fin_category('exp_interest'), 'amount', v_exp, 'currency', l.currency, 'rate', fin_rate(l.currency, v_date), 'description', 'Faiz + BSMV/KKDF')));
  update fin_loan_installments set paid_txn_id = v_txn, paid_at = v_date, paid_total = v_total where id = i.id;
  if not exists (select 1 from fin_loan_installments where loan_id = l.id and paid_txn_id is null) then update fin_loans set status = 'closed' where id = l.id; end if;
  return v_txn;
end $$;
revoke execute on function fin_loan_pay(uuid, uuid, date, bigint) from public, anon;
grant execute on function fin_loan_pay(uuid, uuid, date, bigint) to authenticated;

create or replace function fin_loan_unpay(p_inst uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i fin_loan_installments;
begin
  if not can_module('finance', 3) then raise exception 'not_allowed'; end if;
  select * into i from fin_loan_installments where id = p_inst for update;
  if i.paid_txn_id is null then return; end if;
  perform fin_void_sys(i.paid_txn_id, 'Kredi taksit ödemesi geri alındı');
  update fin_loan_installments set paid_txn_id = null, paid_at = null, paid_total = null where id = i.id;
  update fin_loans set status = 'active' where id = i.loan_id;
end $$;
revoke execute on function fin_loan_unpay(uuid) from public, anon;
grant execute on function fin_loan_unpay(uuid) to authenticated;

-- Taksit tutarını düzelt (bankanın verdiği plana göre)
create or replace function fin_loan_edit(p_inst uuid, p_due date, p_principal bigint, p_interest bigint, p_tax bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('finance', 3) then raise exception 'not_allowed'; end if;
  update fin_loan_installments set due_date = coalesce(p_due, due_date), principal = greatest(coalesce(p_principal, principal), 0),
    interest = greatest(coalesce(p_interest, interest), 0), tax = greatest(coalesce(p_tax, tax), 0)
  where id = p_inst and paid_txn_id is null;
end $$;
revoke execute on function fin_loan_edit(uuid, date, bigint, bigint, bigint) from public, anon;
grant execute on function fin_loan_edit(uuid, date, bigint, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Avans ve ortak hesapları (hesap açma; işlemler fin_post ile)
-- ---------------------------------------------------------------------
create or replace function fin_advance_account(p_employee uuid, p_currency text default 'TRY') returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; e employees;
begin
  if not (can_module('finance', 2) or can_module('expenses', 2)) then raise exception 'not_allowed'; end if;
  select * into e from employees where id = p_employee;
  if e.id is null then raise exception 'not_found'; end if;
  select id into v from fin_accounts where kind = 'advance' and holder_employee_id = e.id and currency = coalesce(p_currency, 'TRY') limit 1;
  if v is null then
    insert into fin_accounts (kind, name, currency, holder_employee_id, holder_name)
    values ('advance', left('Avans · ' || e.first_name || ' ' || e.last_name, 120), coalesce(p_currency, 'TRY'), e.id, left(e.first_name || ' ' || e.last_name, 120))
    returning id into v;
  else
    update fin_accounts set is_active = true where id = v;
  end if;
  return v;
end $$;
revoke execute on function fin_advance_account(uuid, text) from public, anon;
grant execute on function fin_advance_account(uuid, text) to authenticated;

-- Çek ve kredi kayıtları kendi ekranından geri alınır
create or replace function fin_void(p_txn uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t fin_txns;
begin
  select * into t from fin_txns where id = p_txn for update;
  if t.id is null then raise exception 'not_found'; end if;
  if not (can_module('finance', 3) or (t.kind = 'expense' and can_module('expenses', 3))) then raise exception 'not_allowed'; end if;
  if t.voided_at is not null then return; end if;
  if t.ref_type = 'invoice' then raise exception 'use_invoice_cancel'; end if;
  if t.ref_type in ('cheque', 'loan') then raise exception 'use_source_undo'; end if;
  update fin_txns set voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(p_reason, ''), 300) where id = p_txn;
  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;
end $$;
revoke execute on function fin_void(uuid, text) from public, anon;
grant execute on function fin_void(uuid, text) to authenticated;

notify pgrst, 'reload schema';
