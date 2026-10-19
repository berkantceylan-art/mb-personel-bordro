-- =====================================================================
-- Dış programdan satış faturası aktarımı (Bizim Hesap "Satış Raporu" Excel)
--  Her fatura cari karta işlenir (fatura tutarı cari kart bakiyesine girer); işlere / hekim carisine dokunmaz.
--  Aynı belge numarası ikinci kez aktarılmaz. e-Fatura gönderim kuyruğuna girmez (einvoice_status = 'imported').
-- Tekrar çalıştırılabilir.
-- =====================================================================

-- p: [{party_id | new_party:{name,tax_no,address,country,currency}, doc_no, date, due, currency, rate, profile, note, tax_no,
--      lines:[{name, qty, unit_price, vat_rate, unit}]}]
create or replace function inv_import_external(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := lab_company(); r jsonb; v_party uuid; v_id uuid; v_new jsonb := '{}'; v_key text; v_lines jsonb;
  n_ins int := 0; n_skip int := 0; n_party int := 0; errs jsonb := '[]';
begin
  if not can_module('sales', 2) then raise exception 'not_allowed'; end if;
  perform set_config('app.skip_audit', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    begin
      if exists (select 1 from inv_invoices where company_id = c and direction = 'sale' and doc_no = upper(trim(r->>'doc_no')) and status <> 'cancelled') then
        n_skip := n_skip + 1; continue;
      end if;
      v_party := nullif(r->>'party_id', '')::uuid;
      if v_party is null and r ? 'new_party' then
        v_key := upper(trim(r->'new_party'->>'name'));
        v_party := nullif(v_new->>v_key, '')::uuid;
        if v_party is null then
          select id into v_party from fin_parties where company_id = c and upper(trim(name)) = v_key and lab_customer_id is null limit 1;
        end if;
        if v_party is null then
          insert into fin_parties (company_id, name, kind, person_type, tax_no, address, country, currency, source)
          values (c, left(trim(r->'new_party'->>'name'), 200), 'customer',
                  case when length(coalesce(r->'new_party'->>'tax_no', '')) = 11 then 'person' else 'company' end,
                  case when r->'new_party'->>'tax_no' ~ '^\d{10,11}$' and r->'new_party'->>'tax_no' !~ '^(\d)\1+$'
                            and not exists (select 1 from fin_parties x where x.company_id = c and x.tax_no = r->'new_party'->>'tax_no') then r->'new_party'->>'tax_no' end,
                  nullif(left(r->'new_party'->>'address', 400), ''), coalesce(nullif(r->'new_party'->>'country', ''), 'TR'),
                  coalesce(nullif(r->'new_party'->>'currency', ''), 'TRY'), 'import')
          returning id into v_party;
          n_party := n_party + 1;
        end if;
        v_new := v_new || jsonb_build_object(v_key, v_party);
      end if;
      if v_party is null then raise exception 'party_required'; end if;
      -- vergi no boşsa doldur (sonraki aktarımda bununla eşleşir)
      if r->>'tax_no' ~ '^\d{10,11}$' and r->>'tax_no' !~ '^(\d)\1+$' then
        update fin_parties set tax_no = r->>'tax_no' where id = v_party and tax_no is null
          and not exists (select 1 from fin_parties x where x.company_id = c and x.tax_no = r->>'tax_no');
      end if;
      select jsonb_agg(l || jsonb_build_object('category_id', fin_category('sales_prosthesis'))) into v_lines from jsonb_array_elements(r->'lines') l;
      v_id := inv_save(jsonb_build_object(
        'direction', 'sale', 'party_id', v_party, 'doc_no', r->>'doc_no', 'invoice_date', r->>'date', 'due_date', r->>'due',
        'currency', r->>'currency', 'rate', r->>'rate', 'profile', r->>'profile', 'einvoice_status', 'imported', 'source', 'manual',
        'note', left(coalesce(r->>'note', ''), 1000), 'lines', v_lines));
      perform inv_post(v_id);
      n_ins := n_ins + 1;
    exception when others then
      errs := errs || jsonb_build_object('doc_no', r->>'doc_no', 'error', left(sqlerrm, 200));
    end;
  end loop;
  return jsonb_build_object('inserted', n_ins, 'skipped', n_skip, 'parties_created', n_party, 'errors', errs);
end $$;
revoke execute on function inv_import_external(jsonb) from public, anon;
grant execute on function inv_import_external(jsonb) to authenticated;

notify pgrst, 'reload schema';
