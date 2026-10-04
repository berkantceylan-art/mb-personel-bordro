import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Flash, PageHead, formatTr } from "@/components/admin/ui";
import { deleteMessage, saveMessageNote, setMessageStatus } from "@/lib/admin-actions";
import { TOPIC_LABELS, type Message } from "@/lib/cms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Mesaj" };

const LANG: Record<string, string> = { tr: "Türkçe", en: "İngilizce", fr: "Fransızca" };
const btn = "rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy";

export default async function MessagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { id } = await params;
  const { ok } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cms_messages").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as Message;
  // Açılan mesaj okunmuş sayılır
  if (m.status === "new") await supabase.from("cms_messages").update({ status: "read" }).eq("id", id);

  const subject = encodeURIComponent(`Re: MB Dental — ${TOPIC_LABELS[m.topic]}`);
  const quote = encodeURIComponent(`\n\n---\n${m.name} (${formatTr(m.created_at)}):\n${m.message}`);

  return (
    <>
      <PageHead title={m.name} lead={`${TOPIC_LABELS[m.topic]} · ${formatTr(m.created_at)}`} />
      <Flash ok={ok} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <article className="rounded-2xl border border-gypsum bg-white p-6">
            <p className="whitespace-pre-wrap leading-relaxed text-ink">{m.message}</p>
          </article>
          <div className="flex flex-wrap gap-2">
            <a href={`mailto:${m.email}?subject=${subject}&body=${quote}`} className="rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue">
              E-postayla yanıtla
            </a>
            {m.phone && (
              <a href={`tel:${m.phone.replace(/[^\d+]/g, "")}`} className={btn}>
                Ara
              </a>
            )}
            {m.phone && (
              <a href={`https://wa.me/${m.phone.replace(/\D/g, "").replace(/^0/, "90")}`} target="_blank" rel="noreferrer" className={btn}>
                WhatsApp
              </a>
            )}
            <form action={setMessageStatus}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="status" value={m.status === "archived" ? "read" : "archived"} />
              <button type="submit" className={btn}>
                {m.status === "archived" ? "Gelen kutusuna taşı" : "Arşivle"}
              </button>
            </form>
            <form action={setMessageStatus}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="status" value="new" />
              <button type="submit" className={btn}>
                Okunmadı yap
              </button>
            </form>
          </div>
          <form action={saveMessageNote} className="grid gap-2 rounded-2xl border border-gypsum bg-white p-5">
            <input type="hidden" name="id" value={m.id} />
            <label htmlFor="note" className="text-sm font-semibold text-navy">
              İç not
            </label>
            <textarea id="note" name="note" defaultValue={m.note ?? ""} rows={3} maxLength={2000} placeholder="Yalnız ekip görür (ör. “Fiyat listesi gönderildi”)." className="field" />
            <button type="submit" className={`${btn} justify-self-start`}>
              Notu kaydet
            </button>
          </form>
        </div>

        <aside className="grid content-start gap-4">
          <dl className="grid gap-3 rounded-2xl border border-gypsum bg-white p-5 text-sm">
            {(
              [
                ["E-posta", m.email],
                ["Telefon", m.phone],
                ["Klinik / firma", m.company],
                ["Ülke / şehir", m.country],
                ["Seçilen diş", m.meta?.tooth],
                ["Ürün", m.meta?.product],
                ["Dil", m.locale ? LANG[m.locale] : null],
                ["Gönderildiği sayfa", m.page],
              ] as [string, string | null | undefined][]
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-slate">{k}</dt>
                  <dd className="break-words font-semibold">{v}</dd>
                </div>
              ))}
          </dl>
          <form action={deleteMessage} className="rounded-2xl border border-gypsum bg-white p-5">
            <input type="hidden" name="id" value={m.id} />
            <p className="text-sm text-slate">Mesaj kalıcı olarak silinir.</p>
            <ConfirmButton message="Mesaj kalıcı olarak silinecek. Devam edilsin mi?" className="mt-3 rounded-full border border-bad px-4 py-2 text-sm font-semibold text-bad hover:bg-bad-bg">
              Sil
            </ConfirmButton>
          </form>
          <Link href="/admin/gelen-kutusu" className="text-sm font-semibold text-slate hover:text-navy">
            ← Gelen kutusuna dön
          </Link>
        </aside>
      </div>
    </>
  );
}
