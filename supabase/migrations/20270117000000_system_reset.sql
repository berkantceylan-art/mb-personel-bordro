-- Sistem temizleme sihirbazı: deneme kayıtlarını modül modül silip canlı kullanıma temiz başlamak.
-- Yalnız şirket sahibi (owner). Şirket kartı, ayarlar, yasal parametreler, kullanıcı türleri / yetkiler,
-- izin / belge türleri ve şubeler hiçbir modülde yoktur: her zaman korunur.
-- Tekrar çalıştırılabilir.

-- Modül tanımları: anahtar, başlık, açıklama, tablolar (silme sırası), depodaki dosya önekleri ("kova:önek", {c} = şirket id)
create or replace function sys_reset_modules()
returns table (key text, label text, descr text, tbls text[], files text[], sort int)
language sql immutable as $$
  values
  ('personel', 'Personel ve özlük',
   'Personel kartları, kimlik / özel bilgiler, özlük belgeleri ve taramaları, maaş anlaşmaları, BES, imzalar, performans, eğitim ilerlemesi, davetler',
   array['employee_dossier','employee_documents','document_signatures','employee_private','employee_onboarding','employee_skills','onboarding_tasks',
         'condition_changes','disciplinary_cases','profile_change_requests','maternity_records','pay_contracts','bes_enrollments',
         'reviews','goals','review_cycles','elearning_progress','invite_attempts','invites','prd_people','kvkk_consents','employees'],
   array['documents:{c}/employees/'], 1),
  ('puantaj', 'Puantaj ve mesai',
   'Giriş-çıkış kayıtları, PDKS aktarımları, vardiya atamaları, fazla mesai, denkleştirme, yemek talepleri',
   array['overtime_ledger_links','overtime_records','attendance_punches','attendance_imports','punch_requests','shift_assignments',
         'compensatory_entries','compensatory_work','meal_requests'],
   array[]::text[], 2),
  ('izin', 'İzinler',
   'İzin talepleri, izin düzeltmeleri / devirler, izin planları, toplu izinler',
   array['leave_requests','leave_adjustments','leave_plans','leave_service_gaps','collective_leaves'],
   array[]::text[], 3),
  ('bordro', 'Bordro, avans ve ödemeler',
   'Dönemler, bordrolar, personel carisi (avans, maaş ödemeleri, kesintiler), kurum ödemeleri, icra dosyaları, zamlar, SGK bildirgeleri, eski bordro geçmişi',
   array['payroll_periods','payroll_remittances','payroll_lines','payroll_history','garnishment_deductions','garnishment_files',
         'advance_requests','ledger_entries','salary_raise_batches','sgk_transactions','sgk_payments','sgk_reports','sgk_robot_jobs'],
   array[]::text[], 4),
  ('ise_alim', 'İşe alım',
   'İlanlar, adaylar, özgeçmişler, aday puanları ve görüşme geçmişi',
   array['candidate_scores','candidate_events','candidates','job_postings'],
   array['documents:{c}/candidates/'], 5),
  ('isg', 'İSG ve KVKK',
   'İSG ziyaret / tespitleri, kazalar, risk analizleri, sağlık muayeneleri, eğitimler, KKD, acil durum, ölçümler, kurul, KVKK kayıtları',
   array['isg_findings','isg_visits','isg_assignments','isg_professionals','safety_incidents','risk_items','risk_assessments','health_exams',
         'training_records','training_sessions','ppe_issues','emergency_drills','emergency_team','emergency_plans','env_measurements',
         'equipment_checks','sds_documents','committee_members','committee_meetings','kvkk_breaches','kvkk_checklist','kvkk_disposals',
         'kvkk_notices','kvkk_requests','kvkk_retention'],
   array['documents:{c}/isg'], 6),
  ('lab_is', 'Laboratuvar işleri ve sevkiyat',
   'İş emirleri, iş adımları, kalite kontrol, yeniden yapımlar, makine kuyruğu, prim hesapları, siparişler, irsaliyeler, ekstreler, tahsilatlar, kargolar, portal vakaları, kalite (NCR / şikâyet)',
   array['job_qc_checks','job_runs','job_steps','job_notes','job_handoffs','job_files','job_items','job_packages',
         'prd_job_materials','prd_job_ops','prd_machine_queue','prd_machine_events','prd_remakes','prd_bonus_lines','prd_bonus_runs',
         'qms_actions','qms_ncrs','qms_complaints','qms_audits',
         'shipment_events','shipment_files','shipments','portal_case_events','portal_case_files','portal_cases',
         'lab_payments','lab_statements','lab_waybills','lab_orders','lab_doc_seq','jobs'],
   array['job-files:','shipment-files:','portal-files:'], 7),
  ('musteri', 'Klinikler, hekimler ve portal hesapları',
   'Klinik / müşteri kartları, hekimler, özel fiyatlar, portal (site) hesapları ve üyeleri, grup şirketleri',
   array['lab_customer_prices','lab_customer_doctors','lab_customers','portal_invites','portal_clients','portal_members','portal_accounts',
         'cns_entries','cns_entities'],
   array[]::text[], 8),
  ('finans', 'Finans (kasa, banka, cari)',
   'Kasa / banka hesapları ve hareketleri, banka ekstreleri, mutabakatlar, çek / senet, krediler, kart taksitleri, cari kartlar, tedarikçi fişleri',
   array['fin_cheque_events','fin_cheques','fin_loan_installments','fin_loans','fin_card_installments','fin_reconciliations',
         'fin_bank_lines','fin_bank_batches','fin_bank_rules','fin_moves','fin_txns','sup_slip_open','sup_slips','fin_accounts','fin_parties'],
   array[]::text[], 9),
  ('fatura', 'Faturalar ve masraflar',
   'Satış / alış faturaları, masraf beyanları, düzenli giderler, fiş fotoğrafları',
   array['inv_lines','inv_invoices','exp_claims','exp_recurring'],
   array['receipts:'], 10),
  ('stok', 'Stok ve satın alma',
   'Stok kartları, reçeteler, lotlar, hareketler, sayımlar, mal kabul, transfer, malzeme istekleri, satın alma siparişleri',
   array['stk_request_signatures','stk_request_events','stk_request_lines','stk_requests','stk_transfer_lines','stk_transfers',
         'stk_count_lines','stk_counts','stk_receipt_lines','stk_receipts','stk_moves','stk_lots','stk_buy_lists','stk_boms',
         'pur_order_lines','pur_orders','stk_items'],
   array[]::text[], 11),
  ('demirbas', 'Demirbaş ve zimmet',
   'Demirbaş kartları, zimmetler, amortisman, bakım kayıtları, demirbaş sayımları',
   array['ast_count_items','ast_counts','asset_maintenance','asset_depreciation','asset_assignments','assets'],
   array[]::text[], 12),
  ('satis_servis', 'CRM ve teknik servis',
   'Satış fırsatları, görüşmeler, ofis aramaları, arıza / servis kayıtları ve fotoğrafları, teknisyenler',
   array['crm_activities','crm_leads','office_calls','svc_photos','svc_events','svc_tickets','svc_technicians'],
   array[]::text[], 13),
  ('iletisim', 'Mesajlar, duyurular ve talepler',
   'İç mesajlar, duyurular, anketler, bildirimler, soru-cevap, WhatsApp / posta bağlantıları, asistan geçmişi, notlar, hatırlatmalar, onay talepleri, raporlar, ziyaretçiler',
   array['conversation_members','messages','conversations','announcement_reads','announcements','poll_votes','poll_options','event_rsvps',
         'notifications','qa_votes','qa_questions','wa_messages','wa_threads','mail_links','mail_ai','assistant_logs','user_notes',
         'user_reminders','apr_actions','apr_requests','rpt_reports','srv_responses','vis_visits','vis_guards','cam_views'],
   array[]::text[], 14),
  ('tanimlar', 'Tanımlar',
   'Bölümler, unvanlar, pozisyonlar, organizasyon şeması, vardiya tanımları, yetkinlikler, e-eğitim kursları, kategoriler, depolar, ürün kataloğu, istasyonlar, makineler, prim kuralları, onay akışları, kameralar, PDKS cihazları, fatura serileri',
   array['onboarding_items','elearning_courses','skills','shifts','positions','org_units','org_unit_types','job_titles','departments',
         'prd_route_steps','prd_bonus_rules','prd_machines','prd_stations','lab_options','lab_products','stk_warehouses','stk_categories',
         'fin_categories','apr_flow_steps','apr_flows','cam_access','cam_cameras','devices','inv_series'],
   array[]::text[], 15),
  ('kullanicilar', 'Kullanıcı hesapları (sizinki hariç)',
   'Sizin dışınızdaki tüm ERP kullanıcılarının hesapları, şube / bölüm yetkileri, bildirim ve ana sayfa ayarları. Sizin hesabınız ve şirket sahipliğiniz korunur.',
   array['membership_branches','membership_departments','push_tokens','web_push_subscriptions','notification_prefs','user_dashboard','memberships'],
   array[]::text[], 16),
  ('site_mesaj', 'Web sitesi mesajları',
   'Siteden gelen iletişim formları, canlı sohbetler ve vaka başvuruları',
   array['cms_chat_messages','cms_chats','cms_cases','cms_messages'],
   array[]::text[], 17),
  ('site_icerik', 'Web sitesi içerikleri',
   'Site sayfaları, haberler, ürünler, slaytlar, ekip, SSS, videolar, yorumlar, fiyat listesi (site yayından boş kalır)',
   array['cms_announcements','cms_departments','cms_faqs','cms_help_videos','cms_media','cms_pages','cms_posts','cms_price_items',
         'cms_products','cms_slides','cms_stories','cms_team','cms_testimonials'],
   array[]::text[], 18),
  ('loglar', 'İşlem geçmişi (denetim kaydı)',
   'Kim, ne zaman, neyi değiştirdi kayıtları ve KVKK erişim kaydı. Seçmezseniz silinen kayıtların eski hâli burada kalır (yedek görevi görür).',
   array['kvkk_access_log','audit_log'],
   array[]::text[], 19)
$$;

-- Şirket sahibi mi? Şirket id döner.
create or replace function sys_reset_company()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select company_id into v from memberships where user_id = auth.uid() and role = 'owner' order by created_at limit 1;
  if v is null then raise exception 'not_owner'; end if;
  return v;
end $$;

-- Silme koşulu: şirket sütunu varsa şirkete göre; yoksa yalnız tek şirketli kurulumda tümü (aksi hâlde atlanır, bağlı kayıtla silinir).
-- Kullanıcı modülünde çağıranın kendi satırları korunur.
create or replace function sys_reset_where(p_table text, p_company uuid, p_module text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  w text;
  has_c boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'company_id');
  has_u boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'user_id');
begin
  if has_c then w := format('company_id = %L', p_company);
  elsif (select count(*) from companies) > 1 then return null;
  else w := 'true';
  end if;
  if p_module = 'kullanicilar' and has_u then w := w || format(' and user_id is distinct from %L', auth.uid()); end if;
  return w;
end $$;

-- Seçimi bağımlılıklara göre genişletir: başka modüldeki kayıtlar silinecek tablolara bağlıysa o modül de eklenir.
create or replace function sys_reset_plan(p_modules text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid := sys_reset_company();
  sel text[] := array(select distinct m from unnest(coalesce(p_modules, '{}')) m where m in (select key from sys_reset_modules()));
  added jsonb := '[]';
  warns jsonb := '[]';
  changed boolean := true;
  oids oid[];
  fk record;
  mod text;
  hit boolean;
  counts jsonb := '{}';
  t text;
  n bigint;
  tot bigint;
  r record;
begin
  while changed loop
    changed := false;
    oids := array(select to_regclass('public.' || x)::oid from sys_reset_modules() m, unnest(m.tbls) x where m.key = any (sel) and to_regclass('public.' || x) is not null);
    for fk in
      select cn.conrelid, cn.confrelid, cn.confdeltype, cl.relname as src, cf.relname as dst, a.attname as col
      from pg_constraint cn
      join pg_class cl on cl.oid = cn.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join pg_class cf on cf.oid = cn.confrelid
      join pg_attribute a on a.attrelid = cn.conrelid and a.attnum = cn.conkey[1]
      where cn.contype = 'f' and cn.confrelid = any (oids) and not (cn.conrelid = any (oids)) and cn.confdeltype not in ('n', 'd')
    loop
      execute format('select exists (select 1 from public.%I where %I is not null)', fk.src, fk.col) into hit;
      continue when not hit;
      select m.key into mod from sys_reset_modules() m where fk.src = any (m.tbls) limit 1;
      if mod is not null then
        if not mod = any (sel) then
          sel := sel || mod;
          added := added || jsonb_build_object('module', mod, 'table', fk.src, 'refers', fk.dst);
          changed := true;
        end if;
      elsif not exists (select 1 from jsonb_array_elements(warns) w where w->>'table' = fk.src and w->>'refers' = fk.dst) then
        warns := warns || jsonb_build_object('table', fk.src, 'refers', fk.dst, 'cascade', fk.confdeltype = 'c');
      end if;
    end loop;
  end loop;


  for r in select m.key, m.tbls from sys_reset_modules() m order by m.sort loop
    tot := 0;
    foreach t in array r.tbls loop
      if to_regclass('public.' || t) is not null and sys_reset_where(t, c, r.key) is not null then
        execute format('select count(*) from public.%I where %s', t, sys_reset_where(t, c, r.key)) into n;
        tot := tot + n;
      end if;
    end loop;
    counts := counts || jsonb_build_object(r.key, tot);
  end loop;
  return jsonb_build_object('modules', to_jsonb(sel), 'added', added, 'warnings', warns, 'counts', counts);
end $$;

-- Silme: tek işlem (hata olursa hiçbir şey silinmez). Dönen dosya ve kullanıcı listesini sunucu tarafı ayrıca temizler.
create or replace function sys_reset_run(p_modules text[], p_confirm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid := sys_reset_company();
  plan jsonb;
  sel text[];
  want text[] := array(select distinct m from unnest(coalesce(p_modules, '{}')) m);
  todo jsonb := '[]';          -- [{t, m}]
  left_ jsonb;
  done jsonb := '{}';
  files jsonb := '[]';
  users uuid[] := '{}';
  item jsonb;
  w text;
  n bigint;
  pass int := 0;
  progress boolean;
  last_err text;
  r record;
  pre text;
  b text;
begin
  if p_confirm is distinct from 'SİL' then raise exception 'confirm_required'; end if;
  plan := sys_reset_plan(want);
  sel := array(select jsonb_array_elements_text(plan->'modules'));
  if exists (select 1 from unnest(sel) x where not x = any (want)) then
    raise exception 'needs_modules: %', array_to_string(array(select x from unnest(sel) x where not x = any (want)), ', ');
  end if;
  if exists (select 1 from jsonb_array_elements(plan->'warnings') x where not (x->>'cascade')::boolean) then
    raise exception 'blocked: %', (select string_agg((x->>'table') || ' → ' || (x->>'refers'), ', ') from jsonb_array_elements(plan->'warnings') x where not (x->>'cascade')::boolean);
  end if;
  if not exists (select 1 from unnest(sel)) then raise exception 'no_modules'; end if;

  -- depodaki dosyalar
  for r in select m.key, f from sys_reset_modules() m, unnest(m.files) f where m.key = any (sel) loop
    b := split_part(r.f, ':', 1);
    pre := replace(substr(r.f, length(b) + 2), '{c}', c::text);
    files := files || coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name)) from storage.objects o where o.bucket_id = b and o.name like pre || '%'), '[]');
  end loop;

  -- silinecek giriş hesapları (sizinki ve başka şirkette üyeliği olanlar hariç)
  if 'kullanicilar' = any (sel) then
    users := users || array(select user_id from memberships where company_id = c and user_id <> auth.uid());
  end if;
  if 'musteri' = any (sel) then
    users := users || array(select user_id from portal_members where user_id is not null);
  end if;
  users := array(select distinct u from unnest(users) u where u is not null and u <> auth.uid()
                 and not exists (select 1 from memberships m where m.user_id = u and m.company_id <> c));

  -- tablolar: modül sırasıyla; işlem geçmişi en sonda
  for r in select m.key, t from sys_reset_modules() m, unnest(m.tbls) with ordinality as u(t, i) where m.key = any (sel) order by (m.key = 'loglar'), m.sort, u.i loop
    if to_regclass('public.' || r.t) is not null then todo := todo || jsonb_build_object('t', r.t, 'm', r.key); end if;
  end loop;

  while jsonb_array_length(todo) > 0 loop
    pass := pass + 1;
    progress := false;
    left_ := '[]';
    for item in select * from jsonb_array_elements(todo) loop
      w := sys_reset_where(item->>'t', c, item->>'m');
      if w is null then progress := true; continue; end if;
      begin
        execute format('delete from public.%I where %s', item->>'t', w);
        get diagnostics n = row_count;
        done := done || jsonb_build_object(item->>'t', n);
        progress := true;
      exception when others then
        last_err := (item->>'t') || ': ' || sqlerrm;
        left_ := left_ || item;
      end;
    end loop;
    todo := left_;
    if not progress or pass > 25 then raise exception 'reset_failed: %', last_err; end if;
  end loop;

  if not 'loglar' = any (sel) then
    insert into audit_log (company_id, table_name, row_id, action, new_data, actor)
    values (c, 'system_reset', null, 'RESET', jsonb_build_object('modules', to_jsonb(sel), 'rows', done), auth.uid());
  end if;
  return jsonb_build_object('modules', to_jsonb(sel), 'deleted', done, 'files', files, 'users', to_jsonb(users));
end $$;

revoke all on function sys_reset_plan(text[]), sys_reset_run(text[], text), sys_reset_where(text, uuid, text) from public, anon;
grant execute on function sys_reset_plan(text[]), sys_reset_run(text[], text), sys_reset_company() to authenticated;
grant execute on function sys_reset_modules() to authenticated;
