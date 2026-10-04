import { annualLeaveEntitlement, formatTL } from "@mb/core";
import { loadCompliance } from "@/lib/compliance";
import { contractsAt } from "@/lib/contracts";
import { computePayroll } from "@/lib/payroll";
import type { createClient } from "@/lib/supabase/server";
import { currentPeriod, periodLabel, todayIso } from "@/lib/session";
import { fetchAll, loadMonth } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;

export type ColType = "text" | "money" | "number" | "date";
export interface Column { key: string; label: string; type?: ColType; width?: number }
export interface ReportResult {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, string | number | null>;
  warnings?: string[];
  fileName: string;
}
export type ParamKind = "period" | "dateRange" | "department" | "year" | "bankSource" | "payDate";
export interface ReportParams { period: string; from: string; to: string; department?: string; year: number; source: string; payDate: string }
export interface ReportDef {
  key: string;
  title: string;
  description: string;
  group: "Ödeme listeleri" | "Maaş ve maliyet" | "Zaman" | "Uyum" | "Personel";
  params: ParamKind[];
  roles: string[];
  run: (supabase: SB, p: ReportParams) => Promise<ReportResult>;
}

const PAY = ["owner", "accountant"];
const HR = ["owner", "accountant", "hr"];
const sumBy = (rows: Array<Record<string, unknown>>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + Number(r[k] ?? 0), 0)]));
const slug = (s: string) => s.toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]+/g, "-");

export function parseParams(sp: Record<string, string | undefined>): ReportParams {
  const period = sp.donem && /^\d{4}-\d{2}$/.test(sp.donem) ? sp.donem : currentPeriod();
  return {
    period,
    from: sp.bas && /^\d{4}-\d{2}-\d{2}$/.test(sp.bas) ? sp.bas : `${period}-01`,
    to: sp.bit && /^\d{4}-\d{2}-\d{2}$/.test(sp.bit) ? sp.bit : todayIso(),
    department: sp.bolum || undefined,
    year: Number(sp.yil) || new Date().getFullYear(),
    source: sp.kaynak === "bordro" ? "bordro" : "kalan",
    payDate: sp.odeme && /^\d{4}-\d{2}-\d{2}$/.test(sp.odeme) ? sp.odeme : todayIso(),
  };
}

async function deptFilter<T extends { dept: string }>(rows: T[], d?: string) {
  return d ? rows.filter((r) => r.dept === d) : rows;
}

export const REPORTS: ReportDef[] = [
  /* ---------------- Ödeme listeleri ---------------- */
  {
    key: "banka-maas",
    title: "Banka maaş ödeme listesi (Garanti BBVA)",
    description: "Dönemin bankaya yatacak maaşları. Excel, Garanti BBVA'nın \"TGB Yeni Maaş Dosyası\" formatında iner; doğrudan bankaya yüklenir.",
    group: "Ödeme listeleri",
    params: ["period", "payDate", "bankSource", "department"],
    roles: PAY,
    async run(sb, p) {
      const rows = await deptFilter(await computePayroll(sb, p.period), p.department);
      const { data: privs } = await sb.from("employee_private").select("employee_id, national_id, iban, iban_holder").in("employee_id", rows.map((r) => r.employeeId));
      const priv = new Map((privs ?? []).map((x) => [x.employee_id, x]));
      const desc = `${periodLabel(p.period).toLocaleUpperCase("tr")} MAAŞ`;
      const warnings: string[] = [];
      const out = rows
        .map((r) => ({ r, amount: p.source === "bordro" ? r.result.netToBank : r.pay.bank }))
        .filter((x) => x.amount > 0)
        .map(({ r, amount }, i) => {
          const pr = priv.get(r.employeeId);
          if (!pr?.iban) warnings.push(`${r.name}: IBAN eksik`);
          if (!pr?.national_id) warnings.push(`${r.name}: TC kimlik no eksik`);
          return { sira: i + 1, tckn: pr?.national_id ?? "", ad: pr?.iban_holder || r.name.toLocaleUpperCase("tr"), iban: pr?.iban ?? "", tutar: amount, aciklama: desc, bolum: r.dept };
        });
      return {
        title: "Garanti BBVA maaş ödeme listesi",
        subtitle: `${periodLabel(p.period)} · ${p.source === "bordro" ? "bordro neti (BES/icra sonrası)" : "bordro netinden henüz bankadan ödenmemiş kalan"}`,
        columns: [
          { key: "sira", label: "Sıra", type: "number", width: 6 }, { key: "tckn", label: "TCKN", width: 14 }, { key: "ad", label: "Alıcı Adı Soyadı", width: 26 },
          { key: "iban", label: "IBAN", width: 30 }, { key: "tutar", label: "Tutar", type: "money", width: 14 }, { key: "aciklama", label: "Açıklama", width: 18 }, { key: "bolum", label: "Bölüm", width: 16 },
        ],
        rows: out,
        totals: { ad: `${out.length} kişi`, ...sumBy(out, ["tutar"]) },
        warnings,
        fileName: `garanti-maas-${p.period}`,
      };
    },
  },
  {
    key: "avans-listesi",
    title: "Avans listesi",
    description: "Kaydedilmiş avanslar tarih aralığına göre: imza sütunlu liste ve tek tek makbuz yazdırma.",
    group: "Ödeme listeleri",
    params: ["dateRange", "department"],
    roles: PAY,
    async run(sb, p) {
      const [entries, { data: emps }] = await Promise.all([
        fetchAll<{ id: string; employee_id: string; entry_date: string; channel: string; amount: number; note: string | null; period: string }>((from, to) =>
          sb.from("ledger_entries").select("id, employee_id, entry_date, channel, amount, note, period").eq("type", "ADVANCE").is("voided_at", null).gte("entry_date", p.from).lte("entry_date", p.to).order("entry_date").order("created_at").range(from, to),
        ),
        sb.from("employees").select("id, first_name, last_name, departments(name)"),
      ]);
      const emp = new Map((emps ?? []).map((e) => [e.id, { name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "" }]));
      const all = entries.map((e) => ({ tarih: e.entry_date, ad: emp.get(e.employee_id)?.name ?? "", dept: emp.get(e.employee_id)?.dept ?? "", kanal: e.channel === "BANK" ? "Banka" : "Elden", donem: periodLabel(e.period), tutar: Number(e.amount), aciklama: e.note ?? "", imza: "" }));
      const out = (await deptFilter(all, p.department)).map(({ dept, ...r }) => ({ ...r, bolum: dept }));
      const cash = out.filter((r) => r.kanal === "Elden").reduce((a, r) => a + r.tutar, 0);
      return {
        title: "Avans listesi",
        subtitle: `${p.from.split("-").reverse().join(".")} – ${p.to.split("-").reverse().join(".")} · elden ${formatTL(cash)} · banka ${formatTL(out.reduce((a, r) => a + r.tutar, 0) - cash)}`,
        columns: [
          { key: "tarih", label: "Tarih", type: "date", width: 11 }, { key: "ad", label: "Ad Soyad", width: 24 }, { key: "bolum", label: "Bölüm", width: 16 }, { key: "kanal", label: "Kanal", width: 8 },
          { key: "donem", label: "Ait olduğu ay", width: 13 }, { key: "tutar", label: "Tutar", type: "money", width: 14 }, { key: "aciklama", label: "Açıklama", width: 22 }, { key: "imza", label: "İmza", width: 18 },
        ],
        rows: out,
        totals: { ad: `${out.length} avans`, ...sumBy(out, ["tutar"]) },
        fileName: `avans-listesi-${p.from}-${p.to}`,
      };
    },
  },
  {
    key: "elden-odeme",
    title: "Elden ödeme listesi",
    description: "Dönem sonunda elden verilecek tutarlar; imza sütunlu, çıktısı alınıp imzalatılabilir.",
    group: "Ödeme listeleri",
    params: ["period", "department"],
    roles: PAY,
    async run(sb, p) {
      const rows = (await deptFilter(await computePayroll(sb, p.period), p.department)).filter((r) => r.pay.cash > 0);
      const out = rows.map((r, i) => ({ sira: i + 1, bolum: r.dept, ad: r.name, tutar: r.pay.cash, imza: "" }));
      return {
        title: "Elden ödeme listesi", subtitle: periodLabel(p.period),
        columns: [{ key: "sira", label: "Sıra", type: "number", width: 6 }, { key: "bolum", label: "Bölüm", width: 18 }, { key: "ad", label: "Ad Soyad", width: 26 }, { key: "tutar", label: "Tutar", type: "money", width: 16 }, { key: "imza", label: "İmza", width: 24 }],
        rows: out, totals: { ad: `${out.length} kişi`, ...sumBy(out, ["tutar"]) }, fileName: `elden-odeme-${p.period}`,
      };
    },
  },
  {
    key: "bes-liste",
    title: "BES ödeme listesi (Garanti BBVA Emeklilik)",
    description: "Kaydedilmiş bordrolardaki BES kesintileri. Excel, Garanti BBVA Emeklilik otomatik katılım ödeme dosyası (.xls) formatında iner.",
    group: "Ödeme listeleri",
    params: ["period", "payDate"],
    roles: PAY,
    async run(sb, p) {
      const [{ data: lines }, { data: emps }, { data: privs }, { data: enr }] = await Promise.all([
        sb.from("payroll_lines").select("employee_id, bes, official_gross").eq("period", p.period).gt("bes", 0),
        sb.from("employees").select("id, first_name, last_name"),
        sb.from("employee_private").select("employee_id, national_id, sgk_no"),
        sb.from("bes_enrollments").select("employee_id, policy_no, rate").eq("status", "active"),
      ]);
      const emp = new Map((emps ?? []).map((e) => [e.id, e]));
      const priv = new Map((privs ?? []).map((x) => [x.employee_id, x]));
      const pol = new Map((enr ?? []).map((x) => [x.employee_id, x]));
      const out = (lines ?? []).map((l) => ({
        tckn: priv.get(l.employee_id)?.national_id ?? "", ad: emp.get(l.employee_id)?.first_name ?? "", soyad: emp.get(l.employee_id)?.last_name ?? "",
        police: pol.get(l.employee_id)?.policy_no ?? "", oran: Number(pol.get(l.employee_id)?.rate ?? 0.03) * 100, pek: Number(l.official_gross), tutar: Number(l.bes),
      }));
      return {
        title: "Garanti BBVA Emeklilik BES listesi", subtitle: periodLabel(p.period),
        columns: [{ key: "tckn", label: "TCKN", width: 14 }, { key: "ad", label: "Ad", width: 16 }, { key: "soyad", label: "Soyad", width: 16 }, { key: "police", label: "Poliçe No", width: 14 }, { key: "oran", label: "Oran %", type: "number", width: 8 }, { key: "pek", label: "Prime Esas Kazanç", type: "money", width: 18 }, { key: "tutar", label: "Kesinti", type: "money", width: 14 }],
        rows: out, totals: { ad: `${out.length} kişi`, ...sumBy(out, ["pek", "tutar"]) },
        warnings: out.length ? [] : ["Bu dönemin bordrosu kaydedilmemiş veya BES kesintisi yok."], fileName: `garanti-emeklilik-bes-${p.period}`,
      };
    },
  },
  {
    key: "icra-liste",
    title: "İcra / nafaka kesinti listesi",
    description: "İcra dairelerine yatırılacak aylık kesintiler: daire, dosya no, IBAN, tutar, kalan borç.",
    group: "Ödeme listeleri",
    params: ["period"],
    roles: PAY,
    async run(sb, p) {
      const [{ data: deds }, { data: files }, { data: emps }] = await Promise.all([
        sb.from("garnishment_deductions").select("file_id, employee_id, amount").eq("period", p.period),
        sb.from("garnishment_balances").select("id, office, file_no, kind, payment_iban, remaining"),
        sb.from("employees").select("id, first_name, last_name"),
      ]);
      const f = new Map((files ?? []).map((x) => [x.id, x]));
      const e = new Map((emps ?? []).map((x) => [x.id, `${x.first_name} ${x.last_name}`]));
      const out = (deds ?? []).map((d) => {
        const file = f.get(d.file_id);
        return { daire: file?.office ?? "", dosya: file?.file_no ?? "", tur: file?.kind === "ALIMONY" ? "Nafaka" : "İcra", personel: e.get(d.employee_id) ?? "", iban: file?.payment_iban ?? "", tutar: Number(d.amount), kalan: file?.kind === "ALIMONY" ? null : Number(file?.remaining ?? 0) };
      });
      return {
        title: "İcra / nafaka kesinti listesi", subtitle: periodLabel(p.period),
        columns: [{ key: "daire", label: "İcra dairesi", width: 24 }, { key: "dosya", label: "Dosya no", width: 14 }, { key: "tur", label: "Tür", width: 8 }, { key: "personel", label: "Personel", width: 22 }, { key: "iban", label: "Ödeme IBAN", width: 30 }, { key: "tutar", label: "Kesinti", type: "money", width: 14 }, { key: "kalan", label: "Kalan borç", type: "money", width: 14 }],
        rows: out, totals: sumBy(out, ["tutar"]), fileName: `icra-kesinti-${p.period}`,
      };
    },
  },

  /* ---------------- Maaş ve maliyet ---------------- */
  {
    key: "maas-icmal",
    title: "Aylık maaş icmali",
    description: "Personel 1 ayda ne hak etti, bankadan ve elden ne aldı, ne kesildi, ne kaldı; kalanın bankaya ve elden dağılımı.",
    group: "Maaş ve maliyet",
    params: ["period", "department"],
    roles: PAY,
    async run(sb, p) {
      const rows = await deptFilter(await computePayroll(sb, p.period), p.department);
      const out = rows.map((r) => {
        const pending = r.saved?.posted ? 0 : r.result.breakdown.bes + r.result.garnishmentTotal;
        return {
          bolum: r.dept, ad: r.name, ucret: r.totalNet, hakedis: r.ledger.accrued, fm_resmi: r.ledger.overtimeOfficial, fm_elden: r.ledger.overtimeCash,
          eksik: r.ledger.absenceOfficial + r.ledger.absenceCash, bes_icra: r.result.breakdown.bes + r.result.garnishmentTotal,
          banka: r.ledger.paidBank, elden: r.ledger.paidCash, kalan: r.ledger.balance - pending, kalan_banka: r.pay.bank, kalan_elden: r.pay.cash,
        };
      });
      const money = ["ucret", "hakedis", "fm_resmi", "fm_elden", "eksik", "bes_icra", "banka", "elden", "kalan", "kalan_banka", "kalan_elden"];
      return {
        title: "Aylık maaş icmali", subtitle: `${periodLabel(p.period)}${p.department ? ` · ${p.department}` : ""}`,
        columns: [
          { key: "bolum", label: "Bölüm", width: 16 }, { key: "ad", label: "Personel", width: 22 }, { key: "ucret", label: "Aylık ücret", type: "money" }, { key: "hakedis", label: "Hakediş (+FM)", type: "money" },
          { key: "fm_resmi", label: "FM resmi", type: "money" }, { key: "fm_elden", label: "FM elden", type: "money" }, { key: "eksik", label: "Eksik gün", type: "money" }, { key: "bes_icra", label: "BES + icra", type: "money" },
          { key: "banka", label: "Bankadan ödenen", type: "money" }, { key: "elden", label: "Elden ödenen", type: "money" }, { key: "kalan", label: "Kalan", type: "money" },
          { key: "kalan_banka", label: "→ Bankaya", type: "money" }, { key: "kalan_elden", label: "→ Elden", type: "money" },
        ],
        rows: out, totals: { ad: `${out.length} kişi`, ...sumBy(out, money) }, fileName: `maas-icmal-${p.period}${p.department ? "-" + slug(p.department) : ""}`,
      };
    },
  },
  {
    key: "bolum-maliyet",
    title: "Bölüm bazlı maliyet",
    description: "Her bölümün kişi sayısı, toplam ücreti, resmi brüt, işveren maliyeti, elden kısım ve fazla mesai toplamları.",
    group: "Maaş ve maliyet",
    params: ["period"],
    roles: PAY,
    async run(sb, p) {
      const rows = await computePayroll(sb, p.period);
      const m = new Map<string, Record<string, number | string>>();
      for (const r of rows) {
        const g = m.get(r.dept) ?? { bolum: r.dept, kisi: 0, ucret: 0, resmi_brut: 0, resmi_net: 0, isveren: 0, elden: 0, fm: 0, hakedis: 0 };
        g.kisi = Number(g.kisi) + 1;
        g.ucret = Number(g.ucret) + r.totalNet;
        g.resmi_brut = Number(g.resmi_brut) + r.result.breakdown.gross;
        g.resmi_net = Number(g.resmi_net) + r.result.breakdown.net;
        g.isveren = Number(g.isveren) + r.result.breakdown.employerCost;
        g.elden = Number(g.elden) + Math.max(0, r.ledger.accrued - r.ledger.overtimeOfficial - r.result.breakdown.net);
        g.fm = Number(g.fm) + r.ledger.overtimeOfficial + r.ledger.overtimeCash;
        g.hakedis = Number(g.hakedis) + r.ledger.accrued;
        m.set(r.dept, g);
      }
      const out = [...m.values()].map((g) => ({ ...g, toplam: Number(g.isveren) + Number(g.elden) })).sort((a, b) => Number(b.toplam) - Number(a.toplam));
      return {
        title: "Bölüm bazlı maliyet", subtitle: periodLabel(p.period),
        columns: [
          { key: "bolum", label: "Bölüm", width: 18 }, { key: "kisi", label: "Kişi", type: "number" }, { key: "ucret", label: "Toplam anlaşılan ücret", type: "money" }, { key: "hakedis", label: "Dönem hakedişi", type: "money" },
          { key: "resmi_brut", label: "Resmi brüt", type: "money" }, { key: "resmi_net", label: "Resmi net", type: "money" }, { key: "isveren", label: "İşveren resmi maliyeti", type: "money" },
          { key: "elden", label: "Elden kısım", type: "money" }, { key: "fm", label: "Fazla mesai", type: "money" }, { key: "toplam", label: "Toplam maliyet", type: "money" },
        ],
        rows: out, totals: { bolum: "Toplam", ...sumBy(out, ["kisi", "ucret", "hakedis", "resmi_brut", "resmi_net", "isveren", "elden", "fm", "toplam"]) },
        fileName: `bolum-maliyet-${p.period}`,
      };
    },
  },
  {
    key: "yillik-trend",
    title: "Yıllık hakediş ve ödeme trendi",
    description: "Yılın her ayı için toplam hakediş, bankadan ve elden ödenen, kesinti ve kalan; bölüm filtreli.",
    group: "Maaş ve maliyet",
    params: ["year", "department"],
    roles: PAY,
    async run(sb, p) {
      const [entries, { data: emps }] = await Promise.all([
        fetchAll<{ employee_id: string; period: string; type: string; channel: string; amount: number }>((a, b) =>
          sb.from("ledger_entries").select("employee_id, period, type, channel, amount").gte("period", `${p.year}-01`).lte("period", `${p.year}-12`).is("voided_at", null).range(a, b),
        ),
        sb.from("employees").select("id, departments(name)"),
      ]);
      const dept = new Map((emps ?? []).map((e) => [e.id, (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz"]));
      const m = new Map<string, Record<string, number | string>>();
      for (const e of entries) {
        if (p.department && dept.get(e.employee_id) !== p.department) continue;
        const g = m.get(e.period) ?? { ay: e.period, hakedis: 0, banka: 0, elden: 0, kesinti: 0, kalan: 0 };
        const amt = Number(e.amount);
        if (["ACCRUAL", "BONUS", "OVERTIME"].includes(e.type)) g.hakedis = Number(g.hakedis) + amt;
        else if (["BES", "GARNISHMENT", "DEDUCTION"].includes(e.type)) g.kesinti = Number(g.kesinti) + amt;
        else if (e.channel === "BANK") g.banka = Number(g.banka) + amt;
        else if (e.channel === "CASH") g.elden = Number(g.elden) + amt;
        g.kalan = Number(g.hakedis) - Number(g.banka) - Number(g.elden) - Number(g.kesinti);
        m.set(e.period, g);
      }
      const out = [...m.values()].sort((a, b) => String(a.ay).localeCompare(String(b.ay))).map((g) => ({ ...g, ay: periodLabel(String(g.ay)) }));
      return {
        title: `${p.year} hakediş ve ödeme trendi`, subtitle: p.department ?? "Tüm bölümler",
        columns: [{ key: "ay", label: "Ay", width: 14 }, { key: "hakedis", label: "Hakediş", type: "money" }, { key: "banka", label: "Bankadan", type: "money" }, { key: "elden", label: "Elden", type: "money" }, { key: "kesinti", label: "Kesinti", type: "money" }, { key: "kalan", label: "Kalan", type: "money" }],
        rows: out, totals: { ay: "Toplam", ...sumBy(out, ["hakedis", "banka", "elden", "kesinti", "kalan"]) }, fileName: `yillik-trend-${p.year}`,
      };
    },
  },
  {
    key: "avanslar",
    title: "Avans ve ödeme hareketleri",
    description: "Tarih aralığındaki tüm avans ve maaş ödemeleri; kanal (banka/elden), giren, açıklama.",
    group: "Maaş ve maliyet",
    params: ["dateRange", "department"],
    roles: PAY,
    async run(sb, p) {
      const [entries, { data: emps }] = await Promise.all([
        fetchAll<{ employee_id: string; entry_date: string; period: string; type: string; channel: string; amount: number; note: string | null }>((a, b) =>
          sb.from("ledger_entries").select("employee_id, entry_date, period, type, channel, amount, note").in("type", ["ADVANCE", "SALARY"]).gte("entry_date", p.from).lte("entry_date", p.to).is("voided_at", null).order("entry_date").range(a, b),
        ),
        sb.from("employees").select("id, first_name, last_name, departments(name)"),
      ]);
      const emp = new Map((emps ?? []).map((e) => [e.id, { name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz" }]));
      const out = entries
        .map((e) => ({ tarih: e.entry_date, donem: periodLabel(e.period), bolum: emp.get(e.employee_id)?.dept ?? "", ad: emp.get(e.employee_id)?.name ?? "", tur: e.type === "ADVANCE" ? "Avans" : "Maaş", kanal: e.channel === "BANK" ? "Banka" : "Elden", banka: e.channel === "BANK" ? Number(e.amount) : 0, elden: e.channel === "CASH" ? Number(e.amount) : 0, aciklama: e.note ?? "" }))
        .filter((r) => !p.department || r.bolum === p.department);
      return {
        title: "Avans ve ödeme hareketleri", subtitle: `${p.from.split("-").reverse().join(".")} – ${p.to.split("-").reverse().join(".")}`,
        columns: [{ key: "tarih", label: "Tarih", type: "date" }, { key: "donem", label: "Dönem" }, { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Personel", width: 22 }, { key: "tur", label: "Tür" }, { key: "kanal", label: "Kanal" }, { key: "banka", label: "Banka", type: "money" }, { key: "elden", label: "Elden", type: "money" }, { key: "aciklama", label: "Açıklama", width: 24 }],
        rows: out, totals: { ad: `${out.length} hareket`, ...sumBy(out, ["banka", "elden"]) }, fileName: `avans-odeme-${p.from}-${p.to}`,
      };
    },
  },

  /* ---------------- Zaman ---------------- */
  {
    key: "puantaj-ozet",
    title: "Puantaj özeti",
    description: "Personel başına çalışılan gün ve saat, devamsızlık, geç gelme, erken çıkma, fazla mesai, izin ve rapor günleri.",
    group: "Zaman",
    params: ["period", "department"],
    roles: HR.concat("branch_manager"),
    async run(sb, p) {
      const m = await loadMonth(sb, p.period, { department: p.department });
      const out = m.employees.map((e) => {
        const cs = [...m.cells.get(e.id)!.values()].filter((c) => c.employed);
        return {
          bolum: e.dept, ad: e.name, pdks: e.cardNo ?? "",
          gun: cs.filter((c) => c.workedMin > 0).length, saat: Math.round(cs.reduce((a, c) => a + c.workedMin, 0) / 6) / 10,
          devamsiz: cs.filter((c) => c.status === "ABSENT").length, eksik_okutma: cs.filter((c) => c.status === "INCOMPLETE").length,
          gec: cs.filter((c) => c.lateMin > 0).length, gec_dk: cs.reduce((a, c) => a + c.lateMin, 0), erken_dk: cs.reduce((a, c) => a + c.earlyLeaveMin, 0),
          fm_saat: Math.round(cs.reduce((a, c) => a + c.overtimeMin, 0) / 6) / 10,
          izin: cs.filter((c) => c.leaveCode && c.leaveCode !== "RAPOR").length, rapor: cs.filter((c) => c.leaveCode === "RAPOR").length,
        };
      });
      return {
        title: "Puantaj özeti", subtitle: `${periodLabel(p.period)}${p.department ? ` · ${p.department}` : ""}`,
        columns: [
          { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Personel", width: 22 }, { key: "pdks", label: "PDKS" }, { key: "gun", label: "Çalışılan gün", type: "number" }, { key: "saat", label: "Saat", type: "number" },
          { key: "devamsiz", label: "Devamsız", type: "number" }, { key: "eksik_okutma", label: "Eksik okutma", type: "number" }, { key: "gec", label: "Geç gün", type: "number" }, { key: "gec_dk", label: "Geç dk", type: "number" },
          { key: "erken_dk", label: "Erken dk", type: "number" }, { key: "fm_saat", label: "Vardiya aşımı saat", type: "number" }, { key: "izin", label: "İzin", type: "number" }, { key: "rapor", label: "Rapor", type: "number" },
        ],
        rows: out, totals: { ad: `${out.length} kişi`, ...sumBy(out, ["gun", "saat", "devamsiz", "eksik_okutma", "gec", "gec_dk", "erken_dk", "fm_saat", "izin", "rapor"]) }, fileName: `puantaj-${p.period}`,
      };
    },
  },
  {
    key: "fazla-mesai",
    title: "Fazla mesai raporu",
    description: "Onaylanan fazla mesailer: süre, oran, resmi ve elden tutarlar; personel ve bölüm toplamı.",
    group: "Zaman",
    params: ["period", "department"],
    roles: HR,
    async run(sb, p) {
      const [{ data: recs }, { data: emps }] = await Promise.all([
        sb.from("overtime_records").select("employee_id, work_date, minutes, rate, pay_side, official_gross, official_net, cash_amount, status").eq("period", p.period).eq("status", "approved").order("work_date"),
        sb.from("employees").select("id, first_name, last_name, departments(name)"),
      ]);
      const emp = new Map((emps ?? []).map((e) => [e.id, { name: `${e.first_name} ${e.last_name}`, dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz" }]));
      const side = { OFFICIAL: "Resmi", CASH: "Elden", BOTH: "Resmi + elden" } as Record<string, string>;
      const out = (recs ?? [])
        .map((r) => ({
          tarih: r.work_date, bolum: emp.get(r.employee_id)?.dept ?? "", ad: emp.get(r.employee_id)?.name ?? "", saat: Math.round(r.minutes / 6) / 10, oran: Number(r.rate), odeme: side[r.pay_side] ?? "",
          resmi_brut: r.pay_side === "CASH" ? 0 : Number(r.official_gross ?? 0), resmi_net: r.pay_side === "CASH" ? 0 : Number(r.official_net ?? 0), elden: r.pay_side === "OFFICIAL" ? 0 : Number(r.cash_amount ?? 0),
        }))
        .filter((r) => !p.department || r.bolum === p.department);
      return {
        title: "Fazla mesai raporu", subtitle: periodLabel(p.period),
        columns: [{ key: "tarih", label: "Tarih", type: "date" }, { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Personel", width: 22 }, { key: "saat", label: "Saat", type: "number" }, { key: "oran", label: "Oran", type: "number" }, { key: "odeme", label: "Ödeme" }, { key: "resmi_brut", label: "Resmi brüt", type: "money" }, { key: "resmi_net", label: "Resmi net", type: "money" }, { key: "elden", label: "Elden", type: "money" }],
        rows: out, totals: { ad: `${out.length} kayıt`, ...sumBy(out, ["saat", "resmi_brut", "resmi_net", "elden"]) }, fileName: `fazla-mesai-${p.period}`,
      };
    },
  },
  {
    key: "izin",
    title: "İzin bakiyeleri ve kullanımlar",
    description: "Personel başına kıdem, hak edilen, devreden, kullanılan ve kalan yıllık izin; seçilen yıldaki diğer izin günleri.",
    group: "Zaman",
    params: ["year", "department"],
    roles: HR,
    async run(sb, p) {
      const [{ data: emps }, { data: privs }, { data: adjs }, { data: leaves }] = await Promise.all([
        sb.from("employees").select("id, first_name, last_name, hire_date, departments(name)").eq("status", "active"),
        sb.from("employee_private").select("employee_id, birth_date"),
        sb.from("leave_adjustments").select("employee_id, days"),
        sb.from("leave_requests").select("employee_id, days, start_date, leave_types(code)").eq("status", "approved"),
      ]);
      const birth = new Map((privs ?? []).map((x) => [x.employee_id, x.birth_date as string | null]));
      const today = todayIso();
      const out = (emps ?? [])
        .map((e) => {
          const ent = annualLeaveEntitlement(e.hire_date, today, birth.get(e.id));
          const mine = (leaves ?? []).filter((l) => l.employee_id === e.id);
          const code = (l: (typeof mine)[number]) => (l.leave_types as unknown as { code: string } | null)?.code;
          const inYear = mine.filter((l) => String(l.start_date).startsWith(String(p.year)));
          const used = mine.filter((l) => code(l) === "YILLIK").reduce((a, l) => a + Number(l.days), 0);
          const adj = (adjs ?? []).filter((a) => a.employee_id === e.id).reduce((a, x) => a + Number(x.days), 0);
          return {
            bolum: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz", ad: `${e.first_name} ${e.last_name}`, giris: e.hire_date, kidem: ent.completedYears,
            hak: ent.earned, devreden: adj, kullanilan: used, kalan: ent.earned + adj - used,
            yil_yillik: inYear.filter((l) => code(l) === "YILLIK").reduce((a, l) => a + Number(l.days), 0),
            yil_rapor: inYear.filter((l) => code(l) === "RAPOR").reduce((a, l) => a + Number(l.days), 0),
            yil_ucretsiz: inYear.filter((l) => code(l) === "UCRETSIZ").reduce((a, l) => a + Number(l.days), 0),
            yil_diger: inYear.filter((l) => !["YILLIK", "RAPOR", "UCRETSIZ"].includes(code(l) ?? "")).reduce((a, l) => a + Number(l.days), 0),
          };
        })
        .filter((r) => !p.department || r.bolum === p.department)
        .sort((a, b) => a.bolum.localeCompare(b.bolum, "tr") || a.ad.localeCompare(b.ad, "tr"));
      return {
        title: "İzin bakiyeleri ve kullanımlar", subtitle: `${p.year} yılı kullanımları`,
        columns: [
          { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Personel", width: 22 }, { key: "giris", label: "İşe giriş", type: "date" }, { key: "kidem", label: "Kıdem (yıl)", type: "number" },
          { key: "hak", label: "Hak edilen", type: "number" }, { key: "devreden", label: "Devreden/düzeltme", type: "number" }, { key: "kullanilan", label: "Kullanılan (toplam)", type: "number" }, { key: "kalan", label: "Kalan", type: "number" },
          { key: "yil_yillik", label: `${p.year} yıllık`, type: "number" }, { key: "yil_rapor", label: `${p.year} rapor`, type: "number" }, { key: "yil_ucretsiz", label: `${p.year} ücretsiz`, type: "number" }, { key: "yil_diger", label: `${p.year} diğer`, type: "number" },
        ],
        rows: out, totals: { ad: `${out.length} kişi`, ...sumBy(out, ["hak", "devreden", "kullanilan", "kalan", "yil_yillik", "yil_rapor", "yil_ucretsiz", "yil_diger"]) }, fileName: `izin-${p.year}`,
      };
    },
  },

  /* ---------------- Uyum ---------------- */
  {
    key: "isg-durum",
    title: "İSG eğitim durumu",
    description: "Süresi geçmiş, yaklaşan ve eksik eğitimler; son tarihleriyle.",
    group: "Uyum",
    params: ["department"],
    roles: ["owner", "hr", "safety"],
    async run(sb, p) {
      const d = await loadCompliance(sb, "TRAINING");
      const lvl = { EXPIRED: "Süresi geçti", D7: "7 gün", D15: "15 gün", D30: "30 gün", MISSING: "Eksik" } as Record<string, string>;
      const out = d.alerts.filter((a) => !p.department || a.dept === p.department).map((a) => ({ durum: lvl[a.level], bolum: a.dept, ad: a.name, konu: a.typeName, son: a.expiresOn, gun: a.daysLeft }));
      return { title: "İSG eğitim durumu", subtitle: todayIso().split("-").reverse().join("."), columns: [{ key: "durum", label: "Durum" }, { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Personel", width: 22 }, { key: "konu", label: "Eğitim", width: 28 }, { key: "son", label: "Son tarih", type: "date" }, { key: "gun", label: "Kalan gün", type: "number" }], rows: out, fileName: "isg-durum" };
    },
  },
  {
    key: "saglik-durum",
    title: "Sağlık muayene durumu",
    description: "Süresi geçmiş, yaklaşan ve eksik muayene / tetkikler.",
    group: "Uyum",
    params: ["department"],
    roles: ["owner", "hr", "safety"],
    async run(sb, p) {
      const d = await loadCompliance(sb, "HEALTH");
      const lvl = { EXPIRED: "Süresi geçti", D7: "7 gün", D15: "15 gün", D30: "30 gün", MISSING: "Eksik" } as Record<string, string>;
      const out = d.alerts.filter((a) => !p.department || a.dept === p.department).map((a) => ({ durum: lvl[a.level], bolum: a.dept, ad: a.name, konu: a.typeName, son: a.expiresOn, gun: a.daysLeft }));
      return { title: "Sağlık muayene durumu", subtitle: todayIso().split("-").reverse().join("."), columns: [{ key: "durum", label: "Durum" }, { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Personel", width: 22 }, { key: "konu", label: "Muayene", width: 28 }, { key: "son", label: "Son tarih", type: "date" }, { key: "gun", label: "Kalan gün", type: "number" }], rows: out, fileName: "saglik-durum" };
    },
  },

  /* ---------------- Personel ---------------- */
  {
    key: "personel-listesi",
    title: "Personel listesi",
    description: "Tüm aktif personel: PDKS no, bölüm, görev, işe giriş, kıdem, iletişim, öğrenim, ehliyet; ücret bilgisi yetkiliye.",
    group: "Personel",
    params: ["department"],
    roles: HR,
    async run(sb, p) {
      const [{ data: emps }, { data: privs }] = await Promise.all([
        sb.from("employees").select("id, first_name, last_name, card_no, hire_date, position_title, departments(name), branches(name)").eq("status", "active").order("first_name"),
        sb.from("employee_private").select("employee_id, national_id, sgk_no, birth_date, phone, email, city, education_level, license_class, iban"),
      ]);
      const priv = new Map((privs ?? []).map((x) => [x.employee_id, x]));
      const contracts = await contractsAt(sb, (emps ?? []).map((e) => e.id), todayIso());
      const out = (emps ?? [])
        .map((e) => {
          const x = priv.get(e.id);
          const c = contracts.get(e.id);
          return {
            bolum: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz", ad: e.first_name, soyad: e.last_name, pdks: e.card_no ?? "", gorev: e.position_title ?? "",
            sube: (e.branches as unknown as { name: string } | null)?.name ?? "", giris: e.hire_date, tckn: x?.national_id ?? "", sgk: x?.sgk_no ?? "", dogum: x?.birth_date ?? null,
            telefon: x?.phone ?? "", eposta: x?.email ?? "", il: x?.city ?? "", ogrenim: x?.education_level ?? "", ehliyet: x?.license_class ?? "", iban: x?.iban ?? "",
            ucret: c?.totalNet ?? null, sigorta: c ? (c.insuranceType === "MIN_WAGE" ? "Asgari" : `Net ${formatTL(c.fixedOfficialNet ?? 0)}`) : "",
          };
        })
        .filter((r) => !p.department || r.bolum === p.department)
        .sort((a, b) => a.bolum.localeCompare(b.bolum, "tr") || a.ad.localeCompare(b.ad, "tr"));
      return {
        title: "Personel listesi", subtitle: `${out.length} aktif personel`,
        columns: [
          { key: "bolum", label: "Bölüm" }, { key: "ad", label: "Ad" }, { key: "soyad", label: "Soyad" }, { key: "pdks", label: "PDKS" }, { key: "gorev", label: "Görev" }, { key: "sube", label: "Şube" },
          { key: "giris", label: "İşe giriş", type: "date" }, { key: "tckn", label: "TCKN" }, { key: "sgk", label: "SGK no" }, { key: "dogum", label: "Doğum", type: "date" }, { key: "telefon", label: "Telefon" },
          { key: "eposta", label: "E-posta" }, { key: "il", label: "İl" }, { key: "ogrenim", label: "Öğrenim" }, { key: "ehliyet", label: "Ehliyet" }, { key: "iban", label: "IBAN", width: 30 },
          { key: "ucret", label: "Aylık ücret", type: "money" }, { key: "sigorta", label: "Sigorta" },
        ],
        rows: out, fileName: "personel-listesi",
      };
    },
  },
];

export const findReport = (key: string) => REPORTS.find((r) => r.key === key);

/** Yetkisi olmayan role ücret sütunu gösterilmez */
export function visibleColumns(def: ReportDef, res: ReportResult, role: string): Column[] {
  if (def.key === "personel-listesi" && !PAY.includes(role)) return res.columns.filter((c) => c.key !== "ucret" && c.key !== "sigorta");
  return res.columns;
}

