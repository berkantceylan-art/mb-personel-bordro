import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { mrNo, qtyFmt } from "@/lib/material";

export const dynamic = "force-dynamic";

const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Malzeme teslim tutanağı (A4): depo sorumlusu ve personel imzalı */
export default async function MaterialPrint({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: r }, { data: lines }, { data: sigs }, { data: co }] = await Promise.all([
    supabase.from("stk_requests").select("id, year, no, status, reason, created_at, delivered_at, employees(first_name, last_name, card_no, departments(name)), stk_warehouses(name)").eq("id", id).maybeSingle(),
    supabase.from("stk_request_lines").select("name, unit, qty, issued_qty, note").eq("request_id", id).order("sort"),
    supabase.from("stk_request_signatures").select("role, signer_name, png, signed_at").eq("request_id", id),
    supabase.from("companies").select("name, address").eq("id", s.companyId).maybeSingle(),
  ]);
  if (!r) notFound(); // RLS: yalnız isteyen personel, depo ve satın alma görebilir
  if (!["delivered", "completed"].includes(r.status as string)) redirect(`/stok/talepler/${id}`);
  const e = r.employees as unknown as { first_name: string; last_name: string; card_no: string | null; departments: { name: string } | null } | null;
  const wh = r.stk_warehouses as unknown as { name: string } | null;
  const sig = new Map(((sigs ?? []) as { role: string; signer_name: string; png: string; signed_at: string }[]).map((x) => [x.role, x]));
  const cell = "border border-[#9AA7B4] px-2 py-1.5";
  const back = (s.modules.stock ?? 0) > 0 || (s.modules.purchases ?? 0) > 0 ? `/stok/talepler/${id}` : "/benim/malzeme";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[12px] text-black">
      <style>{`@page { size: A4; margin: 14mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex gap-3"><Link href={back} className="font-semibold text-[#0A3D73]">← Geri</Link><PrintButton /></div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-8 print:p-0 flex flex-col gap-5">
        <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
          <div><div className="text-[15px] font-bold">{co?.name ?? "MB DENTAL"}</div><div className="text-[10px] max-w-[90mm]">{co?.address ?? ""}</div></div>
          <div className="text-right"><div className="text-[17px] font-bold">MALZEME TESLİM TUTANAĞI</div><div><b>No:</b> {mrNo(r as { year: number; no: number })}</div><div><b>İstek tarihi:</b> {formatDate((r.created_at as string).slice(0, 10))}</div>{r.delivered_at && <div><b>Teslim:</b> {dt(r.delivered_at as string)}</div>}</div>
        </header>
        <section className="grid grid-cols-2 gap-4">
          <div><div className="text-[10px] uppercase tracking-wider text-[#666]">Teslim alan personel</div><div className="text-[14px] font-bold">{e ? `${e.first_name} ${e.last_name}` : ""}</div><div>{[e?.departments?.name, e?.card_no ? `Sicil ${e.card_no}` : null].filter(Boolean).join(" · ")}</div></div>
          <div><div className="text-[10px] uppercase tracking-wider text-[#666]">Çıkış deposu</div><div className="text-[14px] font-bold">{wh?.name ?? "—"}</div>{r.reason && <div>Gerekçe: {r.reason as string}</div>}</div>
        </section>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left w-8`}>#</th><th className={`${cell} text-left`}>Malzeme</th><th className={`${cell} text-right`}>İstenen</th><th className={`${cell} text-right`}>Teslim edilen</th><th className={`${cell} text-left`}>Not</th></tr></thead>
          <tbody>{(lines ?? []).map((l, i) => <tr key={i}><td className={cell}>{i + 1}</td><td className={cell}>{l.name as string}</td><td className={`${cell} text-right`}>{qtyFmt(l.qty as number)} {l.unit as string}</td><td className={`${cell} text-right font-bold`}>{qtyFmt(l.issued_qty as number)} {l.unit as string}</td><td className={cell}>{(l.note as string) ?? ""}</td></tr>)}</tbody>
        </table>
        <p className="text-[11px]">Yukarıda yazılı malzemeler eksiksiz ve sağlam olarak teslim edilmiş / teslim alınmıştır. Bu tutanak elektronik ortamda imzalanmıştır.</p>
        <div className="grid grid-cols-2 gap-10 pt-4">
          {(["warehouse", "employee"] as const).map((k) => {
            const x = sig.get(k);
            return (
              <div key={k} className="text-center">
                <div className="h-24 flex items-end justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {x && <img src={x.png} alt="İmza" className="max-h-24 max-w-full" />}
                </div>
                <div className="border-t border-black pt-1 font-semibold">{k === "warehouse" ? "Teslim eden (depo sorumlusu)" : "Teslim alan (personel)"}</div>
                <div>{x ? x.signer_name : "İmza bekleniyor"}</div>
                {x && <div className="text-[10px] text-[#555]">{dt(x.signed_at)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
