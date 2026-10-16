import { PendingSubmit } from "@/components/ConfirmSubmit";
import { sendPortalMessage } from "@/lib/supplier-portal-actions";
import { fileSize, type Doc, type Msg } from "@/lib/supplier-portal";
import { waLink } from "@/lib/wa";
import { LiveRefresh } from "./LiveRefresh";

type Sb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const time = (s: string) => new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Yazışma: balonlar, okundu işareti, belge ekleri ve yazma kutusu (her iki taraf için ortak) */
export async function Thread({ sb, partyId, viewer, phone, canWrite = true }: { sb: Sb; partyId: string; viewer: "supplier" | "lab"; phone?: string | null; canWrite?: boolean }) {
  const [{ data: ms }, { data: os }] = await Promise.all([
    sb.from("sup_messages").select("id, side, sender_name, body, created_at, read_at, po_id, via, doc_id").eq("party_id", partyId).order("created_at", { ascending: true }).limit(400),
    sb.from("pur_orders").select("id, year, no, status").eq("party_id", partyId).in("status", ["approved", "sent", "partial", "received", "invoiced"]).order("order_date", { ascending: false }).limit(40),
  ]);
  const msgs = (ms ?? []) as Msg[];
  const orders = (os ?? []) as { id: string; year: number; no: number; status: string }[];
  const docIds = msgs.map((m) => m.doc_id).filter(Boolean) as string[];
  const { data: ds } = docIds.length ? await sb.from("sup_documents").select("id, title, file_name, size_bytes, mime").in("id", docIds) : { data: [] };
  const docs = new Map(((ds ?? []) as Pick<Doc, "id" | "title" | "file_name" | "size_bytes" | "mime">[]).map((d) => [d.id, d]));
  const poNo = new Map(orders.map((o) => [o.id, `SA-${o.year}-${String(o.no).padStart(4, "0")}`]));
  let lastDay = "";

  return (
    <section className="rounded-[20px] border border-line bg-white flex flex-col overflow-hidden">
      <LiveRefresh seconds={20} />
      <div className="flex-1 max-h-[62vh] min-h-[320px] overflow-y-auto p-4 md:p-6 flex flex-col gap-2 bg-[linear-gradient(180deg,#F8FAFD,#FFFFFF)]" id="thread">
        {!msgs.length && <div className="m-auto text-center text-muted text-sm max-w-sm"><div className="text-4xl mb-2">💬</div>Henüz yazışma yok. Sipariş, teslimat, fiyat ya da belgeyle ilgili ilk mesajı yazın.</div>}
        {msgs.map((m) => {
          const mine = m.side === viewer;
          const day = new Date(m.created_at).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long" });
          const sep = day !== lastDay;
          lastDay = day;
          const d = m.doc_id ? docs.get(m.doc_id) : null;
          const wa = !mine || viewer !== "lab" ? null : waLink(phone, m.body);
          return (
            <div key={m.id} className="flex flex-col">
              {sep && <div className="self-center my-2 text-[11px] font-semibold text-muted bg-[#EEF2F6] rounded-full px-3 py-1">{day}</div>}
              <div className={`max-w-[82%] md:max-w-[68%] ${mine ? "self-end" : "self-start"}`}>
                <div className={`rounded-2xl px-4 py-2.5 shadow-sm ${mine ? "bg-brand-700 text-white rounded-br-md" : "bg-[#EEF2F6] text-ink rounded-bl-md"}`}>
                  {!mine && <div className="text-[11px] font-semibold opacity-70 mb-0.5">{m.sender_name ?? (m.side === "lab" ? "MB Dental" : "Tedarikçi")}</div>}
                  {m.po_id && poNo.get(m.po_id) && <div className={`inline-block text-[11px] font-mono font-semibold rounded px-1.5 py-0.5 mb-1 ${mine ? "bg-white/15" : "bg-white"}`}>{poNo.get(m.po_id)}</div>}
                  <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                  {d && (
                    <a href={`/api/tedarikci-dosya/${d.id}`} target="_blank" rel="noreferrer" className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${mine ? "bg-white/15" : "bg-white"}`}>
                      <span className="text-lg">{d.mime?.startsWith("image/") ? "🖼" : d.mime === "application/pdf" ? "📄" : "📎"}</span>
                      <span className="truncate font-semibold">{d.file_name ?? d.title}</span><span className="ml-auto text-[11px] opacity-70">{fileSize(d.size_bytes)}</span>
                    </a>
                  )}
                </div>
                <div className={`flex items-center gap-2 mt-0.5 text-[11px] text-muted ${mine ? "justify-end" : ""}`}>
                  <span>{time(m.created_at)}</span>
                  {m.via?.includes("email") && <span title="E-posta ile de gönderildi">✉</span>}
                  {m.via?.includes("whatsapp") && <span title="WhatsApp ile de gönderildi">🟢</span>}
                  {mine && <span className={m.read_at ? "text-[#1D9BF0] font-bold" : ""} title={m.read_at ? `Okundu · ${time(m.read_at)}` : "İletildi"}>{m.read_at ? "✓✓ okundu" : "✓"}</span>}
                  {wa && <a href={wa} target="_blank" rel="noreferrer" className="font-semibold text-[#128C4B]">WhatsApp&apos;tan aç</a>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {canWrite && (
        <form action={sendPortalMessage} className="border-t border-line p-3 md:p-4 flex flex-col gap-2 bg-white">
          <input type="hidden" name="party_id" value={partyId} />
          <textarea name="body" rows={2} maxLength={4000} placeholder="Mesajınızı yazın…" className="w-full rounded-xl border border-[#D5DEE8] px-3 py-2 text-sm resize-y focus:outline-none focus:border-brand-600" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select name="po_id" defaultValue="" className="h-9 rounded-lg border border-[#D5DEE8] px-2 text-sm max-w-[200px]">
              <option value="">Sipariş seç (isteğe bağlı)</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{poNo.get(o.id)}</option>)}
            </select>
            <label className="h-9 px-3 inline-flex items-center gap-2 rounded-lg border border-dashed border-[#B8C6D6] text-muted cursor-pointer hover:border-brand-600">
              📎 <span>Dosya ekle</span><input type="file" name="file" className="max-w-[180px] text-xs" />
            </label>
            {viewer === "lab" && <>
              <label className="flex items-center gap-1"><input type="checkbox" name="via" value="email" /> E-posta</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="via" value="whatsapp" /> WhatsApp</label>
            </>}
            <PendingSubmit className="ml-auto h-10 px-5 rounded-xl bg-brand-700 text-white font-semibold">Gönder ➤</PendingSubmit>
          </div>
        </form>
      )}
    </section>
  );
}
