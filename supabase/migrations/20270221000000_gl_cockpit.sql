-- =====================================================================
-- Muhasebe kokpiti K3: ayın 6 aşaması tek ekranda, aşamalar birbirine bağlı, sabah özeti bildirimi
--  1 Ay içi kayıtlar → 2 Fiş onayı → 3 Dönem sonu → 4 Kontroller → 5 Vergi ve beyanname → 6 Luca ve kapanış
--  gl_cockpit(ay)      : aşamalar, maddeler, durum (tamam / devam / bekliyor / başlanmadı), sıradaki iş
--  gl_morning_digest() : her sabah (kontrol cron'u, 07:30) yönetici ve mali müşavire özet bildirim (yalnız açık iş varsa)
-- Tekrar çalıştırılabilir. Önce 20270220000000_luca_plan_sync.sql.
-- =====================================================================

-- Yetki: oturum açan kullanıcı ya da sistem (sabah özeti) çalıştırabilir
create or replace function gl_can(p_level int default 1) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('gl.system', true), '') = 'on' or can_module('ledger', p_level);
$$;
revoke execute on function gl_can(int) from public, anon;
grant execute on function gl_can(int) to authenticated;

-- Okuma fonksiyonları sistem bağlamında da çalışsın
do $$
declare fn text; src text;
begin
  foreach fn in array array['gl_checks(text)', 'gl_period_checklist(text)', 'gl_tax_calendar(date,date)'] loop
    select pg_get_functiondef(fn::regprocedure) into src;
    if position('if not gl_can() then return null; end if;' in src) > 0 then continue; end if;
    if position('if not can_module(''ledger'') then return null; end if;' in src) = 0 then raise exception 'gl_cockpit: % yetki satırı bulunamadı', fn; end if;
    execute replace(src, 'if not can_module(''ledger'') then return null; end if;', 'if not gl_can() then return null; end if;');
  end loop;
end $$;

create or replace function gl_cockpit(p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  co uuid := lab_company(); f date; t date; y int; mo int; q int;
  ck jsonb; chk jsonb; st jsonb := '[]'::jsonb; items jsonb; c jsonb; k text; n int; x jsonb;
  drafts int; unexp int; locked boolean; vt jsonb; excl text[];
  done_map jsonb := '{}'::jsonb; stage jsonb; s_done boolean; s_open int; s_total int; blockers text[]; nxt jsonb;
begin
  if not gl_can() then return null; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  f := (p_month || '-01')::date; t := (f + interval '1 month - 1 day')::date;
  y := extract(year from f)::int; mo := extract(month from f)::int; q := (mo + 2) / 3;
  ck := gl_period_checklist(p_month);
  chk := coalesce(gl_checks(p_month), '[]');
  vt := coalesce(ck->'vouchers', '{}');
  locked := coalesce((ck->>'locked')::boolean, false);

  -- kontrol maddesi: {label, count, ok, link, severity}
  -- (yardımcı: chk içinden anahtarla)
  -- 1) Ay içi kayıtlar
  items := '[]';
  foreach k in array array['bank_unmatched', 'negative_cash', 'purchase_no_docno', 'possible_duplicate', 'supplier_advance', 'overdue_cheques', 'cash_count_missing', 'export_no_doc', 'foreign_no_kdv2'] loop
    select e into c from jsonb_array_elements(chk) e where e->>'key' = k;
    if c is null then continue; end if;
    items := items || jsonb_build_object('key', k, 'label', c->>'title', 'count', (c->>'count')::int, 'ok', (c->>'count')::int = 0 or (c->>'acked')::boolean,
                                         'acked', (c->>'acked')::boolean, 'severity', c->>'severity', 'link', c->>'link');
  end loop;
  items := jsonb_build_array(jsonb_build_object('key', 'pending', 'label', 'Eşleştirme bekleyen ERP kaydı (henüz fiş olmadı)', 'count', coalesce((ck->>'pending')::int, 0),
             'ok', coalesce((ck->>'pending')::int, 0) = 0, 'severity', 'critical', 'link', '/muhasebe/fisler?durum=pending')) || items;
  st := st || jsonb_build_object('key', 'kayit', 'no', 1, 'title', 'Ay içi kayıtlar', 'desc', 'Faturalar, ödemeler, çek-senet, banka ve kasa hareketleri eksiksiz girilsin',
                                 'link', '/finans', 'items', items, 'needs', '[]'::jsonb);

  -- 2) Fiş onayı
  select count(*) into drafts from gl_vouchers where company_id = co and status = 'draft' and voucher_date between f and t;
  select e into c from jsonb_array_elements(chk) e where e->>'key' = 'unbalanced';
  st := st || jsonb_build_object('key', 'onay', 'no', 2, 'title', 'Fiş onayı', 'desc', 'Otomatik ve elle kesilen fişler yönetici veya mali müşavir onayından geçsin',
    'link', '/muhasebe/gelen-kutusu', 'needs', '["kayit"]'::jsonb,
    'items', jsonb_build_array(
      jsonb_build_object('key', 'drafts', 'label', 'Onay bekleyen fiş', 'count', drafts, 'ok', drafts = 0, 'severity', 'critical', 'link', '/muhasebe/gelen-kutusu'),
      jsonb_build_object('key', 'unbalanced', 'label', coalesce(c->>'title', 'Dengesiz fiş'), 'count', coalesce((c->>'count')::int, 0), 'ok', coalesce((c->>'count')::int, 0) = 0, 'severity', 'critical', 'link', coalesce(c->>'link', '/muhasebe/fisler'))));

  -- 3) Dönem sonu
  items := '[]';
  foreach k in array array['depreciation', 'payroll_no_accrual', 'fx_not_done', 'deferrals', 'loan_accrual', 'reflect'] loop
    select e into c from jsonb_array_elements(chk) e where e->>'key' = k;
    if c is null then continue; end if;
    items := items || jsonb_build_object('key', k, 'label', c->>'title', 'count', (c->>'count')::int, 'ok', (c->>'count')::int = 0 or (c->>'acked')::boolean,
                                         'acked', (c->>'acked')::boolean, 'severity', c->>'severity', 'link', '/muhasebe/donem-sonu?ay=' || p_month);
  end loop;
  if mo = 12 then
    items := items || jsonb_build_object('key', 'p131', 'label', 'Ortaklardan alacak (131) adat / faiz kaydı', 'count', case when vt ? ('p131:' || y) then 0 else 1 end,
                                         'ok', vt ? ('p131:' || y), 'severity', 'warning', 'link', '/muhasebe/donem-sonu?ay=' || p_month);
  end if;
  st := st || jsonb_build_object('key', 'donem', 'no', 3, 'title', 'Dönem sonu işlemleri', 'desc', 'Amortisman, bordro tahakkuku, kur değerleme, dönemsellik, faiz tahakkuku, yansıtma',
                                 'link', '/muhasebe/donem-sonu?ay=' || p_month, 'items', items, 'needs', '["onay"]'::jsonb);

  -- 4) Kontroller: aşamalarda olmayan kalan kritik / uyarı kontrolleri
  items := '[]';
  for c in select e from jsonb_array_elements(chk) e
           where e->>'severity' in ('critical', 'warning')
             and e->>'key' not in ('bank_unmatched', 'negative_cash', 'purchase_no_docno', 'possible_duplicate', 'supplier_advance', 'overdue_cheques', 'cash_count_missing',
                                   'export_no_doc', 'foreign_no_kdv2', 'pending_vouchers', 'unbalanced', 'depreciation', 'payroll_no_accrual', 'fx_not_done', 'deferrals',
                                   'loan_accrual', 'reflect', 'filings_due', 'vat_not_closed')
  loop
    items := items || jsonb_build_object('key', c->>'key', 'label', c->>'title', 'count', (c->>'count')::int, 'ok', (c->>'count')::int = 0 or (c->>'acked')::boolean,
                                         'acked', (c->>'acked')::boolean, 'severity', c->>'severity', 'link', c->>'link');
  end loop;
  select count(*) into n from jsonb_array_elements(chk) e where e->>'severity' = 'critical' and (e->>'count')::int > 0 and not (e->>'acked')::boolean and e->>'key' <> 'filings_due';
  items := jsonb_build_array(jsonb_build_object('key', 'critical_all', 'label', 'Açık kritik kontrol (tümü)', 'count', n, 'ok', n = 0, 'severity', 'critical', 'link', '/muhasebe/kontroller?ay=' || p_month)) || items;
  st := st || jsonb_build_object('key', 'kontrol', 'no', 4, 'title', 'Kontroller', 'desc', 'Kritik uyarılar düzeltilsin ya da gerekçesiyle bilerek geçilsin',
                                 'link', '/muhasebe/kontroller?ay=' || p_month, 'items', items, 'needs', '["donem"]'::jsonb);

  -- 5) Vergi ve beyannameler
  items := jsonb_build_array(
    jsonb_build_object('key', 'vat_close', 'label', 'KDV mahsup fişi', 'count', case when vt ? ('vat:' || p_month) then 0 else 1 end, 'ok', vt ? ('vat:' || p_month), 'severity', 'critical', 'link', '/muhasebe/beyanname?ay=' || p_month),
    jsonb_build_object('key', 'stamp', 'label', 'Damga vergisi tahakkuku', 'count', case when vt ? ('stamp:' || p_month) then 0 else 1 end, 'ok', vt ? ('stamp:' || p_month), 'severity', 'warning', 'link', '/muhasebe/beyanname?ay=' || p_month || '&sekme=damga'));
  for x in
    select jsonb_build_object('kind', kd, 'period', per, 'due', due) from (values
      ('kdv1', p_month, gl_bizday((f + interval '1 month')::date + 27)),
      ('kdv2', p_month, gl_bizday((f + interval '1 month')::date + 24)),
      ('muhsgk', p_month, gl_bizday((f + interval '1 month')::date + 25)),
      ('damga', p_month, gl_bizday((f + interval '1 month')::date + 25))) v(kd, per, due)
    union all select jsonb_build_object('kind', 'gecici', 'period', y || '-Q' || (mo / 3), 'due', gl_bizday((f + interval '2 months')::date + 16)) where mo in (3, 6, 9)
    union all select jsonb_build_object('kind', 'kurumlar', 'period', y::text, 'due', gl_bizday(make_date(y + 1, 4, 30))) where mo = 12
  loop
    select status into k from gl_tax_filings where company_id = co and kind = x->>'kind' and period = x->>'period';
    items := items || jsonb_build_object('key', 'f_' || (x->>'kind'), 'label',
        case x->>'kind' when 'kdv1' then 'KDV 1 beyannamesi' when 'kdv2' then 'KDV 2 (sorumlu sıfatıyla) beyannamesi' when 'muhsgk' then 'Muhtasar ve prim hizmet beyannamesi'
          when 'damga' then 'Damga vergisi beyannamesi' when 'gecici' then 'Geçici vergi beyannamesi (' || (x->>'period') || ')' when 'kurumlar' then 'Kurumlar vergisi beyannamesi (' || y || ')' end
        || ' · son gün ' || to_char((x->>'due')::date, 'DD.MM.YYYY'),
      'count', case when coalesce(k, 'todo') in ('filed', 'paid', 'none') then 0 else 1 end,
      'ok', coalesce(k, 'todo') in ('filed', 'paid', 'none'), 'status', coalesce(k, 'todo'), 'due', x->>'due',
      'late', coalesce(k, 'todo') not in ('filed', 'paid', 'none') and (x->>'due')::date < current_date,
      'severity', case when x->>'kind' = 'kurumlar' then 'info' else 'critical' end, 'link', '/muhasebe/vergi-takvimi');
    k := null;
  end loop;
  st := st || jsonb_build_object('key', 'beyan', 'no', 5, 'title', 'Vergi ve beyannameler', 'desc', 'KDV mahsubu, damga, muhtasar-prim, KDV 1-2, çeyrek sonunda geçici vergi',
                                 'link', '/muhasebe/beyanname?ay=' || p_month, 'items', items, 'needs', '["kontrol"]'::jsonb);

  -- 6) Luca ve kapanış
  select array(select jsonb_array_elements_text(coalesce(gl_luca_get_settings_sys()->'exclude_prefixes', '[]'))) into excl;
  select count(*) into unexp from gl_vouchers v where v.company_id = co and v.status = 'posted' and v.luca_batch_id is null and v.voucher_date between f and t
    and not exists (select 1 from unnest(excl) p where v.tag like p || '%');
  st := st || jsonb_build_object('key', 'kapanis', 'no', 6, 'title', 'Luca ve dönem kapanışı', 'desc', 'Fişler Luca''ya aktarılsın, ay kilitlensin',
    'link', '/muhasebe/luca?bas=' || f || '&bit=' || t, 'needs', '["beyan"]'::jsonb,
    'items', jsonb_build_array(
      jsonb_build_object('key', 'luca', 'label', 'Luca''ya aktarılmamış fiş', 'count', unexp, 'ok', unexp = 0, 'severity', 'warning', 'link', '/muhasebe/luca?bas=' || f || '&bit=' || t),
      jsonb_build_object('key', 'lock', 'label', 'Dönem kilidi', 'count', case when locked then 0 else 1 end, 'ok', locked, 'severity', 'warning', 'link', '/muhasebe/donem')));

  -- durumlar: tamam / devam / bekliyor (önceki aşama bitmedi) / başlanmadı
  for stage in select e from jsonb_array_elements(st) e order by (e->>'no')::int loop
    select count(*), count(*) filter (where not (i->>'ok')::boolean) into s_total, s_open from jsonb_array_elements(stage->'items') i;
    s_done := s_open = 0;
    done_map := done_map || jsonb_build_object(stage->>'key', s_done);
  end loop;
  st := (select jsonb_agg(e || jsonb_build_object(
            'total', (select count(*) from jsonb_array_elements(e->'items')),
            'open', (select count(*) from jsonb_array_elements(e->'items') i where not (i->>'ok')::boolean),
            'blocked_by', (select coalesce(jsonb_agg(nd), '[]') from jsonb_array_elements_text(e->'needs') nd where not (done_map->>nd)::boolean),
            'status', case
               when (done_map->>(e->>'key'))::boolean then 'done'
               when exists (select 1 from jsonb_array_elements_text(e->'needs') nd where not (done_map->>nd)::boolean) then 'blocked'
               when exists (select 1 from jsonb_array_elements(e->'items') i where (i->>'ok')::boolean) then 'active'
               else 'todo' end) order by (e->>'no')::int)
         from jsonb_array_elements(st) e);

  -- sıradaki iş: bitmemiş ilk aşamanın ilk açık maddesi (kritik önce)
  select jsonb_build_object('stage', e->>'title', 'stage_key', e->>'key', 'label', i->>'label', 'count', i->>'count', 'link', i->>'link') into nxt
  from jsonb_array_elements(st) e cross join lateral jsonb_array_elements(e->'items') i
  where not (i->>'ok')::boolean
  order by (e->>'no')::int, case i->>'severity' when 'critical' then 0 when 'warning' then 1 else 2 end
  limit 1;

  return jsonb_build_object('month', p_month, 'locked', locked, 'stages', st, 'next', nxt,
    'done', (select count(*) from jsonb_array_elements(st) e where e->>'status' = 'done'),
    'quarter_end', mo in (3, 6, 9, 12), 'year_end', mo = 12);
end $$;
revoke execute on function gl_cockpit(text) from public, anon;
grant execute on function gl_cockpit(text) to authenticated;

-- Luca ayarı yetki kontrolsüz (iç kullanım)
create or replace function gl_luca_get_settings_sys() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('exclude_prefixes', coalesce((select to_jsonb(exclude_prefixes) from gl_luca_settings where company_id = lab_company()), to_jsonb(array['vat:', 'gecici:', 'cit:'])));
$$;
revoke execute on function gl_luca_get_settings_sys() from public, anon, authenticated;

-- Çalışılan ay: önceki ay kilitlenmediyse önceki ay, kilitliyse bu ay
create or replace function gl_working_month() returns text language sql stable security definer set search_path = public as $$
  select case when gl_locked(lab_company(), (date_trunc('month', current_date) - interval '1 day')::date)
              then to_char(current_date, 'YYYY-MM') else to_char(current_date - interval '1 month', 'YYYY-MM') end;
$$;
revoke execute on function gl_working_month() from public, anon;
grant execute on function gl_working_month() to authenticated;

-- Sabah özeti: açık iş varsa yönetici ve mali müşavire tek bildirim
create or replace function gl_morning_digest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare co uuid := lab_company(); m text; cp jsonb; users uuid[]; crit int; drafts int; due jsonb; nx jsonb; body text; late int;
begin
  if co is null or not exists (select 1 from gl_settings where company_id = co and enabled) then return jsonb_build_object('sent', false, 'reason', 'gl_off'); end if;
  perform set_config('gl.system', 'on', true);
  m := gl_working_month();
  cp := gl_cockpit(m);
  select coalesce(array_agg(distinct user_id), '{}') into users from memberships where company_id = co and role in ('owner', 'accountant');
  select coalesce(sum((i->>'count')::int), 0) into crit from jsonb_array_elements(cp->'stages') e cross join lateral jsonb_array_elements(e->'items') i
   where i->>'key' = 'critical_all';
  select coalesce(sum((i->>'count')::int), 0) into drafts from jsonb_array_elements(cp->'stages') e cross join lateral jsonb_array_elements(e->'items') i where i->>'key' = 'drafts';
  select count(*) filter (where (i->>'late')::boolean), coalesce(jsonb_agg(i) filter (where not (i->>'ok')::boolean and (i->>'due')::date <= current_date + 3), '[]')
    into late, due
  from jsonb_array_elements(cp->'stages') e cross join lateral jsonb_array_elements(e->'items') i where i ? 'due';
  nx := cp->'next';
  perform set_config('gl.system', 'off', true);
  if nx is null and jsonb_array_length(due) = 0 then return jsonb_build_object('sent', false, 'reason', 'nothing_open', 'month', m); end if;
  body := concat_ws(' · ',
    (cp->>'done') || '/6 aşama tamam',
    case when drafts > 0 then drafts || ' fiş onay bekliyor' end,
    case when crit > 0 then crit || ' kritik kontrol açık' end,
    case when late > 0 then late || ' beyanname gecikti' end,
    case when jsonb_array_length(due) > 0 then 'yaklaşan: ' || (select string_agg(split_part(i->>'label', ' · ', 1), ', ') from jsonb_array_elements(due) i) end,
    case when nx is not null then 'Sıradaki: ' || (nx->>'label') end);
  perform deliver(co, users, 'Muhasebe ' || m || ': ' || case when late > 0 or crit > 0 then 'dikkat gereken işler var' else 'günün işleri' end, left(body, 280), '/muhasebe/kokpit?ay=' || m, true);
  return jsonb_build_object('sent', true, 'month', m, 'users', cardinality(users));
end $$;
revoke execute on function gl_morning_digest() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function gl_morning_digest() to service_role; end if; end $$;

notify pgrst, 'reload schema';
