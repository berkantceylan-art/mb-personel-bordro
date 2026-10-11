/** Çek / senet, kredi, avans, ortak: etiketler */
export const CHEQUE_STATUS: Record<string, [string, "gray" | "blue" | "green" | "amber" | "red"]> = {
  portfolio: ["Portföyde", "blue"], deposited: ["Tahsilde", "amber"], collected: ["Tahsil edildi", "green"], endorsed: ["Ciro edildi", "gray"],
  bounced: ["Karşılıksız", "red"], returned: ["İade edildi", "gray"], issued: ["Ödenecek", "amber"], paid: ["Ödendi", "green"], cancelled: ["İptal", "gray"],
};
export const CHEQUE_ACTION: Record<string, string> = {
  received: "Alındı (portföy)", issued: "Verildi", deposit: "Tahsile verildi", collect: "Tahsil edildi", endorse: "Ciro edildi", bounce: "Karşılıksız", return: "İade edildi", pay: "Ödendi", cancel: "İptal / geri alındı",
};

/** Ödenmemiş alacakların yaşlandırması: ödemeler en eski borçtan düşülür (FIFO) */
export function aging(lines: { date: string; debit: number; credit: number }[], todayIso: string) {
  const debts: { date: string; left: number }[] = [];
  let credit = 0;
  for (const l of [...lines].sort((a, b) => a.date.localeCompare(b.date))) {
    if (l.debit > 0) debts.push({ date: l.date, left: l.debit });
    credit += l.credit;
  }
  for (const d of debts) { const take = Math.min(d.left, credit); d.left -= take; credit -= take; }
  const b = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, oldest: null as string | null };
  const t = new Date(todayIso).getTime();
  for (const d of debts.filter((x) => x.left > 0)) {
    const days = Math.floor((t - new Date(d.date).getTime()) / 86400000);
    if (days <= 30) b.d0_30 += d.left; else if (days <= 60) b.d31_60 += d.left; else if (days <= 90) b.d61_90 += d.left; else b.d90 += d.left;
    b.oldest ??= d.date;
  }
  return b;
}
