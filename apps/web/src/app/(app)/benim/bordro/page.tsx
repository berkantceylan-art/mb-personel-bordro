import { formatTL } from "@mb/core";
import { periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

export default async function MyPayrollPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Bordrolarım" />;
  const [{ data: payroll }, { data: signedRows }] = await Promise.all([
    supabase.from("payroll_lines").select("period, days, official_gross, official_net, net_to_bank, bes, garnishment").eq("employee_id", e.id).order("period", { ascending: false }).limit(24),
    supabase.from("employee_documents").select("id, period, file_path, document_types!inner(name)").eq("employee_id", e.id).eq("document_types.name", "İmzalı bordro").not("period", "is", null),
  ]);
  const signedLink = new Map<string, string>();
  if (signedRows?.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(signedRows.map((r) => r.file_path), 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && signedLink.set(signedRows[i]!.period as string, u.signedUrl));
  }
  const periods = [...new Set([...(payroll ?? []).map((p) => p.period as string), ...signedRows?.map((r) => r.period as string) ?? []])].sort().reverse();
  const line = new Map((payroll ?? []).map((p) => [p.period as string, p]));
  return (
    <>
      <MyHeader title="Bordrolarım" subtitle="Resmi bordro özetleri" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <ul className="flex flex-col gap-3">
          {periods.map((per) => { const p = line.get(per); return (
            <li key={per} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center gap-3">
                <span className="font-semibold text-brand-800">{periodLabel(per)}</span>
                {signedLink.has(per) ? (
                  <a href={signedLink.get(per)} target="_blank" rel="noreferrer" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold">İmzalı bordroyu indir ↓</a>
                ) : <span className="text-xs text-muted">imzalı bordro henüz yok</span>}
              </div>
              {p ? (
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
                  <div><dt className="text-xs text-muted">Gün</dt><dd className="num">{p.days}</dd></div>
                  <div><dt className="text-xs text-muted">Brüt</dt><dd className="num">{formatTL(Number(p.official_gross))}</dd></div>
                  <div><dt className="text-xs text-muted">Net</dt><dd className="num">{formatTL(Number(p.official_net))}</dd></div>
                  <div><dt className="text-xs text-muted">Bankaya</dt><dd className="num font-semibold">{formatTL(Number(p.net_to_bank))}</dd></div>
                  {Number(p.bes ?? 0) > 0 && <div><dt className="text-xs text-muted">BES</dt><dd className="num">{formatTL(Number(p.bes))}</dd></div>}
                  {Number(p.garnishment ?? 0) > 0 && <div><dt className="text-xs text-muted">İcra</dt><dd className="num">{formatTL(Number(p.garnishment))}</dd></div>}
                </dl>
              ) : <p className="text-xs text-muted">Bu ayın bordro hesabı henüz yapılmadı.</p>}
            </li>
          ); })}
          {periods.length === 0 && <li className="py-6 text-center text-muted">Henüz bordro yok.</li>}
        </ul>
        <p className="text-xs text-muted">Bordro, ay kapandığında muhasebe tarafından oluşturulur. Islak imzalı bordronuz tarandığında &quot;İndir&quot; düğmesi burada görünür.</p>
      </div>
    </>
  );
}
