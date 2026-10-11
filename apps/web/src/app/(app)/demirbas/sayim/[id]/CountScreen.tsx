"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { ScanInput, scanFeedback } from "@/components/ScanInput";
import { Notice, btnPrimary, inputCls } from "@/components/erp";
import { COND } from "@/lib/barcode";
import { countClose, countMark, countScan } from "@/lib/barcode-actions";

export type CItem = { id: string; asset_id: string; expected: boolean; expected_location: string | null; found_at: string | null; found_location: string | null; condition: string | null; note: string | null; name: string; code: string | null; serial_no: string | null; category: string };
const TABS = [["bekleyen", "Bekleyen"], ["bulunan", "Bulunan"], ["fazla", "Fazla"], ["yer", "Yer değişen"], ["ariza", "Hasarlı / arızalı"]] as const;

/** Canlı demirbaş sayım ekranı: konumu seç, okut; ilerleme ve eksik / fazla listeleri */
export function CountScreen({ id, items: initial, open, canClose, locations }: { id: string; items: CItem[]; open: boolean; canClose: boolean; locations: string[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [prev, setPrev] = useState(initial);
  if (initial !== prev) { setPrev(initial); setItems(initial); }
  const [loc, setLoc] = useState("");
  const [cond, setCond] = useState<"ok" | "damaged" | "broken">("ok");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("bekleyen");
  const [q, setQ] = useState("");
  const [last, setLast] = useState<{ tone: "ok" | "warn" | "bad" | "info"; text: string } | null>(null);
  const [busy, start] = useTransition();
  const { state, pending, formProps } = useActionForm(countClose, { onSuccess: () => router.refresh() });

  const exp = items.filter((i) => i.expected);
  const found = exp.filter((i) => i.found_at);
  const extra = items.filter((i) => !i.expected);
  const moved = items.filter((i) => i.found_at && i.found_location && i.expected_location && i.found_location !== i.expected_location);
  const bad = items.filter((i) => i.condition && i.condition !== "ok");
  const list = useMemo(() => {
    const base = tab === "bekleyen" ? exp.filter((i) => !i.found_at) : tab === "bulunan" ? items.filter((i) => i.found_at) : tab === "fazla" ? extra : tab === "yer" ? moved : bad;
    const k = q.trim().toLocaleLowerCase("tr");
    return k ? base.filter((i) => `${i.name} ${i.code ?? ""} ${i.serial_no ?? ""} ${i.expected_location ?? ""}`.toLocaleLowerCase("tr").includes(k)) : base;
  }, [tab, q, items, exp, extra, moved, bad]);

  const scan = (code: string) => start(async () => {
    const r = await countScan(id, code, loc, cond);
    if (!r.ok) { scanFeedback(false); setLast({ tone: "bad", text: r.message ?? "Okunamadı" }); return; }
    scanFeedback(r.expected !== false && !r.duplicate);
    setLast({
      tone: r.duplicate ? "info" : r.expected ? (r.moved ? "warn" : "ok") : "warn",
      text: `${r.name}${r.code ? ` · ${r.code}` : ""}${r.duplicate ? " · zaten sayıldı" : r.expected ? "" : " · sayım kapsamında değil (fazla)"}${r.moved ? ` · yeri değişmiş: ${r.expected_location} → ${r.location}` : ""}`,
    });
    router.refresh();
  });
  const mark = (i: CItem, f: boolean) => start(async () => {
    setItems((x) => x.map((y) => (y.id === i.id ? { ...y, found_at: f ? new Date().toISOString() : null, found_location: f ? loc || y.expected_location : null, condition: f ? cond : null } : y)));
    const r = await countMark(i.id, f, { location: loc || undefined, condition: cond });
    if (!r.ok) setLast({ tone: "bad", text: r.message });
    router.refresh();
  });
  const pct = exp.length ? Math.round((found.length / exp.length) * 100) : 0;
  const toneCls = { ok: "bg-[#ECFDF5] text-[#065F46]", warn: "bg-[#FFFBEB] text-[#92400E]", bad: "bg-[#FEF2F2] text-bad", info: "bg-[#EFF6FF] text-brand-700" };

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 md:grid-cols-[180px_1fr]">
        <div className="grid place-items-center rounded-[16px] border border-line bg-white p-4">
          <div className="relative h-32 w-32">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#EEF2F6" strokeWidth="3.2" /><circle cx="18" cy="18" r="15.9" fill="none" stroke="#22C55E" strokeWidth="3.2" strokeDasharray={`${pct} 100`} strokeLinecap="round" /></svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center"><b className="text-2xl leading-none">{pct}%</b><span className="mt-1 text-xs text-muted">{found.length}/{exp.length}</span></span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[["Bulunan", found.length, "text-ok"], ["Bekleyen", exp.length - found.length, exp.length - found.length ? "text-bad" : "text-ok"], ["Fazla", extra.length, "text-[#6D28D9]"], ["Yer değişen", moved.length, "text-warn"]].map(([l, v, c]) => (
            <div key={l as string} className="rounded-[14px] border border-line bg-white p-3"><span className="text-xs text-muted">{l}</span><b className={`block text-2xl ${c}`}>{v as number}</b></div>
          ))}
        </div>
      </section>

      {open && (
        <section className="sticky top-0 z-10 flex flex-col gap-3 rounded-[16px] border border-line bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <label className="flex items-center gap-2 text-sm font-semibold">📍 Şu an buradayım
              <input value={loc} onChange={(e) => setLoc(e.target.value)} list="count-locs" placeholder="konum (boş = kayıtlı yeri)" className={`${inputCls} flex-1`} />
              <datalist id="count-locs">{locations.map((l) => <option key={l} value={l} />)}</datalist>
            </label>
            <div className="flex gap-1">{(["ok", "damaged", "broken"] as const).map((c) => <button key={c} type="button" onClick={() => setCond(c)} className={`h-11 rounded-[10px] px-3 text-sm font-semibold border ${cond === c ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>{COND[c]![0]}</button>)}</div>
          </div>
          <ScanInput onCode={scan} busy={busy} placeholder="Demirbaş QR / barkod / kodunu okutun" />
          {last && <div className={`rounded-xl px-4 py-3 text-base font-semibold ${toneCls[last.tone]}`}>{last.text}</div>}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {TABS.map(([k, l]) => {
              const n = k === "bekleyen" ? exp.length - found.length : k === "bulunan" ? items.filter((i) => i.found_at).length : k === "fazla" ? extra.length : k === "yer" ? moved.length : bad.length;
              return <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full border px-3 py-1.5 font-semibold ${tab === k ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white"}`}>{l} <span className="opacity-70">{n}</span></button>;
            })}
          </nav>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Listede ara…" className="h-10 flex-1 min-w-[160px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
        </div>
        <ul className="flex flex-col divide-y divide-[#EEF2F6] overflow-hidden rounded-[14px] border border-line bg-white">
          {list.slice(0, 400).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${i.found_at ? (i.expected ? "bg-[#22C55E]" : "bg-[#A78BFA]") : "bg-[#F87171]"}`} />
              <span className="flex-1 min-w-[180px]"><b>{i.name}</b><span className="block text-xs text-muted">{[i.code, i.serial_no, i.found_location && i.found_location !== i.expected_location ? `${i.expected_location ?? "—"} → ${i.found_location}` : i.expected_location].filter(Boolean).join(" · ")}</span></span>
              {i.condition && i.condition !== "ok" && <span className={`text-xs font-semibold ${COND[i.condition]![1]}`}>{COND[i.condition]![0]}</span>}
              {open && (i.found_at ? <button type="button" onClick={() => mark(i, false)} className="text-xs font-semibold text-muted hover:text-bad">Geri al</button>
                : <button type="button" onClick={() => mark(i, true)} className="h-9 rounded-[10px] border border-line px-3 text-xs font-semibold hover:border-[#22C55E]">✓ Buldum</button>)}
            </li>
          ))}
          {!list.length && <li className="p-5 text-center text-sm text-muted">Bu listede demirbaş yok.</li>}
        </ul>
      </section>

      {open && canClose && (
        <form {...formProps} className="flex flex-col gap-3 rounded-[16px] border-2 border-[#22C55E]/40 bg-white p-4">
          <input type="hidden" name="id" value={id} />
          <h2 className="font-display text-lg font-bold">Sayımı bitir</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="apply" defaultChecked className="h-4 w-4" />Sonuçları demirbaş kartlarına işle (bulunan yerler güncellenir, arızalılar “bakımda” olur)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lost" className="h-4 w-4" />Bulunamayan {exp.length - found.length} demirbaşı “kayıp” işaretle</label>
          {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
          <div><button disabled={pending} className={btnPrimary}>{pending ? "Kapatılıyor…" : "Sayımı kapat"}</button></div>
        </form>
      )}
    </div>
  );
}
