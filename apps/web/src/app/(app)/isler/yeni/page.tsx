import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { SHIPMENT_TO_RECEIVED } from "@/lib/jobs";
import { JobEditor, type Prefill } from "../JobEditor";
import { editorOptions } from "../data";

export const dynamic = "force-dynamic";

/** Yeni iş kaydı; ?gonderi= (kargodan) ya da ?vaka= (portal vakasından) bilgileri dolu açılır */
export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ gonderi?: string; vaka?: string; musteri?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const opts = await editorOptions();
  const supabase = await createClient();
  const prefill: Prefill = { customer_id: sp.musteri };

  let accountId: string | null = null;
  let caseId: string | null = sp.vaka ?? null;
  let source = "";
  if (sp.gonderi) {
    const { data: sh } = await supabase.from("shipments").select("id, no, portal_account_id, portal_case_id, contents, note").eq("id", sp.gonderi).maybeSingle();
    if (sh) {
      prefill.shipment_id = sh.id;
      accountId = sh.portal_account_id;
      caseId = caseId ?? sh.portal_case_id;
      prefill.received = (sh.contents as string[]).map((c) => SHIPMENT_TO_RECEIVED[c]).filter((x): x is string => !!x);
      source = `Kargo G${sh.no}`;
    }
  }
  if (caseId) {
    const { data: pc } = await supabase.from("portal_cases").select("id, no, account_id, patient_ref, teeth, shade, notes, product_slug").eq("id", caseId).maybeSingle();
    if (pc) {
      prefill.portal_case_id = pc.id;
      accountId = accountId ?? pc.account_id;
      prefill.patient = pc.patient_ref;
      prefill.shade = pc.shade ?? undefined;
      prefill.description = [pc.product_slug ? `Ürün: ${pc.product_slug}` : "", pc.notes ?? ""].filter(Boolean).join("\n") || undefined;
      const mat = /zirkon/i.test(pc.product_slug ?? "") ? "zirkon" : /porselen/i.test(pc.product_slug ?? "") ? "porselen" : /implant/i.test(pc.product_slug ?? "") ? "implant" : /inlay/i.test(pc.product_slug ?? "") ? "inlayonlay" : /iskelet/i.test(pc.product_slug ?? "") ? "iskelet" : null;
      if (mat && Array.isArray(pc.teeth)) prefill.teeth = Object.fromEntries((pc.teeth as number[]).map((t) => [String(t), mat]));
      source = source ? `${source} · portal vakası #${pc.no}` : `Portal vakası #${pc.no}`;
    }
  }
  if (accountId && !prefill.customer_id) {
    const { data: c } = await supabase.from("lab_customers").select("id").eq("portal_account_id", accountId).maybeSingle();
    if (c) prefill.customer_id = c.id;
  }

  return (
    <>
      <PageHeader
        title="İş kayıt"
        subtitle={source ? `${source} bilgileriyle açıldı` : "Yeni iş"}
        actions={
          <div className="flex gap-3 text-sm font-semibold">
            <Link href="/isler" className="text-brand-700">İş listesi</Link>
            <Link href="/isler/hekimler" className="text-brand-700">+ Hekim / hastane</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 max-w-[1320px]">
        {opts.missing && <p className="mb-4 text-sm text-bad bg-bad-bg rounded-lg p-3">İş kayıt tabloları yok: Supabase&apos;de 20261125000000_lab_jobs.sql çalıştırın.</p>}
        {!opts.missing && opts.customers.length === 0 && (
          <p className="mb-4 text-sm text-warn bg-warn-bg rounded-lg p-3">
            Önce <Link href="/isler/hekimler" className="font-semibold underline">Hekim / hastane</Link> kartı açın; ürün fiyatları için <Link href="/isler/urunler" className="font-semibold underline">Protez / ürün</Link> listesini doldurun.
          </p>
        )}
        <JobEditor customers={opts.customers} products={opts.products} delivery={opts.delivery} tryins={opts.tryins} prefill={prefill} nextNo={opts.nextNo} />
      </div>
    </>
  );
}
