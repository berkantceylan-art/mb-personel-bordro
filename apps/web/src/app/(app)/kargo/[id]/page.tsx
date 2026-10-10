import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { CARRIER, CONTENTS, FLOW, SLOT, STATUS, fmtDateTime, trackingUrl, type Shipment, type ShipStatus } from "@/lib/shipments";
import { ShipmentForm } from "../ShipmentForm";
import { DeliverySign, ShipmentUploader } from "../ShipmentUploader";
import { addShipmentNote, deleteShipment, setShipmentStatus } from "../actions";
import { formOptions } from "../data";

export const dynamic = "force-dynamic";

type Ev = { id: number; status: ShipStatus | null; note: string | null; source: string; created_at: string };
type File = { id: string; path: string; kind: string; name: string | null; created_at: string };
const SOURCE: Record<string, string> = { manual: "", portal: "hekim portalı", scan: "okutma", dhl: "DHL", ups: "UPS", system: "sistem" };

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ duzenle?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("shipments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const x = data as Shipment;
  const [{ data: ev }, { data: fl }, acc, pc] = await Promise.all([
    supabase.from("shipment_events").select("id, status, note, source, created_at").eq("shipment_id", id).order("id", { ascending: false }),
    supabase.from("shipment_files").select("id, path, kind, name, created_at").eq("shipment_id", id).order("created_at"),
    x.portal_account_id ? supabase.from("portal_accounts").select("name, company, type, country, email").eq("id", x.portal_account_id).maybeSingle() : Promise.resolve({ data: null }),
    x.portal_case_id ? supabase.from("portal_cases").select("no, patient_ref").eq("id", x.portal_case_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const events = (ev ?? []) as Ev[];
  const files = (fl ?? []) as File[];
  const urls = new Map<string, string>();
  if (files.length) {
    const { data: signed } = await supabase.storage.from("shipment-files").createSignedUrls(files.map((f) => f.path), 3600);
    (signed ?? []).forEach((u, i) => u.signedUrl && urls.set(files[i]!.path, u.signedUrl));
  }
  const account = acc.data as { name: string; company: string | null; type: string; country: string; email: string | null } | null;
  const pcase = pc.data as { no: number; patient_ref: string } | null;
  const flow = FLOW[x.direction];
  const idx = flow.indexOf(x.status);
  const url = trackingUrl(x.carrier, x.tracking_no);
  const [label, cls] = STATUS[x.status];
  const who = account ? account.company || account.name : x.party_name || "—";
  const editing = sp.duzenle === "1";
  const opts = editing ? await formOptions() : null;
  const courierOpen = x.carrier === "our_courier" && !["delivered", "arrived", "opened", "job_created", "cancelled"].includes(x.status);

  return (
    <>
      <PageHeader
        title={`G${x.no} · ${x.direction === "in" ? "Gelen" : "Giden"} · ${CARRIER[x.carrier]}`}
        subtitle={`${who}${x.tracking_no ? ` · ${x.tracking_no}` : ""}`}
        actions={
          <div className="flex gap-2 items-center">
            <span className={`text-sm font-semibold px-3 py-1 rounded-lg ${cls}`}>{label}</span>
            <Link href="/kargo" className="text-sm font-semibold text-brand-700">Listeye dön</Link>
          </div>
        }
      />
      <div className="p-4 md:p-8 grid gap-5 lg:grid-cols-[1fr_380px] max-w-[1320px]">
        <div className="flex flex-col gap-5 min-w-0">
          <Card title="Durum">
            <ol className="flex flex-wrap gap-1.5 text-xs">
              {flow.map((st, i) => (
                <li key={st} className={`px-2.5 py-1 rounded-full font-semibold ${i < idx ? "bg-ok-bg text-ok" : i === idx ? "bg-brand-700 text-white" : "bg-[#EEF2F6] text-muted"}`}>{STATUS[st][0]}</li>
              ))}
            </ol>
            <form action={setShipmentStatus} className="flex flex-wrap gap-2 items-end">
              <input type="hidden" name="id" value={x.id} />
              <input name="note" placeholder="Not (isteğe bağlı)" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white flex-1 min-w-48" />
              {flow
                .filter((st) => st !== x.status && flow.indexOf(st) > idx)
                .slice(0, 3)
                .map((st) => (
                  <button key={st} name="status" value={st} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">→ {STATUS[st][0]}</button>
                ))}
              <select name="status" defaultValue="" className="h-11 rounded-[10px] border border-[#D5DEE8] px-2 bg-white text-sm" aria-label="Başka duruma al">
                <option value="" disabled>Başka durum…</option>
                {(Object.keys(STATUS) as ShipStatus[]).map((st) => <option key={st} value={st}>{STATUS[st][0]}</option>)}
              </select>
              <button className="h-11 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Uygula</button>
            </form>
            {x.direction === "in" && (x.status === "opened" || x.status === "arrived") && (
              <p className="text-sm rounded-lg bg-[#EAF2FB] text-brand-700 p-3">
                Paket açıldıysa içerik ve açılış fotoğrafını ekleyin, sonra <b>İş kaydı açıldı</b> durumuna alın. İş kayıt ekranı hazır olduğunda buradan tek tıkla, bilgileri dolu olarak açılacak.
              </p>
            )}
          </Card>

          {courierOpen && (
            <Card title={x.direction === "in" ? "Kurye: paketi teslim al" : "Kurye: teslim et"}>
              <DeliverySign shipmentId={x.id} doneStatus={x.direction === "in" ? "arrived" : "delivered"} label={x.direction === "in" ? "Teslim aldım" : "Teslim ettim"} />
            </Card>
          )}

          <Card title="Fotoğraf ve belgeler" action={<ShipmentUploader shipmentId={x.id} />}>
            {files.length ? (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {files.map((f) => {
                  const u = urls.get(f.path);
                  const isImg = /\.(jpe?g|png|webp|heic)$/i.test(f.path);
                  return (
                    <li key={f.id} className="rounded-xl border border-line overflow-hidden bg-[#F8FAFC]">
                      {u && isImg ? (
                        <a href={u} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt={f.name ?? ""} className="w-full aspect-square object-cover" />
                        </a>
                      ) : (
                        <a href={u} target="_blank" rel="noreferrer" className="aspect-square grid place-items-center text-sm font-semibold text-brand-700">PDF</a>
                      )}
                      <div className="px-2 py-1.5 text-[11px] text-muted truncate">{f.kind === "signature" ? "İmza" : f.kind === "document" ? "Belge" : "Fotoğraf"} · {fmtDateTime(f.created_at)}</div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">Henüz fotoğraf yok. Paketi açarken kutunun ve içeriğin fotoğrafını çekin: hasar ya da eksik olursa kanıt olur.</p>
            )}
          </Card>

          <Card title={editing ? "Bilgileri düzenle" : "Bilgiler"} action={<Link href={editing ? `/kargo/${x.id}` : `/kargo/${x.id}?duzenle=1`} className="text-sm font-semibold text-brand-700">{editing ? "Vazgeç" : "Düzenle"}</Link>}>
            {editing && opts ? (
              <ShipmentForm shipment={x} direction={x.direction} accounts={opts.accounts} cases={opts.cases} />
            ) : (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
                <div><dt className="text-muted">{x.direction === "in" ? "Gönderen" : "Alıcı"}</dt><dd className="font-semibold">{who}{account && <span className="text-muted font-normal"> · portal hesabı</span>}</dd></div>
                <div><dt className="text-muted">Takip no</dt><dd className="num">{x.tracking_no ? (url ? <a href={url} target="_blank" rel="noreferrer" className="text-brand-700 underline">{x.tracking_no} ↗</a> : x.tracking_no) : "—"}</dd></div>
                <div><dt className="text-muted">Yer</dt><dd>{[x.city, x.country].filter(Boolean).join(", ") || "—"}</dd></div>
                <div><dt className="text-muted">Telefon</dt><dd>{x.phone || "—"}</dd></div>
                <div><dt className="text-muted">Paket sayısı</dt><dd className="num">{x.package_count}</dd></div>
                <div><dt className="text-muted">İçerik</dt><dd>{x.contents.length ? x.contents.map((c) => CONTENTS[c] ?? c).join(", ") : "—"}</dd></div>
                {pcase && <div><dt className="text-muted">Portal vakası</dt><dd>#{pcase.no} · {pcase.patient_ref}</dd></div>}
                {x.expected_on && <div><dt className="text-muted">{x.direction === "in" ? "Beklenen" : "Planlanan"}</dt><dd className="num">{formatDate(x.expected_on)}</dd></div>}
                {x.carrier === "our_courier" && <div><dt className="text-muted">Kurye</dt><dd>{x.courier_date ? formatDate(x.courier_date) : "—"} · {SLOT[x.courier_slot ?? "any"]}</dd></div>}
                {x.address && <div className="sm:col-span-2"><dt className="text-muted">Adres</dt><dd className="whitespace-pre-line">{x.address}</dd></div>}
                {(x.customs_broker || x.customs_ref || x.customs_cost != null) && (
                  <div className="sm:col-span-2 rounded-lg bg-warn-bg p-3">
                    <dt className="text-warn font-semibold">Gümrük</dt>
                    <dd>{x.customs_broker ?? "müşavir —"} · dosya {x.customs_ref ?? "—"} · masraf {x.customs_cost != null ? `${(x.customs_cost / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${x.customs_currency}` : "—"}</dd>
                  </div>
                )}
                {x.note && <div className="sm:col-span-2"><dt className="text-muted">Not</dt><dd className="whitespace-pre-line">{x.note}</dd></div>}
                <div><dt className="text-muted">Geldi / açıldı</dt><dd className="num text-xs">{fmtDateTime(x.arrived_at)} · {fmtDateTime(x.opened_at)}</dd></div>
                <div><dt className="text-muted">Teslim</dt><dd className="num text-xs">{fmtDateTime(x.delivered_at)}</dd></div>
              </dl>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-5">
          <Card title="Geçmiş">
            <form action={addShipmentNote} className="flex gap-2">
              <input type="hidden" name="id" value={x.id} />
              <input name="note" required placeholder="Not ekle (ör. müşavir aradı)" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white flex-1 text-sm" />
              <button className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Ekle</button>
            </form>
            <ol className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <div className="text-xs text-muted num">{fmtDateTime(e.created_at)}{SOURCE[e.source] ? ` · ${SOURCE[e.source]}` : ""}</div>
                  {e.status && <div className="text-sm font-semibold">{STATUS[e.status]?.[0] ?? e.status}</div>}
                  {e.note && <div className="text-sm">{e.note}</div>}
                </li>
              ))}
              {events.length === 0 && <li className="text-sm text-muted">Kayıt yok.</li>}
            </ol>
          </Card>
          {["owner", "accountant", "hr"].includes(s.role) && (
            <form action={deleteShipment} className="text-right">
              <input type="hidden" name="id" value={x.id} />
              <ConfirmSubmit label="Gönderiyi sil" question="Gönderi, fotoğrafları ve geçmişi silinsin mi?" className="text-sm text-bad font-semibold" />
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
