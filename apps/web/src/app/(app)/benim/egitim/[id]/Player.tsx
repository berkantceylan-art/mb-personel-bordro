"use client";
import { useEffect, useRef, useState } from "react";
import { beat, submitExam } from "../actions";

const PROMPT_EVERY = 5 * 60; // sn

/** Uzaktan eğitim oynatıcı: ileri sarma engeli, sekme değişince durdurma, aralıklı katılım sorusu, sınav */
export function Player({ id, src, durationSec, maxPos, watched, questions, attempts, passed, score }: { id: string; src: string; durationSec: number; maxPos: number; watched: number; questions: Array<{ q: string; options: string[] }>; attempts: number; passed: boolean; score: number | null }) {
  const v = useRef<HTMLVideoElement>(null);
  const maxRef = useRef(maxPos);
  const acc = useRef(0);
  const lastT = useRef(0);
  const sincePrompt = useRef(0);
  const [w, setW] = useState(watched);
  const [prompt, setPrompt] = useState(false);
  const [done, setDone] = useState(watched >= durationSec * 0.95);
  const [answers, setAnswers] = useState<number[]>(questions.map(() => -1));
  const [result, setResult] = useState<{ score?: number; passed?: boolean; attempts?: number; error?: string } | null>(passed ? { score: score ?? 100, passed: true } : null);
  const [msg, setMsg] = useState("");

  const send = async (focusLoss = false, prmt = false) => {
    const el = v.current;
    const r = await beat(id, el?.currentTime ?? 0, acc.current, focusLoss, prmt);
    acc.current = 0;
    if ("error" in r) { setMsg(r.error ?? ""); return; }
    maxRef.current = Math.max(maxRef.current, r.max);
    setW(r.watched);
    if (r.done) setDone(true);
  };

  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (maxPos > 0) el.currentTime = Math.min(maxPos, durationSec);
    const onTime = () => {
      const t = el.currentTime;
      const d = t - lastT.current;
      if (d > 0 && d < 2) { acc.current += d; sincePrompt.current += d; }
      lastT.current = t;
      if (t > maxRef.current && t - maxRef.current < 2) maxRef.current = t;
      if (sincePrompt.current >= PROMPT_EVERY) { sincePrompt.current = 0; el.pause(); setPrompt(true); }
    };
    const onSeek = () => { if (el.currentTime > maxRef.current + 1) { el.currentTime = maxRef.current; setMsg("İzlemediğiniz bölüme atlanamaz."); } lastT.current = el.currentTime; };
    const onRate = () => { if (el.playbackRate > 1) el.playbackRate = 1; };
    const onVis = () => { if (document.hidden && !el.paused) { el.pause(); setMsg("Sayfadan ayrıldığınız için video durduruldu; bu kayda geçti."); void send(true); } };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeking", onSeek);
    el.addEventListener("ratechange", onRate);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => { if (!el.paused && acc.current > 0) void send(); }, 15000);
    return () => { el.removeEventListener("timeupdate", onTime); el.removeEventListener("seeking", onSeek); el.removeEventListener("ratechange", onRate); document.removeEventListener("visibilitychange", onVis); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = Math.min(100, Math.round((w / durationSec) * 100));
  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-[14px] overflow-hidden bg-black">
        <video ref={v} src={src} controls controlsList="nodownload noplaybackrate" disablePictureInPicture playsInline className="w-full aspect-video" onPause={() => void send()} onEnded={() => void send()} />
        {prompt && (
          <div className="absolute inset-0 bg-black/70 grid place-items-center p-4">
            <div className="bg-white rounded-xl p-5 text-center flex flex-col gap-3 max-w-xs">
              <b>Eğitime devam ediyor musunuz?</b>
              <button className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold" onClick={() => { setPrompt(false); void send(false, true); void v.current?.play(); }}>Evet, devam et</button>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm"><div className="flex-1 h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-full bg-[#1A7F52]" style={{ width: `${pct}%` }} /></div><span className="num">%{pct} izlendi</span></div>
      {msg && <p role="status" className="text-sm rounded-lg bg-warn-bg text-warn px-3 py-2">{msg}</p>}
      {result?.passed ? (
        <div className="rounded-xl bg-ok-bg text-ok p-4 font-semibold">Eğitimi tamamladınız. Sınav puanınız: {result.score}. Eğitim kaydınıza işlendi.</div>
      ) : done ? (
        questions.length === 0 ? (
          <button className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold" onClick={async () => setResult(await submitExam(id, []))}>Eğitimi tamamla</button>
        ) : (
          <form className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-4" onSubmit={async (e) => { e.preventDefault(); if (answers.some((a) => a < 0)) { setMsg("Tüm soruları yanıtlayın."); return; } setResult(await submitExam(id, answers)); }}>
            <b>Sınav · {questions.length} soru · geçme notu 60{attempts ? ` · ${attempts}. deneme yapıldı` : ""}</b>
            {questions.map((q, i) => (
              <fieldset key={i} className="flex flex-col gap-1.5"><legend className="font-semibold text-sm mb-1">{i + 1}. {q.q}</legend>
                {q.options.map((o, j) => <label key={j} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${answers[i] === j ? "border-brand-700 bg-[#E7F1FB]" : "border-[#D5DEE8]"}`}><input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers((a) => a.map((x, k) => (k === i ? j : x)))} />{o}</label>)}
              </fieldset>
            ))}
            {result && !result.passed && <p className="text-sm rounded-lg bg-bad-bg text-bad px-3 py-2">{result.error ?? `Puanınız ${result.score}. Geçme notu 60. ${3 - (result.attempts ?? 0) > 0 ? `${3 - (result.attempts ?? 0)} deneme hakkınız kaldı.` : "Deneme hakkınız doldu; İSG birimine başvurun."}`}</p>}
            <button className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold">Sınavı gönder</button>
          </form>
        )
      ) : <p className="text-sm text-muted">Videonun tamamını izledikten sonra sınav açılır. İleri sarma kapalıdır; sayfadan ayrılırsanız video durur.</p>}
    </div>
  );
}
