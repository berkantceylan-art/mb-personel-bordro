-- İhracat (IHRACAT) faturalarında alıcı: GİB gereği AccountingCustomerParty = Gümrük ve Ticaret Bakanlığı (VKN 1460415308).
-- Gerçek alıcı BuyerCustomerParty'dedir. Daha önce içeri alınan giden e-faturalarda alıcı adını düzeltir.
do $$
declare r record; v_name text; v_vkn text; n int := 0;
  ns text[] := array[array['cac','urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'],
                     array['cbc','urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2']];
begin
  for r in select id, xml from einv_inbox where sender_vkn = '1460415308' or (profile = 'IHRACAT' and direction = 'out') loop
    begin
      v_name := nullif(trim((xpath('//cac:BuyerCustomerParty/cac:Party/cac:PartyName/cbc:Name/text()', r.xml::xml, ns))[1]::text), '');
      if v_name is null then
        v_name := nullif(trim(concat_ws(' ',
          (xpath('//cac:BuyerCustomerParty/cac:Party/cac:Person/cbc:FirstName/text()', r.xml::xml, ns))[1]::text,
          (xpath('//cac:BuyerCustomerParty/cac:Party/cac:Person/cbc:FamilyName/text()', r.xml::xml, ns))[1]::text)), '');
      end if;
      v_vkn := nullif(regexp_replace(coalesce((xpath('//cac:BuyerCustomerParty/cac:Party/cac:PartyIdentification/cbc:ID/text()', r.xml::xml, ns))[1]::text, ''), '\D', '', 'g'), '');
      if v_name is not null then
        update einv_inbox set sender_name = left(v_name, 250), sender_vkn = case when v_vkn = '1460415308' then null else left(v_vkn, 20) end where id = r.id;
        n := n + 1;
      end if;
    exception when others then null;
    end;
  end loop;
  raise notice 'İhracat alıcısı düzeltilen belge: %', n;
end $$;

-- Kontrol: alıcısı Gümrük ve Ticaret Bakanlığı olarak kalmış satış faturaları (varsa elle doğru cariye taşıyın)
select i.id, i.doc_no, i.invoice_date, i.party_name from inv_invoices i
 where i.direction = 'sale' and i.party_tax_no = '1460415308' and i.status <> 'cancelled' order by i.invoice_date desc limit 50;
