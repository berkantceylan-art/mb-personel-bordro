import Link from "next/link";
import { formatTL } from "@mb/core";
import { loadMoney, type MoneyData } from "@/lib/boss";
import { fetchAll } from "@/lib/timekeeping";
import type { createClient } from "@/lib/supabase/server";
import { PnlChart, type PnlPoint } from "./PnlChart";

type SB = Awaited<ReturnType<typeof createClient>>;
type Series = { b: string; lab: number; lab_fx?: number; inc: number; exp: number; mat: number };
type Part = { lab: number; lab_fx?: number; lab_fx_eur?: number; jobs_tr?: number; jobs_fx?: number; inc: number; exp: number; mat: number };
type Pnl = {
  from: string; to: string; prev_from: string; prev_to: string; bucket: "day" | "month"; basis: string; series: Series[]; totals: Part; prev: Part;
  income_by: Array<{ code: string; name: string; try: number }>; expense_by: Array<{ code: string; name: string; try: number; prev: number }>; suppliers: Array<{ name: string; try: number }>;
};
export type PnlParams = { gorunum?: string; aralik?: string; esas?: string };

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_L = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addD = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dim = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

function rangeOf(today: string, p: PnlParams) {
  const month = p.gorunum === "ay";
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (month) {
    const key = ["son-12", "bu-yil", "gecen-yil"].includes(p.aralik ?? "") ? p.aralik! : "son-12";
    if (key === "bu-yil") return { key, from: `${y}-01-01`, to: today, label: `${y}` };
    if (key === "gecen-yil") return { key, from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    const f = new Date(Date.UTC(y, m - 12, 1));
    return { key, from: iso(f), to: today, label: "Son 12 ay" };
  }
  const key = ["bu-ay", "gecen-ay", "son-30", "bu-hafta", "bugun"].includes(p.aralik ?? "") ? p.aralik! : "bu-ay";
  if (key === "gecen-ay") { const f = new Date(Date.UTC(y, m - 2, 1)); const t = new Date(Date.UTC(y, m - 1, 0)); return { key, from: iso(f), to: iso(t), label: `${MONTHS_L[f.getUTCMonth()]} ${f.getUTCFullYear()}` }; }
  if (key === "son-30") return { key, from: addD(today, -29), to: today, label: "Son 30 gün" };
  if (key === "bu-hafta") { const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; return { key, from: addD(today, -wd), to: today, label: "Bu hafta" }; }
  if (key === "bugun") return { key, from: today, to: today, label: "Bugün" };
  return { key, from: `${today.slice(0, 7)}-01`, to: today, label: `${MONTHS_L[m - 1]} ${y}` };
}

/** [from, to] aralığına düşen bordro maliyeti (aylık maliyet gün sayısına göre paylaştırılır) */
function payrollIn(from: string, to: string, money: Map<string, { totalCost: number }>) {
  let total = 0;
  const byDay = (d: string) => (money.get(d.slice(0, 7))?.totalCost ?? 0) / dim(d.slice(0, 7));
  for (let d = from; d <= to; d = addD(d, 1)) total += byDay(d);
  return Math.round(total);
}

export async function PnlTab({ sb, today, p, base }: { sb: SB; today: string; p: PnlParams; base: string }) {
  const r = rangeOf(today, p);
  const monthView = p.gorunum === "ay";
  const basis = p.esas === "giris" ? "in" : "delivered";
  const to = r.to > today ? today : r.to;
  const [{ data, error }, { data: tdata }] = await Promise.all([
    sb.rpc("boss_pnl", { p_from: r.from, p_to: to, p_bucket: monthView ? "month" : "day", p_basis: basis }),
    sb.rpc("boss_pnl", { p_from: today, p_to: today, p_bucket: "day", p_basis: basis }),
  ]);
  if (error) {
    return <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">{/boss_pnl|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270229000000_boss_pnl.sql çalıştırılmalı." : /not_allowed/.test(error.message) ? "Bu ekran için yetkiniz yok." : error.message}</p>;
  }
  const v = data as Pnl;
  const tv = tdata as Pnl | null;

  // bordro: aralığa ve önceki aralığa değen aylar
  const periods = new Set<string>();
  for (let d = v.prev_from; d <= to; d = addD(d, 27)) periods.add(d.slice(0, 7));
  periods.add(to.slice(0, 7)); periods.add(v.prev_to.slice(0, 7));
  const money = new Map<string, { totalCost: number; people?: number }>();
  let estimated = false;
  if (periods.size <= 4) {
    // günlük görünüm: her ay bordrodan tam hesap
    await Promise.all([...periods].map(async (pr) => { try { money.set(pr, await loadMoney(sb, pr)); } catch { /* bordro yoksa 0 */ } }));
  } else {
    // aylık görünüm: son ay tam hesap; diğer aylar net hakedişten (son ayın SGK + vergi oranıyla)
    const last = to.slice(0, 7);
    let factor = 1;
    try {
      const m = await loadMoney(sb, last);
      money.set(last, m);
      factor = m.netAccrued > 0 ? m.totalCost / m.netAccrued : 1;
    } catch { /* bordro yoksa 0 */ }
    const rows = await fetchAll<{ period: string; accrued: number | null }>((a, b) => sb.from("ledger_period_summary").select("period, accrued").in("period", [...periods].filter((x) => x !== last)).order("employee_id").order("period").range(a, b));
    const acc = new Map<string, number>();
    for (const x of rows) acc.set(x.period, (acc.get(x.period) ?? 0) + Number(x.accrued ?? 0));
    for (const [pr, a] of acc) money.set(pr, { totalCost: Math.round(a * factor) });
    estimated = acc.size > 0;
  }

  const series: PnlPoint[] = v.series.map((s) => {
    const bTo = monthView ? (() => { const e = `${s.b.slice(0, 7)}-${String(dim(s.b.slice(0, 7))).padStart(2, "0")}`; return e > to ? to : e; })() : s.b;
    const bFrom = monthView && s.b < v.from ? v.from : s.b;
    const staff = payrollIn(bFrom, bTo, money);
    const income = Number(s.lab) + Number(s.inc);
    const expense = Number(s.exp) + Number(s.mat) + staff;
    const label = monthView ? `${MONTHS[Number(s.b.slice(5, 7)) - 1]}${s.b.slice(2, 4) !== today.slice(2, 4) ? ` ${s.b.slice(2, 4)}` : ""}` : `${Number(s.b.slice(8, 10))}`;
    const title = monthView ? `${MONTHS_L[Number(s.b.slice(5, 7)) - 1]} ${s.b.slice(0, 4)}` : `${Number(s.b.slice(8, 10))} ${MONTHS_L[Number(s.b.slice(5, 7)) - 1]} ${s.b.slice(0, 4)}`;
    return { b: s.b, label, title, income, expense, net: income - expense, today: monthView ? s.b.slice(0, 7) === today.slice(0, 7) : s.b === today };
  });

  const staff = payrollIn(v.from, to, money);
  const staffPrev = payrollIn(v.prev_from, v.prev_to, money);
  const T = { lab: Number(v.totals.lab), inc: Number(v.totals.inc), exp: Number(v.totals.exp), mat: Number(v.totals.mat) };
  const P = { lab: Number(v.prev.lab), inc: Number(v.prev.inc), exp: Number(v.prev.exp), mat: Number(v.prev.mat) };
  const income = T.lab + T.inc, incomePrev = P.lab + P.inc;
  const labFx = Number(v.totals.lab_fx ?? 0), labFxEur = Number(v.totals.lab_fx_eur ?? 0), jobsTr = Number(v.totals.jobs_tr ?? 0), jobsFx = Number(v.totals.jobs_fx ?? 0);
  const expense = T.exp + T.mat + staff, expensePrev = P.exp + P.mat + staffPrev;
  const net = income - expense, netPrev = incomePrev - expensePrev;
  const margin = income ? Math.round((net / income) * 1000) / 10 : null;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(v.from)) / 86400000) + 1);
  const breakEven = Math.round(expense / days);
  const avgIncome = Math.round(income / days);

  // ay sonu tahmini (bu ay görünümünde)
  let forecast: { income: number; expense: number; net: number } | null = null;
  if (!monthView && r.key === "bu-ay") {
    const d = Number(today.slice(8, 10)), D = dim(today.slice(0, 7));
    const fullStaff = money.get(today.slice(0, 7))?.totalCost ?? 0;
    const fi = Math.round((income / d) * D), fe = Math.round(((T.exp + T.mat) / d) * D + fullStaff);
    forecast = { income: fi, expense: fe, net: fi - fe };
  }

  // bugün
  const staffToday = payrollIn(today, today, money);
  const tIncome = tv ? Number(tv.totals.lab) + Number(tv.totals.inc) : 0;
  const tExpense = tv ? Number(tv.totals.exp) + Number(tv.totals.mat) + staffToday : staffToday;

  // dağılımlar
  const m0 = money.get(to.slice(0, 7)) as MoneyData | undefined;
  const expenseRows: Array<{ key: string; name: string; v: number; prev: number; sub?: string }> = [
    ...(staff ? [{ key: "staff", name: "Personel (bordro: net + SGK + vergi)", v: staff, prev: staffPrev, sub: m0 ? `${m0.people} kişi` : undefined }] : []),
    ...(T.mat || P.mat ? [{ key: "mat", name: "Malzeme tüketimi (stoktan)", v: T.mat, prev: P.mat }] : []),
    ...v.expense_by.map((e) => ({ key: e.code, name: e.name, v: Number(e.try), prev: Number(e.prev) })),
  ].filter((x) => x.v > 0 || x.prev > 0).sort((a, b) => b.v - a.v);
  const incomeRows = [
    ...(T.lab - labFx ? [{ key: "lab", name: `Yerli işler (${basis === "in" ? "iş girişi" : "teslim"})`, v: T.lab - labFx }] : []),
    ...(labFx ? [{ key: "labfx", name: `Yabancı işler${labFxEur ? ` · ${(labFxEur / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} €` : ""}`, v: labFx }] : []),
    ...v.income_by.map((e) => ({ key: e.code, name: e.name, v: Number(e.try) })),
  ].filter((x) => x.v !== 0).sort((a, b) => b.v - a.v);
  const maxRow = Math.max(1, ...expenseRows.map((x) => x.v), ...incomeRows.map((x) => x.v));
  const rising = expenseRows.filter((x) => x.prev > 0 && x.v > x.prev * 1.2 && x.v - x.prev > 50000).sort((a, b) => (b.v - b.prev) - (a.v - a.prev))[0];

  const q = (over: Partial<PnlParams>) => {
    const m = { gorunum: p.gorunum, aralik: r.key, esas: p.esas, ...over };
    const s = Object.entries(m).filter(([, x]) => x).map(([k, x]) => `${k}=${encodeURIComponent(String(x))}`).join("&");
    return `${base}${base.includes("?") ? "&" : "?"}${s}`;
  };
  const chip = (key: string, text: string) => <Link key={key} href={q({ aralik: key })} className={`h-9 px-3.5 rounded-full grid place-items-center text-[13px] font-semibold whitespace-nowrap transition ${r.key === key ? "bg-[#0B1F3A] text-white shadow" : "bg-white border border-line text-[#33414F] hover:border-brand-600"}`}>{text}</Link>;
  const Delta = ({ now, before, inverse }: { now: number; before: number; inverse?: boolean }) => {
    const c = pct(now, before);
    if (c == null) return <span className="text-[11px] text-white/60">önceki dönem yok</span>;
    const good = inverse ? c <= 0 : c >= 0;
    return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${good ? "bg-[#1BAF7A]/20 text-[#8FE3B8]" : "bg-[#D64545]/25 text-[#FFB4B4]"}`}>{c >= 0 ? "▲" : "▼"} %{Math.abs(c).toLocaleString("tr-TR")}</span>;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Kontroller */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-2 p-1 rounded-full bg-white border border-line">
          <Link href={q({ gorunum: undefined, aralik: undefined })} className={`h-8 px-4 rounded-full grid place-items-center text-[13px] font-semibold ${!monthView ? "bg-brand-800 text-white" : "text-brand-700"}`}>Günlük</Link>
          <Link href={q({ gorunum: "ay", aralik: undefined })} className={`h-8 px-4 rounded-full grid place-items-center text-[13px] font-semibold ${monthView ? "bg-brand-800 text-white" : "text-brand-700"}`}>Aylık</Link>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {monthView ? [chip("son-12", "Son 12 ay"), chip("bu-yil", "Bu yıl"), chip("gecen-yil", "Geçen yıl")]
            : [chip("bugun", "Bugün"), chip("bu-hafta", "Bu hafta"), chip("bu-ay", "Bu ay"), chip("son-30", "Son 30 gün"), chip("gecen-ay", "Geçen ay")]}
        </div>
        <div className="ml-auto flex items-center gap-1 text-[12px]">
          <span className="text-muted">Ciro esası:</span>
          <Link href={q({ esas: undefined })} className={`px-2.5 py-1 rounded-full font-semibold ${basis === "delivered" ? "bg-[#E7F1FB] text-brand-700" : "text-muted"}`}>Teslim</Link>
          <Link href={q({ esas: "giris" })} className={`px-2.5 py-1 rounded-full font-semibold ${basis === "in" ? "bg-[#E7F1FB] text-brand-700" : "text-muted"}`}>İş girişi</Link>
        </div>
      </div>

      {/* Ana kart */}
      <section className="relative overflow-hidden rounded-[20px] p-5 md:p-6 text-white bg-[radial-gradient(120%_140%_at_0%_0%,#1E4C86_0%,#0B1F3A_55%,#07142A_100%)] shadow-[0_10px_30px_-12px_rgba(11,31,58,0.6)]">
        <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-[#2a78d6]/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[12px] uppercase tracking-[0.14em] text-white/60">Net kâr / zarar · {r.label}</div>
            <div className={`mt-1 text-[40px] md:text-[48px] leading-none font-bold tabular-nums ${net < 0 ? "text-[#FF9C9C]" : ""}`}>{formatTL(net)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/80">
              <Delta now={net} before={netPrev} />
              {margin != null && <span>Kâr marjı <b className="text-white">%{margin.toLocaleString("tr-TR")}</b></span>}
              <span className="text-white/50">· önceki eşit dönem {formatTL(netPrev)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-[280px]">
            <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3">
              <div className="text-[11px] text-white/60 flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#2a78d6]" />Gelir</div>
              <div className="text-xl font-bold tabular-nums">{formatTL(income)}</div>
              <Delta now={income} before={incomePrev} />
            </div>
            <div className="rounded-2xl bg-white/[0.07] border border-white/10 px-4 py-3">
              <div className="text-[11px] text-white/60 flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-[#eb6834]" />Gider</div>
              <div className="text-xl font-bold tabular-nums">{formatTL(expense)}</div>
              <Delta now={expense} before={expensePrev} inverse />
            </div>
          </div>
        </div>
      </section>

      {/* Anlık göstergeler */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Bugün" value={formatTL(tIncome - tExpense)} sub={`Gelir ${formatTL(tIncome)} · gider ${formatTL(tExpense)}`} tone={tIncome - tExpense < 0 ? "bad" : "ok"} />
        <Tile label="Günlük ortalama gelir" value={formatTL(avgIncome)} sub={`${days} gün`} />
        <Tile label="Başabaş günlük ciro" value={formatTL(breakEven)} sub={avgIncome >= breakEven ? "Ortalama gelir üstünde ✓" : `Günde ${formatTL(breakEven - avgIncome)} eksik`} tone={avgIncome >= breakEven ? "ok" : "bad"} />
        {forecast
          ? <Tile label="Ay sonu tahmini" value={formatTL(forecast.net)} sub={`Gelir ${formatTL(forecast.income)} · gider ${formatTL(forecast.expense)}`} tone={forecast.net < 0 ? "bad" : "ok"} />
          : <Tile label="Personel payı" value={income ? `%${Math.round((staff / income) * 100)}` : "—"} sub={`gelirin · ${formatTL(staff)}`} />}
      </div>

      {/* Grafik */}
      {series.length > 1 && (
        <section className="bg-white border border-line rounded-[18px] p-4 md:p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold">{monthView ? "Aylık" : "Günlük"} gelir – gider</h2>
            <span className="text-xs text-muted">Personel maliyeti bordrodan, {monthView ? "aylara" : "günlere"} paylaştırılarak{estimated ? " · geçmiş aylarda SGK / vergi son ayın oranıyla" : ""}</span>
          </div>
          <PnlChart data={series} />
        </section>
      )}

      {/* Dağılımlar */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-white border border-line rounded-[18px] p-4 md:p-5 flex flex-col gap-3">
          <div className="flex items-baseline justify-between"><h2 className="font-semibold">Giderler nereye gidiyor?</h2><span className="text-sm font-semibold tabular-nums">{formatTL(expense)}</span></div>
          {!expenseRows.length && <p className="text-sm text-muted">Bu dönemde gider yok.</p>}
          <ul className="flex flex-col gap-2.5">
            {expenseRows.slice(0, 12).map((x) => {
              const ch = pct(x.v, x.prev);
              return (
                <li key={x.key}>
                  <div className="flex justify-between gap-3 text-[13px]"><span className="truncate">{x.name}{x.sub ? <span className="text-muted"> · {x.sub}</span> : null}</span>
                    <span className="tabular-nums whitespace-nowrap">{formatTL(x.v)}<span className="text-muted"> · %{expense ? Math.round((x.v / expense) * 100) : 0}</span>{ch != null && Math.abs(ch) >= 10 && <span className={`ml-1.5 text-[11px] font-semibold ${ch > 0 ? "text-[#C0392B]" : "text-[#1A7F52]"}`}>{ch > 0 ? "▲" : "▼"}%{Math.abs(Math.round(ch))}</span>}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-[#F1F4F7] overflow-hidden"><div className="h-full rounded-full bg-[#eb6834]" style={{ width: `${Math.max(1.5, (x.v / maxRow) * 100)}%` }} /></div>
                </li>
              );
            })}
          </ul>
          {rising && <p className="text-xs rounded-xl bg-[#FFF4E8] text-[#8A4B12] px-3 py-2">Dikkat: <b>{rising.name}</b> önceki döneme göre {formatTL(rising.v - rising.prev)} arttı.</p>}
        </section>
        <section className="bg-white border border-line rounded-[18px] p-4 md:p-5 flex flex-col gap-3">
          <div className="flex items-baseline justify-between"><h2 className="font-semibold">Gelirler</h2><span className="text-sm font-semibold tabular-nums">{formatTL(income)}</span></div>
          {!incomeRows.length && <p className="text-sm text-muted">Bu dönemde gelir yok.</p>}
          <ul className="flex flex-col gap-2.5">
            {incomeRows.map((x) => (
              <li key={x.key}>
                <div className="flex justify-between gap-3 text-[13px]"><span className="truncate">{x.name}</span><span className="tabular-nums whitespace-nowrap">{formatTL(x.v)}<span className="text-muted"> · %{income ? Math.round((x.v / income) * 100) : 0}</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-[#F1F4F7] overflow-hidden"><div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${Math.max(1.5, (Math.abs(x.v) / maxRow) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          {v.suppliers.length > 0 && (
            <div className="border-t border-line pt-3">
              <h3 className="text-[13px] font-semibold mb-1.5">En çok ödeme yapılan cariler (gider)</h3>
              <ul className="text-[13px] flex flex-col gap-1">{v.suppliers.slice(0, 6).map((s) => <li key={s.name} className="flex justify-between"><span className="truncate">{s.name}</span><span className="tabular-nums">{formatTL(Number(s.try))}</span></li>)}</ul>
            </div>
          )}
        </section>
      </div>

      {/* Kâr-zarar tablosu */}
      <section className="bg-white border border-line rounded-[18px] p-4 md:p-5">
        <h2 className="font-semibold mb-2">Kâr / zarar özeti</h2>
        <table className="w-full text-sm">
          <tbody>
            <PlRow l={`Yerli iş cirosu${jobsTr ? ` (${jobsTr.toLocaleString("tr-TR")} iş)` : ""}`} v={T.lab - labFx} />
            <PlRow l={`Yabancı iş cirosu${labFxEur ? ` · ${(labFxEur / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} €` : ""}${jobsFx ? ` (${jobsFx.toLocaleString("tr-TR")} iş)` : ""}`} v={labFx} />
            <PlRow l="Diğer gelirler (fatura, faiz, kur farkı…)" v={T.inc} />
            <PlRow l="Toplam gelir" v={income} strong />
            <PlRow l="Personel maliyeti" v={-staff} />
            <PlRow l="Malzeme tüketimi" v={-T.mat} />
            <PlRow l="İşletme giderleri (masraf, hizmet, SMM)" v={-T.exp} />
            <PlRow l="Toplam gider" v={-expense} strong />
            <PlRow l="Net kâr / zarar" v={net} strong big />
          </tbody>
        </table>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-brand-700 font-semibold">{monthView ? "Ay ay" : "Gün gün"} tablo</summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[13px] min-w-[520px]">
              <thead><tr className="text-left text-muted"><th className="py-1.5 pr-3">{monthView ? "Ay" : "Gün"}</th><th className="py-1.5 pr-3 text-right">Gelir</th><th className="py-1.5 pr-3 text-right">Gider</th><th className="py-1.5 text-right">Net</th></tr></thead>
              <tbody>{[...series].reverse().map((s) => <tr key={s.b} className="border-t border-[#EEF2F6]"><td className="py-1.5 pr-3">{s.title}</td><td className="py-1.5 pr-3 text-right tabular-nums">{formatTL(s.income)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{formatTL(s.expense)}</td><td className={`py-1.5 text-right tabular-nums font-semibold ${s.net < 0 ? "text-[#C0392B]" : ""}`}>{formatTL(s.net)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <p className="mt-3 text-xs text-muted leading-relaxed">
          Gelir: laboratuvar işleri ({basis === "in" ? "iş giriş tarihine" : "teslim tarihine"} göre) ve muhasebeleşen diğer gelirler; işlerden kesilen faturalar ciroya ikinci kez eklenmez. Gider: masraflar ve alış faturalarının gider kalemleri, satılan malın maliyeti,
          stoktan malzeme tüketimi ve bordrodan personel maliyeti (maaş ödeme kayıtları çift sayılmaz). Stok alımları tüketildikçe gidere yazılır; KDV ve tahsilat / ödeme hareketleri kâr-zararı etkilemez.
        </p>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="bg-white border border-line rounded-[16px] px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums leading-tight mt-0.5 ${tone === "bad" ? "text-[#C0392B]" : tone === "ok" ? "text-[#0B1F3A]" : "text-[#0B1F3A]"}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function PlRow({ l, v, strong, big }: { l: string; v: number; strong?: boolean; big?: boolean }) {
  return (
    <tr className={strong ? "border-t border-line" : ""}>
      <td className={`py-1.5 ${strong ? "font-semibold" : "text-[#33414F]"} ${big ? "text-base" : ""}`}>{l}</td>
      <td className={`py-1.5 text-right tabular-nums ${strong ? "font-semibold" : ""} ${big ? "text-base" : ""} ${v < 0 && big ? "text-[#C0392B]" : ""}`}>{formatTL(v)}</td>
    </tr>
  );
}
