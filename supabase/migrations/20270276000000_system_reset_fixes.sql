-- =====================================================================
-- SİSTEMİ TEMİZLE VE YETKİ DÜZELTMELERİ (modül testlerinde bulunan hatalar)
--  1) "Tanımlar" temizliği sistemin hazır tanımlarını silmez: sistem / hazır finans kategorileri (KDV, demirbaş,
--     açılış, masraf türleri…), ana depo, hazır üretim istasyonları, teslim / prova seçenekleri, hazır vardiyalar kalır.
--     Önceden hepsi siliniyor, sonra masraf ve amortisman kaydı atılamıyordu.
--  2) Finans temizliği muhasebe fişlerini (gl_vouchers / gl_lines ve diğer muhasebe işlem tabloları) de siler.
--  3) Şüpheli alacak, dış lab işleri / partileri ve e-irsaliyeler modüllere eklendi; finans temizliği artık
--     "engellendi" demez, gerekiyorsa ilgili modülü (laboratuvar işleri) seçtirir.
--  4) Temizlik sırasında yeni onay talebi ve bildirim oluşmaz.
--  5) Sonradan eklenen tablolar (puantaj günleri, parça başı, kargo, dış lab, teklif / satın alma, e-fatura gelen
--     kutusu, ödeme planları, muhasebe…) temizliğe eklendi.
--  6) "İSG ve KVKK" tek başına temizlenebilir (KVKK onayları bu modüle taşındı).
--  7) Denetim kaydı: maaş, bordro, avans, BES, icra kayıtlarını yalnız bordro yetkilisi (sahip / muhasebe);
--     kimlik / IBAN ve sağlık kayıtlarını yalnız İK / İSG yetkilisi görür.
--  8) Hekim tahsilatı için laboratuvar "Düzenler" (2) ya da finans "Düzenler" (2) yetkisi gerekir; "Görür" yetmez.
-- Tekrar çalıştırılabilir. Önce 20270117000000_system_reset.sql.
-- =====================================================================

create or replace function _mig_patch(p_sig text, p_old text, p_new text) returns void language plpgsql as $$
declare d text;
begin
  select pg_get_functiondef(p_sig::regprocedure) into d;
  if position(p_new in d) > 0 then return; end if;                 -- zaten yamalı
  if position(p_old in d) = 0 then raise exception 'Yama uygulanamadı: %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------
-- Modül tanımları (yeni tablolar eklendi; veritabanında olmayan tablo atlanır)
-- ---------------------------------------------------------------------
create or replace function sys_reset_modules()
returns table (key text, label text, descr text, tbls text[], files text[], sort int)
language sql immutable as $$
  values
  ('personel', 'Personel ve özlük',
   'Personel kartları, kimlik / özel bilgiler, özlük belgeleri ve taramaları, maaş anlaşmaları, BES, imzalar, performans, eğitim ilerlemesi, davetler',
   array['employee_dossier','employee_documents','document_signatures','employee_private','employee_onboarding','employee_skills','onboarding_tasks',
         'condition_changes','disciplinary_cases','profile_change_requests','maternity_records','pay_contracts','bes_enrollments',
         'reviews','goals','review_cycles','elearning_progress','invite_attempts','invites','prd_people','employees'],
   array['documents:{c}/employees/'], 1),
  ('puantaj', 'Puantaj ve mesai',
   'Giriş-çıkış kayıtları, PDKS aktarımları, kapı kayıtları, puantaj günleri ve düzeltmeleri, vardiya atamaları, fazla mesai, denkleştirme, yemek talepleri',
   array['overtime_ledger_links','overtime_records','attendance_punches','attendance_imports','punch_requests','shift_assignments',
         'compensatory_entries','compensatory_work','meal_requests','att_corrections','att_days','att_months','door_events'],
   array[]::text[], 2),
  ('izin', 'İzinler',
   'İzin talepleri, izin düzeltmeleri / devirler, izin planları, toplu izinler',
   array['leave_requests','leave_adjustments','leave_plans','leave_service_gaps','collective_leaves'],
   array[]::text[], 3),
  ('bordro', 'Bordro, avans ve ödemeler',
   'Dönemler, bordrolar, personel carisi (avans, maaş ödemeleri, kesintiler), kurum ödemeleri, icra dosyaları, zamlar, SGK bildirgeleri, eski bordro geçmişi, parça başı çalışanlar ve hakedişler',
   array['payroll_periods','payroll_remittances','payroll_lines','payroll_history','garnishment_deductions','garnishment_files',
         'advance_requests','pc_entries','pc_rates','pc_workers','ledger_entries','salary_raise_batches','sgk_transactions','sgk_payments','sgk_reports','sgk_robot_jobs'],
   array[]::text[], 4),
  ('ise_alim', 'İşe alım',
   'İlanlar, adaylar, özgeçmişler, aday puanları ve görüşme geçmişi',
   array['candidate_scores','candidate_events','candidates','job_postings'],
   array['documents:{c}/candidates/'], 5),
  ('isg', 'İSG ve KVKK',
   'İSG ziyaret / tespitleri, kazalar, risk analizleri, sağlık muayeneleri, eğitimler, KKD, acil durum, ölçümler, kurul, KVKK kayıtları ve onayları',
   array['isg_findings','isg_visits','isg_assignments','isg_professionals','safety_incidents','risk_items','risk_assessments','health_exams',
         'training_records','training_sessions','ppe_issues','emergency_drills','emergency_team','emergency_plans','env_measurements',
         'equipment_checks','sds_documents','committee_members','committee_meetings','kvkk_breaches','kvkk_checklist','kvkk_disposals',
         'kvkk_consents','kvkk_notices','kvkk_requests','kvkk_retention'],
   array['documents:{c}/isg'], 6),
  ('lab_is', 'Laboratuvar işleri ve sevkiyat',
   'İş emirleri, iş adımları, kalite kontrol, yeniden yapımlar, ertelemeler, makine kuyruğu, prim hesapları, siparişler, irsaliyeler ve e-irsaliyeler, ekstreler, tahsilatlar, kargolar ve kargo faturaları, dış laboratuvar işleri, portal vakaları, kalite (NCR / şikâyet)',
   array['job_qc_checks','job_runs','job_steps','job_notes','job_handoffs','job_files','job_items','job_packages','job_postpones',
         'prd_job_materials','prd_job_ops','prd_machine_queue','prd_machine_events','prd_remakes','prd_bonus_lines','prd_bonus_runs',
         'qms_actions','qms_ncrs','qms_complaints','qms_audits',
         'outsource_lines','outsource_statements','job_outsource','outsource_batches','outsource_price_alias','outsource_prices',
         'carrier_invoice_items','carrier_invoices','carrier_shipments','carrier_party_alias',
         'shipment_events','shipment_files','shipments','portal_case_ratings','portal_case_events','portal_case_files','portal_cases',
         'edsp_lines','edsp_despatches','lab_doc_events',
         'lab_payments','lab_statements','lab_waybills','lab_orders','lab_doc_seq','jobs'],
   array['job-files:','shipment-files:','portal-files:'], 7),
  ('musteri', 'Klinikler, hekimler ve portal hesapları',
   'Klinik / müşteri kartları, hekimler, özel fiyatlar, aktarılmış yıllık özetler, portal (site) hesapları ve üyeleri, grup şirketleri',
   array['lab_customer_prices','lab_customer_doctors','dsis_year_summary','lab_customers','portal_invites','portal_clients','portal_members','portal_accounts',
         'cns_entries','cns_entities'],
   array[]::text[], 8),
  ('finans', 'Finans (kasa, banka, cari, muhasebe fişleri)',
   'Kasa / banka hesapları ve hareketleri, banka ekstreleri ve e-posta aktarımları, mutabakatlar, çek / senet, krediler, kart taksitleri, ödeme planları ve hatırlatmaları, cari kartlar, tedarikçi fişleri, muhasebe fişleri, tahakkuklar, şüpheli alacaklar, kasa sayımları, beyannameler, Luca aktarımları (hesap planı ve eşleştirmeler korunur)',
   array['gl_luca_batch_items','gl_lines','gl_vouchers','gl_luca_batches','gl_deferrals','gl_doubtful','gl_cash_counts','gl_tax_filings',
         'gl_tax_adjustments','gl_stamp_docs','gl_package_sends','gl_stage_signoffs','gl_check_acks',
         'fin_cheque_events','fin_cheques','fin_loan_installments','fin_loans','fin_card_installments','fin_reconciliations',
         'fin_bank_lines','fin_bank_batches','fin_bank_rules','fin_bank_mail_pending','fin_bank_mail_seen','fin_pay_reminders','fin_payment_plans',
         'sup_import_keys','sup_slip_lines','fin_moves','fin_txns','sup_slip_open','sup_slips','fin_accounts','fin_parties'],
   array[]::text[], 9),
  ('fatura', 'Faturalar ve masraflar',
   'Satış / alış faturaları ve ekleri, e-fatura gelen kutusu, masraf beyanları, düzenli giderler, fiş fotoğrafları',
   array['inv_invoice_files','inv_lines','inv_invoices','einv_inbox','einv_mail_seen','exp_claims','exp_recurring'],
   array['receipts:'], 10),
  ('stok', 'Stok ve satın alma',
   'Stok kartları, reçeteler, lotlar, hareketler, sayımlar, mal kabul, transfer, malzeme istekleri, ÜTS bildirimleri, teklif istekleri, satın alma siparişleri ve bütçeleri, tedarikçi belgeleri / mesajları / fiyat listeleri ve portal hesapları',
   array['stk_request_signatures','stk_request_events','stk_request_lines','stk_requests','stk_transfer_lines','stk_transfers',
         'stk_count_lines','stk_counts','stk_receipt_lines','stk_receipts','uts_notifications','stk_moves','stk_lots','stk_buy_lists','stk_boms',
         'pur_rfq_quotes','pur_rfq_suppliers','pur_rfq_lines','pur_rfqs','pur_budgets',
         'sup_price_lines','sup_price_lists','sup_messages','sup_documents','sup_portal_users','sup_item_prices',
         'pur_order_lines','pur_orders','stk_items'],
   array[]::text[], 11),
  ('demirbas', 'Demirbaş ve zimmet',
   'Demirbaş kartları, zimmetler, amortisman, yeniden değerleme, bakım kayıtları, demirbaş sayımları',
   array['ast_count_items','ast_counts','asset_maintenance','asset_depreciation','asset_revaluations','asset_assignments','assets'],
   array[]::text[], 12),
  ('satis_servis', 'CRM ve teknik servis',
   'Satış fırsatları, görüşmeler, ofis aramaları, arıza / servis kayıtları ve fotoğrafları, teknisyenler',
   array['crm_activities','crm_leads','office_calls','svc_photos','svc_events','svc_tickets','svc_technicians'],
   array[]::text[], 13),
  ('iletisim', 'Mesajlar, duyurular ve talepler',
   'İç mesajlar, duyurular, anketler, bildirimler, soru-cevap, WhatsApp / posta bağlantıları, asistan geçmişi, notlar, hatırlatmalar, yönetici görevleri, mevzuat okumaları, onay talepleri, raporlar, ziyaretçiler',
   array['conversation_members','messages','conversations','announcement_reads','announcements','poll_votes','poll_options','event_rsvps',
         'notifications','qa_votes','qa_questions','wa_messages','wa_threads','mail_links','mail_ai','assistant_logs','user_notes',
         'user_reminders','admin_tasks','reg_reads','reg_notified','apr_actions','apr_requests','rpt_reports','srv_responses','vis_visits','vis_guards','cam_views'],
   array[]::text[], 14),
  ('tanimlar', 'Tanımlar',
   'Bölümler, unvanlar, pozisyonlar, organizasyon şeması, vardiya tanımları, yetkinlikler, e-eğitim kursları, kategoriler, depolar, ürün kataloğu ve reçete planları, istasyonlar, makineler, prim kuralları, onay akışları, kameralar, PDKS cihazları, fatura serileri. Sistemin hazır tanımları (KDV, demirbaş, açılış ve hazır masraf türleri, ana depo, hazır istasyonlar, teslim / prova seçenekleri, hazır vardiyalar) korunur.',
   array['onboarding_items','elearning_courses','skills','shifts','positions','org_units','org_unit_types','job_titles','departments',
         'prd_route_steps','prd_bonus_rules','prd_machines','prd_stations','lab_options','prd_recipe_plan','lab_products','stk_warehouses','stk_categories',
         'fin_categories','apr_flow_steps','apr_flows','cam_access','cam_cameras','devices','inv_series'],
   array[]::text[], 15),
  ('kullanicilar', 'Kullanıcı hesapları (sizinki hariç)',
   'Sizin dışınızdaki tüm ERP kullanıcılarının hesapları, şube / bölüm yetkileri, bildirim ve ana sayfa ayarları. Sizin hesabınız ve şirket sahipliğiniz korunur.',
   array['membership_branches','membership_departments','push_tokens','web_push_subscriptions','notification_prefs','user_dashboard','memberships'],
   array[]::text[], 16),
  ('site_mesaj', 'Web sitesi mesajları',
   'Siteden gelen iletişim formları, canlı sohbetler, vaka başvuruları ve etkinlik kayıtları',
   array['cms_chat_messages','cms_chats','cms_cases','cms_messages','cms_event_regs','cms_lead_status'],
   array[]::text[], 17),
  ('site_icerik', 'Web sitesi içerikleri',
   'Site sayfaları, haberler, ürünler, slaytlar, ekip, SSS, videolar, yorumlar, fiyat listesi, etkinlikler, içerik planı (site yayından boş kalır)',
   array['cms_announcements','cms_departments','cms_faqs','cms_help_videos','cms_media','cms_pages','cms_posts','cms_price_items',
         'cms_products','cms_slides','cms_stories','cms_team','cms_testimonials','cms_events','cms_content_plan'],
   array[]::text[], 18),
  ('loglar', 'İşlem geçmişi (denetim kaydı)',
   'Kim, ne zaman, neyi değiştirdi kayıtları, KVKK erişim kaydı ve kullanıcı yerine giriş kayıtları. Seçmezseniz silinen kayıtların eski hâli burada kalır (yedek görevi görür).',
   array['kvkk_access_log','impersonation_log','audit_log'],
   array[]::text[], 19)
$$;

-- ---------------------------------------------------------------------
-- Silme koşulu: sistemin hazır tanımları korunur
-- ---------------------------------------------------------------------
create or replace function sys_reset_where(p_table text, p_company uuid, p_module text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  w text;
  has_c boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'company_id');
  has_u boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'user_id');
  has_s boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'is_system');
begin
  if has_c and p_module = 'loglar' and (select count(*) from companies) = 1 then
    w := format('(company_id = %L or company_id is null)', p_company);   -- site içeriği kayıtları şirketsiz tutulur
  elsif has_c then w := format('company_id = %L', p_company);
  elsif (select count(*) from companies) > 1 then return null;
  else w := 'true';
  end if;
  if p_module = 'kullanicilar' and has_u then w := w || format(' and user_id is distinct from %L', auth.uid()); end if;
  -- sistem satırları ve kurulumla gelen hazır tanımlar (kodla aranan kategoriler, istasyon türleri, seçenekler, vardiyalar)
  if has_s then w := w || ' and not coalesce(is_system, false)'; end if;
  if p_table = 'fin_categories' then
    w := w || ' and not code = any (array[''sales_prosthesis'',''sales_goods'',''internal_collection'',''fx_gain'',''income_interest'',''income_other'','
              '''exp_material'',''exp_rent'',''exp_electric'',''exp_water'',''exp_gas'',''exp_telecom'',''exp_piece'',''exp_salary'',''exp_food'',''exp_fuel'','
              '''exp_cargo'',''exp_maintenance'',''exp_accounting'',''exp_bank'',''exp_interest'',''exp_tax'',''exp_marketing'',''exp_office'',''exp_cleaning'','
              '''exp_software'',''exp_depreciation'',''cogs'',''fx_loss'',''exp_other'',''vat_in'',''vat_out'',''stock'',''fixed_assets'',''opening'',''capital'','
              '''reval_fund'',''stopaj_rent'',''suspense'',''stopaj_smm'',''vat_resp'',''tax_payable'',''vat_refund'',''cash_short'',''cash_over'',''slip_mirror'']::text[])';
  elsif p_table = 'prd_stations' then
    w := w || ' and not code = any (array[''MDL'',''CAD'',''FRZ'',''SNT'',''POR'',''BIT'',''QC'',''PAK''])';
  elsif p_table = 'lab_options' then
    w := w || ' and not (kind, value) in ((''delivery'',''Bizim kurye''),(''delivery'',''Hekimin kuryesi''),(''delivery'',''Elden''),(''delivery'',''DHL''),'
              '(''delivery'',''UPS''),(''delivery'',''Kargo''),(''tryin'',''Metal prova''),(''tryin'',''Alt yapı prova''),(''tryin'',''Dentin prova''),'
              '(''tryin'',''Bisküvi prova''),(''tryin'',''Mum prova''),(''tryin'',''Diş dizimi prova''),(''tryin'',''Teslim''))';
  elsif p_table = 'stk_warehouses' then
    w := w || ' and not (is_default or coalesce(code, '''') in (''ANA'', ''URT''))';
  elsif p_table = 'shifts' then
    w := w || ' and not coalesce(code, '''') in (''G'', ''N'')';
  end if;
  return w;
end $$;

-- ---------------------------------------------------------------------
-- Temizlik sırasında onay talebi / bildirim üretilmez
-- ---------------------------------------------------------------------
select _mig_patch('sys_reset_run(text[], text)',
  $x$  -- tablolar: modül sırasıyla; işlem geçmişi en sonda$x$,
  $x$  -- temizlik süresince tetikleyiciler yeni onay talebi / bildirim açmaz
  perform set_config('app.resetting', 'on', true);
  -- işlem geçmişi de siliniyorsa silmeler yeniden denetim kaydı bırakmaz
  if 'loglar' = any (sel) then perform set_config('app.skip_audit', 'on', true); end if;

  -- tablolar: modül sırasıyla; işlem geçmişi en sonda$x$);
select _mig_patch('exp_claims_apr_restart()',
  $x$begin
  if new.status = 'submitted'$x$,
  $x$begin
  if current_setting('app.resetting', true) = 'on' then return new; end if;   -- sistem temizliği
  if new.status = 'submitted'$x$);
select _mig_patch('exp_claims_apr_start()',
  $x$begin
  if new.status = 'submitted'$x$,
  $x$begin
  if current_setting('app.resetting', true) = 'on' then return new; end if;   -- sistem temizliği
  if new.status = 'submitted'$x$);
select _mig_patch('apr_start(text, uuid, bigint, uuid, uuid, text, text)',
  $x$begin
  select * into f from apr_flows$x$,
  $x$begin
  if current_setting('app.resetting', true) = 'on' then return null; end if;  -- sistem temizliği
  select * into f from apr_flows$x$);
select _mig_patch('deliver(uuid, uuid[], text, text, text, boolean)',
  $x$begin
  select coalesce(array_agg(distinct u), '{}') into targets$x$,
  $x$begin
  if current_setting('app.resetting', true) = 'on' then return; end if;       -- sistem temizliği
  select coalesce(array_agg(distinct u), '{}') into targets$x$);

-- ---------------------------------------------------------------------
-- Hekim tahsilatı: "Görür" yetkisi yetmez
-- ---------------------------------------------------------------------
select _mig_patch('lab_payment_add(uuid, date, bigint, text, text, text, text, uuid, bigint)',
  $x$  if not can_logistics() then raise exception 'not_allowed'; end if;$x$,
  $x$  if not (exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner')
          or can_module('lab', 2) or can_module('finance', 2)) then raise exception 'not_allowed'; end if;   -- "Görür" (1) tahsilat giremez$x$);

drop function _mig_patch(text, text, text);

-- ---------------------------------------------------------------------
-- Denetim kaydı: ücret / bordro ve özel nitelikli kayıtlar yalnız yetkilisine
-- ---------------------------------------------------------------------
drop policy if exists audit_read_users on audit_log;
create policy audit_read_users on audit_log for select to authenticated using (
  (select module_level('users')) >= 2
  and company_id in (select m.company_id from memberships m where m.user_id = (select auth.uid()))
  and (table_name not in ('pay_contracts', 'ledger_entries', 'payroll_lines', 'payroll_history', 'payroll_periods', 'bes_enrollments',
                          'garnishment_files', 'garnishment_deductions', 'advance_requests', 'salary_raise_batches', 'pc_entries')
       or can_manage_pay(company_id))
  and (table_name <> 'employee_private' or can_manage_hr(company_id))
  and (table_name not in ('health_exams', 'safety_incidents')
       or can_manage_hr(company_id) or has_role(company_id, array['safety']::app_role[]))
);

notify pgrst, 'reload schema';
