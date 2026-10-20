import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "");

/** Dış laboratuvara günlük gönderim listesi (A4, teslim tutanağı) */
export default async function OutsourceBatchPrint({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const sb = await createClient();
  const { data: b } = await sb.from("outsource_batches").select("id, no, sent_at, note, fin_parties(name, phone)").eq("id", id).maybeSingle();
  if (!b) notFound();
  const { data: rows } = await sb.from("job_outsource").select("id, status, jobs(id, no, patient, doctor_name, due_date, description, teeth, lab_customers(name), job_items(name, qty, sort))").eq("batch_id", id);
  const { data: co } = await sb.from("companies").select("name").eq("id", s.companyId).maybeSingle();
  type J = { id: string; no: number; patient: string | null; doctor_name: string | null; due_date: string | null; description: string | null; teeth: Record<string, string> | null; lab_customers: { name: string } | null; job_items: { name: string; qty: number; sort: number }[] };
  const list = ((rows ?? []) as unknown as { id: string; status: string; jobs: J | null }[]).filter((r) => r.jobs).sort((a, b) => a.jobs!.no - b.jobs!.no);
  const lab = b.fin_parties as unknown as { name: string; phone: string | null } | null;
  const at = new Date(b.sent_at as string);
  const cell = "border border-black/60 px-2 py-1.5 align-top";
  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[11.5px] text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex items-center gap-3">
        <Link href="/isler/ortodonti" className="font-semibold text-[#0A3D73]">← Ortodonti</Link>
        <PrintButton />
      </div>
      <div className="mx-auto my-6 print:my-0 bg-white w-[210mm] max-w-full p-[12mm] print:p-0 shadow print:shadow-none">
        <div className="flex justify-between items-start border-b-2 border-black pb-2 mb-3">
          <div><p className="text-lg font-bold">{co?.name ?? "MB Dental"}</p><p>Dış laboratuvar gönderim listesi</p></div>
          <div className="text-right"><p className="text-lg font-bold">Liste #{b.no}</p><p>{day(b.sent_at as string)} {at.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</p></div>
        </div>
        <p className="mb-2"><b>Gönderilen laboratuvar:</b> {lab?.name}{lab?.phone ? ` · ${lab.phone}` : ""} · <b>{list.length} iş</b></p>
        {b.note && <p className="mb-2"><b>Not:</b> {b.note as string}</p>}
        <table className="w-full border-collapse">
          <thead><tr className="bg-black/5"><th className={cell}>#</th><th className={cell}>İş no</th><th className={cell}>Hekim</th><th className={cell}>Hasta</th><th className={cell}>Ürün</th><th className={cell}>Dişler</th><th className={cell}>İstenen teslim</th><th className={cell}>Açıklama</th></tr></thead>
          <tbody>
            {list.map((r, i) => { const j = r.jobs!; return (
              <tr key={r.id}>
                <td className={cell}>{i + 1}</td>
                <td className={`${cell} font-bold`}>{j.no}</td>
                <td className={cell}>{j.lab_customers?.name ?? ""}{j.doctor_name && j.doctor_name !== j.lab_customers?.name ? ` / ${j.doctor_name}` : ""}</td>
                <td className={cell}>{j.patient ?? ""}</td>
                <td className={cell}>{[...(j.job_items ?? [])].sort((a, b) => a.sort - b.sort).map((x) => `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ""}`).join(", ")}</td>
                <td className={cell}>{Object.keys(j.teeth ?? {}).sort().join(" ")}</td>
                <td className={cell}>{day(j.due_date)}</td>
                <td className={cell}>{(j.description ?? "").slice(0, 160)}</td>
              </tr>); })}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-8 mt-10">
          <div className="border-t border-black pt-1">Teslim eden (ad, imza)</div>
          <div className="border-t border-black pt-1">Teslim alan — {lab?.name} (ad, imza, tarih)</div>
        </div>
      </div>
    </main>
  );
}
