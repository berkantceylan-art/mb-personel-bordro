import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, page, td, tdNum, th } from "@/components/erp";
import { PeriodForm } from "@/components/ledger/PeriodForm";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { amt, glError, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type R = { code: string; name: string; lvl: number; open_d: number; open_c: number; per_d: number; per_c: number; tot_d: number; tot_c: number; bal_d: number; bal_c: number };

/** Mizan */
export default async function TrialBalance({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; seviye?: string; sifir?: string; grup?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const lvl = [1, 2, 3, 4, 5].includes(Number(sp.seviye)) ? Number(sp.seviye) : 1;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_trial_balance", { p_from: from, p_to: to, p_level: lvl, p_zero: sp.sifir === "1" });
  const rows = (data ?? []) as R[];
  const sum = (k: keyof R) => rows.reduce((x, r) => x + Number(r[k]), 0);
  const tot = { od: sum("open_d"), oc: sum("open_c"), pd: sum("per_d"), pc: sum("per_c"), td: sum("tot_d"), tc: sum("tot_c"), bd: sum("bal_d"), bc: sum("bal_c") };
  // ana grup ara toplamları (1 ve 2 haneli)
  const groups = sp.grup === "1";
  const out: Array<R & { group?: boolean }> = [];
  let last2 = "";
  for (const r of rows) {
    const g2 = r.code.slice(0, 2);
    if (groups && g2 !== last2) {
      const base = rows.filter((x) => x.code.slice(0, 2) === g2);
      const z = (k: keyof R) => base.reduce((x, y) => x + Number(y[k]), 0);
      out.push({ code: g2, name: "", lvl: 0, open_d: z("open_d"), open_c: z("open_c"), per_d: z("per_d"), per_c: z("per_c"), tot_d: z("tot_d"), tot_c: z("tot_c"), bal_d: Math.max(z("tot_d") - z("tot_c"), 0), bal_c: Math.max(z("tot_c") - z("tot_d"), 0), group: true });
      last2 = g2;
    }
    out.push(r);
  }
  const showOpen = rows.some((r) => r.open_d || r.open_c);
  const excel = `/muhasebe/aktar/excel?tur=mizan&bas=${from}&bit=${to}&seviye=${lvl}`;
  const bad = tot.td !== tot.tc;
  return (
    <>
      <PageHeader title="Mizan" subtitle={`${formatDate(from)} – ${formatDate(to)} · kayıtlı fişler`} actions={<Link href="/muhasebe" className="text-sm font-semibold text-brand-700">Genel muhasebe</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270207000000_gl_reports.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <PeriodForm from={from} to={to} extra={{ seviye: String(lvl), sifir: sp.sifir, grup: sp.grup }} excel={excel}>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Seviye<select name="seviye" defaultValue={String(lvl)} className="h-11 rounded-[10px] border border-line bg-white px-3 text-sm">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? "1 · ana hesap" : `${n}. kırılım`}</option>)}</select></label>
          <label className="flex items-center gap-1 text-xs font-semibold text-muted h-11"><input type="checkbox" name="grup" value="1" defaultChecked={groups} /> Grup toplamları</label>
          <label className="flex items-center gap-1 text-xs font-semibold text-muted h-11"><input type="checkbox" name="sifir" value="1" defaultChecked={sp.sifir === "1"} /> Sıfır bakiyeler</label>
        </PeriodForm>
        {bad && <Notice tone="bad">Borç ve alacak toplamı tutmuyor; dengesiz fiş olabilir.</Notice>}
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-xs text-muted">
              <th className={th}>Hesap</th><th className={th}>Hesap adı</th>
              {showOpen && <><th className={`${th} text-right`}>Devir borç</th><th className={`${th} text-right`}>Devir alacak</th></>}
              <th className={`${th} text-right`}>Dönem borç</th><th className={`${th} text-right`}>Dönem alacak</th>
              <th className={`${th} text-right`}>Toplam borç</th><th className={`${th} text-right`}>Toplam alacak</th>
              <th className={`${th} text-right`}>Borç bakiye</th><th className={`${th} text-right`}>Alacak bakiye</th>
            </tr></thead>
            <tbody>
              {out.map((r) => (
                <tr key={(r.group ? "g" : "") + r.code} className={r.group ? "bg-[#F6F8FA] font-semibold" : r.lvl === 1 && lvl > 1 ? "font-semibold" : ""}>
                  <td className={`${td} num whitespace-nowrap`} style={{ paddingLeft: 12 + Math.max(0, r.lvl - 1) * 16 }}>{r.group ? r.code : <Link href={`/muhasebe/kebir?hesap=${encodeURIComponent(r.code)}&bas=${from}&bit=${to}`} className="text-brand-700">{r.code}</Link>}</td>
                  <td className={td}>{r.group ? "Grup toplamı" : r.name}</td>
                  {showOpen && <><td className={tdNum}>{amt(r.open_d)}</td><td className={tdNum}>{amt(r.open_c)}</td></>}
                  <td className={tdNum}>{amt(r.per_d)}</td><td className={tdNum}>{amt(r.per_c)}</td>
                  <td className={tdNum}>{amt(r.tot_d)}</td><td className={tdNum}>{amt(r.tot_c)}</td>
                  <td className={`${tdNum} font-semibold`}>{amt(r.bal_d)}</td><td className={`${tdNum} font-semibold`}>{amt(r.bal_c)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="py-10 text-center text-muted">Bu dönemde kayıtlı fiş yok.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr className="font-bold border-t-2 border-line">
                <td className={td} colSpan={2}>GENEL TOPLAM</td>
                {showOpen && <><td className={tdNum}>{amt(tot.od)}</td><td className={tdNum}>{amt(tot.oc)}</td></>}
                <td className={tdNum}>{amt(tot.pd)}</td><td className={tdNum}>{amt(tot.pc)}</td><td className={tdNum}>{amt(tot.td)}</td><td className={tdNum}>{amt(tot.tc)}</td><td className={tdNum}>{amt(tot.bd)}</td><td className={tdNum}>{amt(tot.bc)}</td>
              </tr></tfoot>
            )}
          </table>
        </section>
      </div>
    </>
  );
}
