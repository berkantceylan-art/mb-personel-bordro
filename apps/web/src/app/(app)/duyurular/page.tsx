import { Card, PageHeader } from "@/components/ui";
import { AnnouncementForm, MarkRead } from "@/components/CommsForms";
import { deleteAnnouncement } from "@/lib/comms-actions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export default async function AnnouncementsPage() {
  const s = await getSession();
  const canPublish = ["owner", "hr", "branch_manager"].includes(s.role);
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [{ data: list }, { data: myReads }, { data: departments }, { data: branches }, { data: dir }] = await Promise.all([
    supabase.from("announcements").select("*").or(`expires_at.is.null,expires_at.gt.${now}`).order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(100),
    supabase.from("announcement_reads").select("announcement_id").eq("user_id", s.userId),
    canPublish ? supabase.from("departments").select("id, name").order("name") : Promise.resolve({ data: [] }),
    canPublish ? supabase.from("branches").select("id, name").order("name") : Promise.resolve({ data: [] }),
    supabase.rpc("company_directory"),
  ]);
  const ids = (list ?? []).map((a) => a.id as string);
  const { data: reads } = canPublish && ids.length ? await supabase.from("announcement_reads").select("announcement_id").in("announcement_id", ids) : { data: [] };
  const readCount = new Map<string, number>();
  for (const r of reads ?? []) readCount.set(r.announcement_id, (readCount.get(r.announcement_id) ?? 0) + 1);
  const mine = new Set((myReads ?? []).map((r) => r.announcement_id as string));
  const names = new Map(((dir ?? []) as Array<{ user_id: string; display_name: string }>).map((d) => [d.user_id, d.display_name]));
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const total = (dir ?? []).length;

  const audienceLabel = (a: { audience: string; department_ids: string[]; branch_ids: string[] }) =>
    a.audience === "ALL" ? "Tüm personel" : a.audience === "DEPARTMENT" ? a.department_ids.map((d) => deptName.get(d) ?? "Bölüm").join(", ") : a.branch_ids.map((b) => branchName.get(b) ?? "Şube").join(", ");

  return (
    <>
      <PageHeader title="Duyurular" subtitle={`${(list ?? []).length} yayında duyuru`} />
      <MarkRead ids={ids.filter((i) => !mine.has(i))} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1000px]">
        {canPublish && (
          <Card title="Yeni duyuru">
            <AnnouncementForm departments={departments ?? []} branches={branches ?? []} />
          </Card>
        )}
        {(list ?? []).map((a) => (
          <article key={a.id} className={`bg-white border rounded-[14px] p-5 flex flex-col gap-2 ${a.pinned ? "border-accent" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2">
              {a.pinned && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-[#E0F5FB] text-accent-ink">Sabit</span>}
              {!mine.has(a.id) && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warn-bg text-warn">Yeni</span>}
              <h2 className="font-display text-lg font-semibold text-brand-800 flex-1">{a.title}</h2>
              <span className="text-xs text-muted">{formatDate(a.published_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-[15px] text-ink">{a.body}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>{names.get(a.created_by) ?? ""}</span>
              {canPublish && <span>Hedef: {audienceLabel(a)}</span>}
              {canPublish && <span>Okuyan: {readCount.get(a.id) ?? 0}{a.audience === "ALL" ? ` / ${total}` : ""}</span>}
              {a.expires_at && <span>{formatDate(a.expires_at)} tarihinde kalkar</span>}
              {canPublish && (
                <form action={deleteAnnouncement} className="ml-auto">
                  <input type="hidden" name="id" value={a.id} />
                  <ConfirmSubmit label="Kaldır" question="Duyuru kaldırılsın mı?" className="text-bad font-semibold" />
                </form>
              )}
            </div>
          </article>
        ))}
        {(list ?? []).length === 0 && <p className="text-center text-muted py-10">Henüz duyuru yok.</p>}
      </div>
    </>
  );
}
