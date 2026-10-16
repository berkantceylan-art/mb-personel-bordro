/** TCMB günlük kurları (https://www.tcmb.gov.tr/kurlar/today.xml): döviz satış kuru esas alınır */
export type TcmbRate = { currency: "USD" | "EUR" | "GBP" | "CHF"; buying: number | null; selling: number };

const WANTED = ["USD", "EUR", "GBP", "CHF"] as const;

export function parseTcmb(xml: string): { date: string | null; rates: TcmbRate[] } {
  const dm = xml.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
  const rates: TcmbRate[] = [];
  for (const cur of WANTED) {
    const block = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${cur}"[^>]*>([\\s\\S]*?)</Currency>`));
    if (!block) continue;
    const num = (tag: string) => {
      const m = block[1]!.match(new RegExp(`<${tag}>([0-9.]+)</${tag}>`));
      return m ? Number(m[1]) : null;
    };
    const unitM = block[1]!.match(/<Unit>(\d+)<\/Unit>/);
    const unit = unitM ? Number(unitM[1]) || 1 : 1;
    const selling = num("ForexSelling");
    const buying = num("ForexBuying");
    if (selling && selling > 0) rates.push({ currency: cur, buying: buying ? buying / unit : null, selling: selling / unit });
  }
  return { date, rates };
}

export async function fetchTcmb(): Promise<{ date: string | null; rates: TcmbRate[] }> {
  const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", { cache: "no-store", headers: { "user-agent": "MB Dental ERP" } });
  if (!res.ok) throw new Error(`TCMB yanıtı ${res.status}`);
  return parseTcmb(await res.text());
}

/** Geçmiş bir günün TCMB kurları (hafta sonu / tatilde yayın yok → null) */
export async function fetchTcmbDate(date: string): Promise<{ date: string | null; rates: TcmbRate[] } | null> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const res = await fetch(`https://www.tcmb.gov.tr/kurlar/${m[1]}${m[2]}/${m[3]}${m[2]}${m[1]}.xml`, { cache: "no-store", headers: { "user-agent": "MB Dental ERP" }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TCMB yanıtı ${res.status}`);
  return parseTcmb(await res.text());
}
