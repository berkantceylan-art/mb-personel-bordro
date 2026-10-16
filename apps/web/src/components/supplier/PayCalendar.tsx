import Link from "next/link";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { money } from "@/lib/jobs";
import { setPayPlanStatus } from "@/lib/supplier-portal-actions";
import { PAY_KINDS, PAY_METHODS, daysTo, dmy, type PayItem } from "@/lib/supplier-portal";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WD = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function monthRange(ay?: string) {
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const m = ay && /^\d{4}-\d{2}$/.test(ay) ? ay : today.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  return { month: m, from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}`, prev, next, today, y, mo, last };
}

const sumBy = (items: PayItem[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.currency, (m.get(i.currency) ?? 0) + Number(i.amount));
  return [...m.entries()].map(([c, v]) => money(v, c)).join(" + ") || money(0, "TRY");
};

/** Ödeme takvimi: ay görünümü + liste. lab=true → planlı ödemeyi ödendi / iptal işaretleme */
export function PayCalendar({ items, ay, base, showParty, lab }: { items: PayItem[]; ay?: string; base: string; showParty?: boolean; lab?: boolean }) {
  const r = monthRange(ay);
  const sep = base.includes("?") ? "&" : "?";
  const inMonth = items.filter((i) => i.due_date >= r.from && i.due_date <= r.to);
  const overdue = items.filter((i) => i.overdue && i.due_date < r.from);
  const firstWd = (new Date(Date.UTC(r.y, r.mo - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(firstWd).fill(null), ...Array.from({ length: r.last }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<number, PayItem[]>();
  for (const i of inMonth) { const d = Number(i.due_date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), i]); }
  const next = items.filter((i) => i.due_date >= r.today).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[18px] p-5 text-white bg-gradient-to-br from-[#0a3d73] to-[#0f6aa8]">
          <div className="text-xs font-semibold text-white/70">Sıradaki ödeme</div>
          {next ? <>
            <div className="font-display text-3xl font-bold tabular-nums mt-1">{money(next.amount, next.currency)}</div>
            <div className="text-sm text-white/80">{dmy(next.due_date)} · {daysTo(next.due_date) === 0 ? "bugün" : `${daysTo(next.due_date)} gün sonra`} · {PAY_KINDS[next.kind]?.[0]}{showParty ? ` · ${next.party}` : ""}</div>
          </> : <div className="font-display text-xl font-bold mt-1">Planlanmış ödeme yok</div>}
        </div>
        <div className="rounded-[18px] border border-line bg-white p-5"><div className="text-xs font-semibold text-muted">{MONTHS[r.mo - 1]} {r.y} toplamı</div><div className="font-display text-2xl font-bold tabular-nums">{sumBy(inMonth)}</div><div className="text-xs text-muted">{inMonth.length} kalem</div></div>
        <div className={`rounded-[18px] border bg-white p-5 ${overdue.length ? "border-bad" : "border-line"}`}><div className="text-xs font-semibold text-muted">Vadesi geçmiş</div><div className={`font-display text-2xl font-bold tabular-nums ${overdue.length ? "text-bad" : ""}`}>{overdue.length ? sumBy(overdue) : "—"}</div><div className="text-xs text-muted">{overdue.length} kalem</div></div>
      </section>

      <section className="rounded-[20px] border border-line bg-white p-4 md:p-5">
        <div className="flex items-center gap-3 mb-3">
          <Link href={`${base}${sep}ay=${r.prev}`} className="h-9 w-9 grid place-items-center rounded-full border border-line">‹</Link>
          <h2 className="font-display text-lg font-bold text-brand-800">{MONTHS[r.mo - 1]} {r.y}</h2>
          <Link href={`${base}${sep}ay=${r.next}`} className="h-9 w-9 grid place-items-center rounded-full border border-line">›</Link>
          <span className="ml-auto flex flex-wrap gap-2 text-xs">{Object.entries(PAY_KINDS).map(([k, [l, ic, cls]]) => <span key={k} className={`rounded-full px-2 py-0.5 ${cls}`}>{ic} {l}</span>)}</span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {WD.map((w) => <div key={w} className="p-1 text-center font-semibold text-muted">{w}</div>)}
          {cells.map((d, i) => {
            const iso = d ? `${r.month}-${String(d).padStart(2, "0")}` : "";
            const list = d ? byDay.get(d) ?? [] : [];
            return (
              <div key={i} className={`min-h-[86px] rounded-xl p-1.5 border ${!d ? "border-transparent" : iso === r.today ? "border-brand-600 bg-[#F4F8FC]" : "border-[#EEF2F6]"}`}>
                {d && <div className={`text-[11px] font-semibold ${iso === r.today ? "text-brand-700" : "text-muted"}`}>{d}</div>}
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {list.slice(0, 3).map((x) => <div key={x.kind + x.ref} className={`rounded-md px-1 py-0.5 truncate ${PAY_KINDS[x.kind]?.[2]}`} title={`${PAY_KINDS[x.kind]?.[0]} · ${x.party} · ${money(x.amount, x.currency)}`}>{PAY_KINDS[x.kind]?.[1]} {money(x.amount, x.currency).replace(/,00 /, " ")}</div>)}
                  {list.length > 3 && <div className="text-[10px] text-muted">+{list.length - 3} daha</div>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[20px] border border-line bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Vade</th><th className="p-3">Tür</th>{showParty && <th className="p-3">Tedarikçi</th>}<th className="p-3">Belge / açıklama</th><th className="p-3 text-right">Tutar</th><th className="p-3">Kalan</th>{lab && <th className="p-3" />}</tr></thead>
          <tbody>
            {[...overdue, ...inMonth].map((x) => {
              const dd = daysTo(x.due_date);
              return (
                <tr key={x.kind + x.ref} className={`border-t border-[#EEF2F6] ${x.overdue ? "bg-bad-bg/40" : ""}`}>
                  <td className="p-3 whitespace-nowrap font-semibold">{dmy(x.due_date)}</td>
                  <td className="p-3"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${PAY_KINDS[x.kind]?.[2]}`}>{PAY_KINDS[x.kind]?.[1]} {PAY_KINDS[x.kind]?.[0]}</span>{x.method && <span className="block text-[11px] text-muted mt-0.5">{PAY_METHODS[x.method]}</span>}</td>
                  {showParty && <td className="p-3"><Link href={`/satinalma/tedarikci/${x.party_id}?t=odeme`} className="font-semibold text-brand-700">{x.party}</Link></td>}
                  <td className="p-3 text-xs">{[x.doc, x.note].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{money(x.amount, x.currency)}</td>
                  <td className={`p-3 text-xs font-semibold ${dd < 0 ? "text-bad" : dd <= 3 ? "text-warn" : "text-muted"}`}>{dd < 0 ? `${-dd} gün geçti` : dd === 0 ? "Bugün" : `${dd} gün`}</td>
                  {lab && (
                    <td className="p-3 whitespace-nowrap">
                      {x.kind === "plan" && <span className="flex gap-2">
                        <form action={setPayPlanStatus}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="party_id" value={x.party_id} /><input type="hidden" name="status" value="paid" /><PendingSubmit className="text-xs font-semibold text-ok">Ödendi</PendingSubmit></form>
                        <form action={setPayPlanStatus}><input type="hidden" name="id" value={x.ref} /><input type="hidden" name="party_id" value={x.party_id} /><input type="hidden" name="status" value="cancelled" /><ConfirmSubmit label="İptal" question="Plan iptal edilsin mi?" className="text-xs text-muted" /></form>
                      </span>}
                      {(x.kind === "cheque" || x.kind === "note") && <Link href={`/finans/cek-senet/${x.ref}`} className="text-xs font-semibold text-brand-700">Çek / senet</Link>}
                      {x.kind === "invoice" && <Link href={`/fatura/${x.ref}`} className="text-xs font-semibold text-brand-700">Fatura</Link>}
                    </td>
                  )}
                </tr>
              );
            })}
            {!inMonth.length && !overdue.length && <tr><td colSpan={7} className="p-8 text-center text-muted">Bu ay ödeme yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
