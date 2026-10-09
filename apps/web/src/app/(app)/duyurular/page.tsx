import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { AnnouncementForm, MarkRead } from "@/components/CommsForms";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { AnnCard, KIND_LABEL, type Ann } from "./AnnCard";
import { loadContext } from "./load";

/** İç iletişim: bilgilendirme, etkinlik, anket, soru-cevap */
export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ tur?: string }> }) {
  const s = await getSession();
  const sp = await searchParams;
  const canPublish = ["owner", "hr", "branch_manager"].includes(s.role);
  const supabase = await createClient();
  const now = new Date().toISOString();
  let q = supabase.from("announcements").select("*").or(`expires_at.is.null,expires_at.gt.${now}`).order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(100);
  if (sp.tur && KIND_LABEL[sp.tur]) q = q.eq("kind", sp.tur);
  const [{ data: list }, { data: departments }, { data: branches }, { data: dir }] = await Promise.all([
    q,
    canPublish ? supabase.from("departments").select("id, name").order("name") : Promise.resolve({ data: [] }),
    canPublish ? supabase.from("branches").select("id, name").order("name") : Promise.resolve({ data: [] }),
    supabase.rpc("company_directory"),
  ]);
  const anns = ((list ?? []) as Ann[]).map((a) => ({ ...a, kind: a.kind ?? "info" }));
  const ctx = await loadContext(supabase, anns, s.userId, canPublish);
  const names = new Map(((dir ?? []) as Array<{ user_id: string; display_name: string }>).map((d) => [d.user_id, d.display_name]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const audienceLabel = (a: Ann) => a.audience === "ALL" ? "Tüm personel" : a.audience === "DEPARTMENT" ? a.department_ids.map((d) => deptName.get(d) ?? "Bölüm").join(", ") : a.branch_ids.map((b) => branchName.get(b) ?? "Şube").join(", ");
  const pendingAck = anns.filter((a) => a.require_ack && !ctx.get(a.id)?.acked).length;
  const tabs: Array<[string, string]> = [["", "Tümü"], ...Object.entries(KIND_LABEL)];
  return (
    <>
      <PageHeader title="Duyurular ve etkinlikler" subtitle={`${anns.length} yayında${pendingAck && !canPublish ? ` · ${pendingAck} onay bekliyor` : ""}`} />
      <MarkRead ids={anns.filter((a) => !ctx.get(a.id)?.read).map((a) => a.id)} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1000px]">
        <nav className="flex flex-wrap gap-1.5" aria-label="Tür">
          {tabs.map(([k, l]) => <Link key={k} href={k ? `/duyurular?tur=${k}` : "/duyurular"} aria-current={(sp.tur ?? "") === k ? "page" : undefined} className={`h-10 px-4 rounded-full text-sm font-semibold grid place-items-center ${(sp.tur ?? "") === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{l}</Link>)}
        </nav>
        {canPublish && (
          <details className="bg-white border border-line rounded-[14px] p-4 group" open={anns.length === 0}>
            <summary className="cursor-pointer list-none font-display font-semibold text-brand-800 flex justify-between">Yeni duyuru, etkinlik, anket veya soru-cevap <span className="text-brand-700 group-open:rotate-45 transition-transform text-xl leading-none">+</span></summary>
            <div className="mt-4"><AnnouncementForm departments={departments ?? []} branches={branches ?? []} /></div>
          </details>
        )}
        {anns.map((a) => <AnnCard key={a.id} a={a} c={{ ...ctx.get(a.id)!, author: names.get(a.created_by), audienceText: audienceLabel(a) }} />)}
        {anns.length === 0 && <Card><p className="text-center text-muted py-6">Henüz içerik yok.</p></Card>}
      </div>
    </>
  );
}
