-- Dentalsis yeniden eşitleme
--  * dsis_sync_jobs: daha önce aktarılmış işleri Dentalsis'teki son haline getirir
--      - Dentalsis'te silinen iş → ERP'de iptal
--      - kalemler / tutar değiştiyse kalemler yeniden yazılır, toplam güncellenir
--      - durum yalnız ileri gider (açık → provada → teslim)
--  * dsis_year_summary: 2016–2025 her hekim için yıl yıl ciro ve tahsilat (Dentalsis özeti)
-- Önce 20270231000000_dentalsis_import.sql. Tekrar çalıştırılabilir.

create or replace function dsis_sync_jobs(p_jobs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); j jsonb; s jsonb; v_job jobs; v_total bigint; v_cnt int; v_old_cnt int; v_status text; v_delivered timestamptz;
  v_kind text; v_amount bigint; v_qty int; v_unit bigint; v_prod uuid; v_sort int;
  n_items int := 0; n_cancel int := 0; n_status int := 0; n_same int := 0;
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

    -- Durum yalnız ileri (ERP'de iptal edilmiş / teslim edilmiş işe dokunma)
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
    elsif v_job.status = 'open' and v_status = 'tryin' then
      update jobs set status = 'tryin', flow_stage = 'tryin' where id = v_job.id;
      n_status := n_status + 1;
    end if;
  end loop;
  return jsonb_build_object('items_updated', n_items, 'cancelled', n_cancel, 'status_updated', n_status, 'unchanged', n_same);
end $$;
revoke execute on function dsis_sync_jobs(jsonb) from public, anon;
grant execute on function dsis_sync_jobs(jsonb) to authenticated;

-- 2016–2025 hekim bazında yıllık özet
create table if not exists dsis_year_summary (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  customer_id uuid not null references lab_customers (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  currency text not null check (currency in ('TRY', 'EUR', 'USD')),
  revenue bigint not null default 0,            -- kuruş / cent: ücretli kalemler
  collected bigint not null default 0,          -- tahsilat
  jobs int not null default 0,
  units numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (customer_id, year, currency)
);
alter table dsis_year_summary enable row level security;
drop policy if exists dsis_year_summary_read on dsis_year_summary;
create policy dsis_year_summary_read on dsis_year_summary for select to authenticated
  using (company_id = lab_company() and (can_logistics() or prd_cost_can() or has_role(lab_company(), array['owner', 'accountant']::app_role[])));

-- p: [{cariid, cariad, year, currency, revenue, collected, jobs, units}] (tutarlar ondalıklı para)
create or replace function dsis_set_year_summary(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); r jsonb; v uuid; n int := 0; m int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    select id into v from lab_customers where company_id = c and legacy_id = (r->>'cariid')::bigint;
    if v is null then select id into v from lab_customers where company_id = c and dsis_norm(name) = dsis_norm(r->>'cariad') limit 1; end if;
    if v is null then m := m + 1; continue; end if;
    insert into dsis_year_summary (company_id, customer_id, year, currency, revenue, collected, jobs, units, updated_at)
    values (c, v, (r->>'year')::int, dsis_cur(r->>'currency'), round(coalesce((r->>'revenue')::numeric, 0) * 100)::bigint,
            round(coalesce((r->>'collected')::numeric, 0) * 100)::bigint, coalesce((r->>'jobs')::int, 0), coalesce((r->>'units')::numeric, 0), now())
    on conflict (customer_id, year, currency) do update set revenue = excluded.revenue, collected = excluded.collected, jobs = excluded.jobs, units = excluded.units, updated_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('summary_rows', n, 'summary_unmatched', m);
end $$;
revoke execute on function dsis_set_year_summary(jsonb) from public, anon;
grant execute on function dsis_set_year_summary(jsonb) to authenticated;

notify pgrst, 'reload schema';
