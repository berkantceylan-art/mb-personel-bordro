import fs from "node:fs/promises";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/session";

type SB = Awaited<ReturnType<typeof createClient>>;

const DIR = path.join(process.cwd(), "src/templates/ozluk");

/** Otomatik doldurulan özlük şablonları (document_types.template_key) */
export const TEMPLATES: Record<string, { file: string; title: string; pdf?: boolean }> = {
  "is-sozlesmesi": { file: "is-sozlesmesi.docx", title: "Belirsiz Süreli İş Sözleşmesi" },
  "gizlilik-sozlesmesi": { file: "gizlilik-sozlesmesi.docx", title: "Personel Gizlilik Sözleşmesi" },
  "fazla-calisma-muvafakat": { file: "fazla-calisma-muvafakat.docx", title: "Fazla Çalışma, Telafi Çalışması ve Denkleştirme Muvafakatnamesi" },
  "yillik-izin-bolme-muvafakat": { file: "yillik-izin-bolme-muvafakat.docx", title: "Yıllık Ücretli İzin Kullandırılmasına İlişkin Muvafakatname" },
  "yillik-izin-erken-talep": { file: "yillik-izin-erken-talep.docx", title: "Yıllık Ücretli İzin Erken Talep Formu" },
  "kvkk-acik-riza": { file: "kvkk-acik-riza.docx", title: "Personel Aydınlatma Metni ve Açık Rıza Formu" },
  "isg-talimat-taahhut": { file: "isg-talimat-taahhut.docx", title: "İş Sağlığı ve Güvenliği Talimatı ve Taahhütnamesi" },
  "kkd-taahhut": { file: "kkd-taahhut.docx", title: "Kişisel Koruyucu Malzeme ve Taahhüt Belgesi" },
  "isg-egitim-genel": { file: "isg-egitim-genel.docx", title: "İSG Eğitim Katılım Formu · Genel Konular" },
  "isg-egitim-teknik": { file: "isg-egitim-teknik.docx", title: "İSG Eğitim Katılım Formu · Teknik Konular" },
  "isg-egitim-saglik": { file: "isg-egitim-saglik.docx", title: "İSG Eğitim Katılım Formu · Sağlık Konuları" },
  "isg-egitim-kimyasal": { file: "isg-egitim-kimyasal.docx", title: "Kimyasal Risk Eğitimi Katılım Formu" },
  "isg-sinav": { file: "isg-sinav.pdf", title: "Temel İSG Eğitimi Sınavı", pdf: true },
  "ise-giris-muayene": { file: "ise-giris-muayene.docx", title: "İşe Giriş / Periyodik Muayene Formu" },
  "is-basvuru-formu": { file: "is-basvuru-formu.docx", title: "İş Başvuru ve Bilgi Formu" },
  "calisma-belgesi": { file: "calisma-belgesi.docx", title: "Çalışma Belgesi" },
  "ibraname": { file: "ibraname.docx", title: "İbraname" },
  "fesih-bildirimi": { file: "fesih-bildirimi.docx", title: "İş Sözleşmesi Fesih Bildirimi" },
  "zimmet-tutanagi": { file: "zimmet-tutanagi.docx", title: "Zimmet Tutanağı" },
  "zimmet-iade-tutanagi": { file: "zimmet-iade-tutanagi.docx", title: "Zimmet İade Tutanağı" },
};

export const ASSET_CATEGORY: Record<string, string> = {
  BILGISAYAR: "Bilgisayar / tablet", TELEFON: "Telefon", EL_ALETI: "El aleti", MAKINE: "Makine / cihaz", ANAHTAR_KART: "Anahtar / kart",
  ARAC: "Araç", KIYAFET_KKD: "Kıyafet / KKD", MOBILYA: "Mobilya", DIGER: "Diğer",
};
export const ASSET_STATUS: Record<string, [string, string]> = {
  AVAILABLE: ["Boşta", "bg-ok-bg text-ok"], ASSIGNED: ["Zimmetli", "bg-[#E7F1FB] text-brand-700"], MAINTENANCE: ["Arızalı / bakımda", "bg-warn-bg text-warn"], LOST: ["Kayıp", "bg-bad-bg text-bad"], RETIRED: ["Hurda", "bg-[#EEF2F6] text-[#33414F]"],
};

/** Zimmet tutanağı satırları (açık veya iade edilmiş zimmetler) */
export async function assetItems(supabase: SB, employeeId: string, returned: boolean): Promise<Array<Record<string, string>>> {
  let q = supabase.from("asset_assignments").select("assigned_on, returned_on, condition_out, condition_in, assets(code, name, brand_model, serial_no)").eq("employee_id", employeeId).order("assigned_on");
  q = returned ? q.not("returned_on", "is", null) : q.is("returned_on", null);
  const { data } = await q;
  return (data ?? []).map((r, i) => {
    const a = r.assets as unknown as { code: string | null; name: string; brand_model: string | null; serial_no: string | null } | null;
    return { sira: String(i + 1), kod: a?.code ?? "—", ad: [a?.name, a?.brand_model].filter(Boolean).join(" · "), seri: a?.serial_no ?? "—",
      teslim: formatDate(r.assigned_on), iade: r.returned_on ? formatDate(r.returned_on) : "—", durum: (returned ? r.condition_in : r.condition_out) ?? "Sağlam" };
  });
}

/** SGK işten ayrılış kodları (sık kullanılanlar) */
export const EXIT_CODES: Array<[string, string]> = [
  ["03", "İstifa"], ["04", "Belirsiz süreli iş sözleşmesinin işveren tarafından haklı sebep bildirilmeden feshi"], ["22", "Diğer nedenler"],
  ["01", "Deneme süreli iş sözleşmesinin işverence feshi"], ["02", "Deneme süreli iş sözleşmesinin işçi tarafından feshi"], ["05", "Belirli süreli iş sözleşmesinin sona ermesi"],
  ["08", "Emeklilik (yaşlılık) veya toptan ödeme nedeniyle"], ["09", "Malulen emeklilik nedeniyle"], ["10", "Ölüm"], ["11", "İş kazası sonucu ölüm"],
  ["12", "Askerlik"], ["13", "Kadın işçinin evlenmesi"], ["14", "Emeklilik için yaş dışında diğer şartların tamamlanması"], ["15", "Toplu işçi çıkarma"],
  ["16", "Sözleşme sona ermeden sigortalının aynı işverene ait diğer işyerine nakli"], ["17", "İşyerinin kapanması"], ["18", "İşin sona ermesi"],
  ["23", "İşçi tarafından zorunlu nedenle fesih"], ["24", "İşçi tarafından sağlık nedeniyle fesih"], ["25", "İşçi tarafından işverenin ahlak ve iyi niyet kurallarına aykırı davranışı nedeniyle fesih"],
  ["26", "Disiplin kurulu kararı ile fesih"], ["27", "İşveren tarafından zorunlu nedenlerle ve tutukluluk nedeniyle fesih"], ["28", "İşveren tarafından sağlık nedeni ile fesih"],
  ["29", "İşveren tarafından işçinin ahlak ve iyi niyet kurallarına aykırı davranışı nedeni ile fesih"], ["34", "İşyerinin devri, işin veya işyerinin niteliğinin değişmesi nedeniyle fesih"],
  ["37", "KHK ile işyerinin kapatılması"], ["41", "Olağanüstü hal / KHK nedeniyle"], ["42", "4857 SK 25-II-a"], ["43", "25-II-b"], ["44", "25-II-c"], ["45", "25-II-d"], ["46", "25-II-e"], ["47", "25-II-f"], ["48", "25-II-g"], ["49", "25-II-h"], ["50", "25-II-ı"],
];

const GENDER: Record<string, string> = { M: "Erkek", F: "Kadın", male: "Erkek", female: "Kadın", erkek: "Erkek", kadin: "Kadın", kadın: "Kadın" };
const MARITAL: Record<string, string> = { single: "Bekâr", married: "Evli", divorced: "Boşanmış", widowed: "Dul", bekar: "Bekâr", evli: "Evli" };
const EDU: Record<string, string> = { ilkokul: "İlkokul", ortaokul: "Ortaokul", lise: "Lise", onlisans: "Ön lisans", lisans: "Lisans", yukseklisans: "Yüksek lisans", doktora: "Doktora" };
const MIL: Record<string, string> = { done: "Yaptı", exempt: "Muaf", deferred: "Tecilli", na: "Muaf (kadın)", yapti: "Yaptı", muaf: "Muaf", tecilli: "Tecilli" };

const dash = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? "…………………" : String(v));
const map = (m: Record<string, string>, v: unknown) => (v ? (m[String(v)] ?? m[String(v).toLocaleLowerCase("tr")] ?? String(v)) : "");

/** Şablon alanlarının değerleri: personel + şirket */
export async function docData(supabase: SB, employeeId: string, companyId: string): Promise<{ data: Record<string, string>; fileBase: string; missing: string[] } | null> {
  const [{ data: e }, { data: p }, { data: c }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, hire_date, position_title, termination_date, termination_reason, termination_code, departments(name)").eq("id", employeeId).maybeSingle(),
    supabase.from("employee_private").select("*").eq("employee_id", employeeId).maybeSingle(),
    supabase.from("companies").select("name, address, phone, email, tax_office, tax_no, sgk_registration_no").eq("id", companyId).maybeSingle(),
  ]);
  if (!e) return null;
  const pv = (p ?? {}) as Record<string, unknown>;
  const name = `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim();
  const dept = (e.departments as unknown as { name: string } | null)?.name ?? "";
  const gorev = e.position_title || dept || "";
  const birth = [pv.birth_place, pv.birth_date ? formatDate(String(pv.birth_date)) : ""].filter(Boolean).join(" · ");
  const today = formatDate(new Date().toISOString().slice(0, 10));
  const ehliyet = pv.license_class === "Yok" ? "Yok" : [pv.license_class ? `${pv.license_class} sınıfı` : "", pv.license_date ? formatDate(String(pv.license_date)) : ""].filter(Boolean).join(" · ");
  const comp = (c ?? {}) as Record<string, string | null>;
  const data: Record<string, string> = {
    ad_soyad: name,
    tc: dash(pv.national_id),
    adres: dash([pv.address, pv.district, pv.city].filter(Boolean).join(" ")),
    telefon: dash(pv.phone),
    eposta: dash(pv.email),
    tel_eposta: [pv.phone, pv.email].filter(Boolean).join(" / ") || "…………………",
    tarih: today,
    ise_baslama: e.hire_date ? formatDate(e.hire_date) : "…/…/……",
    hafta_tatili: "Pazar",
    dogum: dash(birth),
    cinsiyet: dash(map(GENDER, pv.gender)),
    egitim: dash([map(EDU, pv.education_level ?? pv.education), pv.school, pv.school_department].filter(Boolean).join(" · ")),
    medeni: dash(map(MARITAL, pv.marital_status)),
    cocuk: pv.children_count === null || pv.children_count === undefined ? "…" : String(pv.children_count),
    kan_grubu: dash(pv.blood_type),
    askerlik: dash(map(MIL, pv.military_status)),
    sgk_no: dash(pv.sgk_no),
    ehliyet: dash(ehliyet),
    gorev: dash(gorev),
    bolum: dash(dept),
    sirket: comp.name ?? "",
    sirket_adres: comp.address ?? "…………………",
    sirket_sgk: comp.sgk_registration_no ?? "…………………",
    sirket_tel: comp.phone ?? "…………………",
    sirket_eposta: comp.email ?? "…………………",
    // Çıkış belgeleri
    cikis_tarihi: e.termination_date ? formatDate(e.termination_date) : "…/…/……",
    cikis_nedeni: [e.termination_code ? `SGK ${e.termination_code}` : "", e.termination_reason].filter(Boolean).join(" · ") || "…………………",
    fesih_aciklama: e.termination_reason ?? "",
    kidem: "…………", ihbar: "…………", izin_gun: "…", izin_ucreti: "…………", son_ucret: "…………", diger: "…………", toplam: "…………",
  };
  const missing: string[] = [];
  if (!pv.national_id) missing.push("TC kimlik no");
  if (!pv.address) missing.push("adres");
  if (!pv.phone) missing.push("telefon");
  if (!pv.birth_date) missing.push("doğum tarihi");
  if (!comp.sgk_registration_no) missing.push("şirket SGK sicil no (Yönetim → Şirket bilgileri)");
  const fileBase = name.toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/g, "-").replace(/^-|-$/g, "");
  return { data, fileBase, missing };
}

/** Şablonu personel bilgileriyle doldurur; döndürülen dosya docx (veya pdf şablonu olduğu gibi) */
export async function renderTemplate(key: string, data: Record<string, unknown>): Promise<{ buf: Buffer; ext: "docx" | "pdf"; title: string } | null> {
  const t = TEMPLATES[key];
  if (!t) return null;
  const raw = await fs.readFile(path.join(DIR, t.file));
  if (t.pdf) return { buf: raw, ext: "pdf", title: t.title };
  const zip = new PizZip(raw);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: (part: { value?: string }) => (part.value === "items" ? [] : "…………………") });
  doc.render(data);
  const buf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  return { buf, ext: "docx", title: t.title };
}

/** Birden çok şablonu tek zip olarak */
export async function renderZip(keys: string[], data: Record<string, unknown>, fileBase: string): Promise<Buffer> {
  const zip = new PizZip();
  for (const k of keys) {
    const r = await renderTemplate(k, data);
    if (r) zip.file(`${fileBase}-${k}.${r.ext}`, r.buf);
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

/** Şablonun doldurulmuş düz metni (dijital imza ekranı ve yazdırma için): paragraf listesi */
export async function renderText(key: string, data: Record<string, unknown>): Promise<{ title: string; paragraphs: string[] } | null> {
  const r = await renderTemplate(key, data);
  if (!r || r.ext !== "docx") return null;
  const zip = new PizZip(r.buf);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  const paras: string[] = [];
  // Tablolar: satır başına hücreler " · " ile; paragraflar düz
  for (const m of xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tr")) {
      const cells = [...chunk.matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("").trim()).filter(Boolean);
      if (cells.length) paras.push(cells.join(" · "));
      continue;
    }
    const text = [...chunk.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((t) => (t[0] === "<w:tab/>" ? " " : t[0] === "<w:br/>" ? "\n" : t[1])).join("").replace(/\s+/g, " ").trim();
    if (text) paras.push(text);
  }
  // Tablo içindeki paragraflar iki kez gelmesin: satır olarak alınan hücre metinleriyle aynıysa ele
  const seen = new Set<string>();
  const out = paras.filter((p) => { if (seen.has(p)) return false; seen.add(p); return true; });
  return { title: TEMPLATES[key]?.title ?? key, paragraphs: out.map((p) => p.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')) };
}
