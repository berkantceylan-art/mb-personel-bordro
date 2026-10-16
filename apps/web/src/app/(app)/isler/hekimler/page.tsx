import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { PriceHistoryButton } from "@/components/PriceHistoryButton";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { CUSTOMER_KIND, type Customer } from "@/lib/jobs";
import { CustomerForm } from "./CustomerForm";

export const dynamic = "force-dynamic";

/** Hekim / hastane kayıt listesi */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tur?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: accs }, { data: jobs }] = await Promise.all([
    supabase.from("lab_customers").select("*").order("name"),
    supabase.from("portal_accounts").select("id, name, company").eq("status", "active").order("name"),
    supabase.from("jobs").select("customer_id, status").in("status", ["open", "tryin", "ready"]),
  ]);
  const list = (data ?? []) as Customer[];
  const linked = new Set(list.map((c) => c.portal_account_id).filter(Boolean));
  const openCount = new Map<string, number>();
  for (const j of jobs ?? []) openCount.set(j.customer_id as string, (openCount.get(j.customer_id as string) ?? 0) + 1);
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const shown = list.filter((c) => (!sp.tur || c.kind === sp.tur) && (!q || `${c.name} ${c.city ?? ""} ${c.phone ?? ""}`.toLocaleLowerCase("tr").includes(q)));
  const th = "py-2.5 px-3 font-semibold border-b border-line text-left";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="Hekim / hastane" subtitle={`${list.length} kart`} actions={<Link href="/isler/yeni" className="text-sm font-semibold text-brand-700">İş kayıt</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">Tablolar yok: Supabase&apos;de 20261125000000_lab_jobs.sql çalıştırın.</p>}
        <Card title="Hekime özel fiyat listeleri">
          <p className="text-sm text-muted">Her hekimin kendi fiyat listesi, o hekimin geçmiş işlerinden (Dentalsis&apos;ten aktarılanlar dahil) ürün başına en son uygulanan fiyatla oluşturulur. İş kayıtta bu fiyat gelir; hekim kartındaki “Özel fiyatlar”dan düzeltebilir, “Fiyat listesi yazdır” ile çıktı alabilirsiniz.</p>
          <PriceHistoryButton customerId={null} label="Tüm hekimlerin fiyat listesini oluştur" />
        </Card>
        <Card title="Yeni hekim / hastane">
          <CustomerForm accounts={(accs ?? []).map((a) => ({ id: a.id, name: a.company ? `${a.company} (${a.name})` : a.name, linked: linked.has(a.id) }))} />
        </Card>
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="Ad, şehir, telefon" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm flex-1 min-w-48" />
          <select name="tur" defaultValue={sp.tur ?? ""} className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm">
            <option value="">Tüm türler</option>
            {Object.entries(CUSTOMER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Ara</button>
        </form>
        <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Ad</th><th className={th}>Tür</th><th className={th}>Şehir / ülke</th><th className={th}>Telefon</th><th className={th}>Para</th><th className={th}>Açık iş</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={c.is_active ? "" : "opacity-60"}>
                  <td className={td}><Link href={`/isler/hekimler/${c.id}`} className="font-semibold text-brand-700">{c.name}</Link>{c.portal_account_id && <span className="ml-2 text-[11px] font-semibold text-ok">portal</span>}{!c.is_active && <span className="ml-2 text-[11px] text-muted">pasif</span>}</td>
                  <td className={td}>{CUSTOMER_KIND[c.kind] ?? c.kind}</td>
                  <td className={td}>{[c.city, c.country].filter(Boolean).join(", ")}</td>
                  <td className={td}>{c.phone ?? "—"}</td>
                  <td className={td}>{c.currency}</td>
                  <td className={`${td} num`}>{openCount.get(c.id) ?? 0}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Kayıt yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
