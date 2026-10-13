-- =====================================================================
-- BANKA EKSTRESİ ↔ PERSONEL ÖDEMELERİ
--  fin_bank_lines.suggested_employee_id / suggested_period : çıkan havalede personel adı / IBAN geçiyorsa öneri
--  fin_bank_suggest_line   : önceki kurallar + personel eşleştirmesi (ad soyad ya da IBAN)
--  fin_bank_post_payroll(satır, dönem, kalemler) : ekstre satırını bir ya da çok personelin maaş / avans
--      ödemesi olarak işler (toplu maaş dosyası = tek banka satırı, çok personel); tek finans işlemi
--  void_ledger_entry       : personel ödemesi geri alınınca bağlı finans işlemi de iptal, ekstre satırı yeniden
--      "bekliyor" olur; toplu (çok kişilik) ekstre ödemesinden tek kişi geri alınamaz → fin_bank_unpost_payroll
-- Tekrar çalıştırılabilir. Önce 20261225000000_bank_recon.sql ve 20270114000000_payroll_pay.sql.
-- =====================================================================
alter table fin_bank_lines add column if not exists suggested_employee_id uuid references employees (id) on delete set null;
alter table fin_bank_lines add column if not exists suggested_period char(7);

create or replace function bank_norm(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'İIŞĞÜÖÇışğüöçÂâ', 'iisguocisguocaa'));
$$;

create or replace function fin_bank_suggest_line(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l fin_bank_lines; v_txn uuid; v_party uuid; v_cat uuid; v_reason text; r record; v_desc text; v_emp uuid; v_emp_name text;
begin
  select * into l from fin_bank_lines where id = p_id;
  if l.id is null or l.status not in ('new') then return; end if;
  v_desc := bank_norm(l.description);
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
  -- 1b) çıkan para: personel (IBAN ya da ad soyad açıklamada)
  if l.amount < 0 then
    select e.id, e.first_name || ' ' || e.last_name into v_emp, v_emp_name
    from employees e left join employee_private ep on ep.employee_id = e.id
    join fin_accounts a on a.id = l.account_id and a.company_id = e.company_id
    where (ep.iban is not null and length(ep.iban) >= 16 and replace(v_desc, ' ', '') like '%' || lower(replace(ep.iban, ' ', '')) || '%')
       or (length(e.first_name) >= 2 and length(e.last_name) >= 2 and e.last_name <> '-'
           and v_desc like '%' || bank_norm(e.first_name) || '%' and v_desc like '%' || bank_norm(e.last_name) || '%')
    order by (ep.iban is not null and replace(v_desc, ' ', '') like '%' || lower(replace(coalesce(ep.iban, ''), ' ', '')) || '%') desc,
             (e.status = 'active') desc, length(e.first_name || e.last_name) desc
    limit 1;
    if v_emp is not null then
      update fin_bank_lines set suggested_employee_id = v_emp,
             suggested_period = to_char(l.txn_date - 15, 'YYYY-MM'),
             suggest_reason = 'Personel: ' || v_emp_name
      where id = p_id;
      return;
    end if;
  end if;
  -- 2) kural
  select * into r from fin_bank_rules
  where company_id = lab_company() and (direction = 'any' or (direction = 'in') = (l.amount > 0))
    and v_desc like '%' || bank_norm(pattern) || '%'
  order by length(pattern) desc, hits desc limit 1;
  if r.id is not null then
    v_party := r.party_id; v_cat := r.category_id; v_reason := 'Kural: ' || r.pattern;
  else
    -- 3) cari adı (ilk anlamlı kelime ≥ 4 harf) ya da IBAN açıklamada
    select p.id, 'Açıklamada cari adı / IBAN geçiyor' into v_party, v_reason
    from fin_parties p
    where p.is_active and (
      (p.iban is not null and length(p.iban) >= 16 and replace(v_desc, ' ', '') like '%' || lower(replace(p.iban, ' ', '')) || '%')
      or (length(p.name) >= 5 and v_desc like '%' || bank_norm(split_part(regexp_replace(p.name, '^(dr\.?|dt\.?|diş hekimi)\s+', '', 'i'), ' ', 1) || ' ' || coalesce(nullif(split_part(regexp_replace(p.name, '^(dr\.?|dt\.?|diş hekimi)\s+', '', 'i'), ' ', 2), ''), '')) || '%')
    )
    order by (p.iban is not null and replace(v_desc, ' ', '') like '%' || lower(replace(p.iban, ' ', '')) || '%') desc,
             case when l.amount > 0 then p.kind in ('customer', 'both') else p.kind in ('supplier', 'both') end desc, length(p.name) desc
    limit 1;
  end if;
  update fin_bank_lines set suggested_party_id = v_party, suggested_category_id = v_cat, suggest_reason = v_reason where id = p_id;
end $$;
revoke execute on function fin_bank_suggest_line(uuid) from public, anon, authenticated;

-- Ekstre satırını personel ödemesi olarak işle: p_items = [{employee_id, amount (kuruş), type?: SALARY|ADVANCE}]
create or replace function fin_bank_post_payroll(p_line uuid, p_period text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := lab_company();
  l fin_bank_lines; a fin_accounts; it jsonb; v_emp employees; v_amount bigint; v_type text; v_sum bigint := 0; v_n int := 0;
  v_cat uuid; v_txn uuid; v_ids uuid[] := '{}'; v_entry uuid; v_names text := '';
begin
  if v_company is null or not can_manage_pay(v_company) then raise exception 'not_allowed'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  if period_is_closed(v_company, p_period) then raise exception 'period_closed'; end if;
  select * into l from fin_bank_lines where id = p_line for update;
  if l.id is null then raise exception 'not_found'; end if;
  select * into a from fin_accounts where id = l.account_id and company_id = v_company;
  if a.id is null then raise exception 'not_found'; end if;
  if l.status not in ('new') then raise exception 'already_done'; end if;
  if l.amount >= 0 then raise exception 'not_outgoing'; end if;
  if a.currency <> 'TRY' then raise exception 'account_currency'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_sum := v_sum + coalesce(nullif(it ->> 'amount', '')::bigint, 0);
  end loop;
  if v_sum <> -l.amount then raise exception 'sum_mismatch:%', v_sum; end if;
  v_cat := pay_salary_category();
  for it in select * from jsonb_array_elements(p_items) loop
    v_amount := nullif(it ->> 'amount', '')::bigint;
    if coalesce(v_amount, 0) <= 0 then continue; end if;
    v_type := coalesce(nullif(it ->> 'type', ''), 'SALARY');
    if v_type not in ('SALARY', 'ADVANCE') then raise exception 'bad_type'; end if;
    select * into v_emp from employees where id = (it ->> 'employee_id')::uuid and company_id = v_company;
    if v_emp.id is null then raise exception 'employee_not_found'; end if;
    insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note, account_id)
    values (v_company, v_emp.id, p_period, l.txn_date, v_type::ledger_type, 'BANK'::ledger_channel, v_amount,
            case v_type when 'ADVANCE' then 'Avans' else 'Maaş ödemesi' end || ' · ' || a.name || ' (ekstreden)', a.id)
    returning id into v_entry;
    v_ids := v_ids || v_entry;
    v_n := v_n + 1;
    if v_n <= 3 then v_names := v_names || case when v_n > 1 then ', ' else '' end || v_emp.first_name || ' ' || v_emp.last_name; end if;
  end loop;
  v_txn := fin_post_sys(
    jsonb_build_object('kind', 'expense', 'txn_date', l.txn_date, 'description', left('Maaş / avans · ' || p_period || ' · ' || v_names || case when v_n > 3 then ' +' || (v_n - 3) || ' kişi' else '' end, 500),
                       'doc_no', l.bank_ref, 'amount', -l.amount, 'currency', 'TRY', 'account_id', a.id, 'category_id', v_cat, 'ref_type', 'payroll_bank', 'ref_id', l.id),
    jsonb_build_array(
      jsonb_build_object('account_id', a.id, 'amount', l.amount, 'description', left(l.description, 300)),
      jsonb_build_object('category_id', v_cat, 'amount', -l.amount)));
  update ledger_entries set fin_txn_id = v_txn where id = any (v_ids);
  update fin_bank_lines set status = 'posted', txn_id = v_txn, handled_by = auth.uid(), handled_at = now() where id = p_line;
  return v_n;
end $$;
revoke execute on function fin_bank_post_payroll(uuid, text, jsonb) from public, anon;
grant execute on function fin_bank_post_payroll(uuid, text, jsonb) to authenticated;

-- Cari hareket iptali (tek yol): bağlı finans işlemi de iptal edilir; toplu ödemeden tek kişi geri alınamaz
create or replace function void_ledger_entry(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_txn uuid; v_others int;
begin
  select company_id, fin_txn_id into v_company, v_txn from ledger_entries where id = p_id;
  if v_company is null or not can_manage_pay(v_company) then
    raise exception 'Yetki yok';
  end if;
  if coalesce(length(p_reason), 0) = 0 then
    raise exception 'İptal gerekçesi zorunlu';
  end if;
  if v_txn is not null then
    select count(*) into v_others from ledger_entries where fin_txn_id = v_txn and voided_at is null and id <> p_id;
    if v_others > 0 then
      raise exception 'Bu ödeme bankadaki toplu bir ödemenin parçası; tek kişi geri alınamaz. Maaş planı › Banka eşleştirme ekranından ekstre satırının tamamını geri alıp yeniden dağıtın.';
    end if;
  end if;
  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_id and voided_at is null;
  if found and v_txn is not null then
    perform fin_void_sys(v_txn, 'Personel ödemesi iptal: ' || p_reason);
    update fin_bank_lines set status = 'new', txn_id = null, handled_by = null, handled_at = null where txn_id = v_txn and status = 'posted';
  end if;
end $$;

-- Ekstreden işlenen personel ödemesini (tüm kişileriyle) geri al; satır yeniden "bekliyor" olur
create or replace function fin_bank_unpost_payroll(p_line uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_company uuid := lab_company(); l fin_bank_lines; n int;
begin
  if v_company is null or not can_manage_pay(v_company) then raise exception 'not_allowed'; end if;
  select bl.* into l from fin_bank_lines bl join fin_accounts a on a.id = bl.account_id and a.company_id = v_company where bl.id = p_line for update of bl;
  if l.id is null or l.txn_id is null then raise exception 'not_found'; end if;
  if exists (select 1 from ledger_entries where fin_txn_id = l.txn_id and voided_at is null and period_is_closed(company_id, period)) then raise exception 'period_closed'; end if;
  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = 'Banka eşleştirmesi geri alındı'
  where fin_txn_id = l.txn_id and voided_at is null;
  get diagnostics n = row_count;
  perform fin_void_sys(l.txn_id, 'Banka eşleştirmesi geri alındı');
  update fin_bank_lines set status = 'new', txn_id = null, handled_by = null, handled_at = null where id = p_line;
  perform fin_bank_suggest_line(p_line);
  return n;
end $$;
revoke execute on function fin_bank_unpost_payroll(uuid) from public, anon;
grant execute on function fin_bank_unpost_payroll(uuid) to authenticated;

notify pgrst, 'reload schema';
