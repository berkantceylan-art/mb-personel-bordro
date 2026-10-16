import Link from "next/link";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { money } from "@/lib/jobs";
import { decideAdvance } from "@/lib/comms-actions";
import { savePayCenterPlan, setPlanState } from "@/lib/pay-center-actions";
import {
  GROUPS, PLAN_CATS, addDays, dayLabel, daysBetween, monthEnd, monthLabel, payError, rangeFor, shortDay, srcOf, todayTR, weekStart, type PayRow, type View,
} from "@/lib/pay-center";

type Sb = { rpc: (f: string, a: Record<string, unknown>) => any; from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const tl = (v: number) => money(v, "TRY");
const sum = (r: PayRow[]) => r.reduce((a, x) => a + Number(x.amount_try), 0);

/** Ödeme merkezi: tüm çıkışlar (tedarikçi, maaş, avans, vergi, kredi, kart, masraf) — tam sayfa ya da patron ekranı özeti */
export async function PayCenter({ sb, view, t, k, base, compact, canEdit, canPay }: { sb: Sb; view: View; t?: string; k?: string; base: string; compact?: boolean; canEdit: boolean; canPay: boolean }) {
  const today = todayTR();
  const r = rangeFor(view, t);
  const kpiTo = [addDays(today, 6), monthEnd(today)].sort()[1]!;
  const [kpi, main, { data: bal }] = await Promise.all([
    sb.rpc("pay_center", { p_from: today, p_to: kpiTo }),
    view === "acil" || compact ? Promise.resolve(null) : sb.rpc("pay_center", { p_from: r.from, p_to: r.to }),
    sb.from("fin_account_balances").select("kind, balance_try").in("kind", ["cash", "bank"]),
  ]);
  if (kpi.error) return <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{payError(kpi.error.message)}</p>;
  const all = (kpi.data ?? []) as PayRow[];
  const grp = GROUPS.find((g) => g[0] === k);
  const pass = (x: PayRow) => !grp || grp[2].includes(x.src);
  const rows = ((main?.data ?? all) as PayRow[]).filter(pass);
  const overdue = all.filter((x) => x.overdue);
  const todayRows = all.filter((x) => x.due_date === today && !x.overdue && x.kind !== "advance_request");
  const weekEnd = addDays(weekStart(today), 6);
  const week = all.filter((x) => !x.overdue && x.kind !== "advance_request" && x.due_date <= weekEnd);
  const month = all.filter((x) => !x.overdue && x.kind !== "advance_request" && x.due_date <= monthEnd(today));
  const advances = all.filter((x) => x.kind === "advance_request");
  const urgentList = all.filter((x) => x.urgent || (x.due_date <= addDays(today, 3) && x.kind !== "advance_request")).filter(pass)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.kind === "advance_request") - Number(a.kind === "advance_request") || a.due_date.localeCompare(b.due_date));
  const cash = ((bal ?? []) as { kind: string; balance_try: number }[]).reduce((a, x) => a + Number(x.balance_try), 0);
  const next7 = all.filter((x) => x.kind !== "advance_request" && !x.estimate && x.due_date <= addDays(today, 6));
  const need7 = sum(next7);
  const cover = need7 ? Math.min(100, Math.round((cash / need7) * 100)) : 100;
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const v = { g: view, t: r.base, k, ...o };
    for (const [kk, vv] of Object.entries(v)) if (vv) p.set(kk, vv);
    return `${base}${base.includes("?") ? "&" : "?"}${p}`;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Nakit karşılama */}
      <section className="rounded-[22px] p-5 md:p-6 text-white bg-gradient-to-br from-[#06213f] via-[#0a3d73] to-[#13649f] shadow-lg shadow-[#0a3d73]/20">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-xs font-semibold tracking-wider text-white/60">ÖNÜMÜZDEKİ 7 GÜN</div>
            <div className="font-display text-3xl md:text-4xl font-bold tabular-nums">{tl(need7)}</div>
            <div className="text-sm text-white/70">{next7.length} ödeme{overdue.length ? ` + ${overdue.length} gecikmiş` : ""}</div>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wider text-white/60">KASA + BANKA</div>
            <div className="font-display text-2xl font-bold tabular-nums">{tl(cash)}</div>
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="flex justify-between text-xs text-white/70 mb-1"><span>Karşılama</span><span>%{cover}</span></div>
            <div className="h-3 rounded-full bg-white/15 overflow-hidden"><div className={`h-3 rounded-full ${cover >= 100 ? "bg-[#4ADE80]" : cover >= 70 ? "bg-[#FBBF24]" : "bg-[#F87171]"}`} style={{ width: `${cover}%` }} /></div>
            <div className="text-sm mt-1 font-semibold">{cash >= need7 ? "✓ Bu haftanın ödemeleri mevcut nakitle karşılanıyor" : `⚠ ${tl(need7 - cash)} eksik — tahsilat ya da erteleme gerekli`}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Kpi href={q({ g: "acil" })} label="Gecikmiş" value={tl(sum(overdue))} sub={`${overdue.length} kalem`} tone={overdue.length ? "bad" : undefined} />
        <Kpi href={q({ g: "gun", t: today })} label="Bugün" value={tl(sum(todayRows))} sub={`${todayRows.length} kalem`} tone={todayRows.length ? "warn" : undefined} />
        <Kpi href={q({ g: "hafta", t: today })} label="Bu hafta" value={tl(sum(week))} sub={`${week.length} kalem`} />
        <Kpi href={q({ g: "ay", t: today })} label="Bu ay" value={tl(sum(month))} sub={`${month.length} kalem`} />
        <Kpi href={q({ g: "acil" })} label="Avans talebi" value={String(advances.length)} sub={advances.length ? `${tl(sum(advances))} onay bekliyor` : "Bekleyen yok"} tone={advances.length ? "warn" : undefined} />
      </section>

      {compact ? (
        <>
          <Section title={`🚨 Acil (${urgentList.length})`} action={<Link href="/odeme-merkezi?g=acil" className="text-sm font-semibold text-brand-700">Tümü →</Link>}>
            <List rows={urgentList.slice(0, 8)} today={today} canEdit={canEdit} canPay={canPay} />
          </Section>
          <Section title="Önümüzdeki 7 gün" action={<Link href="/odeme-merkezi?g=hafta" className="text-sm font-semibold text-brand-700">Ödeme merkezi →</Link>}>
            <WeekStrip rows={all.filter((x) => x.kind !== "advance_request")} from={today} />
          </Section>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 rounded-xl bg-white border border-line">
              {([["gun", "Günlük"], ["hafta", "Haftalık"], ["ay", "Aylık"], ["acil", "🚨 Acil"]] as const).map(([v, l]) => (
                <Link key={v} href={q({ g: v, t: v === "acil" ? undefined : r.base })} className={`h-9 px-4 grid place-items-center rounded-lg text-sm font-semibold ${view === v ? "bg-brand-800 text-white" : "text-brand-700"}`}>{l}</Link>
              ))}
            </div>
            {view !== "acil" && (
              <div className="flex items-center gap-1">
                <Link href={q({ t: r.prev })} className="h-9 w-9 grid place-items-center rounded-full border border-line bg-white">‹</Link>
                <span className="text-sm font-semibold min-w-[150px] text-center">{view === "gun" ? dayLabel(r.from) : view === "hafta" ? `${dayLabel(r.from).split(" ").slice(0, 2).join(" ")} – ${dayLabel(r.to).split(" ").slice(0, 2).join(" ")}` : monthLabel(r.from)}</span>
                <Link href={q({ t: r.next })} className="h-9 w-9 grid place-items-center rounded-full border border-line bg-white">›</Link>
                {r.base !== rangeFor(view).base && <Link href={q({ t: today })} className="text-xs font-semibold text-brand-700 ml-1">Bugün</Link>}
              </div>
            )}
            <div className="flex flex-wrap gap-1 ml-auto">
              <Link href={q({ k: undefined })} className={`h-8 px-3 grid place-items-center rounded-full text-xs font-semibold border ${!k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>Hepsi</Link>
              {GROUPS.map(([key, l]) => <Link key={key} href={q({ k: key })} className={`h-8 px-3 grid place-items-center rounded-full text-xs font-semibold border ${k === key ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{l}</Link>)}
            </div>
          </div>

          {canEdit && <AddForm />}
          {view !== "acil" && rows.length > 0 && <Mix rows={rows.filter((x) => !x.overdue || view === "gun")} />}

          {view === "acil" && (
            <Section title={`🚨 Acil ödemeler (${urgentList.length})`} sub="Gecikmişler, 3 gün içinde vadesi gelenler, onay bekleyen avanslar ve acil işaretlenenler">
              <List rows={urgentList} today={today} canEdit={canEdit} canPay={canPay} />
            </Section>
          )}
          {view === "gun" && (
            <>
              {r.from === today && overdue.filter(pass).length > 0 && <Section title={`⚠ Gecikmiş (${overdue.filter(pass).length})`} tone="bad"><List rows={overdue.filter(pass)} today={today} canEdit={canEdit} canPay={canPay} /></Section>}
              <Section title={`${dayLabel(r.from)} · ${tl(sum(rows.filter((x) => x.due_date === r.from && !x.overdue)))}`}>
                <List rows={rows.filter((x) => x.due_date === r.from && !x.overdue)} today={today} canEdit={canEdit} canPay={canPay} empty="Bu gün ödeme yok." />
              </Section>
            </>
          )}
          {view === "hafta" && (
            <>
              <WeekStrip rows={rows.filter((x) => !x.overdue && x.kind !== "advance_request")} from={r.from} />
              {Array.from({ length: 7 }, (_, i) => addDays(r.from, i)).map((d) => {
                const dr = rows.filter((x) => x.due_date === d && !x.overdue);
                return dr.length ? <Section key={d} title={`${dayLabel(d)} · ${tl(sum(dr))}`} tone={d === today ? "today" : undefined}><List rows={dr} today={today} canEdit={canEdit} canPay={canPay} /></Section> : null;
              })}
              {rows.filter((x) => x.overdue).length > 0 && <Section title="⚠ Gecikmiş" tone="bad"><List rows={rows.filter((x) => x.overdue)} today={today} canEdit={canEdit} canPay={canPay} /></Section>}
            </>
          )}
          {view === "ay" && (
            <>
              <MonthGrid rows={rows.filter((x) => !x.overdue && x.kind !== "advance_request")} from={r.from} q={(d) => q({ g: "gun", t: d })} />
              <Section title={`${monthLabel(r.from)} · ${tl(sum(rows.filter((x) => !x.overdue && x.kind !== "advance_request")))}`}>
                <List rows={rows.filter((x) => !x.overdue)} today={today} canEdit={canEdit} canPay={canPay} showDate />
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ href, label, value, sub, tone }: { href: string; label: string; value: string; sub: string; tone?: "bad" | "warn" }) {
  return (
    <Link href={href} className={`rounded-[18px] border bg-white p-4 flex flex-col gap-0.5 hover:-translate-y-0.5 hover:shadow-md transition ${tone === "bad" ? "border-bad ring-4 ring-bad/10" : tone === "warn" ? "border-warn" : "border-line"}`}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={`font-display text-xl md:text-2xl font-bold tabular-nums ${tone === "bad" ? "text-bad" : ""}`}>{value}</span>
      <span className="text-[11px] text-muted">{sub}</span>
    </Link>
  );
}

function Section({ title, sub, action, tone, children }: { title: string; sub?: string; action?: React.ReactNode; tone?: "bad" | "today"; children: React.ReactNode }) {
  return (
    <section className={`rounded-[20px] border bg-white ${tone === "bad" ? "border-bad" : tone === "today" ? "border-brand-600" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-2">
        <h2 className={`font-display font-bold ${tone === "bad" ? "text-bad" : "text-brand-800"}`}>{title}</h2>
        {sub && <span className="text-xs text-muted">{sub}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function dueText(d: string, today: string, kind: string) {
  if (kind === "advance_request") return ["Onay bekliyor", "text-warn"];
  const n = daysBetween(today, d);
  if (n < 0) return [`${-n} gün gecikti`, "text-bad"];
  if (n === 0) return ["Bugün", "text-warn"];
  if (n === 1) return ["Yarın", "text-warn"];
  return [`${n} gün`, "text-muted"];
}

function List({ rows, today, canEdit, canPay, showDate, empty = "Ödeme yok." }: { rows: PayRow[]; today: string; canEdit: boolean; canPay: boolean; showDate?: boolean; empty?: string }) {
  if (!rows.length) return <p className="px-4 pb-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-[#EEF2F6]">
      {rows.map((x, i) => {
        const s = srcOf(x.src);
        const [dt, dc] = dueText(x.due_date, today, x.kind);
        return (
          <li key={`${x.src}${x.kind}${x.ref ?? x.title}${x.due_date}${i}`} className={`px-4 py-3 flex flex-wrap items-center gap-3 ${x.overdue ? "bg-bad-bg/30" : ""}`}>
            <span className={`w-10 h-10 shrink-0 rounded-xl grid place-items-center text-lg ${s.tone}`} title={s.label}>{s.icon}</span>
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold flex items-center gap-2">
                <Link href={x.link} className="hover:underline">{x.title}</Link>
                {x.urgent && !x.overdue && x.kind !== "advance_request" && <span className="text-[10px] font-bold rounded bg-bad text-white px-1.5 py-0.5">ACİL</span>}
                {x.estimate && <span className="text-[10px] font-semibold rounded bg-[#EEF2F6] text-muted px-1.5 py-0.5">TAHMİNİ</span>}
              </div>
              <div className="text-xs text-muted">{s.label}{x.sub ? ` · ${x.sub}` : ""}{showDate ? ` · ${dayLabel(x.due_date)}` : ""}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-lg font-bold tabular-nums">{money(x.amount, x.currency)}</div>
              <div className={`text-xs font-semibold ${dc}`}>{x.currency !== "TRY" ? `≈ ${tl(x.amount_try)} · ` : ""}{dt}</div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[150px] justify-end">
              {x.kind === "advance_request" && canPay && x.ref ? (
                <>
                  <form action={decideAdvance}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="decision" value="approve" /><input type="hidden" name="channel" value="CASH" /><PendingSubmit className="h-8 px-2.5 rounded-lg bg-ok text-white text-xs font-semibold">Onayla · elden</PendingSubmit></form>
                  <form action={decideAdvance}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="decision" value="approve" /><input type="hidden" name="channel" value="BANK" /><PendingSubmit className="h-8 px-2.5 rounded-lg border border-ok text-ok text-xs font-semibold">Banka</PendingSubmit></form>
                  <form action={decideAdvance}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="decision" value="reject" /><ConfirmSubmit label="Reddet" question="Avans talebi reddedilsin mi?" className="text-xs font-semibold text-bad" /></form>
                </>
              ) : x.kind === "plan" && canEdit && x.ref ? (
                <>
                  <form action={setPlanState}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="status" value="paid" /><PendingSubmit className="h-8 px-2.5 rounded-lg bg-ok text-white text-xs font-semibold">Ödendi</PendingSubmit></form>
                  <form action={setPlanState}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="status" value={x.urgent ? "normal" : "urgent"} /><PendingSubmit className="h-8 px-2 rounded-lg border border-line text-xs font-semibold">{x.urgent ? "Aciliyeti kaldır" : "Acil"}</PendingSubmit></form>
                  <form action={setPlanState}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="status" value="cancelled" /><ConfirmSubmit label="Kaldır" question="Ödeme listeden kaldırılsın mı?" className="text-xs text-muted" /></form>
                </>
              ) : (
                <Link href={x.link} className="h-8 px-3 grid place-items-center rounded-lg border border-line text-xs font-semibold text-brand-700">{x.src === "personnel" || x.src === "tax" ? "Maaş planı →" : x.src === "supplier" ? "Tedarikçi →" : "Aç →"}</Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WeekStrip({ rows, from }: { rows: PayRow[]; from: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const tot = days.map((d) => rows.filter((x) => x.due_date === d && !x.overdue));
  const max = Math.max(1, ...tot.map(sum));
  const today = todayTR();
  return (
    <div className="grid grid-cols-7 gap-2 p-4 pt-2">
      {days.map((d, i) => (
        <div key={d} className={`rounded-xl border p-2 flex flex-col gap-1 ${d === today ? "border-brand-600 bg-[#F4F8FC]" : "border-[#EEF2F6]"}`}>
          <div className="text-[11px] font-semibold text-muted">{shortDay(d)} {Number(d.slice(8))}</div>
          <div className="h-16 flex items-end"><div className="w-full rounded-md bg-gradient-to-t from-[#0a3d73] to-[#3b8fd0]" style={{ height: `${Math.max(tot[i]!.length ? 6 : 0, (sum(tot[i]!) / max) * 100)}%` }} /></div>
          <div className="text-xs font-bold tabular-nums truncate">{tot[i]!.length ? tl(sum(tot[i]!)).replace(/,00 /, " ") : "—"}</div>
          <div className="text-[10px] text-muted">{tot[i]!.length ? `${tot[i]!.length} kalem` : ""}</div>
        </div>
      ))}
    </div>
  );
}

function MonthGrid({ rows, from, q }: { rows: PayRow[]; from: string; q: (d: string) => string }) {
  const last = Number(monthEnd(from).slice(8));
  const first = (new Date(Date.parse(from)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: last }, (_, i) => addDays(from, i))];
  while (cells.length % 7) cells.push(null);
  const today = todayTR();
  const max = Math.max(1, ...Array.from({ length: last }, (_, i) => sum(rows.filter((x) => x.due_date === addDays(from, i)))));
  return (
    <section className="rounded-[20px] border border-line bg-white p-4">
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((w) => <div key={w} className="text-center font-semibold text-muted py-1">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const dr = rows.filter((x) => x.due_date === d);
          const v = sum(dr);
          const heat = v ? 0.12 + (v / max) * 0.6 : 0;
          return (
            <Link key={i} href={q(d)} className={`min-h-[84px] rounded-xl p-1.5 border flex flex-col gap-1 hover:border-brand-600 ${d === today ? "border-brand-600" : "border-[#EEF2F6]"}`} style={{ background: v ? `rgba(15,76,138,${heat})` : undefined }}>
              <span className={`text-[11px] font-semibold ${heat > 0.45 ? "text-white" : "text-muted"}`}>{Number(d.slice(8))}</span>
              {v > 0 && <span className={`text-[11px] font-bold tabular-nums ${heat > 0.45 ? "text-white" : "text-ink"}`}>{tl(v).replace(/,00 /, " ")}</span>}
              <span className="flex flex-wrap gap-0.5 mt-auto">{dr.slice(0, 6).map((x, j) => <span key={j} className="w-2 h-2 rounded-full" style={{ background: srcOf(x.src).bar }} title={x.title} />)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Mix({ rows }: { rows: PayRow[] }) {
  const by = new Map<string, number>();
  for (const x of rows) if (x.kind !== "advance_request") by.set(x.src, (by.get(x.src) ?? 0) + Number(x.amount_try));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-[20px] border border-line bg-white p-4 flex flex-col gap-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">{parts.map(([s, v]) => <div key={s} style={{ width: `${(v / total) * 100}%`, background: srcOf(s).bar }} title={`${srcOf(s).label}: ${tl(v)}`} />)}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{parts.map(([s, v]) => <span key={s} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: srcOf(s).bar }} />{srcOf(s).label} <b className="tabular-nums">{tl(v)}</b> <span className="text-muted">%{Math.round((v / total) * 100)}</span></span>)}</div>
    </section>
  );
}

function AddForm() {
  const today = todayTR();
  return (
    <details className="rounded-[20px] border border-dashed border-[#B8C6D6] bg-white group">
      <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-brand-700 list-none">＋ Ödeme ekle (kira, elektrik, vergi, elden ödeme…)</summary>
      <form action={savePayCenterPlan} className="px-4 pb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]">Ne ödenecek<input name="title" required maxLength={160} placeholder="ör. Ofis kirası, Elektrik, KDV" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
        <label className="flex flex-col gap-1">Tür<select name="category" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">{PLAN_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex flex-col gap-1">Tarih<input type="date" name="due_date" required defaultValue={today} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
        <label className="flex flex-col gap-1">Tutar<input name="amount" required inputMode="decimal" placeholder="0,00" className="h-10 w-32 rounded-[10px] border border-[#D5DEE8] px-2 text-right" /></label>
        <label className="flex flex-col gap-1">Para birimi<select name="currency" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">{["TRY", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="flex flex-col gap-1 flex-1 min-w-[160px]">Not<input name="note" maxLength={300} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
        <label className="flex items-center gap-2 h-10 font-semibold text-bad"><input type="checkbox" name="urgent" /> Acil</label>
        <PendingSubmit className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</PendingSubmit>
        <span className="w-full text-xs text-muted">Tedarikçi ödemesi planlamak için tedarikçi sayfasındaki &quot;Ödemeler&quot; sekmesini kullanın; maaşlar ve avanslar kendiliğinden listeye gelir.</span>
      </form>
    </details>
  );
}
