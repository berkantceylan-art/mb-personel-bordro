import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { EmployeeTimesheet } from "@/components/EmployeeTimesheet";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod, getSession, periodLabel } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Personel aylık puantaj / giriş-çıkış çizelgesi (A4, imzalı) — ?donem=YYYY-AA */
export default async function TimesheetPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  const { id } = await params;
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.donem ?? "") ? sp.donem! : currentPeriod();
  const sb = await createClient();
  const { data: e } = await sb.from("employees").select("id, first_name, last_name, card_no, position_title, hire_date, departments(name)").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [y, m] = period.split("-").map(Number) as [number, number];
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11px] text-black">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/personel/${id}`} className="font-semibold text-[#0A3D73]">← Personel kartı</Link>
        <Link href={`/yazdir/puantaj/${id}?donem=${prev}`} className="px-2 font-bold">‹</Link><b>{periodLabel(period)}</b><Link href={`/yazdir/puantaj/${id}?donem=${next}`} className="px-2 font-bold">›</Link>
        <PrintButton />
      </div>
      <div className="max-w-[190mm] mx-auto bg-white my-6 print:my-0 p-6 print:p-0 flex flex-col gap-3">
        <header className="flex justify-between border-b-2 border-black pb-2">
          <div><div className="text-[15px] font-bold">{s.companyName || "MB DENTAL"}</div><div>Aylık puantaj ve giriş-çıkış çizelgesi</div></div>
          <div className="text-right">
            <div className="text-[13px] font-bold">{e.first_name} {e.last_name}</div>
            <div>{(e.departments as unknown as { name: string } | null)?.name ?? ""}{e.position_title ? ` · ${e.position_title}` : ""}</div>
            <div>{e.card_no ? `Kart no ${e.card_no} · ` : ""}Dönem: {periodLabel(period)}</div>
          </div>
        </header>
        <EmployeeTimesheet supabase={sb} employeeId={id} period={period} />
        <div className="grid grid-cols-2 gap-10 pt-10 text-center">
          <div className="border-t border-black pt-1">Personel<div className="text-[10px]">{e.first_name} {e.last_name}</div></div>
          <div className="border-t border-black pt-1">İşveren / yetkili</div>
        </div>
        <footer className="text-[9px] text-[#55606B] border-t border-[#B5C0CB] pt-1">PDKS okutmalarından {new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} tarihinde MB Dental ERP ile hazırlanmıştır.</footer>
      </div>
    </main>
  );
}
