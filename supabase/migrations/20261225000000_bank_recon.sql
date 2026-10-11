-- =====================================================================
-- BANKA EKSTRESİ İÇE AKTARMA VE CARİ MUTABAKAT
--  fin_bank_batches / fin_bank_lines : yüklenen ekstre ve satırları (aynı satır iki kez alınmaz)
--  fin_bank_rules  : "açıklamada X geçerse → cari / kategori" kuralları (işlerken öğrenilir)
--  fin_bank_import(hesap, dosya, satırlar) : satırları ekler ve eşleştirme önerir
--     1) aynı hesapta ±3 gün içinde aynı tutarlı kayıt varsa → "zaten kayıtlı"
--     2) kural → cari / kategori;  3) cari adı / IBAN açıklamada geçiyorsa → cari
--  fin_bank_post(satır, cari, kategori, defter, kural) : tahsilat / ödeme ya da gelir / gider kaydı
--  fin_party_balance_at(cari, tarih, defter) : tarih itibarıyla bakiye (resmi ya da iç)
--  fin_reconciliations : mutabakat mektubu; hekim portalda ya da bağlantıyla "onaylıyorum / itiraz" der
--  fin_recon_public(token) / fin_recon_respond(token, …) : bağlantıyla yanıt (giriş gerektirmez)
-- Tekrar çalıştırılabilir. Önce 20261224000000_bonus.sql.
-- =====================================================================

create table if not exists fin_bank_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references fin_accounts (id) on delete cascade,
  file_name text check (file_name is null or length(file_name) <= 200),
  rows int not null default 0,
  added int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists fin_bank_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references fin_bank_batches (id) on delete cascade,
  account_id uuid not null references fin_accounts (id) on delete cascade,
  txn_date date not null,
  description text not null default '' check (length(description) <= 500),
  amount bigint not null check (amount <> 0),            -- hesabın para biriminde, işaretli (+ giriş)
  balance bigint,
  bank_ref text check (bank_ref is null or length(bank_ref) <= 80),
  hash text not null,
  status text not null default 'new' check (status in ('new', 'matched', 'posted', 'ignored')),
  suggested_party_id uuid references fin_parties (id) on delete set null,
  suggested_category_id uuid references fin_categories (id) on delete set null,
  suggest_reason text,
  txn_id uuid references fin_txns (id) on delete set null,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, hash)
);
create index if not exists fin_bank_lines_idx on fin_bank_lines (account_id, status, txn_date desc);

create table if not exists fin_bank_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  pattern text not null check (length(pattern) between 3 and 80),
  direction text not null default 'any' check (direction in ('in', 'out', 'any')),
  party_id uuid references fin_parties (id) on delete cascade,
  category_id uuid references fin_categories (id) on delete cascade,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  check (num_nonnulls(party_id, category_id) = 1)
);
create unique index if not exists fin_bank_rules_uidx on fin_bank_rules (company_id, lower(pattern), direction);

alter table fin_bank_batches enable row level security;
alter table fin_bank_lines enable row level security;
alter table fin_bank_rules enable row level security;
drop policy if exists fin_bank_batches_read on fin_bank_batches;
create policy fin_bank_batches_read on fin_bank_batches for select to authenticated using (can_module('finance'));
drop policy if exists fin_bank_lines_read on fin_bank_lines;
create policy fin_bank_lines_read on fin_bank_lines for select to authenticated using (can_module('finance'));
drop policy if exists fin_bank_rules_read on fin_bank_rules;
create policy fin_bank_rules_read on fin_bank_rules for select to authenticated using (can_module('finance'));
drop policy if exists fin_bank_rules_delete on fin_bank_rules;
create policy fin_bank_rules_delete on fin_bank_rules for delete to authenticated using (can_module('finance', 2));
grant select on fin_bank_batches, fin_bank_lines, fin_bank_rules to authenticated;
grant delete on fin_bank_rules to authenticated;

-- Öneri (tek satır)
create or replace function fin_bank_suggest_line(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l fin_bank_lines; v_txn uuid; v_party uuid; v_cat uuid; v_reason text; r record; v_desc text;
begin
  select * into l from fin_bank_lines where id = p_id;
  if l.id is null or l.status not in ('new') then return; end if;
  v_desc := lower(translate(l.description, 'İIŞĞÜÖÇışğüöç', 'iisguocisguoc'));
  -- 1) zaten kayıtlı mı (aynı hesap, aynı tutar, ±3 gün, başka satıra bağlanmamış)
  select m.txn_id into v_txn from fin_moves m join fin_txns t on t.id = m.txn_id
  where m.account_id = l.account_id and m.amount = l.amount and t.voided_at is null
    and m.move_date between l.txn_date - 3 and l.txn_date + 3
    and not exists (select 1 from fin_bank_lines x where x.txn_id = m.txn_id)
  order by abs(m.move_date - l.txn_date) limit 1;
  if v_txn is not null then
    update fin_bank_lines set status = 'matched', txn_id = v_txn, suggest_reason = 'Aynı tutarlı kayıt zaten var' where id = p_id;
    return;
  end if;
  -- 2) kural
  select * into r from fin_bank_rules
  where company_id = lab_company() and (direction = 'any' or (direction = 'in') = (l.amount > 0))
    and v_desc like '%' || lower(translate(pattern, 'İIŞĞÜÖÇışğüöç', 'iisguocisguoc')) || '%'
  order by length(pattern) desc, hits desc limit 1;
  if r.id is not null then
    v_party := r.party_id; v_cat := r.category_id; v_reason := 'Kural: ' || r.pattern;
  else
    -- 3) cari adı (ilk anlamlı kelime ≥ 4 harf) ya da IBAN açıklamada
    select p.id, 'Açıklamada cari adı / IBAN geçiyor' into v_party, v_reason
    from fin_parties p
    where p.is_active and (
      (p.iban is not null and length(p.iban) >= 16 and replace(v_desc, ' ', '') like '%' || lower(replace(p.iban, ' ', '')) || '%')
      or (length(p.name) >= 5 and v_desc like '%' || lower(translate(split_part(regexp_replace(p.name, '^(dr\.?|dt\.?|diş hekimi)\s+', '', 'i'), ' ', 1) || ' ' || coalesce(nullif(split_part(regexp_replace(p.name, '^(dr\.?|dt\.?|diş hekimi)\s+', '', 'i'), ' ', 2), ''), ''), 'İIŞĞÜÖÇışğüöç', 'iisguocisguoc')) || '%')
    )
    order by (p.iban is not null and replace(v_desc, ' ', '') like '%' || lower(replace(p.iban, ' ', '')) || '%') desc,
             case when l.amount > 0 then p.kind in ('customer', 'both') else p.kind in ('supplier', 'both') end desc, length(p.name) desc
    limit 1;
  end if;
  update fin_bank_lines set suggested_party_id = v_party, suggested_category_id = v_cat, suggest_reason = v_reason where id = p_id;
end $$;
revoke execute on function fin_bank_suggest_line(uuid) from public, anon, authenticated;

-- İçe aktar: p_rows = [{date, description, amount (kuruş, işaretli), balance, ref}]
create or replace function fin_bank_import(p_account uuid, p_file text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_batch uuid; r jsonb; v_id uuid; n int := 0; v_added int := 0; v_hash text; v_seq int; v_prev text := ''; v_matched int; v_sug int;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_accounts where id = p_account and kind in ('bank', 'pos', 'credit_card', 'cash')) then raise exception 'not_found'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'empty'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'too_many'; end if;
  insert into fin_bank_batches (account_id, file_name, rows) values (p_account, left(p_file, 200), jsonb_array_length(p_rows)) returning id into v_batch;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    if nullif(r->>'date', '') is null or coalesce(nullif(r->>'amount', '')::bigint, 0) = 0 then continue; end if;
    -- aynı gün aynı açıklama ve tutarlı satırlar ayrı sayılsın: sıra no eklenir (bakiye varsa bakiye ayırt eder)
    v_hash := md5(concat_ws('|', r->>'date', r->>'amount', coalesce(r->>'balance', ''), lower(trim(coalesce(r->>'description', ''))), coalesce(r->>'ref', '')));
    v_seq := case when v_hash = v_prev then v_seq + 1 else 0 end;
    v_prev := v_hash;
    insert into fin_bank_lines (batch_id, account_id, txn_date, description, amount, balance, bank_ref, hash)
    values (v_batch, p_account, (r->>'date')::date, left(trim(coalesce(r->>'description', '')), 500), (r->>'amount')::bigint,
            nullif(r->>'balance', '')::bigint, nullif(left(trim(coalesce(r->>'ref', '')), 80), ''), v_hash || case when v_seq > 0 then ':' || v_seq else '' end)
    on conflict (account_id, hash) do nothing
    returning id into v_id;
    if v_id is not null then
      v_added := v_added + 1;
      perform fin_bank_suggest_line(v_id);
      v_id := null;
    end if;
  end loop;
  update fin_bank_batches set added = v_added where id = v_batch;
  select count(*) filter (where status = 'matched'), count(*) filter (where status = 'new' and (suggested_party_id is not null or suggested_category_id is not null))
  into v_matched, v_sug from fin_bank_lines where batch_id = v_batch;
  return jsonb_build_object('batch', v_batch, 'rows', n, 'added', v_added, 'matched', v_matched, 'suggested', v_sug);
end $$;
revoke execute on function fin_bank_import(uuid, text, jsonb) from public, anon;
grant execute on function fin_bank_import(uuid, text, jsonb) to authenticated;

-- Satırı işle
create or replace function fin_bank_post(p_line uuid, p_party uuid, p_category uuid, p_book text default null, p_rule text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare l fin_bank_lines; a fin_accounts; v_txn uuid; v_pattern text;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  select * into l from fin_bank_lines where id = p_line for update;
  if l.id is null then raise exception 'not_found'; end if;
  if l.status not in ('new', 'matched') then raise exception 'already_done'; end if;
  if num_nonnulls(p_party, p_category) <> 1 then raise exception 'target_required'; end if;
  select * into a from fin_accounts where id = l.account_id;
  if p_party is not null then
    v_txn := fin_collect_or_pay(case when l.amount > 0 then 'collection' else 'payment' end, p_party, l.account_id, l.txn_date, abs(l.amount), null, null,
                                left('Banka: ' || l.description, 500), l.bank_ref, 'bank', p_book);
  else
    v_txn := fin_post(jsonb_build_object('kind', case when l.amount > 0 then 'income' else 'expense' end, 'txn_date', l.txn_date,
                        'description', left('Banka: ' || l.description, 500), 'doc_no', l.bank_ref, 'amount', abs(l.amount), 'currency', a.currency,
                        'account_id', l.account_id, 'category_id', p_category),
                      jsonb_build_array(jsonb_build_object('account_id', l.account_id, 'amount', l.amount, 'currency', a.currency),
                                        jsonb_build_object('category_id', p_category, 'amount', -l.amount, 'currency', a.currency)));
  end if;
  update fin_bank_lines set status = 'posted', txn_id = v_txn, handled_by = auth.uid(), handled_at = now() where id = p_line;
  v_pattern := nullif(left(trim(coalesce(p_rule, '')), 80), '');
  if v_pattern is not null and length(v_pattern) >= 3 then
    insert into fin_bank_rules (pattern, direction, party_id, category_id) values (v_pattern, case when l.amount > 0 then 'in' else 'out' end, p_party, p_category)
    on conflict (company_id, lower(pattern), direction) do update set party_id = excluded.party_id, category_id = excluded.category_id;
  end if;
  update fin_bank_rules set hits = hits + 1 where company_id = lab_company() and (party_id = p_party or category_id = p_category)
    and lower(l.description) like '%' || lower(pattern) || '%';
  -- yeni kural diğer bekleyen satırlara da öneri olarak uygulanır
  if v_pattern is not null then
    perform fin_bank_suggest_line(x.id) from fin_bank_lines x where x.account_id = l.account_id and x.status = 'new' and x.suggested_party_id is null and x.suggested_category_id is null;
  end if;
  return v_txn;
end $$;
revoke execute on function fin_bank_post(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function fin_bank_post(uuid, uuid, uuid, text, text) to authenticated;

-- Durum: ignore / new (geri al) / confirm (eşleşmeyi onayla → posted)
create or replace function fin_bank_mark(p_line uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  if p_action = 'ignore' then
    update fin_bank_lines set status = 'ignored', handled_by = auth.uid(), handled_at = now() where id = p_line and status in ('new', 'matched');
  elsif p_action = 'confirm' then
    update fin_bank_lines set status = 'posted', handled_by = auth.uid(), handled_at = now() where id = p_line and status = 'matched';
  elsif p_action = 'reopen' then
    update fin_bank_lines set status = 'new', txn_id = null, handled_by = null, handled_at = null where id = p_line and status in ('ignored', 'matched');
    perform fin_bank_suggest_line(p_line);
  else
    raise exception 'bad_action';
  end if;
end $$;
revoke execute on function fin_bank_mark(uuid, text) from public, anon;
grant execute on function fin_bank_mark(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Mutabakat
-- ---------------------------------------------------------------------
create or replace function fin_party_balance_at(p_party uuid, p_date date, p_book text default 'official') returns bigint
language sql stable security definer set search_path = public as $$
  select case when p_book = 'internal' then
    (select c.internal_opening
       + coalesce((select sum(j.total) from jobs j where j.customer_id = c.id and j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date <= p_date), 0)
       - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = c.id and lp.book in ('internal', 'both') and lp.paid_on <= p_date), 0)
     from fin_parties p join lab_customers c on c.id = p.lab_customer_id where p.id = p_party and c.internal_book)
  else
    (select p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null and m.move_date <= p_date), 0)
       + case when coalesce(c.internal_book, false) then 0 else
           coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date <= p_date), 0)
         - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null and lp.paid_on <= p_date), 0) end
     from fin_parties p left join lab_customers c on c.id = p.lab_customer_id where p.id = p_party)
  end;
$$;
revoke execute on function fin_party_balance_at(uuid, date, text) from public, anon;
grant execute on function fin_party_balance_at(uuid, date, text) to authenticated;

create table if not exists fin_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  party_id uuid not null references fin_parties (id) on delete cascade,
  book text not null default 'official' check (book in ('official', 'internal')),
  as_of date not null,
  balance bigint not null,
  currency text not null,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  status text not null default 'sent' check (status in ('sent', 'confirmed', 'disputed', 'cancelled')),
  their_balance bigint,
  response_note text check (response_note is null or length(response_note) <= 1000),
  responded_name text check (responded_name is null or length(responded_name) <= 120),
  responded_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fin_reconciliations_idx on fin_reconciliations (party_id, as_of desc);
alter table fin_reconciliations enable row level security;
drop policy if exists fin_reconciliations_read on fin_reconciliations;
create policy fin_reconciliations_read on fin_reconciliations for select to authenticated
  using (can_module('finance') or can_module('sales')
         or exists (select 1 from fin_parties p join lab_customers c on c.id = p.lab_customer_id
                    where p.id = party_id and c.portal_account_id is not null and is_portal_member(c.portal_account_id) and status <> 'cancelled'));
grant select on fin_reconciliations to authenticated;

create or replace function fin_recon_create(p_parties uuid[], p_date date, p_book text default 'official') returns int
language plpgsql security definer set search_path = public as $$
declare v uuid; n int := 0; v_bal bigint; v_cur text;
begin
  if not (can_module('finance', 2) or can_module('sales', 2)) then raise exception 'not_allowed'; end if;
  if p_date is null or p_date > current_date then raise exception 'bad_date'; end if;
  foreach v in array coalesce(p_parties, '{}') loop
    v_bal := fin_party_balance_at(v, p_date, coalesce(p_book, 'official'));
    if v_bal is null then continue; end if;
    select case when p_book = 'internal' then c.currency else p.currency end into v_cur
    from fin_parties p left join lab_customers c on c.id = p.lab_customer_id where p.id = v;
    update fin_reconciliations set status = 'cancelled' where party_id = v and as_of = p_date and book = coalesce(p_book, 'official') and status = 'sent';
    insert into fin_reconciliations (party_id, book, as_of, balance, currency) values (v, coalesce(p_book, 'official'), p_date, v_bal, coalesce(v_cur, 'TRY'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function fin_recon_create(uuid[], date, text) from public, anon;
grant execute on function fin_recon_create(uuid[], date, text) to authenticated;

create or replace function fin_recon_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('sales', 2)) then raise exception 'not_allowed'; end if;
  update fin_reconciliations set status = 'cancelled' where id = p_id and status = 'sent';
end $$;
revoke execute on function fin_recon_cancel(uuid) from public, anon;
grant execute on function fin_recon_cancel(uuid) to authenticated;

-- Bağlantıyla görüntüleme (giriş gerekmez; yalnız token sahibi)
create or replace function fin_recon_public(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'party', p.name, 'as_of', r.as_of, 'balance', r.balance, 'currency', r.currency, 'status', r.status, 'book', r.book,
                            'their_balance', r.their_balance, 'note', r.response_note, 'responded_at', r.responded_at, 'responded_name', r.responded_name,
                            'company', (select name from companies where id = r.company_id), 'lang', coalesce(c.doc_lang, 'tr'))
  from fin_reconciliations r join fin_parties p on p.id = r.party_id left join lab_customers c on c.id = p.lab_customer_id
  where r.token = p_token and length(p_token) >= 24 and r.status <> 'cancelled';
$$;
revoke execute on function fin_recon_public(text) from public;
grant execute on function fin_recon_public(text) to anon, authenticated;

create or replace function fin_recon_respond(p_token text, p_status text, p_name text, p_note text default null, p_their bigint default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare r fin_reconciliations; v_party text;
begin
  if p_status not in ('confirmed', 'disputed') then raise exception 'bad_status'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'name_required'; end if;
  if p_status = 'disputed' and nullif(trim(coalesce(p_note, '')), '') is null and p_their is null then raise exception 'note_required'; end if;
  select * into r from fin_reconciliations where token = p_token and length(p_token) >= 24 for update;
  if r.id is null or r.status <> 'sent' then return false; end if;
  update fin_reconciliations set status = p_status, responded_name = left(trim(p_name), 120), response_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
    their_balance = p_their, responded_at = now() where id = r.id;
  select name into v_party from fin_parties where id = r.party_id;
  perform deliver(r.company_id, module_recipients('finance', 2), case when p_status = 'confirmed' then 'Mutabakat onaylandı: ' else 'Mutabakata itiraz: ' end || coalesce(v_party, ''),
                  to_char(r.as_of, 'DD.MM.YYYY') || ' · ' || left(coalesce(p_note, p_name), 140), '/finans/mutabakat');
  return true;
end $$;
revoke execute on function fin_recon_respond(text, text, text, text, bigint) from public;
grant execute on function fin_recon_respond(text, text, text, text, bigint) to anon, authenticated;

notify pgrst, 'reload schema';
