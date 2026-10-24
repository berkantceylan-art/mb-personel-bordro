"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bhCompareCreate, bhEqualize, type BhListItem } from "@/lib/bh-cari-actions";

const money = (k: number, c: string) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c === "TRY" ? "₺" : c === "EUR" ? "€" : c}`;
type St = "same" | "diff" | "lab" | "cur" | "none";
const ST: Record<St, string> = { same: "Aynı", diff: "Bakiye farklı", lab: "Hekim (Dentalsis)", cur: "Para birimi farklı", none: "ERP'de yok" };

/** Bizim Hesap ↔ ERP: her carinin Bizim Hesap bakiyesi ile ERP bakiyesi yan yana; farklıları eşitle */
export function BhCompare({ items }: { items: BhListItem[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"c" | "s">("c");
  const [filter, setFilter] = useState<St | "all">("diff");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: { name: string; error: string }[] } | null>(null);
  const live = items.filter((i) => !i.hidden);
  const stOf = (it: BhListItem): St => {
    if (!it.match) return it.erp_balance === 0 ? "same" : "none";
    if (it.match.lab) return "lab";
    if (it.match.currency && it.match.currency !== it.currency) return "cur";
    return Math.abs((it.match.balance ?? 0) - it.erp_balance) <= 1 ? "same" : "diff";
  };
  const rows = useMemo(() => live.filter((i) => i.kind === tab), [live, tab]);
  const count = (s: St) => rows.filter((i) => stOf(i) === s).length;
  const shown = rows.filter((i) => filter === "all" || stOf(i) === filter);
  // seçilebilir: bakiyesi farklı (eşitlenir), ERP'de yok ya da para birimi farklı (kendi para biriminde cari açılıp bakiye aktarılır)
  const canEq = (it: BhListItem) => ["diff", "none", "cur"].includes(stOf(it));
  async function eq() {
    const chosen = shown.filter((i) => sel.has(i.guid) && canEq(i));
    const picks = chosen.filter((i) => stOf(i) === "diff").map((i) => ({ party: i.match!.id, target: i.erp_balance, name: i.name }));
    const create = chosen.filter((i) => stOf(i) !== "diff").map((i) => i.guid);
    if (!picks.length && !create.length) return;
    if (!confirm(`${picks.length ? `${picks.length} carinin ERP bakiyesi Bizim Hesap'a eşitlenecek. ` : ""}${create.length ? `${create.length} cari için kendi para biriminde ERP carisi açılıp Bizim Hesap bakiyesi devir olarak aktarılacak. ` : ""}Devam?`)) return;
    setBusy(true); setMsg(null);
    let n = 0; const errors: { name: string; error: string }[] = [];
    for (let i = 0; i < create.length; i += 10) {
      setMsg({ ok: true, text: `Cariler açılıyor… ${Math.min(i + 10, create.length)} / ${create.length}` });
      try { const r = await bhCompareCreate(create.slice(i, i + 10)); n += Number(/(\d+) carinin bakiyesi/.exec(r.message)?.[1] ?? 0); errors.push(...(r.errors ?? [])); if (!r.ok && !r.errors?.length) errors.push({ name: "Cari açma", error: r.message }); }
      catch (e) { errors.push({ name: `${i + 1}-${i + 10}`, error: (e as Error).message }); }
    }
    for (let i = 0; i < picks.length; i += 40) {
      setMsg({ ok: true, text: `Eşitleniyor… ${Math.min(i + 40, picks.length)} / ${picks.length}` });
      try { const r = await bhEqualize(picks.slice(i, i + 40)); n += Number(/^(\d+)/.exec(r.message)?.[1] ?? 0); errors.push(...(r.errors ?? [])); if (!r.ok && !r.errors?.length) errors.push({ name: "Eşitleme", error: r.message }); }
      catch (e) { errors.push({ name: `${i + 1}-${i + 40}`, error: (e as Error).message }); }
    }
    setMsg({ ok: !errors.length, text: `${n} carinin bakiyesi Bizim Hesap'a eşitlendi.${errors.length ? ` ${errors.length} cari eşitlenemedi:` : ""}`, errors }); setSel(new Set()); setBusy(false); router.refresh();
  }
  const totalDiff = rows.filter((i) => stOf(i) === "diff").length;
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-brand-800">Bizim Hesap ↔ ERP bakiye karşılaştırması</b>
        {(["c", "s"] as const).map((k) => <button key={k} type="button" onClick={() => { setTab(k); setSel(new Set()); }} className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${tab === k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{k === "c" ? "Müşteriler" : "Tedarikçiler"}</button>)}
        <span className={`ml-auto text-sm font-semibold ${totalDiff ? "text-bad" : "text-ok"}`}>{totalDiff ? `${totalDiff} caride bakiye farklı` : "Bakiyeler aynı"}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {(["diff", "none", "cur", "lab", "same", "all"] as const).map((k) => <button key={k} type="button" onClick={() => { setFilter(k); setSel(new Set()); }} className={`rounded-full px-3 py-1 border ${filter === k ? "bg-ink text-white border-ink" : "bg-[#F2F4F7] border-transparent"}`}>{k === "all" ? `Hepsi (${rows.length})` : `${ST[k]} (${count(k)})`}</button>)}
      </div>
      <p className="text-xs text-muted">Bakiye: + bize borçlu, − biz borçluyuz. Seçip “eşitle” deyince: <b>Bakiye farklı</b> → ERP bakiyesi Bizim Hesap&apos;a eşitlenir; <b>ERP&apos;de yok</b> ve <b>Para birimi farklı</b> → kendi para biriminde ERP carisi açılır, Bizim Hesap bakiyesi devir olarak aktarılır (hareketleri istiyorsanız alttaki listeden “tüm hareketler” ile aktarın). <b>Hekim</b>: bakiyesi Dentalsis&apos;ten eşitlenir, buradan dokunulmaz.</p>
      {msg && <div className={`sticky top-0 z-20 text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}{msg.errors?.length ? <ul className="mt-1 text-xs">{msg.errors.slice(0, 20).map((e, i) => <li key={i}>{e.name}: {e.error}</li>)}</ul> : null}</div>}
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-line rounded-[10px]">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="sticky top-0 bg-[#F7F9FB]"><tr className="text-left text-xs text-muted">
            <th className="p-2 w-8"><input type="checkbox" checked={shown.some(canEq) && shown.filter(canEq).every((i) => sel.has(i.guid))} onChange={(e) => setSel(e.target.checked ? new Set(shown.filter(canEq).map((i) => i.guid)) : new Set())} /></th>
            <th className="p-2">Bizim Hesap carisi</th><th className="p-2">ERP carisi</th><th className="p-2 text-right">Bizim Hesap</th><th className="p-2 text-right">ERP</th><th className="p-2 text-right">Fark</th><th className="p-2">Durum</th>
          </tr></thead>
          <tbody>
            {shown.map((it) => {
              const st = stOf(it);
              const erp = it.match?.balance ?? 0;
              return (
                <tr key={it.guid} className="border-t border-[#EEF2F6]">
                  <td className="p-2">{canEq(it) && <input type="checkbox" checked={sel.has(it.guid)} onChange={(e) => setSel((x) => { const y = new Set(x); if (e.target.checked) y.add(it.guid); else y.delete(it.guid); return y; })} />}</td>
                  <td className="p-2">{it.name}<span className="block text-[11px] text-muted">{it.group ?? ""}</span></td>
                  <td className="p-2">{it.match ? <Link href={`/finans/cariler/${it.match.id}`} className="text-brand-700">{it.match.name}</Link> : <span className="text-muted">—</span>}</td>
                  <td className="p-2 text-right num">{money(it.erp_balance, it.currency)}</td>
                  <td className="p-2 text-right num">{it.match ? money(erp, it.match.currency ?? it.currency) : "—"}</td>
                  <td className={`p-2 text-right num ${st === "diff" ? "text-bad font-semibold" : "text-muted"}`}>{it.match && st !== "cur" ? money(erp - it.erp_balance, it.currency) : "—"}</td>
                  <td className="p-2 text-xs"><span className={st === "same" ? "text-ok" : st === "lab" ? "text-muted" : "text-bad"}>{ST[st]}</span></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={7} className="p-6 text-center text-muted">Bu süzgece uyan cari yok.</td></tr>}
          </tbody>
        </table>
      </div>
      <div><button type="button" disabled={busy || !shown.some((i) => sel.has(i.guid) && canEq(i))} onClick={eq} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">{busy ? "İşleniyor…" : `Seçilenleri Bizim Hesap'a eşitle (${shown.filter((i) => sel.has(i.guid) && canEq(i)).length})`}</button></div>
    </section>
  );
}
