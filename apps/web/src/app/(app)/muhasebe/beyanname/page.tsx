import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Tabs, btnSecondary, inputCls, page } from "@/components/erp";
import { formatDate, getSession } from "@/lib/session";
import { Vat1Tab } from "./_parts/Vat1Tab";
import { Vat2Tab } from "./_parts/Vat2Tab";
import { WithholdingTab } from "./_parts/WithholdingTab";
import { StampTab } from "./_parts/StampTab";
import { RefundTab } from "./_parts/RefundTab";
import { ReconTab } from "./_parts/ReconTab";

export const dynamic = "force-dynamic";

const TABS: Array<[string, string]> = [
  ["kdv", "KDV1"],
  ["kdv2", "KDV2"],
  ["muhtasar", "Muhtasar ve prim hizmet"],
  ["damga", "Damga vergisi"],
  ["iade", "KDV iadesi"],
  ["babs", "Cari mutabakat"],
];

/** Beyanname hazırlık: KDV1, KDV2, muhtasar, damga vergisi, KDV iadesi, cari mutabakat */
export default async function TaxPrep({ searchParams }: { searchParams: Promise<{ ay?: string; sekme?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : prev;
  const tab = TABS.some(([k]) => k === sp.sekme) ? sp.sekme! : "kdv";
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const link = (p: Record<string, string>) => `/muhasebe/beyanname?${new URLSearchParams({ ay: month, sekme: tab, ...p })}`;
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  const props = { month, from, to, canEdit };
  return (
    <>
      <PageHeader title="Beyanname hazırlık" subtitle={`${month} dönemi · tutarlar ERP kayıtlarından; beyanname mali müşavirin kendi şifresiyle verilir`}
        actions={<div className="flex gap-4"><Link href="/muhasebe/vergi-takvimi" className="text-sm font-semibold text-brand-700">Vergi takvimi</Link><Link href="/muhasebe/donem" className="text-sm font-semibold text-brand-700">Dönem işlemleri</Link></div>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs active={link({ sekme: tab })} items={TABS.map(([k, l]) => [link({ sekme: k }), l])} />
          <form className="ml-auto flex gap-2"><input type="hidden" name="sekme" value={tab} /><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} /><button className={btnSecondary}>Göster</button></form>
        </div>
        {tab === "kdv" && <Vat1Tab {...props} />}
        {tab === "kdv2" && <Vat2Tab {...props} />}
        {tab === "muhtasar" && <WithholdingTab {...props} />}
        {tab === "damga" && <StampTab {...props} />}
        {tab === "iade" && <RefundTab {...props} />}
        {tab === "babs" && <ReconTab {...props} />}
        <p className="text-xs text-muted">Dönem: {formatDate(from)} – {formatDate(to)}</p>
      </div>
    </>
  );
}
