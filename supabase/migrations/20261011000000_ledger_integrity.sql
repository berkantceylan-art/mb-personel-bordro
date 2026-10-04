-- =====================================================================
-- Migration 9: Kayıt güvenilirliği (denetim raporu 2. adım)
--  Y2  Kapalı dönem: iptal / düzeltme / bordro / kesinti değişikliği de yasak
--  Y3  Dönem kapanışında bakiye devri (sonraki aya aktarım), açınca geri alma
--  Y4  BES-icra kesintisi yazma ve fazla mesai onayı tek işlem (ya hep ya hiç, çift kayıt yok)
-- =====================================================================

create or replace function period_is_closed(p_company uuid, p_period text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from payroll_periods where company_id = p_company and period = p_period and status = 'closed');
$$;

-- Y2a) Cari hareket: kapalı dönemdeki hareket iptal edilemez
create or replace function ledger_entries_guard() returns trigger
language plpgsql as $$
begin
  if old.voided_at is not null then
    raise exception 'İptal edilmiş hareket değiştirilemez';
  end if;
  if (new.employee_id, new.period, new.entry_date, new.type, new.channel, new.amount)
     is distinct from (old.employee_id, old.period, old.entry_date, old.type, old.channel, old.amount) then
    raise exception 'Cari hareket değiştirilemez; iptal edip yeni hareket girin';
  end if;
  if new.voided_at is not null and period_is_closed(old.company_id, old.period) then
    raise exception '% dönemi kapalı; bu dönemin hareketi iptal edilemez. Önce dönemi açın.', old.period;
  end if;
  return new;
end $$;

-- Y2b) Bordro satırları ve icra kesintileri kapalı dönemde değişmez
create or replace function guard_closed_period_rows() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := coalesce(new, old);
  if period_is_closed(r.company_id, r.period) or (tg_op = 'UPDATE' and period_is_closed(old.company_id, old.period)) then
    raise exception '% dönemi kapalı; değişiklik yapılamaz. Önce dönemi açın.', r.period;
  end if;
  return r;
end $$;
drop trigger if exists closed_period_guard on payroll_lines;
create trigger closed_period_guard before insert or update or delete on payroll_lines
  for each row execute function guard_closed_period_rows();
drop trigger if exists closed_period_guard on garnishment_deductions;
create trigger closed_period_guard before insert or update or delete on garnishment_deductions
  for each row execute function guard_closed_period_rows();

-- ---------------------------------------------------------------------
-- Y3) Dönem kapanışı ve bakiye devri
-- ---------------------------------------------------------------------
alter table ledger_entries add column if not exists system_tag text;
create index if not exists ledger_entries_system_tag on ledger_entries (company_id, system_tag) where system_tag is not null;

create or replace function next_period(p text) returns text language sql immutable as $$
  select to_char((p || '-01')::date + interval '1 month', 'YYYY-MM');
$$;

-- Kapanış: her personelin kalan bakiyesi (alacak +, borç −) sonraki aya devredilir, sonra dönem kilitlenir
create or replace function close_period(p_period text)
returns json language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_next text := next_period(p_period); n int := 0; r record; tag text := 'carry:' || p_period;
begin
  select m.company_id into v_company from memberships m
  where m.user_id = auth.uid() and m.role in ('owner', 'accountant') limit 1;
  if v_company is null then raise exception 'Yetki yok'; end if;
  if period_is_closed(v_company, p_period) then raise exception '% dönemi zaten kapalı', p_period; end if;
  if period_is_closed(v_company, v_next) then raise exception 'Sonraki dönem (%) kapalı; devir yapılamaz', v_next; end if;
  perform 1 from payroll_periods where company_id = v_company and period = p_period for update;

  for r in
    select employee_id,
           sum(case when type in ('ACCRUAL', 'BONUS', 'OVERTIME', 'ADJUSTMENT') then amount else -amount end) as balance
    from ledger_entries
    where company_id = v_company and period = p_period and voided_at is null
    group by employee_id
    having sum(case when type in ('ACCRUAL', 'BONUS', 'OVERTIME', 'ADJUSTMENT') then amount else -amount end) <> 0
  loop
    insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note, system_tag)
    values (v_company, r.employee_id, p_period, ((p_period || '-01')::date + interval '1 month - 1 day')::date, 'ADJUSTMENT', 'NONE',
            -r.balance, 'Devir: ' || v_next || ' dönemine aktarıldı', tag),
           (v_company, r.employee_id, v_next, (v_next || '-01')::date, 'ADJUSTMENT', 'NONE',
            r.balance, 'Devir: ' || p_period || ' döneminden', tag);
    n := n + 1;
  end loop;

  insert into payroll_periods (company_id, period, status, closed_at, closed_by)
  values (v_company, p_period, 'closed', now(), auth.uid())
  on conflict (company_id, period) do update set status = 'closed', closed_at = now(), closed_by = auth.uid();
  return json_build_object('carried', n, 'next', v_next);
end $$;

-- Açma: devir hareketleri iptal edilir (sonraki dönem kapalıysa önce o açılmalı)
create or replace function reopen_period(p_period text)
returns json language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_next text := next_period(p_period); n int;
begin
  select m.company_id into v_company from memberships m
  where m.user_id = auth.uid() and m.role in ('owner', 'accountant') limit 1;
  if v_company is null then raise exception 'Yetki yok'; end if;
  if period_is_closed(v_company, v_next) then raise exception 'Önce sonraki dönemi (%) açın', v_next; end if;
  update payroll_periods set status = 'open', closed_at = null, closed_by = null where company_id = v_company and period = p_period;
  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = 'Dönem yeniden açıldı; devir geri alındı'
  where company_id = v_company and system_tag = 'carry:' || p_period and voided_at is null;
  get diagnostics n = row_count;
  return json_build_object('voided', n);
end $$;
revoke execute on function close_period(text) from public, anon;
revoke execute on function reopen_period(text) from public, anon;

-- ---------------------------------------------------------------------
-- Y4a) Bordro kesintilerini cariye yazma — tek işlem
-- ---------------------------------------------------------------------
create or replace function post_payroll_deductions(p_period text)
returns json language plpgsql security definer set search_path = public as $$
declare v_company uuid; l record; g jsonb; f garnishment_files; v_entry uuid; v_date date; n_lines int := 0; n_ded int := 0;
begin
  select m.company_id into v_company from memberships m
  where m.user_id = auth.uid() and m.role in ('owner', 'accountant') limit 1;
  if v_company is null then raise exception 'Yetki yok'; end if;
  v_date := ((p_period || '-01')::date + interval '1 month - 1 day')::date;
  for l in select * from payroll_lines where company_id = v_company and period = p_period and posted = false for update loop
    if l.bes > 0 then
      insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, pay_side, note)
      values (v_company, l.employee_id, p_period, v_date, 'BES', 'NONE', l.bes, 'OFFICIAL', 'BES otomatik katılım kesintisi');
      n_ded := n_ded + 1;
    end if;
    for g in select * from jsonb_array_elements(coalesce(l.data -> 'result' -> 'garnishments', '[]'::jsonb)) loop
      if coalesce((g ->> 'amount')::bigint, 0) <= 0 then continue; end if;
      select * into f from garnishment_files where id = (g ->> 'fileId')::uuid and company_id = v_company;
      if f.id is null then raise exception 'İcra dosyası bulunamadı'; end if;
      insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, pay_side, note)
      values (v_company, l.employee_id, p_period, v_date, 'GARNISHMENT', 'NONE', (g ->> 'amount')::bigint, 'OFFICIAL',
              trim((case when f.kind = 'ALIMONY' then 'Nafaka' else 'İcra' end) || ' · ' || coalesce(f.office, '') || ' ' || coalesce(f.file_no, '')))
      returning id into v_entry;
      insert into garnishment_deductions (company_id, file_id, employee_id, period, amount, ledger_entry_id)
      values (v_company, f.id, l.employee_id, p_period, (g ->> 'amount')::bigint, v_entry)
      on conflict (file_id, period) do update set amount = excluded.amount, ledger_entry_id = excluded.ledger_entry_id;
      n_ded := n_ded + 1;
    end loop;
    update payroll_lines set posted = true where id = l.id;
    n_lines := n_lines + 1;
  end loop;
  return json_build_object('lines', n_lines, 'deductions', n_ded);
end $$;

create or replace function unpost_payroll_deductions(p_period text)
returns json language plpgsql security definer set search_path = public as $$
declare v_company uuid; n int;
begin
  select m.company_id into v_company from memberships m
  where m.user_id = auth.uid() and m.role in ('owner', 'accountant') limit 1;
  if v_company is null then raise exception 'Yetki yok'; end if;
  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = 'Bordro kesintileri geri alındı'
  where company_id = v_company and period = p_period and type in ('BES', 'GARNISHMENT') and voided_at is null;
  get diagnostics n = row_count;
  delete from garnishment_deductions where company_id = v_company and period = p_period;
  update payroll_lines set posted = false where company_id = v_company and period = p_period;
  return json_build_object('voided', n);
end $$;
revoke execute on function post_payroll_deductions(text) from public, anon;
revoke execute on function unpost_payroll_deductions(text) from public, anon;

-- ---------------------------------------------------------------------
-- Y4b) Fazla mesai cari hareketleri: öncekiler iptal + yenileri tek işlemde (çift onay = çift ödeme olmaz)
-- p_lines: [{"side":"OFFICIAL"|"CASH","amount":kuruş,"gross":kuruş|null,"note":"..."}]
-- ---------------------------------------------------------------------
create or replace function set_overtime_ledger(p_overtime uuid, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare o overtime_records; x jsonb; v_entry uuid; n int := 0;
begin
  select * into o from overtime_records where id = p_overtime for update;
  if o.id is null or not can_manage_pay(o.company_id) then raise exception 'Yetki yok'; end if;
  update ledger_entries le set voided_at = now(), voided_by = auth.uid(), void_reason = 'Fazla mesai yeniden onaylandı'
  from overtime_ledger_links k
  where k.overtime_id = o.id and le.id = k.ledger_entry_id and le.voided_at is null;
  delete from overtime_ledger_links where overtime_id = o.id;
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((x ->> 'amount')::bigint, 0) <= 0 then continue; end if;
    insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, pay_side, gross_amount, note)
    values (o.company_id, o.employee_id, o.period, o.work_date, 'OVERTIME', 'NONE', (x ->> 'amount')::bigint,
            x ->> 'side', nullif(x ->> 'gross', '')::bigint, x ->> 'note')
    returning id into v_entry;
    insert into overtime_ledger_links (overtime_id, ledger_entry_id) values (o.id, v_entry);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function set_overtime_ledger(uuid, jsonb) from public, anon;

-- API şema önbelleğini yenile (yeni fonksiyonlar hemen görünsün)
notify pgrst, 'reload schema';
