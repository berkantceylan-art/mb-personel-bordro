import "server-only";
/**
 * İK asistanı araçları. Her araç kullanıcının KENDİ oturumuyla (RLS) çalışır: personel yalnız kendi verisini,
 * şef yalnız kendi bölümlerini, muhasebe/sahip yetkisi kadarını görür. TC, IBAN gibi alanlar hiçbir araçta dönmez.
 */
import { formatTL } from "@mb/core";
import { loadLeaveData } from "@/lib/annual-leave";
import { MEVZUAT, paramAt } from "@/lib/mevzuat";
import type { createClient } from "@/lib/supabase/server";
import { fetchAll, loadMonth } from "@/lib/timekeeping";

type SB = Awaited<ReturnType<typeof createClient>>;
export type Ctx = { sb: SB; userId: string; companyId: string; role: string; today: string; selfId: string | null; selfName: string | null };
type Tool = { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] }; roles: "self" | "manager" | "pay"; run: (c: Ctx, i: Record<string, string>) => Promise<unknown> };

const MANAGERS = ["owner", "accountant", "hr", "branch_manager", "safety"];
const PAY = ["owner", "accountant"];
const TL = (k: unknown) => formatTL(Math.round(Number(k ?? 0)));
const per = (c: Ctx, p?: string) => (p && /^\d{4}-\d{2}$/.test(p) ? p : c.today.slice(0, 7));
const fmtD = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : null);
const TYPE: Record<string, string> = { ACCRUAL: "Hakediş", BONUS: "Prim / ikramiye", OVERTIME: "Fazla mesai", ADVANCE: "Avans", SALARY: "Maaş ödemesi", BES: "BES kesintisi", GARNISHMENT: "İcra / nafaka kesintisi", DEDUCTION: "Borç / iş kesintisi", ADJUSTMENT: "Düzeltme" };
const periodProp = { donem: { type: "string", description: "Dönem YYYY-AA (ör. 2026-09). Boşsa bu ay." } };
const noSelf = { hata: "Hesabınız bir personel kaydına bağlı değil; kişisel bilgi gösterilemez." };

async function deptMap(c: Ctx) {
  const { data } = await c.sb.from("employees").select("id, first_name, last_name, departments(name)");
  return new Map(((data ?? []) as Array<Record<string, unknown>>).map((e) => [e.id as string, { ad: `${e.first_name} ${e.last_name}`, bolum: (e.departments as { name: string } | null)?.name ?? "Bölümsüz" }]));
}

export const TOOLS: Tool[] = [
  /* ---------------------------------------------------------------- Kişisel */
  {
    name: "izin_bakiyem", roles: "self", description: "Kullanıcının kendi yıllık izin bakiyesi: kalan gün, hak edilen, kullanılan, devir, sonraki hak ediş, yıllara göre döküm ve bekleyen talepler.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      if (!c.selfId) return noSelf;
      const d = await loadLeaveData(c.sb, c.today);
      const l = d.ledgers.get(c.selfId);
      if (!l) return { hata: "İşe giriş tarihi kayıtlı değil; izin hesaplanamıyor." };
      const pend = d.rows.filter((r) => r.employee_id === c.selfId && r.status === "pending").map((r) => ({ tur: r.name, baslangic: fmtD(r.start_date), bitis: fmtD(r.end_date), gun: r.days, asama: r.stage === "chief" ? "şef onayında" : "İK onayında" }));
      return { kalan_gun: l.balance, hak_edilen_toplam: l.earned, devir_duzeltme: l.adjust, kullanilan: l.used, hizmet_yili: l.completedYears, kidem_baslangici: fmtD(l.base), sonraki_hak_edis: { tarih: fmtD(l.next.date), gun: l.next.days }, yillar: l.years.map((y) => ({ yil: y.k, tarih: fmtD(y.date), hak: y.days, kullanilan: y.used, kalan: y.left })), bekleyen_talepler: pend, not: "Cumartesi iş günü, pazar ve resmi tatiller izinden sayılmaz." };
    },
  },
  {
    name: "izinlerim", roles: "self", description: "Kullanıcının kendi izin kayıtları (tüm türler) bir yıl için.",
    input_schema: { type: "object", properties: { yil: { type: "string", description: "Yıl, ör. 2026" } } },
    async run(c, i) {
      if (!c.selfId) return noSelf;
      const y = /^\d{4}$/.test(i.yil ?? "") ? i.yil : c.today.slice(0, 4);
      const { data } = await c.sb.from("leave_requests").select("start_date, end_date, days, status, stage, note, leave_types(name)").eq("employee_id", c.selfId).gte("start_date", `${y}-01-01`).lte("start_date", `${y}-12-31`).order("start_date");
      return (data ?? []).map((r) => ({ tur: (r.leave_types as unknown as { name: string } | null)?.name, baslangic: fmtD(r.start_date), bitis: fmtD(r.end_date), gun: Number(r.days), durum: r.status === "approved" ? "onaylı" : r.status === "pending" ? (r.stage === "chief" ? "şef onayında" : "İK onayında") : r.status === "rejected" ? "reddedildi" : "iptal" }));
    },
  },
  {
    name: "bordrom", roles: "self", description: "Kullanıcının kendi resmi bordrosu: brüt, SGK işçi payı, işsizlik sigortası, gelir vergisi, damga vergisi, istisnalar, BES, icra/nafaka, net ve bankaya yatan; ayrıca o dönemin hesap hareketleri (avans, prim, kesinti). 'Neden kesinti var' sorularında kullan.",
    input_schema: { type: "object", properties: periodProp },
    async run(c, i) {
      if (!c.selfId) return noSelf;
      const p = per(c, i.donem);
      const { data: line } = await c.sb.from("payroll_lines").select("period, days, official_gross, sgk_employee, unemployment_employee, income_tax, stamp_tax, official_net, bes, garnishment, net_to_bank, data").eq("employee_id", c.selfId).eq("period", p).maybeSingle();
      const { data: ent } = await c.sb.from("ledger_entries").select("entry_date, type, channel, amount, note").eq("employee_id", c.selfId).eq("period", p).is("voided_at", null).order("entry_date");
      if (!line) {
        const { data: ps } = await c.sb.from("payroll_lines").select("period").eq("employee_id", c.selfId).order("period", { ascending: false }).limit(6);
        return { donem: p, bordro: null, mesaj: "Bu dönem için bordro henüz hesaplanmamış.", mevcut_donemler: (ps ?? []).map((x) => x.period), hareketler: (ent ?? []).map((e) => ({ tarih: fmtD(e.entry_date), tur: TYPE[e.type] ?? e.type, tutar: TL(e.amount), not: e.note })) };
      }
      const b = ((line.data as { result?: { breakdown?: Record<string, number> } } | null)?.result?.breakdown) ?? {};
      return {
        donem: p, gun: line.days, brut: TL(line.official_gross),
        kesintiler: { sgk_isci_payi: TL(line.sgk_employee), issizlik_sigortasi_isci: TL(line.unemployment_employee), gelir_vergisi: TL(line.income_tax), damga_vergisi: TL(line.stamp_tax), bes: TL(line.bes), icra_nafaka: TL(line.garnishment) },
        istisnalar: { gelir_vergisi_istisnasi: b.incomeTaxExemption ? TL(b.incomeTaxExemption) : null, damga_vergisi_istisnasi: b.stampTaxExemption ? TL(b.stampTaxExemption) : null },
        net: TL(line.official_net), bankaya_yatan: TL(line.net_to_bank),
        hareketler: (ent ?? []).map((e) => ({ tarih: fmtD(e.entry_date), tur: TYPE[e.type] ?? e.type, odeme: e.channel === "BANK" ? "banka" : e.channel === "CASH" ? "elden" : e.channel, tutar: TL(e.amount), not: e.note })),
        bilgi: "SGK işçi payı brütün %14'ü, işsizlik sigortası %1'idir. Asgari ücrete isabet eden gelir ve damga vergisi istisna edilir.",
      };
    },
  },
  {
    name: "hesap_hareketlerim", roles: "self", description: "Kullanıcının kendi hesap özeti: hakediş, bankadan/elden ödenen, kesintiler ve kalan bakiye; tek tek hareketler.",
    input_schema: { type: "object", properties: periodProp },
    async run(c, i) {
      if (!c.selfId) return noSelf;
      const p = per(c, i.donem);
      const [{ data: sum }, { data: ent }] = await Promise.all([
        c.sb.from("ledger_period_summary").select("accrued, paid_bank, paid_cash, deductions, balance").eq("employee_id", c.selfId).eq("period", p).maybeSingle(),
        c.sb.from("ledger_entries").select("entry_date, type, channel, amount, note").eq("employee_id", c.selfId).eq("period", p).is("voided_at", null).order("entry_date"),
      ]);
      return { donem: p, ozet: sum ? { hakedis: TL(sum.accrued), bankadan_odenen: TL(sum.paid_bank), elden_odenen: TL(sum.paid_cash), kesintiler: TL(sum.deductions), kalan_alacak: TL(sum.balance) } : null, hareketler: (ent ?? []).map((e) => ({ tarih: fmtD(e.entry_date), tur: TYPE[e.type] ?? e.type, tutar: TL(e.amount), not: e.note })) };
    },
  },
  {
    name: "puantajim", roles: "self", description: "Kullanıcının kendi puantajı: çalışılan gün, devamsızlık, geç kalma, eksik okutma, fazla mesai.",
    input_schema: { type: "object", properties: periodProp },
    async run(c, i) {
      if (!c.selfId) return noSelf;
      const p = per(c, i.donem);
      const m = await loadMonth(c.sb, p);
      const row = m.cells.get(c.selfId);
      if (!row) return { donem: p, mesaj: "Puantaj kaydı bulunamadı." };
      const cells = [...row.entries()];
      const absent = cells.filter(([, x]) => x.status === "ABSENT").map(([d]) => fmtD(d));
      const late = cells.filter(([, x]) => (x.lateMin ?? 0) > 0).map(([d, x]) => `${fmtD(d)} (${x.lateMin} dk)`);
      const missing = m.anomalies.filter((a) => a.employeeId === c.selfId && (a.kind === "MISSING_IN" || a.kind === "MISSING_OUT")).map((a) => `${fmtD(a.at)} ${a.kind === "MISSING_IN" ? "giriş" : "çıkış"}`);
      const { data: ot } = await c.sb.from("overtime_records").select("work_date, minutes, status").eq("employee_id", c.selfId).eq("period", p);
      return { donem: p, calisilan_gun: cells.filter(([, x]) => (x.workedMin ?? 0) > 0).length, devamsiz_gunler: absent, gec_kalmalar: late, eksik_okutmalar: missing, fazla_mesai: (ot ?? []).map((o) => ({ tarih: fmtD(o.work_date), saat: Math.round(o.minutes / 6) / 10, durum: o.status === "approved" ? "onaylı" : o.status === "pending" ? "bekliyor" : "reddedildi" })) };
    },
  },
  {
    name: "vardiyam", roles: "self", description: "Kullanıcının önümüzdeki günlerdeki vardiyası ve resmi tatiller.",
    input_schema: { type: "object", properties: { gun: { type: "string", description: "Kaç gün ileri (en çok 31)" } } },
    async run(c, i) {
      if (!c.selfId) return noSelf;
      const n = Math.min(31, Math.max(1, Number(i.gun) || 7));
      const end = new Date(Date.parse(c.today) + n * 86_400_000).toISOString().slice(0, 10);
      const [{ data: emp }, { data: shifts }, { data: asg }, { data: hol }] = await Promise.all([
        c.sb.from("employees").select("default_shift_id").eq("id", c.selfId).maybeSingle(),
        c.sb.from("shifts").select("id, name, start_time, end_time"),
        c.sb.from("shift_assignments").select("work_date, shift_id, day_type").eq("employee_id", c.selfId).gte("work_date", c.today).lte("work_date", end).order("work_date"),
        c.sb.from("public_holidays").select("date, name").gte("date", c.today).lte("date", end),
      ]);
      const sh = new Map((shifts ?? []).map((s) => [s.id, `${s.name} ${String(s.start_time).slice(0, 5)}–${String(s.end_time).slice(0, 5)}`]));
      return { varsayilan_vardiya: emp?.default_shift_id ? sh.get(emp.default_shift_id) : null, atamalar: (asg ?? []).map((a) => ({ tarih: fmtD(a.work_date), vardiya: a.shift_id ? sh.get(a.shift_id) : null, gun_turu: a.day_type })), resmi_tatiller: (hol ?? []).map((h) => ({ tarih: fmtD(h.date), ad: h.name })) };
    },
  },
  {
    name: "taleplerim", roles: "self", description: "Kullanıcının bekleyen ve son talepleri: avans, izin, okutma düzeltme.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      if (!c.selfId) return noSelf;
      const [{ data: adv }, { data: lv }, { data: pr }] = await Promise.all([
        c.sb.from("advance_requests").select("amount, status, created_at, decision_note").eq("employee_id", c.selfId).order("created_at", { ascending: false }).limit(5),
        c.sb.from("leave_requests").select("start_date, days, status, stage, leave_types(name)").eq("employee_id", c.selfId).eq("status", "pending"),
        c.sb.from("punch_requests").select("on_date, direction, status").eq("employee_id", c.selfId).order("on_date", { ascending: false }).limit(5),
      ]);
      return { avans: (adv ?? []).map((a) => ({ tutar: TL(a.amount), durum: a.status, tarih: fmtD(a.created_at), not: a.decision_note })), bekleyen_izinler: (lv ?? []).map((l) => ({ tur: (l.leave_types as unknown as { name: string } | null)?.name, baslangic: fmtD(l.start_date), gun: Number(l.days), asama: l.stage === "chief" ? "şef" : "İK" })), okutma_duzeltme: (pr ?? []).map((p) => ({ tarih: fmtD(p.on_date), yon: p.direction === "IN" ? "giriş" : "çıkış", durum: p.status })) };
    },
  },
  {
    name: "genel_bilgi", roles: "self", description: "Genel bilgiler: güncel asgari ücret, kıdem tazminatı tavanı, maaş ödeme günü, yaklaşan resmi tatiller, yasal izin kuralları.",
    input_schema: { type: "object", properties: {} },
    async run(c) {
      const [{ data: comp }, { data: hol }] = await Promise.all([
        c.sb.from("companies").select("salary_pay_day").limit(1).maybeSingle(),
        c.sb.from("public_holidays").select("date, name, half_day").gte("date", c.today).order("date").limit(8),
      ]);
      const val = (k: string[]) => { const x = paramAt(k, c.today); return x ? { deger: x.value, birim: x.unit, gecerlilik: fmtD(x.valid_from) } : null; };
      return {
        maas_odeme_gunu: comp?.salary_pay_day ?? null,
        asgari_ucret_brut: val(["minWageGross"]), asgari_ucret_net: val(["minWageNet"]), kidem_tavani: val(["severanceCap", "severanceCapPrev"]), yemek_istisnasi_gunluk: val(["mealExemption"]), yillik_fazla_mesai_siniri: val(["yearlyOvertimeHours"]),
        yaklasan_tatiller: (hol ?? []).map((h) => ({ tarih: fmtD(h.date), ad: h.name, yarim_gun: h.half_day })),
        izin_kurallari: "Yıllık izin: 1-5 yıl 14, 5-15 yıl 20, 15+ yıl 26 iş günü; 18 yaş altı ve 50 yaş üstüne en az 20 gün. Evlilik 3, ölüm 3, babalık 10 gün ücretli izin.",
        mevzuat_son_kontrol: MEVZUAT.last_checked,
      };
    },
  },

  /* ---------------------------------------------------------------- Yönetici (RLS kapsamı kadar) */
  {
    name: "personel_bul", roles: "manager", description: "Görme yetkiniz olan personeli adına göre bulur (id, bölüm, işe giriş, durum). Diğer araçlar için personel_id buradan alınır.",
    input_schema: { type: "object", properties: { ad: { type: "string", description: "Ad veya soyad" } }, required: ["ad"] },
    async run(c, i) {
      const q = (i.ad ?? "").trim();
      if (q.length < 2) return { hata: "En az 2 harf yazın." };
      const { data } = await c.sb.from("employees").select("id, first_name, last_name, hire_date, status, position_title, departments(name)").or(`first_name.ilike.%${q.replace(/[,()]/g, "")}%,last_name.ilike.%${q.replace(/[,()]/g, "")}%`).limit(10);
      return (data ?? []).map((e) => ({ personel_id: e.id, ad: `${e.first_name} ${e.last_name}`, bolum: (e.departments as unknown as { name: string } | null)?.name, gorev: e.position_title, ise_giris: fmtD(e.hire_date), durum: e.status === "active" ? "aktif" : e.status }));
    },
  },
  {
    name: "personel_ozeti", roles: "manager", description: "Bir personelin özeti: izin bakiyesi, bu ay devamsızlık ve geç kalma, bu yıl fazla mesai saati, bekleyen talepler.",
    input_schema: { type: "object", properties: { personel_id: { type: "string" } }, required: ["personel_id"] },
    async run(c, i) {
      const id = i.personel_id;
      const { data: e } = await c.sb.from("employees").select("id, first_name, last_name, hire_date, departments(name)").eq("id", id).maybeSingle();
      if (!e) return { hata: "Bu personeli görme yetkiniz yok veya bulunamadı." };
      const [d, m, { data: ot }, { data: pend }] = await Promise.all([
        loadLeaveData(c.sb, c.today), loadMonth(c.sb, c.today.slice(0, 7)),
        c.sb.from("overtime_records").select("minutes").eq("employee_id", id).eq("status", "approved").gte("work_date", `${c.today.slice(0, 4)}-01-01`),
        c.sb.from("leave_requests").select("start_date, days, leave_types(name)").eq("employee_id", id).eq("status", "pending"),
      ]);
      const l = d.ledgers.get(id);
      const row = m.cells.get(id);
      return { ad: `${e.first_name} ${e.last_name}`, bolum: (e.departments as unknown as { name: string } | null)?.name, ise_giris: fmtD(e.hire_date), izin_kalan: l?.balance ?? null, sonraki_hak_edis: l ? fmtD(l.next.date) : null, bu_ay_devamsiz: row ? [...row.values()].filter((x) => x.status === "ABSENT").length : null, bu_ay_gec_kalma: row ? [...row.values()].filter((x) => (x.lateMin ?? 0) > 0).length : null, bu_yil_fazla_mesai_saat: Math.round((ot ?? []).reduce((a, x) => a + x.minutes, 0) / 6) / 10, bekleyen_izin: (pend ?? []).map((p) => ({ tur: (p.leave_types as unknown as { name: string } | null)?.name, baslangic: fmtD(p.start_date), gun: Number(p.days) })) };
    },
  },
  {
    name: "fazla_mesai_raporu", roles: "manager", description: "Bir dönemde onaylı fazla mesai: bölüme veya personele göre toplam saat (yetkiye göre tutar). 'En çok fazla mesai yapan bölüm/kişi' soruları için.",
    input_schema: { type: "object", properties: { ...periodProp, gruplama: { type: "string", enum: ["bolum", "personel"] } } },
    async run(c, i) {
      const p = per(c, i.donem);
      const rows = await fetchAll<{ employee_id: string; minutes: number; amount: number | null; status: string }>((a, b) => c.sb.from("overtime_records").select("employee_id, minutes, amount, status").eq("period", p).range(a, b));
      const dm = await deptMap(c);
      const g = new Map<string, { saat: number; tutar: number; kisi: Set<string> }>();
      for (const r of rows.filter((x) => x.status === "approved")) {
        const k = i.gruplama === "personel" ? dm.get(r.employee_id)?.ad ?? "?" : dm.get(r.employee_id)?.bolum ?? "Bölümsüz";
        const x = g.get(k) ?? { saat: 0, tutar: 0, kisi: new Set() };
        x.saat += r.minutes / 60; x.tutar += Number(r.amount ?? 0); x.kisi.add(r.employee_id); g.set(k, x);
      }
      const pay = PAY.includes(c.role);
      return { donem: p, bekleyen_kayit: rows.filter((x) => x.status === "pending").length, sirali: [...g.entries()].sort((a, b) => b[1].saat - a[1].saat).map(([k, x]) => ({ [i.gruplama === "personel" ? "personel" : "bolum"]: k, saat: Math.round(x.saat * 10) / 10, kisi: x.kisi.size, ...(pay ? { tutar: TL(x.tutar) } : {}) })) };
    },
  },
  {
    name: "devamsizlik_raporu", roles: "manager", description: "Bir dönemde bölümlere ve kişilere göre devamsızlık, geç kalma ve eksik okutma sayıları.",
    input_schema: { type: "object", properties: periodProp },
    async run(c, i) {
      const p = per(c, i.donem);
      const m = await loadMonth(c.sb, p);
      const by = new Map<string, { devamsiz: number; gec: number }>();
      const people: Array<{ ad: string; bolum: string; devamsiz: number; gec: number }> = [];
      for (const e of m.employees) {
        const row = m.cells.get(e.id);
        if (!row) continue;
        const ab = [...row.values()].filter((x) => x.status === "ABSENT").length;
        const lt = [...row.values()].filter((x) => (x.lateMin ?? 0) > 0).length;
        const x = by.get(e.dept) ?? { devamsiz: 0, gec: 0 }; x.devamsiz += ab; x.gec += lt; by.set(e.dept, x);
        if (ab || lt) people.push({ ad: e.name, bolum: e.dept, devamsiz: ab, gec: lt });
      }
      return { donem: p, bolumler: [...by.entries()].map(([b, x]) => ({ bolum: b, ...x })).sort((a, b) => b.devamsiz - a.devamsiz), en_cok: people.sort((a, b) => b.devamsiz - a.devamsiz || b.gec - a.gec).slice(0, 10), eksik_okutma: m.anomalies.filter((a) => a.kind === "MISSING_IN" || a.kind === "MISSING_OUT").length };
    },
  },
  {
    name: "izin_durumu", roles: "manager", description: "Belirli bir günde izinde olanlar ve onay bekleyen izin talepleri.",
    input_schema: { type: "object", properties: { tarih: { type: "string", description: "YYYY-AA-GG, boşsa bugün" } } },
    async run(c, i) {
      const t = /^\d{4}-\d{2}-\d{2}$/.test(i.tarih ?? "") ? i.tarih : c.today;
      const dm = await deptMap(c);
      const { data } = await c.sb.from("leave_requests").select("employee_id, start_date, end_date, days, status, stage, leave_types(name)").in("status", ["approved", "pending"]).lte("start_date", t).gte("end_date", t);
      const { data: pend } = await c.sb.from("leave_requests").select("employee_id, start_date, days, stage, leave_types(name)").eq("status", "pending").order("start_date").limit(30);
      return { tarih: fmtD(t), izinde: (data ?? []).filter((x) => x.status === "approved").map((x) => ({ ad: dm.get(x.employee_id)?.ad, bolum: dm.get(x.employee_id)?.bolum, tur: (x.leave_types as unknown as { name: string } | null)?.name, bitis: fmtD(x.end_date) })), onay_bekleyen: (pend ?? []).map((x) => ({ ad: dm.get(x.employee_id)?.ad, tur: (x.leave_types as unknown as { name: string } | null)?.name, baslangic: fmtD(x.start_date), gun: Number(x.days), asama: x.stage === "chief" ? "şef" : "İK" })) };
    },
  },
  {
    name: "izin_bakiye_raporu", roles: "manager", description: "Yıllık izin bakiyeleri: en çok izni biriken personel ve bölüm toplamları.",
    input_schema: { type: "object", properties: { bolum: { type: "string", description: "Bölüm adı (isteğe bağlı)" } } },
    async run(c, i) {
      const d = await loadLeaveData(c.sb, c.today);
      const list = d.emps.filter((e) => !i.bolum || e.dept.toLocaleLowerCase("tr").includes(i.bolum.toLocaleLowerCase("tr"))).map((e) => ({ ad: `${e.first_name} ${e.last_name}`, bolum: e.dept, kalan: d.ledgers.get(e.id)?.balance ?? 0 }));
      const dept = new Map<string, number>();
      for (const x of list) dept.set(x.bolum, (dept.get(x.bolum) ?? 0) + x.kalan);
      return { toplam_kalan_gun: Math.round(list.reduce((a, x) => a + x.kalan, 0) * 10) / 10, en_cok: list.sort((a, b) => b.kalan - a.kalan).slice(0, 10), bolumler: [...dept.entries()].map(([b, g]) => ({ bolum: b, kalan: Math.round(g * 10) / 10 })).sort((a, b) => b.kalan - a.kalan), uyari: "Geçmiş izin kullanımı girilmemiş personelde bakiye yüksek görünebilir." };
    },
  },
  {
    name: "personel_sayilari", roles: "manager", description: "Bölümlere göre aktif personel sayısı ve bir dönemde işe girenler / ayrılanlar.",
    input_schema: { type: "object", properties: periodProp },
    async run(c, i) {
      const p = per(c, i.donem);
      const { data } = await c.sb.from("employees").select("first_name, last_name, status, hire_date, termination_date, departments(name)");
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const dept = new Map<string, number>();
      for (const e of rows.filter((x) => x.status !== "terminated")) { const b = (e.departments as { name: string } | null)?.name ?? "Bölümsüz"; dept.set(b, (dept.get(b) ?? 0) + 1); }
      const nm = (e: Record<string, unknown>) => `${e.first_name} ${e.last_name}`;
      return { donem: p, aktif_toplam: rows.filter((x) => x.status !== "terminated").length, bolumler: [...dept.entries()].map(([b, n]) => ({ bolum: b, kisi: n })).sort((a, b) => b.kisi - a.kisi), ise_girenler: rows.filter((e) => String(e.hire_date ?? "").startsWith(p)).map(nm), ayrilanlar: rows.filter((e) => String(e.termination_date ?? "").startsWith(p)).map(nm) };
    },
  },
  {
    name: "bordro_raporu", roles: "pay", description: "Bir dönemin bordro toplamları bölümlere göre: brüt, net, bankaya yatan, işveren maliyeti (yalnız sahip ve muhasebe).",
    input_schema: { type: "object", properties: periodProp },
    async run(c, i) {
      const p = per(c, i.donem);
      const rows = await fetchAll<Record<string, number | string>>((a, b) => c.sb.from("payroll_lines").select("employee_id, official_gross, official_net, net_to_bank, employer_cost").eq("period", p).range(a, b));
      if (!rows.length) return { donem: p, mesaj: "Bu dönem bordro hesaplanmamış." };
      const dm = await deptMap(c);
      const g = new Map<string, { brut: number; net: number; banka: number; maliyet: number; kisi: number }>();
      for (const r of rows) { const b = dm.get(String(r.employee_id))?.bolum ?? "Bölümsüz"; const x = g.get(b) ?? { brut: 0, net: 0, banka: 0, maliyet: 0, kisi: 0 }; x.brut += Number(r.official_gross); x.net += Number(r.official_net); x.banka += Number(r.net_to_bank); x.maliyet += Number(r.employer_cost); x.kisi++; g.set(b, x); }
      const tot = [...g.values()].reduce((a, x) => ({ brut: a.brut + x.brut, net: a.net + x.net, banka: a.banka + x.banka, maliyet: a.maliyet + x.maliyet, kisi: a.kisi + x.kisi }), { brut: 0, net: 0, banka: 0, maliyet: 0, kisi: 0 });
      return { donem: p, toplam: { kisi: tot.kisi, brut: TL(tot.brut), net: TL(tot.net), bankaya: TL(tot.banka), isveren_maliyeti: TL(tot.maliyet) }, bolumler: [...g.entries()].sort((a, b) => b[1].maliyet - a[1].maliyet).map(([b, x]) => ({ bolum: b, kisi: x.kisi, brut: TL(x.brut), isveren_maliyeti: TL(x.maliyet) })), not: "Resmi bordro tutarlarıdır; elden ödemeler dahil değildir." };
    },
  },
];

export function toolsFor(role: string, hasSelf: boolean) {
  return TOOLS.filter((t) => (t.roles === "self" ? hasSelf || t.name === "genel_bilgi" : t.roles === "manager" ? MANAGERS.includes(role) : PAY.includes(role)));
}
