-- =====================================================================
-- Web sitesi büyüme paketi
--  cms_posts         : blog / bilgi merkezi (TR/EN/FR), zamanlanmış yayın
--  cms_testimonials  : hekim görüşleri (yalnız izinli, gerçek görüşler)
--  cms_products.lead_days : teslim süresi hesaplayıcı (iş günü)
--  cms_pages.publish_at   : sayfaları ileri tarihte yayınlama
--  cms_announcements      : portal duyuruları hesap türüne göre (target_types)
--  public_job_postings()  : sitede açık iş ilanları (yalnız güvenli alanlar)
-- Tekrar çalıştırılabilir.
-- =====================================================================

-- Blog
create table if not exists cms_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  category text not null default 'rehber' check (category in ('rehber', 'vaka', 'teknoloji', 'haber', 'malzeme')),
  title jsonb not null default '{}'::jsonb check (is_i18n_text(title)),
  summary jsonb not null default '{}'::jsonb check (is_i18n_text(summary)),
  body jsonb not null default '{}'::jsonb check (is_i18n_text(body)),
  seo_title jsonb not null default '{}'::jsonb check (is_i18n_text(seo_title)),
  seo_description jsonb not null default '{}'::jsonb check (is_i18n_text(seo_description)),
  image_path text,
  author text check (author is null or length(author) <= 80),
  tags text[] not null default '{}',
  publish_at timestamptz not null default now(),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists cms_posts_pub_idx on cms_posts (publish_at desc) where deleted_at is null;
drop trigger if exists cms_posts_touch on cms_posts;
create trigger cms_posts_touch before update on cms_posts for each row execute function cms_touch();
drop trigger if exists audit_cms_posts on cms_posts;
create trigger audit_cms_posts after insert or update or delete on cms_posts for each row execute function audit_trigger();
alter table cms_posts enable row level security;
drop policy if exists cms_posts_public_read on cms_posts;
create policy cms_posts_public_read on cms_posts for select to anon, authenticated
  using (deleted_at is null and is_active and publish_at <= now());
drop policy if exists cms_posts_editor_all on cms_posts;
create policy cms_posts_editor_all on cms_posts for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_posts to anon;
grant select, insert, update, delete on cms_posts to authenticated;

-- Hekim görüşleri
create table if not exists cms_testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  role text check (role is null or length(role) <= 120),           -- Dr., klinik adı
  city text check (city is null or length(city) <= 80),
  country text check (country is null or length(country) <= 60),
  quote jsonb not null default '{}'::jsonb check (is_i18n_text(quote)),
  rating smallint check (rating is null or rating between 1 and 5),
  photo_path text,
  consent boolean not null default false,                            -- yayın izni alındı
  source text check (source is null or length(source) <= 200),     -- ör. e-posta tarihi, Google yorumu bağlantısı
  sort integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (not is_active or consent)                                    -- izinsiz görüş yayınlanamaz
);
drop trigger if exists cms_testimonials_touch on cms_testimonials;
create trigger cms_testimonials_touch before update on cms_testimonials for each row execute function cms_touch();
drop trigger if exists audit_cms_testimonials on cms_testimonials;
create trigger audit_cms_testimonials after insert or update or delete on cms_testimonials for each row execute function audit_trigger();
alter table cms_testimonials enable row level security;
drop policy if exists cms_testimonials_public_read on cms_testimonials;
create policy cms_testimonials_public_read on cms_testimonials for select to anon, authenticated
  using (deleted_at is null and is_active and consent);
drop policy if exists cms_testimonials_editor_all on cms_testimonials;
create policy cms_testimonials_editor_all on cms_testimonials for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_testimonials to anon;
grant select, insert, update, delete on cms_testimonials to authenticated;

-- Teslim süresi (iş günü) ve sayfa yayın zamanı
alter table cms_products add column if not exists lead_days smallint check (lead_days is null or lead_days between 0 and 60);
alter table cms_pages add column if not exists publish_at timestamptz;
drop policy if exists cms_pages_public_read on cms_pages;
create policy cms_pages_public_read on cms_pages for select to anon, authenticated
  using (deleted_at is null and is_active and (publish_at is null or publish_at <= now()));

alter table cms_pages drop constraint if exists cms_pages_slug_check;
alter table cms_pages add constraint cms_pages_slug_check check (
  slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60
  and slug not in ('urunler', 'iletisim', 'vaka-gonder', 'vakalar', 'sss', 'ekibimiz', 'blog', 'kariyer', 'teslim-suresi', 'yurtdisi', 'admin', 'giris', 'auth', 'api', 'sayfa', 'portal')
);

-- Portal duyuruları: hesap türüne göre hedefleme (boş = tüm portal hesapları)
alter table cms_announcements add column if not exists target_types text[] not null default '{}';
drop policy if exists cms_announcements_portal_read on cms_announcements;
create policy cms_announcements_portal_read on cms_announcements for select to authenticated
  using (
    deleted_at is null and is_active and audience = 'portal'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and exists (
      select 1 from portal_members m join portal_accounts a on a.id = m.account_id
      where m.user_id = auth.uid() and a.status = 'active'
        and (cardinality(target_types) = 0 or a.type::text = any (target_types))
    )
  );

-- Sitede açık iş ilanları (ERP işe alım modülünden; aday verisi değil, yalnız ilan)
create or replace function public_job_postings()
returns table (slug text, title text, department text, employment_type text, experience text, location text, description text, requirements text, closes_on date)
language sql stable security definer set search_path = public as $$
  select p.slug, p.title, d.name, p.employment_type, p.experience, p.location, p.description, p.requirements, p.closes_on
  from job_postings p left join departments d on d.id = p.department_id
  where p.status = 'open' and (p.closes_on is null or p.closes_on >= current_date)
  order by p.created_at desc
  limit 50;
$$;
grant execute on function public_job_postings() to anon, authenticated;

-- Yasal sayfa taslakları (yoksa; yönetim panelinden düzenlenir)
do $seed$ begin
  if not exists (select 1 from cms_pages where slug = 'kvkk-aydinlatma') then
    insert into cms_pages (slug, "group", title, summary, body, show_in_footer, sort) values
    ('kvkk-aydinlatma', 'diger',
     '{"tr":"KVKK aydınlatma metni","en":"Personal data notice (KVKK)","fr":"Information sur les données personnelles (KVKK)"}',
     '{"tr":"Kişisel verilerinizin işlenmesine ilişkin bilgilendirme","en":"How we process your personal data","fr":"Comment nous traitons vos données personnelles"}',
     '{"tr":"Veri sorumlusu: MB Dental.\n\nİşlenen veriler: iletişim formu, canlı destek ve hekim portalında paylaştığınız ad, iletişim bilgileri, vaka bilgileri (hasta adı yerine kısa hasta kodu) ve dosyalar.\n\nAmaç: talebinizi yanıtlamak, laboratuvar hizmetini sunmak, yasal yükümlülükleri yerine getirmek.\n\nAktarım: yalnız hizmetin gerektirdiği barındırma ve iletişim sağlayıcılarıyla, gerekli güvenlik önlemleriyle.\n\nHaklarınız: KVKK m.11 kapsamındaki başvurularınızı iletişim sayfasındaki adrese iletebilirsiniz.\n\nBu metin taslaktır; hukuk danışmanınızla gözden geçirip yönetim panelinden güncelleyin.","en":"Data controller: MB Dental.\n\nWe process the name, contact details, case information (a short patient code instead of the patient name) and files you share via the contact form, live chat and the dentist portal, in order to answer your request and provide our laboratory services.\n\nYou may exercise your rights by contacting us via the contact page.\n\nDraft text — please review with your legal adviser.","fr":"Responsable du traitement : MB Dental.\n\nNous traitons les nom, coordonnées, informations de cas (code patient court au lieu du nom) et fichiers que vous partagez via le formulaire de contact, le chat et le portail praticien, afin de répondre à votre demande et de fournir nos services de laboratoire.\n\nVous pouvez exercer vos droits (RGPD) via la page contact.\n\nTexte provisoire — à faire valider par votre conseil juridique."}',
     true, 90),
    ('cerez-politikasi', 'diger',
     '{"tr":"Çerez politikası","en":"Cookie policy","fr":"Politique des cookies"}',
     '{"tr":"Sitede kullanılan çerezler","en":"Cookies used on this site","fr":"Cookies utilisés sur ce site"}',
     '{"tr":"Bu site yalnız zorunlu çerezler kullanır: dil tercihi, oturum (giriş yaptıysanız) ve canlı destek konuşmanızın sürmesi için. Ziyaret istatistikleri çerez kullanmayan, kişiyi tanımlamayan bir yöntemle ölçülür. Reklam ya da takip çerezi kullanılmaz.","en":"This site only uses essential cookies: language preference, session (when signed in) and keeping your live chat conversation. Visit statistics are measured without cookies and without identifying you. No advertising or tracking cookies are used.","fr":"Ce site n’utilise que des cookies essentiels : préférence de langue, session (si vous êtes connecté) et maintien de votre conversation de chat. Les statistiques de visite sont mesurées sans cookie et sans vous identifier. Aucun cookie publicitaire ou de traçage n’est utilisé."}',
     true, 91);
  end if;
end $seed$;

notify pgrst, 'reload schema';
