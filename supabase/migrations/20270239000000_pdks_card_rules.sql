-- PDKS kart kuralları: bazı cihaz numaraları hiç alınmaz (personel olmayan, yalnız kapıdan geçenler),
-- bazıları başka bir personele bağlanır (ör. cihaz yöneticisi 00001 → parmak izi sahibi).
-- Kart no karşılaştırması baştaki sıfırlar atılarak yapılır.
create table if not exists pdks_card_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  card_no text not null check (card_no ~ '^[0-9]{1,12}$'),
  action text not null check (action in ('IGNORE', 'MAP')),
  employee_id uuid references employees (id) on delete cascade,
  note text check (note is null or length(note) <= 120),
  created_at timestamptz not null default now(),
  unique (company_id, card_no),
  check ((action = 'MAP') = (employee_id is not null))
);
alter table pdks_card_rules enable row level security;
drop policy if exists pdks_card_rules_read on pdks_card_rules;
create policy pdks_card_rules_read on pdks_card_rules for select to authenticated
  using (company_id = (select lab_company()) and (select can_manage_hr(company_id)));
revoke all on pdks_card_rules from anon;
grant select on pdks_card_rules to authenticated;

-- Personel olmayan, yalnız giriş-çıkış yapanlar: hiç alınmaz, eski kayıtları silinir
insert into pdks_card_rules (card_no, action, note) values
  ('35179', 'IGNORE', 'Engin Bilgin — personel değil'),
  ('35132', 'IGNORE', 'Mustafa Kuşçu — personel değil')
on conflict (company_id, card_no) do nothing;
delete from attendance_punches p
using pdks_card_rules r
where r.action = 'IGNORE' and p.company_id = r.company_id
  and ltrim(p.card_no, '0') = ltrim(r.card_no, '0') and p.employee_id is null;

-- Cihaz yöneticisi (parmak izi) 00001 → Berkant Ceylan
insert into pdks_card_rules (card_no, action, employee_id, note)
select '1', 'MAP', e.id, 'Cihaz yöneticisi (parmak izi)'
from employees e
where e.company_id = lab_company() and e.first_name ilike 'berkant' and e.last_name ilike 'ceylan'
order by e.created_at limit 1
on conflict (company_id, card_no) do nothing;
update attendance_punches p
set employee_id = r.employee_id, branch_id = e.branch_id
from pdks_card_rules r join employees e on e.id = r.employee_id
where r.action = 'MAP' and p.company_id = r.company_id
  and ltrim(p.card_no, '0') = ltrim(r.card_no, '0') and p.employee_id is null;

select card_no, action, note, employee_id is not null as bagli from pdks_card_rules order by card_no;
