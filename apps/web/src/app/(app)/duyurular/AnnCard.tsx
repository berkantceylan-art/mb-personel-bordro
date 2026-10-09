import Link from "next/link";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { deleteAnnouncement } from "@/lib/comms-actions";
import { ackAnnouncement, answerQuestion, askQuestion, rsvp, votePoll, voteQuestion } from "@/lib/engage-actions";
import { formatDate } from "@/lib/session";

export type Ann = {
  id: string; title: string; body: string; kind: string; pinned: boolean; require_ack: boolean; published_at: string; expires_at: string | null; created_by: string;
  event_at: string | null; event_end: string | null; location: string | null; capacity: number | null; poll_multi: boolean; anonymous: boolean; closes_at: string | null;
  audience: string; department_ids: string[]; branch_ids: string[];
};
export type Ctx = {
  staff: boolean; read: boolean; acked: boolean; myRsvp: string | null; summary?: { yes: number; maybe: number; no: number };
  poll?: Array<{ option_id: string; label: string; votes: number; voters: string[] }>; myVotes?: Set<string>;
  qa?: Array<{ id: string; body: string; author: string; mine: boolean; votes: number; voted: boolean; answer: string | null; answered_at: string | null }>;
  author?: string; audienceText?: string; readCount?: number; ackCount?: number; detail?: boolean;
};

export const KIND_LABEL: Record<string, string> = { info: "Bilgilendirme", event: "Etkinlik", poll: "Anket", qa: "Soru-cevap" };
const KIND_STYLE: Record<string, string> = { info: "bg-[#EEF3F9] text-brand-700", event: "bg-[#E6F4EC] text-[#1A7F52]", poll: "bg-[#FFF4E0] text-[#7A4F00]", qa: "bg-[#F1ECFA] text-[#5B3BA0]" };
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const btn = "h-11 px-4 rounded-[10px] text-sm font-semibold";

export function AnnCard({ a, c }: { a: Ann; c: Ctx }) {
  const closed = a.closes_at ? Date.parse(a.closes_at) < Date.now() : false;
  const past = a.event_at ? Date.parse(a.event_end ?? a.event_at) < Date.now() : false;
  const voted = (c.myVotes?.size ?? 0) > 0;
  const totalVotes = (c.poll ?? []).reduce((x, o) => x + Number(o.votes), 0);
  const full = a.capacity !== null && (c.summary?.yes ?? 0) >= a.capacity && c.myRsvp !== "yes";
  const body = c.detail || a.body.length < 420 ? a.body : `${a.body.slice(0, 400)}…`;
  return (
    <article className={`bg-white border rounded-[14px] p-4 md:p-5 flex flex-col gap-3 ${a.pinned ? "border-accent" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${KIND_STYLE[a.kind] ?? KIND_STYLE.info}`}>{KIND_LABEL[a.kind] ?? "Duyuru"}</span>
        {a.pinned && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-[#E0F5FB] text-accent-ink">Sabit</span>}
        {!c.read && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warn-bg text-warn">Yeni</span>}
        {a.require_ack && !c.acked && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-[#FDECEA] text-bad">Onayınız bekleniyor</span>}
        <span className="text-xs text-muted ml-auto">{formatDate(a.published_at)}</span>
      </div>
      <h2 className="font-display text-lg font-semibold text-brand-800">{c.detail ? a.title : <Link href={`/duyurular/${a.id}`}>{a.title}</Link>}</h2>
      <p className="whitespace-pre-wrap text-[15px] text-ink">{body}{body !== a.body && <> <Link href={`/duyurular/${a.id}`} className="font-semibold text-brand-700">devamı</Link></>}</p>

      {a.kind === "event" && a.event_at && (
        <div className="rounded-xl bg-[#F2F6FB] p-3 flex flex-col gap-2">
          <div className="text-sm"><b>{dt(a.event_at)}</b>{a.event_end ? ` – ${new Date(a.event_end).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })}` : ""}{a.location ? ` · ${a.location}` : ""}</div>
          <div className="text-xs text-muted">Katılacak {c.summary?.yes ?? 0}{a.capacity ? ` / ${a.capacity}` : ""} · belki {c.summary?.maybe ?? 0} · katılmayacak {c.summary?.no ?? 0}</div>
          {!past && (
            <div className="flex flex-wrap gap-2">
              {([["yes", "Katılacağım"], ["maybe", "Belki"], ["no", "Katılamam"]] as const).map(([v, l]) => (
                <form key={v} action={rsvp.bind(null, v)}><input type="hidden" name="id" value={a.id} />
                  <PendingSubmit className={`${btn} ${c.myRsvp === v ? "bg-brand-700 text-white" : "border border-[#D5DEE8] bg-white text-brand-700"} ${v === "yes" && full ? "opacity-50" : ""}`}>{c.myRsvp === v ? `✓ ${l}` : l}</PendingSubmit>
                </form>
              ))}
              {full && <span className="text-xs text-bad self-center">Kontenjan doldu</span>}
            </div>
          )}
        </div>
      )}

      {a.kind === "poll" && c.poll && (
        <div className="rounded-xl bg-[#FFFBF2] border border-[#F3E2B8] p-3 flex flex-col gap-2">
          {voted || closed || c.staff ? (
            <ul className="flex flex-col gap-2">
              {c.poll.map((o) => {
                const pct = totalVotes ? Math.round((Number(o.votes) / totalVotes) * 100) : 0;
                return (
                  <li key={o.option_id} className="flex flex-col gap-1 text-sm">
                    <div className="flex justify-between gap-2"><span className={c.myVotes?.has(o.option_id) ? "font-bold" : ""}>{c.myVotes?.has(o.option_id) ? "✓ " : ""}{o.label}</span><span className="num">{o.votes} · %{pct}</span></div>
                    <div className="h-2 rounded-full bg-[#F3E2B8] overflow-hidden" role="img" aria-label={`${o.label} yüzde ${pct}`}><div className="h-full rounded-full bg-[#B7791F]" style={{ width: `${pct}%` }} /></div>
                    {c.staff && c.detail && o.voters.length > 0 && <div className="text-xs text-muted">{o.voters.join(", ")}</div>}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {!closed && (!voted || c.detail) && (
            <form action={votePoll} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={a.id} />
              {c.poll.map((o) => <label key={o.option_id} className="flex items-center gap-3 min-h-11 text-[15px]"><input type={a.poll_multi ? "checkbox" : "radio"} name="option" value={o.option_id} defaultChecked={c.myVotes?.has(o.option_id)} className="w-5 h-5" />{o.label}</label>)}
              <PendingSubmit className={`${btn} bg-brand-700 text-white self-start`}>{voted ? "Oyumu değiştir" : "Oy ver"}</PendingSubmit>
            </form>
          )}
          <div className="text-xs text-muted">{totalVotes} oy{a.anonymous ? " · isimsiz" : ""}{a.poll_multi ? " · çoklu seçim" : ""}{a.closes_at ? ` · ${closed ? "kapandı" : `kapanış ${formatDate(a.closes_at.slice(0, 10))}`}` : ""}{voted && !c.detail && !closed ? <> · <Link href={`/duyurular/${a.id}`} className="font-semibold text-brand-700">oyu değiştir</Link></> : null}</div>
        </div>
      )}

      {a.kind === "qa" && (
        c.detail ? (
          <div className="flex flex-col gap-3">
            <form action={askQuestion} className="flex flex-col gap-2 rounded-xl bg-[#F7F4FC] p-3">
              <input type="hidden" name="id" value={a.id} />
              <label className="flex flex-col gap-1 text-sm font-semibold text-[#33475B]">Sorunuz<textarea name="body" required rows={2} maxLength={1000} className="rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-base font-normal" /></label>
              <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="anonymous" className="w-5 h-5" />İsimsiz sor</label><PendingSubmit className={`${btn} bg-brand-700 text-white ml-auto`}>Sor</PendingSubmit></div>
            </form>
            <ul className="flex flex-col divide-y divide-[#EEF2F6]">
              {(c.qa ?? []).map((q) => (
                <li key={q.id} className="py-3 flex gap-3">
                  <form action={voteQuestion} className="shrink-0"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="question" value={q.id} /><input type="hidden" name="on" value={q.voted ? "0" : "1"} />
                    <button aria-label={q.voted ? "Oyumu geri al" : "Bu soruyu destekle"} className={`w-12 h-14 rounded-lg border flex flex-col items-center justify-center text-xs font-bold ${q.voted ? "bg-[#5B3BA0] text-white border-[#5B3BA0]" : "bg-white border-[#D5DEE8] text-[#5B3BA0]"}`}><span aria-hidden>▲</span>{q.votes}</button>
                  </form>
                  <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <p className="text-[15px]">{q.body}</p>
                    <span className="text-xs text-muted">{q.author}{q.mine ? " (siz)" : ""}</span>
                    {q.answer && <p className="text-sm rounded-lg bg-[#E6F4EC] p-2"><b>Yanıt:</b> {q.answer}</p>}
                    {c.staff && (
                      <form action={answerQuestion} className="flex flex-col gap-1.5">
                        <input type="hidden" name="id" value={a.id} /><input type="hidden" name="question" value={q.id} />
                        <textarea name="answer" rows={2} defaultValue={q.answer ?? ""} placeholder="Yanıtınız" className="rounded-[10px] border border-[#D5DEE8] px-3 py-2 text-sm" aria-label="Yanıt" />
                        <div className="flex gap-3 items-center"><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="hidden" className="w-4 h-4" />Gizle (uygunsuz)</label><PendingSubmit className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Yanıtla</PendingSubmit></div>
                      </form>
                    )}
                  </div>
                </li>
              ))}
              {(c.qa ?? []).length === 0 && <li className="py-4 text-sm text-muted">Henüz soru yok. İlk soruyu siz sorun.</li>}
            </ul>
          </div>
        ) : (
          <Link href={`/duyurular/${a.id}`} className={`${btn} bg-[#5B3BA0] text-white self-start inline-flex items-center`}>Soruları gör / soru sor{c.qa ? ` (${c.qa.length})` : ""}</Link>
        )
      )}

      {a.require_ack && (c.acked ? <p className="text-xs font-semibold text-ok">✓ Okuyup anladığınızı onayladınız</p> : (
        <form action={ackAnnouncement}><input type="hidden" name="id" value={a.id} /><PendingSubmit className={`${btn} bg-brand-700 text-white`}>Okudum, anladım</PendingSubmit></form>
      ))}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {c.author && <span>{c.author}</span>}
        {c.staff && c.audienceText && <span>Hedef: {c.audienceText}</span>}
        {c.staff && c.readCount !== undefined && <span>Okuyan: {c.readCount}{a.require_ack ? ` · onaylayan: ${c.ackCount ?? 0}` : ""}</span>}
        {a.expires_at && <span>{formatDate(a.expires_at)} tarihinde kalkar</span>}
        {c.staff && !c.detail && <Link href={`/duyurular/${a.id}`} className="font-semibold text-brand-700">Katılım ayrıntısı →</Link>}
        {c.staff && (
          <form action={deleteAnnouncement} className="ml-auto"><input type="hidden" name="id" value={a.id} /><ConfirmSubmit label="Kaldır" question="Duyuru kaldırılsın mı?" className="text-bad font-semibold" /></form>
        )}
      </div>
    </article>
  );
}
