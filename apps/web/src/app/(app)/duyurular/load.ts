import type { createClient } from "@/lib/supabase/server";
import type { Ann, Ctx } from "./AnnCard";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Duyuru kartları için kullanıcıya özel bağlam: okuma/onay, katılım, anket sonuçları, sorular */
export async function loadContext(sb: SB, anns: Ann[], userId: string, staff: boolean, detail = false) {
  const ids = anns.map((a) => a.id);
  if (!ids.length) return new Map<string, Ctx>();
  const polls = anns.filter((a) => a.kind === "poll").map((a) => a.id);
  const events = anns.filter((a) => a.kind === "event").map((a) => a.id);
  const qas = anns.filter((a) => a.kind === "qa").map((a) => a.id);
  const [{ data: reads }, { data: rsvps }, { data: votes }, { data: sum }, pollRes, qaRes, { data: allReads }] = await Promise.all([
    sb.from("announcement_reads").select("announcement_id, acked_at").eq("user_id", userId).in("announcement_id", ids),
    events.length ? sb.from("event_rsvps").select("announcement_id, status").eq("user_id", userId).in("announcement_id", events) : Promise.resolve({ data: [] as Array<{ announcement_id: string; status: string }> }),
    polls.length ? sb.from("poll_votes").select("announcement_id, option_id").eq("user_id", userId).in("announcement_id", polls) : Promise.resolve({ data: [] as Array<{ announcement_id: string; option_id: string }> }),
    events.length ? sb.rpc("event_summary", { p_ids: events }) : Promise.resolve({ data: [] }),
    Promise.all(polls.map(async (id) => [id, (await sb.rpc("poll_results", { p_ann: id })).data ?? []] as const)),
    Promise.all(qas.map(async (id) => [id, (await sb.rpc("qa_list", { p_ann: id })).data ?? []] as const)),
    staff ? sb.from("announcement_reads").select("announcement_id, acked_at").in("announcement_id", ids) : Promise.resolve({ data: [] as Array<{ announcement_id: string; acked_at: string | null }> }),
  ]);
  const read = new Map((reads ?? []).map((r) => [r.announcement_id, r.acked_at as string | null]));
  const out = new Map<string, Ctx>();
  for (const a of anns) {
    const ar = (allReads ?? []).filter((r) => r.announcement_id === a.id);
    const s = ((sum ?? []) as Array<{ announcement_id: string; yes: number; maybe: number; no: number }>).find((x) => x.announcement_id === a.id);
    out.set(a.id, {
      staff, detail,
      read: read.has(a.id), acked: !!read.get(a.id),
      myRsvp: (rsvps ?? []).find((r) => r.announcement_id === a.id)?.status ?? null,
      summary: s ? { yes: Number(s.yes), maybe: Number(s.maybe), no: Number(s.no) } : undefined,
      poll: pollRes.find(([id]) => id === a.id)?.[1] as Ctx["poll"],
      myVotes: new Set((votes ?? []).filter((v) => v.announcement_id === a.id).map((v) => v.option_id)),
      qa: qaRes.find(([id]) => id === a.id)?.[1] as Ctx["qa"],
      readCount: staff ? ar.length : undefined, ackCount: staff ? ar.filter((r) => r.acked_at).length : undefined,
    });
  }
  return out;
}
