import { redirect } from "next/navigation";
import { PrintShell, PeriodTools, pcell, pdate, pmoney, pnum } from "@/components/ledger/PrintShell";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { DOC_TYPE, VOUCHER_KIND, period } from "@/lib/gl";

export const dynamic = "force-dynamic";

type V = { id: string; year: number; no: number; journal_no: number | null; voucher_date: string; kind: string; description: string | null; doc_type: string | null; doc_no: string | null; doc_date: string | null; status: string };
type L = { voucher_id: string; sort: number; debit: number; credit: number; description: string | null; gl_accounts: { code: string; name: string } | null };

/** Muhasebe fişi çıktısı: ?id=<fiş> tek fiş, ya da ?bas=&bit= dönemdeki tüm kayıtlı fişler (her fiş ayrı blok) */
export default async function VoucherPrint({ searchParams }: { searchParams: Promise<{ id?: string; bas?: string; bit?: string; tur?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const single = sp.id && /^[0-9a-f-]{36}$/.test(sp.id) ? sp.id : null;
  const { from, to } = period(sp);
  let q = supabase.from("gl_vouchers").select("id, year, no, journal_no, voucher_date, kind, description, doc_type, doc_no, doc_date, status").order("voucher_date").order("no").limit(500);
  q = single ? q.eq("id", single) : q.eq("status", "posted").gte("voucher_date", from).lte("voucher_date", to);
  if (!single && sp.tur && sp.tur in VOUCHER_KIND) q = q.eq("kind", sp.tur);
  const { data: vs } = await q;
  const vouchers = (vs ?? []) as V[];
  const { data: ls } = vouchers.length ? await supabase.from("gl_lines").select("voucher_id, sort, debit, credit, description, gl_accounts(code, name)").in("voucher_id", vouchers.map((v) => v.id)).order("sort") : { data: [] };
  const lines = (ls ?? []) as unknown as L[];
  const by = new Map<string, L[]>();
  for (const l of lines) by.set(l.voucher_id, [...(by.get(l.voucher_id) ?? []), l]);
  return (
    <PrintShell
      title={single && vouchers[0] ? `${(VOUCHER_KIND[vouchers[0].kind] ?? "").toUpperCase()} FİŞİ` : "MUHASEBE FİŞLERİ"}
      sub={single && vouchers[0] ? `Fiş ${vouchers[0].year}/${vouchers[0].no}` : `${pdate(from)} – ${pdate(to)} · ${vouchers.length} fiş`}
      back={single ? `/muhasebe/fisler/${single}` : "/muhasebe/fisler"}
      tools={single ? undefined : <PeriodTools from={from} to={to} extra={{ tur: sp.tur }} />}
    >
      {vouchers.length >= 500 && <p className="print:hidden text-[#B45309]">İlk 500 fiş gösteriliyor; dönemi daraltın.</p>}
      {vouchers.map((v) => {
        const ls2 = by.get(v.id) ?? [];
        const d = ls2.reduce((x, l) => x + Number(l.debit), 0);
        const c = ls2.reduce((x, l) => x + Number(l.credit), 0);
        return (
          <section key={v.id} className="flex flex-col gap-1 break-inside-avoid mb-3">
            <div className="flex flex-wrap justify-between gap-2 border border-black px-2 py-1 font-semibold">
              <span>{VOUCHER_KIND[v.kind] ?? v.kind} fişi · No {v.year}/{v.no}{v.journal_no ? ` · Yevmiye ${v.journal_no}` : ""}</span>
              <span>Tarih: {pdate(v.voucher_date)}</span>
              {v.doc_no && <span>{DOC_TYPE[v.doc_type ?? "other"] ?? ""}: {v.doc_no}{v.doc_date ? ` (${pdate(v.doc_date)})` : ""}</span>}
              {v.status !== "posted" && <span className="text-[#B91C1C]">{v.status === "cancelled" ? "İPTAL" : v.status.toUpperCase()}</span>}
            </div>
            {v.description && <div className="px-1">Açıklama: {v.description}</div>}
            <table className="w-full border-collapse">
              <thead><tr className="bg-[#EEF2F6]"><th className={`${pcell} text-left w-[24mm]`}>Hesap kodu</th><th className={`${pcell} text-left`}>Hesap adı</th><th className={`${pcell} text-left`}>Açıklama</th><th className={`${pcell} text-right w-[26mm]`}>Borç</th><th className={`${pcell} text-right w-[26mm]`}>Alacak</th></tr></thead>
              <tbody>
                {ls2.map((l, i) => (
                  <tr key={i}><td className={`${pcell} tabular-nums`}>{l.gl_accounts?.code}</td><td className={pcell}>{l.gl_accounts?.name}</td><td className={pcell}>{l.description}</td><td className={pnum}>{pmoney(l.debit)}</td><td className={pnum}>{pmoney(l.credit)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="font-bold"><td className={pcell} colSpan={3}>Toplam</td><td className={pnum}>{pmoney(d)}</td><td className={pnum}>{pmoney(c)}</td></tr></tfoot>
            </table>
            {single && (
              <div className="grid grid-cols-3 gap-4 mt-8 text-center">
                {["Düzenleyen", "Kontrol eden", "Onaylayan"].map((t) => <div key={t} className="border-t border-black pt-1">{t}</div>)}
              </div>
            )}
          </section>
        );
      })}
      {!vouchers.length && <p>Fiş bulunamadı.</p>}
    </PrintShell>
  );
}
