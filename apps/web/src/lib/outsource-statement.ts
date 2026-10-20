import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";
import { osNorm } from "@/lib/outsource-parse";

export type OsPrice = { id: string; party_id: string; name: string; price: number; sort: number };
export type OsFlag = "nojob" | "notsent" | "notback" | "dup" | "over" | "noprice" | "cust";
export const OS_FLAG: Record<OsFlag, string> = {
  over: "Fiyat listesinden fazla", dup: "Aynı iş + ürün birden fazla faturalanmış", nojob: "İş kaydı bulunamadı", notsent: "Bu laboratuvara gönderilmemiş",
  notback: "Henüz geri gelmedi", noprice: "Fiyat listesinde karşılığı seçilmemiş", cust: "Hekim / hasta adı uyuşmuyor",
};
type Line = { id: string; statement_id: string | null; party_id: string; line_date: string | null; kind: string; product: string | null; ref: string | null; job_no: number | null; amount: number;
  job_id: string | null; outsource_id: string | null; disputed: boolean; note: string | null;
  jobs: { no: number; patient: string | null; doctor_name: string | null; currency: string; total: number; lab_customers: { name: string } | null; job_items: { name: string; qty: number }[] } | null;
  job_outsource: { status: string; party_id: string; back_at: string | null } | null };

// ekstre adlarındaki kısaltmalar → fiyat listesindeki karşılığı (öneri için)
const SYN: [RegExp, string][] = [[/BLEACH(ING)?/g, "BEYAZLATMA PLAGI"], [/COMB[İI] ?PLAK/g, "ICI YUMUSAK DISI SERT GECE PLAGI"], [/\b2 ?MB(LI)?\b/g, "2 MOLAR BANTLI"], [/\bMB(LI)?\b/g, "MOLAR BANTLI"], [/YUMU[SŞ]AK/g, "YUMUSAK"]];
const words = (s: string) => {
  let t = s.toLocaleUpperCase("tr").replace(/[ÇĞİÖŞÜ]/g, (c) => ({ Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" })[c] ?? c);
  for (const [re, v] of SYN) t = t.replace(re, ` ${v} `);
  return new Set(t.split(/[^A-Z0-9]+/).filter((w) => w.length >= 2 && !["MM", "VE", "ILE"].includes(w)));
};
export function suggestPrice(product: string, prices: OsPrice[]) {
  const a = words(product);
  let best: { p: OsPrice; s: number } | null = null;
  for (const p of prices) {
    const b = words(p.name);
    let inter = 0;
    for (const w of b) if (a.has(w) || [...a].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) inter++;
    const s = b.size ? inter / b.size * 0.7 + (a.size ? inter / a.size : 0) * 0.3 : 0;
    if (!best || s > best.s) best = { p, s };
  }
  return best && best.s >= 0.45 ? best : null;
}

/** Ekstre satırları + kontroller */
export async function outsourceStatementData(months: number) {
  const sb = await createClient();
  const from = new Date(Date.now() - months * 31 * 86400000).toISOString().slice(0, 10);
  const [labsR, pricesR, aliasR, linesR, stR] = await Promise.all([
    sb.from("fin_parties").select("id, name, email").eq("outsource_lab", true).order("name"),
    sb.from("outsource_prices").select("id, party_id, name, price, sort").order("sort"),
    sb.from("outsource_price_alias").select("party_id, norm_name, price_id"),
    allRows<Line>((a, b) => sb.from("outsource_lines").select("id, statement_id, party_id, line_date, kind, product, ref, job_no, amount, job_id, outsource_id, disputed, note, jobs(no, patient, doctor_name, currency, total, lab_customers(name), job_items(name, qty)), job_outsource(status, party_id, back_at)")
      .gte("line_date", from).order("line_date", { ascending: false }).order("id").range(a, b)),
    sb.from("outsource_statements").select("id, party_id, file_name, doc_date, total, lines, created_at, mail_ref").order("created_at", { ascending: false }).limit(40),
  ]);
  const missing = [labsR.error, pricesR.error, linesR.error].find((e) => e && /outsource_|schema cache|does not exist/i.test(e.message));
  const labs = (labsR.data ?? []) as { id: string; name: string; email: string | null }[];
  const prices = (pricesR.data ?? []) as OsPrice[];
  const alias = new Map(((aliasR.data ?? []) as { party_id: string; norm_name: string; price_id: string }[]).map((a) => [`${a.party_id}|${a.norm_name}`, a.price_id]));
  const priceBy = new Map(prices.map((p) => [p.id, p]));
  const lines = linesR.data;
  // aynı iş + ürün sayısı (tüm satırlar içinde)
  const cnt = new Map<string, number>();
  for (const l of lines) if (l.kind === "charge" && l.job_no) { const k = `${l.party_id}|${l.job_no}|${osNorm(l.product)}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  const rows = lines.map((l) => {
    const pl = prices.filter((p) => p.party_id === l.party_id);
    const aid = alias.get(`${l.party_id}|${osNorm(l.product)}`);
    const exact = pl.find((p) => osNorm(p.name) === osNorm(l.product));
    const sug = !aid && !exact ? suggestPrice(l.product ?? "", pl) : null;
    const price = (aid ? priceBy.get(aid) : exact) ?? sug?.p ?? null;
    const confirmed = !!(aid || exact);
    const f: OsFlag[] = [];
    if (l.kind === "charge") {
      if (!l.job_id) f.push("nojob");
      else if (!l.outsource_id) f.push("notsent");
      else if (l.job_outsource?.status === "sent") f.push("notback");
      if (l.job_no && (cnt.get(`${l.party_id}|${l.job_no}|${osNorm(l.product)}`) ?? 0) > 1) f.push("dup");
      if (price && l.amount > price.price) f.push("over");
      if (!confirmed) f.push("noprice");
      if (l.jobs && l.ref) {
        const hay = osNorm(`${l.jobs.lab_customers?.name ?? ""} ${l.jobs.patient ?? ""} ${l.jobs.doctor_name ?? ""}`);
        const toks = l.ref.split(/\s+/).map(osNorm).filter((t) => t.length >= 2);
        if (toks.length && !toks.some((t) => hay.includes(t))) f.push("cust");
      }
    }
    return { ...l, price, confirmed, suggested: !!sug, flags: f, over: price && l.amount > price.price ? l.amount - price.price : 0 };
  });
  // geldi ama ekstrede yok: 5 günden önce gelmiş, hiçbir satırda yok
  const linked = new Set(lines.map((l) => l.outsource_id).filter(Boolean));
  const { data: backs } = await sb.from("job_outsource").select("id, job_id, party_id, back_at, jobs(no, patient, lab_customers(name))").eq("status", "back")
    .gte("back_at", from).lte("back_at", new Date(Date.now() - 5 * 86400000).toISOString()).limit(500);
  const notBilled = ((backs ?? []) as unknown as { id: string; job_id: string; party_id: string; back_at: string; jobs: { no: number; patient: string | null; lab_customers: { name: string } | null } | null }[]).filter((b) => !linked.has(b.id));
  return { labs, prices, rows, statements: (stR.data ?? []) as { id: string; party_id: string; file_name: string | null; doc_date: string | null; total: number | null; lines: number; created_at: string; mail_ref: string | null }[], notBilled, missing: !!missing };
}

export const DEFAULT_PRICE_LIST = `YUMUŞAK GECE PLAĞI; 500
İÇİ YUMUŞAK DIŞI SERT GECE PLAĞI; 1000
BEYAZLATMA PLAĞI TEK ÇENE; 500
SERT GECE PLAĞI; 500
PEKİŞTİRME PLAĞI; 500
AKRİLDEN GECE PLAĞI; 1500
HORLAMA PLAĞI; 2500
SPORCU PLAĞI; 3000
SABİT YER TUTUCU; 1000
HAREKETLİ YER TUTUCU; 1000
HAWLEY PLAĞI; 1000
TEK YÖNLÜ VİDALI APAREY; 1000
ÇİFT YÖNLÜ VİDALI APAREY; 1250
ÜÇ YÖNLÜ VİDALI APAREY; 1800
KELEBEK VİDALI APAREY; 2000
DİL KORUYUCU APAREY; 1200
TWİNBLOK; 2500
MONOBLOK; 2500
AKTİVATÖR; 2500
SABİT DİL TUTUCU 2 MOLAR BANTLI; 2500
TPA TÜPLÜ 2 MOLAR BANTLI; 2000
QUAD HELİX 2 MOLAR BANTLI; 2500
HYRAX 2 MOLAR BANTLI; 2500
NANCE APAREY TÜPLÜ MOLAR BANTLI; 2000
RPE AKRİLİK (MCNAMARA) HYRAX VİDALI; 2000
LİNGUAL ARK TÜPLÜ; 2000
RETAİNER; 900
ALİGNER PLAK BAŞI; 900
ALİGNER ANALİZ ÜCRETİ; 1500`;
