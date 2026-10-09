import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { addDaysIso, loadLeaveData, returnDate } from "@/lib/annual-leave";
import { logAccess } from "@/lib/kvkk";
import { getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dailyWages, yearsSince } from "../load";

const money = '#,##0.00 "₺"';
const TITLES: Record<string, string> = { bakiye: "Izin bakiyeleri", defter: "Yil yil izin defteri", yukumluluk: "Izin yukumlulugu", aylik: "Aylik dagilim", biriken: "Biriken izin", yaklasan: "Hak edisi yaklasan", kullanmayan: "Izin kullanmayan", plan: "Plan ve gerceklesen", hareket: "Izin hareketleri" };
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const d = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");

/** Yıllık izin raporları (Excel) */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) return new NextResponse("Yetkiniz yok", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const tur = TITLES[sp.get("tur") ?? ""] ? sp.get("tur")! : "bakiye";
  if (["yukumluluk"].includes(tur) && s.role === "branch_manager") return new NextResponse("Yetkiniz yok", { status: 403 });
  const year = Number(sp.get("yil")) || new Date().getFullYear();
  const dept = sp.get("bolum");
  const today = todayIso();
  const supabase = await createClient();
  const data = await loadLeaveData(supabase, today);
  const emps = data.emps.filter((e) => !dept || e.department_id === dept);
  await logAccess(supabase, s.companyId, s.userId, "export", "leave_report", null, tur);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MB Personel & Bordro";
  const ws = wb.addWorksheet(TITLES[tur]!.slice(0, 30));
  const cols = (c: Array<[string, string, number, string?]>) => { ws.columns = c.map(([header, key, width, numFmt]) => ({ header, key, width, style: numFmt ? { numFmt } : {} })); };
  const base = (e: (typeof emps)[number]) => ({ ad: `${e.first_name} ${e.last_name}`, kart: e.card_no ?? "", bolum: e.dept });
  const B: Array<[string, string, number]> = [["Personel", "ad", 24], ["Kart no", "kart", 10], ["Bölüm", "bolum", 18]];

  if (tur === "bakiye" || tur === "biriken" || tur === "yaklasan" || tur === "kullanmayan") {
    cols([...B, ["Kıdem başlangıcı", "kidem", 14], ["Hizmet yılı", "yil", 10], ["Hak edilen", "hak", 11], ["Devir/düzeltme", "devir", 13], ["Kullanılan", "kul", 11], ["Kalan", "kalan", 9], ["En eski açık hak", "eski", 15], ["Sonraki hak ediş", "sonraki", 15], ["Sonraki gün", "sgun", 11], ["Son yıllık izin", "son", 14]]);
    const ago = addDaysIso(today, -365);
    for (const e of emps) {
      const l = data.ledgers.get(e.id);
      if (!l) continue;
      const last = data.rows.filter((r) => r.employee_id === e.id && r.code === "YILLIK" && r.status === "approved").map((r) => r.start_date).sort().pop();
      if (tur === "biriken" && !(l.oldestOpen && l.oldestOpen !== "devir" && yearsSince(l.oldestOpen, today) >= 2)) continue;
      if (tur === "yaklasan" && l.next.date > addDaysIso(today, 90)) continue;
      if (tur === "kullanmayan" && (l.completedYears < 1 || (last && last >= ago))) continue;
      ws.addRow({ ...base(e), kidem: d(l.base), yil: l.completedYears, hak: l.earned, devir: l.adjust, kul: l.used, kalan: l.balance, eski: l.oldestOpen === "devir" ? "devir" : d(l.oldestOpen), sonraki: d(l.next.date), sgun: l.next.days, son: d(last) });
    }
  } else if (tur === "defter") {
    cols([...B, ["Hizmet yılı", "k", 10], ["Hak ediş tarihi", "tarih", 14], ["Yaş", "yas", 7], ["Ötelenen gün", "gap", 12], ["Hak", "hak", 8], ["Kullanılan", "kul", 11], ["Kalan", "kalan", 9]]);
    for (const e of emps) {
      const l = data.ledgers.get(e.id);
      if (!l) continue;
      if (l.adjust) ws.addRow({ ...base(e), k: "Devir", hak: l.opening.days, kul: l.opening.used, kalan: l.opening.left });
      for (const y of l.years) ws.addRow({ ...base(e), k: y.k, tarih: d(y.date), yas: y.age ?? "", gap: y.gapDays || "", hak: y.days, kul: y.used, kalan: y.left });
    }
  } else if (tur === "yukumluluk") {
    const w = await dailyWages(supabase, data, today);
    cols([...B, ["Kalan gün", "kalan", 10], ["Günlük brüt (resmi)", "go", 18, money], ["Tutar (resmi)", "to", 16, money], ["Günlük brüt (gerçek)", "gr", 18, money], ["Tutar (gerçek)", "tr", 16, money]]);
    for (const e of emps) {
      const l = data.ledgers.get(e.id);
      if (!l || l.balance <= 0) continue;
      const x = w.get(e.id);
      ws.addRow({ ...base(e), kalan: l.balance, go: x?.official ?? null, to: x ? x.official * l.balance : null, gr: x?.real ?? null, tr: x ? x.real * l.balance : null });
    }
  } else if (tur === "aylik") {
    cols([["Bölüm", "bolum", 22], ...MONTHS.map((m, i) => [m, `m${i}`, 9] as [string, string, number]), ["Toplam", "top", 10]]);
    const by = new Map<string, number[]>();
    const deptOf = new Map(data.emps.map((e) => [e.id, e.dept]));
    for (const r of data.rows) {
      if (r.status !== "approved" || r.code !== "YILLIK" || !r.start_date.startsWith(String(year))) continue;
      if (dept && !emps.some((e) => e.id === r.employee_id)) continue;
      const k = deptOf.get(r.employee_id) ?? "—";
      if (!by.has(k)) by.set(k, Array(12).fill(0));
      by.get(k)![Number(r.start_date.slice(5, 7)) - 1] += r.days;
    }
    for (const [k, v] of [...by].sort((a, b) => a[0].localeCompare(b[0], "tr"))) ws.addRow({ bolum: k, ...Object.fromEntries(v.map((x, i) => [`m${i}`, x])), top: v.reduce((a, b) => a + b, 0) });
  } else if (tur === "plan") {
    const { data: plans } = await supabase.from("leave_plans").select("employee_id, days, status").eq("year", year);
    cols([...B, ["Planlanan gün", "plan", 13], ["Kullanılan gün", "kul", 13], ["Fark", "fark", 8], ["Kalan bakiye", "kalan", 12]]);
    for (const e of emps) {
      const p = (plans ?? []).filter((x) => x.employee_id === e.id && (x as { status?: string }).status !== "reddedildi" && (x as { status?: string }).status !== "tercih").reduce((a, x) => a + Number(x.days), 0);
      const u = data.rows.filter((r) => r.employee_id === e.id && r.status === "approved" && r.code === "YILLIK" && r.start_date.startsWith(String(year))).reduce((a, r) => a + r.days, 0);
      if (!p && !u) continue;
      ws.addRow({ ...base(e), plan: p, kul: u, fark: u - p, kalan: data.ledgers.get(e.id)?.balance ?? "" });
    }
  } else {
    cols([...B, ["İzin türü", "tur", 20], ["Başlangıç", "bas", 12], ["Bitiş", "bit", 12], ["Gün", "gun", 7], ["İşbaşı", "don", 12], ["Durum", "durum", 12], ["Aşama", "asama", 12], ["Yol izni", "yol", 9], ["Not", "not", 30]]);
    const emp = new Map(emps.map((e) => [e.id, e]));
    for (const r of data.rows) {
      const e = emp.get(r.employee_id);
      if (!e || !r.start_date.startsWith(String(year))) continue;
      ws.addRow({ ...base(e), tur: r.name, bas: d(r.start_date), bit: d(r.end_date), gun: r.days, don: d(returnDate(r.end_date, data.hol, r.travel_days)), durum: r.status === "approved" ? "Onaylı" : "Bekliyor", asama: r.status === "pending" ? (r.stage === "chief" ? "Şef" : "İK") : "", yol: r.travel_days || "", not: r.note ?? "" });
    }
  }
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3D73" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${TITLES[tur]!.replaceAll(" ", "-")}-${year}.xlsx"` } });
}
