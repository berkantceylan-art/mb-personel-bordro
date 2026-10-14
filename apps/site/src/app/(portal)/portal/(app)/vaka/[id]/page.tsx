import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseFileAdder } from "@/components/portal/CaseFileAdder";
import { CaseFiles, CaseInfo, CaseProgress, CaseTimeline } from "@/components/portal/CaseView";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { postCaseMessage } from "@/lib/portal-actions";
import { PORTAL_BUCKET, PORTAL_UI, portalContext, portalLocale, type CaseEvent, type CaseFile, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";
import { PX } from "@/lib/portal-extra-ui";
import { reportCaseIssue } from "@/lib/survey-actions";
import { RatingCard, SaveTemplate, StageLine } from "@/components/portal/CasePlus";

const ISSUE = {
  tr: { title: "Sorun bildir", ph: "Ne oldu? (ör. kron oturmadı, renk farklı)", send: "Bildir", ok: "Bildiriminiz kalite ekibimize iletildi.", err: "Gönderilemedi, tekrar deneyin.", cats: { fit: "Uyum / oturma", shade: "Renk", fracture: "Kırık / çatlak", contact: "Kontakt", occlusion: "Kapanış", aesthetic: "Estetik / form", delay: "Gecikme", damage: "Hasarlı teslim", other: "Diğer" } },
  en: { title: "Report an issue", ph: "What happened? (e.g. crown did not seat, shade mismatch)", send: "Report", ok: "Your report has been sent to our quality team.", err: "Could not be sent, please try again.", cats: { fit: "Fit / seating", shade: "Shade", fracture: "Fracture / crack", contact: "Contact", occlusion: "Occlusion", aesthetic: "Aesthetics / form", delay: "Delay", damage: "Damaged on delivery", other: "Other" } },
  fr: { title: "Signaler un problème", ph: "Que s’est-il passé ? (ex. couronne mal ajustée, teinte différente)", send: "Signaler", ok: "Votre signalement a été transmis à notre équipe qualité.", err: "Échec de l’envoi, réessayez.", cats: { fit: "Ajustage", shade: "Teinte", fracture: "Fracture / fissure", contact: "Contact", occlusion: "Occlusion", aesthetic: "Esthétique / forme", delay: "Retard", damage: "Endommagé à la livraison", other: "Autre" } },
} as const;

export const metadata = { title: "Portal" };

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sorun?: string; puan?: string; sablon?: string }> }) {
  const { id } = await params;
  const { sorun, puan, sablon } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const ui = PORTAL_UI[locale];
  const supabase = await createClient();
  const { data } = await supabase.from("portal_cases").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as PortalCase;
  const [{ data: f }, { data: ev }, products, { data: rt }] = await Promise.all([
    supabase.from("portal_case_files").select("*").eq("case_id", id).order("created_at"),
    supabase.from("portal_case_events").select("*").eq("case_id", id).order("id"),
    publicProducts(),
    supabase.from("portal_case_ratings").select("fit, shade, service, comment").eq("case_id", id).maybeSingle(),
  ]);
  const files = (f ?? []) as CaseFile[];
  const events = (ev ?? []) as CaseEvent[];
  const urls: Record<string, string> = {};
  if (files.length) {
    const { data: signed } = await supabase.storage.from(PORTAL_BUCKET).createSignedUrls(files.map((x) => x.path), 3600, { download: true });
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  const productName = products.find((p) => p.slug === c.product_slug);

  return (
    <>
      <Link href="/portal" className="text-sm font-semibold text-slate hover:text-navy">
        ← {ui.nav.cases}
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="display num text-3xl font-semibold text-navy">#{c.no}</h1>
        <span className="text-lg font-semibold">{c.patient_ref}</span>
        <div className="ml-auto flex flex-wrap gap-2 text-sm font-semibold">
          {(c.status === "shipped" || c.status === "delivered") && (
            <Link href={`/portal/vaka/${c.id}/beyan`} className="rounded-full border border-gypsum bg-white px-4 py-2 text-navy hover:border-navy">
              {PX[locale].declaration}
            </Link>
          )}
          <Link href={`/portal/vaka/yeni?tekrar=${c.id}`} className="rounded-full bg-navy px-4 py-2 text-white hover:bg-blue">
            ↻ {PX[locale].repeat}
          </Link>
        </div>
      </div>
      <div className="mb-6 rounded-2xl border border-gypsum bg-white p-5">
        <CaseProgress c={c} locale={locale} />
        <StageLine stage={(c as PortalCase & { stage?: string | null }).stage} locale={locale} />
      </div>
      {(c.status === "shipped" || c.status === "delivered") && <div className="mb-6"><RatingCard caseId={c.id} rating={(rt as { fit: number; shade: number; service: number; comment: string | null } | null) ?? null} locale={locale} flash={puan} /></div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid content-start gap-6">
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display mb-4 text-lg font-semibold text-navy">{ui.detail.info}</h2>
            <CaseInfo c={c} locale={locale} productName={productName ? t(productName.name, locale) : undefined} />
          </section>
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display mb-3 text-lg font-semibold text-navy">{ui.detail.files}</h2>
            <CaseFiles files={files} urls={urls} locale={locale} />
            {ctx?.account && <div className="mt-4"><SaveTemplate caseId={c.id} locale={locale} flash={sablon} /></div>}
            {ctx?.account && (
              <div className="mt-4">
                <CaseFileAdder caseId={c.id} accountId={c.account_id} label={ui.detail.addFiles} />
              </div>
            )}
          </section>
        </div>
        <section id="gecmis" className="rounded-2xl border border-gypsum bg-white p-5">
          <h2 className="display mb-4 text-lg font-semibold text-navy">{ui.detail.timeline}</h2>
          <CaseTimeline events={events} locale={locale} viewer="doctor" />
          <form action={postCaseMessage} className="mt-5 grid gap-2 border-t border-gypsum pt-4">
            <input type="hidden" name="case_id" value={c.id} />
            <label htmlFor="msg" className="text-sm font-semibold text-navy">
              {ui.detail.message}
            </label>
            <textarea id="msg" name="body" required rows={3} maxLength={4000} placeholder={ui.detail.messagePh} className="field" />
            <button type="submit" className="justify-self-start rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue">
              {ui.detail.send}
            </button>
          </form>
          {(() => {
            const iu = ISSUE[(locale as keyof typeof ISSUE)] ?? ISSUE.tr;
            return (
              <details className="mt-5 border-t border-gypsum pt-4" open={!!sorun}>
                <summary className="cursor-pointer text-sm font-semibold text-navy">⚠ {iu.title}</summary>
                {sorun && <p className={`mt-3 rounded-xl p-3 text-sm font-semibold ${sorun === "ok" ? "bg-porcelain text-navy" : "bg-[#FDECEA] text-[#9B1C14]"}`}>{sorun === "ok" ? iu.ok : iu.err}</p>}
                <form action={reportCaseIssue} className="mt-3 grid gap-2">
                  <input type="hidden" name="case_id" value={c.id} />
                  <select name="category" className="field">{Object.entries(iu.cats).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <textarea name="description" required rows={3} maxLength={2000} placeholder={iu.ph} className="field" />
                  <button type="submit" className="justify-self-start rounded-full border border-navy px-5 py-2.5 text-sm font-semibold text-navy hover:bg-navy hover:text-white">{iu.send}</button>
                </form>
              </details>
            );
          })()}
        </section>
      </div>
    </>
  );
}
