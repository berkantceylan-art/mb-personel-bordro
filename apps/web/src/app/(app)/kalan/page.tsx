import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PageHeader, Stat } from "@/components/ui";
import { PeriodPicker } from "@/components/PeriodPicker";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel } from "@/lib/session";
import { fetchAll } from "@/lib/timekeeping";

type Row = { employee_id: string; period: string; accrued: number | null; paid_bank: number | null; paid_cash: number | null; deductions: number | null; balance: number | null };

/** Kalan ödemeler: hangi personele, hangi aydan ne kadar ödeme kaldı */
export default async function RemainingPage({ searchParams }: { searchParams: Promise<{ donem?: string; bolum?: string; goster?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const all = sp.donem === "tumu";
  const period = !all && sp.donem && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.donem) ? sp.donem : currentPeriod();
  const showAll = sp.goster === "hepsi";
  const supabase = await createClient();

  const [rows, { data: emps }, { data: periodRows }] = await Promise.all([
    fetchAll<Row>((a, b) => {
      let q = supabase.from("ledger_period_summary").select("employee_id, period, accrued, paid_bank, paid_cash, deductions, balance");
      if (!all) q = q.eq("period", period);
      return q.order("employee_id").order("period").range(a, b);
    }),
    supabase.from("employees").select("id, first_name, last_name, status, departments(name)"),
    supabase.from("payroll_periods").select("period").order("period", { ascending: false }),
  ]);
  const info = new Map((emps ?? []).map((e) => [e.id, {
    name: `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim(),
    dept: (e.departments as unknown as { name: string } | null)?.name ?? "Bölümsüz",
    left: e.status === "terminated",
  }]));
  const n = (v: number | null) => Number(v ?? 0);

  // Personel bazında topla (tüm dönemlerde aylara göre kalan da tutulur)
  const per = new Map<string, { id: string; name: string; dept: string; left: boolean; acc: number; bank: number; cash: number; ded: number; bal: number; months: Array<[string, number]> }>();
  for (const r of rows) {
    const i = info.get(r.employee_id);
    if (!i || (sp.bolum && i.dept !== sp.bolum)) continue;
    const g = per.get(r.employee_id) ?? { id: r.employee_id, ...i, acc: 0, bank: 0, cash: 0, ded: 0, bal: 0, months: [] };
    g.acc += n(r.accrued); g.bank += n(r.paid_bank); g.cash += n(r.paid_cash); g.ded += n(r.deductions); g.bal += n(r.balance);
    if (Math.abs(n(r.balance)) > 0) g.months.push([r.period, n(r.balance)]);
    per.set(r.employee_id, g);
  }
  const everyone = [...per.values()];
  const owed = everyone.filter((g) => g.bal > 0).sort((a, b) => b.bal - a.bal);
  const over = everyone.filter((g) => g.bal < 0).sort((a, b) => a.bal - b.bal);
  const settled = everyone.filter((g) => g.bal === 0);
  const list = showAll ? [...owed, ...over, ...settled] : [...owed, ...over];
  const totalOwed = owed.reduce((a, g) => a + g.bal, 0);
  const totalOver = over.reduce((a, g) => a + g.bal, 0);
  const depts = [...new Set([...info.values()].map((i) => i.dept))].sort((a, b) => a.localeCompare(b, "tr"));
  const periodOptions = [...new Set([currentPeriod(), ...(periodRows ?? []).map((p) => p.period as string)])];
  const q = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const v = { donem: all ? "tumu" : period, bolum: sp.bolum, goster: sp.goster, ...extra };
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x);
    return `/kalan?${u}`;
  };
  const th = "py-2.5 px-2 font-semibold border-b border-line";
  const td = "py-2.5 px-2 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader
        title="Kalan ödemeler"
        subtitle={`${all ? "Tüm dönemler" : periodLabel(period)}${sp.bolum ? ` · ${sp.bolum}` : ""} · ${owed.length} personele ödeme kaldı`}
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            {!all && <PeriodPicker value={period} options={periodOptions} />}
            <Link href={q({ donem: all ? period : "tumu" })} className="h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">
              {all ? "Tek ay" : "Tüm dönemler"}
            </Link>
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1240px]">
        <section className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <Stat label="Personele borç" value={formatTL(totalOwed)} sub={`${owed.length} kişi`} />
          <Stat label="Fazla ödenen" value={formatTL(-totalOver)} sub={over.length ? `${over.length} kişi · sonraki aydan düşülür` : "yok"} />
          <Stat label="Ödemesi tamam" value={String(settled.length)} sub="kişi" />
        </section>

        <form className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="donem" value={all ? "tumu" : period} />
          <label className="flex flex-col gap-1 text-xs text-muted">
            Bölüm
            <select name="bolum" defaultValue={sp.bolum ?? ""} className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-ink">
              <option value="">Tüm bölümler</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 h-11 text-sm">
            <input type="checkbox" name="goster" value="hepsi" defaultChecked={showAll} className="w-5 h-5 accent-[#0A3D73]" />
            Ödemesi tamam olanları da göster
          </label>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
        </form>

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className={th}>Personel</th>
                <th className={th}>Bölüm</th>
                <th className={`${th} text-right`}>Hakediş</th>
                <th className={`${th} text-right`}>Bankadan</th>
                <th className={`${th} text-right`}>Elden</th>
                <th className={`${th} text-right`}>Kesinti</th>
                <th className={`${th} text-right`}>Kalan</th>
                {all && <th className={th}>Aylara göre kalan</th>}
                <th className={th}><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} className={g.bal === 0 ? "text-muted" : ""}>
                  <td className={td}>
                    <Link href={`/personel/${g.id}${all ? "" : `?donem=${period}`}`} className="font-semibold text-brand-700">{g.name}</Link>
                    {g.left && <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#EEF2F6] text-[#33414F]">Ayrıldı</span>}
                  </td>
                  <td className={td}>{g.dept}</td>
                  <td className={`num ${td} text-right`}>{formatTL(g.acc)}</td>
                  <td className={`num ${td} text-right`}>{formatTL(g.bank)}</td>
                  <td className={`num ${td} text-right`}>{formatTL(g.cash)}</td>
                  <td className={`num ${td} text-right`}>{formatTL(g.ded)}</td>
                  <td className={`num ${td} text-right font-bold ${g.bal > 0 ? "text-warn" : g.bal < 0 ? "text-bad" : ""}`}>{formatTL(g.bal)}</td>
                  {all && (
                    <td className={`${td} text-xs text-muted`}>
                      {g.months.sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => `${periodLabel(m).split(" ")[0]} ${formatTL(v)}`).join(" · ")}
                    </td>
                  )}
                  <td className={`${td} text-right`}>
                    {g.bal > 0 && <Link href={`/odemeler/yeni?personel=${g.id}`} className="text-xs font-semibold text-brand-700 whitespace-nowrap">Ödeme gir →</Link>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={all ? 9 : 8} className="py-8 text-center text-muted">Ödemesi kalan personel yok.</td></tr>}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2.5 px-2" colSpan={2}>{list.length} kişi</td>
                  <td className="num py-2.5 px-2 text-right">{formatTL(list.reduce((a, g) => a + g.acc, 0))}</td>
                  <td className="num py-2.5 px-2 text-right">{formatTL(list.reduce((a, g) => a + g.bank, 0))}</td>
                  <td className="num py-2.5 px-2 text-right">{formatTL(list.reduce((a, g) => a + g.cash, 0))}</td>
                  <td className="num py-2.5 px-2 text-right">{formatTL(list.reduce((a, g) => a + g.ded, 0))}</td>
                  <td className="num py-2.5 px-2 text-right">{formatTL(list.reduce((a, g) => a + g.bal, 0))}</td>
                  <td colSpan={all ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </section>
        <p className="text-xs text-muted">
          Kalan = hakediş − bankadan ve elden ödenenler − kesintiler (BES, icra, eksik gün, borç). Eksi kalan fazla ödemedir. Personelin adına tıklayınca tüm hareketleri açılır;
          &quot;Ödeme gir&quot; ile avans veya maaş ödemesi kaydedebilirsiniz. Ayrıntılı döküm ve Excel için Raporlar → &quot;Personele borç durumu&quot;.
        </p>
      </div>
    </>
  );
}
