-- Sigortasız personel: ücret kartında sigorta türü "NONE" (Sigortasız).
-- Resmi bordro / SGK / vergi / BES / icra hesaplanmaz; anlaşılan ücretin tamamı elden ödenir.
-- Tekrar çalıştırılabilir.
alter type insurance_type add value if not exists 'NONE';

-- Belirli net yalnız FIXED_NET için zorunlu
alter table pay_contracts drop constraint if exists pay_contracts_check;
alter table pay_contracts drop constraint if exists pay_contracts_fixed_check;
alter table pay_contracts add constraint pay_contracts_fixed_check check (insurance_type::text <> 'FIXED_NET' or fixed_official_net is not null);

notify pgrst, 'reload schema';
