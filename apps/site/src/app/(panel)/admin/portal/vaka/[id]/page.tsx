import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, PageHead } from "@/components/admin/ui";
import { CaseFileAdder } from "@/components/portal/CaseFileAdder";
import { CaseFiles, CaseInfo, CaseProgress, CaseTimeline } from "@/components/portal/CaseView";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { labUpdateCase } from "@/lib/portal-actions";
import { CASE_STATUSES, PORTAL_BUCKET, PORTAL_UI, type CaseEvent, type CaseFile, type PortalAccount, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal vakası" };

export default async function LabCase({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; hata?: string }> }) {
  const { id } = await params;
  const { ok, hata } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("portal_cases").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as PortalCase;
  const [{ data: acc }, { data: f }, { data: ev }, products] = await Promise.all([
    supabase.from("portal_accounts").select("*").eq("id", c.account_id).maybeSingle(),
    supabase.from("portal_case_files").select("*").eq("case_id", id).order("created_at"),
    supabase.from("portal_case_events").select("*").eq("case_id", id).order("id"),
    publicProducts(),
  ]);
  const a = acc as PortalAccount | null;
  const files = (f ?? []) as CaseFile[];
  const events = (ev ?? []) as CaseEvent[];
  const urls: Record<string, string> = {};
  if (files.length) {
    const { data: signed } = await supabase.storage.from(PORTAL_BUCKET).createSignedUrls(files.map((x) => x.path), 3600, { download: true });
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  const product = products.find((p) => p.slug === c.product_slug);
  const ui = PORTAL_UI.tr;

  return (
    <>
      <PageHead title={`#${c.no} · ${c.patient_ref}`} lead={a ? `${a.company || a.name} · ${ui.types[a.type]}` : undefined} />
      <Flash ok={ok} hata={hata} />
      <div className="mb-6 rounded-2xl border border-gypsum bg-white p-5">
        <CaseProgress c={c} locale="tr" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid content-start gap-6">
          <form action={labUpdateCase} className="grid gap-3 rounded-2xl border-2 border-navy bg-white p-5">
            <input type="hidden" name="id" value={c.id} />
            <h2 className="display text-lg font-semibold text-navy">Vakayı güncelle</h2>
            <label className="grid gap-1 text-sm font-semibold text-navy">
              Durum
              <select name="status" defaultValue={c.status} className="field font-normal">
                {CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ui.statuses[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-navy">
              Kargo takip numarası
              <input name="tracking" defaultValue={c.tracking ?? ""} maxLength={120} className="field font-normal" placeholder="ör. UPS 1Z…" />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-navy">
              Hekime mesaj (isteğe bağlı)
              <textarea name="message" rows={3} maxLength={4000} className="field font-normal" placeholder={`Hekimin dilinde yazın (${a?.language?.toUpperCase() ?? "TR"}).`} />
            </label>
            <button type="submit" className="justify-self-start rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue">
              Kaydet
            </button>
          </form>
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display mb-4 text-lg font-semibold text-navy">Vaka bilgileri</h2>
            <CaseInfo c={c} locale="tr" productName={product ? t(product.name, "tr") : undefined} />
          </section>
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display mb-3 text-lg font-semibold text-navy">Dosyalar</h2>
            <CaseFiles files={files} urls={urls} locale="tr" />
            <div className="mt-4">
              <CaseFileAdder caseId={c.id} accountId={c.account_id} label="Laboratuvardan dosya ekle (tasarım onayı, fotoğraf…)" lab />
            </div>
          </section>
          {a && (
            <Link href={`/admin/portal/hesap/${a.id}`} className="text-sm font-semibold text-smile-ink hover:underline">
              Hesaba git: {a.company || a.name} →
            </Link>
          )}
        </div>
        <section className="rounded-2xl border border-gypsum bg-white p-5">
          <h2 className="display mb-4 text-lg font-semibold text-navy">Vaka geçmişi</h2>
          <CaseTimeline events={events} locale="tr" viewer="lab" />
        </section>
      </div>
    </>
  );
}
