/**
 * İş Kanunu uyum hesapları: çalışma süresi denetimi, iş günü, engelli kotası, sözleşme uyarıları.
 * Uyarılar bilgilendirme amaçlıdır; uygulamadan önce mali müşavir / avukatla teyit edilmelidir.
 */
import type { MonthData } from "@/lib/timekeeping";

/** İş günü ekle (pazar ve verilen tatiller hariç) */
export function addWorkdays(iso: string, n: number, holidays: Set<string> = new Set()) {
  let d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    const s = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && !holidays.has(s)) left--;
  }
  return d.toISOString().slice(0, 10);
}
export const workdaysBetween = (from: string, to: string, holidays: Set<string> = new Set()) => {
  let n = 0;
  for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) < to; d = new Date(d.getTime() + 86_400_000)) {
    const nx = new Date(d.getTime() + 86_400_000);
    const s = nx.toISOString().slice(0, 10);
    if (nx.getUTCDay() !== 0 && !holidays.has(s) && s <= to) n++;
  }
  return n;
};

const toMin = (t: string) => Date.parse(t.length === 16 ? `${t}:00Z` : t) / 60000;
/** Bir oturumun 20:00–06:00 gece aralığına düşen dakikası */
function nightMinutes(inAt: string, outAt: string) {
  const a = toMin(inAt), b = toMin(outAt);
  let n = 0;
  for (let t = a; t < b; t += 5) {
    const h = new Date(t * 60000).getUTCHours();
    if (h >= 20 || h < 6) n += Math.min(5, b - t);
  }
  return n;
}

export type WorkIssue = { employeeId: string; name: string; dept: string; date: string; kind: "gunluk11" | "gece" | "dinlenme" | "haftalik66"; detail: string };
export const ISSUE_LABEL: Record<WorkIssue["kind"], [string, string]> = {
  gunluk11: ["Günlük 11 saat aşıldı", "İş K. md. 63 ve Fazla Çalışma Yönetmeliği: fazla mesai dâhil günde en çok 11 saat çalışılır."],
  gece: ["Gece çalışması 7,5 saati aştı", "İş K. md. 69: gece (20:00–06:00) çalışması 7,5 saati geçemez."],
  dinlenme: ["İki iş günü arası 11 saatten az", "Postalar Yönetmeliği md. 5: işçiye günlük çalışmadan sonra en az 11 saat kesintisiz dinlenme verilir."],
  haftalik66: ["Haftalık 66 saati aştı", "Günde 11 saat × 6 gün sınırı; haftalık 45 saati aşan süre fazla mesaidir ve yıllık 270 saati geçemez."],
};

/** Puantajdan yasal çalışma süresi ihlalleri */
export function workTimeIssues(m: MonthData): WorkIssue[] {
  const out: WorkIssue[] = [];
  for (const e of m.employees) {
    const row = m.cells.get(e.id);
    if (!row) continue;
    const days = [...row.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const week = new Map<string, number>();
    for (let i = 0; i < days.length; i++) {
      const [d, c] = days[i]!;
      if (!c.employed || !c.firstIn || !c.lastOut) continue;
      const base = { employeeId: e.id, name: e.name, dept: e.dept, date: d };
      if (c.workedMin > 660) out.push({ ...base, kind: "gunluk11", detail: `${Math.floor(c.workedMin / 60)} sa ${c.workedMin % 60} dk çalışma` });
      const night = nightMinutes(c.firstIn, c.lastOut) - Math.min(c.outsideMin, nightMinutes(c.firstIn, c.lastOut));
      if (night > 450) out.push({ ...base, kind: "gece", detail: `gece ${Math.floor(night / 60)} sa ${night % 60} dk` });
      const prev = days[i - 1];
      if (prev && prev[1].lastOut && Date.parse(d) - Date.parse(prev[0]) === 86_400_000) {
        const rest = toMin(c.firstIn) - toMin(prev[1].lastOut);
        if (rest >= 0 && rest < 660) out.push({ ...base, kind: "dinlenme", detail: `önceki çıkış ${prev[1].lastOut.slice(11)} → giriş ${c.firstIn.slice(11)} (${Math.floor(rest / 60)} sa ${rest % 60} dk)` });
      }
      // Pazartesi başlangıçlı hafta
      const dt = new Date(d + "T12:00:00Z");
      const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
      week.set(monday, (week.get(monday) ?? 0) + c.workedMin);
    }
    for (const [mon, min] of week) if (min > 66 * 60) out.push({ employeeId: e.id, name: e.name, dept: e.dept, date: mon, kind: "haftalik66", detail: `${Math.round(min / 6) / 10} saat (hafta başı ${mon.split("-").reverse().join(".")})` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Engelli istihdam kotası (md. 30): 50+ işçide %3; kesir yarıma kadar dikkate alınmaz, yarıdan fazlası tama tamamlanır */
export function disabilityQuota(workers: number) {
  if (workers < 50) return 0;
  const raw = workers * 0.03;
  const frac = raw - Math.floor(raw);
  return frac > 0.5 ? Math.ceil(raw) : Math.floor(raw);
}

export const DISC_CATEGORIES = ["Devamsızlık", "Geç gelme / erken çıkma", "İş kurallarına aykırılık", "İSG kurallarına aykırılık", "Amire / iş arkadaşına saygısızlık", "Kavga / şiddet", "Hırsızlık / güveni kötüye kullanma", "Gizliliği ihlal", "Diğer"];
export const DECISION_LABEL: Record<string, string> = { uyari: "Sözlü / yazılı uyarı", ihtar: "İhtar (ihtarname)", ucret_kesme: "Ücret kesme cezası (md. 38)", gecerli_fesih: "Geçerli nedenle fesih (md. 18–19)", hakli_fesih: "Haklı nedenle fesih (md. 25/II)", islem_yok: "İşlem yapılmadı" };
export const CHANGE_TYPES = ["Görev / pozisyon", "Çalışma yeri", "Çalışma saatleri / vardiya", "Ücret ve ödeme şekli", "Çalışma şekli (tam / kısmi süre)", "Diğer"];
export const CONTRACT_LABEL: Record<string, string> = { belirsiz: "Belirsiz süreli", belirli: "Belirli süreli", kismi: "Kısmi süreli", cagri: "Çağrı üzerine" };
