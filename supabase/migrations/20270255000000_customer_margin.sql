-- Müşteri bazında fiyat ve kârlılık: hekime özel fiyatlar + son dönem satış adet / ciro (ürün maliyetiyle karşılaştırma uygulamada)
create or replace function prd_customer_margin(p_from date default (current_date - interval '12 months')::date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); v jsonb;
begin
  if not (prd_cost_can() or has_role(c, array['owner', 'accountant']::app_role[])) then raise exception 'not_allowed'; end if;
  perform set_config('statement_timeout', '60s', true);
  select jsonb_build_object(
    'eur', coalesce(fx_rate('EUR', current_date), 0),
    'usd', coalesce(fx_rate('USD', current_date), 0),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', lc.id, 'name', lc.name, 'kind', lc.kind, 'cur', lc.currency, 'city', lc.city) order by lc.name)
                             from lab_customers lc where lc.company_id = c), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object('c', p.customer_id, 'p', p.product_id, 't', p.price_try, 'e', p.price_eur))
                          from lab_customer_prices p join lab_customers lc on lc.id = p.customer_id and lc.company_id = c), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(jsonb_build_object('c', s.customer_id, 'p', s.product_id, 'cur', s.cur, 'q', s.q, 'r', s.r, 'last', s.last))
                         from (select j.customer_id, i.product_id, upper(j.currency) as cur, sum(i.qty)::int as q, sum(i.amount)::bigint as r, max(j.in_date) as last
                                 from job_items i
                                 join jobs j on j.id = i.job_id
                                where j.company_id = c and j.status <> 'cancelled' and j.customer_id is not null and i.product_id is not null
                                  and i.kind = 'paid' and i.amount > 0 and j.in_date >= p_from and coalesce(j.patient, '') <> 'DEVİR BAKİYESİ'
                                group by 1, 2, 3) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke execute on function prd_customer_margin(date) from public, anon;
grant execute on function prd_customer_margin(date) to authenticated;

notify pgrst, 'reload schema';
