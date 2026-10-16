-- Fatura görüntüsü / PDF eki (kağıt fatura, fiş, e-Arşiv çıktısı). Dosya 'receipts' deposunda durur.
create table if not exists inv_invoice_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  invoice_id uuid not null references inv_invoices (id) on delete cascade,
  path text not null check (length(path) between 3 and 300),
  name text check (name is null or length(name) <= 200),
  mime text check (mime is null or length(mime) <= 80),
  size int,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists inv_invoice_files_idx on inv_invoice_files (invoice_id);
alter table inv_invoice_files enable row level security;
drop policy if exists inv_invoice_files_read on inv_invoice_files;
create policy inv_invoice_files_read on inv_invoice_files for select to authenticated
  using (company_id = (select lab_company()) and ((select can_module('purchases')) or (select can_module('sales')) or (select can_module('finance')) or (select can_module('ledger'))));
revoke all on inv_invoice_files from anon;
grant select on inv_invoice_files to authenticated;
