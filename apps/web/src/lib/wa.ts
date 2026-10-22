/** WhatsApp bağlantısı (wa.me): telefon numarasını uluslararası biçime çevirir, metni hazırlar */
export function waLink(phone: string | null | undefined, text: string): string | null {
  let p = (phone ?? "").replace(/\D/g, "");
  if (!p) return null;
  if (p.startsWith("00")) p = p.slice(2);
  else if (p.startsWith("0")) p = `90${p.slice(1)}`;
  // başında 0 olmadan yazılmış 10 haneli Türkiye numarası (5xx cep, 2xx–4xx sabit hat)
  else if (/^[2-5]\d{9}$/.test(p)) p = `90${p}`;
  if (p.length < 10) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

type L = "tr" | "en" | "fr";
const pick = (lang: string | null | undefined): L => (lang === "en" || lang === "fr" ? lang : "tr");

/** Günlük gönderim mesajı */
export function waWaybillText(o: { lang?: string | null; customer: string; no: string; jobs: { no: number; patient: string | null }[]; total: string; company: string }) {
  const l = pick(o.lang);
  const list = o.jobs.slice(0, 20).map((j) => `• #${j.no}${j.patient ? ` ${j.patient}` : ""}`).join("\n");
  if (l === "fr") return `Bonjour ${o.customer},\nNous vous avons expédié aujourd'hui ${o.jobs.length} cas (bon de livraison ${o.no}) :\n${list}\nTotal : ${o.total}\n${o.company}`;
  if (l === "en") return `Hello ${o.customer},\nToday we shipped ${o.jobs.length} case(s) to you (delivery note ${o.no}):\n${list}\nTotal: ${o.total}\n${o.company}`;
  return `Merhaba ${o.customer},\nBugün ${o.jobs.length} işiniz yola çıktı (irsaliye ${o.no}):\n${list}\nToplam: ${o.total}\n${o.company}`;
}

/** Aylık fatura mesajı */
export function waStatementText(o: { lang?: string | null; customer: string; no: string; period: string; total: string; jobs: number; banks: string[]; company: string }) {
  const l = pick(o.lang);
  const bank = o.banks.length ? `\n${o.banks.join("\n")}` : "";
  if (l === "fr") return `Bonjour ${o.customer},\nVotre facture mensuelle ${o.no} (${o.period}) : ${o.jobs} cas, total ${o.total}.${bank}\nMerci,\n${o.company}`;
  if (l === "en") return `Hello ${o.customer},\nYour monthly invoice ${o.no} (${o.period}): ${o.jobs} cases, total ${o.total}.${bank}\nThank you,\n${o.company}`;
  return `Merhaba ${o.customer},\n${o.period} dönemi faturanız ${o.no}: ${o.jobs} iş, toplam ${o.total}.${bank}\nTeşekkürler,\n${o.company}`;
}

/** Kurye yolda */
export function waCourierText(lang: string | null | undefined, customer: string, company: string) {
  const l = pick(lang);
  if (l === "fr") return `Bonjour ${customer}, notre coursier est en route vers vous. ${company}`;
  if (l === "en") return `Hello ${customer}, our courier is on the way to you. ${company}`;
  return `Merhaba ${customer}, kuryemiz size doğru yola çıktı. ${company}`;
}

/** WhatsApp Cloud API için numara (ülke kodlu, yalnız rakam); geçersizse null */
export function waNumber(phone: string | null | undefined): string | null {
  const link = waLink(phone, "");
  return link ? link.slice("https://wa.me/".length).split("?")[0]! : null;
}
