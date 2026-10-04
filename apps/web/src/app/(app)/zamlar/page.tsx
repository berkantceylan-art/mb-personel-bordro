import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { Card, PageHeader, PrimaryLink, Stat } from "@/components/ui";
import { groupRaises, loadRaises } from "@/lib/raises";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, formatDate, getSession, periodLabel } from "@/lib/session";

export default async function RaisesPage({ searchParams }: { searchParams: Promise<{ yil?: string; bolum?: string }> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const year = Number(sp.yil) || new Date().getFullYear();
  const dept = sp.bolum || undefined;
  const supabase = await createClient();
  const [rows, { data: departments }] = await Promise.all([loadRaises(year, dept), supabase.from("departments").select("name").order("name")]);

  const byMonth = groupRaises(rows, (r) => r.period).sort((a, b) => a.key.localeCompare(b.key));
  const byDept = groupRaises(rows, (r) => r.department_name ?? "Bölümsüz").sort((a, b) => b.increase - a.increase);
  const total = groupRaises(rows, () => "all")[0];
  const people = new Set(rows.map((r) => r.employee_id)).size;
  const qs = new URLSearchParams({ yil: String(year), ...(dept ? { bolum: dept } : {}) }).toString();

  const th = "py-3 px-4 font-semibold border-b border-line";
  const td = "py-2.5 px-4 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader
        title="Zamlar"
        subtitle={`${year} yılı zam özeti${dept ? ` · ${dept}` : ""}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <a href={`/zamlar/rapor?${qs}`} className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Excel raporu</a>
            <PrimaryLink href="/zamlar/toplu">+ Toplu zam</PrimaryLink>
          </div>
        }
      />
      <div className="p-4 md:p-8 flex flex-col gap-6 max-w-[1240px]">
        <form className="flex flex-wrap gap-3">
          <select name="yil" defaultValue={year} aria-label="Yıl" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
            {[year + 1, year, year - 1, year - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select name="bolum" defaultValue={dept ?? ""} aria-label="Bölüm" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
            <option value="">Tüm bölümler</option>
            {(departments ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Göster</button>
        </form>

        <section className="grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <Stat label="Zam sayısı" value={String(rows.length)} sub={`${people} personel`} />
          <Stat label="Ortalama zam oranı" value={total ? `%${total.avgPct.toLocaleString("tr-TR")}` : "—"} />
          <Stat label="Aylık maliyet artışı" value={formatTL(total?.increase ?? 0)} sub={total ? `${formatTL(total.before)} → ${formatTL(total.after)}` : undefined} />
          <Stat label="Zam yapılan ay" value={String(byMonth.length)} sub={byMonth.map((m) => periodLabel(m.key).split(" ")[0]).join(", ") || "—"} />
        </section>

        <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))]">
          <Card title="Aylara göre">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className={th}>Ay</th><th className={`${th} text-right`}>Kişi</th><th className={`${th} text-right`}>Ort. %</th><th className={`${th} text-right`}>Aylık artış</th></tr></thead>
                <tbody>
                  {byMonth.map((g) => (
                    <tr key={g.key}><td className={`${td} font-semibold`}>{periodLabel(g.key)}</td><td className={`num ${td} text-right`}>{g.count}</td><td className={`num ${td} text-right`}>%{g.avgPct.toLocaleString("tr-TR")}</td><td className={`num ${td} text-right font-semibold`}>{formatTL(g.increase)}</td></tr>
                  ))}
                  {byMonth.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Bu yıl zam yok.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Bölümlere göre">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className={th}>Bölüm</th><th className={`${th} text-right`}>Kişi</th><th className={`${th} text-right`}>Ort. %</th><th className={`${th} text-right`}>Aylık artış</th></tr></thead>
                <tbody>
                  {byDept.map((g) => (
                    <tr key={g.key}>
                      <td className={`${td} font-semibold`}><Link href={`/zamlar?yil=${year}&bolum=${encodeURIComponent(g.key)}`} className="text-brand-700">{g.key}</Link></td>
                      <td className={`num ${td} text-right`}>{g.count}</td><td className={`num ${td} text-right`}>%{g.avgPct.toLocaleString("tr-TR")}</td><td className={`num ${td} text-right font-semibold`}>{formatTL(g.increase)}</td>
                    </tr>
                  ))}
                  {byDept.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">—</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="Personel bazında zamlar">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className={th}>Tarih</th><th className={th}>Personel</th><th className={th}>Bölüm</th>
                  <th className={`${th} text-right`}>Önceki</th><th className={`${th} text-right`}>Yeni</th><th className={`${th} text-right`}>Artış</th><th className={`${th} text-right`}>%</th><th className={th}>Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`num ${td} text-muted`}>{formatDate(r.effective_date)}</td>
                    <td className={`${td} font-semibold`}><Link href={`/personel/${r.employee_id}`} className="text-brand-700">{r.first_name} {r.last_name}</Link></td>
                    <td className={td}>{r.department_name ?? "—"}</td>
                    <td className={`num ${td} text-right`}>{formatTL(r.previous_total_net)}</td>
                    <td className={`num ${td} text-right font-semibold`}>{formatTL(r.total_net)}</td>
                    <td className={`num ${td} text-right text-ok`}>{r.increase >= 0 ? "+" : ""}{formatTL(r.increase)}</td>
                    <td className={`num ${td} text-right`}>%{r.increase_pct.toLocaleString("tr-TR")}</td>
                    <td className={`${td} text-muted`}>{r.change_reason ?? ""}{r.raise_batch_id ? " · toplu" : ""}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">Kayıt yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
