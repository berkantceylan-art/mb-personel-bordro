import { redirect } from "next/navigation";
import { formatTL, PARAMS_2026, tl } from "@mb/core";
import { Card, PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getCompanySettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, formatDate, getSession } from "@/lib/session";
import { saveSettings } from "../actions";

function Choice({ name, value, checked, title, children }: { name: string; value: string; checked: boolean; title: string; children?: React.ReactNode }) {
  return (
    <label className="flex gap-3 items-start rounded-xl border border-[#D5DEE8] p-3.5 cursor-pointer has-[:checked]:border-brand-700 has-[:checked]:bg-[#F2F6FB]">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="mt-1 w-5 h-5 accent-[#0A3D73] shrink-0" />
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold text-ink">{title}</span>
        {children && <span className="text-[13px] text-muted">{children}</span>}
      </span>
    </label>
  );
}

function Section({ title, law, children }: { title: string; law: string; children: React.ReactNode }) {
  return (
    <Card title={title} action={<span className="text-xs text-muted">{law}</span>}>
      <div className="grid gap-2.5 md:grid-cols-2">{children}</div>
    </Card>
  );
}

export default async function SettingsPage() {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const supabase = await createClient();
  const [st, { data: row }, { count: insured }] = await Promise.all([
    getCompanySettings(supabase),
    supabase.from("company_settings").select("updated_at, updated_by").maybeSingle(),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  // Örnek hesaplar: asgari ücret üzerinden
  const hourly = PARAMS_2026.minWageGross / 225;
  const holiday1 = Math.round(hourly * 7.5);
  const sicil = (process.env.SGK_ISYERI_SICIL ?? "").replace(/\D/g, "");
  const isKolu = sicil.length >= 5 ? sicil.slice(1, 5) : null;
  const manufacturing = isKolu ? Number(isKolu.slice(0, 2)) >= 10 && Number(isKolu.slice(0, 2)) <= 33 : null;
  const perPoint = Math.round(PARAMS_2026.minWageGross * 0.01);

  return (
    <>
      <PageHeader title="Bordro yorum ayarları" subtitle={`Mali müşavirinizin görüşüne göre seçin${row?.updated_by ? ` · son değişiklik ${formatDate(row.updated_at)}` : " · şu an varsayılanlar geçerli"}`} />
      <form action={saveSettings} className="p-4 md:p-8 flex flex-col gap-4 max-w-[980px]">
        <p className="text-sm text-muted">
          Bu ayarlar kesintisi henüz yazılmamış bordroları ve yeni fazla mesai önerilerini etkiler. Daha önce onaylanmış fazla mesai ve kesintisi yazılmış bordrolar değişmez; gerekirse geri alıp yeniden onaylayın.
        </p>

        <Section title="Resmi tatilde çalışma" law="İş Kanunu md. 47">
          <Choice name="holiday_extra_rate" value="1" checked={st.holidayExtraRate === 1} title="Maaşa ek 1 günlük ücret (×1)">
            Tatil günü ücreti zaten aylık maaşın içinde; çalışılan her saat için ayrıca 1 saat ücreti. Örnek: asgari ücretli 7,5 saat → {formatTL(holiday1)} ek. Yaygın uygulama.
          </Choice>
          <Choice name="holiday_extra_rate" value="2" checked={st.holidayExtraRate === 2} title="Maaşa ek çift ücret (×2)">
            Çalışılan her saat için 2 saat ücreti ek ödenir. Örnek: {formatTL(holiday1 * 2)}. Toplu sözleşme veya iş sözleşmesinde bu yazıyorsa seçin.
          </Choice>
        </Section>

        <Section title="Fazla mesai esası" law="İş Kanunu md. 41, 63">
          <Choice name="overtime_basis" value="WEEKLY" checked={st.overtimeBasis === "WEEKLY"} title="Haftalık 45 saati aşan süre">
            Pazartesi–pazar toplam çalışma 45 saati geçerse fark fazla mesai (×1,5). Bir gün geç kalıp başka gün fazla kalan için denkleştirme kendiliğinden olur. Kanuna uygun olan budur.
          </Choice>
          <Choice name="overtime_basis" value="DAILY" checked={st.overtimeBasis === "DAILY"} title="Günlük vardiya süresini aşan süre">
            Her gün vardiya süresini eşik kadar aşan çalışma ve hafta tatili çalışması ayrı ayrı fazla mesai sayılır. Personel lehine, işverene daha maliyetli.
          </Choice>
        </Section>

        <Section title="Fazla mesai yuvarlama" law="Fazla Çalışma Yönetmeliği md. 6">
          <Choice name="overtime_rounding" value="HALF_HOUR" checked={st.overtimeRounding === "HALF_HOUR"} title="Yarım saate / saate yuvarla">
            Artan 1–30 dk yarım saat, 31–59 dk bir saat sayılır. Örnek: 2 sa 10 dk → 2,5 saat; 2 sa 40 dk → 3 saat.
          </Choice>
          <Choice name="overtime_rounding" value="EXACT" checked={st.overtimeRounding === "EXACT"} title="Dakikası dakikasına">
            Okutmalardan hesaplanan süre yuvarlanmadan ödenir.
          </Choice>
        </Section>

        <Section title="SGK işveren payı teşviki" law="5510 s. K. md. 81/ı">
          <div className="md:col-span-2 text-[13px] rounded-xl bg-[#F2F6FB] border border-[#D5DEE8] p-3">
            {isKolu ? (
              <>İşyeri sicil numaranızdaki işkolu kodu <b>{isKolu}</b>{isKolu === "3250" ? " (tıbbi ve dişçilik araç-gereç imalatı)" : ""}: {manufacturing ? <b>imalat sektörü — 5 puan teşvik uygulanır görünüyor.</b> : "imalat dışı görünüyor."} Mali müşavirinizle teyit edin.</>
            ) : (
              "İşyeri sicil numarası tanımlı değil; sektörünüzü mali müşavirinizle teyit edin."
            )}{" "}
            Her puan, asgari ücretli bir personel için ayda {formatTL(perPoint)} işveren maliyeti demek{insured ? ` (aktif ${insured} personelde yaklaşık ${formatTL(perPoint * insured)})` : ""}.
          </div>
          <Choice name="sgk_incentive_points" value="5" checked={st.sgkIncentivePoints === 5} title="5 puan — imalat sektörü">İşveren payı %21,75 → %16,75</Choice>
          <Choice name="sgk_incentive_points" value="2" checked={st.sgkIncentivePoints === 2} title="2 puan — diğer sektörler">İşveren payı %21,75 → %19,75</Choice>
          <Choice name="sgk_incentive_points" value="0" checked={st.sgkIncentivePoints === 0} title="Teşvik yok">Borç veya bildirge sorunu nedeniyle teşvikten yararlanılamıyorsa. Personel kartında teşvik kapalı olanlara zaten uygulanmaz.</Choice>
        </Section>

        <Section title="İcra kesintisi hesabı" law="İcra İflas Kanunu md. 83">
          <Choice name="garnishment_after_alimony" value="1" checked={st.garnishmentAfterAlimony} title="Nafaka düşüldükten sonra kalanın 1/4'ü">
            Örnek: {formatTL(tl(28075.5))} net, {formatTL(tl(10000))} nafaka → icra {formatTL(tl(4518.88))}. Yaygın uygulama.
          </Choice>
          <Choice name="garnishment_after_alimony" value="0" checked={!st.garnishmentAfterAlimony} title="Net ücretin 1/4'ü (nafakadan bağımsız)">
            Aynı örnekte icra {formatTL(tl(7018.88))}. İcra dairesi yazısında böyle belirtildiyse seçin.
          </Choice>
          <Choice name="garnishment_after_bes" value="0" checked={!st.garnishmentAfterBes} title="İcra BES kesintisinden önceki netten">
            BES katkı payı icra matrahından düşülmez.
          </Choice>
          <Choice name="garnishment_after_bes" value="1" checked={st.garnishmentAfterBes} title="İcra BES kesintisinden sonraki netten">
            Önce BES kesilir, icra kalan net üzerinden hesaplanır.
          </Choice>
          <p className="md:col-span-2 text-[13px] text-muted">Her iki durumda da nafaka + icra + BES toplamı net ücreti aşamaz; aşan kısım kesilmez.</p>
        </Section>

        <Card title="Değiştirilemeyen yasal sınırlar (uyarı olarak gösterilir)">
          <ul className="text-sm text-ink list-disc pl-5 flex flex-col gap-1">
            <li>Günlük çalışma en fazla 11 saat (İş K. 63)</li>
            <li>Yıllık fazla mesai en fazla 270 saat (İş K. 41)</li>
            <li>Gece çalışması en fazla 7,5 saat (İş K. 69) — vardiya tanımları kontrol edilir</li>
            <li>Arife günleri 13:00&apos;te biter; sonrası resmi tatil çalışması sayılır</li>
          </ul>
        </Card>

        <div className="sticky-save bg-ground py-3 border-t border-line md:border-0">
          <PendingSubmit className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">Ayarları kaydet</PendingSubmit>
        </div>
      </form>
    </>
  );
}
