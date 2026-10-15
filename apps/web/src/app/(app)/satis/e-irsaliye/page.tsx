import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Notice, Table, page, td } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { EINV_SEND_STATUS } from "@/lib/einv-codes";

export const dynamic = "force-dynamic";

/** Giden e-İrsaliyeler */
export default async function Despatches() {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1 && !s.logistics) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.from("edsp_despatches").select("id, no, doc_no, type_code, status, party_name, issue_date, ship_date, plate, carrier_name, einv_status, einv_desc").order("issue_date", { ascending: false }).order("no", { ascending: false }).limit(300);
  const rows = (data ?? []) as Array<{ id: string; no: number; doc_no: string | null; type_code: string; status: string; party_name: string; issue_date: string; ship_date: string; plate: string | null; carrier_name: string | null; einv_status: string; einv_desc: string | null }>;
  return (
    <>
      <PageHeader title="e-İrsaliyeler" subtitle="Giden e-İrsaliyeler: laboratuvar irsaliyesinden, satış faturasından ya da elle; eLogo ile gönderim"
        actions={<Link href="/satis/e-irsaliye/yeni" className="text-sm font-semibold text-brand-700">+ Yeni e-İrsaliye</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/relation|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270227000000_einv_send.sql çalıştırılmalı." : error.message}</Notice>}
        <Notice tone="info">Laboratuvar irsaliyesi sayfasında ve satış faturası sayfasında “e-İrsaliye oluştur” düğmesi de var. Gelen e-İrsaliyeler Alış › Gelen e-belgeler&apos;de.</Notice>
        <Table head={["No", "Alıcı", "Düzenleme", "Sevk", "Taşıma", "Durum"]} min={760}>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === "cancelled" ? "opacity-60" : ""}>
              <td className={td}><Link href={`/satis/e-irsaliye/${r.id}`} className="font-semibold text-brand-700 font-mono">{r.doc_no ?? `taslak #${r.no}`}</Link>{r.type_code === "MATBUDAN" && <span className="block text-xs text-muted">matbudan</span>}</td>
              <td className={td}>{r.party_name}</td>
              <td className={td}>{formatDate(r.issue_date)}</td>
              <td className={td}>{formatDate(r.ship_date)}</td>
              <td className={td}>{[r.plate, r.carrier_name].filter(Boolean).join(" · ") || "—"}</td>
              <td className={td}>{r.status === "cancelled" ? <Chip tone="red">İptal</Chip> : <Chip tone={EINV_SEND_STATUS[r.einv_status]?.[1]}>{r.einv_status === "none" ? "Taslak" : EINV_SEND_STATUS[r.einv_status]?.[0]}</Chip>}{r.einv_status === "error" && r.einv_desc && <span className="block text-xs text-bad">{r.einv_desc}</span>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className={td} colSpan={6}>Henüz e-İrsaliye yok.</td></tr>}
        </Table>
      </div>
    </>
  );
}
