import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAGES, STAGE_LABEL } from "@/lib/recruiting";
import { ReplyButtons } from "./ReplyButtons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Başvuru durumu", robots: { index: false } };

type Status = { tracking_code: string; first_name: string; title: string; stage: string; stage_changed_at: string; created_at: string; interview_at: string | null; interview_place: string | null; candidate_reply: string | null; company_name: string };

const fmt = (iso: string, time = false) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: time ? "long" : undefined, hour: time ? "2-digit" : undefined, minute: time ? "2-digit" : undefined });

/** Adayın başvuru takip sayfası (giriş gerektirmez; bağlantıdaki gizli anahtarla) */
export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const { data } = await createAdminClient().rpc("candidate_status", { p_token: token });
  const s = (data as Status[] | null)?.[0];
  if (!s) notFound();
  const closed = s.stage === "rejected" || s.stage === "withdrawn";
  const idx = STAGES.findIndex(([k]) => k === s.stage);
  const steps = STAGES.map(([k, label], i) => ({ k, label, state: closed ? (i === 0 ? "done" : "off") : i < idx ? "done" : i === idx ? "now" : "next" }));
  const hint: Record<string, string> = {
    new: "Başvurunuz ekibimize ulaştı; en kısa sürede değerlendirilecek.",
    screen: "Başvurunuz inceleniyor. Uygun görülürse mülakat için sizi arayacağız.",
    interview: s.interview_at ? "Mülakat davetiniz aşağıda." : "Mülakat için sizinle iletişime geçeceğiz.",
    trial: "Laboratuvarımızda bir deneme günü planlanıyor; ayrıntılar için sizi arayacağız.",
    offer: "Size bir teklifimiz var; ekibimiz sizinle görüşecek.",
    hired: "Aramıza hoş geldiniz! İşe başlangıç için sizinle iletişime geçeceğiz.",
    rejected: "Bu pozisyon için süreç olumsuz sonuçlandı. İlginiz için teşekkür ederiz; uygun pozisyon açıldığında başvurabilirsiniz.",
    withdrawn: "Başvurunuz geri çekildi.",
  };
  return (
    <div className="min-h-dvh bg-[#F5F7FA] text-ink">
      <header className="bg-brand-900 text-white px-5 py-6">
        <div className="max-w-[560px] mx-auto flex flex-col gap-1">
          <div className="text-xs font-bold uppercase tracking-[.12em] text-[#9FC1E6]">{s.company_name} · Başvuru takibi</div>
          <h1 className="font-display text-2xl font-bold">Merhaba {s.first_name}</h1>
        </div>
      </header>
      <main className="max-w-[560px] mx-auto p-4 flex flex-col gap-4">
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-1">
          <div className="flex justify-between items-baseline gap-2"><span className="text-sm text-muted">{s.tracking_code}</span><span className={`text-xs font-bold rounded-full px-2.5 py-1 ${closed ? "bg-[#EEF2F6] text-muted" : "bg-[#FFF4E0] text-[#7A4F00]"}`}>{STAGE_LABEL[s.stage]}</span></div>
          <div className="text-lg font-semibold">{s.title}</div>
          <div className="text-sm text-muted">Başvuru: {fmt(s.created_at)}</div>
        </section>
        <p className="text-[15px] leading-relaxed">{hint[s.stage]}</p>
        {s.stage === "interview" && s.interview_at && (
          <section className="rounded-[14px] bg-[#EAF2FB] p-4 flex flex-col gap-3">
            <div className="font-semibold">Mülakat davetiniz</div>
            <div className="text-[15px]">{fmt(s.interview_at, true)}{s.interview_place ? ` · ${s.interview_place}` : ""}</div>
            <ReplyButtons token={token} current={s.candidate_reply} />
          </section>
        )}
        {!closed && (
          <ol className="bg-white border border-line rounded-[14px] p-4 flex flex-col" aria-label="Aşamalar">
            {steps.map((x, i) => (
              <li key={x.k} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`w-3.5 h-3.5 rounded-full box-border ${x.state === "done" ? "bg-[#1A7F52]" : x.state === "now" ? "bg-white border-4 border-brand-700" : "bg-white border-2 border-[#C9D4E0]"}`} />
                  {i < steps.length - 1 && <span className={`w-0.5 flex-1 min-h-5 ${x.state === "done" ? "bg-[#1A7F52]" : "bg-[#E1E8F0]"}`} />}
                </div>
                <div className={`pb-4 text-[15px] ${x.state === "now" ? "font-bold" : x.state === "next" ? "text-muted" : ""}`}>{x.label}</div>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted">Bu bağlantı size özeldir; başkalarıyla paylaşmayın. Verilerinizin silinmesi veya diğer KVKK haklarınız için <a href="/kvkk-basvuru" className="font-semibold text-brand-700">başvuru yapın</a>.</p>
      </main>
    </div>
  );
}
