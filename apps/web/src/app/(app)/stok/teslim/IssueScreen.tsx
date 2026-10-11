"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useActionForm } from "@/lib/use-action-form";
import { ScanInput, scanFeedback } from "@/components/ScanInput";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/erp";
import { issueDirect, itemLookup, openRequestsFor, type OpenReq } from "@/lib/barcode-actions";

type Person = { id: string; name: string; department: string | null; open_requests: number };
type L = { key: string; line_id?: string; item_id: string | null; name: string; unit: string; want?: number; qty: number; on_hand?: number };
const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** Personele okutarak malzeme teslimi: personel seç → (varsa isteği seç) → okut → iki imza → tutanak */
export function IssueScreen({ people, warehouses, signer }: { people: Person[]; warehouses: { id: string; name: string; is_default: boolean }[]; signer: string }) {
  const [q, setQ] = useState("");
  const [emp, setEmp] = useState<Person | null>(null);
  const [reqs, setReqs] = useState<OpenReq[] | null>(null);
  const [req, setReq] = useState<OpenReq | null>(null);
  const [lines, setLines] = useState<L[]>([]);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const wpad = useRef<SignaturePadHandle>(null);
  const epad = useRef<SignaturePadHandle>(null);
  const { state, pending, formProps } = useActionForm(issueDirect, {
    prepare: (fd) => {
      fd.set("employee", emp?.id ?? "");
      if (req) fd.set("request_id", req.id);
      fd.set("lines", JSON.stringify(req ? lines.filter((l) => l.line_id && l.qty > 0).map((l) => ({ line_id: l.line_id, qty: l.qty })) : lines.filter((l) => l.qty > 0).map((l) => ({ item_id: l.item_id, name: l.name, unit: l.unit, qty: l.qty }))));
      fd.set("sig_warehouse", wpad.current?.toDataURL() ?? "");
      fd.set("sig_employee", epad.current?.toDataURL() ?? "");
    },
    onSuccess: (st) => setDone(st.id ?? ""),
  });
  const hits = useMemo(() => { const k = q.trim().toLocaleLowerCase("tr"); return (k ? people.filter((p) => `${p.name} ${p.department ?? ""}`.toLocaleLowerCase("tr").includes(k)) : people).slice(0, 12); }, [q, people]);

  const pick = (p: Person) => start(async () => { setEmp(p); setReq(null); setLines([]); setLast(null); setReqs(await openRequestsFor(p.id)); });
  const chooseReq = (r: OpenReq | null) => { setReq(r); setLast(null); setLines(r ? r.lines.filter((l) => l.qty > l.issued_qty).map((l) => ({ key: l.id, line_id: l.id, item_id: l.item_id, name: l.name, unit: l.unit, want: l.qty - l.issued_qty, qty: 0 })) : []); };
  const scan = (code: string) => start(async () => {
    const h = await itemLookup(code);
    if (!h.ok || !h.id) { scanFeedback(false); setLast({ ok: false, text: h.message ?? "Bulunamadı" }); return; }
    if (req) {
      const target = lines.find((l) => l.item_id === h.id && l.qty < (l.want ?? Infinity)) ?? lines.find((l) => l.item_id === h.id);
      if (!target) { scanFeedback(false); setLast({ ok: false, text: `${h.name} bu istekte yok.` }); return; }
      const nq = target.qty + 1;
      scanFeedback(nq <= (target.want ?? nq));
      setLast({ ok: nq <= (target.want ?? nq), text: `${h.name}: ${fmt(nq)} / ${fmt(target.want ?? nq)} ${target.unit}${nq > (target.want ?? nq) ? " · istenenden fazla!" : ""}` });
      setLines((x) => x.map((l) => (l.key === target.key ? { ...l, qty: nq } : l)));
    } else {
      scanFeedback(true);
      setLines((x) => {
        const ex = x.find((l) => l.item_id === h.id);
        const nq = (ex?.qty ?? 0) + 1;
        setLast({ ok: nq <= (h.on_hand ?? nq), text: `${h.name}: ${fmt(nq)} ${h.unit}${nq > (h.on_hand ?? nq) ? ` · depoda ${fmt(h.on_hand ?? 0)} var!` : ""}` });
        return ex ? x.map((l) => (l === ex ? { ...l, qty: nq } : l)) : [{ key: h.id!, item_id: h.id!, name: h.name!, unit: h.unit!, qty: 1, on_hand: h.on_hand }, ...x];
      });
    }
  });

  if (done !== null) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[16px] border-2 border-[#22C55E]/50 bg-white p-8 text-center">
        <span className="text-5xl">✅</span><b className="text-xl">Teslim tamamlandı</b><p className="text-muted">{emp?.name} · iki imzalı teslim tutanağı kaydedildi, malzemeler stoktan düştü.</p>
        <div className="flex gap-2">{done && <Link href={`/yazdir/malzeme/${done}`} target="_blank" className={btnSecondary}>Tutanağı yazdır</Link>}<button type="button" onClick={() => { setDone(null); setEmp(null); setReq(null); setLines([]); setReqs(null); setQ(""); }} className={btnPrimary}>Yeni teslim</button></div>
      </div>
    );
  }
  if (!emp) {
    return (
      <section className="flex flex-col gap-3 rounded-[16px] border border-line bg-white p-4">
        <h2 className="font-display text-lg font-bold">1 · Personeli seçin</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Ad ya da bölüm…" className={inputCls} />
        <ul className="grid gap-2 sm:grid-cols-2">
          {hits.map((p) => (
            <li key={p.id}><button type="button" onClick={() => pick(p)} className="flex w-full items-center gap-3 rounded-[12px] border border-line px-3 py-3 text-left hover:border-brand-600">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#EAF2FB] font-bold text-brand-700">{p.name.slice(0, 1)}</span>
              <span className="flex-1"><b>{p.name}</b><span className="block text-xs text-muted">{p.department ?? ""}</span></span>
              {p.open_requests > 0 && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">{p.open_requests} açık istek</span>}
            </button></li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-white p-4">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-700 font-bold text-white">{emp.name.slice(0, 1)}</span>
        <span className="flex-1"><b className="text-lg">{emp.name}</b><span className="block text-xs text-muted">{emp.department ?? ""}</span></span>
        <button type="button" onClick={() => { setEmp(null); setReqs(null); }} className="text-sm font-semibold text-brand-700">Değiştir</button>
        {reqs && reqs.length > 0 && (
          <div className="flex w-full flex-wrap gap-1.5">
            <button type="button" onClick={() => chooseReq(null)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${!req ? "border-brand-700 bg-brand-700 text-white" : "border-line"}`}>İsteksiz teslim</button>
            {reqs.map((r) => <button key={r.id} type="button" onClick={() => chooseReq(r)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${req?.id === r.id ? "border-brand-700 bg-brand-700 text-white" : "border-line"}`}>{r.no} · {r.lines.length} kalem</button>)}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3 rounded-[16px] border border-line bg-white p-4">
        <ScanInput onCode={scan} busy={busy} placeholder="Teslim edilen ürünü okutun" />
        {last && <div className={`rounded-xl px-4 py-3 text-base font-semibold ${last.ok ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-bad"}`}>{last.ok ? "✓ " : "⚠ "}{last.text}</div>}
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.key} className={`flex flex-wrap items-center gap-3 rounded-[12px] border-2 p-3 ${l.want != null ? (l.qty === l.want ? "border-[#86EFAC] bg-[#F0FDF4]" : l.qty > l.want ? "border-[#FCD34D] bg-[#FFFBEB]" : "border-line") : "border-line"}`}>
              <span className="min-w-[160px] flex-1"><b>{l.name}</b><span className="block text-xs text-muted">{l.want != null ? `istenen ${fmt(l.want)} ${l.unit}` : l.on_hand != null ? `depoda ${fmt(l.on_hand)}` : ""}{!l.item_id ? " · stok kartı yok" : ""}</span></span>
              <button type="button" onClick={() => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, qty: Math.max(0, y.qty - 1) } : y)))} className="h-10 w-10 rounded-[10px] border border-line text-lg font-bold">−</button>
              <b className="w-16 text-center text-lg num">{fmt(l.qty)}</b>
              <button type="button" onClick={() => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, qty: y.qty + 1 } : y)))} className="h-10 w-10 rounded-[10px] border border-line text-lg font-bold">+</button>
              <span className="text-xs text-muted w-10">{l.unit}</span>
              {l.want == null && <button type="button" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} className="text-xs font-semibold text-bad">Kaldır</button>}
            </li>
          ))}
          {!lines.length && <li className="rounded-[12px] border border-dashed border-[#C5D0DB] p-5 text-center text-sm text-muted">Ürünleri okutun.</li>}
        </ul>
      </section>
      <form {...formProps} className="flex flex-col gap-4 rounded-[16px] border-2 border-[#22C55E]/40 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Çıkış deposu"><select name="warehouse" defaultValue={warehouses.find((w) => w.is_default)?.id} className={selectCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Teslim eden"><input name="signer" defaultValue={signer} maxLength={160} className={inputCls} /></Field>
        </div>
        {!req && <Field label="Not" hint="isteğe bağlı"><input name="note" maxLength={500} placeholder="ör. Haftalık sarf" className={inputCls} /></Field>}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Depo sorumlusu imzası</span><SignaturePad ref={wpad} /><button type="button" onClick={() => wpad.current?.clear()} className="self-start text-xs font-semibold text-muted">İmzayı sil</button></div>
          <div className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Teslim alan: {emp.name}</span><SignaturePad ref={epad} /><button type="button" onClick={() => epad.current?.clear()} className="self-start text-xs font-semibold text-muted">İmzayı sil</button></div>
        </div>
        {state && !state.ok && <Notice tone="bad">{state.message}</Notice>}
        <div><button disabled={pending || !lines.some((l) => l.qty > 0)} className={btnPrimary}>{pending ? "Kaydediliyor…" : `Teslim et ve imzalat (${lines.filter((l) => l.qty > 0).length} kalem)`}</button></div>
      </form>
    </div>
  );
}
