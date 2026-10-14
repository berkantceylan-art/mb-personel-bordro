-- =====================================================================
-- GENEL MUHASEBE · düzeltmeler (bağımsız inceleme sonrası)
--  1) Yıl sonu 7/A yansıtma: yıl içinde yapılmış yansıtmalar hesaba katılır (çift yansıtma ve dengesiz kapanış önlenir)
--  2) KDV mahsubu ve dönem fişleri alt hesaplı planda en alt hesaplara yazılır (191.18 gibi alt hesaplar kapanır)
--  3) Kur değerleme hedefi muhasebe fişlerindeki döviz tutarından hesaplanır (muhasebe dışı / bekleyen hareketler sayılmaz)
--  4) Kapanış fişleri sonraki dönem işlemlerini bozmaz; kapanış için bekleyen fiş ve açık KDV olmamalı
--  5) Her finans işlemi bir kez fişlenir (toplu girişte performans); fiş numarasında eşzamanlılık kilidi
--  6) Fiş tarihi başka yıla taşınırsa yıl / numara güncellenir; şirket silinirken kilit engel olmaz
--  7) Yardımcı fonksiyonların dışarıdan çağrılması kapatıldı; Kontrol Merkezi: kapanıştan sonra kapanmış yıla düşen kayıt
-- Tekrar çalıştırılabilir. Önce 20270208000000_gl_close.sql.
-- =====================================================================

-- Kayıt kabul eden hesap: kendisi en alt hesapsa kendisi, değilse ilk alt hesabı
create or replace function gl_postable_id(p_code text) returns uuid language sql stable security definer set search_path = public as $$
  select id from gl_accounts
  where company_id = lab_company() and is_active and (code = p_code or code like p_code || '.%') and postable
  order by (code = p_code) desc, string_to_array(code, '.') limit 1;
$$;
revoke execute on function gl_postable_id(text) from public, anon, authenticated;

create or replace function gl_add_line(p_v uuid, p_code text, p_amount bigint, p_desc text) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid; n int;
begin
  if coalesce(p_amount, 0) = 0 then return; end if;
  a := gl_postable_id(p_code);
  if a is null then
    insert into gl_accounts (company_id, code, name, kind, normal_side)
    select lab_company(), t.code, t.name, gl_kind_of(t.code), gl_side_of(t.code, t.name) from gl_tdhp() t where t.code = p_code
    on conflict do nothing returning id into a;
    if a is null then select id into a from gl_accounts where company_id = lab_company() and code = p_code; end if;
    if a is null then raise exception 'gl_account_missing:%', p_code; end if;
  end if;
  select coalesce(max(sort), 0) + 1 into n from gl_lines where voucher_id = p_v;
  insert into gl_lines (voucher_id, sort, account_id, debit, credit, description) values (p_v, n, a, greatest(p_amount, 0), greatest(-p_amount, 0), left(p_desc, 300));
end $$;
revoke execute on function gl_add_line(uuid, text, bigint, text) from public, anon, authenticated;

-- Kapanış fişleri, kapanış tarihinde ve sonrasında hesaplanan dönem bakiyelerine girmez
create or replace function gl_code_balance(p_code text, p_to date, p_from date default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date <= p_to and (p_from is null or v.voucher_date >= p_from)
    and (a.code = p_code or a.code like p_code || '.%')
    and not (v.source = 'closing' and v.voucher_date >= p_to);
$$;
revoke execute on function gl_code_balance(text, date, date) from public, anon, authenticated;

create or replace function gl_leaf_balances(p_prefix text, p_from date, p_to date) returns table (code text, bal bigint)
language sql stable security definer set search_path = public as $$
  select a.code, sum(l.debit - l.credit)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date between p_from and p_to and a.code like p_prefix || '%'
  group by a.code having sum(l.debit - l.credit) <> 0 order by a.code;
$$;
revoke execute on function gl_leaf_balances(text, date, date) from public, anon, authenticated;

-- Hesabın alt hesapları tek tek kapatılır (tarihe kadar, kapanış fişleri hariç)
drop function if exists gl_close_leaves(uuid, text, date, text);
create or replace function gl_close_leaves(p_v uuid, p_code text, p_to date, p_desc text, p_incl_closing boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; tot bigint := 0; n int;
begin
  for r in select a.id, sum(l.debit - l.credit)::bigint bal
           from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
           where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date <= p_to and v.id <> p_v
             and (a.code = p_code or a.code like p_code || '.%') and (p_incl_closing or not (v.source = 'closing' and v.voucher_date >= p_to))
           group by a.id having sum(l.debit - l.credit) <> 0 loop
    select coalesce(max(sort), 0) + 1 into n from gl_lines where voucher_id = p_v;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, description) values (p_v, n, r.id, greatest(-r.bal, 0), greatest(r.bal, 0), left(p_desc, 300));
    tot := tot + r.bal;
  end loop;
  return tot;
end $$;
revoke execute on function gl_close_leaves(uuid, text, date, text, boolean) from public, anon, authenticated;

create or replace function gl_vat_close(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; v uuid; x391 bigint; x191 bigint; x190 bigint;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  d := (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('vat:' || p_month, d, 'mahsup', 'vat', 'KDV mahsubu · ' || p_month);
  x391 := -gl_close_leaves(v, '391', d, 'Hesaplanan KDV kapatıldı');
  x191 := gl_close_leaves(v, '191', d, 'İndirilecek KDV kapatıldı');
  x190 := gl_code_balance('190', d);
  if x391 >= x191 + x190 then
    perform gl_close_leaves(v, '190', d, 'Devreden KDV mahsup edildi');
    perform gl_add_line(v, '360', -(x391 - x191 - x190), 'Ödenecek KDV · ' || p_month);
  else
    perform gl_add_line(v, '190', x191 - x391, 'Sonraki aya devreden KDV');
  end if;
  return gl_finish(v);
end $$;
revoke execute on function gl_vat_close(text) from public, anon;
grant execute on function gl_vat_close(text) to authenticated;

-- Kur değerleme: hedef = fişlerdeki döviz tutarı toplamı × kur
create or replace function gl_fx_revalue(p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; r record; target bigint; cur bigint; diff bigint; gain bigint := 0; loss bigint := 0; n int := 0; rt numeric;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  v := gl_tag_voucher('fx:' || p_date, p_date, 'mahsup', 'fx', 'Kur değerleme · ' || to_char(p_date, 'DD.MM.YYYY'));
  for r in
    select a.id gl_id, l.currency cur, sum(l.fx_amount)::bigint fx, sum(l.debit - l.credit)::bigint booked_fx_lines
    from gl_lines l join gl_vouchers x on x.id = l.voucher_id join gl_accounts a on a.id = l.account_id
    where x.company_id = lab_company() and x.status = 'posted' and x.voucher_date <= p_date and x.id <> v
      and l.currency <> 'TRY' and l.fx_amount is not null and left(a.code, 1) in ('1', '2', '3', '4')
    group by a.id, l.currency
  loop
    -- aynı hesapta birden çok döviz varsa atla (tek döviz cinsli hesaplar değerlenir)
    if (select count(distinct l2.currency) from gl_lines l2 where l2.account_id = r.gl_id and l2.currency <> 'TRY' and l2.fx_amount is not null) > 1 then continue; end if;
    rt := fin_rate(r.cur, p_date);
    if rt is null or rt <= 0 then continue; end if;
    target := round(r.fx * rt);
    select coalesce(sum(l.debit - l.credit), 0) into cur from gl_lines l join gl_vouchers x on x.id = l.voucher_id
    where l.account_id = r.gl_id and x.status = 'posted' and x.voucher_date <= p_date and x.id <> v and not (x.source = 'closing' and x.voucher_date >= p_date);
    diff := target - cur;
    if diff = 0 then continue; end if;
    n := n + 1;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, description, currency, rate)
    values (v, n, r.gl_id, greatest(diff, 0), greatest(-diff, 0), 'Kur farkı · ' || r.cur || ' ' || round(rt, 4), r.cur, rt);
    if diff > 0 then gain := gain + diff; else loss := loss - diff; end if;
  end loop;
  perform gl_add_line(v, '646', -gain, 'Kambiyo kârı (değerleme)');
  perform gl_add_line(v, '656', loss, 'Kambiyo zararı (değerleme)');
  return gl_finish(v) || jsonb_build_object('gain', gain, 'loss', loss);
end $$;
revoke execute on function gl_fx_revalue(date) from public, anon;
grant execute on function gl_fx_revalue(date) to authenticated;

create or replace function gl_close_year(p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date := make_date(p_year, 1, 1); t date := make_date(p_year, 12, 31); v uuid; r record; total bigint; res bigint; out jsonb := '{}'; y record;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if gl_locked(lab_company(), t) then raise exception 'gl_locked'; end if;
  if exists (select 1 from gl_vouchers where company_id = lab_company() and status = 'pending' and voucher_date between f and t) then raise exception 'gl_pending_in_year'; end if;
  if gl_code_balance('391', t) <> 0 or gl_code_balance('191', t) <> 0 then raise exception 'gl_vat_open'; end if;

  -- 1) 7/A: yansıtılmamış kalan gider (gider bakiyesi + yansıtma hesabı bakiyesi) 6xx'e; gider ve yansıtma hesapları kapanır
  v := gl_tag_voucher('close7:' || p_year, t, 'mahsup', 'closing', 'Gider yansıtma ve 7 sınıfı kapanışı · ' || p_year);
  for y in select * from (values ('710', '711', '620'), ('720', '721', '620'), ('730', '731', '620'), ('740', '741', '622'), ('750', '751', '630'), ('760', '761', '631'), ('770', '771', '632'), ('780', '781', '660')) z(src, refl, dst) loop
    total := gl_code_balance(y.src, t, f) + gl_code_balance(y.refl, t, f);
    perform gl_add_line(v, y.dst, total, 'Yansıtma · ' || y.src);
    perform gl_close_leaves(v, y.src, t, 'Kapanış · ' || y.src, true);
    perform gl_close_leaves(v, y.refl, t, 'Kapanış · ' || y.refl, true);
  end loop;
  out := out || jsonb_build_object('reflect', gl_finish(v));

  -- 2) gelir tablosu hesapları → 690
  v := gl_tag_voucher('close6:' || p_year, t, 'kapanis', 'closing', 'Gelir tablosu hesaplarının kapanışı · ' || p_year);
  res := 0;
  for r in select distinct left(code, 3) c from gl_leaf_balances('6', f, t) where left(code, 3) not in ('690', '691', '692') loop
    res := res + gl_close_leaves(v, r.c, t, 'Kapanış → 690', true);
  end loop;
  perform gl_add_line(v, '690', res, 'Dönem kârı veya zararı');
  out := out || jsonb_build_object('income', gl_finish(v));

  -- 3) 690 + 691 → 692 → 590 / 591
  v := gl_tag_voucher('close69:' || p_year, t, 'kapanis', 'closing', 'Dönem net kârı / zararı · ' || p_year);
  res := gl_close_leaves(v, '690', t, 'Kapanış → 692', true) + gl_close_leaves(v, '691', t, 'Kapanış → 692', true);
  if res <> 0 then
    perform gl_add_line(v, '692', res, 'Dönem net kârı veya zararı');
    perform gl_add_line(v, '692', -res, 'Kapanış');
    perform gl_add_line(v, case when res < 0 then '590' else '591' end, res, case when res < 0 then 'Dönem net kârı' else 'Dönem net zararı' end);
  end if;
  out := out || jsonb_build_object('result', gl_finish(v), 'net_profit', -res);

  -- 4) bilanço kapanışı ve 5) yeni yıl açılışı
  v := gl_tag_voucher('closebs:' || p_year, t, 'kapanis', 'closing', 'Bilanço hesaplarının kapanışı · ' || p_year);
  for r in select distinct left(a.code, 3) c from gl_accounts a where a.company_id = lab_company() and left(a.code, 1) in ('1', '2', '3', '4', '5') and not a.code ~ '\.' order by 1 loop
    perform gl_close_leaves(v, r.c, t, 'Kapanış', true);
  end loop;
  out := out || jsonb_build_object('balance', gl_finish(v));

  v := gl_tag_voucher('open:' || (p_year + 1), make_date(p_year + 1, 1, 1), 'acilis', 'opening', 'Açılış fişi · ' || (p_year + 1));
  insert into gl_lines (voucher_id, sort, account_id, debit, credit, description)
  select v, l.sort, l.account_id, l.credit, l.debit, 'Açılış' from gl_lines l join gl_vouchers x on x.id = l.voucher_id
  where x.company_id = lab_company() and x.tag = 'closebs:' || p_year and x.status = 'posted';
  out := out || jsonb_build_object('opening', gl_finish(v));
  return out;
end $$;
revoke execute on function gl_close_year(int) from public, anon;
grant execute on function gl_close_year(int) to authenticated;

-- Fiş numarası: şirket + yıl başına kilit (eşzamanlı kayıtta çakışma olmaz)
create or replace function gl_next_no(p_company uuid, p_year int) returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('gl_no:' || p_company::text || ':' || p_year));
  select coalesce(max(no), 0) + 1 into n from gl_vouchers where company_id = p_company and year = p_year;
  return n;
end $$;
revoke execute on function gl_next_no(uuid, int) from public, anon, authenticated;

-- Tarih başka yıla taşınırsa yıl ve fiş no güncellenir
create or replace function gl_voucher_year() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voucher_date is distinct from old.voucher_date and extract(year from new.voucher_date)::int <> new.year then
    new.year := extract(year from new.voucher_date)::int;
    new.no := gl_next_no(new.company_id, new.year);
    new.journal_no := null;
  end if;
  return new;
end $$;
drop trigger if exists gl_voucher_year on gl_vouchers;
create trigger gl_voucher_year before update of voucher_date on gl_vouchers for each row execute function gl_voucher_year();

-- Kilit: şirket silinirken (zincirleme silme) engel olmaz
create or replace function gl_lock_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('gl.unlock', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op in ('UPDATE', 'DELETE') and gl_locked(old.company_id, old.voucher_date) and (tg_op = 'DELETE' or new.status <> old.status or new.voucher_date <> old.voucher_date) then
    raise exception 'gl_locked';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and gl_locked(new.company_id, new.voucher_date) and new.status = 'posted' and (tg_op = 'INSERT' or new.voucher_date <> old.voucher_date) then
    raise exception 'gl_locked';
  end if;
  return coalesce(new, old);
end $$;

-- Her işlem, işlem sonunda bir kez fişlenir
create or replace function gl_on_fin() returns trigger language plpgsql security definer set search_path = public as $$
declare v_txn uuid := (case when tg_table_name = 'fin_txns' then to_jsonb(coalesce(new, old))->>'id' else to_jsonb(coalesce(new, old))->>'txn_id' end)::uuid;
  seen text := coalesce(current_setting('gl.seen', true), '');
begin
  if v_txn is null or position(v_txn::text in seen) > 0 then return null; end if;
  perform set_config('gl.seen', right(seen || ',' || v_txn::text, 100000), true);
  begin
    perform gl_post_txn(v_txn);
  exception when others then
    begin
      insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, issues, fin_txn_id)
      select t.company_id, extract(year from t.txn_date)::int, gl_next_no(t.company_id, extract(year from t.txn_date)::int), t.txn_date, 'mahsup', 'auto', 'pending',
             left(coalesce(t.description, t.kind), 500), left('Hata: ' || sqlerrm, 1000), t.id
      from fin_txns t join gl_settings s on s.company_id = t.company_id where t.id = v_txn and s.enabled and t.txn_date >= s.start_date
      on conflict (fin_txn_id) do update set status = 'pending', issues = excluded.issues where gl_vouchers.status <> 'cancelled';
    exception when others then null; end;
  end;
  return null;
end $$;

-- Yardımcılar dışarıdan çağrılamaz
revoke execute on function gl_map_get(uuid, text, text) from public, anon, authenticated;
revoke execute on function gl_locked(uuid, date) from public, anon, authenticated;
revoke execute on function gl_cash_salary_excluded(fin_txns) from public, anon, authenticated;

create or replace function adm_extra_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_array(
    jsonb_build_object('key', 'uts_error', 'area', 'stok', 'sev', 'high', 'title', 'ÜTS''ye iletilemeyen bildirim', 'hint', 'Hata mesajını okuyun: lot / kurum no düzeltip tekrar deneyin ya da ÜTS''de elle yapıp işaretleyin.', 'fix', '/stok/uts?durum=error',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, ''iş #'' || (n.payload->>''job_no''), '''') || coalesce('' · lot '' || n.lot_no, '''') || coalesce('' · seri '' || n.serial_no, '''') label, ''/stok/uts?durum=error'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''error'''),
    jsonb_build_object('key', 'uts_cancel', 'area', 'stok', 'sev', 'high', 'title', 'ÜTS''de iptal edilmesi gereken bildirim', 'hint', 'Malzeme işten kaldırıldı ama bildirim ÜTS''ye gitmişti.', 'fix', '/stok/uts?durum=cancel_needed',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, '''') || coalesce('' · lot '' || coalesce(n.lot_no, n.serial_no), '''') label, ''/stok/uts?durum=cancel_needed'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''cancel_needed'''),
    jsonb_build_object('key', 'uts_stale', 'area', 'stok', 'sev', 'medium', 'title', '24 saattir bekleyen ÜTS bildirimi', 'hint', 'Ismarlama bildirimleri ÜTS ekranından elle yapılır; diğerleri için ÜTS bağlantısını kontrol edin.', 'fix', '/stok/uts',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, ''iş #'' || (n.payload->>''job_no''), '''') || '' · '' || to_char(n.created_at, ''DD.MM'') label, ''/stok/uts'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''pending'' and n.created_at < now() - interval ''24 hours'''),
    jsonb_build_object('key', 'uts_no_number', 'area', 'stok', 'sev', 'medium', 'title', 'ÜTS takibinde ama ürün numarası (UNO) girilmemiş stok kartı', 'hint', 'Ürünün karekodundaki (01) numarasını karta girin.', 'fix', '/stok/urunler',
      'sql', 'select i.id::text id, i.name label, ''/stok/urunler/'' || i.id link from stk_items i where i.company_id = lab_company() and i.is_active and i.uts_tracked and coalesce(i.uts_product_no, '''') = '''''),
    jsonb_build_object('key', 'uts_no_kurum', 'area', 'stok', 'sev', 'low', 'title', 'ÜTS kurum no eksik: bildirimi bekleyen tedarikçi / klinik', 'hint', 'Cari ya da hekim kartına ÜTS kurum numarasını girin.', 'fix', '/stok/uts',
      'sql', 'select coalesce(n.counterparty_name, ''?'') id, coalesce(n.counterparty_name, ''Karşı kurum'') || '' · '' || count(*) || '' bildirim'' label, ''/stok/uts'' link from uts_notifications n where n.company_id = lab_company() and n.status in (''pending'', ''error'') and n.kind in (''alma'', ''verme'') and coalesce(n.counterparty_no, '''') = '''' group by n.counterparty_name')
  ) where exists (select 1 from uts_settings s where s.company_id = lab_company() and s.enabled)), '[]'::jsonb)
  || coalesce((select jsonb_build_array(
    jsonb_build_object('key', 'gl_pending', 'area', 'finans', 'sev', 'high', 'title', 'Muhasebe fişine dönemeyen kayıt (eşleştirme yok)', 'hint', 'Eşleştirme ekranından hesap kodunu girin, sonra yeniden deneyin.', 'fix', '/muhasebe/fisler?durum=pending',
      'sql', 'select v.id::text id, to_char(v.voucher_date, ''DD.MM.YYYY'') || '' · '' || coalesce(v.description, '''') || '' · '' || coalesce(v.issues, '''') label, ''/muhasebe/fisler/'' || v.id link from gl_vouchers v where v.company_id = lab_company() and v.status = ''pending'''),
    jsonb_build_object('key', 'gl_unposted', 'area', 'finans', 'sev', 'medium', 'title', 'Muhasebeye hiç aktarılmamış ERP kaydı', 'hint', 'Genel muhasebe › Geçmişi fişe çevir.', 'fix', '/muhasebe',
      'sql', 'select x.id::text id, to_char(x.txn_date, ''DD.MM.YYYY'') || '' · '' || x.kind || coalesce('' · '' || x.description, '''') label, ''/muhasebe'' link from fin_txns x join gl_settings s on s.company_id = x.company_id where x.company_id = lab_company() and s.enabled and x.voided_at is null and x.txn_date >= s.start_date and x.created_at < now() - interval ''1 hour'' and not exists (select 1 from gl_vouchers v where v.fin_txn_id = x.id)'),
    jsonb_build_object('key', 'gl_vat_open', 'area', 'finans', 'sev', 'medium', 'title', 'KDV mahsubu yapılmamış geçmiş ay', 'hint', 'Beyanname hazırlık › KDV ekranında ayı kapatın.', 'fix', '/muhasebe/beyanname',
      'sql', 'select m id, m || '' KDV mahsubu yok'' label, ''/muhasebe/beyanname?ay='' || m link from (select to_char(d, ''YYYY-MM'') m from generate_series(date_trunc(''month'', (select start_date from gl_settings where company_id = lab_company())), date_trunc(''month'', current_date) - interval ''1 month'', interval ''1 month'') d) q where exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.status = ''posted'' and to_char(v.voucher_date, ''YYYY-MM'') = q.m) and not exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.tag = ''vat:'' || q.m and v.status = ''posted'')'),
    jsonb_build_object('key', 'gl_after_close', 'area', 'finans', 'sev', 'high', 'title', 'Kapanıştan sonra kapanmış yıla düşen muhasebe kaydı', 'hint', 'Kapanışı geri alıp yeniden yapın, sonra yılı kilitleyin (Dönem işlemleri).', 'fix', '/muhasebe/donem',
      'sql', 'select v.id::text id, v.year || ''/'' || v.no || '' · '' || to_char(v.voucher_date, ''DD.MM.YYYY'') || '' · '' || coalesce(v.description, '''') label, ''/muhasebe/fisler/'' || v.id link from gl_vouchers v join gl_vouchers c on c.company_id = v.company_id and c.tag = ''closebs:'' || extract(year from v.voucher_date)::int and c.status = ''posted'' where v.company_id = lab_company() and v.status = ''posted'' and v.source not in (''closing'', ''opening'') and v.updated_at > c.created_at'),
    jsonb_build_object('key', 'gl_unbalanced', 'area', 'finans', 'sev', 'high', 'title', 'Borç ve alacağı tutmayan muhasebe fişi', 'hint', 'Fişi açıp düzeltin.', 'fix', '/muhasebe/fisler',
      'sql', 'select v.id::text id, v.year || ''/'' || v.no label, ''/muhasebe/fisler/'' || v.id link from gl_vouchers v join gl_lines l on l.voucher_id = v.id where v.company_id = lab_company() and v.status = ''posted'' group by v.id having sum(l.debit) <> sum(l.credit)')
  ) where exists (select 1 from gl_settings s where s.company_id = lab_company() and s.enabled)), '[]'::jsonb);
$$;
revoke execute on function adm_extra_rules() from public, anon, authenticated;

notify pgrst, 'reload schema';
