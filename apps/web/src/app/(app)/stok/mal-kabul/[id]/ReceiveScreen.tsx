"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { ScanInput, scanFeedback } from "@/components/ScanInput";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Field, Notice, btnPrimary, btnSecondary, inputCls } from "@/components/erp";
import { rcvConfirm, rcvFree, rcvLine, rcvRemove, rcvScan } from "@/lib/barcode-actions";

export type RLine = { id: string; name: string; unit: string; expected: number; qty: number; damaged: number; lot_no: string | null; expiry_date: string | null; note: string | null; item_id: string | null; po_line_id: string | null; track_lot: boolean; track_expiry: boolean; code: string | null };
const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** Mal kabul okutma ekranı: okut → adet artar; eksik / fazla / beklenmeyen renkli; sonunda "stoğa eklensin mi?" + imza */
export function ReceiveScreen({ id, lines: initial, signer }: { id: string; lines: RLine[]; signer: string }) {
  const router = useRouter();
  const [lines, setLines] = useState(initial);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [mult, setMult] = useState(1);
  const [free, setFree] = useState({ name: "", qty: "1", unit: "adet" });
  const [choice, setChoice] = useState<"" | "yes" | "no">("");
  const pad = useRef<SignaturePadHandle>(null);
  const { state, pending, formProps } = useActionForm(rcvConfirm, { prepare: (fd) => { fd.set("signature", pad.current?.toDataURL() ?? ""); fd.set("add_stock", choice); }, onSuccess: () => router.refresh() });
  const [prev, setPrev] = useState(initial);
  if (initial !== prev) { setPrev(initial); setLines(initial); }

  const scan = (code: string) => start(async () => {
    const r = await rcvScan(id, code, mult);
    scanFeedback(r.ok && !r.unexpected);
    if (!r.ok) { setLast({ ok: false, text: r.message ?? "Okunamadı" }); return; }
    setLast({ ok: !r.unexpected, text: `${r.name}: ${fmt(r.qty ?? 0)}${r.expected ? ` / ${fmt(r.expected)}` : ""} ${r.unit}${r.unexpected ? " · siparişte yok (fazla)" : r.expected && (r.qty ?? 0) > r.expected ? " · beklenenden fazla!" : ""}` });
    setLines((x) => (x.some((l) => l.id === r.line) ? x.map((l) => (l.id === r.line ? { ...l, qty: r.qty ?? l.qty } : l)) : x));
    setMult(1);
    router.refresh();
  });
  const patch = (l: RLine, p: Partial<RLine>) => {
    setLines((x) => x.map((y) => (y.id === l.id ? { ...y, ...p } : y)));
    start(async () => {
      const r = await rcvLine(l.id, { qty: p.qty, damaged: p.damaged, ...(p.lot_no !== undefined ? { lot_no: p.lot_no ?? "" } : {}), ...(p.expiry_date !== undefined ? { expiry_date: p.expiry_date ?? "" } : {}) });
      if (!r.ok) setLast({ ok: false, text: r.message });
    });
  };
  const exp = lines.reduce((n, l) => n + l.expected, 0);
  const got = lines.reduce((n, l) => n + l.qty, 0);
  const missing = lines.filter((l) => l.expected > 0 && l.qty < l.expected).length;
  const extra = lines.filter((l) => l.qty > l.expected && l.expected > 0).length;
  const unexpected = lines.filter((l) => l.expected === 0 && l.qty > 0).length;
  const dmg = lines.reduce((n, l) => n + l.damaged, 0);

  return (
    <div className="flex flex-col gap-4">
      <section className="sticky top-0 z-10 flex flex-col gap-3 rounded-[16px] border border-line bg-white/95 p-4 shadow-sm backdrop-blur">
        <ScanInput onCode={scan} busy={busy} placeholder="Ürün barkodunu okutun" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Okutma çarpanı:</span>
          {[1, 5, 10, 12, 24].map((m) => <button key={m} type="button" onClick={() => setMult(m)} className={`rounded-md px-2.5 py-1 font-semibold ${mult === m ? "bg-ink text-white" : "bg-[#EEF2F6]"}`}>×{m}</button>)}
          <span className="text-xs text-muted">(koli içi adedi için; bir sonraki okutmada uygulanır)</span>
        </div>
        {last && <div className={`rounded-xl px-4 py-3 text-base font-semibold ${last.ok ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-bad"}`}>{last.ok ? "✓ " : "⚠ "}{last.text}</div>}
        <div>
          {exp > 0 && <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EEF2F6]"><div className={`h-full rounded-full ${got > exp ? "bg-warn" : "bg-[#22C55E]"}`} style={{ width: `${Math.min(100, (got / exp) * 100)}%` }} /></div>}
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-sm"><span><b>{fmt(got)}</b>{exp ? ` / ${fmt(exp)}` : ""} adet</span>{!!missing && <span className="text-bad">{missing} eksik kalem</span>}{!!extra && <span className="text-warn">{extra} fazla</span>}{!!unexpected && <span className="text-[#6D28D9]">{unexpected} siparişte yok</span>}{!!dmg && <span className="text-bad">{fmt(dmg)} hasarlı</span>}</p>
        </div>
      </section>

      <ul className="flex flex-col gap-2">
        {lines.map((l) => {
          const tone = l.expected === 0 ? "border-[#C4B5FD] bg-[#FAF5FF]" : l.qty === l.expected ? "border-[#86EFAC] bg-[#F0FDF4]" : l.qty > l.expected ? "border-[#FCD34D] bg-[#FFFBEB]" : l.qty > 0 ? "border-[#BFDBFE] bg-white" : "border-line bg-white";
          return (
            <li key={l.id} className={`rounded-[14px] border-2 p-3 ${tone}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[180px] flex-1"><b>{l.name}</b><span className="block text-xs text-muted">{[l.code, l.expected === 0 ? "siparişte yok" : `beklenen ${fmt(l.expected)} ${l.unit}`, !l.item_id ? "stok kartı yok (stoğa girmez)" : null].filter(Boolean).join(" · ")}</span></div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => patch(l, { qty: Math.max(0, l.qty - 1) })} className="h-11 w-11 rounded-[10px] border border-line bg-white text-lg font-bold" aria-label="Azalt">−</button>
                  <input inputMode="decimal" value={fmt(l.qty)} onChange={(e) => { const n = Number(e.target.value.replace(/\./g, "").replace(",", ".")); if (Number.isFinite(n) && n >= 0) setLines((x) => x.map((y) => (y.id === l.id ? { ...y, qty: n } : y))); }}
                    onBlur={(e) => { const n = Number(e.target.value.replace(/\./g, "").replace(",", ".")); if (Number.isFinite(n) && n >= 0) patch(l, { qty: n }); }} className="h-11 w-20 rounded-[10px] border border-line bg-white text-center text-lg font-bold num" aria-label="Gelen adet" />
                  <button type="button" onClick={() => patch(l, { qty: l.qty + 1 })} className="h-11 w-11 rounded-[10px] border border-line bg-white text-lg font-bold" aria-label="Artır">+</button>
                  <span className="w-10 text-xs text-muted">{l.unit}</span>
                </div>
                <label className="flex items-center gap-1 text-xs text-muted">Hasarlı
                  <input inputMode="decimal" defaultValue={l.damaged ? fmt(l.damaged) : ""} onBlur={(e) => { const n = Number(e.target.value.replace(",", ".") || 0); if (Number.isFinite(n) && n !== l.damaged) patch(l, { damaged: n }); }} className="h-9 w-16 rounded-lg border border-line bg-white text-center num" />
                </label>
                <button type="button" onClick={() => start(async () => { await rcvRemove(l.id); router.refresh(); })} className="text-xs font-semibold text-bad" aria-label="Satırı kaldır">{l.po_line_id ? "Sıfırla" : "Kaldır"}</button>
              </div>
              {(l.track_lot || l.track_expiry || l.lot_no || l.expiry_date) && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {(l.track_lot || l.lot_no) && <label className="flex items-center gap-1">Lot<input defaultValue={l.lot_no ?? ""} onBlur={(e) => { if (e.target.value !== (l.lot_no ?? "")) patch(l, { lot_no: e.target.value }); }} className="h-9 w-32 rounded-lg border border-line bg-white px-2" /></label>}
                  {(l.track_expiry || l.expiry_date) && <label className="flex items-center gap-1">SKT<input type="date" defaultValue={l.expiry_date ?? ""} onBlur={(e) => { if (e.target.value !== (l.expiry_date ?? "")) patch(l, { expiry_date: e.target.value }); }} className="h-9 rounded-lg border border-line bg-white px-2" /></label>}
                </div>
              )}
            </li>
          );
        })}
        {!lines.length && <li className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Ürünleri okutmaya başlayın.</li>}
      </ul>

      <details className="rounded-[14px] border border-line bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">+ Barkodu olmayan kalem ekle</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_100px_100px_auto]">
          <input value={free.name} onChange={(e) => setFree({ ...free, name: e.target.value })} placeholder="Ürün adı" className={inputCls} />
          <input value={free.qty} onChange={(e) => setFree({ ...free, qty: e.target.value })} inputMode="decimal" className={`${inputCls} num`} />
          <input value={free.unit} onChange={(e) => setFree({ ...free, unit: e.target.value })} className={inputCls} />
          <button type="button" disabled={!free.name.trim()} onClick={() => start(async () => { const r = await rcvFree(id, free.name, Number(free.qty.replace(",", ".")) || 1, free.unit); if (!r.ok) setLast({ ok: false, text: r.message }); else { setFree({ name: "", qty: "1", unit: "adet" }); router.refresh(); } })} className={btnSecondary}>Ekle</button>
        </div>
      </details>

      <form {...formProps} className="flex flex-col gap-4 rounded-[16px] border-2 border-[#22C55E]/40 bg-white p-4 md:p-5">
        <input type="hidden" name="id" value={id} />
        <h2 className="font-display text-lg font-bold">Teyit et</h2>
        <div className="flex flex-col gap-2">
          <span className="font-semibold">Bu mallar stoğa eklensin mi?</span>
          <div className="grid gap-2 md:grid-cols-2">
            <button type="button" onClick={() => setChoice("no")} className={`rounded-[14px] border-2 p-4 text-left ${choice === "no" ? "border-brand-700 bg-[#EAF2FB]" : "border-line"}`}>
              <b className="block">🧾 Hayır · faturalı geliyor</b><span className="text-sm text-muted">E-fatura içe aktarılınca stoğa girer (çift giriş olmaz). Mal kabul faturayla eşleştirilir.</span>
            </button>
            <button type="button" onClick={() => setChoice("yes")} className={`rounded-[14px] border-2 p-4 text-left ${choice === "yes" ? "border-[#16A34A] bg-[#F0FDF4]" : "border-line"}`}>
              <b className="block">📦 Evet · faturasız</b><span className="text-sm text-muted">Okutulan adetler (hasarlılar hariç) şimdi stoğa girer.</span>
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Teslim alan"><input name="signer" defaultValue={signer} maxLength={160} className={inputCls} /></Field>
          <Field label="Not" hint="isteğe bağlı"><input name="note" maxLength={500} className={inputCls} /></Field>
        </div>
        <div className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Teslim alan imzası</span><SignaturePad ref={pad} /><button type="button" onClick={() => pad.current?.clear()} className="self-start text-xs font-semibold text-muted">İmzayı sil</button></div>
        {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
        <div><button disabled={pending || !choice} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Mal kabulü onayla"}</button></div>
      </form>
    </div>
  );
}
