/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { ackFinding, closeFinding, saveFinding } from "@/lib/isg-actions";
import { signedMap } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const LEVEL: Record<string, [string, string]> = { acil: ["Acil", "bg-[#7A0E0E] text-white"], yuksek: ["Yüksek", "bg-[#D9534F] text-white"], orta: ["Orta", "bg-[#E8A33D] text-white"], dusuk: ["Düşük", "bg-[#2E9D6A] text-white"] };
const ST: Record<string, string> = { acik: "Açık", islemde: "İşlemde", kapandi: "Kapandı" };

/** Tespit ve öneri defteri: uzman/hekim tespiti → işveren tebellüğü → önlem → kapanış (fotoğraflı) */
export default async function FindingsPage({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayIso();
  const { data, error } = await supabase.from("isg_findings").select("*").order("found_on", { ascending: false }).limit(300);
  if (error) return (<><PageHeader title="Tespit ve öneri defteri" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const all = data ?? [];
  const list = all.filter((x) => (sp.durum === "kapandi" ? x.status === "kapandi" : sp.durum === "hepsi" ? true : x.status !== "kapandi"));
  const photos = await signedMap(supabase, all.flatMap((x) => [x.photo_path, x.close_photo_path]));
  const late = all.filter((x) => x.status !== "kapandi" && x.due_date && x.due_date < today).length;
  return (
    <>
      <PageHeader title="Tespit ve öneri defteri" subtitle="İSG profesyonellerinin tespitleri ve işverenin aldığı önlemler" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <IsgNav active="/isg/defter" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Açık" value={String(all.filter((x) => x.status === "acik").length)} sub="tebellüğ bekliyor" />
          <Stat label="İşlemde" value={String(all.filter((x) => x.status === "islemde").length)} />
          <Stat label="Termini geçen" value={String(late)} />
          <Stat label="Kapanan" value={String(all.filter((x) => x.status === "kapandi").length)} />
        </div>
        {can && (
          <Card title="Yeni tespit">
            <form action={saveFinding} className="grid gap-2 md:grid-cols-3 text-sm">
              <input type="date" name="found_on" defaultValue={today} className={input} aria-label="Tarih" />
              <select name="author_kind" className={input} aria-label="Tespit eden" defaultValue={s.role === "safety" ? "uzman" : "isveren"}><option value="uzman">İş güvenliği uzmanı</option><option value="hekim">İşyeri hekimi</option><option value="isveren">İşveren / vekili</option><option value="calisan">Çalışan bildirimi</option><option value="denetim">Resmi denetim</option></select>
              <input name="author_name" placeholder="Tespit edenin adı" className={input} aria-label="Ad" />
              <input name="area" placeholder="Bölüm / alan" className={input} aria-label="Alan" />
              <select name="level" className={input} aria-label="Önem" defaultValue="orta"><option value="acil">Acil (işi durdur)</option><option value="yuksek">Yüksek</option><option value="orta">Orta</option><option value="dusuk">Düşük</option></select>
              <input name="book_page" placeholder="Onaylı defter sayfa no" className={input} aria-label="Defter sayfa" />
              <textarea name="description" required rows={2} placeholder="Tespit" className="md:col-span-3 rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2" aria-label="Tespit" />
              <textarea name="recommendation" rows={2} placeholder="Öneri / yapılması gereken" className="md:col-span-3 rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2" aria-label="Öneri" />
              <input name="responsible" placeholder="Sorumlu" className={input} aria-label="Sorumlu" />
              <label className="text-xs text-muted flex flex-col gap-1">Termin<input type="date" name="due_date" className={input} /></label>
              <label className="text-xs text-muted flex flex-col gap-1">Fotoğraf<input type="file" name="photo" accept="image/*" capture="environment" className="text-sm" /></label>
              <PendingSubmit className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold justify-self-start">Kaydet</PendingSubmit>
            </form>
          </Card>
        )}
        <div className="flex gap-3 text-sm">{[["", "Açık ve işlemde"], ["kapandi", "Kapananlar"], ["hepsi", "Tümü"]].map(([k, l]) => <Link key={k} href={k ? `/isg/defter?durum=${k}` : "/isg/defter"} className={(sp.durum ?? "") === k ? "font-bold text-brand-800" : "text-brand-700"}>{l}</Link>)}<a href="/yazdir/isg?tur=defter" target="_blank" rel="noopener" className="ml-auto text-brand-700 font-semibold">Listeyi yazdır</a></div>
        <div className="flex flex-col gap-2">{list.map((x) => {
          const [l, c] = LEVEL[x.level]!;
          const overdue = x.status !== "kapandi" && x.due_date && x.due_date < today;
          return (
            <div key={x.id} className="rounded-xl border border-line bg-white p-3 text-sm flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2"><span className={`text-xs font-bold px-2 py-0.5 rounded ${c}`}>{l}</span><b className="flex-1 min-w-40">{x.area ?? "Genel"}</b><span className="text-xs text-muted">{formatDate(x.found_on)}{x.author_name ? ` · ${x.author_name}` : ""}{x.book_page ? ` · defter s. ${x.book_page}` : ""}</span><span className="text-xs font-semibold">{ST[x.status]}</span></div>
              <p>{x.description}</p>
              {x.recommendation && <p className="text-[#33414F]"><b>Öneri:</b> {x.recommendation}</p>}
              <div className="text-xs text-muted">{x.responsible ? `Sorumlu ${x.responsible}` : ""}{x.due_date ? <> · <span className={overdue ? "text-bad font-semibold" : ""}>termin {formatDate(x.due_date)}</span></> : null}{x.employer_ack_at ? ` · tebellüğ ${formatDate(String(x.employer_ack_at).slice(0, 10))}` : ""}</div>
              <div className="flex gap-2">{x.photo_path && photos.get(x.photo_path) && <a href={photos.get(x.photo_path)} target="_blank" rel="noreferrer"><img src={photos.get(x.photo_path)} alt="Tespit fotoğrafı" className="h-20 rounded-lg object-cover" /></a>}{x.close_photo_path && photos.get(x.close_photo_path) && <a href={photos.get(x.close_photo_path)} target="_blank" rel="noreferrer"><img src={photos.get(x.close_photo_path)} alt="Kapanış fotoğrafı" className="h-20 rounded-lg object-cover border-2 border-[#1A7F52]" /></a>}</div>
              {x.status === "kapandi" && <p className="text-ok text-xs font-semibold">Kapandı {x.closed_on ? formatDate(x.closed_on) : ""}{x.close_note ? ` · ${x.close_note}` : ""}</p>}
              {can && x.status === "acik" && ["owner", "hr"].includes(s.role) && <form action={ackFinding} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={x.id} /><input name="responsible" defaultValue={x.responsible ?? ""} placeholder="Sorumlu" className={`${input} w-40`} aria-label="Sorumlu" /><input type="date" name="due_date" defaultValue={x.due_date ?? ""} className={`${input} w-40`} aria-label="Termin" /><PendingSubmit className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-xs font-semibold">Tebellüğ et, işleme al</PendingSubmit></form>}
              {can && x.status !== "kapandi" && <details><summary className="cursor-pointer text-xs text-brand-700 font-semibold">Kapat</summary><form action={closeFinding} className="flex flex-wrap gap-2 mt-2"><input type="hidden" name="id" value={x.id} /><input name="close_note" placeholder="Yapılan iş" className={`${input} flex-1 min-w-40`} aria-label="Yapılan iş" /><input type="file" name="photo" accept="image/*" capture="environment" className="text-sm" aria-label="Kapanış fotoğrafı" /><PendingSubmit className="h-10 px-3 rounded-[10px] border border-[#D5DEE8] text-xs font-semibold text-brand-700">Kapat</PendingSubmit></form></details>}
            </div>
          );
        })}{list.length === 0 && <Card><p className="text-sm text-muted">Kayıt yok.</p></Card>}</div>
        <p className="text-xs text-muted">Bakanlık onaylı tespit ve öneri defteri yasal kayıttır; bu ekran onun takip edilebilir kopyasıdır. Defter sayfa numarasını girerek eşleştirin.</p>
      </div>
    </>
  );
}
