"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { buyListDone, buyPick, createBuyList } from "@/lib/material-actions";

export type BuyLine = { id: string; name: string; qty: number; unit: string; note: string | null; vendor: string | null; est_price: number | null; paid_price: number | null; picked_at: string | null; request_no: string; request_id: string; requester: string };
export type BuyListData = { id: string; no: string; status: string; planned_on: string | null; note: string | null; courier: string | null; created_by: string; created_at: string; done_at: string | null; lines: BuyLine[] };
const tl = (k: number | null) => (k == null ? "" : (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Alım listesi: tedarikçiye göre gruplu; kurye kalem kalem "aldım" işaretler, ödediği tutarı yazar, listeyi bitirir */
export function BuyListView({ list, canEdit }: { list: BuyListData; canEdit: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [paid, setPaid] = useState<Record<string, string>>(() => Object.fromEntries(list.lines.map((l) => [l.id, tl(l.paid_price)])));
  const [err, setErr] = useState("");
  const { state, pending, formProps } = useActionForm(buyListDone, { onSuccess: () => router.refresh() });
  const open = list.status === "open" && canEdit;
  const groups = new Map<string, BuyLine[]>();
  for (const l of list.lines) groups.set(l.vendor || "Tedarikçi belirtilmedi", [...(groups.get(l.vendor || "Tedarikçi belirtilmedi") ?? []), l]);
  const picked = list.lines.filter((l) => l.picked_at).length;
  const total = list.lines.reduce((n, l) => n + (l.paid_price ?? 0), 0);
  const toggle = (l: BuyLine, v: boolean) => start(async () => {
    setErr("");
    const r = await buyPick(l.id, v, paid[l.id], list.id);
    if (!r.ok) setErr(r.message); else router.refresh();
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-white border border-line p-4">
        <div className="flex-1 min-w-[200px]">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EEF2F6]"><div className="h-full rounded-full bg-[#22C55E] transition-all" style={{ width: `${list.lines.length ? (picked / list.lines.length) * 100 : 0}%` }} /></div>
          <p className="mt-1.5 text-sm"><b>{picked}</b> / {list.lines.length} kalem alındı{total ? ` · ödenen ${tl(total)} TL` : ""}</p>
        </div>
        <span className="text-sm text-muted">Kurye: <b className="text-ink">{list.courier ?? "—"}</b>{list.planned_on ? ` · ${list.planned_on.split("-").reverse().join(".")}` : ""}</span>
      </div>
      {list.note && <Notice tone="info">{list.note}</Notice>}
      {err && <Notice tone="bad">{err}</Notice>}
      {[...groups.entries()].map(([vendor, lines]) => (
        <section key={vendor} className="bg-white border border-line rounded-[16px] overflow-hidden">
          <h2 className="bg-[#F7F9FC] px-4 py-2.5 font-display font-bold">🏪 {vendor} <span className="text-sm font-normal text-muted">· {lines.length} kalem</span></h2>
          <ul>
            {lines.map((l) => (
              <li key={l.id} className={`flex flex-wrap items-center gap-3 border-t border-[#EEF2F6] px-4 py-3 ${l.picked_at ? "bg-[#F0FDF4]" : ""}`}>
                <button type="button" disabled={!open || busy} onClick={() => toggle(l, !l.picked_at)} aria-label={l.picked_at ? "Alınmadı yap" : "Aldım"}
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 text-lg font-bold ${l.picked_at ? "border-[#22C55E] bg-[#22C55E] text-white" : "border-[#C5D0DB] bg-white text-transparent"} disabled:opacity-70`}>✓</button>
                <div className="min-w-0 flex-1">
                  <b className={l.picked_at ? "line-through decoration-[#22C55E]" : ""}>{l.name}</b> <span className="num font-semibold">× {Number(l.qty).toLocaleString("tr-TR")} {l.unit}</span>
                  <div className="text-xs text-muted">{l.request_no} · {l.requester}{l.note ? ` · ${l.note}` : ""}{l.est_price ? ` · tahmini ${tl(l.est_price)} TL` : ""}</div>
                </div>
                {open ? (
                  <label className="flex items-center gap-1 text-sm">
                    <input inputMode="decimal" value={paid[l.id] ?? ""} onChange={(e) => setPaid((p) => ({ ...p, [l.id]: e.target.value }))} onBlur={() => { if (l.picked_at && (paid[l.id] ?? "") !== tl(l.paid_price)) toggle(l, true); }} placeholder="Ödenen" className={`${inputCls} w-28 text-right num`} />TL
                  </label>
                ) : l.paid_price != null ? <span className="num text-sm">{tl(l.paid_price)} TL</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open && (
        <form {...formProps} className="bg-white border-2 border-[#22C55E]/40 rounded-[16px] p-4 flex flex-col gap-3">
          <input type="hidden" name="id" value={list.id} />
          <Field label="Not" hint="isteğe bağlı (alınamayanlar, fiş bilgisi…)"><input name="note" maxLength={500} className={inputCls} /></Field>
          {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Alışveriş bitti · depoya teslim ettim"}</button>
            {picked < list.lines.length && <span className="text-xs text-warn">Alınmayan {list.lines.length - picked} kalem listeden çıkar, satın alma yeniden listeleyebilir.</span>}
          </div>
        </form>
      )}
    </div>
  );
}

type Pending = { id: string; no: string; requester: string; kind: string; lines: { id: string; name: string; qty: number; unit: string; vendor: string | null; note: string | null }[] };

/** Yeni alım listesi: onaylı isteklerden seç, tedarikçi / tahmini fiyat yaz, kuryeye ata */
export function NewBuyListForm({ pending: reqs, couriers }: { pending: Pending[]; couriers: { user_id: string; name: string; logistics: boolean }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(reqs.map((r) => r.id)));
  const { state, pending, formProps } = useActionForm(createBuyList, { onSuccess: (st) => { if (st.id) router.push(`/stok/talepler/alim/${st.id}`); } });
  if (!reqs.length) return <p className="rounded-[14px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Listelenecek onaylı satın alma isteği yok. İstekler satın alma onayından sonra burada görünür.</p>;
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {reqs.map((r) => (
          <li key={r.id} className={`rounded-[14px] border p-3 ${sel.has(r.id) ? "border-brand-600 bg-[#F5F9FE]" : "border-line bg-white"}`}>
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" name="req" value={r.id} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} className="h-4 w-4" />
              <span className="num">{r.no}</span> · {r.requester} <span className="text-xs font-normal text-muted">{r.kind}</span>
            </label>
            {sel.has(r.id) && (
              <div className="mt-2 flex flex-col gap-1.5 pl-6">
                {r.lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-1 items-center gap-2 text-sm md:grid-cols-[1fr_200px_120px]">
                    <span>{l.name} × {Number(l.qty).toLocaleString("tr-TR")} {l.unit}{l.note ? <span className="text-xs text-muted"> · {l.note}</span> : null}</span>
                    <input name={`vendor_${l.id}`} defaultValue={l.vendor ?? ""} placeholder="Tedarikçi / mağaza" maxLength={120} className={inputCls} />
                    <input name={`price_${l.id}`} inputMode="decimal" placeholder="Tahmini TL" className={`${inputCls} num text-right`} />
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Kurye / alacak kişi">
          <select name="courier" className={selectCls} defaultValue={couriers.find((c) => c.logistics)?.user_id ?? ""}>
            <option value="">— Seçin —</option>
            {couriers.map((c) => <option key={c.user_id} value={c.user_id}>{c.name}{c.logistics ? " (kurye)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Alım tarihi"><input type="date" name="planned_on" defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)} className={inputCls} /></Field>
        <Field label="Not" hint="kuryeye"><textarea name="note" rows={1} maxLength={500} className={textareaCls} /></Field>
      </div>
      {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
      <div className="flex gap-2"><button disabled={pending || !sel.size} className={btnPrimary}>{pending ? "Oluşturuluyor…" : `Alım listesi çıkar (${sel.size} istek)`}</button><button type="button" onClick={() => setSel(new Set())} className={btnSecondary}>Seçimi temizle</button></div>
    </form>
  );
}
