-- Personel kendi özlük belgelerini (e-Devlet belgeleri vb.) telefondan yükler.
-- Kendi kaydına ekleyebilir, kendi dosyasını okuyabilir; silme ve diğer işlemler İK'da kalır.

-- Yardımcı: oturumdaki kullanıcının personel kaydı mı?
create or replace function is_self_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees e where e.id = p_employee and e.user_id = auth.uid());
$$;

drop policy if exists docs_self_insert on employee_documents;
create policy docs_self_insert on employee_documents for insert
  with check (is_self_employee(employee_id) and uploaded_by = auth.uid());

-- Depo: personel kendi klasörüne yazar ve kendi klasörünü okur
-- (yol: <company>/employees/<employee_id>/...)
drop policy if exists "documents_self_write" on storage.objects;
create policy "documents_self_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = 'employees'
    and is_self_employee(((storage.foldername(name))[3])::uuid)
  );
drop policy if exists "documents_self_read" on storage.objects;
create policy "documents_self_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = 'employees'
    and is_self_employee(((storage.foldername(name))[3])::uuid)
  );

-- Personel belge yükleyince İK'ya bildirim
create or replace function trg_document_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; t text; users uuid[];
begin
  select * into e from employees where id = new.employee_id;
  if e.user_id is null or new.uploaded_by is distinct from e.user_id then return new; end if;
  select name into t from document_types where id = new.document_type_id;
  select coalesce(array_agg(m.user_id), '{}') into users from memberships m
  where m.company_id = new.company_id and m.role in ('owner', 'hr');
  perform deliver(new.company_id, users, 'Personel belge yükledi',
    e.first_name || ' ' || e.last_name || ' · ' || coalesce(t, 'Belge'), '/personel/' || e.id || '/kayit?adim=2');
  return new;
end $$;
drop trigger if exists document_notify on employee_documents;
create trigger document_notify after insert on employee_documents for each row execute function trg_document_notify();
