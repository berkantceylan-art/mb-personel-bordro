-- Patron ekranı v2: ödeme takvimi için maaş günü, muhtasar (GV + DV) tahakkuk / ödeme takibi
alter table companies add column if not exists salary_pay_day smallint not null default 5
  check (salary_pay_day between 1 and 28);   -- maaşlar sonraki ayın bu gününde ödenir

alter table sgk_payments
  add column if not exists tax_accrued bigint not null default 0 check (tax_accrued >= 0),  -- muhtasar tahakkuku (kuruş)
  add column if not exists tax_paid bigint not null default 0 check (tax_paid >= 0),
  add column if not exists tax_paid_on date;
