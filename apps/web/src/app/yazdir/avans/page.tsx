import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PrintButton } from "@/components/PrintButton";
import { TYPE_LABEL } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, formatDate, getSession, periodLabel } from "@/lib/session";
import { amountInWords } from "@/lib/words";

export const dynamic = "force-dynamic";

type Entry = {
  id: string; employee_id: string; entry_date: string; period: string; type: string; channel: string; amount: number; note: string | null; signature_path: string | null;
  employees: { first_name: string; last_name: string; card_no: string | null; departments: { name: string } | null } | null;
};

/**
 * Avans / maaş ödeme makbuzları. A4'e iki makbuz (A5) sığar.
 * ?ids=a,b,c  ya da  ?bas=2026-10-01&bit=2026-10-31&tur=ADVANCE&kanal=CASH&bolum=ALÇI
 */
export default async function AdvanceReceipts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!canManagePay(s.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("ledger_entries")
    .select("id, employee_id, entry_date, period, type, channel, amount, note, signature_path, employees(first_name, last_name, card_no, departments(name))")
    .is("voided_at", null)
    .in("type", ["ADVANCE", "SALARY"])
    .order("entry_date")
    .order("created_at");
  const ids = (sp.ids ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (ids.length) q = q.in("id", ids);
  else {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (sp.bas && iso.test(sp.bas)) q = q.gte("entry_date", sp.bas);
    if (sp.bit && iso.test(sp.bit)) q = q.lte("entry_date", sp.bit);
    q = q.eq("type", sp.tur === "SALARY" ? "SALARY" : "ADVANCE");
    if (sp.kanal === "CASH" || sp.kanal === "BANK") q = q.eq("channel", sp.kanal);
    if (!sp.bas && !sp.bit) q = q.limit(0);
  }
  const { data } = await q;
  let entries = (data ?? []) as unknown as Entry[];
  if (sp.bolum) entries = entries.filter((e) => e.employees?.departments?.name === sp.bolum);

  const empIds = [...new Set(entries.map((e) => e.employee_id))];
  const sigPaths = entries.map((e) => e.signature_path).filter(Boolean) as string[];
  const [{ data: privs }, signed] = await Promise.all([
    empIds.length ? supabase.from("employee_private").select("employee_id, national_id").in("employee_id", empIds) : Promise.resolve({ data: [] }),
    sigPaths.length ? supabase.storage.from("documents").createSignedUrls(sigPaths, 600) : Promise.resolve({ data: [] }),
  ]);
  const tc = new Map((privs ?? []).map((p) => [p.employee_id as string, p.national_id as string | null]));
  const sigUrl = new Map(((signed.data ?? []) as Array<{ path: string | null; signedUrl: string }>).map((u) => [u.path ?? "", u.signedUrl]));
  const total = entries.reduce((a, e) => a + Number(e.amount), 0);

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[#14202E]">
      <style>{`@page { size: A4; margin: 8mm; } .slip { break-inside: avoid; height: 136mm; } .slip:nth-child(2n) { break-after: page; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-6 py-3 flex flex-wrap items-center gap-4">
        <span className="font-semibold">{entries.length} makbuz · toplam {formatTL(total)}</span>
        <PrintButton />
        <span className="text-xs text-[#5A6878]">Her A4 sayfaya iki makbuz basılır; ortadan kesilebilir.</span>
      </div>
      <div className="max-w-[194mm] mx-auto py-6 print:py-0 flex flex-col gap-4 print:gap-0">
        {entries.map((e, i) => {
          const name = `${e.employees?.first_name ?? ""} ${e.employees?.last_name ?? ""}`.trim();
          const no = `${e.entry_date.replaceAll("-", "")}-${String(i + 1).padStart(3, "0")}`;
          const sig = e.signature_path ? sigUrl.get(e.signature_path) : undefined;
          return (
            <section key={e.id} className="slip bg-white border border-[#C5D0DC] print:border-0 print:border-b print:border-dashed rounded-lg print:rounded-none p-6 flex flex-col">
              <header className="flex justify-between items-start border-b-2 border-[#0A3D73] pb-2 mb-4">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.svg" alt="" className="w-11 h-11 object-contain" />
                  <div>
                    <div className="font-bold text-[15px]">{s.companyName}</div>
                    <div className="text-[12px] text-[#5A6878]">{e.type === "ADVANCE" ? "Avans ödeme makbuzu" : "Maaş ödeme makbuzu"}</div>
                  </div>
                </div>
                <div className="text-right text-[12px]">
                  <div>No: <b className="tabular-nums">{no}</b></div>
                  <div>Tarih: <b>{formatDate(e.entry_date)}</b></div>
                </div>
              </header>
              <table className="w-full text-[13px]">
                <tbody>
                  <tr><td className="text-[#5A6878] w-36 py-1">Adı soyadı</td><td className="font-semibold">{name}</td><td className="text-[#5A6878] w-28">TC kimlik no</td><td className="tabular-nums">{tc.get(e.employee_id) ?? "—"}</td></tr>
                  <tr><td className="text-[#5A6878] py-1">Bölüm</td><td>{e.employees?.departments?.name ?? "—"}</td><td className="text-[#5A6878]">PDKS no</td><td>{e.employees?.card_no ?? "—"}</td></tr>
                  <tr><td className="text-[#5A6878] py-1">Ödeme şekli</td><td>{e.channel === "BANK" ? "Banka havalesi" : "Elden (nakit)"}</td><td className="text-[#5A6878]">Ait olduğu ay</td><td>{periodLabel(e.period)}</td></tr>
                  <tr><td className="text-[#5A6878] py-1">Hareket</td><td colSpan={3}>{TYPE_LABEL[e.type]}{e.note ? ` · ${e.note}` : ""}</td></tr>
                </tbody>
              </table>
              <div className="mt-4 rounded-lg border-2 border-[#0A3D73] px-4 py-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12px] text-[#5A6878]">Tutar</span>
                <span className="text-[24px] font-bold tabular-nums">{formatTL(Number(e.amount))}</span>
                <span className="w-full text-[12px] italic">{amountInWords(Number(e.amount))}</span>
              </div>
              <p className="text-[11.5px] mt-3">
                Yukarıda yazılı tutarı {e.type === "ADVANCE" ? `${periodLabel(e.period)} ayı ücretime mahsuben avans olarak` : `${periodLabel(e.period)} ayı ücretim olarak`} {e.channel === "BANK" ? "banka hesabıma" : "elden ve nakden"} aldım.
              </p>
              <div className="mt-auto grid grid-cols-2 gap-8 text-[12px] pt-4">
                <div className="text-center">
                  <div className="h-14" />
                  <div className="border-t border-[#14202E] pt-1">Ödeyen (ad soyad / imza)</div>
                </div>
                <div className="text-center">
                  <div className="h-14 flex items-end justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {sig && <img src={sig} alt="Personel imzası" className="max-h-14 object-contain" />}
                  </div>
                  <div className="border-t border-[#14202E] pt-1">Teslim alan: {name}</div>
                </div>
              </div>
            </section>
          );
        })}
        {entries.length === 0 && <p className="text-center text-[#5A6878] py-10">Yazdırılacak avans/maaş ödemesi bulunamadı.</p>}
      </div>
    </main>
  );
}
