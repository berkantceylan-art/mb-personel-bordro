/** Bizim Hesap (ya da başka ön muhasebe) müşteri / tedarikçi listesi Excel'i → cari satırları */
export type BhParty = {
  key: string; name: string; code: string | null; role: "customer" | "supplier" | null; tax_no: string | null; tax_office: string | null;
  phone: string | null; email: string | null; address: string | null; city: string | null; district: string | null; currency: string | null; balance: number | null;
};

const N = (s: unknown) => String(s ?? "").toLocaleLowerCase("tr-TR").replace(/[ıi̇]/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const txt = (v: unknown) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s ? s : null; };

const COLS: Record<keyof Omit<BhParty, "key" | "role">, RegExp> & { role: RegExp } = {
  name: /^(unvan|unvani|ticari unvan|cari adi|cari unvan|cari unvani|cari|firma|firma adi|musteri|musteri adi|tedarikci|tedarikci adi|ad soyad|adi soyadi|adi unvani|ad unvan|isim|adi)$/,
  code: /^(kod|kodu|cari kod|cari kodu|musteri kodu|tedarikci kodu)$/,
  role: /^(tip|tipi|tur|turu|cari tipi|cari turu|kategori|grup)$/,
  tax_no: /^(vergi no|vergi numarasi|vkn|tckn|vkn tckn|tc kimlik no|tc no|vergi kimlik no|vergi no tc kimlik no|vkn tc)$/,
  tax_office: /^(vergi dairesi|v d|vd)$/,
  phone: /^(telefon|tel|telefon 1|cep|cep telefonu|gsm|telefon no)$/,
  email: /^(e posta|eposta|e mail|email|mail)$/,
  address: /^(adres|acik adres|fatura adresi)$/,
  city: /^(il|sehir)$/,
  district: /^(ilce|semt)$/,
  currency: /^(doviz|para birimi|doviz cinsi|kur)$/,
  balance: /^(bakiye|guncel bakiye|toplam bakiye|net bakiye)$/,
};

const money = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};

export function parseBhParties(t: unknown[][]): { rows: BhParty[]; error?: string } {
  let hi = -1;
  let map: Partial<Record<keyof typeof COLS, number>> = {};
  for (let i = 0; i < Math.min(t.length, 30); i++) {
    const m: Partial<Record<keyof typeof COLS, number>> = {};
    (t[i] ?? []).forEach((c, j) => {
      const n = N(c);
      for (const [k, re] of Object.entries(COLS) as [keyof typeof COLS, RegExp][]) if (m[k] === undefined && re.test(n)) m[k] = j;
    });
    if (m.name !== undefined) { hi = i; map = m; break; }
  }
  if (hi < 0) return { rows: [], error: "Başlık satırı bulunamadı: dosyada \"Unvan\" / \"Cari Adı\" / \"Müşteri\" gibi bir sütun olmalı." };
  const get = (r: unknown[], k: keyof typeof COLS) => (map[k] === undefined ? undefined : r[map[k]!]);
  const rows: BhParty[] = [];
  const seen = new Set<string>();
  for (const r of t.slice(hi + 1)) {
    const name = txt(get(r, "name"));
    if (!name || /^(toplam|genel toplam)$/i.test(name)) continue;
    const tax = (String(get(r, "tax_no") ?? "").replace(/\D/g, "") || null);
    const roleTxt = N(get(r, "role"));
    const role = /tedarik|satici|alis/.test(roleTxt) ? "supplier" : /musteri|alici|satis/.test(roleTxt) ? "customer" : null;
    const cur = N(get(r, "currency"));
    const key = `${N(name)}|${tax ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key, name: name.slice(0, 200), code: txt(get(r, "code")), role, tax_no: tax && (tax.length === 10 || tax.length === 11) ? tax : null,
      tax_office: txt(get(r, "tax_office")), phone: txt(get(r, "phone")), email: txt(get(r, "email")), address: txt(get(r, "address")),
      city: txt(get(r, "city")), district: txt(get(r, "district")),
      currency: /eur|euro/.test(cur) ? "EUR" : /usd|dolar/.test(cur) ? "USD" : /gbp|sterlin/.test(cur) ? "GBP" : cur ? "TRY" : null,
      balance: money(get(r, "balance")),
    });
  }
  if (!rows.length) return { rows, error: "Dosyada cari satırı bulunamadı." };
  return { rows };
}
