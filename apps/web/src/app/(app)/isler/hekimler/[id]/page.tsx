import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, Stat } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { JOB_STATUS, money, type Customer, type JobStatus } from "@/lib/jobs";
import { CustomerForm } from "../CustomerForm";
import { deleteCustomer, deleteDoctor } from "../../actions";

export const dynamic = "force-dynamic";

/** Hekim / hastane kartı: bilgiler, doktorlar, işler ve dönem toplamları */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("lab_customers").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Customer;
  const [{ data: docs }, { data: jobs }, { data: accs }, { data: links }] = await Promise.all([
    supabase.from("lab_customer_doctors").select("id, name").eq("customer_id", id).order("name"),
    supabase.from("jobs").select("id, no, patient, in_date, due_date, status, total, currency").eq("customer_id", id).order("no", { ascending: false }).limit(300),
    supabase.from("portal_accounts").select("id, name, company").eq("status", "active").order("name"),
    supabase.from("lab_customers").select("portal_account_id").not("portal_account_id", "is", null),
  ]);
  const linked = new Set((links ?? []).map((l) => l.portal_account_id as string));
  const list = (jobs ?? []) as { id: string; no: number; patient: string | null; in_date: string; due_date: string | null; status: JobStatus; total: number; currency: string }[];
  const billable = list.filter((j) => j.status !== "cancelled");
  const month = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7);
  const sumMonth = billable.filter((j) => j.in_date.startsWith(month)).reduce((a, j) => a + j.total, 0);
  const sumAll = billable.reduce((a, j) => a + j.total, 0);

  return (
    <>
      <PageHeader title={c.name} subtitle={`${c.city ?? ""}${c.country ? ` · ${c.country}` : ""} · ${c.currency}`} actions={<div className="flex gap-3 text-sm font-semibold"><Link href={`/isler/yeni?musteri=${c.id}`} className="text-brand-700">+ Bu hekime iş</Link><Link href="/isler/hekimler" className="text-brand-700">Liste</Link></div>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Açık iş" value={String(list.filter((j) => ["open", "tryin", "ready"].includes(j.status)).length)} />
          <Stat label="Bu ay iş tutarı" value={money(sumMonth, c.currency)} />
          <Stat label="Toplam iş tutarı" value={money(sumAll, c.currency)} sub={`${billable.length} iş`} />
          <Stat label="İskonto" value={`%${Number(c.discount_pct ?? 0)}`} />
        </section>
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <Card title="Bilgiler">
            <CustomerForm c={c} accounts={(accs ?? []).map((a) => ({ id: a.id, name: a.company ? `${a.company} (${a.name})` : a.name, linked: linked.has(a.id) }))} />
          </Card>
          <Card title="Doktorlar">
            <ul className="flex flex-col gap-2">
              {(docs ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{d.name}</span>
                  <form action={deleteDoctor}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Sil" question="Doktor silinsin mi?" className="text-xs text-bad font-semibold" /></form>
                </li>
              ))}
              {(docs ?? []).length === 0 && <li className="text-sm text-muted">Doktor yok; bilgilerdeki &quot;Doktor ekle&quot; alanından ekleyin.</li>}
            </ul>
          </Card>
        </div>
        <Card title={`İşler (${list.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-xs text-muted text-left"><th className="py-2">No</th><th className="py-2">Hasta</th><th className="py-2">Giriş</th><th className="py-2">Çıkış</th><th className="py-2 text-right">Tutar</th><th className="py-2">Durum</th></tr></thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.id} className="border-t border-line">
                    <td className="py-2"><Link href={`/isler/${j.id}`} className="font-semibold text-brand-700">#{j.no}</Link></td>
                    <td className="py-2">{j.patient ?? "—"}</td>
                    <td className="py-2 num">{formatDate(j.in_date)}</td>
                    <td className="py-2 num">{j.due_date ? formatDate(j.due_date) : "—"}</td>
                    <td className="py-2 num text-right">{money(j.total, j.currency)}</td>
                    <td className="py-2"><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${JOB_STATUS[j.status][1]}`}>{JOB_STATUS[j.status][0]}</span></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Henüz iş yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <form action={deleteCustomer} className="text-right">
          <input type="hidden" name="id" value={c.id} />
          <ConfirmSubmit label="Kartı sil" question="Hekim / hastane kartı silinsin mi? (İşi varsa silinmez; pasif yapın.)" className="text-sm text-bad font-semibold" />
        </form>
      </div>
    </>
  );
}
