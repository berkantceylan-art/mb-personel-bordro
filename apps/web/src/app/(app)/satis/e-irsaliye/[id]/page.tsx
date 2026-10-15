import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Notice, Table, btnPrimary, btnSecondary, page, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { EINV_SEND_STATUS, ELOGO_CODES } from "@/lib/einv-codes";
import { validateDespatch } from "@/lib/einv-rules";
import { elogoConfigured } from "@/lib/elogo";
import { loadDespatch } from "@/lib/edsp-send";
import { edspDelete, edspRefresh, edspSend } from "@/lib/edsp-actions";
import { DespatchForm } from "../_parts/DespatchForm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const dt = (v: string | null) => (v ? new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }) : "");

export default async function DespatchPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if ((s.modules.sales ?? 0) < 1 && !s.logistics) redirect("/");
  const can = (s.modules.sales ?? 0) >= 2 || s.logistics;
  const { id } = await params;
  const supabase = await createClient();
  const x = await loadDespatch(supabase, id);
  if (!x) notFound();
  const { d, lines, co } = x;
  const st = d.einv_status;
  const editable = d.status === "draft" && ["none", "error"].includes(st);
  const tracked = ["sending", "draft_sent", "sent", "accepted", "rejected", "error"].includes(st);
  const issues = editable ? validateDespatch(d, lines, co) : [];
  const configured = elogoConfigured();
  const { data: parties } = editable && can ? await supabase.from("fin_parties").select("id, name, tax_no, is_edespatch").eq("is_active", true).order("name").limit(5000) : { data: [] };

  return (
    <>
      <PageHeader title={`e-İrsaliye ${d.doc_no ?? `· taslak #${d.no}`}`} subtitle={`${d.party_name} · ${formatDate(d.issue_date)} · sevk ${formatDate(d.ship_date)} ${(d.ship_time ?? "").slice(0, 5)}`}
        actions={<Link href="/satis/e-irsaliye" className="text-sm font-semibold text-brand-700">← e-İrsaliyeler</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="blue">{d.type_code === "MATBUDAN" ? "Matbudan" : "Sevk irsaliyesi"}</Chip>
          {d.status === "cancelled" ? <Chip tone="red">İptal</Chip> : <Chip tone={EINV_SEND_STATUS[st]?.[1]}>{st === "none" ? "Taslak (gönderilmedi)" : EINV_SEND_STATUS[st]?.[0]}</Chip>}
          {d.einv_draft && st !== "none" && <Chip tone="amber">taslak olarak gönderildi</Chip>}
          {d.einv_sent_at && <span className="text-xs text-muted">Gönderim {dt(d.einv_sent_at)}{d.einv_checked_at ? ` · son kontrol ${dt(d.einv_checked_at)}` : ""}</span>}
          {d.invoice_id && <Link href={`/fatura/${d.invoice_id}`} className="text-sm font-semibold text-brand-700">Fatura</Link>}
          {d.waybill_id && <Link href={`/isler/irsaliye/${d.waybill_id}`} className="text-sm font-semibold text-brand-700">Laboratuvar irsaliyesi</Link>}
        </div>
        {(d.einv_desc || d.einv_code != null) && <p className={`text-sm ${st === "error" || st === "rejected" ? "text-bad" : "text-muted"}`}>{d.einv_code != null && ELOGO_CODES[d.einv_code] && !d.einv_desc?.includes(ELOGO_CODES[d.einv_code]!) ? `${ELOGO_CODES[d.einv_code]} · ` : ""}{d.einv_desc}</p>}

        <section className="bg-white border border-line rounded-[14px] p-4 grid gap-3 sm:grid-cols-3 text-sm">
          <div><span className="text-xs text-muted">Alıcı</span><b className="block">{d.party_name}</b><span className="block text-muted">{[d.party_tax_office, d.party_tax_no].filter(Boolean).join(" · ")}</span><span className="block text-muted">{d.delivery_address || [d.party_address, d.party_district, d.party_city].filter(Boolean).join(", ")}</span></div>
          <div><span className="text-xs text-muted">Taşıma</span><span className="block">{d.plate ? `Plaka ${d.plate}${d.trailer_plate ? ` · dorse ${d.trailer_plate}` : ""}` : "Plaka yok"}</span><span className="block">{d.driver_name ? `Şoför ${d.driver_name}` : d.carrier_name ? `Taşıyıcı ${d.carrier_name} (${d.carrier_tax_no ?? "VKN yok"})` : "Şoför / taşıyıcı yok"}</span></div>
          <div><span className="text-xs text-muted">ETTN</span><span className="block text-xs num break-all">{d.ettn}</span>{d.note && <span className="block mt-1">{d.note}</span>}</div>
        </section>

        <Table head={["#", "Mal / hizmet", "Miktar", "Birim fiyat"]} min={560}>
          {lines.map((l, i) => <tr key={i}><td className={`${td} text-muted`}>{i + 1}</td><td className={td}>{l.name}{l.seller_code && <span className="block text-xs text-muted">{l.seller_code}</span>}</td><td className={tdNum}>{Number(l.qty).toLocaleString("tr-TR")} {l.unit}</td><td className={tdNum}>{l.unit_price != null ? `${Number(l.unit_price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${l.currency ?? ""}` : "—"}</td></tr>)}
        </Table>

        {!configured && <Notice tone="info">eLogo bağlantısı tanımlı değil (Vercel: ELOGO_USER / ELOGO_PASS).</Notice>}
        {editable && issues.length > 0 && <div className="rounded-[10px] bg-warn-bg text-warn px-4 py-3 text-sm"><b>Göndermeden önce düzeltin:</b><ul className="list-disc ml-5 mt-1">{issues.map((m) => <li key={m}>{m}</li>)}</ul></div>}

        <div className="flex flex-wrap gap-2 items-end">
          {editable && configured && can && (
            <form action={edspSend} className="flex flex-wrap items-center gap-3 bg-white border border-line rounded-[14px] p-3 text-sm">
              <input type="hidden" name="id" value={d.id} />
              <label className="flex items-center gap-2"><input type="radio" name="mode" value="draft" defaultChecked={co.einv_draft !== false} /> eLogo taslaklarına</label>
              <label className="flex items-center gap-2"><input type="radio" name="mode" value="direct" defaultChecked={co.einv_draft === false} /> Doğrudan GİB&apos;e</label>
              <span className={btnPrimary}><ConfirmSubmit label="eLogo'ya gönder" className="font-semibold" question="Seçtiğiniz şekilde gönderilsin mi? Doğrudan gönderimde irsaliye GİB'e gider ve geri alınamaz." yes="Gönder" /></span>
            </form>
          )}
          {configured && tracked && <form action={edspRefresh}><input type="hidden" name="id" value={d.id} /><PendingSubmit className={btnSecondary}>Durumu yenile</PendingSubmit></form>}
          {configured && ["sent", "accepted", "rejected", "draft_sent"].includes(st) && <><a href={`/api/e-irsaliye/${d.id}/pdf`} className={btnSecondary}>Resmî PDF (eLogo)</a><a href={`/api/e-irsaliye/${d.id}/pdf?bicim=html`} target="_blank" rel="noreferrer" className={btnSecondary}>Görüntüle</a></>}
          {editable && can && <form action={edspDelete} className={btnSecondary}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label={d.doc_no ? "İptal et" : "Sil"} question={d.doc_no ? "Numaralı irsaliye iptal edilsin mi?" : "Taslak silinsin mi?"} /></form>}
        </div>
        {["sent", "accepted"].includes(st) && <p className="text-xs text-muted">Gönderilmiş e-İrsaliye iptal edilemez; alıcı 7 gün içinde irsaliye yanıtıyla kabul / ret bildirir. Hatalı sevkte yeni irsaliye düzenleyin.</p>}

        {editable && can && (
          <details className="bg-[#F8FAFC] border border-line rounded-[14px] p-4" open={issues.length > 0}>
            <summary className="cursor-pointer font-semibold text-sm">Düzenle</summary>
            <div className="mt-4">
              <DespatchForm parties={(parties ?? []) as Array<{ id: string; name: string; tax_no: string | null; is_edespatch: boolean }>} now={{ date: d.issue_date, time: (d.issue_time ?? "12:00").slice(0, 5) }}
                initial={{ id: d.id, party_id: d.party_id, type_code: d.type_code, issue_date: d.issue_date, issue_time: (d.issue_time ?? "").slice(0, 5), ship_date: d.ship_date, ship_time: (d.ship_time ?? "").slice(0, 5),
                  delivery_address: d.delivery_address, plate: d.plate, trailer_plate: d.trailer_plate, driver_name: d.driver_name, driver_tckn: d.driver_tckn, carrier_name: d.carrier_name, carrier_tax_no: d.carrier_tax_no,
                  matbu_no: d.matbu_no, matbu_date: d.matbu_date, order_no: d.order_no, order_date: d.order_date, note: d.note, lines }} />
            </div>
          </details>
        )}
      </div>
    </>
  );
}
