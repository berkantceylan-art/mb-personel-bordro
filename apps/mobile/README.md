# MB Personel – mobil uygulama (Expo)

Personel: konumla veya QR ile giriş-çıkış, maaş/bordro/puantaj, izin ve avans talebi, duyurular, mesajlaşma, bildirimler.
Yönetici: bugün kim içeride, avans/izin onayları, duyuru yayınlama.

## Çalıştırma (geliştirme)

```bash
cd apps/mobile
cp .env.example .env      # EXPO_PUBLIC_SUPABASE_ANON_KEY değerini yazın (anon key, service_role DEĞİL)
npm install
npx expo start            # telefonda Expo Go ile QR'ı okutun
```

> Expo Go'da konum, kamera, mesajlaşma çalışır. Telefon bildirimleri (push) için geliştirme ya da mağaza derlemesi gerekir.

## Mağaza / dahili dağıtım (EAS)

```bash
npx eas-cli@latest login
npx eas-cli@latest init                 # app.json'a projectId yazar (push için gerekli)
npx eas-cli@latest build -p android     # APK/AAB
npx eas-cli@latest build -p ios         # Apple Developer hesabı gerekir
```

## Giriş

- Kullanıcı adı = PDKS numarası (arka planda `<pdks>@personel.mbdental.app`) ya da e-posta.
- İlk kez: web'de Yönetim → Davet kodları'ndan üretilen kodla "Hesap oluştur".
