import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { removePortalDoc, uploadPortalDoc } from "@/lib/supplier-portal-actions";
import { DOC_KINDS, dmy, fileSize, type Doc } from "@/lib/supplier-portal";

type Sb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const icon = (m: string | null) => (m?.startsWith("image/") ? "🖼" : m === "application/pdf" ? "📄" : m?.includes("sheet") || m?.includes("excel") ? "📊" : "📎");

/** Belgeler: iki yönlü liste + yükleme (her iki taraf için ortak) */
export async function Docs({ sb, partyId, viewer, canWrite = true }: { sb: Sb; partyId: string; viewer: "supplier" | "lab"; canWrite?: boolean }) {
  const [{ data: ds }, { data: os }] = await Promise.all([
    sb.from("sup_documents").select("id, side, kind, title, file_name, mime, size_bytes, note, valid_until, created_at, seen_at, sender_name, po_id").eq("party_id", partyId).order("created_at", { ascending: false }).limit(300),
    sb.from("pur_orders").select("id, year, no").eq("party_id", partyId).in("status", ["approved", "sent", "partial", "received", "invoiced"]).order("order_date", { ascending: false }).limit(40),
  ]);
  const docs = (ds ?? []) as Doc[];
  const orders = (os ?? []) as { id: string; year: number; no: number }[];
  const poNo = new Map(orders.map((o) => [o.id, `SA-${o.year}-${String(o.no).padStart(4, "0")}`]));
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 33 * 864e5).toISOString().slice(0, 10);
  const groups: [string, Doc[]][] = [
    [viewer === "supplier" ? "Size gönderilenler" : "Tedarikçinin gönderdikleri", docs.filter((d) => d.side !== viewer)],
    [viewer === "supplier" ? "Gönderdikleriniz" : "Bizim gönderdiklerimiz", docs.filter((d) => d.side === viewer)],
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-5">
        {groups.map(([title, list]) => (
          <section key={title} className="rounded-[20px] border border-line bg-white p-4 md:p-5">
            <h2 className="font-display font-bold text-brand-800 mb-3">{title} <span className="text-muted font-normal text-sm">{list.length}</span></h2>
            <ul className="flex flex-col divide-y divide-[#EEF2F6]">
              {list.map((d) => {
                const exp = d.valid_until && d.valid_until < today ? "expired" : d.valid_until && d.valid_until <= soon ? "soon" : null;
                return (
                  <li key={d.id} className="py-3 flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-[#EEF4FB] grid place-items-center text-lg shrink-0">{icon(d.mime)}</span>
                    <div className="flex-1 min-w-0">
                      <a href={`/api/tedarikci-dosya/${d.id}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline truncate block">{d.title}</a>
                      <div className="text-xs text-muted flex flex-wrap gap-x-2">
                        <span className="rounded bg-[#EEF2F6] px-1.5">{DOC_KINDS[d.kind] ?? d.kind}</span>
                        <span>{dmy(d.created_at)}</span>
                        {d.sender_name && <span>{d.sender_name}</span>}
                        {d.po_id && poNo.get(d.po_id) && <span className="font-mono">{poNo.get(d.po_id)}</span>}
                        <span>{fileSize(d.size_bytes)}</span>
                        {d.valid_until && <span className={exp === "expired" ? "text-bad font-semibold" : exp === "soon" ? "text-warn font-semibold" : ""}>geçerlilik {dmy(d.valid_until)}{exp === "expired" ? " · süresi doldu" : exp === "soon" ? " · yaklaşıyor" : ""}</span>}
                      </div>
                      {d.note && <div className="text-xs mt-0.5">{d.note}</div>}
                    </div>
                    {d.side === viewer && <span className={`text-[11px] ${d.seen_at ? "text-[#1D9BF0] font-semibold" : "text-muted"}`}>{d.seen_at ? "✓✓ görüldü" : "✓"}</span>}
                    {canWrite && d.side === viewer && (
                      <form action={removePortalDoc}><input type="hidden" name="party_id" value={partyId} /><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Kaldır" question="Belge kaldırılsın mı?" className="text-xs text-muted" /></form>
                    )}
                  </li>
                );
              })}
              {!list.length && <li className="py-6 text-center text-sm text-muted">Belge yok.</li>}
            </ul>
          </section>
        ))}
      </div>
      {canWrite && (
        <form action={uploadPortalDoc} className="rounded-[20px] border border-line bg-white p-4 md:p-5 flex flex-col gap-3 text-sm h-fit lg:sticky lg:top-4">
          <h2 className="font-display font-bold text-brand-800">Belge gönder</h2>
          <input type="hidden" name="party_id" value={partyId} />
          <label className="flex flex-col gap-1 rounded-xl border-2 border-dashed border-[#B8C6D6] p-4 text-center cursor-pointer hover:border-brand-600">
            <span className="text-2xl">⬆</span><span className="text-muted">PDF, Excel, fotoğraf (en çok 20 MB)</span>
            <input type="file" name="file" required className="text-xs mx-auto" />
          </label>
          <label className="flex flex-col gap-1">Tür
            <select name="kind" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">{Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1">Başlık<input name="title" maxLength={200} placeholder="ör. Ekim irsaliyesi, ISO 13485 sertifikası" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
          <label className="flex flex-col gap-1">Sipariş
            <select name="po_id" defaultValue="" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2"><option value="">—</option>{orders.map((o) => <option key={o.id} value={o.id}>{poNo.get(o.id)}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1">Geçerlilik tarihi (sertifika vb.)<input type="date" name="valid_until" className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
          <label className="flex flex-col gap-1">Not<textarea name="note" rows={2} maxLength={500} className="rounded-[10px] border border-[#D5DEE8] px-3 py-2" /></label>
          {viewer === "lab" && <div className="flex gap-4"><label className="flex items-center gap-1"><input type="checkbox" name="email" /> E-postayla da gönder</label><label className="flex items-center gap-1"><input type="checkbox" name="whatsapp" /> WhatsApp</label></div>}
          <PendingSubmit className="h-11 rounded-xl bg-brand-700 text-white font-semibold">Yükle ve gönder</PendingSubmit>
        </form>
      )}
    </div>
  );
}
