-- Açık işleri kapat: yalnız BUGÜN çıkacak (teslim tarihi bugün olan) işler açık kalır
--  * Diğer tüm açık / provadaki / hazır işler "teslim edildi" olur ve cariye yansır
--  * Teslim tarihi: işin çıkış tarihi (bugünden ileri ise bugün)
--  * Toplu işlemde ÜTS bildirimi, irsaliye, akış kaydı ve denetim kaydı oluşmaz
-- Bu dosya çalıştırıldığı anda kapatmayı da yapar. Tekrar çalıştırılabilir.
-- Önce 20270233000000_dsis_fix.sql.

create or replace function jobs_close_except_today(p_company uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Europe/Istanbul')::date; n int;
begin
  perform set_config('app.skip_audit', 'on', true);
  perform set_config('app.bulk', 'on', true);
  update jobs set status = 'delivered', flow_stage = 'out', holder_employee_id = null,
         delivered_at = ((least(coalesce(due_date, in_date), v_today)::timestamp + time '12:00') at time zone 'Europe/Istanbul')
  where company_id = p_company and status in ('open', 'tryin', 'ready')
    and due_date is distinct from v_today
    and (legacy_id > 0 or coalesce(due_date, in_date) < v_today);
  get diagnostics n = row_count;
  update job_steps s set done = true from jobs j
  where j.id = s.job_id and j.company_id = p_company and j.status = 'delivered' and not s.done;
  return n;
end $$;
revoke execute on function jobs_close_except_today(uuid) from public, anon, authenticated;

-- Aktarım ekranındaki düğme de aynı kuralı kullansın
create or replace function dsis_close_old(p_before date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard();
begin
  return jsonb_build_object('closed', jobs_close_except_today(c));
end $$;

-- Şimdi kapat
do $$
declare n int;
begin
  n := jobs_close_except_today(lab_company());
  raise notice 'Kapatılan iş: %', n;
end $$;

analyze jobs;
notify pgrst, 'reload schema';
