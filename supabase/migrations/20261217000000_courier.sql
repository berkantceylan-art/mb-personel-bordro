-- =====================================================================
-- KURYE: irsaliye teslimi (teslim alan, imza), ölçü alma; WhatsApp için müşteri telefonu kullanılır
-- Tekrar çalıştırılabilir. Önce 20261216000000_pricing.sql.
-- =====================================================================
alter table lab_waybills add column if not exists delivered_at timestamptz;
alter table lab_waybills add column if not exists delivered_to text check (delivered_to is null or length(delivered_to) <= 120);
alter table lab_waybills add column if not exists signature text check (signature is null or length(signature) <= 300000);
alter table lab_waybills add column if not exists delivery_note text check (delivery_note is null or length(delivery_note) <= 300);
alter table lab_waybills add column if not exists delivered_by uuid;
alter table lab_orders add column if not exists picked_at timestamptz;
alter table lab_orders add column if not exists picked_by uuid;

create or replace function lab_waybill_deliver(p_id uuid, p_to text, p_signature text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  if p_signature is not null and p_signature <> '' and p_signature !~ '^data:image/png;base64,' then raise exception 'bad_signature'; end if;
  update lab_waybills set delivered_at = now(), delivered_to = nullif(left(trim(coalesce(p_to, '')), 120), ''), signature = nullif(p_signature, ''),
    delivery_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), delivered_by = auth.uid(),
    status = case when status = 'open' then 'issued' else status end, issued_at = coalesce(issued_at, now())
  where id = p_id and status <> 'cancelled';
end $$;
grant execute on function lab_waybill_deliver(uuid, text, text, text) to authenticated;

create or replace function lab_order_picked(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  update lab_orders set picked_at = now(), picked_by = auth.uid(), updated_at = now() where id = p_id;
end $$;
grant execute on function lab_order_picked(uuid) to authenticated;

notify pgrst, 'reload schema';
