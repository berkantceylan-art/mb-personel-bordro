# MB Personel & Bordro

MB Dental için personel, puantaj, avans/ödeme ve bordro sistemi. İleride kurulacak ERP'nin İnsan Kaynakları çekirdeği olacak şekilde modüler tasarlandı.

**Yığın:** Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage, RLS) · Vercel · TypeScript · pnpm monorepo
**Sonraki aşamada:** Expo (React Native) personel mobil uygulaması — aynı Supabase veritabanını kullanır.

## Klasör yapısı

```
apps/web          Next.js web + tablet uygulaması
packages/core     Saf TypeScript iş kuralları (UI'dan bağımsız, testli)
  payroll.ts        Brütten nete / netten brüte, asgari ücret istisnası, BES, sözleşme bölme (resmi net + elden)
  garnishment.ts    İcra / nafaka kesinti sıralaması
  ledger.ts         Personel cari hesabı (hakediş, avans, maaş, kesinti → kalan)
  attendance.ts     PDKS cihaz dosyası ayrıştırma, giriş/çıkış eşleştirme, anomaliler
  legal-params.ts   Yıl bazlı yasal parametreler (2026)
supabase/
  migrations/       Veritabanı şeması + RLS politikaları
  seed.sql          Varsayılan özlük belge türleri ve 2026 parametreleri
```

## Temel kurallar

- **Para kuruş cinsinden tam sayı** (`bigint`) tutulur; kayan nokta yok.
- **Cari hareketler silinmez/değiştirilemez**, sadece gerekçeyle iptal edilir (`void_ledger_entry`). Veritabanı tetikleyicisi bunu zorlar.
- **Toplam ücret = resmi net + elden.** Sigorta tipi `MIN_WAGE` (asgari ücret) veya `FIXED_NET` (belirli net); brüt her ay kümülatif vergi matrahına göre yeniden hesaplanır.
- **Yetki:** owner, accountant (para), hr (özlük), branch_manager (kendi şubesi), safety (İSG), employee (sadece kendisi). Tüm tablolarda RLS açık; şube bazlı görünürlük `can_see_branch()` ile.
- **KVKK:** TC, IBAN, adres gibi kişisel veriler ayrı `employee_private` tablosunda, daha dar yetkiyle. Tüm değişiklikler `audit_log`'a yazılır.
- PDKS varsayılanı: cihaz **002 = giriş**, **001 = çıkış** (`devices` tablosundan şube bazında değiştirilebilir).

## Kurulum

### 1. Supabase

1. Supabase'te yeni proje açın (bölge: **Frankfurt / eu-central-1** — Türkiye'ye en yakın).
2. **SQL Editor**'de sırayla çalıştırın:
   - `supabase/migrations/20261003000000_init.sql`
   - `supabase/seed.sql`
   (veya Supabase CLI ile: `supabase link` → `supabase db push` → `psql < supabase/seed.sql`)
3. **Authentication › Users › Add user** ile kendi kullanıcınızı oluşturun (e-posta + şifre).
4. **Project Settings › API**'den `Project URL` ve `anon public` anahtarını alın.

### 2. Yerelde çalıştırma

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # değerleri doldurun
pnpm dev                                        # http://localhost:3000
pnpm test                                       # çekirdek testleri
```

İlk girişte **Şirket kurulumu** ekranı açılır; şirket + ilk şube oluşturulur ve siz sahip olarak eklenirsiniz. Ardından **Excel'den Aktar** ile mevcut aylık maaş listesini yükleyin.

### 3. Vercel

1. Vercel'de **Add New › Project** → bu GitHub deposunu seçin.
2. **Root Directory:** `apps/web` (Framework: Next.js; pnpm otomatik algılanır).
3. Ortam değişkenleri: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Supabase › Authentication › URL Configuration'a Vercel adresini ekleyin.

## Yol haritası

| Faz | İçerik | Durum |
|---|---|---|
| 1 | Personel & özlük, bölümler, şube/rol yetkileri, cari hesap (avans/ödeme, imzalı elden ödeme), Excel'den aktarma | **bu sürüm** |
| 2 | Puantaj (TXT + manuel), vardiya tanımları ve planlama, izin, fazla mesai | sırada (çekirdek ayrıştırıcı hazır) |
| 3 | Bordro dönemi (resmi + iç hakediş), BES, icra & nafaka ekranları | çekirdek hesaplar hazır |
| 4 | İSG eğitimleri, sağlık muayeneleri, süre uyarıları | |
| 5 | Raporlar: Garanti BBVA maaş listesi, Garanti Emeklilik BES listesi, aylık icmal, bölüm raporları | banka formatları bekleniyor |
| 6 | Personel mobil uygulaması (Expo): konumlu giriş/çıkış, maaşım, izin/avans talebi | |
