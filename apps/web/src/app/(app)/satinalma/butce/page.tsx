import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { MONTHS, budgetTone, p3Error, type BudgetCell } from "@/lib/purchasing3";
import { BudgetGrid } from "./BudgetGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Satın alma bütçesi" };

/** Bütçe: gider türü × ay; gerçekleşen (işlenmiş fatura) + taahhüt (onaylı, faturası gelmemiş sipariş) */
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0);
  if (lvl < 1) redirect("/");
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const cy = now.getUTCFullYear(), cm = now.getUTCMonth() + 1;
  const y = Number((await searchParams).y) || cy;
  const sb = await createClient();
  const [{ data, error }, { data: cats }] = await Promise.all([
    sb.rpc("pur_budget_usage", { p_year: y }),
    sb.from("fin_categories").select("id, name, kind").in("kind", ["expense", "stock"]).eq("is_active", true).order("kind", { ascending: false }).order("name"),
  ]);
  const cells = (data ?? []) as BudgetCell[];
  const by = new Map<string, BudgetCell[]>();
  for (const c of cells) by.set(c.category_id, [...(by.get(c.category_id) ?? []), c]);
  const upto = y < cy ? 12 : y > cy ? 0 : cm;
  const sum = (arr: BudgetCell[], k: "budget" | "actual" | "committed", to = 12) => arr.filter((c) => c.month <= to).reduce((a, c) => a + Number(c[k]), 0);
  const summary = [...by.entries()].map(([id, arr]) => ({ id, name: arr[0].name, budgetYtd: sum(arr, "budget", upto), budgetYear: sum(arr, "budget"), actual: sum(arr, "actual"), committed: sum(arr, "committed"),
    monthB: arr.find((c) => c.month === cm)?.budget ?? 0, monthU: (arr.find((c) => c.month === cm)?.actual ?? 0) + (arr.find((c) => c.month === cm)?.committed ?? 0), months: arr }));
  const tot = { b: summary.reduce((a, r) => a + r.budgetYear, 0), a: summary.reduce((a, r) => a + r.actual, 0), c: summary.reduce((a, r) => a + r.committed, 0), mb: summary.reduce((a, r) => a + r.monthB, 0), mu: summary.filter((r) => r.monthB > 0).reduce((a, r) => a + r.monthU, 0) };
  const pct = (u: number, b: number) => (b > 0 ? Math.round((u / b) * 100) : 0);
  const rows = ((cats ?? []) as { id: string; name: string; kind: string }[]).map((c) => ({ id: c.id, name: c.name, kind: c.kind, used: by.has(c.id) && (by.get(c.id) ?? []).some((x) => x.actual || x.committed), months: Array.from({ length: 12 }, (_, i) => Number(by.get(c.id)?.find((x) => x.month === i + 1)?.budget ?? 0)) }));
  const canEdit = (s.modules.purchases ?? 0) >= 3 || (s.modules.finance ?? 0) >= 3;

  return (
    <>
      <PageHeader title="Satın alma bütçesi" subtitle="Gerçekleşen = işlenmiş alış faturaları · Taahhüt = onaylanmış ama faturası gelmemiş siparişler (KDV hariç, TL)"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href={`?y=${y - 1}`} className="text-brand-700">← {y - 1}</Link><span>{y}</span><Link href={`?y=${y + 1}`} className="text-brand-700">{y + 1} →</Link><Link href="/satinalma" className="text-brand-700">Satın alma</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{p3Error(error.message)}</p>}
        <section className="grid gap-3 md:grid-cols-3">
          {y === cy && <Gauge label={`${MONTHS[cm - 1]} ayı (bütçeli kalemler)`} used={tot.mu} budget={tot.mb} />}
          <Gauge label={`${y} yılı toplam`} used={tot.a + tot.c} budget={tot.b} sub={`Gerçekleşen ${money(tot.a, "TRY")} · taahhüt ${money(tot.c, "TRY")}`} />
          <div className="rounded-[16px] border border-line bg-white p-4 text-sm flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Nasıl çalışır?</span>
            <span>Sipariş onaya gönderilirken ayın bütçesi kontrol edilir; aşan sipariş yöneticinin onayına düşer ve bildirim gider.</span>
            <span className="text-muted">Siparişin gider türü sipariş ekranından seçilir; seçilmezse stoklu kalemler &quot;Stok&quot;, diğerleri &quot;Malzeme gideri&quot; sayılır.</span>
          </div>
        </section>

        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Gider türü</th><th className="p-3 text-right">Yıllık bütçe</th><th className="p-3 text-right">Gerçekleşen</th><th className="p-3 text-right">Taahhüt</th><th className="p-3 text-right">Kalan</th><th className="p-3 w-64">Kullanım</th><th className="p-3">Aylar</th></tr></thead>
            <tbody>
              {summary.map((r) => {
                const p = pct(r.actual + r.committed, r.budgetYear);
                const maxM = Math.max(1, ...r.months.map((m) => Math.max(Number(m.budget), Number(m.actual) + Number(m.committed))));
                return (
                  <tr key={r.id} className="border-t border-[#EEF2F6]">
                    <td className="p-3 font-semibold">{r.name}</td>
                    <td className="p-3 text-right tabular-nums">{r.budgetYear ? money(r.budgetYear, "TRY") : <span className="text-muted">—</span>}</td>
                    <td className="p-3 text-right tabular-nums">{money(r.actual, "TRY")}</td>
                    <td className="p-3 text-right tabular-nums text-muted">{money(r.committed, "TRY")}</td>
                    <td className={`p-3 text-right tabular-nums font-semibold ${r.budgetYear && r.budgetYear - r.actual - r.committed < 0 ? "text-bad" : ""}`}>{r.budgetYear ? money(r.budgetYear - r.actual - r.committed, "TRY") : "—"}</td>
                    <td className="p-3">{r.budgetYear ? <div className="flex items-center gap-2"><span className="flex-1 h-2.5 rounded-full bg-[#EEF2F6] overflow-hidden"><span className={`block h-2.5 ${budgetTone(p)}`} style={{ width: `${Math.min(100, p)}%` }} /></span><span className={`text-xs font-semibold w-12 text-right ${p > 100 ? "text-bad" : ""}`}>%{p}</span></div> : <span className="text-xs text-muted">bütçesiz</span>}</td>
                    <td className="p-3">
                      <div className="flex items-end gap-0.5 h-8" title="Ay ay: koyu = harcama, çizgi = bütçe">
                        {r.months.map((m) => {
                          const u = Number(m.actual) + Number(m.committed);
                          return (
                            <span key={m.month} className="relative w-2.5 h-8 flex items-end" title={`${MONTHS[m.month - 1]}: ${money(u, "TRY")} / ${money(m.budget, "TRY")}`}>
                              <span className={`block w-full rounded-t-sm ${m.budget && u > m.budget ? "bg-bad" : "bg-brand-600"}`} style={{ height: `${(u / maxM) * 100}%` }} />
                              {m.budget > 0 && <span className="absolute left-0 right-0 border-t-2 border-brand-800" style={{ bottom: `${(Number(m.budget) / maxM) * 100}%` }} />}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!summary.length && !error && <tr><td colSpan={7} className="p-8 text-center text-muted">{y} için harcama ya da bütçe yok.</td></tr>}
            </tbody>
          </table>
        </section>

        {canEdit ? <BudgetGrid key={y} year={y} rows={rows} /> : <p className="text-xs text-muted">Bütçeyi satın alma ya da finans yöneticisi girer.</p>}
      </div>
    </>
  );
}

function Gauge({ label, used, budget, sub }: { label: string; used: number; budget: number; sub?: string }) {
  const p = budget > 0 ? Math.round((used / budget) * 100) : 0;
  return (
    <div className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="font-display text-2xl font-bold tabular-nums">{money(used, "TRY")} <span className="text-sm font-normal text-muted">/ {budget ? money(budget, "TRY") : "bütçe yok"}</span></span>
      {budget > 0 && <span className="h-3 rounded-full bg-[#EEF2F6] overflow-hidden"><span className={`block h-3 ${budgetTone(p)}`} style={{ width: `${Math.min(100, p)}%` }} /></span>}
      <span className={`text-xs ${p > 100 ? "text-bad font-semibold" : "text-muted"}`}>{budget > 0 ? `%${p} kullanıldı${p > 100 ? " — bütçe aşıldı" : ` · kalan ${money(budget - used, "TRY")}`}` : ""}{sub ? ` ${sub}` : ""}</span>
    </div>
  );
}
