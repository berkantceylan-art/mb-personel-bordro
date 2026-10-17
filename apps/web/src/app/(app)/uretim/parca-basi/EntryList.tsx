"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { PcEntry } from "@/lib/piecework";
import { STATUS } from "@/lib/piecework";

const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const fmtD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

function Btn({ action, children, cls, disabled }: { action: string; children: React.ReactNode; cls: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button name="action" value={action} disabled={pending || disabled} className={`h-10 px-3.5 rounded-[10px] text-sm font-semibold disabled:opacity-40 ${cls}`}>{children}</button>;
}

/** Kayıt listesi: canlı arama, durum süzme, toplu onay / red / aktarım */
export function EntryList({ rows, bulk, del, canApprove, canPost, canEnter }: { rows: PcEntry[]; bulk: (f: FormData) => Promise<void>; del: (f: FormData) => Promise<void>; canApprove: boolean; canPost: boolean; canEnter: boolean }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const shown = useMemo(() => {
    const t = norm(q.trim());
    return rows.filter((r) => (!st || r.status === st) && (!kind || r.kind === kind) && (!t || norm(`${r.worker} ${r.product ?? ""} ${r.work_name} ${r.job_no ?? ""} ${r.note ?? ""}`).includes(t)));
  }, [rows, q, st, kind]);
  const selRows = shown.filter((r) => sel.has(r.id));
  const selSum = selRows.reduce((t, r) => t + r.amount, 0);
  const has = (s: PcEntry["status"]) => selRows.some((r) => r.status === s);
  const allOn = shown.length > 0 && shown.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const chip = (v: string, label: string, n?: number) => (
    <button type="button" onClick={() => setSt(v)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${st === v ? "bg-brand-700 text-white border-brand-700" : "bg-white text-[#33414F] border-[#D5DEE8]"}`}>
      {label}{n != null && <span className="num ml-1.5 opacity-70">{n}</span>}
    </button>
  );

  return (
    <form action={bulk} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chip("", "Tümü", rows.length)}
        {chip("pending", "Onay bekleyen", counts.pending ?? 0)}
        {chip("approved", "Onaylı", counts.approved ?? 0)}
        {chip("posted", "Aktarılan", counts.posted ?? 0)}
        {chip("rejected", "Reddedilen", counts.rejected ?? 0)}
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Usta türü" className="h-9 rounded-full border border-[#D5DEE8] bg-white px-3 text-sm">
          <option value="">Personel + dış usta</option><option value="internal">Kendi personelimiz</option><option value="external">Dışarıdan usta</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: usta, ürün, iş no…" className="h-9 ml-auto w-64 rounded-full border border-[#D5DEE8] bg-white px-3.5 text-sm" />
      </div>

      {(canApprove || canPost) && (
        <div className={`sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[12px] px-3 py-2 ${selRows.length ? "bg-brand-800 text-white" : "bg-[#F3F6F9] text-muted"}`}>
          <span className="text-sm font-semibold">{selRows.length ? <>{selRows.length} kayıt · <span className="num">{tl(selSum)}</span></> : "Toplu işlem için kayıt seçin"}</span>
          <input name="reason" placeholder="Sebep (red / geri alma)" className="h-10 w-52 rounded-[10px] px-3 text-sm text-ink bg-white" />
          <span className="ml-auto flex flex-wrap gap-2">
            {canApprove && <Btn action="approve" disabled={!has("pending")} cls="bg-ok text-white">✓ Onayla</Btn>}
            {canApprove && <Btn action="reject" disabled={!has("pending") && !has("approved")} cls="bg-white text-bad">Reddet</Btn>}
            {canApprove && <Btn action="reopen" disabled={!has("approved") && !has("rejected")} cls="bg-white text-[#33414F]">Onaya geri al</Btn>}
            {canPost && <Btn action="post" disabled={!has("approved")} cls="bg-accent text-white">→ Maaşa / gidere aktar</Btn>}
            {canPost && <Btn action="unpost" disabled={!has("posted")} cls="bg-white text-warn">Aktarımı geri al</Btn>}
          </span>
        </div>
      )}

      <div className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-[13px] min-w-[900px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2.5 px-2 border-b border-line w-8"><input type="checkbox" aria-label="Tümünü seç" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map((r) => r.id)))} className="w-4 h-4 accent-[#0A3D73]" /></th>
              <th className="py-2.5 px-2 font-semibold border-b border-line">Tarih</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line">Usta</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line">İş no</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line">Ürün / iş</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line text-right">Adet</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line text-right">Birim</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line text-right">Tutar</th>
              <th className="py-2.5 px-2 font-semibold border-b border-line">Durum</th>
              <th className="py-2.5 px-2 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "bg-[#F3F8FD]" : ""}>
                <td className="py-2 px-2 border-b border-[#EEF2F6]"><input type="checkbox" name="sel" value={r.id} checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Seç" className="w-4 h-4 accent-[#0A3D73]" /></td>
                <td className="num py-2 px-2 border-b border-[#EEF2F6]">{fmtD(r.work_date)}</td>
                <td className="py-2 px-2 border-b border-[#EEF2F6]">
                  <b className="text-brand-800">{r.worker}</b>
                  <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${r.kind === "internal" ? "bg-[#E7F1FB] text-brand-700" : "bg-[#F1ECFA] text-[#5B3A9A]"}`}>{r.kind === "internal" ? "PERSONEL" : "DIŞ"}</span>
                </td>
                <td className="num py-2 px-2 border-b border-[#EEF2F6]">{r.job_no ? <a href={`/isler?q=${r.job_no}`} className="text-brand-700 font-semibold">{r.job_no}</a> : "—"}</td>
                <td className="py-2 px-2 border-b border-[#EEF2F6]">{r.product ?? r.work_name}{r.note && <span className="block text-xs text-muted">{r.note}</span>}{r.reject_reason && <span className="block text-xs text-bad">Red: {r.reject_reason}</span>}</td>
                <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right">{r.qty.toLocaleString("tr-TR")} <span className="text-muted text-xs">{r.unit}</span></td>
                <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right">{tl(r.unit_price)}</td>
                <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right font-semibold">{tl(r.amount)}{r.stopaj_amount ? <span className="block text-[11px] text-muted font-normal">stopaj −{tl(r.stopaj_amount)}</span> : null}</td>
                <td className="py-2 px-2 border-b border-[#EEF2F6]"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                <td className="py-2 px-2 border-b border-[#EEF2F6] text-right">
                  {canEnter && (r.status === "pending" || r.status === "rejected") && <button formAction={del} name="id" value={r.id} className="text-xs font-semibold text-muted hover:text-bad">Sil</button>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={10} className="p-8 text-center text-muted">Kayıt yok.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5} className="py-2.5 px-2 text-right text-muted">{shown.length} kayıt</td>
                <td className="num py-2.5 px-2 text-right">{shown.reduce((t, r) => t + r.qty, 0).toLocaleString("tr-TR")}</td>
                <td />
                <td className="num py-2.5 px-2 text-right text-brand-800">{tl(shown.reduce((t, r) => t + r.amount, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </form>
  );
}
