import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PayCalendar, monthRange } from "@/components/supplier/PayCalendar";
import { PlanForm } from "@/components/supplier/PlanForm";
import { savePaySettings } from "@/lib/supplier-portal-actions";
import { portalError, type PayItem } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ödeme takvimi" };

/** Tüm tedarikçiler: fatura vadeleri (açık tutar), verilen çek / senetler, planlı ödemeler + hatırlatma ayarı */
export default async function PaymentCalendar({ searchParams }: { searchParams: Promise<{ ay?: string; tur?: string }> }) {
  const s = await getSession();
  if (Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const r = monthRange(sp.ay);
  const sb = await createClient();
  const [{ data, error }, { data: parties }, { data: set }] = await Promise.all([
    sb.rpc("pay_calendar", { p_from: r.from, p_to: r.to, p_party: null }),
    sb.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both"]).is("slip_of", null).order("name").limit(3000),
    sb.from("pur_settings").select("pay_remind_days, remind_supplier").maybeSingle(),
  ]);
  let items = (data ?? []) as PayItem[];
  if (sp.tur) items = items.filter((i) => i.kind === sp.tur);
  const canWrite = (s.modules.purchases ?? 0) >= 2 || (s.modules.finance ?? 0) >= 2;
  const canSet = (s.modules.purchases ?? 0) >= 3 || (s.modules.finance ?? 0) >= 3;
  const cfg = (set ?? null) as { pay_remind_days: number; remind_supplier: boolean } | null;
  const base = `/satinalma/odeme-takvimi${sp.tur ? `?tur=${sp.tur}` : ""}`;

  return (
    <>
      <PageHeader title="Ödeme takvimi" subtitle="Tedarikçi fatura vadeleri, verdiğimiz çek / senetler ve planlı ödemeler — vadeden önce ve vade günü bildirim"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/satinalma/tedarikci-merkezi" className="text-brand-700">Tedarikçi merkezi</Link><Link href="/finans/cek-senet" className="text-brand-700">Çek / senet</Link></span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p>}
        <div className="flex flex-wrap gap-2 text-sm">
          {([["", "Hepsi"], ["invoice", "🧾 Fatura vadeleri"], ["cheque", "🏦 Çekler"], ["note", "📜 Senetler"], ["plan", "📅 Planlı"]] as const).map(([k, l]) => (
            <Link key={k} href={`?${new URLSearchParams({ ay: r.month, ...(k ? { tur: k } : {}) })}`} className={`h-9 px-3 inline-flex items-center rounded-full border font-semibold ${(sp.tur ?? "") === k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{l}</Link>
          ))}
        </div>
        {canWrite && <PlanForm parties={(parties ?? []) as { id: string; name: string }[]} />}
        {!error && <PayCalendar items={items} ay={r.month} base={base} showParty lab={canWrite} />}
        {canSet && (
          <form action={savePaySettings} className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-end gap-3 text-sm">
            <h2 className="w-full font-display font-bold text-brand-800">Hatırlatma (alarm) ayarları</h2>
            <label className="flex flex-col gap-1">Fatura / çek / senet için kaç gün önce<input type="number" name="days" min={0} max={30} defaultValue={cfg?.pay_remind_days ?? 3} className="h-10 w-24 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
            <label className="flex items-center gap-2 h-10"><input type="checkbox" name="supplier" defaultChecked={cfg?.remind_supplier ?? false} /> Çek / senet vadesinde tedarikçiye de e-posta / WhatsApp gitsin</label>
            <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
            <span className="w-full text-xs text-muted">Her sabah 09:00&apos;da kontrol edilir: vadeye belirtilen gün kala ve vade günü finans ile satın alma yetkililerine bildirim (telefon bildirimi dahil) gider. Planlı ödemelerde gün sayısı plan başına ayarlanır.</span>
          </form>
        )}
      </div>
    </>
  );
}
