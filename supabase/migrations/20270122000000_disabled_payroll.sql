-- Engelli personel: bordroda engellilik indirimi (GVK md. 31) ve işveren SGK teşviki (4857 md. 30 / 14857).
-- Engellilik bilgisi özel nitelikli veridir (employee_private); bordro hesaplayan kişi yalnız derece ve teşvik
-- bilgisini bu fonksiyonla görür, oranın kendisi İK / sahipte kalır.
-- Tekrar çalıştırılabilir.

alter table employee_private add column if not exists disability_report_until date;
alter table employee_private add column if not exists disability_incentive boolean not null default true;

create or replace function pay_disability() returns table (employee_id uuid, tax_degree int, incentive boolean, report_until date)
language sql stable security definer set search_path = public as $$
  select p.employee_id,
         case when p.disability_degree >= 80 then 1 when p.disability_degree >= 60 then 2 when p.disability_degree >= 40 then 3 else 0 end,
         p.disability_incentive and coalesce(p.disability_degree, 0) >= 40,
         p.disability_report_until
  from employee_private p
  join employees e on e.id = p.employee_id
  where p.disabled and can_manage_pay(e.company_id);
$$;
revoke execute on function pay_disability() from public, anon;
grant execute on function pay_disability() to authenticated;

-- 2026 tutarları yasal parametrelere (varsa) eklenir: aylık 12.000 / 7.000 / 3.000 TL (kuruş)
do $$ begin
  if to_regclass('public.legal_params') is not null then
    update legal_params set data = jsonb_set(data, '{disabilityDeduction}', '[1200000, 700000, 300000]'::jsonb)
    where year = 2026 and not (data ? 'disabilityDeduction');
  end if;
end $$;

notify pgrst, 'reload schema';
