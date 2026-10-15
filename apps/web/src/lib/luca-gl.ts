/** Luca "Excel Veri Aktarımı" fiş dosyası: alanlar, şablon başlığı eşleştirme ve satır üretimi */

export type LucaField =
  | "fis_no" | "fis_tarihi" | "fis_aciklama" | "fis_tipi" | "hesap_kodu" | "hesap_adi" | "evrak_no" | "evrak_tarihi" | "aciklama"
  | "borc" | "alacak" | "tutar" | "borc_alacak" | "miktar" | "belge_turu" | "odeme_yontemi" | "doviz" | "doviz_tutar" | "kur" | "vkn" | "bos";

export type LucaColumn = { header: string; field: LucaField };

export const LUCA_FIELDS: Record<LucaField, string> = {
  fis_no: "Fiş no (ERP fiş no)",
  fis_tarihi: "Fiş tarihi",
  fis_aciklama: "Fiş açıklaması",
  fis_tipi: "Fiş tipi (Mahsup / Açılış / Kapanış)",
  hesap_kodu: "Hesap kodu (Luca)",
  hesap_adi: "Hesap adı",
  evrak_no: "Evrak (belge) no",
  evrak_tarihi: "Evrak (belge) tarihi",
  aciklama: "Satır açıklaması",
  borc: "Borç",
  alacak: "Alacak",
  tutar: "Tutar (tek sütun)",
  borc_alacak: "B / A işareti",
  miktar: "Miktar",
  belge_turu: "Belge türü (e-defter)",
  odeme_yontemi: "Ödeme yöntemi (e-defter)",
  doviz: "Döviz cinsi",
  doviz_tutar: "Döviz tutarı",
  kur: "Kur",
  vkn: "TC / vergi no (cari)",
  bos: "(boş bırak)",
};

const norm = (s: string) =>
  s.toLocaleLowerCase("tr-TR").replace(/[ıi̇]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]/g, "");

/** Şablon başlığından alan tahmini */
export function guessField(header: string): LucaField {
  const h = norm(header);
  const rules: Array<[RegExp, LucaField]> = [
    [/^(fis|fiş)?(no|numara|numarasi)$|^fisno|^fisnumara/, "fis_no"],
    [/^fistarih|^tarih$/, "fis_tarihi"],
    [/^fisaciklama|^fisizahat|^genelaciklama/, "fis_aciklama"],
    [/^fistip|^fisturu$/, "fis_tipi"],
    [/hesapkod|^hesapno$|^kod$|^hesap$/, "hesap_kodu"],
    [/hesapad|hesapismi|hesapacik/, "hesap_adi"],
    [/^(evrak|belge)(no|numara)/, "evrak_no"],
    [/^(evrak|belge)tarih/, "evrak_tarihi"],
    [/^(belge|evrak)(tur|tip)|^bt$/, "belge_turu"],
    [/odeme/, "odeme_yontemi"],
    [/aciklama|izahat|detay/, "aciklama"],
    [/^borc$|^borctutar/, "borc"],
    [/^alacak$|^alacaktutar/, "alacak"],
    [/^(b|ba|borcalacak|bayon)$|^b\/a$/, "borc_alacak"],
    [/^tutar$/, "tutar"],
    [/miktar/, "miktar"],
    [/^(doviz|dovizcins|dovizturu|parabirimi|pb)$/, "doviz"],
    [/^dovizt|^dovizmeblag/, "doviz_tutar"],
    [/^kur/, "kur"],
    [/vergino|tckn|vkn|^tc/, "vkn"],
  ];
  for (const [re, f] of rules) if (re.test(h)) return f;
  return "bos";
}

export type LucaLine = { erp_code: string; luca_code: string; name: string; debit: number; credit: number; description: string | null; currency: string; fx_amount: number | null; rate: number | null; pay: string | null; vkn?: string | null };
export type LucaVoucher = {
  id: string; year: number; no: number; journal_no: number | null; date: string; kind: string; source: string; status: string; tag: string | null;
  description: string | null; doc_type: string | null; belge_turu: string | null; doc_no: string | null; doc_date: string | null; total: number;
  line_count: number; lines: LucaLine[]; issues: Array<{ key: string; block: boolean; text: string }>; blocked: boolean;
  batch_id: string | null; batch_no: number | null; changed: boolean; excluded_by: string | null;
};

const KIND_LABEL: Record<string, string> = { acilis: "Açılış", kapanis: "Kapanış" };
export const lucaKind = (k: string) => KIND_LABEL[k] ?? "Mahsup";
export const fisNo = (v: Pick<LucaVoucher, "year" | "no">) => `${v.year}-${String(v.no).padStart(5, "0")}`;
const day = (s: string | null) => (s ? new Date(s.slice(0, 10) + "T00:00:00Z") : null);

/** Bir fişin Luca satırları (sütun sırasına göre değerler) */
export function lucaRows(v: LucaVoucher, cols: LucaColumn[]): Array<Array<string | number | Date | null>> {
  return v.lines.map((l) => cols.map((c) => {
    switch (c.field) {
      case "fis_no": return v.no;
      case "fis_tarihi": return day(v.date);
      case "fis_aciklama": return (v.description ?? "").slice(0, 250);
      case "fis_tipi": return lucaKind(v.kind);
      case "hesap_kodu": return l.luca_code;
      case "hesap_adi": return l.name;
      case "evrak_no": return v.doc_no ?? null;
      case "evrak_tarihi": return day(v.doc_date ?? (v.doc_no ? v.date : null));
      case "aciklama": return (l.description ?? v.description ?? "").slice(0, 250);
      case "borc": return l.debit / 100;
      case "alacak": return l.credit / 100;
      case "tutar": return (l.debit || l.credit) / 100;
      case "borc_alacak": return l.debit ? "B" : "A";
      case "miktar": return null;
      case "belge_turu": return v.belge_turu ?? null;
      case "odeme_yontemi": return l.pay ?? null;
      case "doviz": return l.currency && l.currency !== "TRY" ? l.currency : null;
      case "doviz_tutar": return l.currency !== "TRY" && l.fx_amount != null ? l.fx_amount / 100 : null;
      case "kur": return l.currency !== "TRY" && l.rate != null ? Number(l.rate) : null;
      case "vkn": return l.vkn ?? null;
      default: return null;
    }
  }));
}

/** Luca dosyalarına bölme: fiş tipi başına ayrı, dosya başına en çok 50 fiş */
export function lucaChunks(vs: LucaVoucher[], per = 50): Array<{ kind: string; part: number; vouchers: LucaVoucher[] }> {
  const out: Array<{ kind: string; part: number; vouchers: LucaVoucher[] }> = [];
  for (const kind of ["acilis", "mahsup", "kapanis"]) {
    const list = vs.filter((v) => (kind === "mahsup" ? !["acilis", "kapanis"].includes(v.kind) : v.kind === kind));
    for (let i = 0; i < list.length; i += per) out.push({ kind, part: i / per + 1, vouchers: list.slice(i, i + per) });
  }
  return out;
}
