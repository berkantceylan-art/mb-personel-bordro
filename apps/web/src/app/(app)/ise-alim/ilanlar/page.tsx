import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader } from "@/components/ui";
import { EXPERIENCE_OPTIONS, publicBaseUrl } from "@/lib/recruiting";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { savePosting } from "../actions";

type Post = { id: string; slug: string; title: string; department_id: string | null; description: string | null; requirements: string | null; employment_type: string; experience: string | null; location: string | null; headcount: number; referral_bonus: number | null; status: string; closes_on: string | null };
const input = "h-11 w-full rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-sm";
const STATUS: Record<string, string> = { open: "Yayında", draft: "Taslak", closed: "Kapalı" };

function PostingForm({ p, depts }: { p?: Post; depts: Array<{ id: string; name: string }> }) {
  return (
    <form action={savePosting} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className="flex flex-col gap-1 text-muted sm:col-span-2">Başlık<input name="title" required defaultValue={p?.title} placeholder="Porselen teknisyeni" className={input} /></label>
      <label className="flex flex-col gap-1 text-muted">Bölüm<select name="department_id" defaultValue={p?.department_id ?? ""} className={input}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-muted">Durum<select name="status" defaultValue={p?.status ?? "open"} className={input}><option value="open">Yayında</option><option value="draft">Taslak</option><option value="closed">Kapalı</option></select></label>
      <label className="flex flex-col gap-1 text-muted">Çalışma şekli<select name="employment_type" defaultValue={p?.employment_type ?? "Tam zamanlı"} className={input}><option>Tam zamanlı</option><option>Yarı zamanlı</option><option>Stajyer</option><option>Dönemsel</option></select></label>
      <label className="flex flex-col gap-1 text-muted">Deneyim<select name="experience" defaultValue={p?.experience ?? ""} className={input}><option value="">Belirtilmedi</option>{EXPERIENCE_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-muted">Yer<input name="location" defaultValue={p?.location ?? "İzmir"} className={input} /></label>
      <label className="flex flex-col gap-1 text-muted">Alınacak kişi<input name="headcount" type="number" min={1} defaultValue={p?.headcount ?? 1} className={input} /></label>
      <label className="flex flex-col gap-1 text-muted sm:col-span-2">Açıklama (adaylar görür)<textarea name="description" rows={3} defaultValue={p?.description ?? ""} className={`${input} h-auto py-2`} /></label>
      <label className="flex flex-col gap-1 text-muted sm:col-span-2">Aranan nitelikler<textarea name="requirements" rows={3} defaultValue={p?.requirements ?? ""} className={`${input} h-auto py-2`} /></label>
      <label className="flex flex-col gap-1 text-muted">Son başvuru<input name="closes_on" type="date" defaultValue={p?.closes_on ?? ""} className={input} /></label>
      <label className="flex flex-col gap-1 text-muted">Tavsiye primi (TL, isteğe bağlı)<input name="referral_bonus" inputMode="decimal" defaultValue={p?.referral_bonus ? String(p.referral_bonus / 100) : ""} className={input} /></label>
      <div className="flex items-end sm:col-span-2"><PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">{p ? "Kaydet" : "Yayınla"}</PendingSubmit></div>
    </form>
  );
}

export default async function PostingsPage() {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/ise-alim");
  const supabase = await createClient();
  const [{ data: posts }, { data: depts }, { data: counts }] = await Promise.all([
    supabase.from("job_postings").select("*").order("created_at", { ascending: false }),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("candidates").select("posting_id, stage"),
  ]);
  const base = publicBaseUrl() || "https://<uygulama-adresi>";
  const cnt = (id: string) => (counts ?? []).filter((c) => c.posting_id === id);
  return (
    <>
      <PageHeader title="İş ilanları" subtitle="Yayındaki ilanlar kariyer sayfasında ve personelin mobil uygulamasında görünür" actions={<Link href="/ise-alim" className="text-sm font-semibold text-brand-700">← Pano</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        <Card title="Yeni ilan"><PostingForm depts={depts ?? []} /></Card>
        {((posts ?? []) as Post[]).map((p) => {
          const cs = cnt(p.id);
          return (
            <details key={p.id} className="bg-white border border-line rounded-[14px] p-4 group">
              <summary className="cursor-pointer list-none flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-brand-800">{p.title}</span>
                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${p.status === "open" ? "bg-[#E6F4EC] text-ok" : "bg-[#EEF2F6] text-muted"}`}>{STATUS[p.status]}</span>
                <span className="text-sm text-muted">{cs.length} başvuru · {cs.filter((c) => !["rejected", "withdrawn", "hired"].includes(c.stage)).length} süreçte · {cs.filter((c) => c.stage === "hired").length}/{p.headcount} alındı{p.referral_bonus ? ` · tavsiye primi ${formatTL(p.referral_bonus)}` : ""}</span>
                <span className="ml-auto text-sm font-semibold text-brand-700 group-open:hidden">Düzenle</span>
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                <PostingForm p={p} depts={depts ?? []} />
                <p className="text-xs text-muted">İlan bağlantısı: <code className="bg-[#F5F7FA] px-1.5 py-0.5 rounded">{base}/kariyer?ilan={p.slug}</code></p>
              </div>
            </details>
          );
        })}
        <Card title="Web sitesine ekleme (mbdentaire.com)">
          <p className="text-sm">Kariyer sayfasını sitenize bağlantı olarak verin ya da sayfanın içine gömün. Başvurular doğrudan bu panoya düşer.</p>
          <pre className="text-xs bg-[#0A2540] text-[#D6E4F2] rounded-lg p-3 overflow-x-auto">{`<a href="${base}/kariyer">Kariyer</a>

<iframe src="${base}/kariyer?gom=1" style="width:100%;min-height:1400px;border:0" title="İş başvurusu"></iframe>`}</pre>
        </Card>
      </div>
    </>
  );
}
