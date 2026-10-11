import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { createClient } from "@/lib/supabase/server";
import type { PackData } from "@/lib/qc-actions";

export const dynamic = "force-dynamic";

/** Paket etiketi (10×15 cm termal ya da A6): hekim, işler, paketleyen, QR */
export default async function PackLabel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("prd_pack_get", { p_package: id });
  if (!data) notFound();
  const p = data as PackData;
  const qr = await QRCode.toString(`PK:${p.id}`, { type: "svg", margin: 0 });
  return (
    <div className="flex flex-col items-center gap-4 p-4 print:p-0">
      <div className="print:hidden"><PrintButton /></div>
      <div className="w-[100mm] min-h-[150mm] rounded-lg border border-ink bg-white p-[6mm] text-ink print:rounded-none">
        <div className="flex items-start gap-3 border-b-2 border-ink pb-2">
          <div className="flex-1"><div className="text-[10px] uppercase tracking-widest">Hekim / klinik</div><div className="text-[20px] font-black leading-tight">{p.customer ?? "—"}</div></div>
          <span className="h-[26mm] w-[26mm] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
        <div className="mt-2 flex justify-between text-[12px]"><b className="font-mono">{p.no}</b><span>{new Date(p.closed_at ?? p.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</span></div>
        <table className="mt-2 w-full text-[11px]">
          <thead><tr className="border-b border-ink text-left"><th>İş</th><th>Hasta</th><th className="text-right">Birim</th></tr></thead>
          <tbody>{p.jobs.map((j) => <tr key={j.id} className="border-b border-dashed border-[#999]"><td className="py-1 font-mono">#{j.no}</td><td className="py-1">{j.patient ?? "—"}<span className="block text-[9px] text-[#555]">{j.items ?? ""}</span></td><td className="py-1 text-right">{j.qty}</td></tr>)}</tbody>
        </table>
        <div className="mt-3 flex justify-between border-t-2 border-ink pt-2 text-[12px]"><span>Toplam <b>{p.jobs.length}</b> iş · <b>{p.jobs.reduce((n, j) => n + Number(j.qty), 0)}</b> birim</span><span>Paketleyen: <b>{p.packer ?? "—"}</b></span></div>
      </div>
    </div>
  );
}
