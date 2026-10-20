"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOutsourceMail, relinkOutsourceLines, saveOutsourcePrices, setOutsourceAlias, toggleOutsourceDispute, uploadOutsourceStatements } from "@/lib/outsource-actions";

type R = { ok: boolean; message: string; lines?: string[] };
function Msg({ m }: { m: R | null }) {
  if (!m) return null;
  return <div className={`text-sm ${m.ok ? "text-ok" : "text-bad"}`}><p className="font-semibold">{m.message}</p>{m.lines?.length ? <ul className="text-xs text-[#33414F] grid gap-0.5 mt-1">{m.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}</div>;
}

export function StatementTools({ party, email }: { party: string; email: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<R | null>(null);
  async function go(k: string, fn: () => Promise<R>) { setBusy(k); setMsg(null); try { setMsg(await fn()); } catch (e) { setMsg({ ok: false, message: String(e) }); } setBusy(null); router.refresh(); }
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("party", party); void go("up", () => uploadOutsourceStatements(fd)); e.currentTarget.reset(); }}>
        <label className="flex flex-col gap-1 text-sm font-semibold flex-1 min-w-[260px]">Ekstre PDF&apos;leri<input type="file" name="files" multiple accept=".pdf" className="text-sm font-normal" /><span className="text-xs font-normal text-muted">Laboratuvarın toplu fiş / ekstre PDF&apos;i. Aynı satır ikinci kez yüklenirse atlanır.</span></label>
        <button disabled={!!busy} className="h-11 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy === "up" ? "Okunuyor…" : "Yükle"}</button>
        <button type="button" disabled={!!busy} onClick={() => go("mail", () => fetchOutsourceMail(party))} title={email ? `${email} adresinden gelenler` : "Önce bir ekstre yükleyin"} className="h-11 px-4 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-50">{busy === "mail" ? "E-postalar taranıyor…" : "E-postadan çek"}</button>
        <button type="button" disabled={!!busy} onClick={() => go("re", () => relinkOutsourceLines(party))} className="h-11 px-4 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold disabled:opacity-50">{busy === "re" ? "…" : "Yeniden eşleştir"}</button>
      </form>
      {email && <p className="text-xs text-muted">E-postadan çek: bağlı Gmail hesabında <b>{email}</b> adresinden 01.01.2026&apos;dan bu yana gelen PDF ekleri okunur.</p>}
      <Msg m={msg} />
    </section>
  );
}

export function AliasSelect({ party, product, prices, value, confirmed }: { party: string; product: string; prices: { id: string; name: string }[]; value: string; confirmed: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const save = async (id: string) => { setBusy(true); await setOutsourceAlias(party, product, id); setBusy(false); router.refresh(); };
  if (!prices.length) return <span className="text-xs text-muted">fiyat listesi yok</span>;
  return (
    <span className="flex items-center gap-1">
      <select value={v} disabled={busy} onChange={(e) => { setV(e.target.value); void save(e.target.value); }} className={`h-8 max-w-[230px] rounded-[8px] border px-1 text-xs ${confirmed ? "border-[#D5DEE8]" : "border-dashed border-[#F2B84B] text-muted italic"}`}>
        <option value="">— seçin —</option>
        {prices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {!confirmed && v && <button type="button" disabled={busy} onClick={() => save(v)} className="text-xs font-semibold text-brand-700">Onayla</button>}
    </span>
  );
}

export function DisputeBox({ id, disputed, note }: { id: string; disputed: boolean; note: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <label className="flex items-center gap-1 text-xs" title={note}><input type="checkbox" checked={disputed} disabled={busy} onChange={async (e) => { setBusy(true); await toggleOutsourceDispute(id, e.target.checked, note); setBusy(false); router.refresh(); }} />itiraz</label>;
}

export function PriceListForm({ party, initial, saved }: { party: string; initial: string; saved: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<R | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {!saved && <p className="text-xs text-warn font-semibold">Gönderdiğiniz 2026 fiyat listesi (fotoğraftan) hazır yazıldı; kontrol edip Kaydet&apos;e basın.</p>}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="rounded-[10px] border border-[#D5DEE8] p-3 text-xs font-mono leading-relaxed" />
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setMsg(await saveOutsourcePrices(party, text)); setBusy(false); router.refresh(); }} className="h-10 px-5 rounded-[10px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "…" : "Fiyat listesini kaydet"}</button>
        <span className="text-xs text-muted">Her satır: ÜRÜN ADI; FİYAT (TL)</span>
      </div>
      <Msg m={msg} />
    </div>
  );
}
