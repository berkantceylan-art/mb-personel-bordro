"use client";
import { useState, useTransition } from "react";
import { replyInterview } from "@/app/kariyer/actions";

export function ReplyButtons({ token, current }: { token: string; current: string | null }) {
  const [reply, setReply] = useState(current);
  const [pending, start] = useTransition();
  const send = (r: "confirmed" | "reschedule") => start(async () => { const res = await replyInterview(token, r); if (res.ok) setReply(r); });
  if (reply) return <div className="text-sm font-semibold text-[#1A7F52]" role="status">{reply === "confirmed" ? "✓ Geleceğinizi bildirdiniz. Görüşmek üzere!" : "✓ Başka bir gün istediğinizi bildirdiniz; sizi arayacağız."}</div>;
  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => send("confirmed")} className="flex-1 h-12 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Geleceğim</button>
      <button type="button" disabled={pending} onClick={() => send("reschedule")} className="flex-1 h-12 rounded-[10px] border border-[#9FB3C8] bg-white text-brand-700 font-semibold disabled:opacity-60">Başka gün</button>
    </div>
  );
}
