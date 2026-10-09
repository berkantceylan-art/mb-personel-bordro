import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { MarkRead } from "@/components/CommsForms";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { AnnCard, KIND_LABEL, type Ann } from "../AnnCard";
import { loadContext } from "../load";

type Aud = { user_id: string; name: string; department: string | null; read_at: string | null; acked_at: string | null; rsvp: string | null };

export default async function AnnouncementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const { id } = await params;
  const staff = ["owner", "hr", "branch_manager"].includes(s.role);
  const supabase = await createClient();
  const { data: a } = await supabase.from("announcements").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();
  const ann = { ...(a as Ann), kind: (a as Ann).kind ?? "info" };
  const ctx = (await loadContext(supabase, [ann], s.userId, staff, true)).get(id)!;
  const { data: aud } = staff ? await supabase.rpc("announcement_audience", { p_ann: id }) : { data: [] };
  const people = (aud ?? []) as Aud[];
  const notRead = people.filter((p) => !p.read_at);
  const notAck = people.filter((p) => !p.acked_at);
  const RSVP: Record<string, string> = { yes: "Katılacak", maybe: "Belki", no: "Katılmayacak" };
  return (
    <>
      <PageHeader title={KIND_LABEL[ann.kind] ?? "Duyuru"} subtitle={formatDate(ann.published_at)} actions={<Link href="/duyurular" className="text-sm font-semibold text-brand-700">← Tümü</Link>} />
      {!ctx.read && <MarkRead ids={[id]} />}
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1000px]">
        <AnnCard a={ann} c={ctx} />
        {staff && people.length > 0 && (
          <Card title={`Hedef kitle · ${people.length} kişi`}>
            <div className="flex flex-wrap gap-3 text-sm">
              <span>Okuyan <b>{people.length - notRead.length}</b></span>
              {ann.require_ack && <span>Onaylayan <b>{people.length - notAck.length}</b></span>}
              {ann.kind === "event" && <span>Katılacak <b>{people.filter((p) => p.rsvp === "yes").length}</b> · belki {people.filter((p) => p.rsvp === "maybe").length} · yanıtsız {people.filter((p) => !p.rsvp).length}</span>}
            </div>
            {ann.require_ack && notAck.length > 0 && <p className="text-sm rounded-lg bg-[#FDECEA] text-[#9B1C1C] p-2">Onaylamayanlar: {notAck.map((p) => p.name).join(", ")}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Personel</th><th className="py-2 px-2">Bölüm</th><th className="py-2 px-2">Okudu</th>{ann.require_ack && <th className="py-2 px-2">Onay</th>}{ann.kind === "event" && <th className="py-2 px-2">Katılım</th>}</tr></thead>
                <tbody>{people.map((p) => (
                  <tr key={p.user_id} className="border-t border-[#EEF2F6]"><td className="py-1.5 px-2">{p.name}</td><td className="py-1.5 px-2 text-muted">{p.department ?? "—"}</td><td className="py-1.5 px-2">{p.read_at ? formatDate(p.read_at.slice(0, 10)) : <span className="text-muted">—</span>}</td>{ann.require_ack && <td className="py-1.5 px-2">{p.acked_at ? "✓" : <span className="text-bad">bekliyor</span>}</td>}{ann.kind === "event" && <td className="py-1.5 px-2">{p.rsvp ? RSVP[p.rsvp] : <span className="text-muted">yanıtsız</span>}</td>}</tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
