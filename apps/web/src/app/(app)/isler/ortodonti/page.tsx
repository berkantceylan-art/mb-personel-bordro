import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { OutsourceReceive, OutsourceSend, LabPicker, UndoButton } from "./OutsourceClient";

export const dynamic = "force-dynamic";
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
const daysSince = (t: string) => Math.floor((Date.now() - new Date(t).getTime()) / 86400000);
type Pend = { job_id: string; no: number; in_date: string; due_date: string | null; customer: string | null; doctor_name: string | null; patient: string | null; items: string; qty: number; party_id: string; party: string };
type Out = { id: string; job_id: string; party_id: string; status: string; sent_at: string; back_at: string | null; back_note: string | null; note: string | null; batch_id: string | null;
  jobs: { no: number; patient: string | null; due_date: string | null; lab_customers: { name: string } | null } | null; fin_parties: { name: string } | null; outsource_batches: { no: number } | null };

/** Ortodonti / dış laboratuvar: gönderilecekler, dışarıdakiler, iş geldi, günlük listeler */
export default async function OutsourcePage({ searchParams }: { searchParams: Promise<{ lab?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const sb = await createClient();
  const [labsR, pendR, outR, backR, batchR] = await Promise.all([
    sb.from("fin_parties").select("id, name").eq("outsource_lab", true).order("name"),
    sb.rpc("outsource_pending"),
    sb.from("job_outsource").select("id, job_id, party_id, status, sent_at, back_at, back_note, note, batch_id, jobs(no, patient, due_date, lab_customers(name)), fin_parties(name), outsource_batches(no)").eq("status", "sent").order("sent_at").limit(1000),
    sb.from("job_outsource").select("id, job_id, party_id, status, sent_at, back_at, back_note, note, batch_id, jobs(no, patient, due_date, lab_customers(name)), fin_parties(name), outsource_batches(no)").in("status", ["back", "problem"]).gte("back_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("back_at", { ascending: false }).limit(300),
    sb.from("outsource_batches").select("id, no, sent_at, note, fin_parties(name), job_outsource(count)").order("sent_at", { ascending: false }).limit(30),
  ]);
  const err = labsR.error ?? pendR.error ?? outR.error;
  if (err && /outsource|schema cache|does not exist/i.test(err.message)) {
    return (<><PageHeader title="Ortodonti / dış laboratuvar" /><div className="p-4 md:p-8"><p className="rounded-[12px] bg-warn-bg text-warn px-4 py-3 text-sm">Önce <b>mbdental-ortodonti.sql</b> dosyasını Supabase&apos;de çalıştırın.</p></div></>);
  }
  const labs = (labsR.data ?? []) as { id: string; name: string }[];
  const lab = labs.find((l) => l.id === sp.lab)?.id ?? null;
  const pend = ((pendR.data ?? []) as Pend[]).filter((p) => !lab || p.party_id === lab);
  const out = ((outR.data ?? []) as unknown as Out[]).filter((o) => !lab || o.party_id === lab);
  const back = ((backR.data ?? []) as unknown as Out[]).filter((o) => !lab || o.party_id === lab);
  const batches = (batchR.data ?? []) as unknown as { id: string; no: number; sent_at: string; note: string | null; fin_parties: { name: string } | null; job_outsource: { count: number }[] }[];
  const late = out.filter((o) => daysSince(o.sent_at) >= 7).length;
  const { data: parties } = labs.length ? { data: [] } : await sb.from("fin_parties").select("id, name").in("kind", ["supplier", "both"]).order("name").limit(2000);
  const th = "py-2 px-2 font-semibold text-left text-xs text-muted";
  const td = "py-2 px-2 border-t border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="Ortodonti / dış laboratuvar" subtitle="Dışarıda yaptırılan işler: gönderim listesi, dışarıda bekleyenler, iş geldi"
        actions={<span className="flex gap-4 text-sm font-semibold"><Link href="/isler/ortodonti/ekstre" className="text-[#5B21B6]">Ekstreler / fiyat kontrolü</Link><Link href="/isler/yeni" className="text-brand-700">İş kayıt</Link><Link href="/isler/urunler" className="text-brand-700">Ürünler</Link></span>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {labs.length === 0 ? (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Dış laboratuvarı seçin</h2>
            <p className="text-sm text-muted">Ortodonti laboratuvarının cari kartını seçin (yoksa önce Finans › Cariler&apos;den tedarikçi olarak açın). Sonra Ürünler ekranında ortodonti ürünlerine &quot;Dışarıda yapılır&quot; olarak bu labı seçin.</p>
            <LabPicker parties={(parties ?? []) as { id: string; name: string }[]} />
          </section>
        ) : (
          <>
            <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[["Gönderilecek", pend.length, "ortodonti ürünü olan, gönderilmemiş"], ["Dışarıda", out.length, late ? `${late} iş 7 günden fazla` : "geciken yok"], ["Son 7 günde gelen", back.filter((b) => b.status === "back").length, ""], ["Sorunlu gelen (7 gün)", back.filter((b) => b.status === "problem").length, ""]].map(([l, v, sub]) => (
                <div key={String(l)} className="rounded-[14px] border border-line bg-white p-4"><p className="text-xs text-muted font-semibold">{l}</p><p className="text-xl font-bold num mt-1">{v}</p><p className={`text-xs mt-0.5 ${l === "Dışarıda" && late ? "text-bad font-semibold" : "text-muted"}`}>{sub}</p></div>
              ))}
            </section>
            {labs.length > 1 && (
              <div className="flex flex-wrap gap-2 text-sm">
                <Link href="?" className={`rounded-full border px-3 py-1.5 font-semibold ${!lab ? "bg-brand-700 text-white border-brand-700" : "border-line"}`}>Tümü</Link>
                {labs.map((l) => <Link key={l.id} href={`?lab=${l.id}`} className={`rounded-full border px-3 py-1.5 font-semibold ${lab === l.id ? "bg-brand-700 text-white border-brand-700" : "border-line"}`}>{l.name}</Link>)}
              </div>
            )}

            <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
              <h2 className="font-display text-lg font-bold">İş geldi</h2>
              <OutsourceReceive />
            </section>

            <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
              <h2 className="font-display text-lg font-bold">Gönderilecek işler · {pend.length}</h2>
              <OutsourceSend labs={labs} rows={pend.map((p) => ({ id: p.job_id, no: p.no, date: day(p.in_date), due: day(p.due_date), customer: p.customer ?? "", doctor: p.doctor_name ?? "", patient: p.patient ?? "", items: p.items, party: p.party_id }))} />
            </section>

            <section className="rounded-[16px] border border-line bg-white p-4 overflow-x-auto">
              <h2 className="font-display text-lg font-bold mb-2">Dışarıdaki işler · {out.length}</h2>
              <table className="w-full text-sm min-w-[820px]">
                <thead><tr><th className={th}>İş</th><th className={th}>Hekim</th><th className={th}>Hasta</th><th className={th}>Lab</th><th className={th}>Liste</th><th className={th}>Gönderim</th><th className={`${th} text-right`}>Gün</th><th className={th}>Teslim (hekime)</th></tr></thead>
                <tbody>
                  {out.map((o) => { const d = daysSince(o.sent_at); return (
                    <tr key={o.id} className={d >= 7 ? "bg-[#FFF6F5]" : ""}>
                      <td className={td}><Link href={`/isler/${o.job_id}`} className="font-semibold text-brand-700">#{o.jobs?.no}</Link></td>
                      <td className={td}>{o.jobs?.lab_customers?.name ?? "—"}</td>
                      <td className={td}>{o.jobs?.patient ?? ""}</td>
                      <td className={td}>{o.fin_parties?.name}</td>
                      <td className={td}>{o.batch_id ? <Link href={`/yazdir/ortodonti/${o.batch_id}`} className="text-brand-700">#{o.outsource_batches?.no}</Link> : "—"}</td>
                      <td className={td}>{day(o.sent_at)}</td>
                      <td className={`${td} text-right num font-semibold ${d >= 7 ? "text-bad" : ""}`}>{d}</td>
                      <td className={td}>{day(o.jobs?.due_date)}</td>
                    </tr>); })}
                  {out.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted">Dışarıda iş yok.</td></tr>}
                </tbody>
              </table>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-[16px] border border-line bg-white p-4 overflow-x-auto">
                <h2 className="font-display text-lg font-bold mb-2">Son 7 günde gelenler</h2>
                <table className="w-full text-sm"><tbody>
                  {back.map((b) => (
                    <tr key={b.id} className={b.status === "problem" ? "bg-[#FFF6F5]" : ""}>
                      <td className={td}><Link href={`/isler/${b.job_id}`} className="font-semibold text-brand-700">#{b.jobs?.no}</Link></td>
                      <td className={td}>{b.jobs?.lab_customers?.name ?? ""}<span className="block text-xs text-muted">{b.jobs?.patient ?? ""}</span></td>
                      <td className={`${td} text-xs`}>{day(b.back_at)}{b.status === "problem" && <span className="block text-bad font-semibold">Sorunlu{b.back_note ? `: ${b.back_note}` : ""}</span>}</td>
                      <td className={`${td} text-right`}><UndoButton id={b.id} /></td>
                    </tr>
                  ))}
                  {back.length === 0 && <tr><td className="py-4 text-center text-muted">Henüz yok.</td></tr>}
                </tbody></table>
              </section>
              <section className="rounded-[16px] border border-line bg-white p-4 overflow-x-auto">
                <h2 className="font-display text-lg font-bold mb-2 flex items-center gap-3">Gönderim listeleri <Link href={`/yazdir/ortodonti/gun${lab ? `?lab=${lab}` : ""}`} className="ml-auto text-sm font-semibold text-[#5B21B6]">Bugünün listesini yazdır</Link></h2>
                <table className="w-full text-sm"><tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className={td}><Link href={`/yazdir/ortodonti/${b.id}`} className="font-semibold text-brand-700">Liste #{b.no}</Link></td>
                      <td className={td}>{day(b.sent_at)} {new Date(b.sent_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</td>
                      <td className={td}>{b.fin_parties?.name}</td>
                      <td className={`${td} text-right num`}>{b.job_outsource?.[0]?.count ?? 0} iş</td>
                    </tr>
                  ))}
                  {batches.length === 0 && <tr><td className="py-4 text-center text-muted">Henüz liste yok.</td></tr>}
                </tbody></table>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
