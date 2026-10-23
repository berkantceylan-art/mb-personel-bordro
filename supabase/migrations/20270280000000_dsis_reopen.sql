-- Dentalsis eşitleme: ERP'de kapalı ama Dentalsis'te açık işler yeniden açılır
--  16 Ekim'deki toplu "açık işleri kapat" ile teslim edildi görünen, Dentalsis'te hâlâ laboratuvarda / provada olan işler
--  (ve ERP'de iptal edilmiş ama Dentalsis'te açık olanlar) Dentalsis'teki duruma döner: atölye ekranındaki "kalan iş" doğru sayılır.
-- Önce 20270277000000_dsis_auto_sync.sql. Tekrar çalıştırılabilir.

create or replace function dsis_sync_jobs(p_jobs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); j jsonb; s jsonb; pr jsonb; v_job jobs; v_total bigint; v_cnt int; v_old_cnt int; v_status text; v_delivered timestamptz;
  v_kind text; v_amount bigint; v_qty int; v_unit bigint; v_prod uuid; v_sort int; v_cust uuid; v_teeth jsonb; v_received text[]; v_band text;
  v_desc text; v_new_sig text; v_old_sig text; k text; m text;
  n_items int := 0; n_cancel int := 0; n_status int := 0; n_same int := 0; n_info int := 0; n_steps int := 0; n_reopen int := 0;
begin
  perform set_config('app.skip_audit', 'on', true);
  perform set_config('app.bulk', 'on', true);
  for j in select * from jsonb_array_elements(coalesce(p_jobs, '[]')) loop
    select * into v_job from jobs where company_id = c and legacy_id = (j->>'id')::bigint;
    if v_job.id is null then continue; end if;

    -- Dentalsis'te silinmiş
    if coalesce((j->>'durum')::int, 1) <> 1 or coalesce((j->>'topluSil')::int, 0) <> 0 then
      if v_job.status <> 'cancelled' then
        update jobs set status = 'cancelled', holder_employee_id = null where id = v_job.id;
        n_cancel := n_cancel + 1;
      end if;
      continue;
    end if;

    -- İş bilgileri
    select id into v_cust from lab_customers where company_id = c and legacy_id = (j->>'cariid')::bigint;
    v_teeth := '{}'::jsonb;
    for k, m in select key, value #>> '{}' from jsonb_each(coalesce(j->'teeth', '{}')) loop
      if k ~ '^[1-4][1-8]$' and m ~ '^\d+$' and dsis_tooth_material(m::int) is not null then v_teeth := v_teeth || jsonb_build_object(k, dsis_tooth_material(m::int)); end if;
    end loop;
    v_received := array(select f from unnest(array['isirik', 'model', 'olcu', 'kasik', 'mum']) f where coalesce((j->'flags'->>f)::int, 0) <> 0);
    v_band := case when coalesce((j->'flags'->>'metalbant_cepecevre')::int, 0) <> 0 then 'circumferential'
                   when coalesce((j->'flags'->>'metalbant_var')::int, 0) <> 0 then 'yes'
                   when coalesce((j->'flags'->>'metalbant_yok')::int, 0) <> 0 then 'no' end;
    v_desc := left(nullif(concat_ws(E'\n', nullif(trim(j->>'aciklama'), ''),
                case when nullif(trim(coalesce(j->>'implantmm', '') || coalesce(j->>'vidacapi', '') || coalesce(j->>'taramakafasi', '')), '') is not null
                     then 'İmplant: ' || concat_ws(' · ', nullif(trim(j->>'implantmm'), ''), nullif(trim(j->>'vidacapi'), ''), nullif(trim(j->>'taramakafasi'), '')) end), ''), 4000);
    if v_job.slip_no is distinct from left(nullif(trim(j->>'fisno'), ''), 40)
       or v_job.doctor_name is distinct from left(nullif(trim(j->>'doktor'), ''), 120)
       or v_job.patient is distinct from left(nullif(trim(j->>'hasta'), ''), 120)
       or v_job.shade is distinct from left(nullif(trim(j->>'disrenk'), ''), 30)
       or v_job.shade_cervical is distinct from left(nullif(trim(j->>'disrenk1'), ''), 30)
       or v_job.shade_incisal is distinct from left(nullif(trim(j->>'disrenk2'), ''), 30)
       or v_job.description is distinct from v_desc
       or v_job.due_date is distinct from dsis_ts(j->>'tarih2')::date
       or v_job.delivery_method is distinct from left(nullif(trim(j->>'teslimad'), ''), 80)
       or coalesce(v_job.teeth, '{}'::jsonb) <> v_teeth
       or coalesce(v_job.received, '{}') <> v_received
       or v_job.metal_band is distinct from v_band
       or (v_cust is not null and v_cust <> v_job.customer_id) then
      update jobs set slip_no = left(nullif(trim(j->>'fisno'), ''), 40), doctor_name = left(nullif(trim(j->>'doktor'), ''), 120),
             patient = left(nullif(trim(j->>'hasta'), ''), 120), shade = left(nullif(trim(j->>'disrenk'), ''), 30),
             shade_cervical = left(nullif(trim(j->>'disrenk1'), ''), 30), shade_incisal = left(nullif(trim(j->>'disrenk2'), ''), 30),
             description = v_desc, due_date = coalesce(dsis_ts(j->>'tarih2')::date, due_date), delivery_method = left(nullif(trim(j->>'teslimad'), ''), 80),
             teeth = v_teeth, received = v_received, metal_band = v_band, customer_id = coalesce(v_cust, customer_id)
       where id = v_job.id;
      n_info := n_info + 1;
    end if;

    -- Kalemler: ücretli toplam ya da kalem sayısı farklıysa yeniden yaz
    select coalesce(sum(case when coalesce((x->>'ucretsiz')::int, 0) = 0 and coalesce((x->>'rpt')::int, 0) = 0 and coalesce((x->>'tamir')::int, 0) = 0
                                  and coalesce((x->>'duzeltme')::int, 0) = 0 then greatest(round(coalesce((x->>'tutar')::numeric, 0) * 100)::bigint, 0) else 0 end), 0),
           count(*)
      into v_total, v_cnt
      from jsonb_array_elements(coalesce(j->'stoklar', '[]')) x
     where coalesce(x->>'durum', '1') = '1' and coalesce((x->>'topluSil')::int, 0) = 0;
    select count(*) into v_old_cnt from job_items where job_id = v_job.id;
    if v_total <> v_job.total or v_cnt <> v_old_cnt then
      delete from job_items where job_id = v_job.id;
      v_sort := 0;
      for s in select * from jsonb_array_elements(coalesce(j->'stoklar', '[]')) loop
        if coalesce(s->>'durum', '1') <> '1' or coalesce((s->>'topluSil')::int, 0) <> 0 then continue; end if;
        v_kind := case when coalesce((s->>'ucretsiz')::int, 0) <> 0 then 'free' when coalesce((s->>'rpt')::int, 0) <> 0 then 'rpt'
                       when coalesce((s->>'tamir')::int, 0) <> 0 then 'repair' when coalesce((s->>'duzeltme')::int, 0) <> 0 then 'adjust' else 'paid' end;
        v_qty := least(99, greatest(1, round(coalesce((s->>'miktar')::numeric, 1))::int));
        v_amount := case when v_kind = 'paid' then greatest(round(coalesce((s->>'tutar')::numeric, 0) * 100)::bigint, 0) else 0 end;
        v_unit := greatest(0, round(coalesce((s->>'fiyat')::numeric, 0) * 100)::bigint);
        select id into v_prod from lab_products where company_id = c and legacy_id = (s->>'stokid')::bigint;
        insert into job_items (job_id, product_id, name, qty, unit_price, amount, kind, sort)
        values (v_job.id, v_prod, left(coalesce(nullif(trim(s->>'stokad'), ''), 'Kalem'), 160), v_qty, v_unit, v_amount, v_kind, v_sort);
        v_sort := v_sort + 1;
      end loop;
      update jobs set total = v_total where id = v_job.id;
      n_items := n_items + 1;
    else
      n_same := n_same + 1;
    end if;

    -- Provalar (atölye / prova aşaması): farklıysa yeniden yazılır
    select coalesce(string_agg(concat_ws('|', left(coalesce(nullif(trim(x->>'provaturu'), ''), 'Prova'), 80),
                                coalesce(dsis_ts(x->>'teslimtarihi'), dsis_ts(x->>'tarih2'))::date, dsis_ts(x->>'tarih1')::date,
                                coalesce(x->>'teslim', '0') = '1'), ';' order by (x->>'id')::bigint), '')
      into v_new_sig
      from jsonb_array_elements(coalesce(j->'provalar', '[]')) x where coalesce((x->>'topluSil')::int, 0) = 0;
    select coalesce(string_agg(concat_ws('|', kind, out_date, back_date, done), ';' order by sort), '') into v_old_sig from job_steps where job_id = v_job.id;
    if v_new_sig <> v_old_sig then
      delete from job_steps where job_id = v_job.id;
      v_sort := 0;
      for pr in select * from jsonb_array_elements(coalesce(j->'provalar', '[]')) order by (value->>'id')::bigint loop
        if coalesce((pr->>'topluSil')::int, 0) <> 0 then continue; end if;
        insert into job_steps (job_id, kind, out_date, back_date, delivery_method, done, note, sort)
        values (v_job.id, left(coalesce(nullif(trim(pr->>'provaturu'), ''), 'Prova'), 80),
                coalesce(dsis_ts(pr->>'teslimtarihi'), dsis_ts(pr->>'tarih2'))::date, dsis_ts(pr->>'tarih1')::date,
                left(nullif(trim(pr->>'teslimad'), ''), 80), coalesce(pr->>'teslim', '0') = '1',
                left(nullif('Çıkış: ' || nullif(trim(pr->>'cikisyapanad'), ''), 'Çıkış: '), 500), v_sort);
        v_sort := v_sort + 1;
      end loop;
      n_steps := n_steps + 1;
    end if;

    -- Durum: teslim edildi / provada / laboratuvarda (iptal ve teslim edilmiş işe geri dokunulmaz)
    if j->>'provaturu' = 'BİTİM' and coalesce(j->>'teslim', '0') = '1' then v_status := 'delivered';
    elsif coalesce(j->>'teslim', '0') = '1' then v_status := 'tryin';
    else v_status := 'open'; end if;
    if v_job.status in ('open', 'tryin', 'ready') and v_status = 'delivered' then
      select max(dsis_ts(x->>'teslimtarihi')) into v_delivered from jsonb_array_elements(coalesce(j->'provalar', '[]')) x
       where x->>'provaturu' = 'BİTİM' and coalesce(x->>'teslim', '0') = '1';
      update jobs set status = 'delivered', flow_stage = 'out', holder_employee_id = null,
             delivered_at = coalesce(v_delivered, dsis_ts(j->>'tarih2'), now())
       where id = v_job.id;
      n_status := n_status + 1;
    elsif v_job.status in ('open', 'ready') and v_status = 'tryin' then
      update jobs set status = 'tryin', flow_stage = 'tryin' where id = v_job.id;
      n_status := n_status + 1;
    elsif v_job.status = 'tryin' and v_status = 'open' then
      -- provadan döndü, laboratuvarda
      update jobs set status = 'open', flow_stage = case when flow_stage = 'tryin' then 'reception' else flow_stage end where id = v_job.id;
      n_status := n_status + 1;
    elsif v_job.status in ('delivered', 'cancelled') and v_status in ('open', 'tryin') then
      -- ERP'de kapalı (toplu kapatma / iptal) ama Dentalsis'te hâlâ açık: Dentalsis geçerli, iş yeniden açılır
      update jobs set status = v_status, delivered_at = null, holder_employee_id = null,
             flow_stage = case when v_status = 'tryin' then 'tryin' else 'reception' end
       where id = v_job.id;
      n_reopen := n_reopen + 1;
    end if;
  end loop;
  return jsonb_build_object('items_updated', n_items, 'info_updated', n_info, 'steps_updated', n_steps, 'cancelled', n_cancel, 'status_updated', n_status, 'reopened', n_reopen, 'unchanged', n_same);
end $$;
revoke execute on function dsis_sync_jobs(jsonb) from public, anon;
grant execute on function dsis_sync_jobs(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
