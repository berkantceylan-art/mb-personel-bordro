import { redirect } from "next/navigation";
import { PrintShell, PeriodTools, pcell, pdate, pmoney, pnum } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type R = { code: string; name: string; lvl: number; open_d: number; open_c: number; per_d: number; per_c: number; tot_d: number; tot_c: number; bal_d: number; bal_c: number };

/** Mizan çıktısı (A4 yatay) */
export default async function TrialBalancePrint({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; seviye?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const { from, to } = period(sp);
  const lvl = [1, 2, 3, 4, 5].includes(Number(sp.seviye)) ? Number(sp.seviye) : 1;
  const supabase = await createClient();
  const { data } = await supabase.rpc("gl_trial_balance", { p_from: from, p_to: to, p_level: lvl, p_zero: false });
  const rows = (data ?? []) as R[];
  const sum = (k: keyof R) => rows.reduce((x, r) => x + Number(r[k]), 0);
  const showOpen = rows.some((r) => r.open_d || r.open_c);
  return (
    <PrintShell title="MİZAN" sub={`${pdate(from)} – ${pdate(to)} · ${lvl === 1 ? "ana hesaplar" : `${lvl}. kırılım`}`} back={`/muhasebe/mizan?bas=${from}&bit=${to}&seviye=${lvl}`} landscape
      tools={<><PeriodTools from={from} to={to} extra={{ seviye: String(lvl) }} /><form className="flex items-center gap-1"><input type="hidden" name="bas" value={from} /><input type="hidden" name="bit" value={to} /><select name="seviye" defaultValue={String(lvl)} className="h-9 rounded border border-[#D5DEE8] px-2">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? "Ana hesap" : `${n}. kırılım`}</option>)}</select><button className="h-9 px-3 rounded border border-[#D5DEE8] font-semibold">Seviye</button></form></>}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#EEF2F6]">
            <th className={`${pcell} text-left`}>Hesap</th><th className={`${pcell} text-left`}>Hesap adı</th>
            {showOpen && <><th className={`${pcell} text-right`}>Devir borç</th><th className={`${pcell} text-right`}>Devir alacak</th></>}
            <th className={`${pcell} text-right`}>Dönem borç</th><th className={`${pcell} text-right`}>Dönem alacak</th>
            <th className={`${pcell} text-right`}>Toplam borç</th><th className={`${pcell} text-right`}>Toplam alacak</th>
            <th className={`${pcell} text-right`}>Borç bakiye</th><th className={`${pcell} text-right`}>Alacak bakiye</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className={r.lvl === 1 && lvl > 1 ? "font-semibold" : ""}>
              <td className={`${pcell} tabular-nums whitespace-nowrap`} style={{ paddingLeft: 6 + (r.lvl - 1) * 10 }}>{r.code}</td><td className={pcell}>{r.name}</td>
              {showOpen && <><td className={pnum}>{pmoney(r.open_d)}</td><td className={pnum}>{pmoney(r.open_c)}</td></>}
              <td className={pnum}>{pmoney(r.per_d)}</td><td className={pnum}>{pmoney(r.per_c)}</td><td className={pnum}>{pmoney(r.tot_d)}</td><td className={pnum}>{pmoney(r.tot_c)}</td><td className={pnum}>{pmoney(r.bal_d)}</td><td className={pnum}>{pmoney(r.bal_c)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold bg-[#EEF2F6]">
            <td className={pcell} colSpan={2}>GENEL TOPLAM</td>
            {showOpen && <><td className={pnum}>{pmoney(sum("open_d"))}</td><td className={pnum}>{pmoney(sum("open_c"))}</td></>}
            <td className={pnum}>{pmoney(sum("per_d"))}</td><td className={pnum}>{pmoney(sum("per_c"))}</td><td className={pnum}>{pmoney(sum("tot_d"))}</td><td className={pnum}>{pmoney(sum("tot_c"))}</td><td className={pnum}>{pmoney(sum("bal_d"))}</td><td className={pnum}>{pmoney(sum("bal_c"))}</td>
          </tr>
        </tfoot>
      </table>
      {!rows.length && <p>Bu dönemde kayıtlı fiş yok.</p>}
    </PrintShell>
  );
}
