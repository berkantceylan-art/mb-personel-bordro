import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { ITEM_KIND, LOWER, MATERIALS, METAL_BAND, RECEIVED, UPPER, money, type ItemKind, type Job } from "@/lib/jobs";
import { AutoPrint } from "./AutoPrint";

export const dynamic = "force-dynamic";

/** İş emri (A5): laboratuvar içi takip ve kutuya konacak fiş. ?fiyat=0 fiyatsız çıktı */
export default async function JobPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ yazdir?: string; fiyat?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const withPrice = sp.fiyat !== "0";
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const job = data as Job;
  const [{ data: cust }, { data: items }, { data: steps }] = await Promise.all([
    job.customer_id ? supabase.from("lab_customers").select("name, phone, city").eq("id", job.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("job_items").select("name, qty, unit_price, amount, kind").eq("job_id", id).order("sort"),
    supabase.from("job_steps").select("kind, out_date, back_date, delivery_method, delivery_time, done").eq("job_id", id).order("sort"),
  ]);
  const c = cust as { name: string; phone: string | null; city: string | null } | null;
  const rows = (items ?? []) as { name: string; qty: number; unit_price: number; amount: number; kind: ItemKind }[];
  const st = (steps ?? []) as { kind: string; out_date: string | null; back_date: string | null; delivery_method: string | null; delivery_time: string | null; done: boolean }[];
  const cell = "border border-[#9AA7B4] px-2 py-1";

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white text-[12px] text-black">
      <style>{`@page { size: A5; margin: 8mm; }`}</style>
      <AutoPrint on={sp.yazdir === "1"} />
      <div className="print:hidden sticky top-0 bg-white border-b border-[#E1E7EE] px-4 py-3 flex flex-wrap items-center gap-3">
        <Link href={`/isler/${job.id}`} className="font-semibold text-[#0A3D73]">← İşe dön</Link>
        <PrintButton />
        <Link href={`/yazdir/is/${job.id}?fiyat=${withPrice ? "0" : "1"}`} className="text-sm font-semibold text-[#0A3D73]">{withPrice ? "Fiyatsız çıktı" : "Fiyatlı çıktı"}</Link>
        <Link href="/isler/yeni" className="ml-auto text-sm font-semibold text-[#0A3D73]">+ Yeni iş</Link>
      </div>
      <div className="max-w-[140mm] mx-auto bg-white my-6 print:my-0 p-5 print:p-0 flex flex-col gap-3">
        <header className="flex items-start justify-between gap-3 border-b-2 border-black pb-2">
          <div>
            <div className="text-[15px] font-bold">MB DENTAL</div>
            <div className="text-[10px]">İş emri</div>
          </div>
          <div className="text-right">
            <div className="text-[24px] font-black leading-none">#{job.no}</div>
            {job.slip_no && <div className="text-[10px]">Fiş: {job.slip_no}</div>}
          </div>
        </header>

        {job.print_note && <div className="border-2 border-black bg-[#FFE9A8] px-2 py-1.5 font-bold text-[13px]">⚠ {job.print_note}</div>}

        <table className="w-full border-collapse">
          <tbody>
            <tr><td className={`${cell} w-28 font-semibold`}>Hekim / hastane</td><td className={cell}>{c?.name ?? "—"}{c?.city ? ` · ${c.city}` : ""}</td></tr>
            {job.doctor_name && <tr><td className={`${cell} font-semibold`}>Doktor</td><td className={cell}>{job.doctor_name}</td></tr>}
            <tr><td className={`${cell} font-semibold`}>Hasta</td><td className={cell}>{job.patient ?? "—"}</td></tr>
            <tr><td className={`${cell} font-semibold`}>Renk</td><td className={cell}>{[job.shade, job.shade_cervical ? `cervical ${job.shade_cervical}` : "", job.shade_incisal ? `incisal ${job.shade_incisal}` : ""].filter(Boolean).join(" · ") || "—"}</td></tr>
            <tr><td className={`${cell} font-semibold`}>Giriş / çıkış</td><td className={cell}>{formatDate(job.in_date)} → <b>{job.due_date ? formatDate(job.due_date) : "—"}</b>{job.delivery_time ? ` ${job.delivery_time}` : ""}{job.delivery_method ? ` · ${job.delivery_method}` : ""}</td></tr>
            {(job.received.length > 0 || job.metal_band) && (
              <tr><td className={`${cell} font-semibold`}>Gelen</td><td className={cell}>{job.received.map((r) => RECEIVED[r] ?? r).join(", ")}{job.metal_band ? `${job.received.length ? " · " : ""}${METAL_BAND[job.metal_band]}` : ""}</td></tr>
            )}
          </tbody>
        </table>

        <div className="flex flex-col gap-0.5 items-center">
          {[UPPER, LOWER].map((row, ri) => (
            <div key={ri} className={`flex gap-0.5 ${ri === 0 ? "border-b border-black pb-0.5" : "pt-0.5"}`}>
              {row.map((t, i) => {
                const m = job.teeth[String(t)];
                return (
                  <span key={t} className={`w-[7.4mm] h-[7mm] grid place-items-center border text-[10px] font-bold ${i === 7 ? "mr-1" : ""}`} style={m ? { background: MATERIALS[m]?.[1], color: "#fff", borderColor: "#000", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } : { borderColor: "#B5C0CB" }}>
                    {t}
                  </span>
                );
              })}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 mt-1 text-[10px]">
            {[...new Set(Object.values(job.teeth))].map((m) => (
              <span key={m}><span className="inline-block w-2.5 h-2.5 mr-1 align-middle" style={{ background: MATERIALS[m]?.[1], printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} />{MATERIALS[m]?.[0]}: {Object.values(job.teeth).filter((x) => x === m).length}</span>
            ))}
          </div>
        </div>

        {job.description && <div className="border border-[#9AA7B4] px-2 py-1.5 whitespace-pre-line"><b>Açıklama:</b> {job.description}</div>}

        {rows.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#EEF2F6]"><th className={`${cell} text-left`}>Protez / ürün</th><th className={`${cell} text-right w-12`}>Üye</th>{withPrice && <><th className={`${cell} text-right`}>Fiyat</th><th className={`${cell} text-right`}>Tutar</th></>}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={cell}>{r.name}{r.kind !== "paid" ? ` (${ITEM_KIND[r.kind]})` : ""}</td>
                  <td className={`${cell} text-right`}>{r.qty}</td>
                  {withPrice && <><td className={`${cell} text-right`}>{money(r.unit_price, job.currency)}</td><td className={`${cell} text-right`}>{money(r.amount, job.currency)}</td></>}
                </tr>
              ))}
              {withPrice && <tr><td colSpan={3} className={`${cell} text-right font-bold`}>Toplam</td><td className={`${cell} text-right font-bold`}>{money(job.total, job.currency)}</td></tr>}
            </tbody>
          </table>
        )}

        {st.length > 0 && (
          <table className="w-full border-collapse">
            <thead><tr className="bg-[#EEF2F6]"><th className={`${cell} text-left`}>Prova / teslim</th><th className={`${cell} text-left`}>Çıkış</th><th className={`${cell} text-left`}>Dönüş</th><th className={`${cell} text-left`}>Teslim şekli</th></tr></thead>
            <tbody>
              {st.map((x, i) => (
                <tr key={i}>
                  <td className={cell}>{x.done ? "✓ " : ""}{x.kind}</td>
                  <td className={cell}>{x.out_date ? formatDate(x.out_date) : ""}{x.delivery_time ? ` ${x.delivery_time}` : ""}</td>
                  <td className={cell}>{x.back_date ? formatDate(x.back_date) : ""}</td>
                  <td className={cell}>{x.delivery_method ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <footer className="text-[9px] text-[#55606B] flex justify-between pt-1 border-t border-[#B5C0CB]">
          <span>Yazdırma: {new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</span>
          <span>MB Dental ERP</span>
        </footer>
      </div>
    </main>
  );
}
