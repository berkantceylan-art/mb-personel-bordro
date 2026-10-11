import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { EmptyRow, KPI, Money, Notice, Table, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { ASSET_CATEGORY, ASSET_STATUS } from "@/lib/ozluk-docs";

export const dynamic = "force-dynamic";

type A = { id: string; code: string | null; name: string; category: string; brand_model: string | null; serial_no: string | null; purchase_date: string | null; value: number | null; status: string; location: string | null; useful_life_months: number | null; salvage_value: number; depreciation_method: string; warranty_until: string | null; next_maintenance: string | null; disposed_on: string | null };

/** Demirbaş: değer, birikmiş amortisman, net defter değeri, bakım ve garanti takibi */
export default async function AssetRegister({ searchParams }: { searchParams: Promise<{ q?: string; tur?: string; durum?: string }> }) {
  const s = await getSession();
  const lvl = s.modules.assets ?? 0;
  if (lvl < 1 && !["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: dep }, { data: holders }] = await Promise.all([
    supabase.from("assets").select("id, code, name, category, brand_model, serial_no, purchase_date, value, status, location, useful_life_months, salvage_value, depreciation_method, warranty_until, next_maintenance, disposed_on").order("code").order("name"),
    supabase.from("asset_depreciation").select("asset_id, amount").limit(50000),
    supabase.from("asset_assignments").select("asset_id, employees(first_name, last_name)").is("returned_on", null),
  ]);
  const acc = new Map<string, number>();
  for (const d of dep ?? []) acc.set(d.asset_id as string, (acc.get(d.asset_id as string) ?? 0) + Number(d.amount));
  const who = new Map(((holders ?? []) as unknown as { asset_id: string; employees: { first_name: string; last_name: string } | null }[]).map((h) => [h.asset_id, h.employees ? `${h.employees.first_name} ${h.employees.last_name}` : ""]));
  const all = (data ?? []) as A[];
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const rows = all.filter((a) => (!sp.tur || a.category === sp.tur) && (!sp.durum || a.status === sp.durum) && (!q || `${a.code ?? ""} ${a.name} ${a.brand_model ?? ""} ${a.serial_no ?? ""} ${a.location ?? ""} ${who.get(a.id) ?? ""}`.toLocaleLowerCase("tr").includes(q)));
  const t = today();
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const live = all.filter((a) => a.status !== "RETIRED");
  const cost = live.reduce((x, a) => x + Number(a.value ?? 0), 0);
  const accum = live.reduce((x, a) => x + (acc.get(a.id) ?? 0), 0);
  const maintDue = live.filter((a) => a.next_maintenance && a.next_maintenance <= soon);
  const noLife = live.filter((a) => Number(a.value ?? 0) > 0 && !a.useful_life_months && a.depreciation_method !== "none");
  return (
    <>
      <PageHeader title="Demirbaş" subtitle="Değer, amortisman, bakım ve garanti. Zimmet işlemleri Zimmet sayfasında."
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/demirbas/amortisman" className="text-brand-700">Amortisman</Link><Link href="/zimmet" className="text-brand-700">Zimmet / yeni demirbaş</Link><Link href={`/yazdir/demirbas-etiket?ids=${rows.slice(0, 60).map((a) => a.id).join(",")}`} className="text-brand-700">QR etiket</Link></span>} />
      <div className={page}>
        {error && <Notice tone="bad">{/useful_life|location|column/.test(error.message) ? "Demirbaş tabloları güncel değil: Supabase'de 20261206000000_expenses_assets.sql çalıştırın." : error.message}</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Maliyet" value={fmt(cost)} sub={`${live.length} demirbaş`} />
          <KPI label="Birikmiş amortisman" value={fmt(accum)} />
          <KPI label="Net defter değeri" value={fmt(cost - accum)} />
          <KPI label="30 gün içinde bakım" value={maintDue.length} tone={maintDue.some((a) => a.next_maintenance! < t) ? "bad" : undefined} />
        </div>
        {noLife.length > 0 && <Notice>{noLife.length} demirbaşın faydalı ömrü girilmemiş; amortisman hesaplanmaz. Demirbaşı açıp “Ömür (yıl)” girin.</Notice>}
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="Ad, no, seri, yer, kimde" className={`${inputCls} flex-1 min-w-48`} />
          <select name="tur" defaultValue={sp.tur ?? ""} className={`${selectCls} w-44`}><option value="">Tüm türler</option>{Object.entries(ASSET_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select name="durum" defaultValue={sp.durum ?? ""} className={`${selectCls} w-44`}><option value="">Tüm durumlar</option>{Object.entries(ASSET_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className={btnSecondary}>Süz</button>
        </form>
        <Table head={["No", "Demirbaş", "Yer / kimde", "Alış", "Maliyet", "Birikmiş amort.", "Net değer", "Bakım", "Durum"]} min={1100}>
          {rows.map((a) => {
            const ac = acc.get(a.id) ?? 0;
            return (
              <tr key={a.id} className={a.status === "RETIRED" ? "opacity-50" : ""}>
                <td className={`${td} num text-muted`}>{a.code ?? ""}</td>
                <td className={td}><Link href={`/demirbas/${a.id}`} className="font-semibold text-brand-700">{a.name}</Link><span className="block text-xs text-muted">{ASSET_CATEGORY[a.category]}{a.brand_model ? ` · ${a.brand_model}` : ""}</span></td>
                <td className={td}>{a.location ?? ""}{who.get(a.id) && <span className="block text-xs text-brand-700">{who.get(a.id)}</span>}</td>
                <td className={td}>{a.purchase_date ? formatDate(a.purchase_date) : "—"}</td>
                <td className={tdNum}>{a.value ? <Money v={a.value} /> : "—"}</td>
                <td className={tdNum}>{ac ? <Money v={ac} /> : ""}</td>
                <td className={tdNum}>{a.value ? <Money v={Number(a.value) - ac} strong /> : ""}</td>
                <td className={`${td} ${a.next_maintenance && a.next_maintenance < t ? "text-bad font-semibold" : ""}`}>{a.next_maintenance ? formatDate(a.next_maintenance) : ""}{a.warranty_until && a.warranty_until >= t && <span className="block text-xs text-ok">garanti {formatDate(a.warranty_until)}</span>}</td>
                <td className={td}><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${ASSET_STATUS[a.status]?.[1] ?? ""}`}>{ASSET_STATUS[a.status]?.[0] ?? a.status}</span></td>
              </tr>
            );
          })}
          {rows.length === 0 && <EmptyRow cols={9} text="Demirbaş yok. Zimmet sayfasından ekleyin." />}
        </Table>
      </div>
    </>
  );
}
