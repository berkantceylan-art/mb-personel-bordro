import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseFileAdder } from "@/components/portal/CaseFileAdder";
import { CaseFiles, CaseInfo, CaseProgress, CaseTimeline } from "@/components/portal/CaseView";
import { publicProducts } from "@/lib/cms";
import { t } from "@/lib/i18n";
import { postCaseMessage } from "@/lib/portal-actions";
import { PORTAL_BUCKET, PORTAL_UI, portalContext, portalLocale, type CaseEvent, type CaseFile, type PortalCase } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Portal" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await portalContext();
  const locale = await portalLocale(ctx?.account);
  const ui = PORTAL_UI[locale];
  const supabase = await createClient();
  const { data } = await supabase.from("portal_cases").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as PortalCase;
  const [{ data: f }, { data: ev }, products] = await Promise.all([
    supabase.from("portal_case_files").select("*").eq("case_id", id).order("created_at"),
    supabase.from("portal_case_events").select("*").eq("case_id", id).order("id"),
    publicProducts(),
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
      </div>
      <div className="mb-6 rounded-2xl border border-gypsum bg-white p-5">
        <CaseProgress c={c} locale={locale} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid content-start gap-6">
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display mb-4 text-lg font-semibold text-navy">{ui.detail.info}</h2>
            <CaseInfo c={c} locale={locale} productName={productName ? t(productName.name, locale) : undefined} />
          </section>
          <section className="rounded-2xl border border-gypsum bg-white p-5">
            <h2 className="display mb-3 text-lg font-semibold text-navy">{ui.detail.files}</h2>
            <CaseFiles files={files} urls={urls} locale={locale} />
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
        </section>
      </div>
    </>
  );
}
