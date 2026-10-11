import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { ORDER_SOURCE, ORDER_STATUS, orderError, orderNo } from "@/lib/orders";
import { saveOrder, setOrderStatus } from "@/lib/order-actions";
import { SmartOrderBox } from "./SmartOrderBox";

export const dynamic = "force-dynamic";

type O = { id: string; year: number; no: number; customer_id: string | null; source: string; doctor_name: string | null; patient: string | null; shade: string | null; teeth: string | null; items: { name: string; qty: number }[]; due_date: string | null; pickup: boolean; pickup_note: string | null; notes: string | null; status: string; job_id: string | null; created_at: string; lab_customers: { name: string } | null; jobs: { no: number } | null };

/** Sipariş kutusu: telefon / WhatsApp / e-posta / tarayıcıdan gelen siparişler ve işe dönüşmemiş portal vakaları */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ durum?: string; duzenle?: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const sp = await searchParams;
  const tab = ["acik", "is", "iptal"].includes(sp.durum ?? "") ? sp.durum! : "acik";
  const supabase = await createClient();
  const statuses = tab === "acik" ? ["new", "confirmed"] : tab === "is" ? ["job"] : ["cancelled"];
  const [{ data: od, error }, { data: cs }, { data: cases }, { data: linked }] = await Promise.all([
    supabase.from("lab_orders").select("id, year, no, customer_id, source, doctor_name, patient, shade, teeth, items, due_date, pickup, pickup_note, notes, status, job_id, created_at, lab_customers(name), jobs(no)").in("status", statuses).order("created_at", { ascending: false }).limit(300),
    supabase.from("lab_customers").select("id, name").eq("is_active", true).order("name"),
    tab === "acik" ? supabase.from("portal_cases").select("id, no, patient_ref, product_slug, due_date, created_at, status, portal_accounts(name, company)").in("status", ["received", "design"]).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    tab === "acik" ? supabase.from("jobs").select("portal_case_id").not("portal_case_id", "is", null).limit(5000) : Promise.resolve({ data: [] }),
  ]);
  const orders = (od ?? []) as unknown as O[];
  const done = new Set((linked ?? []).map((x) => x.portal_case_id as string));
  const openCases = ((cases ?? []) as unknown as { id: string; no: number; patient_ref: string; product_slug: string | null; due_date: string | null; created_at: string; portal_accounts: { name: string; company: string | null } | null }[]).filter((c) => !done.has(c.id));
  const edit = sp.duzenle ? orders.find((o) => o.id === sp.duzenle) : null;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";

  return (
    <>
      <PageHeader title="Siparişler" subtitle="Telefon, WhatsApp, e-posta ya da tarayıcıdan gelen siparişi buraya yazın; hazır olunca tek tuşla iş kaydına dönüştürün." actions={<Link href="/isler/yeni" className="text-sm font-semibold text-brand-700">+ Doğrudan iş kaydı</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">{orderError(error.message)}</Notice>}

        {!edit && <SmartOrderBox />}
        <form action={saveOrder} className="rounded-[18px] border border-line bg-white p-4 grid gap-3 md:grid-cols-4" key={edit?.id ?? "new"}>
          <h2 className="md:col-span-4 font-display text-lg font-bold">{edit ? `${orderNo(edit.year, edit.no)} düzenle` : "Yeni sipariş"}</h2>
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted md:col-span-2">Hekim / klinik
            <select name="customer_id" required defaultValue={edit?.customer_id ?? ""} className={inp}><option value="">Seçin</option>{(cs ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Nereden geldi
            <select name="source" defaultValue={edit?.source ?? "phone"} className={inp}>{Object.entries(ORDER_SOURCE).filter(([k]) => k !== "portal").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">İstenen teslim<input type="date" name="due_date" defaultValue={edit?.due_date ?? ""} min={today} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Doktor<input name="doctor_name" defaultValue={edit?.doctor_name ?? ""} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Hasta<input name="patient" defaultValue={edit?.patient ?? ""} className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Renk<input name="shade" defaultValue={edit?.shade ?? ""} placeholder="A2" className={inp} /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Dişler<input name="teeth" defaultValue={edit?.teeth ?? ""} placeholder="11 21 22" className={inp} /></label>
          <div className="md:col-span-4 grid gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex gap-1"><input name="item_name" defaultValue={edit?.items?.[i]?.name ?? ""} placeholder={i === 0 ? "İstenen iş (ör. Zirkon kron)" : "Ek kalem"} className={`${inp} flex-1 min-w-0`} /><input name="item_qty" type="number" min={1} max={99} defaultValue={edit?.items?.[i]?.qty ?? 1} className={`${inp} w-16`} aria-label="Adet" /></span>
            ))}
          </div>
          <label className="md:col-span-3 flex flex-col gap-1 text-xs font-semibold text-muted">Not<input name="notes" defaultValue={edit?.notes ?? ""} className={inp} /></label>
          <label className="flex items-center gap-2 text-sm self-end h-10"><input type="checkbox" name="pickup" defaultChecked={edit?.pickup} className="w-4 h-4" />Ölçü kuryeyle alınacak</label>
          <div className="md:col-span-4 flex flex-wrap items-center gap-2">
            <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">{edit ? "Kaydet" : "Siparişi al"}</PendingSubmit>
            <PendingSubmit name="to_job" value="1" className="h-10 px-4 rounded-[10px] border border-brand-600 text-brand-700 text-sm font-semibold">Kaydet ve iş kaydı aç</PendingSubmit>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" defaultChecked={edit?.status === "confirmed"} />Onaylandı</label>
            {edit && <Link href="/isler/siparisler" className="text-sm text-muted">Vazgeç</Link>}
          </div>
        </form>

        <nav className="flex gap-1 rounded-[14px] bg-[#EEF2F6] p-1 text-sm font-semibold self-start">
          {([["acik", "Açık"], ["is", "İşe dönüşenler"], ["iptal", "İptal"]] as const).map(([k, l]) => <Link key={k} href={`/isler/siparisler?durum=${k}`} className={`rounded-[10px] px-4 py-2 ${tab === k ? "bg-white shadow-sm" : "text-muted"}`}>{l}</Link>)}
        </nav>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((o) => {
            const late = o.due_date && o.due_date < today && o.status !== "job";
            return (
              <article key={o.id} className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0"><b className="block truncate">{o.lab_customers?.name ?? "—"}</b><span className="text-xs text-muted font-mono">{orderNo(o.year, o.no)} · {ORDER_SOURCE[o.source]} · {formatDate(o.created_at)}</span></div>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${ORDER_STATUS[o.status]?.[1]}`}>{ORDER_STATUS[o.status]?.[0]}</span>
                </div>
                <div className="text-sm">{[o.patient, o.doctor_name].filter(Boolean).join(" · ") || "—"}</div>
                <div className="text-sm font-semibold">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ") || "—"}</div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {o.due_date && <span className={`rounded-md px-2 py-0.5 ${late ? "bg-bad-bg text-bad font-semibold" : "bg-[#F1F5F9]"}`}>Teslim {formatDate(o.due_date)}</span>}
                  {o.shade && <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5">Renk {o.shade}</span>}
                  {o.teeth && <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5">Diş {o.teeth}</span>}
                  {o.pickup && <span className="rounded-md bg-[#FFF4E0] px-2 py-0.5 font-semibold text-[#8A5A00]">Kurye ölçü alacak</span>}
                </div>
                {o.notes && <p className="text-xs text-muted">{o.notes}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-2 mt-auto border-t border-[#EEF2F6]">
                  {o.status === "job" && o.job_id ? <Link href={`/isler/${o.job_id}`} className="text-sm font-semibold text-ok">İş #{o.jobs?.no} →</Link> : o.status !== "cancelled" && (
                    <>
                      <Link href={`/isler/yeni?siparis=${o.id}`} className="h-9 px-3 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold">İş kaydına dönüştür</Link>
                      {o.status === "new" && <form action={setOrderStatus}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="confirmed" /><PendingSubmit className="h-9 px-3 rounded-[10px] border border-line text-sm font-semibold">Onayla</PendingSubmit></form>}
                      <Link href={`/isler/siparisler?duzenle=${o.id}`} className="text-sm font-semibold text-brand-700">Düzenle</Link>
                      <form action={setOrderStatus} className="ml-auto"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="status" value="cancelled" /><ConfirmSubmit label="İptal" question="Sipariş iptal edilsin mi?" /></form>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {openCases.map((c) => (
            <article key={c.id} className="rounded-[16px] border border-dashed border-brand-600 bg-[#F7FAFD] p-4 flex flex-col gap-2">
              <div className="flex items-start gap-2"><div className="flex-1"><b>{c.portal_accounts?.company ?? c.portal_accounts?.name ?? "Portal"}</b><span className="block text-xs text-muted">Portal vakası #{c.no} · {formatDate(c.created_at)}</span></div><span className="rounded-md bg-[#EAF2FB] px-2 py-0.5 text-[11px] font-semibold text-brand-700">Portaldan</span></div>
              <div className="text-sm">{c.patient_ref}{c.product_slug ? ` · ${c.product_slug}` : ""}</div>
              {c.due_date && <span className="text-xs">Teslim {formatDate(c.due_date)}</span>}
              <div className="pt-2 mt-auto border-t border-[#E1E9F2]"><Link href={`/isler/yeni?vaka=${c.id}`} className="h-9 px-3 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold">İş kaydına dönüştür</Link></div>
            </article>
          ))}
          {orders.length === 0 && openCases.length === 0 && <p className="md:col-span-2 xl:col-span-3 rounded-[16px] border border-dashed border-[#C5D0DB] p-8 text-center text-muted">{tab === "acik" ? "Açık sipariş yok." : "Kayıt yok."}</p>}
        </section>
      </div>
    </>
  );
}
