-- Kontrol Merkezi (admin): tüm sistemi tarayan denetim kuralları, sağlık skoru, eksik SQL güncellemesi kontrolü,
-- günlük sağlık geçmişi. Yalnız şirket sahibi ya da "Kullanıcılar: yönetir" yetkilisi. Tekrar çalıştırılabilir.

create table if not exists admin_health_log (
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  day date not null default current_date,
  score int not null,
  issues int not null,
  counts jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (company_id, day)
);
alter table admin_health_log enable row level security;
drop policy if exists admin_health_log_read on admin_health_log;
create policy admin_health_log_read on admin_health_log for select to authenticated using (company_id = lab_company() and (exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = admin_health_log.company_id and m.role = 'owner') or can_module('users', 3)));
grant select on admin_health_log to authenticated;
revoke insert, update, delete on admin_health_log from authenticated;

create or replace function adm_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = lab_company() and m.role = 'owner') or can_module('users', 3);
$$;
grant execute on function adm_allowed() to authenticated;

-- Tek bir denetim sorgusu: (id, label, link) dönen sorgunun sayısı ve ilk 8 örneği; tablo yoksa hata metni
create or replace function adm_run(p_sql text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; s jsonb;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  if n > 0 then
    execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''label'', label, ''link'', link)), ''[]'') from (select * from (%s) q limit 8) z', p_sql) into s;
  end if;
  return jsonb_build_object('count', n, 'sample', coalesce(s, '[]'));
exception when others then
  return jsonb_build_object('count', null, 'error', left(sqlerrm, 200));
end $$;
revoke execute on function adm_run(text) from public, anon, authenticated;

-- Denetim kuralları (yetki kontrolü çağıranda: admin_checks / admin_morning_report)
create or replace function adm_compute() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rules jsonb := '[]';
  out jsonb := '[]';
  r jsonb;
  res jsonb;
  pay_day int;
  cur text := to_char(current_date, 'YYYY-MM');
  prv text := to_char(current_date - interval '1 month', 'YYYY-MM');
  score numeric := 100;
  w numeric;
  issues int := 0;
  counts jsonb := '{}';
  emp text := 'from employees e where e.company_id = lab_company() and e.status::text <> ''terminated''';
begin
  select coalesce(salary_pay_day, 5) into pay_day from companies where id = lab_company();

  rules := jsonb_build_array(
    -- Personel / özlük
    jsonb_build_object('key', 'tc', 'area', 'personel', 'sev', 'high', 'title', 'TC kimlik no eksik / geçersiz', 'hint', 'SGK bildirimi ve bordro için zorunlu.', 'fix', '/personel',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name label, ''/personel/'' || e.id link from employees e left join employee_private p on p.employee_id = e.id where e.company_id = lab_company() and e.status::text <> ''terminated'' and coalesce(p.national_id, '''') !~ ''^[1-9][0-9]{10}$'''),
    jsonb_build_object('key', 'contract', 'area', 'personel', 'sev', 'high', 'title', 'Ücret kartı (sözleşme) olmayan personel', 'hint', 'Ücreti girilmeyen personelin bordrosu hesaplanmaz.', 'fix', '/personel',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name label, ''/personel/'' || e.id link ' || emp || ' and not exists (select 1 from pay_contracts k where k.employee_id = e.id)'),
    jsonb_build_object('key', 'iban', 'area', 'personel', 'sev', 'medium', 'title', 'IBAN girilmemiş personel', 'hint', 'Banka ödemesi ve banka ekstresi eşleştirmesi için gerekli.', 'fix', '/personel',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name label, ''/personel/'' || e.id link from employees e left join employee_private p on p.employee_id = e.id where e.company_id = lab_company() and e.status::text <> ''terminated'' and coalesce(p.iban, '''') = '''''),
    jsonb_build_object('key', 'docs_expired', 'area', 'personel', 'sev', 'medium', 'title', 'Süresi dolmuş özlük belgesi', 'hint', 'Yenisini yükleyin ya da süresini güncelleyin.', 'fix', '/ozluk-sihirbazi',
      'sql', 'select d.id::text id, e.first_name || '' '' || e.last_name || '' · '' || coalesce(t.name, d.file_name) || '' · '' || to_char(d.expires_on, ''DD.MM.YYYY'') label, ''/personel/'' || e.id link from employee_documents d join employees e on e.id = d.employee_id left join document_types t on t.id = d.document_type_id where e.company_id = lab_company() and e.status::text <> ''terminated'' and d.expires_on < current_date and not exists (select 1 from employee_documents d2 where d2.employee_id = d.employee_id and d2.document_type_id = d.document_type_id and coalesce(d2.expires_on, ''9999-12-31'') >= current_date)'),
    jsonb_build_object('key', 'docs_missing', 'area', 'personel', 'sev', 'medium', 'title', 'Zorunlu özlük belgesi eksik personel', 'hint', 'Özlük sihirbazından eksikleri tamamlayın.', 'fix', '/ozluk-sihirbazi',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name || '' · '' || (select count(*) from document_types t where t.required and t.category = ''ozluk'' and (t.company_id is null or t.company_id = e.company_id) and not exists (select 1 from employee_documents d where d.employee_id = e.id and d.document_type_id = t.id)) || '' belge'' label, ''/ozluk-sihirbazi/'' || e.id link ' || emp || ' and exists (select 1 from document_types t where t.required and t.category = ''ozluk'' and (t.company_id is null or t.company_id = e.company_id) and not exists (select 1 from employee_documents d where d.employee_id = e.id and d.document_type_id = t.id))'),
    jsonb_build_object('key', 'health', 'area', 'personel', 'sev', 'medium', 'title', 'Periyodik sağlık muayenesi süresi geçmiş', 'hint', 'İSG mevzuatı gereği yenilenmeli.', 'fix', '/isg',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name || '' · '' || to_char(max(h.expires_on), ''DD.MM.YYYY'') label, ''/personel/'' || e.id link from employees e join health_exams h on h.employee_id = e.id where e.company_id = lab_company() and e.status::text <> ''terminated'' group by e.id having max(h.expires_on) < current_date'),
    jsonb_build_object('key', 'sgk_code', 'area', 'personel', 'sev', 'low', 'title', 'SGK meslek kodu girilmemiş', 'hint', 'İşe giriş bildirgesi için gerekli.', 'fix', '/sgk',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name label, ''/personel/'' || e.id link ' || emp || ' and coalesce(e.sgk_occupation_code, '''') = '''''),
    jsonb_build_object('key', 'no_dept', 'area', 'personel', 'sev', 'low', 'title', 'Bölümü seçilmemiş personel', 'hint', 'Raporlar ve yetkiler bölüme göre çalışır.', 'fix', '/personel',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name label, ''/personel/'' || e.id link ' || emp || ' and e.department_id is null'),
    -- Bordro
    jsonb_build_object('key', 'period_open', 'area', 'bordro', 'sev', 'high', 'title', 'Bu ayın bordro dönemi açılmamış', 'hint', 'Dönem açılmadan hakediş yazılmaz.', 'fix', '/donemler',
      'sql', format('select %L id, %L label, ''/donemler/%s'' link where not exists (select 1 from payroll_periods where company_id = lab_company() and period = %L) and exists (select 1 %s)', cur, cur || ' dönemi', cur, cur, emp)),
    jsonb_build_object('key', 'period_close', 'area', 'bordro', 'sev', 'medium', 'title', 'Geçen ayın dönemi hâlâ açık', 'hint', 'Ödemeler bittiyse dönemi kapatın (kayıtlar kilitlenir).', 'fix', '/donemler',
      'sql', format('select period id, period || '' dönemi açık'' label, ''/donemler/'' || period link from payroll_periods where company_id = lab_company() and period < %L and status <> ''closed'' and extract(day from current_date) > 15', cur)),
    jsonb_build_object('key', 'unpaid', 'area', 'bordro', 'sev', 'high', 'title', 'Maaş günü geçti, ödemesi kalan personel', 'hint', 'Maaş planından ödeyin ya da kasa / bankayı seçin.', 'fix', format('/donemler/%s', prv),
      'sql', format('select s.employee_id::text id, e.first_name || '' '' || e.last_name || '' · '' || to_char(s.balance / 100.0, ''FM999G999G990D00'') || '' TL'' label, ''/donemler/%s'' link from ledger_period_summary s join employees e on e.id = s.employee_id where s.company_id = lab_company() and s.period = %L and s.balance > 100 and extract(day from current_date) > %s', prv, prv, pay_day)),
    jsonb_build_object('key', 'negative', 'area', 'bordro', 'sev', 'medium', 'title', 'Fazla ödenmiş (eksi bakiyeli) personel', 'hint', 'Avans fazla verilmiş ya da kayıt hatalı olabilir.', 'fix', format('/donemler/%s', cur),
      'sql', format('select s.employee_id::text id, e.first_name || '' '' || e.last_name || '' · '' || to_char(s.balance / 100.0, ''FM999G999G990D00'') || '' TL'' label, ''/personel/'' || e.id link from ledger_period_summary s join employees e on e.id = s.employee_id where s.company_id = lab_company() and s.period in (%L, %L) and s.balance < -100', cur, prv)),
    -- Puantaj / izin
    jsonb_build_object('key', 'open_punch', 'area', 'puantaj', 'sev', 'medium', 'title', 'Giriş var, çıkış okutulmamış (son 7 gün)', 'hint', 'Puantajdan çıkış saatini tamamlayın.', 'fix', '/puantaj',
      'sql', 'select x.employee_id::text || x.d id, e.first_name || '' '' || e.last_name || '' · '' || to_char(x.d, ''DD.MM'') label, ''/puantaj'' link from (select employee_id, (punched_at at time zone ''Europe/Istanbul'')::date d, (array_agg(direction::text order by punched_at desc))[1] last_dir from attendance_punches where company_id = lab_company() and employee_id is not null and punched_at > now() - interval ''8 days'' and (punched_at at time zone ''Europe/Istanbul'')::date < current_date group by 1, 2) x join employees e on e.id = x.employee_id where x.last_dir = ''IN'''),
    jsonb_build_object('key', 'leave_pending', 'area', 'puantaj', 'sev', 'medium', 'title', '3 günden uzun süredir onay bekleyen izin', 'hint', 'Talepler ekranından onaylayın ya da reddedin.', 'fix', '/talepler',
      'sql', 'select l.id::text id, e.first_name || '' '' || e.last_name || '' · '' || to_char(l.start_date, ''DD.MM'') label, ''/talepler'' link from leave_requests l join employees e on e.id = l.employee_id where l.company_id = lab_company() and l.status::text = ''pending'' and l.created_at < now() - interval ''3 days'''),
    jsonb_build_object('key', 'ot_pending', 'area', 'puantaj', 'sev', 'low', 'title', 'Onay bekleyen fazla mesai (3+ gün)', 'hint', 'Onaylanmayan mesai bordroya yansımaz.', 'fix', '/fazla-mesai',
      'sql', 'select o.id::text id, e.first_name || '' '' || e.last_name || '' · '' || to_char(o.work_date, ''DD.MM'') || '' · '' || o.minutes || '' dk'' label, ''/fazla-mesai'' link from overtime_records o join employees e on e.id = o.employee_id where o.company_id = lab_company() and o.status::text = ''pending'' and o.created_at < now() - interval ''3 days'''),
    -- Finans
    jsonb_build_object('key', 'cash_negative', 'area', 'finans', 'sev', 'high', 'title', 'Bakiyesi eksiye düşmüş kasa / banka', 'hint', 'Eksik girilmiş tahsilat ya da yanlış hesap seçimi olabilir.', 'fix', '/finans',
      'sql', 'select b.account_id::text id, b.name || '' · '' || to_char(b.balance / 100.0, ''FM999G999G990D00'') || '' '' || b.currency label, ''/finans/hesap/'' || b.account_id link from fin_account_balances b join fin_accounts a on a.id = b.account_id where a.company_id = lab_company() and a.kind in (''cash'', ''bank'') and a.is_active and b.balance < 0'),
    jsonb_build_object('key', 'bank_unmatched', 'area', 'finans', 'sev', 'medium', 'title', 'Bir haftadan eski eşleşmemiş banka satırı', 'hint', 'Banka ekstresi ekranından cari / personel ile eşleştirin.', 'fix', '/finans/banka-aktar',
      'sql', 'select l.id::text id, to_char(l.txn_date, ''DD.MM'') || '' · '' || left(coalesce(l.description, ''''), 50) || '' · '' || to_char(l.amount / 100.0, ''FM999G999G990D00'') label, ''/finans/banka-aktar'' link from fin_bank_lines l join fin_accounts a on a.id = l.account_id where a.company_id = lab_company() and l.status = ''new'' and l.txn_date < current_date - 7'),
    jsonb_build_object('key', 'cheque_overdue', 'area', 'finans', 'sev', 'medium', 'title', 'Vadesi geçmiş, portföyde bekleyen çek / senet', 'hint', 'Tahsil edildiyse işleyin, karşılıksızsa işaretleyin.', 'fix', '/finans/cek-senet',
      'sql', 'select ch.id::text id, coalesce(p.name, ch.drawer, ''—'') || '' · '' || to_char(ch.due_date, ''DD.MM.YYYY'') || '' · '' || to_char(ch.amount / 100.0, ''FM999G999G990D00'') label, ''/finans/cek-senet/'' || ch.id link from fin_cheques ch left join fin_parties p on p.id = ch.party_id where ch.company_id = lab_company() and ch.direction = ''in'' and ch.status in (''portfolio'', ''deposited'') and ch.due_date < current_date'),
    jsonb_build_object('key', 'over_limit', 'area', 'finans', 'sev', 'medium', 'title', 'Kredi limitini aşan cari', 'hint', 'Tahsilat yapın ya da limiti güncelleyin.', 'fix', '/finans/cariler',
      'sql', 'select b.party_id::text id, b.name || '' · '' || to_char(b.balance / 100.0, ''FM999G999G990D00'') label, ''/finans/cariler/'' || b.party_id link from fin_party_balances b join fin_parties p on p.id = b.party_id where p.company_id = lab_company() and p.credit_limit is not null and p.credit_limit > 0 and b.balance > p.credit_limit'),
    -- Laboratuvar
    jsonb_build_object('key', 'job_overdue', 'area', 'lab', 'sev', 'high', 'title', 'Teslim tarihi geçmiş açık iş', 'hint', 'Müşteri bekliyor: durumunu güncelleyin ya da teslim edin.', 'fix', '/isler',
      'sql', 'select j.id::text id, ''#'' || j.no || '' · '' || coalesce(c.name, '''') || '' · '' || to_char(j.due_date, ''DD.MM'') label, ''/isler/'' || j.id link from jobs j left join lab_customers c on c.id = j.customer_id where j.company_id = lab_company() and j.status in (''open'', ''tryin'', ''ready'') and j.due_date < current_date'),
    jsonb_build_object('key', 'job_zero', 'area', 'lab', 'sev', 'medium', 'title', 'Tutarı 0 olan iş (son 60 gün)', 'hint', 'Fiyatı girilmemiş iş ciroya ve ekstreye yansımaz.', 'fix', '/isler',
      'sql', 'select j.id::text id, ''#'' || j.no || '' · '' || coalesce(c.name, '''') || '' · '' || to_char(j.in_date, ''DD.MM'') label, ''/isler/'' || j.id link from jobs j left join lab_customers c on c.id = j.customer_id where j.company_id = lab_company() and j.status <> ''cancelled'' and coalesce(j.total, 0) = 0 and j.in_date > current_date - 60 and not exists (select 1 from job_items i where i.job_id = j.id and i.kind <> ''paid'')'),
    jsonb_build_object('key', 'job_stuck', 'area', 'lab', 'sev', 'high', 'title', 'Aşamasında takılı kalan iş (kabul 4 sa, üretim 48 sa, şef / kalite 12 sa, sevk 24 sa)', 'hint', 'İş akışı denetiminden sorumlu atayın ya da aşamayı ilerletin.', 'fix', '/yonetim/is-akisi',
      'sql', 'select j.id::text id, ''#'' || j.no || '' · '' || coalesce(c.name, '''') || '' · '' || j.flow_stage label, ''/yonetim/is-akisi'' link from jobs j left join lab_customers c on c.id = j.customer_id where j.id in (select adm_stuck_jobs())'),
    jsonb_build_object('key', 'cust_tax', 'area', 'lab', 'sev', 'low', 'title', 'Vergi no girilmemiş klinik / hastane / aracı kurum', 'hint', 'Fatura kesmek için gerekli.', 'fix', '/isler/hekimler',
      'sql', 'select c.id::text id, c.name label, ''/isler/hekimler/'' || c.id link from lab_customers c where c.company_id = lab_company() and c.is_active and c.kind in (''clinic'', ''hospital'', ''agency'') and coalesce(c.tax_no, '''') = '''' and coalesce(c.country, ''TR'') in (''TR'', ''Türkiye'')'),
    -- Stok
    jsonb_build_object('key', 'stock_negative', 'area', 'stok', 'sev', 'high', 'title', 'Eksi stok', 'hint', 'Mal kabulü girilmemiş ya da fazla çıkış yapılmış.', 'fix', '/stok',
      'sql', 'select i.id::text id, i.name || '' · '' || t.qty || '' '' || i.unit label, ''/stok/urunler/'' || i.id link from stk_item_totals t join stk_items i on i.id = t.item_id where i.company_id = lab_company() and t.qty < 0'),
    jsonb_build_object('key', 'stock_min', 'area', 'stok', 'sev', 'low', 'title', 'Minimum seviyenin altına düşen stok', 'hint', 'Satın alma önerisinden sipariş taslağı açın.', 'fix', '/alis/siparisler',
      'sql', 'select i.id::text id, i.name || '' · '' || coalesce(t.qty, 0) || '' / min '' || i.min_qty label, ''/stok/urunler/'' || i.id link from stk_items i left join stk_item_totals t on t.item_id = i.id where i.company_id = lab_company() and i.is_active and i.min_qty is not null and i.min_qty > 0 and coalesce(t.qty, 0) < i.min_qty'),
    jsonb_build_object('key', 'lot_expired', 'area', 'stok', 'sev', 'medium', 'title', 'Son kullanma tarihi geçmiş lot (stokta)', 'hint', 'Kullanılmamalı: imha / iade kaydı girin.', 'fix', '/stok',
      'sql', 'select s.item_id::text || coalesce(s.lot_no, '''') id, i.name || '' · lot '' || coalesce(s.lot_no, ''—'') || '' · SKT '' || to_char(s.expiry_date, ''DD.MM.YYYY'') label, ''/stok/urunler/'' || i.id link from stk_stock s join stk_items i on i.id = s.item_id where i.company_id = lab_company() and s.expiry_date < current_date and s.qty > 0'),
    -- Güvenlik / kullanıcılar
    jsonb_build_object('key', 'stale_users', 'area', 'guvenlik', 'sev', 'low', 'title', '30 gündür giriş yapmayan kullanıcı', 'hint', 'Ayrılan biriyse hesabını kapatın.', 'fix', '/yonetim',
      'sql', 'select m.user_id::text id, coalesce(nullif(m.display_name, ''''), u.email) || '' · '' || coalesce(to_char(u.last_sign_in_at, ''DD.MM.YYYY''), ''hiç girmedi'') label, ''/yonetim'' link from memberships m join auth.users u on u.id = m.user_id where m.company_id = lab_company() and (u.last_sign_in_at is null or u.last_sign_in_at < now() - interval ''30 days'')'),
    jsonb_build_object('key', 'owners', 'area', 'guvenlik', 'sev', 'medium', 'title', 'İkiden fazla "şirket sahibi" yetkili hesap', 'hint', 'Sahip yetkisi her şeyi silebilir; gerekmeyenleri kullanıcı türüne çevirin.', 'fix', '/yonetim',
      'sql', 'select m.user_id::text id, coalesce(nullif(m.display_name, ''''), u.email) label, ''/yonetim'' link from memberships m join auth.users u on u.id = m.user_id where m.company_id = lab_company() and m.role = ''owner'' and (select count(*) from memberships x where x.company_id = lab_company() and x.role = ''owner'') > 2'),
    jsonb_build_object('key', 'term_access', 'area', 'guvenlik', 'sev', 'high', 'title', 'İşten ayrıldığı hâlde hesabı açık personel', 'hint', 'Erişimini hemen kaldırın.', 'fix', '/yonetim',
      'sql', 'select e.id::text id, e.first_name || '' '' || e.last_name label, ''/yonetim'' link from employees e join memberships m on m.user_id = e.user_id and m.company_id = e.company_id where e.company_id = lab_company() and e.status::text = ''terminated'' and e.user_id is not null'),
    -- Veri kalitesi: mükerrer kayıtlar
    jsonb_build_object('key', 'dup_tc', 'area', 'veri', 'sev', 'high', 'title', 'Aynı TC kimlik no ile birden fazla personel', 'hint', 'Mükerrer kart: birini birleştirip diğerini silin.', 'fix', '/personel',
      'sql', 'select p.national_id id, string_agg(e.first_name || '' '' || e.last_name, '' · '') || '' (TC '' || p.national_id || '')'' label, ''/personel?q='' || p.national_id link from employee_private p join employees e on e.id = p.employee_id where e.company_id = lab_company() and coalesce(p.national_id, '''') <> '''' group by p.national_id having count(*) > 1'),
    jsonb_build_object('key', 'dup_emp_name', 'area', 'veri', 'sev', 'low', 'title', 'Aynı ad soyadla iki aktif personel', 'hint', 'Gerçekten iki kişi değilse birleştirin.', 'fix', '/personel',
      'sql', 'select lower(e.first_name || '' '' || e.last_name) id, min(e.first_name || '' '' || e.last_name) || '' · '' || count(*) || '' kart'' label, ''/personel?q='' || min(e.first_name) link from employees e where e.company_id = lab_company() and e.status::text <> ''terminated'' group by lower(e.first_name || '' '' || e.last_name) having count(*) > 1'),
    jsonb_build_object('key', 'dup_customer', 'area', 'veri', 'sev', 'medium', 'title', 'Aynı isimli hekim / klinik kartı', 'hint', 'İşler ve tahsilatlar iki karta bölünür; birleştirin.', 'fix', '/isler/hekimler',
      'sql', 'select lower(regexp_replace(c.name, ''[^[:alnum:]]'', '''', ''g'')) id, min(c.name) || '' · '' || count(*) || '' kart'' label, ''/isler/hekimler'' link from lab_customers c where c.company_id = lab_company() and c.is_active group by lower(regexp_replace(c.name, ''[^[:alnum:]]'', '''', ''g'')) having count(*) > 1'),
    jsonb_build_object('key', 'dup_party', 'area', 'veri', 'sev', 'medium', 'title', 'Aynı vergi numaralı iki cari kart', 'hint', 'Cari bakiyeler bölünür; birleştirin.', 'fix', '/finans/cariler',
      'sql', 'select p.tax_no id, string_agg(p.name, '' · '') || '' (VKN '' || p.tax_no || '')'' label, ''/finans/cariler'' link from fin_parties p where p.company_id = lab_company() and p.is_active and coalesce(p.tax_no, '''') <> '''' group by p.tax_no having count(*) > 1'),
    jsonb_build_object('key', 'dup_item', 'area', 'veri', 'sev', 'low', 'title', 'Aynı barkodlu iki stok kartı', 'hint', 'Okutmada yanlış karta düşer; birleştirin.', 'fix', '/stok',
      'sql', 'select i.barcode id, string_agg(i.name, '' · '') || '' (barkod '' || i.barcode || '')'' label, ''/stok'' link from stk_items i where i.company_id = lab_company() and i.is_active and coalesce(i.barcode, '''') <> '''' group by i.barcode having count(*) > 1')
  );

  for r in select * from jsonb_array_elements(rules) loop
    res := adm_run(r->>'sql');
    out := out || jsonb_build_array((r - 'sql') || res);
    if coalesce((res->>'count')::int, 0) > 0 then
      w := case r->>'sev' when 'high' then 7 when 'medium' then 3.5 else 1.2 end;
      score := score - w * (1 + least(1.5, log(greatest(1, (res->>'count')::numeric))) * 0.6);
      issues := issues + 1;
      counts := counts || jsonb_build_object(r->>'key', (res->>'count')::int);
    end if;
  end loop;
  score := greatest(0, round(score));

  insert into admin_health_log (day, score, issues, counts) values (current_date, score, issues, counts)
  on conflict on constraint admin_health_log_pkey do update set score = excluded.score, issues = excluded.issues, counts = excluded.counts, updated_at = now();

  return jsonb_build_object('score', score, 'issues', issues, 'checks', out,
    'history', coalesce((select jsonb_agg(jsonb_build_object('day', h.day, 'score', h.score, 'issues', h.issues) order by h.day) from (select * from admin_health_log where company_id = lab_company() order by day desc limit 30) h), '[]'));
end $$;
revoke execute on function adm_compute() from public, anon, authenticated;

create or replace function admin_checks() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not adm_allowed() then raise exception 'not_allowed'; end if;
  return adm_compute();
end $$;
revoke execute on function admin_checks() from public, anon;
grant execute on function admin_checks() to authenticated;

-- Sabah kontrol raporu (zamanlanmış görev, sunucu anahtarıyla): denetimleri çalıştırır, dünle karşılaştırır,
-- şirket sahibi / patron / "Kullanıcılar: yönetir" yetkililerine bildirim gönderir
create or replace function admin_morning_report() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := lab_company();
  y admin_health_log;
  res jsonb;
  rows jsonb;
  top text;
  newc text;
  targets uuid[];
  body text;
begin
  select * into y from admin_health_log where company_id = c and day < current_date order by day desc limit 1;
  res := adm_compute();
  rows := res->'checks';
  select string_agg(x->>'title' || ' (' || (x->>'count') || ')', ' · ' order by case x->>'sev' when 'high' then 0 when 'medium' then 1 else 2 end, (x->>'count')::int desc)
    into top from (select * from jsonb_array_elements(rows) x where coalesce((x->>'count')::int, 0) > 0 limit 4) t(x);
  select string_agg(x->>'title', ', ') into newc
    from jsonb_array_elements(rows) x
    where coalesce((x->>'count')::int, 0) > 0 and y.day is not null and not (y.counts ? (x->>'key'));
  targets := array(select m.user_id from memberships m where m.company_id = c and (m.role = 'owner' or m.is_boss or module_level_for(m.user_id, 'users') >= 3));
  body := 'Sağlık skoru ' || (res->>'score') ||
          case when y.day is not null then ' (' || case when (res->>'score')::int - y.score >= 0 then '+' else '' end || ((res->>'score')::int - y.score) || ')' else '' end ||
          case when (res->>'issues')::int = 0 then ' · her şey yolunda ✨' else ' · ' || (res->>'issues') || ' konu: ' || coalesce(top, '') end ||
          coalesce(' · YENİ: ' || newc, '');
  perform deliver(c, targets, '🛰 Sabah kontrol raporu', left(body, 900), '/yonetim/kontrol');
  return jsonb_build_object('score', res->'score', 'issues', res->'issues', 'sent_to', cardinality(targets), 'body', body);
end $$;
revoke execute on function admin_morning_report() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_morning_report() to service_role;
  end if;
end $$;

-- Hangi SQL güncellemesi çalıştırılmamış: verilen nesnelerden eksik olanlar ("t:tablo", "f:fonksiyon", "c:kısıt", "e:enum.değer", "k:tablo.sütun")
create or replace function admin_schema_missing(p_objects text[]) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare o text; missing text[] := '{}'; k text; n text;
begin
  if not adm_allowed() then raise exception 'not_allowed'; end if;
  foreach o in array p_objects loop
    k := split_part(o, ':', 1); n := substr(o, length(k) + 2);
    if (k = 't' and to_regclass('public.' || n) is null)
       or (k = 'f' and not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = n))
       or (k = 'c' and not exists (select 1 from pg_constraint where conname = n))
       or (k = 'k' and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = split_part(n, '.', 1) and column_name = split_part(n, '.', 2)))
       or (k = 'e' and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = split_part(n, '.', 1) and e.enumlabel = split_part(n, '.', 2)))
    then missing := missing || o; end if;
  end loop;
  return missing;
end $$;
revoke execute on function admin_schema_missing(text[]) from public, anon;
grant execute on function admin_schema_missing(text[]) to authenticated;

notify pgrst, 'reload schema';
