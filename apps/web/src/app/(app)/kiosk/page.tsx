import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession, todayIso } from "@/lib/session";

/** Kiosk ekranları: şube başına QR kiosk bağlantısı, bugünkü okutma sayıları ve kurulum notları */
export default async function KioskIndex() {
  const s = await getSession();
  if (!["owner", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const supabase = await createClient();
  const today = todayIso();
  const [{ data: branches }, { data: punches }] = await Promise.all([
    supabase.from("branches").select("id, name, address, lat, lng, radius_m, mobile_punch_enabled").order("name"),
    supabase.from("attendance_punches").select("branch_id, direction, source, employee_id").gte("punched_at", `${today}T00:00:00`),
  ]);
  const stat = (bid: string) => {
    const p = (punches ?? []).filter((x) => x.branch_id === bid);
    return { in: p.filter((x) => x.direction === "IN").length, out: p.filter((x) => x.direction === "OUT").length, qr: p.filter((x) => x.source === "MOBILE").length, unmatched: p.filter((x) => !x.employee_id).length };
  };
  return (
    <>
      <PageHeader title="Kiosk ekranı" subtitle="Girişteki tablet veya ekranda açık tutulur; personel telefonuyla QR okutur" />
      <div className="p-4 md:p-8 flex flex-col gap-4 max-w-[980px]">
        {(branches ?? []).map((b) => { const st = stat(b.id); return (
          <Card key={b.id} title={b.name} action={<a href={`/kiosk/${b.id}`} target="_blank" rel="noreferrer" className="h-11 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">Kiosk ekranını aç ↗</a>}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {[["Bugün giriş", st.in], ["Bugün çıkış", st.out], ["Telefonla (QR/konum)", st.qr], ["Eşleşmeyen kart", st.unmatched]].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl border border-[#D5DEE8] p-3"><div className="text-xs text-muted">{l}</div><div className="num text-lg font-bold">{v}</div></div>
              ))}
            </div>
            <p className="text-xs text-muted">
              {b.mobile_punch_enabled ? "Mobil okutma açık." : "Mobil okutma bu şubede kapalı: Yönetim → Şubeler'den açın."} {b.lat ? `Konumla okutma ${b.radius_m} m içinde çalışır.` : "Konum tanımlı değil: sadece QR çalışır."}
            </p>
          </Card>
        ); })}
        <Card title="Kurulum">
          <ol className="text-sm list-decimal pl-5 flex flex-col gap-1">
            <li>Girişe bir tablet veya küçük ekran koyun; tarayıcıda yönetici hesabıyla giriş yapıp &quot;Kiosk ekranını aç&quot;a basın ve <b>Tam ekran</b> yapın. Ekran kapanmaz (uyanık tutma desteklenir).</li>
            <li>QR kod her saat kendiliğinden değişir; ekranın fotoğrafı başka yerde işe yaramaz. Kod okutulunca ekranda yeşil onay ve son okutmalar görünür.</li>
            <li>Personel telefonda <b>Giriş</b> ya da <b>Çıkış</b>&apos;ı seçip &quot;QR okut&quot;a basar. Konumla okutma işyeri çevresinde ayrıca çalışır.</li>
            <li>PDKS cihazı olan şubelerde iki yöntem birlikte kullanılabilir; puantaj hepsini tek listede toplar.</li>
          </ol>
          <p className="text-xs text-muted">Tablet için öneri: Android&apos;de Chrome &quot;Ana ekrana ekle&quot;, ekran zaman aşımını &quot;hiçbir zaman&quot; yapın; iPad&apos;de Safari tam ekran + Rehberli Erişim.</p>
        </Card>
      </div>
    </>
  );
}
