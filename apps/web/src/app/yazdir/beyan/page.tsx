import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { docDate } from "@/lib/waybill";

export const dynamic = "force-dynamic";

const T = {
  tr: {
    title: "ISMARLAMA CİHAZ UYGUNLUK BEYANI", sub: "(AB) 2017/745 Tüzüğü Ek XIII ve Tıbbi Cihaz Yönetmeliği uyarınca", maker: "İmalatçı", license: "Ruhsat no", uts: "ÜTS no", device: "Cihaz", job: "İş / sipariş no",
    patient: "Hasta", prescriber: "Reçete eden hekim / kurum", made: "Üretim tamamlanma tarihi", materials: "Kullanılan malzemeler", lot: "Lot / seri", exp: "SKT", shade: "Renk", teeth: "Dişler",
    statement: "Yukarıda tanımlanan cihaz, yalnızca belirtilen hastanın kullanımı için, yetkili hekimin yazılı reçetesine göre üretilmiş ısmarlama bir cihazdır. Cihaz, (AB) 2017/745 Tüzüğü Ek I'de belirtilen genel güvenlilik ve performans gerekliliklerine uygundur.",
    exceptions: "Karşılanmayan gereklilik: yoktur.", keep: "Bu beyan ve teknik dokümantasyon mevzuatta öngörülen süre boyunca saklanır.", sign: "Mevzuata uygunluk sorumlusu", date: "Tarih", noMat: "Malzeme kaydı yok",
  },
  en: {
    title: "STATEMENT FOR CUSTOM-MADE DEVICE", sub: "pursuant to Annex XIII of Regulation (EU) 2017/745", maker: "Manufacturer", license: "Licence no", uts: "Registration no", device: "Device", job: "Case / order no",
    patient: "Patient", prescriber: "Prescribing practitioner", made: "Date of manufacture", materials: "Materials used", lot: "Lot / batch", exp: "Expiry", shade: "Shade", teeth: "Teeth",
    statement: "The device described above is a custom-made device, manufactured on the written prescription of a duly authorised practitioner and intended for the sole use of the patient identified. It conforms to the general safety and performance requirements set out in Annex I of Regulation (EU) 2017/745.",
    exceptions: "Requirements not fully met: none.", keep: "This statement and the technical documentation are kept for the period required by the regulation.", sign: "Person responsible for regulatory compliance", date: "Date", noMat: "No materials recorded",
  },
  fr: {
    title: "DÉCLARATION RELATIVE AUX DISPOSITIFS SUR MESURE", sub: "conformément à l'annexe XIII du règlement (UE) 2017/745", maker: "Fabricant", license: "N° d'autorisation", uts: "N° d'enregistrement", device: "Dispositif", job: "N° de cas / commande",
    patient: "Patient", prescriber: "Praticien prescripteur", made: "Date de fabrication", materials: "Matériaux utilisés", lot: "Lot", exp: "Péremption", shade: "Teinte", teeth: "Dents",
    statement: "Le dispositif décrit ci-dessus est un dispositif sur mesure, fabriqué sur prescription écrite d'un praticien dûment autorisé et destiné à l'usage exclusif du patient identifié. Il est conforme aux exigences générales en matière de sécurité et de performances énoncées à l'annexe I du règlement (UE) 2017/745.",
    exceptions: "Exigences non entièrement respectées : aucune.", keep: "La présente déclaration et la documentation technique sont conservées pendant la durée prévue par le règlement.", sign: "Personne chargée de veiller au respect de la réglementation", date: "Date", noMat: "Aucun matériau enregistré",
  },
};
const UUID = /^[0-9a-f-]{36}$/i;
const initials = (s: string | null) => (s ?? "").split(/\s+/).filter(Boolean).map((w) => `${w[0]!.toLocaleUpperCase("tr")}.`).join(" ");

/** Ismarlama cihaz uygunluk beyanı — ?is=<iş id>[,…] ya da ?irsaliye=<id> (irsaliyedeki tüm işler); ?dil=tr|en|fr; ?kod=1 hasta adı yerine baş harfler */
export default async function Declarations({ searchParams }: { searchParams: Promise<{ is?: string; irsaliye?: string; dil?: string; kod?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let ids = (sp.is ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 200);
  if (sp.irsaliye && UUID.test(sp.irsaliye)) {
    const { data } = await supabase.from("jobs").select("id").eq("waybill_id", sp.irsaliye).order("no");
    ids = (data ?? []).map((j) => j.id as string);
  }
  const [{ data: jobs }, { data: co }, { data: mats }] = await Promise.all([
    ids.length ? supabase.from("jobs").select("id, no, patient, doctor_name, shade, teeth, delivered_at, in_date, customer_id, lab_customers(name, doc_lang, city, country), job_items(name, qty, amount, sort)").in("id", ids) : Promise.resolve({ data: [] }),
    supabase.from("companies").select("*").eq("id", s.companyId).maybeSingle(),
    ids.length ? supabase.rpc("mdr_job_materials", { p_jobs: ids }) : Promise.resolve({ data: [] }),
  ]);
  type J = { id: string; no: number; patient: string | null; doctor_name: string | null; shade: string | null; teeth: Record<string, string> | null; delivered_at: string | null; in_date: string; lab_customers: { name: string; doc_lang: string | null; city: string | null; country: string | null } | null; job_items: { name: string; qty: number; amount: number; sort: number }[] };
  const list = ((jobs ?? []) as unknown as J[]).sort((a, b) => a.no - b.no);
  const mByJob = new Map<string, { item: string; code: string; lot_no: string | null; expiry_date: string | null; qty: number; unit: string }[]>();
  for (const m of (mats ?? []) as { job_id: string; item: string; code: string; lot_no: string | null; expiry_date: string | null; qty: number; unit: string }[]) mByJob.set(m.job_id, [...(mByJob.get(m.job_id) ?? []), m]);
  const c = (co ?? {}) as Record<string, string | null>;
  const cell = "border border-[#9AA7B4] px-2 py-1 text-left align-top";
  const qs = (p: Record<string, string>) => `/yazdir/beyan?${new URLSearchParams({ ...(sp.is ? { is: sp.is } : {}), ...(sp.irsaliye ? { irsaliye: sp.irsaliye } : {}), ...(sp.dil ? { dil: sp.dil } : {}), ...(sp.kod ? { kod: sp.kod } : {}), ...p })}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 14mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={sp.irsaliye ? `/isler/irsaliye/${sp.irsaliye}` : ids[0] ? `/isler/${ids[0]}` : "/isler"} className="font-semibold text-[#0A3D73]">← Geri</Link>
        <PrintButton />
        <span className="flex gap-1 text-sm">{(["", "tr", "en", "fr"] as const).map((l) => <Link key={l || "auto"} href={qs({ dil: l })} className={`px-2.5 py-1 rounded-full border ${(sp.dil ?? "") === l ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{l ? l.toUpperCase() : "Müşteri dili"}</Link>)}</span>
        <Link href={qs({ kod: sp.kod === "1" ? "" : "1" })} className="text-sm font-semibold text-[#0A3D73]">{sp.kod === "1" ? "Hasta adını göster" : "Hasta adı yerine baş harfler"}</Link>
        <span className="text-sm text-[#5A6B7D]">{list.length} beyan</span>
        {!c.mdr_person && <span className="text-sm text-[#B42318]">Şirket ayarlarında “mevzuata uygunluk sorumlusu” boş</span>}
      </div>
      {list.map((j) => {
        const lang = (["tr", "en", "fr"].includes(sp.dil ?? "") ? sp.dil : j.lab_customers?.doc_lang ?? "tr") as "tr" | "en" | "fr";
        const t = T[lang];
        const made = j.delivered_at ? j.delivered_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
        const items = j.job_items.filter((i) => i.amount >= 0).sort((a, b) => a.sort - b.sort);
        const teeth = Object.keys(j.teeth ?? {}).sort().join(", ");
        const mats2 = mByJob.get(j.id) ?? [];
        return (
          <article key={j.id} className="max-w-[182mm] mx-auto bg-white my-6 print:my-0 p-8 print:p-0 flex flex-col gap-4 break-after-page">
            <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.svg" alt="" className="w-12 h-12 object-contain" />
                <div><div className="text-[14px] font-bold">{c.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[80mm]">{c.address ?? ""}</div><div className="text-[10px]">{[c.phone, c.email].filter(Boolean).join(" · ")}</div></div>
              </div>
              <div className="text-right"><div className="text-[14px] font-bold max-w-[85mm]">{t.title}</div><div className="text-[9.5px] text-[#444]">{t.sub}</div><div className="mt-1 font-mono">CM-{j.no}</div></div>
            </header>
            <table className="w-full border-collapse">
              <tbody>
                <tr><th className={`${cell} w-[52mm] bg-[#F3F6F9]`}>{t.maker}</th><td className={cell}>{c.name}<div className="text-[10px]">{c.address}</div>{c.lab_license_no && <div className="text-[10px]">{t.license}: {c.lab_license_no}</div>}{c.uts_firm_no && <div className="text-[10px]">{t.uts}: {c.uts_firm_no}</div>}{c.tax_no && <div className="text-[10px]">VKN: {c.tax_no}</div>}</td></tr>
                <tr><th className={`${cell} bg-[#F3F6F9]`}>{t.job}</th><td className={cell}>#{j.no}</td></tr>
                <tr><th className={`${cell} bg-[#F3F6F9]`}>{t.patient}</th><td className={cell}>{sp.kod === "1" ? initials(j.patient) : j.patient ?? "—"}</td></tr>
                <tr><th className={`${cell} bg-[#F3F6F9]`}>{t.prescriber}</th><td className={cell}>{[j.doctor_name, j.lab_customers?.name].filter(Boolean).join(" — ")}{j.lab_customers?.city ? <span className="text-[10px]"> · {[j.lab_customers.city, j.lab_customers.country].filter(Boolean).join(", ")}</span> : null}</td></tr>
                <tr><th className={`${cell} bg-[#F3F6F9]`}>{t.device}</th><td className={cell}>{items.map((i, k) => <div key={k}>{Number(i.qty)} × {i.name}</div>)}{teeth && <div className="text-[10px]">{t.teeth}: {teeth}</div>}{j.shade && <div className="text-[10px]">{t.shade}: {j.shade}</div>}</td></tr>
                <tr><th className={`${cell} bg-[#F3F6F9]`}>{t.made}</th><td className={cell}>{docDate(made, lang)}</td></tr>
              </tbody>
            </table>
            <div>
              <div className="font-bold mb-1">{t.materials}</div>
              <table className="w-full border-collapse">
                <thead><tr className="bg-[#F3F6F9]"><th className={cell}>{t.materials}</th><th className={cell}>{t.lot}</th><th className={cell}>{t.exp}</th></tr></thead>
                <tbody>
                  {mats2.map((m, k) => <tr key={k}><td className={cell}>{m.item}{m.code ? <span className="text-[10px] text-[#555]"> ({m.code})</span> : null}</td><td className={`${cell} font-mono`}>{m.lot_no ?? "—"}</td><td className={cell}>{m.expiry_date ? docDate(m.expiry_date, lang) : "—"}</td></tr>)}
                  {mats2.length === 0 && <tr><td colSpan={3} className={`${cell} text-[#777]`}>{t.noMat}</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="leading-relaxed">{t.statement}</p>
            <p>{t.exceptions}</p>
            <p className="text-[10px] text-[#444]">{t.keep}</p>
            <div className="grid grid-cols-2 gap-10 pt-8">
              <div><div className="text-[10px] text-[#555]">{t.date}</div><div className="border-b border-black pb-1">{docDate(made, lang)}</div></div>
              <div><div className="text-[10px] text-[#555]">{t.sign}</div><div className="border-b border-black pb-6">{c.mdr_person ?? ""}{c.mdr_person_title ? `, ${c.mdr_person_title}` : ""}</div></div>
            </div>
          </article>
        );
      })}
      {list.length === 0 && <p className="p-8 text-center">Beyan için iş seçilmedi.</p>}
    </main>
  );
}
