import Link from "next/link";
import QRCode from "qrcode";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { FLOW_ACTION, FLOW_STAGE, since } from "@/lib/flow";

type H = { at: string; action: string; stage: string; who: string | null; target: string | null; reason: string | null; minutes: number | null; station: string | null };

/** İş kartında kutu akışı: QR, şu anki aşama, kimin elinde, okutma geçmişi */
export async function JobFlow({ job }: { job: { id: string; no: number; flow_stage?: string | null; holder_employee_id?: string | null; holder_since?: string | null; chief_passed_at?: string | null; qc_passed_at?: string | null } }) {
  const supabase = await createClient();
  const [{ data: tl, error }, { data: holder }] = await Promise.all([
    supabase.rpc("prd_job_timeline", { p_job: job.id }),
    job.holder_employee_id ? supabase.from("employees").select("first_name, last_name").eq("id", job.holder_employee_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const qr = await QRCode.toString(`IS${job.no}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const stage = FLOW_STAGE[job.flow_stage ?? "reception"] ?? FLOW_STAGE.reception!;
  const order = ["reception", "production", "chief", "qc", "dispatch", "out"];
  const cur = order.indexOf(job.flow_stage ?? "reception");
  const hist = (tl ?? []) as H[];

  return (
    <Card title="Kutu akışı" action={<span className="flex gap-3 text-sm font-semibold"><Link href={`/yazdir/is-etiket/${job.id}`} className="text-brand-700">Kutu etiketi</Link><Link href={`/yazdir/beyan?is=${job.id}`} className="text-brand-700">Uygunluk beyanı</Link><Link href={`/uretim/nerede?ara=${job.no}`} className="text-brand-700">İş nerede</Link></span>}>
      {error ? <p className="text-sm text-muted">Kutu akışı için Supabase&apos;de 20261209000000_job_flow.sql çalıştırılmalı.</p> : (
        <div className="grid gap-4 md:grid-cols-[150px_1fr]">
          <div className="flex flex-col items-center gap-1">
            <div className="w-[130px] h-[130px] [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <span className="font-mono text-xs text-muted">IS{job.no}</span>
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            <ol className="flex flex-wrap gap-1 text-xs font-semibold">
              {order.map((k, i) => (
                <li key={k} className={`px-2.5 py-1 rounded-full border ${i === cur ? "text-white border-transparent" : i < cur ? "border-[#CFE3D6] bg-ok-bg text-ok" : "border-line text-muted"}`} style={i === cur ? { background: FLOW_STAGE[k]?.[1] } : undefined}>
                  {i < cur ? "✓ " : ""}{FLOW_STAGE[k]?.[0]}
                </li>
              ))}
            </ol>
            <p className="text-sm">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: stage[1] }} />
              <b>{stage[0]}</b> · {holder ? <>şu an <b>{holder.first_name} {holder.last_name}</b> elinde ({since(job.holder_since ?? null)})</> : job.flow_stage === "out" ? "çıkış yapıldı" : "sırada, kimsede değil"}
              {job.chief_passed_at && <span className="text-muted"> · şef onaylı</span>}{job.qc_passed_at && <span className="text-muted"> · kalite onaylı</span>}
            </p>
            {hist.length > 0 ? (
              <ul className="max-h-64 overflow-y-auto divide-y divide-[#EEF2F6] text-sm">
                {hist.map((h, i) => (
                  <li key={i} className="py-1.5">
                    <span className="num text-muted mr-2">{new Date(h.at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <b>{h.who ?? "Sistem"}</b> {FLOW_ACTION[h.action] ?? h.action}{h.station ? ` · ${h.station}` : ""}{h.minutes ? ` · ${h.minutes} dk` : ""}
                    {h.action === "reject" && <span className="block text-bad text-xs">{h.target ? `→ ${h.target}: ` : ""}{h.reason}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Kutu henüz okutulmadı. Etiketi basıp kutuya yapıştırın; personel Kutu okut ekranından okutur.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
