-- =====================================================================
-- Web sitesi: canlı destek, kurye talebi konusu, SSS
--
-- cms_chats / cms_chat_messages: sitedeki "Destek" düğmesinden açılan canlı
--   sohbetler. Ziyaretçi tabloya doğrudan erişemez; yalnız chat_start /
--   chat_send / chat_poll fonksiyonlarıyla, kendisine verilen gizli anahtarla
--   (yalnız özeti saklanır) kendi sohbetine yazar ve okur. Site editörleri
--   tüm sohbetleri görür ve cevaplar.
-- cms_message_topic: iletişim formuna "Kurye / ölçü alım" konusu.
-- cms_faqs: sıkça sorulan sorular (sitede /<dil>/sss).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Canlı destek
-- ---------------------------------------------------------------------
create table cms_chats (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  name text not null check (length(name) between 1 and 120),
  email text check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200)),
  locale text check (locale in ('tr', 'en', 'fr')),
  page text check (page is null or length(page) <= 300),
  status text not null default 'open' check (status in ('open', 'closed')),
  ip_hash text,
  note text check (note is null or length(note) <= 2000),
  last_message_at timestamptz not null default now(),
  last_visitor_at timestamptz not null default now(),
  staff_read_at timestamptz,
  visitor_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on cms_chats (status, last_message_at desc);
create index on cms_chats (ip_hash, created_at desc);

create table cms_chat_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references cms_chats (id) on delete cascade,
  sender text not null check (sender in ('visitor', 'staff')),
  body text not null check (length(body) between 1 and 2000),
  staff_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on cms_chat_messages (chat_id, id);

create trigger cms_chats_touch before update on cms_chats for each row execute function cms_touch();

-- Yeni mesaj gelince sohbetin zamanlarını güncelle
create or replace function cms_chat_after_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender = 'visitor' then
    update cms_chats set last_message_at = new.created_at, last_visitor_at = new.created_at, status = 'open' where id = new.chat_id;
  else
    update cms_chats set last_message_at = new.created_at, staff_read_at = new.created_at where id = new.chat_id;
  end if;
  return null;
end $$;
create trigger cms_chat_messages_after after insert on cms_chat_messages for each row execute function cms_chat_after_message();

alter table cms_chats enable row level security;
alter table cms_chat_messages enable row level security;
create policy cms_chats_editor_all on cms_chats for all to authenticated using (can_manage_site()) with check (can_manage_site());
create policy cms_chat_messages_editor_read on cms_chat_messages for select to authenticated using (can_manage_site());
create policy cms_chat_messages_editor_reply on cms_chat_messages for insert to authenticated
  with check (can_manage_site() and sender = 'staff' and staff_id = auth.uid());
create policy cms_chat_messages_editor_delete on cms_chat_messages for delete to authenticated using (can_manage_site());
grant select, update, delete on cms_chats to authenticated;
grant select, insert, delete on cms_chat_messages to authenticated;

create or replace function cms_chat_hash(p_token text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;
revoke execute on function cms_chat_hash(text) from public, anon, authenticated;

-- Sohbet başlat: aynı adresten saatte en fazla 3 sohbet
create or replace function chat_start(
  p_token text, p_name text, p_email text, p_body text, p_locale text, p_page text, p_ip_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_recent int; v_email text := nullif(left(trim(coalesce(p_email, '')), 200), '');
begin
  if length(coalesce(p_token, '')) < 32 then raise exception 'bad_token' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'missing' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email' using errcode = 'P0001';
  end if;
  if p_ip_hash is not null then
    select count(*) into v_recent from cms_chats where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_recent >= 3 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  end if;
  insert into cms_chats (token_hash, name, email, locale, page, ip_hash)
  values (
    cms_chat_hash(p_token), left(trim(p_name), 120), v_email,
    case when p_locale in ('tr', 'en', 'fr') then p_locale else null end,
    left(p_page, 300), left(p_ip_hash, 64)
  ) returning id into v_id;
  insert into cms_chat_messages (chat_id, sender, body, staff_id) values (v_id, 'visitor', left(trim(p_body), 2000), null);
  return v_id;
end $$;

-- Ziyaretçi mesajı: dakikada en fazla 15 mesaj
create or replace function chat_send(p_chat uuid, p_token text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_recent int;
begin
  if not exists (select 1 from cms_chats where id = p_chat and token_hash = cms_chat_hash(p_token)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'missing' using errcode = 'P0001'; end if;
  select count(*) into v_recent from cms_chat_messages
    where chat_id = p_chat and sender = 'visitor' and created_at > now() - interval '1 minute';
  if v_recent >= 15 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  insert into cms_chat_messages (chat_id, sender, body, staff_id) values (p_chat, 'visitor', left(trim(p_body), 2000), null)
    returning id into v_id;
  return v_id;
end $$;

-- Ziyaretçinin kendi sohbetini okuması (p_after: son görülen mesaj no)
create or replace function chat_poll(p_chat uuid, p_token text, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chat cms_chats;
begin
  select * into v_chat from cms_chats where id = p_chat and token_hash = cms_chat_hash(p_token);
  if not found then return null; end if;
  update cms_chats set visitor_seen_at = now() where id = p_chat;
  return jsonb_build_object(
    'status', v_chat.status,
    'name', v_chat.name,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'at', m.created_at) order by m.id)
      from (select * from cms_chat_messages where chat_id = p_chat and id > coalesce(p_after, 0) order by id limit 200) m
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function chat_start(text, text, text, text, text, text, text) from public;
revoke execute on function chat_send(uuid, text, text) from public;
revoke execute on function chat_poll(uuid, text, bigint) from public;
grant execute on function chat_start(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function chat_send(uuid, text, text) to anon, authenticated;
grant execute on function chat_poll(uuid, text, bigint) to anon, authenticated;

-- Editör, bir konuşmayı gelen kutusuna aktarabilsin
grant insert on cms_messages to authenticated;

-- Cevap bekleyen sohbet sayısı (admin menüsü için)
create or replace function cms_unread_chats() returns integer
language sql stable security invoker set search_path = public as $$
  select count(*)::int from cms_chats
  where status = 'open' and (staff_read_at is null or last_visitor_at > staff_read_at);
$$;
grant execute on function cms_unread_chats() to authenticated;

-- ---------------------------------------------------------------------
-- İletişim formu: kurye / ölçü alım talebi
-- ---------------------------------------------------------------------
alter type cms_message_topic add value if not exists 'pickup';

create or replace function submit_site_message(
  p_topic text, p_name text, p_email text, p_phone text, p_company text, p_country text,
  p_message text, p_meta jsonb, p_locale text, p_page text, p_ip_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_recent int;
begin
  if p_ip_hash is not null then
    select count(*) into v_recent from cms_messages
      where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
    if v_recent >= 5 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;
  insert into cms_messages (topic, name, email, phone, company, country, message, meta, locale, page, ip_hash)
  values (
    case when p_topic in ('general', 'case', 'price', 'partner', 'pickup') then p_topic::cms_message_topic else 'general' end,
    left(trim(p_name), 120), left(trim(p_email), 200),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''), nullif(left(trim(coalesce(p_company, '')), 160), ''),
    nullif(left(trim(coalesce(p_country, '')), 80), ''), left(trim(p_message), 5000),
    case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end,
    case when p_locale in ('tr', 'en', 'fr') then p_locale else null end,
    left(p_page, 300), left(p_ip_hash, 64)
  ) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Sıkça sorulan sorular
-- ---------------------------------------------------------------------
create table cms_faqs (
  id uuid primary key default gen_random_uuid(),
  question jsonb not null default '{}'::jsonb check (is_i18n_text(question)),
  answer jsonb not null default '{}'::jsonb check (is_i18n_text(answer)),
  category text not null default 'genel' check (category in ('genel', 'vaka', 'dosya', 'teslimat', 'portal')),
  sort integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on cms_faqs (sort) where deleted_at is null;

create trigger cms_faqs_touch before update on cms_faqs for each row execute function cms_touch();
create trigger audit_cms_faqs after insert or update or delete on cms_faqs for each row execute function audit_trigger();

alter table cms_faqs enable row level security;
create policy cms_faqs_public_read on cms_faqs for select to anon, authenticated using (deleted_at is null and is_active);
create policy cms_faqs_editor_all on cms_faqs for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_faqs to anon;
grant select, insert, update, delete on cms_faqs to authenticated;

insert into cms_faqs (category, sort, question, answer) values
('vaka', 10,
 '{"tr":"Vakamı nasıl gönderebilirim?","en":"How do I send a case?","fr":"Comment envoyer un cas ?"}',
 '{"tr":"İki yolu var: Hekim portalına üye olup vakayı dosyalarıyla birlikte çevrim içi gönderebilir ya da sitedeki “Vaka gönder” formunu doldurabilirsiniz. Ölçü veya model gönderecekseniz kurye talebi oluşturmanız yeterli.","en":"There are two ways: join the doctor portal and submit the case online with its files, or fill in the “Send a case” form on the site. If you are sending impressions or models, simply request a courier pickup.","fr":"Deux possibilités : inscrivez-vous au portail praticien et envoyez le cas en ligne avec ses fichiers, ou remplissez le formulaire « Envoyer un cas ». Pour des empreintes ou des modèles, demandez simplement un enlèvement par coursier."}'),
('dosya', 20,
 '{"tr":"Hangi dosya biçimlerini kabul ediyorsunuz?","en":"Which file formats do you accept?","fr":"Quels formats de fichiers acceptez-vous ?"}',
 '{"tr":"Ağız içi tarayıcıların açık biçimdeki çıktılarını (STL, PLY, OBJ) ve fotoğrafları (JPG, PNG) kabul ediyoruz. Dosyaları portaldaki vakanıza doğrudan yükleyebilirsiniz.","en":"We accept open-format exports from intraoral scanners (STL, PLY, OBJ) and photos (JPG, PNG). You can upload files straight to your case in the portal.","fr":"Nous acceptons les exports ouverts des scanners intra-oraux (STL, PLY, OBJ) et les photos (JPG, PNG). Vous pouvez les déposer directement dans votre cas sur le portail."}'),
('portal', 30,
 '{"tr":"Vakamın hangi aşamada olduğunu nasıl görürüm?","en":"How can I see where my case is?","fr":"Comment suivre l’avancement de mon cas ?"}',
 '{"tr":"Portalda her vakanın aşaması (alındı, tasarım, üretim, kalite kontrol, kargoda, teslim edildi) anlık görünür. Aşama değiştikçe vaka geçmişine kayıt düşer ve laboratuvarla vaka üzerinden yazışabilirsiniz.","en":"In the portal, each case shows its current stage (received, design, production, quality control, shipped, delivered). Every change is logged in the case history and you can message the lab on the case.","fr":"Sur le portail, chaque cas affiche son étape (reçu, conception, production, contrôle qualité, expédié, livré). Chaque changement est consigné et vous pouvez échanger avec le laboratoire sur le cas."}'),
('teslimat', 40,
 '{"tr":"Yurt dışından vaka gönderebilir miyim?","en":"Can I send cases from abroad?","fr":"Puis-je envoyer des cas depuis l’étranger ?"}',
 '{"tr":"Evet. Yurt dışındaki hekim, klinik ve aracı kuruluşlar portala kendi dillerinde (Türkçe, İngilizce, Fransızca) üye olup dijital vakalarını gönderebilir. Gönderim ve teslimat ayrıntıları için bize yazın.","en":"Yes. Doctors, clinics and agencies abroad can join the portal in their own language (Turkish, English, French) and submit digital cases. Write to us for shipping and delivery details.","fr":"Oui. Les praticiens, cliniques et intermédiaires à l’étranger peuvent s’inscrire au portail dans leur langue (turc, anglais, français) et envoyer leurs cas numériques. Écrivez-nous pour les détails d’expédition et de livraison."}'),
('genel', 50,
 '{"tr":"Fiyat bilgisi nasıl alabilirim?","en":"How can I get pricing?","fr":"Comment obtenir les tarifs ?"}',
 '{"tr":"İletişim formunda “Fiyat” konusunu seçerek ya da destek düğmesinden WhatsApp ile yazarak güncel fiyat listemizi isteyebilirsiniz.","en":"Choose “Pricing” on the contact form, or message us on WhatsApp from the support button, to receive our current price list.","fr":"Choisissez « Tarifs » dans le formulaire de contact, ou écrivez-nous sur WhatsApp via le bouton d’aide, pour recevoir notre liste de prix."}');

-- Çöp kutusu temizliği SSS'yi de kapsasın; kapanmış ve 180 günden eski sohbetler silinsin
create or replace function cms_purge_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  delete from cms_slides where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_announcements where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_products where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_stories where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_pages where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_cases where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_faqs where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_chats where status = 'closed' and last_message_at < now() - interval '180 days';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke execute on function cms_purge_trash() from public, anon, authenticated;

-- Değişiklik geçmişi SSS'yi de göstersin
create or replace function cms_audit(p_limit integer default 100, p_before bigint default null, p_table text default null)
returns table (
  id bigint, table_name text, row_id text, action text, at timestamptz,
  actor_email text, label text, changed text[]
)
language sql stable security definer set search_path = public as $$
  select a.id, a.table_name, a.row_id, a.action, a.at,
         u.email::text,
         coalesce(
           nullif(coalesce(a.new_data, a.old_data)->'title'->>'tr', ''),
           nullif(coalesce(a.new_data, a.old_data)->'name'->>'tr', ''),
           nullif(coalesce(a.new_data, a.old_data)->'question'->>'tr', ''),
           coalesce(a.new_data, a.old_data)->>'slug',
           ''
         ),
         case when a.action = 'UPDATE' then (
           select array_agg(k order by k) from jsonb_object_keys(a.new_data) k
           where k not in ('updated_at', 'updated_by') and a.new_data->k is distinct from a.old_data->k
         ) end
  from audit_log a
  left join auth.users u on u.id = a.actor
  where can_manage_site()
    and a.table_name in ('cms_slides', 'cms_announcements', 'cms_products', 'cms_stories', 'cms_pages', 'cms_cases', 'cms_faqs', 'site_settings')
    and (p_before is null or a.id < p_before)
    and (p_table is null or a.table_name = p_table)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;
revoke execute on function cms_audit(integer, bigint, text) from public, anon;
grant execute on function cms_audit(integer, bigint, text) to authenticated;

-- /<dil>/sss artık site sayfası: kurumsal sayfa adresi olarak kullanılamasın
alter table cms_pages drop constraint if exists cms_pages_slug_check;
alter table cms_pages add constraint cms_pages_slug_check check (
  slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60
  and slug not in ('urunler', 'iletisim', 'vaka-gonder', 'vakalar', 'sss', 'admin', 'giris', 'auth', 'api', 'sayfa', 'portal')
);
