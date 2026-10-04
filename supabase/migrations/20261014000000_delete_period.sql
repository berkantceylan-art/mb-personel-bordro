-- =====================================================================
-- Dönemi komple silme (yalnız şirket sahibi)
-- Dönemin tüm cari hareketleri, bordro satırları, icra kesintileri,
-- fazla mesai kayıtları ve dönem kaydı silinir. Kapalı dönem silinemez
-- (önce yeniden açılmalı). Önceki kapalı dönemden gelen devir hareketleri
-- korunur; silinirse önceki dönemin bakiyesi kaybolurdu.
-- =====================================================================

create or replace function delete_period(p_period text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_prev text;
  n_ledger int := 0; n_payroll int := 0; n_garn int := 0; n_ot int := 0; n_kept int := 0;
begin
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Geçersiz dönem'; end if;
  select m.company_id into v_company from memberships m
  where m.user_id = auth.uid() and m.role = 'owner' limit 1;
  if v_company is null then raise exception 'Dönemi yalnız şirket sahibi silebilir'; end if;
  if period_is_closed(v_company, p_period) then
    raise exception '% dönemi kapalı; silmek için önce yeniden açın', p_period;
  end if;
  v_prev := to_char((p_period || '-01')::date - interval '1 month', 'YYYY-MM');

  -- Silinecek hareketler: önceki kapalı dönemden gelen devirler hariç
  create temp table _del on commit drop as
    select id from ledger_entries
    where company_id = v_company and period = p_period
      and not (system_tag = 'carry:' || v_prev and voided_at is null and period_is_closed(v_company, v_prev));
  select count(*) into n_kept from ledger_entries
    where company_id = v_company and period = p_period and system_tag = 'carry:' || v_prev
      and voided_at is null and period_is_closed(v_company, v_prev);
  -- Bu dönemin daha önce geri alınmış devirleri (sonraki dönemde iptal satırları)
  insert into _del select id from ledger_entries
    where company_id = v_company and system_tag = 'carry:' || p_period and voided_at is not null;

  -- Bağlantıları çöz
  update ledger_entries set corrects_id = null where corrects_id in (select id from _del) and id not in (select id from _del);
  update advance_requests set ledger_entry_id = null where ledger_entry_id in (select id from _del);
  delete from overtime_ledger_links where ledger_entry_id in (select id from _del);
  update overtime_records set ledger_entry_id = null where ledger_entry_id in (select id from _del);

  delete from garnishment_deductions where company_id = v_company and period = p_period;
  get diagnostics n_garn = row_count;
  delete from payroll_lines where company_id = v_company and period = p_period;
  get diagnostics n_payroll = row_count;
  delete from overtime_records where company_id = v_company and period = p_period;
  get diagnostics n_ot = row_count;
  delete from ledger_entries where id in (select id from _del);
  get diagnostics n_ledger = row_count;
  delete from payroll_periods where company_id = v_company and period = p_period;

  insert into audit_log (company_id, table_name, row_id, action, new_data)
  values (v_company, 'payroll_periods', p_period, 'DELETE_PERIOD',
          json_build_object('ledger', n_ledger, 'payroll_lines', n_payroll, 'garnishment', n_garn, 'overtime', n_ot, 'kept_carry', n_kept)::jsonb);

  return json_build_object('ledger', n_ledger, 'payroll', n_payroll, 'garnishment', n_garn, 'overtime', n_ot, 'kept', n_kept);
end $$;

revoke all on function delete_period(text) from public, anon;
grant execute on function delete_period(text) to authenticated;

notify pgrst, 'reload schema';
