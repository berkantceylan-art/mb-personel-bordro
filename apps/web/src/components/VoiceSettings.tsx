"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { Notice, btnPrimary, btnSecondary } from "@/components/erp";
import { saveVoice } from "@/lib/voice-actions";
import { fillTemplate, speakTr } from "./VoiceGreeter";

/** Şirket geneli sesli karşılama ayarı (sahip / İK) */
export function VoiceSettings({ initial, name, company }: { initial: { enabled: boolean; template: string; announce: boolean; rate: number }; name: string; company: string }) {
  const [t, setT] = useState(initial.template);
  const [rate, setRate] = useState(initial.rate);
  const { state, pending, formProps } = useActionForm(saveVoice);
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="h-5 w-5" />Girişte sesli karşılama açık</label>
      <label className="flex flex-col gap-1 text-sm text-muted">Karşılama metni <span className="text-xs">{"{ad}"} ad soyad · {"{isim}"} ad · {"{selam}"} günaydın / iyi günler / iyi akşamlar · {"{sirket}"} şirket adı</span>
        <textarea name="template" value={t} onChange={(e) => setT(e.target.value)} rows={2} maxLength={400} className="rounded-[10px] border border-[#D5DEE8] p-3 text-ink" />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">Konuşma hızı <input type="range" name="rate" min={0.7} max={1.4} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} /> <span className="w-10">{rate.toFixed(2)}</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="announce" defaultChecked={initial.announce} className="h-5 w-5" />“Sesli oku” işaretli duyuruları oku</label>
      </div>
      <p className="rounded-xl bg-[#F7F9FC] p-3 text-sm">Örnek: <i>{fillTemplate(t, { name, company })}</i></p>
      {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
      <div className="flex gap-2">
        <button disabled={pending} className={btnPrimary}>Kaydet</button>
        <button type="button" onClick={() => void speakTr(fillTemplate(t, { name, company }), rate)} className={btnSecondary}>🔊 Dinle</button>
      </div>
    </form>
  );
}
