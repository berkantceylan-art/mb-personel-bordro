import Anthropic from "@anthropic-ai/sdk";
import { parseTL } from "@mb/core";
import { aiModel } from "@/lib/ai-model";

/** Özlük arşivi: kâğıt belgeleri yapay zekâyla okuma (kimlik, SGK bildirgesi, belge türü, bordro, izin formu) */
export type DossierMode = "id" | "sgk" | "classify" | "payslip" | "leave";

export interface IdData { first_name?: string; last_name?: string; national_id?: string; birth_date?: string; birth_place?: string; father_name?: string; mother_name?: string; gender?: string; blood_type?: string; marital_status?: string }
export interface SgkData { kind?: "giris" | "cikis"; national_id?: string; sgk_no?: string; first_name?: string; last_name?: string; hire_date?: string; termination_date?: string; exit_code?: string; occupation_code?: string; occupation_name?: string }
export interface Segment { from: number; to: number; type: string; date?: string; expires_on?: string; person?: string; confidence?: number; continues_previous?: boolean }
export interface SlipData { page?: number; period?: string; days?: number; gross?: number; sgk_employee?: number; unemployment_employee?: number; income_tax?: number; stamp_tax?: number; net?: number; bes?: number; garnishment?: number; net_paid?: number; cumulative_tax_base?: number }
export interface LeaveData { type?: string; start?: string; end?: string; days?: number }

export const aiAvailable = () => !!process.env.ANTHROPIC_API_KEY;

function prompt(mode: DossierMode, types: string[], prev?: string | null): string {
  const json = "Yalnız geçerli JSON döndür, açıklama yazma. Tarihler YYYY-MM-DD. Okunamayan alanı boş bırak, uydurma.";
  switch (mode) {
    case "id":
      return `Bu bir Türkiye Cumhuriyeti nüfus cüzdanı / kimlik kartı (ön ve/veya arka yüz) ya da nüfus kayıt örneği. ${json}
{"first_name":"","last_name":"","national_id":"11 hane","birth_date":"","birth_place":"","father_name":"","mother_name":"","gender":"E|K","blood_type":"","marital_status":"bekar|evli|boşanmış|dul"}`;
    case "sgk":
      return `Bu bir SGK sigortalı işe giriş bildirgesi ya da işten ayrılış bildirgesi (veya e-Devlet çıktısı). ${json}
{"kind":"giris|cikis","national_id":"","sgk_no":"sigorta sicil no","first_name":"","last_name":"","hire_date":"işe giriş tarihi","termination_date":"işten ayrılış tarihi","exit_code":"ayrılış nedeni kodu, 2 hane","occupation_code":"meslek kodu ör. 7311.03","occupation_name":"meslek adı"}`;
    case "classify":
      return `Bunlar bir personelin özlük dosyasından taranmış / fotoğraflanmış sayfalar. Her belgeyi tanı ve sayfa aralığını ver. Belge türünü YALNIZ şu listeden seç (tam yazımla), uymuyorsa "Diğer":
${types.map((t) => `- ${t}`).join("\n")}
${json}
{"segments":[{"from":1,"to":1,"type":"listeden tür","date":"belgenin tarihi","expires_on":"geçerlilik bitişi varsa","person":"belgedeki kişi adı","confidence":0.0-1.0}]}
Tek sayfalık fotoğrafta from=to=1. Arka arkaya aynı belgenin sayfalarını tek segmentte birleştir.
ÇOK SAYFALI BELGELER: iş sözleşmesi, gizlilik sözleşmesi, KVKK aydınlatma metni / açık rıza beyanı, taahhütname, yönetmelik tebliğ tutanağı gibi belgeler birkaç sayfadır. Başlığı olmayan, metnin ya da cümlenin ortasından başlayan, madde numarası önceki sayfadan devam eden, "Sayfa 2", "2/3" yazan ya da yalnız imza / tarih bölümü olan sayfa AYRI BELGE DEĞİLDİR: önceki sayfanın belgesinin devamıdır, aynı segmente kat (to değerini büyüt). Yeni bir segment yalnız yeni bir başlık / belge açıldığında başlar.${prev ? `
Bu yüklemeden hemen önce bu personele "${prev}" belgesi kaydedildi. 1. sayfa (ve ardından gelenler) onun devamıysa o sayfalar için tek segment ver: type "${prev}", "continues_previous": true.` : ""}`;
    case "payslip":
      return `Bunlar bir personelin eski ücret bordroları / hesap pusulaları (her sayfa genelde bir ay). Her ay için bir satır ver. Tutarlar TL, ondalık nokta ile sayı. ${json}
{"slips":[{"page":1,"period":"YYYY-MM","days":30,"gross":0,"sgk_employee":0,"unemployment_employee":0,"income_tax":0,"stamp_tax":0,"net":0,"bes":0,"garnishment":0,"net_paid":0,"cumulative_tax_base":0}]}
gross = brüt toplam; sgk_employee = SGK işçi payı; unemployment_employee = işsizlik işçi payı; income_tax = ödenecek (istisna sonrası) gelir vergisi; stamp_tax = ödenecek damga vergisi; net = net ücret; net_paid = ele geçen / bankaya yatan; cumulative_tax_base = kümülatif vergi matrahı (bu ay dahil).`;
    case "leave":
      return `Bunlar izin formları / izin defteri sayfaları ya da sağlık raporları. Her izin için bir satır ver. ${json}
{"leaves":[{"type":"YILLIK|RAPOR|UCRETSIZ|MAZERET|DOGUM|EVLILIK|OLUM|BABALIK","start":"","end":"","days":0}]}`;
  }
}

/** Dosyayı (görsel ya da PDF) okur, JSON döndürür. Anahtar yoksa null. */
export async function aiReadDoc<T>(bytes: ArrayBuffer, mime: string, mode: DossierMode, types: string[] = [], prev: string | null = null): Promise<{ data: T | null; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { data: null, error: "no_key" };
  const b64 = Buffer.from(bytes).toString("base64");
  const media = mime === "application/pdf"
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } as const)
    : ({ type: "image", source: { type: "base64", media_type: (["image/png", "image/webp"].includes(mime) ? mime : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp", data: b64 } } as const);
  try {
    const res = await new Anthropic({ apiKey: key }).messages.create({
      model: aiModel(),
      max_tokens: mode === "payslip" || mode === "classify" ? 4000 : 1200,
      messages: [{ role: "user", content: [media, { type: "text", text: prompt(mode, types, prev) }] }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return { data: JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T };
  } catch (e) {
    return { data: null, error: (e as Error).message.slice(0, 160) };
  }
}

/** Kuruşa çevir: sayı (AI TL döndürür) ya da Türkçe yazım ("12.345,67", "4624.2") */
export const kurus = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : 0;
  const t = String(v ?? "").trim();
  if (!t) return 0;
  try { return parseTL(t); } catch { return 0; }
};
export const isoDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
