import Link from "next/link";
import QRCode from "qrcode";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Kutu etiketi (10×6 cm ya da A4'te 6'lı): büyük QR (IS{no}) — her bölüm kutuyu bununla okutur. ?adet=2&boyut=a4 */
export default async function BoxLabel({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ adet?: string; boyut?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const a4 = sp.boyut === "a4";
  const copies = Math.min(12, Math.max(1, Number(sp.adet) || 1));
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, no, patient, doctor_name, customer_id, due_date, in_date").eq("id", id).maybeSingle();
  if (!job) notFound();
  const [{ data: cust }, { data: items }] = await Promise.all([
    job.customer_id ? supabase.from("lab_customers").select("name").eq("id", job.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("job_items").select("name, qty").eq("job_id", id).order("sort"),
  ]);
  const qr = await QRCode.toString(`IS${job.no}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const work = ((items ?? []) as { name: string; qty: number }[]).map((i) => `${i.qty}× ${i.name}`).join(", ");
  const list = Array.from({ length: copies }, (_, i) => i);
  const href = (patch: Record<string, string>) => `/yazdir/is-etiket/${id}?${new URLSearchParams({ adet: String(copies), ...(a4 ? { boyut: "a4" } : {}), ...patch })}`;

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-black">
      <style>{a4 ? "@page { size: A4; margin: 8mm; }" : "@page { size: 100mm 60mm; margin: 0; }"}</style>
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/isler/${id}`} className="font-semibold text-[#0A3D73]">← İşe dön</Link>
        <PrintButton />
        <span className="flex gap-2 text-sm">
          <Link href={href({ boyut: "" })} className={`px-2.5 py-1 rounded-full border ${!a4 ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>Etiket yazıcı 10×6</Link>
          <Link href={href({ boyut: "a4" })} className={`px-2.5 py-1 rounded-full border ${a4 ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>A4 (6&apos;lı)</Link>
        </span>
        <span className="ml-auto flex gap-2 text-sm">
          {[1, 2, 3].map((n) => <Link key={n} href={href({ adet: String(n) })} className={`px-2.5 py-1 rounded-full border ${n === copies ? "bg-[#0A3D73] text-white border-[#0A3D73]" : "border-[#D5DEE8]"}`}>{n} adet</Link>)}
        </span>
      </div>
      <div className={a4 ? "mx-auto my-6 print:m-0 bg-white w-[194mm] grid grid-cols-2 gap-[3mm] p-[2mm] print:p-0" : "flex flex-col items-center gap-4 py-6 print:p-0 print:gap-0"}>
        {list.map((i) => (
          <div key={i} className={`w-[100mm] h-[60mm] bg-white border border-[#9AA7B4] print:border-0 ${a4 ? "print:border print:border-[#9AA7B4]" : ""} p-[3mm] flex gap-[3mm] items-stretch overflow-hidden break-inside-avoid break-after-page`}>
            <div className="w-[46mm] shrink-0 flex flex-col items-center justify-center">
              <div className="w-[44mm] h-[44mm] [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <span className="font-mono text-[9pt] mt-[1mm]">IS{job.no}</span>
            </div>
            <div className="min-w-0 flex flex-col gap-[1mm] leading-tight">
              <b className="text-[22pt] leading-none">#{job.no}</b>
              <span className="text-[12pt] font-bold line-clamp-2">{job.patient ?? "—"}</span>
              <span className="text-[9pt] line-clamp-2">{cust?.name ?? ""}{job.doctor_name ? ` · ${job.doctor_name}` : ""}</span>
              {work && <span className="text-[8pt] line-clamp-3">{work}</span>}
              <span className="mt-auto text-[9pt]">Giriş {formatDate(job.in_date)}</span>
              {job.due_date && <b className="text-[11pt]">Teslim {formatDate(job.due_date)}</b>}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
