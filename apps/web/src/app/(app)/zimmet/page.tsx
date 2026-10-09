import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader, Stat } from "@/components/ui";
import { ASSET_CATEGORY, ASSET_STATUS } from "@/lib/ozluk-docs";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { AssetForm } from "./AssetForm";
import { assignAsset, deleteAsset, returnAsset } from "./actions";

type Asset = { id: string; code: string | null; name: string; category: string; brand_model: string | null; serial_no: string | null; purchase_date: string | null; value: number | null; status: string; note: string | null };
type Assign = { id: string; asset_id: string; employee_id: string; assigned_on: string; returned_on: string | null; condition_out: string | null; condition_in: string | null; acknowledged_at: string | null; note: string | null };

/** Zimmet: demirbaş listesi, kimde olduğu, zimmetleme ve iade */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ durum?: string; tur?: string; q?: string; duzenle?: string; personel?: string; gecmis?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: assetsRaw, error }, { data: open }, { data: emps }] = await Promise.all([
    supabase.from("assets").select("*").order("code").order("name"),
    supabase.from("asset_assignments").select("id, asset_id, employee_id, assigned_on, returned_on, condition_out, condition_in, acknowledged_at, note").order("assigned_on", { ascending: false }),
    supabase.from("employees").select("id, first_name, last_name, status, departments(name)").order("first_name"),
  ]);
  const assets = (assetsRaw ?? []) as Asset[];
  const assigns = (open ?? []) as Assign[];
  const holder = new Map<string, Assign>();
  for (const a of assigns) if (!a.returned_on && !holder.has(a.asset_id)) holder.set(a.asset_id, a);
  const empName = new Map((emps ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim()]));
  const activeEmps = (emps ?? []).filter((e) => e.status !== "terminated").map((e) => ({ id: e.id, name: `${empName.get(e.id)} · ${(e.departments as unknown as { name: string } | null)?.name ?? ""}` }));
  const q = (sp.q ?? "").toLocaleLowerCase("tr");
  const list = assets.filter((a) => (!sp.durum || a.status === sp.durum) && (!sp.tur || a.category === sp.tur) && (!q || `${a.code ?? ""} ${a.name} ${a.brand_model ?? ""} ${a.serial_no ?? ""} ${empName.get(holder.get(a.id)?.employee_id ?? "") ?? ""}`.toLocaleLowerCase("tr").includes(q)));
  const editing = sp.duzenle ? assets.find((a) => a.id === sp.duzenle) : undefined;
  const counts = { total: assets.length, assigned: assets.filter((a) => a.status === "ASSIGNED").length, available: assets.filter((a) => a.status === "AVAILABLE").length, unack: [...holder.values()].filter((h) => !h.acknowledged_at).length, value: assets.filter((a) => a.status !== "RETIRED").reduce((x, a) => x + Number(a.value ?? 0), 0) };
  const th = "py-2.5 px-3 font-semibold border-b border-line text-left whitespace-nowrap";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6] align-top";
  const input = "h-10 rounded-lg border border-[#D5DEE8] px-2 text-sm bg-white";

  return (
    <>
      <PageHeader title="Zimmet" subtitle={`${counts.total} demirbaş · ${counts.assigned} zimmetli · ${counts.available} boşta${counts.unack ? ` · ${counts.unack} teslim onayı bekliyor` : ""}`} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <p className="text-sm text-bad bg-[#FDECEA] rounded-lg p-3">Zimmet tabloları yok: Supabase&apos;de 20261103000000_assets.sql çalıştırın.</p>}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Toplam demirbaş" value={String(counts.total)} sub={`değer ${formatTL(counts.value)}`} />
          <Stat label="Zimmetli" value={String(counts.assigned)} sub={`${counts.unack} onay bekliyor`} />
          <Stat label="Boşta" value={String(counts.available)} />
          <Stat label="Arızalı / kayıp" value={String(assets.filter((a) => a.status === "MAINTENANCE" || a.status === "LOST").length)} />
        </section>

        <Card title={editing ? `Düzenle: ${editing.name}` : "Demirbaş"} action={editing ? <Link href="/zimmet" className="text-sm font-semibold text-brand-700">Vazgeç</Link> : undefined}>
          <AssetForm key={editing?.id ?? "new"} asset={editing} categories={ASSET_CATEGORY} employees={activeEmps} defaultEmployee={sp.personel} />
        </Card>

        <form className="flex flex-wrap gap-2 items-end">
          <input name="q" defaultValue={sp.q} placeholder="Ad, no, seri, kimde" className={`${input} h-11 flex-1 min-w-48`} />
          <select name="durum" defaultValue={sp.durum ?? ""} className={`${input} h-11`}><option value="">Tüm durumlar</option>{Object.entries(ASSET_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <select name="tur" defaultValue={sp.tur ?? ""} className={`${input} h-11`}><option value="">Tüm türler</option>{Object.entries(ASSET_CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Filtrele</button>
          <Link href={`/zimmet?gecmis=1${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} className="h-11 px-3 inline-flex items-center text-sm font-semibold text-brand-700">{sp.gecmis ? "Listeye dön" : "Zimmet geçmişi"}</Link>
        </form>

        {sp.gecmis ? (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead><tr className="text-xs text-muted"><th className={th}>Demirbaş</th><th className={th}>Personel</th><th className={th}>Teslim</th><th className={th}>İade</th><th className={th}>Durum (teslim → iade)</th><th className={th}>Onay</th></tr></thead>
              <tbody>
                {assigns.filter((a) => !q || `${assets.find((x) => x.id === a.asset_id)?.name ?? ""} ${empName.get(a.employee_id) ?? ""}`.toLocaleLowerCase("tr").includes(q)).map((a) => { const as = assets.find((x) => x.id === a.asset_id); return (
                  <tr key={a.id}>
                    <td className={td}>{as?.code ? <span className="num text-muted">{as.code} · </span> : null}{as?.name ?? "—"}</td>
                    <td className={td}><Link href={`/personel/${a.employee_id}`} className="font-semibold text-brand-700">{empName.get(a.employee_id) ?? "—"}</Link></td>
                    <td className={`${td} num`}>{formatDate(a.assigned_on)}</td>
                    <td className={`${td} num`}>{a.returned_on ? formatDate(a.returned_on) : <span className="text-warn">zimmette</span>}</td>
                    <td className={td}>{a.condition_out ?? "—"}{a.returned_on ? ` → ${a.condition_in ?? "—"}` : ""}{a.note && <div className="text-xs text-muted">{a.note}</div>}</td>
                    <td className={td}>{a.acknowledged_at ? <span className="text-xs text-ok font-semibold">personel onayladı</span> : a.returned_on ? "" : <span className="text-xs text-muted">bekliyor</span>}</td>
                  </tr>
                ); })}
                {assigns.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Zimmet kaydı yok.</td></tr>}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead><tr className="text-xs text-muted"><th className={th}>No</th><th className={th}>Demirbaş</th><th className={th}>Tür</th><th className={th}>Seri</th><th className={`${th} text-right`}>Değer</th><th className={th}>Durum</th><th className={th}>Kimde</th><th className={th}><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {list.map((a) => {
                  const h = holder.get(a.id);
                  const [label, cls] = ASSET_STATUS[a.status] ?? ASSET_STATUS.AVAILABLE!;
                  return (
                    <tr key={a.id}>
                      <td className={`${td} num text-muted`}>{a.code ?? "—"}</td>
                      <td className={td}><Link href={`/zimmet?duzenle=${a.id}`} className="font-semibold text-brand-700">{a.name}</Link>{a.brand_model && <div className="text-xs text-muted">{a.brand_model}</div>}{a.note && <div className="text-xs text-muted">{a.note}</div>}</td>
                      <td className={td}>{ASSET_CATEGORY[a.category] ?? a.category}</td>
                      <td className={`${td} num text-xs`}>{a.serial_no ?? "—"}</td>
                      <td className={`${td} num text-right`}>{a.value ? formatTL(a.value) : "—"}</td>
                      <td className={td}><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${cls}`}>{label}</span></td>
                      <td className={td}>
                        {h ? (<><Link href={`/personel/${h.employee_id}`} className="font-semibold text-brand-700">{empName.get(h.employee_id)}</Link><div className="text-xs text-muted num">{formatDate(h.assigned_on)}{h.acknowledged_at ? " · onayladı" : " · onay bekliyor"}</div></>) : <span className="text-muted">—</span>}
                      </td>
                      <td className={`${td} text-right`}>
                        {h ? (
                          <form action={returnAsset} className="flex gap-1 justify-end items-center flex-wrap">
                            <input type="hidden" name="id" value={h.id} />
                            <input type="date" name="returned_on" defaultValue={todayIso()} aria-label="İade tarihi" className={`${input} h-8 text-xs`} />
                            <select name="condition_in" aria-label="İade durumu" className={`${input} h-8 text-xs`}><option>Sağlam</option><option>Hasarlı</option><option>Arızalı</option><option>Kayıp</option></select>
                            <button className="h-8 px-2.5 rounded-md border border-[#D5DEE8] text-xs font-semibold text-brand-700">İade al</button>
                          </form>
                        ) : a.status === "AVAILABLE" ? (
                          <form action={assignAsset} className="flex gap-1 justify-end items-center flex-wrap">
                            <input type="hidden" name="asset_id" value={a.id} />
                            <select name="employee_id" required aria-label="Personel" className={`${input} h-8 text-xs max-w-44`}><option value="">Zimmetle…</option>{activeEmps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                            <button className="h-8 px-2.5 rounded-md bg-brand-700 text-white text-xs font-semibold">Ver</button>
                          </form>
                        ) : null}
                        {!h && a.status === "AVAILABLE" && ["owner", "hr"].includes(s.role) && (
                          <form action={deleteAsset} className="mt-1 text-right"><input type="hidden" name="id" value={a.id} /><ConfirmSubmit label="Sil" question="Demirbaş silinsin mi?" className="text-xs text-bad font-semibold" /></form>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">Demirbaş yok.</td></tr>}
              </tbody>
            </table>
          </section>
        )}
        <p className="text-xs text-muted">Zimmet verince personelin telefonuna bildirim gider ve &quot;teslim aldım&quot; onayı istenir. İmzalı tutanak için personel sayfasındaki Zimmet kartından &quot;Zimmet tutanağı&quot; indirilir. İşten çıkışta açık zimmetler çıkış sihirbazında uyarı olarak görünür.</p>
      </div>
    </>
  );
}
