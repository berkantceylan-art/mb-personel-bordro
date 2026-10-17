import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { deleteRate, saveRate, saveWorker } from "@/lib/piecework-actions";
import { DOC, pcErr, type PcRate, type PcWorker } from "@/lib/piecework";
import { WorkerForm } from "./WorkerForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parça başı · tanımlar" };

const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 w-full";

/** Parça başı ustalar (personel / dış) ve fiyat listesi */
export default async function PieceSetupPage({ searchParams }: { searchParams: Promise<{ usta?: string; fiyat?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const canEdit = ["owner", "hr", "accountant"].includes(s.role) || (s.modules.production ?? 0) >= 3 || (s.modules.payroll ?? 0) >= 2;
  if (!canEdit && !["branch_manager"].includes(s.role) && (s.modules.production ?? 0) < 1) redirect("/");
  const sb = await createClient();
  const [{ data: workers, error }, { data: rates }, { data: emps }, { data: prods }] = await Promise.all([
    sb.from("pc_workers").select("id, kind, employee_id, party_id, name, phone, doc_type, stopaj_pct, pay_side, pay_days, is_active, note").order("is_active", { ascending: false }).order("name"),
    sb.from("pc_rates").select("id, lab_product_id, work_name, unit, price, worker_id, is_active").eq("is_active", true).order("work_name"),
    sb.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
    sb.from("lab_products").select("id, name").eq("is_active", true).order("sort").order("name"),
  ]);
  const ws = (workers ?? []) as PcWorker[];
  const rs = (rates ?? []) as PcRate[];
  const editing = ws.find((w) => w.id === sp.usta);
  const editRate = rs.find((r) => r.id === sp.fiyat);
  const { data: party } = editing?.party_id ? await sb.from("fin_parties").select("iban, tax_no").eq("id", editing.party_id).maybeSingle() : { data: null };
  const wName = new Map(ws.map((w) => [w.id, w.name]));
  const pName = new Map(((prods ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const used = new Set(ws.filter((w) => w.employee_id).map((w) => w.employee_id));
  const employees = ((emps ?? []) as { id: string; first_name: string; last_name: string }[]).filter((e) => !used.has(e.id) || e.id === editing?.employee_id).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }));
  const err = pcErr(error?.message ?? null);

  return (
    <>
      <PageHeader title="Parça başı · ustalar ve fiyat listesi" subtitle="Parça başı çalışan personel / dış ustalar ve ürün başına ödenecek birim fiyatlar" actions={<Link href="/uretim/parca-basi" className="text-sm font-semibold text-brand-700">← Parça başı</Link>} />
      <div className="p-4 md:p-6 flex flex-wrap gap-5 items-start max-w-[1400px]">
        {err && <p className="w-full text-sm text-bad bg-bad-bg rounded-lg p-3">{err}</p>}
        <section className="flex-[1_1_560px] min-w-0 flex flex-col gap-4">
          {canEdit && (
            <div id="usta" className="bg-white border border-line rounded-[16px] p-5 flex flex-col gap-3">
              <div className="flex justify-between items-baseline"><h2 className="font-display font-semibold text-brand-800">{editing ? `${editing.name} — düzenle` : "Yeni usta"}</h2>{editing && <Link href="/uretim/parca-basi/tanimlar" className="text-xs font-semibold text-muted">Vazgeç</Link>}</div>
              <WorkerForm key={editing?.id ?? "new"} action={saveWorker} worker={editing} employees={employees} party={party as { iban: string | null; tax_no: string | null } | null} />
            </div>
          )}
          <div className="bg-white border border-line rounded-[16px] overflow-hidden">
            <h2 className="font-display font-semibold text-brand-800 px-5 pt-4 pb-2">Ustalar <span className="num text-muted text-sm">{ws.length}</span></h2>
            <ul>
              {ws.map((w) => (
                <li key={w.id} className={`flex items-center gap-3 px-5 py-3 border-t border-[#EEF2F6] ${w.is_active ? "" : "opacity-50"}`}>
                  <span className={`w-9 h-9 rounded-full grid place-items-center text-sm font-bold text-white ${w.kind === "internal" ? "bg-[#1565A8]" : "bg-[#7C5CC4]"}`}>{w.name.slice(0, 1)}</span>
                  <span className="flex-1 min-w-0">
                    <b className="block text-brand-800 truncate">{w.name}</b>
                    <span className="text-xs text-muted">
                      {w.kind === "internal" ? `Personel · ${w.pay_side === "OFFICIAL" ? "resmi (bordroya)" : "elden"}` : `Dış usta · ${DOC[w.doc_type] ?? w.doc_type}${Number(w.stopaj_pct) ? ` · stopaj %${w.stopaj_pct}` : ""} · ${w.pay_days} gün vade`}
                      {!w.is_active && " · pasif"}
                    </span>
                  </span>
                  {canEdit && <Link href={`?usta=${w.id}#usta`} className="text-sm font-semibold text-brand-700">Düzenle</Link>}
                </li>
              ))}
              {!ws.length && <li className="px-5 py-6 text-sm text-muted border-t border-[#EEF2F6]">Henüz usta yok.</li>}
            </ul>
          </div>
        </section>

        <section className="flex-[1_1_520px] min-w-0 flex flex-col gap-4">
          {canEdit && (
            <form id="fiyat" action={saveRate} className="bg-white border border-line rounded-[16px] p-5 grid gap-3 md:grid-cols-2">
              <h2 className="md:col-span-2 font-display font-semibold text-brand-800">{editRate ? "Fiyatı düzenle" : "Fiyat ekle"}</h2>
              {editRate && <input type="hidden" name="id" value={editRate.id} />}
              <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Ürün
                <select name="lab_product_id" defaultValue={editRate?.lab_product_id ?? ""} className={input}>
                  <option value="">— Ürüne bağlı olmayan iş (aşağıya ad yazın) —</option>
                  {((prods ?? []) as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">İş adı<input name="work_name" defaultValue={editRate?.work_name ?? ""} placeholder="Boş bırakılırsa ürün adı · ör. Model döküm, Bitim / glaze" className={input} /></label>
              <label className="flex flex-col gap-1.5 text-sm text-muted">Birim fiyat (₺) *<input name="price" required inputMode="decimal" defaultValue={editRate ? (editRate.price / 100).toLocaleString("tr-TR") : ""} className={`${input} num`} /></label>
              <label className="flex flex-col gap-1.5 text-sm text-muted">Birim<input name="unit" defaultValue={editRate?.unit ?? "üye"} className={input} /></label>
              <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Sadece bu usta için
                <select name="worker_id" defaultValue={editRate?.worker_id ?? ""} className={input}>
                  <option value="">Herkese geçerli (liste fiyatı)</option>
                  {ws.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <div className="md:col-span-2 flex gap-3 items-center">
                <PendingSubmit className="h-11 rounded-[10px] bg-brand-700 text-white font-semibold px-6">Kaydet</PendingSubmit>
                {editRate && <Link href="/uretim/parca-basi/tanimlar" className="text-sm font-semibold text-muted">Vazgeç</Link>}
                <span className="text-xs text-muted ml-auto">Ustaya özel fiyat, liste fiyatının önüne geçer.</span>
              </div>
            </form>
          )}
          <div className="bg-white border border-line rounded-[16px] overflow-x-auto">
            <h2 className="font-display font-semibold text-brand-800 px-5 pt-4 pb-2">Fiyat listesi <span className="num text-muted text-sm">{rs.length}</span></h2>
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-xs text-muted">
                <th className="py-2 px-5 font-semibold border-b border-line">Ürün / iş</th>
                <th className="py-2 px-2 font-semibold border-b border-line">Kime</th>
                <th className="py-2 px-2 font-semibold border-b border-line text-right">Fiyat</th>
                <th className="py-2 px-5 border-b border-line" />
              </tr></thead>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 px-5 border-b border-[#EEF2F6]"><b className="text-ink">{r.work_name}</b>{r.lab_product_id && pName.get(r.lab_product_id) !== r.work_name && <span className="block text-xs text-muted">{pName.get(r.lab_product_id) ?? "ürün"}</span>}</td>
                    <td className="py-2 px-2 border-b border-[#EEF2F6] text-xs">{r.worker_id ? <span className="font-semibold text-[#5B3A9A]">{wName.get(r.worker_id) ?? "—"}</span> : <span className="text-muted">Herkes</span>}</td>
                    <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right font-semibold">{tl(r.price)} <span className="text-xs text-muted font-normal">/ {r.unit}</span></td>
                    <td className="py-2 px-5 border-b border-[#EEF2F6] text-right whitespace-nowrap">
                      {canEdit && (
                        <span className="flex gap-3 justify-end">
                          <Link href={`?fiyat=${r.id}#fiyat`} className="text-xs font-semibold text-brand-700">Düzenle</Link>
                          <form action={deleteRate}><input type="hidden" name="id" value={r.id} /><button className="text-xs font-semibold text-muted hover:text-bad">Kaldır</button></form>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!rs.length && <tr><td colSpan={4} className="px-5 py-6 text-muted">Fiyat yok. Fiyatsız ürün girilirken birim fiyat elle yazılır.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
