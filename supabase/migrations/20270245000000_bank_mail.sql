-- =====================================================================
-- BANKA HAREKETLERİ E-POSTAYLA OTOMATİK İÇE AKTARMA
--  Banka her gün MT940 (ya da Excel / CSV) ekstreyi bir e-posta adresine gönderir; ERP bağlı Gmail kutusunu
--  15 dakikada bir tarar. Ekteki IBAN / hesap no ile banka hesabı bulunur, satırlar fin_bank_import ile eklenir
--  (aynı satır iki kez girmez, cari / kural eşleştirmesi önerilir). Hesabı bulunamayan ek "bekleyen" listesine düşer;
--  bir kez hesap seçilince gönderen + ipucu kuralı öğrenilir.
--  fin_bank_mail_settings : taranacak Gmail hesabı, arama sorgusu, açık / kapalı, son çalışma
--  fin_bank_mail_seen     : işlenen e-posta / ek (tekrar işlenmez)
--  fin_bank_mail_pending  : hesabı bulunamayan ekler (ayrıştırılmış satırlarıyla)
--  fin_bank_mail_routes   : öğrenilmiş kural: gönderen / ipucu → banka hesabı
-- Tekrar çalıştırılabilir. Önce 20261225000000_bank_recon.sql.
-- =====================================================================

create table if not exists fin_bank_mail_settings (
  company_id uuid primary key default lab_company() references companies (id) on delete cascade,
  mail_account_id uuid references mail_accounts (id) on delete set null,
  query text check (query is null or length(query) <= 500),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_result text check (last_result is null or length(last_result) <= 1000),
  updated_at timestamptz not null default now()
);
create table if not exists fin_bank_mail_seen (
  ref text primary key,
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  account_id uuid references fin_accounts (id) on delete set null,
  sender text, subject text, file_name text,
  rows int, added int,
  result text check (result is null or length(result) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists fin_bank_mail_seen_idx on fin_bank_mail_seen (company_id, created_at desc);
create table if not exists fin_bank_mail_pending (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  ref text not null unique,
  sender text, subject text, file_name text,
  hint text check (hint is null or length(hint) <= 120),
  rows jsonb not null,
  row_count int not null default 0,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  done boolean not null default false
);
create table if not exists fin_bank_mail_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  sender text check (sender is null or length(sender) <= 200),
  hint text check (hint is null or length(hint) <= 120),
  account_id uuid not null references fin_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, sender, hint)
);
alter table fin_bank_mail_settings enable row level security;
alter table fin_bank_mail_seen enable row level security;
alter table fin_bank_mail_pending enable row level security;
alter table fin_bank_mail_routes enable row level security;
drop policy if exists fin_bank_mail_settings_read on fin_bank_mail_settings;
create policy fin_bank_mail_settings_read on fin_bank_mail_settings for select to authenticated using (company_id = (select lab_company()) and (select can_module('finance')));
drop policy if exists fin_bank_mail_seen_read on fin_bank_mail_seen;
create policy fin_bank_mail_seen_read on fin_bank_mail_seen for select to authenticated using (company_id = (select lab_company()) and (select can_module('finance')));
drop policy if exists fin_bank_mail_pending_read on fin_bank_mail_pending;
create policy fin_bank_mail_pending_read on fin_bank_mail_pending for select to authenticated using (company_id = (select lab_company()) and (select can_module('finance')));
drop policy if exists fin_bank_mail_routes_read on fin_bank_mail_routes;
create policy fin_bank_mail_routes_read on fin_bank_mail_routes for select to authenticated using (company_id = (select lab_company()) and (select can_module('finance')));
revoke all on fin_bank_mail_settings, fin_bank_mail_seen, fin_bank_mail_pending, fin_bank_mail_routes from anon;
grant select on fin_bank_mail_settings, fin_bank_mail_seen, fin_bank_mail_pending, fin_bank_mail_routes to authenticated;

-- İçe aktarma çekirdeği (izin denetimi çağıranda): zamanlanmış görev bunu kullanır
create or replace function fin_bank_import_core(p_account uuid, p_file text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_batch uuid; r jsonb; v_id uuid; n int := 0; v_added int := 0; v_hash text; v_seq int; v_prev text := ''; v_matched int; v_sug int;
begin
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
revoke execute on function fin_bank_import_core(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function fin_bank_import_core(uuid, text, jsonb) to service_role;

-- Ekrandan içe aktarma: aynı çekirdek, finans yetkisiyle
create or replace function fin_bank_import(p_account uuid, p_file text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  return fin_bank_import_core(p_account, p_file, p_rows);
end $$;
revoke execute on function fin_bank_import(uuid, text, jsonb) from public, anon;
grant execute on function fin_bank_import(uuid, text, jsonb) to authenticated;

-- Hesap bulma: ipucu (IBAN / hesap no) ya da öğrenilmiş gönderen kuralı
create or replace function fin_bank_mail_resolve(p_hint text, p_sender text) returns uuid
language sql stable security definer set search_path = public as $$
  with h as (select upper(regexp_replace(coalesce(p_hint, ''), '[^0-9A-Za-z]', '', 'g')) v)
  select coalesce(
    (select a.id from fin_accounts a, h where a.company_id = lab_company() and a.is_active and a.kind in ('bank', 'pos', 'credit_card') and length(h.v) >= 6
       and (upper(regexp_replace(coalesce(a.iban, ''), '[^0-9A-Za-z]', '', 'g')) = h.v
            or (length(regexp_replace(coalesce(a.account_no, ''), '[^0-9]', '', 'g')) >= 5 and h.v like '%' || regexp_replace(a.account_no, '[^0-9]', '', 'g') || '%')
            or (length(h.v) >= 8 and upper(regexp_replace(coalesce(a.iban, ''), '[^0-9A-Za-z]', '', 'g')) like '%' || h.v))
     order by (upper(regexp_replace(coalesce(a.iban, ''), '[^0-9A-Za-z]', '', 'g')) = h.v) desc limit 1),
    (select r.account_id from fin_bank_mail_routes r where r.company_id = lab_company() and r.hint = nullif(p_hint, '') and lower(coalesce(r.sender, '')) = lower(coalesce(p_sender, '')) limit 1),
    (select r.account_id from fin_bank_mail_routes r where r.company_id = lab_company() and r.hint is null and lower(coalesce(r.sender, '')) = lower(coalesce(p_sender, '')) limit 1)
  );
$$;
revoke execute on function fin_bank_mail_resolve(text, text) from public, anon, authenticated;
grant execute on function fin_bank_mail_resolve(text, text) to service_role;

-- Ayarlar
create or replace function fin_bank_mail_settings_save(p_account uuid, p_query text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('finance', 3) then raise exception 'not_allowed'; end if;
  if p_account is not null and not exists (select 1 from mail_accounts where id = p_account and company_id = lab_company()) then raise exception 'not_found'; end if;
  insert into fin_bank_mail_settings (company_id, mail_account_id, query, enabled, updated_at)
  values (lab_company(), p_account, nullif(left(trim(coalesce(p_query, '')), 500), ''), coalesce(p_enabled, true), now())
  on conflict (company_id) do update set mail_account_id = excluded.mail_account_id, query = excluded.query, enabled = excluded.enabled, updated_at = now();
end $$;
revoke execute on function fin_bank_mail_settings_save(uuid, text, boolean) from public, anon;
grant execute on function fin_bank_mail_settings_save(uuid, text, boolean) to authenticated;

-- Bekleyen eki seçilen hesaba aktar (isteğe bağlı kuralı öğren)
create or replace function fin_bank_mail_assign(p_pending uuid, p_account uuid, p_learn boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p fin_bank_mail_pending; r jsonb;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  select * into p from fin_bank_mail_pending where id = p_pending and company_id = lab_company() and not done for update;
  if p.id is null then raise exception 'not_found'; end if;
  r := fin_bank_import_core(p_account, coalesce(p.file_name, 'e-posta'), p.rows);
  update fin_bank_mail_pending set done = true where id = p.id;
  insert into fin_bank_mail_seen (ref, account_id, sender, subject, file_name, rows, added, result)
  values (p.ref || ':atandi', p_account, p.sender, p.subject, p.file_name, (r->>'rows')::int, (r->>'added')::int, 'elle hesap seçildi')
  on conflict (ref) do nothing;
  if p_learn then
    insert into fin_bank_mail_routes (sender, hint, account_id) values (lower(p.sender), p.hint, p_account)
    on conflict (company_id, sender, hint) do update set account_id = excluded.account_id;
  end if;
  return r;
end $$;
revoke execute on function fin_bank_mail_assign(uuid, uuid, boolean) from public, anon;
grant execute on function fin_bank_mail_assign(uuid, uuid, boolean) to authenticated;

create or replace function fin_bank_mail_dismiss(p_pending uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  update fin_bank_mail_pending set done = true where id = p_pending and company_id = lab_company();
end $$;
revoke execute on function fin_bank_mail_dismiss(uuid) from public, anon;
grant execute on function fin_bank_mail_dismiss(uuid) to authenticated;

notify pgrst, 'reload schema';
