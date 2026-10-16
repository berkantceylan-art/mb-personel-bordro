-- Hekime özel fiyat listesi: her hekimin geçmiş işlerinden (Dentalsis'ten aktarılanlar dahil) ürün başına
-- EN SON uygulanan birim fiyatı özel fiyat olarak yazar. Elle girilmiş özel fiyatlara dokunmaz (p_overwrite = false).
create or replace function lab_prices_from_history(p_customer uuid default null, p_overwrite boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); n_ins int := 0; n_upd int := 0; n_cust int := 0;
begin
  if not (can_logistics() or has_role(c, array['owner']::app_role[])) then raise exception 'not_allowed'; end if;
  perform set_config('statement_timeout', '60s', true);
  create temp table _last on commit drop as
    select distinct on (j.customer_id, i.product_id)
           j.customer_id, i.product_id, upper(j.currency) as cur, i.unit_price
      from job_items i
      join jobs j on j.id = i.job_id
      join lab_customers lc on lc.id = j.customer_id and lc.company_id = c
     where j.company_id = c and j.status <> 'cancelled' and i.product_id is not null
       and i.kind = 'paid' and i.unit_price > 0 and coalesce(j.patient, '') <> 'DEVİR BAKİYESİ'
       and (p_customer is null or j.customer_id = p_customer)
     order by j.customer_id, i.product_id, coalesce(j.delivered_at, j.in_date::timestamptz) desc, j.no desc;

  insert into lab_customer_prices (customer_id, product_id, price_try, price_eur)
  select customer_id, product_id, case when cur = 'TRY' then unit_price end, case when cur = 'EUR' then unit_price end
    from _last where cur in ('TRY', 'EUR')
  on conflict (customer_id, product_id) do nothing;
  get diagnostics n_ins = row_count;

  if p_overwrite then
    update lab_customer_prices p
       set price_try = case when l.cur = 'TRY' then l.unit_price else p.price_try end,
           price_eur = case when l.cur = 'EUR' then l.unit_price else p.price_eur end
      from _last l where l.customer_id = p.customer_id and l.product_id = p.product_id and l.cur in ('TRY', 'EUR');
    get diagnostics n_upd = row_count;
    n_upd := greatest(0, n_upd - n_ins);
  end if;
  select count(distinct customer_id) into n_cust from _last;
  return jsonb_build_object('added', n_ins, 'updated', n_upd, 'customers', n_cust);
end $$;
revoke execute on function lab_prices_from_history(uuid, boolean) from public, anon;
grant execute on function lab_prices_from_history(uuid, boolean) to authenticated;
