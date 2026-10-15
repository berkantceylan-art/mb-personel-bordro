import { redirect } from "next/navigation";
import { PrintShell, pdate, pmoney } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { gl_group_label } from "@/lib/gl-groups";

export const dynamic = "force-dynamic";

type R = { code: string; name: string; side: "aktif" | "pasif"; amount: number };

function Side({ title, rows, classes }: { title: string; rows: R[]; classes: string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-bold text-[12px] border-b-2 border-black pb-0.5">{title}</div>
      {classes.map((c) => {
        const inC = rows.filter((r) => r.code.startsWith(c));
        if (!inC.length) return null;
        return (
          <div key={c} className="mb-1">
            <div className="flex justify-between font-bold border-b border-[#9AA7B4]"><span>{gl_group_label(c)}</span><span className="tabular-nums">{pmoney(inC.reduce((x, r) => x + Number(r.amount), 0))}</span></div>
            {[...new Set(inC.map((r) => r.code.slice(0, 2)))].map((g) => {
              const inG = inC.filter((r) => r.code.startsWith(g));
              return (
                <div key={g}>
                  <div className="flex justify-between font-semibold pl-2"><span>{gl_group_label(g)}</span><span className="tabular-nums">{pmoney(inG.reduce((x, r) => x + Number(r.amount), 0))}</span></div>
                  {inG.map((r) => <div key={r.code} className="flex justify-between pl-5"><span><span className="tabular-nums mr-1">{r.code}</span>{r.name}</span><span className="tabular-nums">{Number(r.amount) < 0 ? `(${pmoney(-Number(r.amount))})` : pmoney(r.amount)}</span></div>)}
                </div>
              );
            })}
          </div>
        );
      })}
      <div className="flex justify-between font-bold border-t-2 border-black mt-auto pt-0.5"><span>{title} TOPLAMI</span><span className="tabular-nums">{pmoney(rows.reduce((x, r) => x + Number(r.amount), 0))}</span></div>
    </div>
  );
}

/** Bilanço çıktısı */
export default async function BalanceSheetPrint({ searchParams }: { searchParams: Promise<{ tarih?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const date = sp.tarih && /^\d{4}-\d{2}-\d{2}$/.test(sp.tarih) ? sp.tarih : new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data } = await supabase.rpc("gl_balance_sheet", { p_date: date });
  const rows = (data ?? []) as R[];
  return (
    <PrintShell title="BİLANÇO" sub={`${pdate(date)} tarihli`} back={`/muhasebe/bilanco?tarih=${date}`}
      tools={<form className="flex items-center gap-2"><input type="date" name="tarih" defaultValue={date} className="h-9 rounded border border-[#D5DEE8] px-2" /><button className="h-9 px-3 rounded bg-[#0A3D73] text-white font-semibold">Uygula</button></form>}>
      <div className="grid grid-cols-2 gap-6">
        <Side title="AKTİF" rows={rows.filter((r) => r.side === "aktif")} classes={["1", "2"]} />
        <Side title="PASİF" rows={rows.filter((r) => r.side === "pasif")} classes={["3", "4", "5"]} />
      </div>
      {!rows.length && <p>Bu tarihe kadar kayıtlı fiş yok.</p>}
    </PrintShell>
  );
}
