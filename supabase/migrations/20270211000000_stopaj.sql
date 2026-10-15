-- =====================================================================
-- Stopaj (gelir vergisi kesintisi): kira ve serbest meslek ödemeleri
--  Masraf girerken "Stopaj" seçilirse tutar brüttür: gider brüt, stopaj "Ödenecek stopaj" kategorisine (muhasebede 360),
--  kasadan / bankadan net çıkar. Muhtasar hazırlıkta ay ay toplamı görünür.
-- Tekrar çalıştırılabilir. Önce 20270210000000_gl_slip_payment.sql.
-- =====================================================================

insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, v.code, v.name, 'other', true, 90 from companies c
cross join (values ('stopaj_rent', 'Ödenecek kira stopajı'), ('stopaj_smm', 'Ödenecek serbest meslek stopajı')) v(code, name)
where not exists (select 1 from fin_categories x where x.company_id = c.id and x.code = v.code);

-- Muhasebe eşleştirmesi: 360 Ödenecek Vergi ve Fonlar
insert into gl_maps (company_id, source, key, account_id)
select a.company_id, 'category_code', v.code, a.id from gl_accounts a cross join (values ('stopaj_rent'), ('stopaj_smm')) v(code)
where a.code = '360' on conflict do nothing;

-- Kira gideri: varsayılan 770 (genel yönetim); kategori bazında değiştirilebilir
-- Muhtasar hazırlık: dönemde kesilen stopaj
create or replace function gl_withholding_report(p_period text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') or can_module('finance') then jsonb_build_object(
    'rent', coalesce((select -sum(m.amount_try) from fin_moves m join fin_txns t on t.id = m.txn_id join fin_categories c on c.id = m.category_id
                      where t.company_id = lab_company() and t.voided_at is null and c.code = 'stopaj_rent' and to_char(m.move_date, 'YYYY-MM') = p_period), 0),
    'smm', coalesce((select -sum(m.amount_try) from fin_moves m join fin_txns t on t.id = m.txn_id join fin_categories c on c.id = m.category_id
                     where t.company_id = lab_company() and t.voided_at is null and c.code = 'stopaj_smm' and to_char(m.move_date, 'YYYY-MM') = p_period), 0)
  ) end;
$$;
revoke execute on function gl_withholding_report(text) from public, anon;
grant execute on function gl_withholding_report(text) to authenticated;

notify pgrst, 'reload schema';
