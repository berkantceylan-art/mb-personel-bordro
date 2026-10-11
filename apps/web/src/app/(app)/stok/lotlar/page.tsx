import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { qty } from "@/lib/stock";
import { setLotStatus } from "@/lib/stock-actions";
import { waLink } from "@/lib/wa";

export const dynamic = "force-dynamic";

type Lot = { item_id: string; code: string | null; item: string; unit: string; lot_no: string; qty: number; expiry_date: string | null; days_left: number | null; status: "ok" | "quarantine" | "recalled"; reason: string | null; supplier: string | null; cert_no: string | null; first_in: string | null; jobs: number };
type Trace = { job_id: string; job_no: number; patient: string | null; customer_id: string | null; customer: string | null; phone: string | null; job_status: string; delivered_at: string | null; used_at: string; qty: number };
const ST: Record<Lot["status"], [string, string]> = { ok: ["Kullanılabilir", "bg-ok-bg text-ok"], quarantine: ["Karantina", "bg-warn-bg text-warn"], recalled: ["Geri çağrıldı", "bg-bad-bg text-bad"] };

/** Lot izlenebilirliği: SKT radarı, karantina / geri çağırma, lotun kullanıldığı işler ve hekimler */
export default async function LotsPage({ searchParams }: { searchParams: Promise<{ q?: string; durum?: string; sure?: string; malzeme?: string; lot?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1 && (s.modules.production ?? 0) < 1 && !s.logistics) redirect("/");
  const sp = await searchParams;
  const status = ["ok", "quarantine", "recalled"].includes(sp.durum ?? "") ? sp.durum! : null;
  const days = sp.sure && /^\d{1,3}$/.test(sp.sure) ? Number(sp.sure) : null;
  const supabase = await createClient();
  const [{ data, error }, { data: tr }] = await Promise.all([
    supabase.rpc("stk_lot_overview", { p_q: sp.q?.trim() || null, p_status: status, p_days: days }),
    sp.malzeme && sp.lot ? supabase.rpc("stk_lot_trace", { p_item: sp.malzeme, p_lot: sp.lot }) : Promise.resolve({ data: null }),
  ]);
  const lots = (data ?? []) as Lot[];
  const sel = sp.malzeme && sp.lot ? lots.find((l) => l.item_id === sp.malzeme && l.lot_no === sp.lot) ?? null : null;
  const trace = (tr ?? []) as Trace[];
  const canEdit = (s.modules.stock ?? 0) >= 2 || (s.modules.production ?? 0) >= 3;
  const expired = lots.filter((l) => l.qty > 0 && l.days_left !== null && l.days_left < 0).length;
  const soon = lots.filter((l) => l.qty > 0 && l.days_left !== null && l.days_left >= 0 && l.days_left <= 30).length;
  const blocked = lots.filter((l) => l.status !== "ok" && l.qty > 0).length;
  const link = (p: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const all = { q: sp.q ?? null, durum: status, sure: days !== null ? String(days) : null, ...p };
    Object.entries(all).forEach(([k, v]) => v && u.set(k, v));
    return `/stok/lotlar${u.size ? `?${u}` : ""}`;
  };
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm";

  return (
    <>
      <PageHeader title="Lot izlenebilirliği" subtitle="Malzeme lotları, son kullanma tarihleri, karantina ve geri çağırma; hangi lot hangi işe, hangi hekime gitti" actions={<Link href="/stok" className="text-sm font-semibold text-brand-700">Stok özeti</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261222000000_lots.sql çalıştırılmalı.</Notice>}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[["SKT'si geçmiş (stokta)", expired, "text-bad", link({ sure: "0", durum: null })], ["30 gün içinde dolacak", soon, "text-warn", link({ sure: "30", durum: null })], ["Karantina / geri çağrılan", blocked, "text-bad", link({ durum: "quarantine", sure: null })], ["Listelenen lot", lots.length, "", link({ durum: null, sure: null, q: null })]].map(([l, v, c, h]) => (
            <Link key={l as string} href={h as string} className="rounded-[16px] border border-line bg-white p-4 hover:border-brand-700"><div className="text-xs font-semibold text-muted">{l}</div><div className={`font-display text-2xl font-bold mt-1 ${c}`}>{v as number}</div></Link>
          ))}
        </div>
        <form className="flex flex-wrap gap-2 items-center">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Malzeme, kod ya da lot no" className={`${inp} w-64`} />
          <select name="durum" defaultValue={status ?? ""} className={inp}><option value="">Tüm durumlar</option><option value="ok">Kullanılabilir</option><option value="quarantine">Karantina</option><option value="recalled">Geri çağrıldı</option></select>
          <select name="sure" defaultValue={days !== null ? String(days) : ""} className={inp}><option value="">Tüm SKT</option><option value="0">Geçmiş</option><option value="30">30 gün içinde</option><option value="60">60 gün içinde</option><option value="90">90 gün içinde</option></select>
          <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Süz</button>
        </form>

        {sp.malzeme && sp.lot && (
          <Card title={`${sel?.item ?? "Malzeme"} · lot ${sp.lot}`} action={<Link href={link({ malzeme: null, lot: null })} className="text-sm font-semibold text-brand-700">Kapat</Link>}>
            {sel && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${ST[sel.status][1]}`}>{ST[sel.status][0]}</span>
                <span>Eldeki: <b>{qty(sel.qty)} {sel.unit}</b></span>
                <span>SKT: <b>{sel.expiry_date ? formatDate(sel.expiry_date) : "—"}</b></span>
                <span>Tedarikçi: <b>{sel.supplier ?? "—"}</b></span>
                <span>Sertifika: <b>{sel.cert_no ?? "—"}</b></span>
                <span>İlk giriş: <b>{sel.first_in ? formatDate(sel.first_in) : "—"}</b></span>
                {sel.reason && <span className="w-full text-muted">Neden: {sel.reason}</span>}
              </div>
            )}
            {canEdit && (
              <form action={setLotStatus} className="flex flex-wrap gap-2 items-end border-t border-line pt-3">
                <input type="hidden" name="item_id" value={sp.malzeme} />
                <input type="hidden" name="lot_no" value={sp.lot} />
                <label className="text-xs font-semibold text-muted flex flex-col gap-1">Neden<input name="reason" maxLength={500} placeholder="ör. üretici geri çağırma, çatlak, renk farkı" className={`${inp} w-72`} /></label>
                <label className="text-xs font-semibold text-muted flex flex-col gap-1">Sertifika / CoC no<input name="cert_no" maxLength={80} defaultValue={sel?.cert_no ?? ""} className={`${inp} w-40`} /></label>
                {sel?.status !== "quarantine" && <PendingSubmit name="status" value="quarantine" className="h-10 px-3 rounded-[10px] bg-[#D97706] text-white text-sm font-semibold">Karantinaya al</PendingSubmit>}
                {sel?.status !== "recalled" && <PendingSubmit name="status" value="recalled" className="h-10 px-3 rounded-[10px] bg-bad text-white text-sm font-semibold">Geri çağır</PendingSubmit>}
                {sel && sel.status !== "ok" && <PendingSubmit name="status" value="ok" className="h-10 px-3 rounded-[10px] border border-line text-sm font-semibold">Kullanıma aç</PendingSubmit>}
              </form>
            )}
            <h3 className="font-semibold text-sm mt-2">Bu lotun kullanıldığı işler ({trace.length})</h3>
            {trace.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-2">İş</th><th>Hasta</th><th>Hekim / klinik</th><th>Durum</th><th className="text-right">Miktar</th><th>Haber ver</th></tr></thead>
                  <tbody>
                    {trace.map((t) => {
                      const wa = waLink(t.phone, `Sayın ${t.customer ?? ""}, #${t.job_no} numaralı işinizde (${t.patient ?? ""}) kullanılan ${sel?.item ?? "malzeme"} lot ${sp.lot} için üretici bildirimi aldık. Sizinle görüşmek istiyoruz.`);
                      return (
                        <tr key={t.job_id} className="border-t border-[#EEF2F6]">
                          <td className="py-2"><Link href={`/isler/${t.job_id}`} className="font-semibold text-brand-700">#{t.job_no}</Link></td>
                          <td>{t.patient ?? "—"}</td>
                          <td>{t.customer_id ? <Link href={`/isler/hekimler/${t.customer_id}`} className="text-brand-700">{t.customer}</Link> : "—"}</td>
                          <td className="text-xs">{t.delivered_at ? `Teslim ${formatDate(t.delivered_at.slice(0, 10))}` : "Laboratuvarda"}</td>
                          <td className="text-right num">{qty(t.qty)}</td>
                          <td className="text-xs">{wa ? <a href={wa} target="_blank" rel="noreferrer" className="font-semibold text-[#128C7E]">WhatsApp</a> : t.phone ? <a href={`tel:${t.phone}`} className="text-brand-700">{t.phone}</a> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Bu lot henüz bir işte kullanılmamış.</p>
            )}
          </Card>
        )}

        <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Malzeme</th><th className="p-3">Lot</th><th className="p-3 text-right">Eldeki</th><th className="p-3">SKT</th><th className="p-3">Durum</th><th className="p-3">Tedarikçi</th><th className="p-3 text-right">İş</th></tr></thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.item_id + l.lot_no} className={`border-t border-[#EEF2F6] ${l.qty <= 0 ? "text-muted" : ""}`}>
                  <td className="p-3"><Link href={`/stok/urunler/${l.item_id}`} className="text-brand-700">{l.item}</Link>{l.code && <span className="ml-1 text-xs text-muted">{l.code}</span>}</td>
                  <td className="p-3"><Link href={link({ malzeme: l.item_id, lot: l.lot_no })} className="font-mono font-semibold text-brand-700">{l.lot_no}</Link></td>
                  <td className="p-3 text-right num">{qty(l.qty)} {l.unit}</td>
                  <td className={`p-3 whitespace-nowrap ${l.qty > 0 && l.days_left !== null ? (l.days_left < 0 ? "text-bad font-semibold" : l.days_left <= 30 ? "text-warn font-semibold" : "") : ""}`}>{l.expiry_date ? `${formatDate(l.expiry_date)}${l.qty > 0 && l.days_left !== null ? ` · ${l.days_left < 0 ? `${-l.days_left} gün geçti` : `${l.days_left} gün`}` : ""}` : "—"}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${ST[l.status][1]}`}>{ST[l.status][0]}</span></td>
                  <td className="p-3 text-xs">{l.supplier ?? "—"}</td>
                  <td className="p-3 text-right">{l.jobs ? <Link href={link({ malzeme: l.item_id, lot: l.lot_no })} className="text-brand-700 font-semibold">{l.jobs}</Link> : "0"}</td>
                </tr>
              ))}
              {lots.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">Lot kaydı yok. Lot takipli malzemelerin girişinde lot numarası yazıldığında burada görünür.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted">Karantinaya alınan ya da geri çağrılan lot iş tüketiminde ve satışta kullanılamaz; otomatik tüketim (FIFO) bu lotları atlar. Son kullanma tarihi 30 gün içinde dolacak lotlar için her sabah bildirim gider.</p>
      </div>
    </>
  );
}
