import { UploadForm } from "@/components/admin/UploadForm";
import { Flash, I18nField, PageHead } from "@/components/admin/ui";
import { saveSettings } from "@/lib/admin-actions";
import { DAY_NAMES } from "@/lib/hours";
import { normalizeSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Site ayarları" };

function Text({ name, label, value, placeholder, hint, type = "text" }: { name: string; label: string; value: string; placeholder?: string; hint?: string; type?: string }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-navy">
      {label}
      <input name={name} type={type} defaultValue={value} placeholder={placeholder} className="field font-normal" />
      {hint && <span className="text-xs font-normal text-slate">{hint}</span>}
    </label>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("data").eq("id", 1).maybeSingle();
  const st = normalizeSettings((data as { data?: unknown } | null)?.data);

  return (
    <>
      <PageHead title="Site ayarları" lead="Sitenin her yerinde görünen iletişim, sosyal medya ve arama motoru bilgileri." />
      <Flash ok={ok} hata={error ? "Ayarlar tablosu henüz kurulmamış (SQL dosyası çalıştırılmalı). Kaydetme çalışmaz." : undefined} />
      <UploadForm action={saveSettings} folder="medya" submitLabel="Ayarları kaydet">
        <fieldset className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-navy">İletişim</legend>
          <Text name="phone" label="Telefon" value={st.phone} placeholder="0232 241 24 26" />
          <Text name="email" label="E-posta" value={st.email} type="email" />
          <Text name="whatsapp" label="WhatsApp numarası" value={st.whatsapp} placeholder="905321234567" hint="Ülke koduyla, yalnız rakam. Doluysa destek penceresinde konulu WhatsApp hattı çıkar." />
          <Text name="map_url" label="Harita bağlantısı" value={st.map_url} placeholder="https://maps.app.goo.gl/…" hint="Google Haritalar'da “Paylaş” ile alınan bağlantı." />
          <Text name="address1" label="Adres (1. satır)" value={st.address1} />
          <Text name="address2" label="Adres (2. satır)" value={st.address2} />
          <Text
            name="map_query"
            label="Haritada aranacak adres"
            value={st.map_query}
            placeholder="MB Dental, Karabağlar, İzmir"
            hint="İletişim sayfasındaki gömülü harita ve “Yol tarifi” bunu kullanır. Boşsa adres satırları kullanılır."
          />
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-gypsum bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-navy">Haftalık çalışma saatleri</legend>
          <p className="text-xs text-slate">
            “09:00-18:00” biçiminde yazın; kapalı günleri boş bırakın. Sitede Türkiye saatine göre otomatik “Şu an açığız / kapalıyız” gösterilir, canlı destek mesai dışında mesaj bırakma moduna geçer.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DAY_NAMES.tr.map((d, i) => (
              <label key={d} className="grid gap-1 text-sm font-semibold text-navy">
                {d}
                <input name={`schedule_${i}`} defaultValue={st.schedule[i]} placeholder="Kapalı" inputMode="numeric" className="field font-normal tabular-nums" />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm font-semibold text-navy">
            <input type="checkbox" name="chat_enabled" defaultChecked={st.chat_enabled} className="h-5 w-5 accent-navy" />
            Sitede canlı destek açık
          </label>
        </fieldset>

        <I18nField name="hours" label="Çalışma saatleri notu" value={st.hours} multiline rows={2} hint="Haftalık saatlerin altına eklenecek not (ör. “Resmî tatillerde kapalıyız”). Haftalık saatler boşsa yalnız bu metin gösterilir." />
        <I18nField name="footer_text" label="Alt bilgi metni" value={st.footer_text} multiline rows={2} hint="Sayfanın en altında logonun yanındaki kısa tanıtım. Boşsa varsayılan metin kullanılır." />

        <fieldset className="grid gap-4 rounded-xl border border-gypsum bg-white p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-navy">Sosyal medya</legend>
          <Text name="instagram" label="Instagram" value={st.social.instagram} placeholder="https://instagram.com/…" />
          <Text name="linkedin" label="LinkedIn" value={st.social.linkedin} placeholder="https://linkedin.com/company/…" />
          <Text name="facebook" label="Facebook" value={st.social.facebook} placeholder="https://facebook.com/…" />
          <Text name="youtube" label="YouTube" value={st.social.youtube} placeholder="https://youtube.com/@…" />
          <Text name="tiktok" label="TikTok" value={st.social.tiktok} placeholder="https://tiktok.com/@…" />
          <Text name="x" label="X (Twitter)" value={st.social.x} placeholder="https://x.com/…" />
          <p className="text-xs text-slate sm:col-span-2">Boş bırakılan hesap sitede gösterilmez.</p>
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-gypsum bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-navy">Anasayfa: Rakamlarla MB Dental</legend>
          <p className="text-xs text-slate">En fazla 4 rakam. Değer ve en az Türkçe açıklama dolu olanlar gösterilir; hepsi boşsa bölüm görünmez. Ör. “25+” · “Yıllık deneyim”.</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid gap-3 rounded-lg bg-porcelain p-3 md:grid-cols-[8rem_1fr]">
              <label className="grid gap-1 self-start text-sm font-semibold text-navy">
                Değer {i + 1}
                <input name={`stat_${i}_value`} defaultValue={st.stats[i]?.value ?? ""} maxLength={16} placeholder="25+" className="field font-normal" />
              </label>
              <I18nField name={`stat_${i}_label`} label={`Açıklama ${i + 1}`} value={st.stats[i]?.label} />
            </div>
          ))}
        </fieldset>

        <details className="rounded-xl border border-gypsum bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-navy">Arama motoru (anasayfa başlığı ve açıklaması)</summary>
          <div className="mt-4 grid gap-4">
            <I18nField name="seo_title" label="Sayfa başlığı" value={st.seo_title} hint="Google sonuçlarında ve tarayıcı sekmesinde görünür. Boşsa varsayılan kullanılır." />
            <I18nField name="seo_description" label="Açıklama" value={st.seo_description} multiline rows={2} hint="150–160 karakter idealdir." />
            <Text
              name="google_verification"
              label="Google Search Console doğrulama kodu"
              value={st.google_verification}
              placeholder="ör. AbC123…"
              hint="Search Console → Mülk ekle → HTML etiketi yönteminde content=“…” içindeki kod."
            />
          </div>
        </details>
      </UploadForm>
    </>
  );
}
