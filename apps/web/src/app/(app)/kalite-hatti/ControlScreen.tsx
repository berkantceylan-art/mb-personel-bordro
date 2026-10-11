"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanInput, scanFeedback } from "@/components/ScanInput";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Notice } from "@/components/erp";
import { QC_LISTS } from "@/lib/qc";
import { since } from "@/lib/flow";
import { qcDecide, qcOpen, type JobCard } from "@/lib/qc-actions";
import type { Person, QueueJob } from "./data";

const STAGE_NAME = { chief: "Birinci kontrol", qc: "Son kontrol" };
const NEXT = { chief: "Son kontrole gönder", qc: "Paketleme / çıkışa gönder" };

/** Kontrol ekranı: işi okut → kartı ve kontrol listesi → onayla (sonraki aşama) ya da nedenle geri gönder */
export function ControlScreen({ stage, people, me, canPick, queue }: { stage: "chief" | "qc"; people: Person[]; me: Person | null; canPick: boolean; queue: QueueJob[] }) {
  const router = useRouter();
  const mine = people.filter((p) => p.role === stage);
  const [emp, setEmp] = useState(me?.role === stage ? me.id : canPick ? mine[0]?.id ?? "" : me?.id ?? "");
  const [card, setCard] = useState<JobCard | null>(null);
  const [items, setItems] = useState(QC_LISTS[stage].map((i) => ({ ...i, ok: true })));
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [pics, setPics] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<{ t: string; text: string; ok: boolean }[]>([]);
  const [busy, start] = useTransition();
  const techs = people.filter((p) => p.role === "technician");
  const failed = items.filter((i) => !i.ok);
  const empOk = !!emp && people.some((p) => p.id === emp && p.role === stage);

  useEffect(() => { if (canPick) { try { const v = localStorage.getItem(`qc-emp-${stage}`); if (v && people.some((p) => p.id === v)) setEmp(v); } catch { /* yok */ } } }, [canPick, stage, people]);
  const reset = () => { setCard(null); setItems(QC_LISTS[stage].map((i) => ({ ...i, ok: true }))); setNote(""); setTarget(""); setPics([]); };
  const open = (c: string) => start(async () => {
    setMsg(null);
    const r = await qcOpen(c, emp, empOk);
    scanFeedback(r.ok);
    if (!r.ok) { setMsg({ ok: false, text: r.message ?? "Okunamadı" }); return; }
    reset(); setCard(r);
    if (r.warnings?.length) setMsg({ ok: false, text: r.warnings.join(" · ") });
    router.refresh();
  });
  const decide = (pass: boolean) => start(async () => {
    if (!card) return;
    if (!pass && !note.trim() && !failed.length) { setMsg({ ok: false, text: "Geri gönderme nedenini yazın ya da hatalı maddeleri işaretleyin." }); return; }
    const reason = [failed.map((f) => f.label).join(", "), note.trim()].filter(Boolean).join(" · ");
    const r = await qcDecide({ code: String(card.no), employee: emp, stage, pass, items, note: pass ? note : reason, target: pass ? null : target || null, photo: pics[0] ?? null });
    scanFeedback(r.ok);
    setMsg({ ok: r.ok, text: r.ok ? `İş #${card.no}: ${r.message}` : r.message });
    if (r.ok) { setLog((l) => [{ t: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }), text: `#${card.no} ${card.patient ?? ""} — ${pass ? "onay" : "geri"}`, ok: pass }, ...l].slice(0, 12)); reset(); router.refresh(); }
  });
  const t = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-[16px] border border-line bg-white p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{STAGE_NAME[stage]} sorumlusu:</span>
            {canPick ? (
              <select value={emp} onChange={(e) => { setEmp(e.target.value); try { localStorage.setItem(`qc-emp-${stage}`, e.target.value); } catch { /* yok */ } }} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">
                <option value="">— Seçin —</option>
                {mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : <b>{me?.name ?? "—"}</b>}
            {!empOk && <span className="text-xs text-bad">Bu ekran için {STAGE_NAME[stage].toLocaleLowerCase("tr")} rolü gerekir (Üretim › Ekip). Yalnız görüntüleme yapılır.</span>}
          </div>
          <ScanInput onCode={open} busy={busy} placeholder="İşin kutu / iş barkodunu okutun" />
          {msg && <div className={`rounded-xl px-4 py-3 font-semibold ${msg.ok ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-bad"}`}>{msg.text}</div>}
        </section>

        {card && (
          <section className="flex flex-col gap-4 rounded-[16px] border-2 border-brand-600/30 bg-white p-4 md:p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[200px]">
                <Link href={`/isler/${card.id}`} target="_blank" className="font-mono text-sm text-brand-700">İş #{card.no} ↗</Link>
                <h2 className="text-2xl font-bold">{card.patient ?? "—"}</h2>
                <p className="text-sm text-muted">{[card.customer, card.doctor].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="text-right text-sm">
                {card.due && <span className={`block font-semibold ${card.due < t ? "text-bad" : ""}`}>Teslim {card.due.split("-").reverse().join(".")}</span>}
                {!!card.rejects && <span className="block text-xs font-semibold text-warn">{card.rejects} kez geri dönmüş</span>}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-[#F7F9FC] p-3 text-sm">
                <b className="block text-xs uppercase tracking-wide text-muted">İşler</b>
                {card.items?.map((i, k) => <div key={k}>{i.name} <b>×{i.qty}</b></div>)}
                {card.teeth && Object.keys(card.teeth).length > 0 && <div className="mt-1 text-xs"><b>Dişler:</b> {Object.keys(card.teeth).sort().join(" ")}</div>}
                {card.shade && <div className="text-xs"><b>Renk:</b> {card.shade}</div>}
                {!!card.received?.length && <div className="text-xs"><b>Gelenler:</b> {card.received.join(", ")}</div>}
              </div>
              <div className="rounded-xl bg-[#F7F9FC] p-3 text-sm">
                <b className="block text-xs uppercase tracking-wide text-muted">Not / geçmiş kontrol</b>
                {card.description && <p className="whitespace-pre-wrap text-xs">{card.description}</p>}
                {card.checks?.slice(0, 4).map((c, k) => <div key={k} className={`text-xs ${c.passed ? "text-ok" : "text-bad"}`}>{c.stage === "chief" ? "1. kontrol" : "Son kontrol"}: {c.passed ? "geçti" : `kaldı${c.note ? ` — ${c.note}` : ""}`}</div>)}
              </div>
            </div>
            <div>
              <b className="text-sm">Kontrol listesi</b> <span className="text-xs text-muted">(hatalı maddeye dokunun)</span>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                {items.map((i) => (
                  <button key={i.key} type="button" onClick={() => setItems((x) => x.map((y) => (y.key === i.key ? { ...y, ok: !y.ok } : y)))}
                    className={`flex min-h-14 items-center gap-2 rounded-[12px] border-2 px-3 py-2 text-left text-sm font-semibold ${i.ok ? "border-[#86EFAC] bg-[#F0FDF4] text-[#065F46]" : "border-[#FCA5A5] bg-[#FEF2F2] text-bad"}`}>
                    <span className="text-lg">{i.ok ? "✓" : "✕"}</span>{i.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={failed.length ? "Ek açıklama (geri gönderme nedeni)" : "Not (isteğe bağlı)"} className="h-12 rounded-[10px] border border-[#D5DEE8] px-3" />
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-12 rounded-[10px] border border-[#D5DEE8] px-2 text-sm" aria-label="Geri gönderilecek kişi">
                <option value="">Geri: son çalışan teknisyen</option>
                {techs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <PhotoPicker value={pics} onChange={setPics} max={1} label="📷 Fotoğraf (isteğe bağlı)" />
            <div className="grid gap-2 md:grid-cols-2">
              <button type="button" disabled={busy || !empOk || failed.length > 0} onClick={() => decide(true)} className="h-16 rounded-[14px] bg-[#16A34A] text-lg font-bold text-white disabled:opacity-40">✓ Onayla · {NEXT[stage]}</button>
              <button type="button" disabled={busy || !empOk} onClick={() => decide(false)} className="h-16 rounded-[14px] bg-bad text-lg font-bold text-white disabled:opacity-40">↩ Geri gönder{failed.length ? ` (${failed.length} hata)` : ""}</button>
            </div>
            <button type="button" onClick={reset} className="self-start text-sm font-semibold text-muted">Vazgeç</button>
          </section>
        )}
        {!card && <Notice tone="info">İşi okuttuğunuzda kartı ve kontrol listesi açılır. Onaylanan iş {stage === "chief" ? "son kontrole" : "paketleme / çıkışa"} geçer; geri gönderilen iş nedenle birlikte teknisyene döner.</Notice>}
      </div>

      <aside className="flex flex-col gap-4 self-start">
        <section className="rounded-[16px] border border-line bg-white">
          <h3 className="border-b border-line px-4 py-3 font-semibold">Bu aşamadaki işler ({queue.length})</h3>
          <ul className="max-h-[50vh] divide-y divide-[#EEF2F6] overflow-y-auto text-sm">
            {queue.map((j) => (
              <li key={j.id}><button type="button" onClick={() => open(String(j.no))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F7F9FC]">
                <b className="w-16 font-mono text-brand-700">#{j.no}</b>
                <span className="min-w-0 flex-1 truncate">{j.patient ?? "—"}<span className="block truncate text-xs text-muted">{j.customer ?? ""}{j.holder ? ` · ${j.holder}` : " · bekliyor"}</span></span>
                <span className="text-right text-xs"><span className="block text-muted">{since(j.since)}</span>{j.due && <span className={j.due < t ? "font-semibold text-bad" : "text-muted"}>{j.due.slice(5).split("-").reverse().join(".")}</span>}</span>
              </button></li>
            ))}
            {!queue.length && <li className="px-4 py-6 text-center text-muted">Bekleyen iş yok.</li>}
          </ul>
        </section>
        {!!log.length && (
          <section className="rounded-[16px] border border-line bg-white p-4 text-sm">
            <h3 className="mb-2 font-semibold">Bu oturum</h3>
            {log.map((l, i) => <div key={i} className={l.ok ? "text-ok" : "text-bad"}><span className="text-muted">{l.t}</span> {l.text}</div>)}
          </section>
        )}
      </aside>
    </div>
  );
}
