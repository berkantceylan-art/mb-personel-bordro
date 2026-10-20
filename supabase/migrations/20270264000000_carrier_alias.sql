-- Kargo alıcı adı → hekim eşleştirmesi (öğrenilen eşleşmeler). Bir kez atanan alıcı adı sonraki fatura / konşimento listelerinde otomatik eşleşir.
create table if not exists carrier_party_alias (
  company_id uuid not null default lab_company(),
  norm_name text not null,
  customer_id uuid not null references lab_customers (id) on delete cascade,
  sample_name text,
  created_at timestamptz not null default now(),
  primary key (company_id, norm_name)
);
alter table carrier_party_alias enable row level security;
drop policy if exists carrier_party_alias_rw on carrier_party_alias;
create policy carrier_party_alias_rw on carrier_party_alias for all to authenticated
  using (company_id = lab_company() and (can_logistics() or can_module('finance')))
  with check (company_id = lab_company() and (can_logistics() or can_module('finance', 2)));

-- yeni / güncellenen satırlarda hekim boşsa öğrenilmiş eşleşmeden doldur
create or replace function carrier_alias_fill_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    select a.customer_id into new.customer_id from carrier_party_alias a join carrier_invoices i on i.id = new.invoice_id and i.company_id = a.company_id
     where a.norm_name in (dsis_norm(new.recipient_company), dsis_norm(new.recipient)) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists carrier_alias_fill_item on carrier_invoice_items;
create trigger carrier_alias_fill_item before insert or update on carrier_invoice_items for each row execute function carrier_alias_fill_item();

create or replace function carrier_alias_fill_ship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then
    select a.customer_id into new.customer_id from carrier_party_alias a
     where a.company_id = new.company_id and a.norm_name in (dsis_norm(new.party_company), dsis_norm(new.party_contact)) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists carrier_alias_fill_ship on carrier_shipments;
create trigger carrier_alias_fill_ship before insert or update on carrier_shipments for each row execute function carrier_alias_fill_ship();

-- alıcı adlarını bir hekime ata (mevcut boş satırlar + öğren)
create or replace function carrier_assign_customer(p_names text[], p_customer uuid, p_remember boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_norms text[]; n1 int; n2 int;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from lab_customers where id = p_customer and company_id = c) then raise exception 'bad_customer'; end if;
  select array_agg(distinct dsis_norm(x)) into v_norms from unnest(p_names) x where length(dsis_norm(x)) >= 2;
  if v_norms is null then return jsonb_build_object('items', 0, 'shipments', 0); end if;
  if p_remember then
    insert into carrier_party_alias (company_id, norm_name, customer_id, sample_name)
    select c, nm, p_customer, (select x from unnest(p_names) x where dsis_norm(x) = nm limit 1) from unnest(v_norms) nm
    on conflict (company_id, norm_name) do update set customer_id = excluded.customer_id, sample_name = excluded.sample_name;
  end if;
  update carrier_invoice_items it set customer_id = p_customer from carrier_invoices i
   where i.id = it.invoice_id and i.company_id = c and it.customer_id is null
     and (dsis_norm(it.recipient_company) = any (v_norms) or dsis_norm(it.recipient) = any (v_norms));
  get diagnostics n1 = row_count;
  update carrier_shipments s set customer_id = p_customer
   where s.company_id = c and s.customer_id is null and (dsis_norm(s.party_company) = any (v_norms) or dsis_norm(s.party_contact) = any (v_norms));
  get diagnostics n2 = row_count;
  return jsonb_build_object('items', n1, 'shipments', n2);
end $$;
revoke execute on function carrier_assign_customer(text[], uuid, boolean) from public, anon;
grant execute on function carrier_assign_customer(text[], uuid, boolean) to authenticated;
