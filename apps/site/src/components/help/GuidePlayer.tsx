"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GuideScreen, GuideStep } from "@/lib/help-content";

const STEP_MS = 6000;

/** Delay helper for staggered CSS animations */
const d = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/**
 * Portalın kullanımını gösteren animasyonlu anlatım: her adımda sahte bir portal ekranı canlanır,
 * altında açıklama yazar. Kendiliğinden ilerler; durdurulabilir, adım seçilebilir.
 */
export function GuidePlayer({ steps, mock, labels }: { steps: GuideStep[]; mock: Record<string, string>; labels: { play: string; pause: string; prev: string; next: string } }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const start = useRef(Date.now());
  const n = steps.length;
  const step = steps[Math.min(i, n - 1)]!;

  // Adım değişince ilerleme çubuğunu sıfırla
  useEffect(() => {
    start.current = Date.now();
    setTick(0);
  }, [i]);
  useEffect(() => {
    if (!playing) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = setInterval(() => {
      const el = Date.now() - start.current;
      setTick(Math.min(1, el / STEP_MS));
      if (el >= STEP_MS && !reduce) setI((x) => (x + 1) % n);
    }, 100);
    return () => clearInterval(t);
  }, [playing, n, i]);

  const go = (k: number) => setI(((k % n) + n) % n);

  return (
    <div className="gp overflow-hidden rounded-3xl border border-gypsum bg-white shadow-sm">
      <style>{CSS}</style>
      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Ekran */}
        <div className="relative bg-porcelain p-3 sm:p-5">
          <div className="overflow-hidden rounded-2xl border border-gypsum bg-white shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-gypsum bg-[#f6f8fb] px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
              <span className="ml-3 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[11px] text-slate">mbdentaire.com/portal</span>
            </div>
            <div key={i} className="gp-screen relative aspect-[16/10] overflow-hidden">
              <Screen kind={step.screen} m={mock} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => go(i - 1)} aria-label={labels.prev} className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-navy hover:text-white">‹</button>
            <button type="button" onClick={() => setPlaying((p) => !p)} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-blue">
              {playing ? `❚❚ ${labels.pause}` : `▶ ${labels.play}`}
            </button>
            <button type="button" onClick={() => go(i + 1)} aria-label={labels.next} className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-navy hover:text-white">›</button>
            <div className="ml-2 flex flex-1 gap-1" aria-hidden>
              {steps.map((_, k) => (
                <span key={k} className="h-1.5 flex-1 overflow-hidden rounded-full bg-gypsum">
                  <span className="block h-full bg-smile" style={{ width: k < i ? "100%" : k === i ? `${tick * 100}%` : "0%" }} />
                </span>
              ))}
            </div>
            <span className="num w-12 text-right text-xs text-slate">{i + 1}/{n}</span>
          </div>
        </div>
        {/* Adımlar */}
        <ol className="max-h-[520px] overflow-y-auto p-3 sm:p-5">
          {steps.map((s, k) => (
            <li key={k}>
              <button type="button" onClick={() => { go(k); }} aria-current={k === i ? "step" : undefined}
                className={`flex w-full gap-3 rounded-2xl p-3 text-left transition ${k === i ? "bg-porcelain ring-2 ring-smile" : "hover:bg-porcelain"}`}>
                <span className={`num grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${k <= i ? "bg-navy text-white" : "bg-gypsum text-slate"}`}>{k + 1}</span>
                <span>
                  <span className="block font-semibold text-navy">{s.title}</span>
                  {k === i && <span className="mt-0.5 block text-sm text-ink">{s.caption}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ---------- Sahte ekranlar ---------- */

function Cursor({ x, y, delay = 0.8 }: { x: string; y: string; delay?: number }) {
  return (
    <span className="gp-cursor pointer-events-none absolute z-20" style={{ "--x": x, "--y": y, ...d(delay) } as CSSProperties}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M4 2l16 10-7 2-3 7z" fill="#0b2545" stroke="#fff" strokeWidth="1.5" /></svg>
    </span>
  );
}
function Field({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <div className="gp-up" style={d(delay - 0.3)}>
      <div className="text-[10px] font-semibold text-slate sm:text-xs">{label}</div>
      <div className="mt-0.5 h-7 overflow-hidden rounded-md border border-gypsum bg-white px-2 text-[11px] leading-7 text-ink sm:h-8 sm:text-sm sm:leading-8">
        <span className="gp-type inline-block overflow-hidden whitespace-nowrap align-top" style={d(delay)}>{value}</span>
      </div>
    </div>
  );
}
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full">
      <div className="hidden w-[18%] flex-col gap-2 bg-navy p-2 sm:flex">
        <div className="h-5 w-5 rounded bg-white/90" />
        {[0, 1, 2, 3, 4].map((k) => <div key={k} className={`h-2 rounded ${k === 1 ? "bg-smile" : "bg-white/25"}`} />)}
      </div>
      <div className="flex-1 p-3 sm:p-5">
        <div className="display mb-2 text-sm font-semibold text-navy sm:mb-3 sm:text-lg">{title}</div>
        {children}
      </div>
    </div>
  );
}
const Btn = ({ children, delay = 0, pulse = false }: { children: ReactNode; delay?: number; pulse?: boolean }) => (
  <span className={`gp-up inline-block rounded-full bg-navy px-3 py-1.5 text-[11px] font-semibold text-white sm:text-sm ${pulse ? "gp-press" : ""}`} style={d(delay)}>{children}</span>
);

function Screen({ kind, m }: { kind: GuideScreen; m: Record<string, string> }) {
  const stages = (m.stages ?? "").split("|");
  switch (kind) {
    case "signup":
      return (
        <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#0b2545,#13315c)] p-3">
          <div className="w-[88%] max-w-md rounded-xl bg-white p-3 shadow-xl sm:p-5">
            <div className="text-[10px] font-semibold text-slate sm:text-xs">{m.type}</div>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {[0, 1, 2, 3].map((k) => <div key={k} className={`h-6 rounded-md border sm:h-7 ${k === 0 ? "gp-pick border-navy bg-porcelain" : "border-gypsum"}`} style={k === 0 ? d(0.4) : undefined} />)}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label={m.name!} value="Dr. Ayşe Yılmaz" delay={1} />
              <Field label={m.company!} value="Gülüş Diş" delay={1.8} />
              <Field label={m.email!} value="ayse@gulus.com" delay={2.6} />
              <Field label={m.password!} value="••••••••••" delay={3.3} />
            </div>
            <div className="mt-3"><Btn delay={3.9} pulse>{m.create}</Btn></div>
          </div>
          <Cursor x="35%" y="83%" delay={3.8} />
        </div>
      );
    case "verify":
      return (
        <div className="flex h-full flex-col bg-white">
          <div className="border-b border-gypsum px-4 py-2 text-xs font-semibold text-slate sm:text-sm">✉ {m.inbox}</div>
          <div className="gp-up mx-3 mt-3 flex items-center gap-2 rounded-lg bg-porcelain px-3 py-2 text-[11px] sm:text-sm" style={d(0.3)}>
            <span className="h-2 w-2 rounded-full bg-blue" /> <b className="text-navy">MB Dental</b> <span className="truncate text-ink">{m.verifySubj}</span>
          </div>
          <div className="gp-up mx-auto mt-4 w-[80%] rounded-xl border border-gypsum p-4 text-center" style={d(1.3)}>
            <div className="mx-auto h-8 w-8 rounded-lg bg-navy" />
            <div className="mt-2 text-xs text-ink sm:text-sm">{m.verifySubj}</div>
            <div className="mt-3"><Btn delay={2} pulse>{m.verifyBtn}</Btn></div>
          </div>
          <Cursor x="50%" y="74%" delay={2.6} />
        </div>
      );
    case "pending":
      return (
        <div className="relative grid h-full place-items-center bg-porcelain">
          <div className="gp-out absolute grid place-items-center text-center" style={d(2.6)}>
            <div className="gp-spin text-4xl">⏳</div>
            <div className="mt-2 font-semibold text-navy">{m.pending}</div>
          </div>
          <div className="gp-pop grid place-items-center text-center opacity-0" style={d(3)}>
            <div className="grid h-14 w-14 place-items-center rounded-full bg-ok text-2xl text-white">✓</div>
            <div className="mt-2 font-semibold text-ok">{m.approved}</div>
          </div>
        </div>
      );
    case "profile":
      return (
        <Shell title={m.profile!}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={m.delivery!} value="Alsancak, İzmir" delay={0.6} />
            <Field label={m.invoice!} value="Gülüş Diş Ltd." delay={1.4} />
            <Field label={m.shade!} value="VITA Classical" delay={2.2} />
            <Field label={m.carrier!} value="DHL Express" delay={3} />
          </div>
          <div className="mt-3"><Btn delay={3.8} pulse>{m.save}</Btn></div>
        </Shell>
      );
    case "newcase":
      return (
        <Shell title={m.newCase!}>
          <div className="grid grid-cols-3 gap-2">
            <Field label={m.patient!} value="AY-104" delay={0.5} />
            <Field label={m.product!} value={m.productVal!} delay={1.1} />
            <Field label={m.due!} value="24.10" delay={1.7} />
          </div>
          <div className="mt-2 text-[10px] font-semibold text-slate sm:text-xs">{m.teeth}</div>
          <div className="mt-1 flex gap-1">
            {[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28].map((t, k) => (
              <span key={t} className={`num grid h-6 flex-1 place-items-center rounded text-[8px] sm:h-8 sm:text-[10px] ${[11, 21].includes(t) ? "gp-tooth" : "bg-porcelain text-slate"}`} style={[11, 21].includes(t) ? d(2.2 + k * 0.02) : undefined}>{t}</span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate sm:text-xs">{m.shadeLbl}: {["A1", "A2", "A3", "B1"].map((s, k) => <span key={s} className={`rounded px-1.5 py-0.5 ${k === 1 ? "gp-pick bg-navy text-white" : "bg-porcelain"}`} style={k === 1 ? d(3) : undefined}>{s}</span>)}</div>
          <div className="mt-3"><Btn delay={3.8} pulse>{m.send} →</Btn></div>
          <Cursor x="52%" y="56%" delay={2} />
        </Shell>
      );
    case "upload":
      return (
        <Shell title={m.files!}>
          <div className="gp-drop grid h-[38%] place-items-center rounded-xl border-2 border-dashed border-smile bg-porcelain text-[11px] text-slate sm:text-sm" style={d(0.2)}>⬆ {m.drop}</div>
          <div className="mt-2 grid gap-1.5">
            {["upper_jaw.stl  · 24 MB", "lower_jaw.stl  · 21 MB", "smile_photo.jpg  · 3 MB"].map((f, k) => (
              <div key={f} className="gp-up rounded-lg border border-gypsum px-2 py-1.5" style={d(1 + k * 0.8)}>
                <div className="flex justify-between text-[10px] text-ink sm:text-xs"><span>📎 {f}</span><span className="gp-in text-ok" style={d(2 + k * 0.8)}>✓</span></div>
                <div className="mt-1 h-1 overflow-hidden rounded bg-gypsum"><div className="gp-fill h-full bg-smile" style={d(1.1 + k * 0.8)} /></div>
              </div>
            ))}
          </div>
        </Shell>
      );
    case "track":
      return (
        <Shell title={`${m.caseNo} #1042 · AY-104`}>
          <div className="mt-4 flex items-start">
            {stages.map((s, k) => (
              <div key={s} className="relative flex flex-1 flex-col items-center text-center">
                {k > 0 && <div className="absolute right-1/2 top-3 h-1 w-full bg-gypsum"><div className="gp-fill h-full bg-smile" style={d(0.4 + k * 0.6)} /></div>}
                <span className="gp-dot relative z-10 grid h-6 w-6 place-items-center rounded-full bg-gypsum text-[10px] font-bold text-white sm:h-7 sm:w-7" style={d(0.6 + k * 0.6)}>✓</span>
                <span className="mt-1 text-[8px] text-ink sm:text-[11px]">{s}</span>
              </div>
            ))}
          </div>
          <div className="gp-up mt-5 rounded-lg bg-porcelain p-2 text-[10px] text-ink sm:text-sm" style={d(4.2)}>🚚 DHL · 4823 1190 22 · <b className="text-ok">{stages[4]}</b></div>
        </Shell>
      );
    case "chat":
      return (
        <Shell title={`${m.caseNo} #1042`}>
          <div className="flex flex-col gap-2">
            <div className="gp-up max-w-[75%] self-end rounded-2xl rounded-br-sm bg-navy px-3 py-2 text-[11px] text-white sm:text-sm" style={d(0.4)}>{m.chatQ}</div>
            <div className="gp-up flex max-w-[60%] gap-1 self-start rounded-2xl bg-porcelain px-3 py-2" style={d(1.3)}><span className="gp-blink h-1.5 w-1.5 rounded-full bg-slate" /><span className="gp-blink h-1.5 w-1.5 rounded-full bg-slate" style={d(0.2)} /><span className="gp-blink h-1.5 w-1.5 rounded-full bg-slate" style={d(0.4)} /></div>
            <div className="gp-up max-w-[75%] self-start rounded-2xl rounded-bl-sm bg-porcelain px-3 py-2 text-[11px] text-ink sm:text-sm" style={d(2.6)}>{m.chatA}</div>
            <div className="gp-up flex w-[45%] items-center gap-2 self-start rounded-xl border border-gypsum p-2 text-[10px] sm:text-xs" style={d(3.4)}><span className="grid h-8 w-8 place-items-center rounded bg-[#e7f1fb]">🦷</span> design_v2.stl · 3D</div>
          </div>
        </Shell>
      );
    case "ship":
      return (
        <Shell title={m.parcel!}>
          <div className="flex gap-2"><Btn delay={0.3} pulse>{m.courier}</Btn><span className="gp-up rounded-full border border-gypsum px-3 py-1.5 text-[11px] sm:text-sm" style={d(0.6)}>{m.tracking}: 4823 1190 22</span></div>
          <div className="relative mt-8 h-2 rounded bg-gypsum">
            <div className="gp-fill h-full rounded bg-smile" style={{ ...d(1), animationDuration: "3s" }} />
            <span className="gp-truck absolute -top-5 text-xl" style={d(1)}>🚚</span>
            <span className="absolute -bottom-6 left-0 text-[10px] text-slate sm:text-xs">İzmir</span>
            <span className="absolute -bottom-6 right-0 text-[10px] text-slate sm:text-xs">📍</span>
          </div>
          <div className="gp-up mt-10 inline-block rounded-full bg-[#def5fc] px-3 py-1 text-[11px] font-semibold text-smile-ink sm:text-sm" style={d(3.5)}>{m.onWay}</div>
        </Shell>
      );
    case "account":
      return (
        <Shell title={m.statement!}>
          <div className="overflow-hidden rounded-lg border border-gypsum text-[10px] sm:text-xs">
            {[["12.10", `${m.invoiceRow} 2026-118`, "4.800"], ["15.10", `${m.invoiceRow} 2026-124`, "2.150"], ["18.10", "Ödeme / Payment", "−5.000"]].map((r, k) => (
              <div key={k} className="gp-up grid grid-cols-[1fr_3fr_1.4fr] border-b border-gypsum px-2 py-1.5 last:border-0" style={d(0.4 + k * 0.6)}><span className="num text-slate">{r[0]}</span><span className="text-ink">{r[1]}</span><span className="num text-right">{r[2]}</span></div>
            ))}
          </div>
          <div className="gp-up mt-2 flex items-center justify-between rounded-lg bg-porcelain px-3 py-2 text-xs sm:text-sm" style={d(2.4)}><span className="text-slate">{m.balance}</span><b className="num text-navy">1.950</b></div>
          <div className="mt-3"><Btn delay={3.1} pulse>⬇ {m.download}</Btn></div>
        </Shell>
      );
    case "team":
      return (
        <Shell title={m.team!}>
          <div className="gp-up flex items-center gap-2 rounded-lg bg-porcelain p-2 text-[11px] sm:text-sm" style={d(0.3)}>{m.inviteCode}: <b className="num tracking-[.2em] text-navy">K7PX4M2Q</b></div>
          <div className="mt-2 grid gap-1.5">
            {[["Dr. Ayşe Yılmaz", m.admin], ["Dr. Can Demir", m.member], ["Elif (asistan)", m.member]].map(([n, r], k) => (
              <div key={n} className="gp-up flex items-center gap-2 rounded-lg border border-gypsum px-2 py-1.5 text-[11px] sm:text-sm" style={d(1 + k * 0.8)}><span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-[10px] text-white">{n!.replace("Dr. ", "")[0]}</span>{n}<span className="ml-auto text-[10px] text-slate sm:text-xs">{r}</span></div>
            ))}
          </div>
        </Shell>
      );
    case "clients":
      return (
        <Shell title={m.clients!}>
          <Btn delay={0.3} pulse>+ {m.addClient}</Btn>
          <div className="mt-2 grid gap-1.5">
            {["Dr. Marie Dubois · Lyon", "Clinique Sourire · Bruxelles", "Dr. Mehmet Kaya · Bursa"].map((n, k) => (
              <div key={n} className="gp-up rounded-lg border border-gypsum px-2 py-1.5 text-[11px] text-ink sm:text-sm" style={d(1 + k * 0.8)}>🩺 {n}</div>
            ))}
          </div>
        </Shell>
      );
    case "declaration":
      return (
        <div className="grid h-full place-items-center bg-porcelain">
          <div className="gp-up relative w-[56%] rounded-md bg-white p-3 shadow-lg" style={d(0.3)}>
            <div className="text-[10px] font-bold text-navy sm:text-sm">{m.decl}</div>
            {[90, 70, 85, 60, 75].map((w, k) => <div key={k} className="gp-fill mt-1.5 h-1.5 rounded bg-gypsum" style={{ ...d(0.6 + k * 0.25), width: `${w}%` }} />)}
            <span className="gp-stamp absolute bottom-3 right-3 rounded border-2 border-ok px-1.5 text-[10px] font-bold text-ok sm:text-xs" style={d(2.2)}>MDR · XIII</span>
          </div>
          <div className="mt-3"><Btn delay={2.8} pulse>🖨 {m.print}</Btn></div>
        </div>
      );
  }
}

const CSS = `
.gp .gp-up{opacity:0;animation:gpUp .5s ease forwards}
.gp .gp-in{opacity:0;animation:gpIn .3s ease forwards}
.gp .gp-out{animation:gpOut .4s ease forwards;animation-play-state:running}
.gp .gp-pop{animation:gpPop .5s cubic-bezier(.2,1.4,.4,1) forwards}
.gp .gp-type{max-width:0;animation:gpType .9s steps(18,end) forwards}
.gp .gp-fill{transform:scaleX(0);transform-origin:left;animation:gpFill .8s ease forwards}
.gp .gp-dot{animation:gpDot .3s ease forwards}
.gp .gp-tooth{background:#eef2f6;color:#5b6b7f;animation:gpTooth .3s ease forwards}
.gp .gp-pick{animation:gpPick .3s ease forwards}
.gp .gp-press{animation:gpUp .5s ease forwards,gpPress .4s ease 1}
.gp .gp-spin{animation:gpSpin 1.2s linear infinite}
.gp .gp-blink{animation:gpBlink 1s ease infinite}
.gp .gp-drop{animation:gpDrop 1.2s ease 2}
.gp .gp-truck{left:0;animation:gpTruck 3s ease forwards}
.gp .gp-stamp{opacity:0;transform:scale(2) rotate(-12deg);animation:gpStamp .4s ease forwards}
.gp .gp-cursor{left:85%;top:95%;opacity:0;animation:gpCursor 1.4s ease forwards}
@keyframes gpUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes gpIn{to{opacity:1}}
@keyframes gpOut{to{opacity:0;transform:scale(.9)}}
@keyframes gpPop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes gpType{to{max-width:100%}}
@keyframes gpFill{to{transform:scaleX(1)}}
@keyframes gpDot{to{background:#0b2545}}
@keyframes gpTooth{to{background:#00b4d8;color:#fff;transform:translateY(-2px)}}
@keyframes gpPick{to{border-color:#0b2545;background:#0b2545;color:#fff}}
@keyframes gpPress{50%{transform:scale(.94)}}
@keyframes gpSpin{to{transform:rotate(360deg)}}
@keyframes gpBlink{50%{opacity:.2}}
@keyframes gpDrop{50%{background:#def5fc}}
@keyframes gpTruck{to{left:calc(100% - 24px)}}
@keyframes gpStamp{to{opacity:1;transform:rotate(-12deg)}}
@keyframes gpCursor{0%{opacity:0}20%{opacity:1}100%{opacity:1;left:var(--x);top:var(--y)}}
@media (prefers-reduced-motion:reduce){.gp *{animation-duration:.01s!important;animation-delay:0s!important}}
`;
