"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dsisAuditFixAction, dsisAuditScanAction, type DsisAuditState } from "@/lib/dsis-sync-actions";

const money = (k: number, cur: string) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function Stat({ label, v, bad }: { label: string; v: number | string; bad?: boolean }) {
  return <div className={`rounded-[12px] border px-3 py-2 ${bad ? "border-[#F5C2C0] bg-[#FDF2F1]" : "border-line bg-[#F7F9FB]"}`}><div className="text-[11px] text-muted">{label}</div><div className={`text-lg font-bold ${bad ? "text-bad" : "text-ink"}`}>{v}</div></div>;
}

/** Dentalsis ile ERP'yi birebir karşılaştır: cariler, bakiyeler, işler (eksik, çıkan, kalan) */
export function DsisAudit({ state }: { state: DsisAuditState }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const r = state.report;
  const c = r?.customers, b = r?.balances, j = r?.jobs;
  const scanned = !!r?.scanned_at;

  async function scan(restart: boolean) {
    setBusy("Dentalsis okunuyor (1-4 dakika)…"); setNote(null);
    let res = await dsisAuditScanAction(restart);
    // tarama bitmediyse kendiliğinden devam
    for (let i = 0; i < 4 && res.ok && /sürüyor/.test(res.message); i++) { setBusy(res.message); res = await dsisAuditScanAction(false); }
    setNote({ ok: res.ok, text: res.message }); setBusy(null); router.refresh();
  }
  async function fix() {
    setBusy("Eksik işler aktarılıyor, durumlar ve bakiyeler eşitleniyor (1-4 dakika)…"); setNote(null);
    const res = await dsisAuditFixAction();
    setNote({ ok: res.ok, text: res.message });
    if (res.ok) { setBusy("Sonuç için yeniden karşılaştırılıyor…"); await dsisAuditScanAction(true).then(async (x) => { for (let i = 0; i < 4 && x.ok && /sürüyor/.test(x.message); i++) x = await dsisAuditScanAction(false); }); }
    setBusy(null); router.refresh();
  }

  return (
    <div className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-brand-800">Dentalsis ↔ ERP kontrolü</b>
        <span className="text-xs text-muted">Son karşılaştırma: {when(r?.scanned_at)}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" disabled={!!busy} onClick={() => scan(true)} className="h-10 px-4 rounded-[10px] border border-brand-700 text-brand-700 font-semibold text-sm disabled:opacity-50">🔍 Karşılaştır</button>
          <button type="button" disabled={!!busy || !scanned} onClick={fix} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold text-sm disabled:opacity-50">🛠 Eksikleri ve farkları düzelt</button>
        </div>
      </div>
      <p className="text-xs text-muted">Karşılaştır: Dentalsis&apos;teki tüm cariler, cari bakiyeleri ve 2026&apos;dan bu yana tüm iş kayıtları okunur, ERP ile tek tek karşılaştırılır. Düzelt: ERP&apos;de olmayan işler aktarılır, Dentalsis&apos;te çıkmış ama ERP&apos;de açık görünen (ya da tersi) işler eşitlenir, cari bakiyeleri Dentalsis&apos;e eşitlenir. Dentalsis&apos;e hiçbir şey yazılmaz.</p>
      {state.message && <p className="text-sm text-bad">{state.message}</p>}
      {busy && <p className="text-sm text-brand-700">{busy}</p>}
      {note && <p className={`text-sm rounded-lg px-3 py-2 ${note.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{note.text}</p>}

      {scanned && c && b && j && (
        <>
          <section className="flex flex-col gap-2">
            <b className="text-sm">Cariler</b>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Dentalsis'te cari" v={c.remote} />
              <Stat label="ERP'de eşleşen" v={c.linked} />
              <Stat label="ERP'de olmayan" v={c.missing} bad={c.missing > 0} />
              <Stat label="Adı farklı" v={c.name_diff.length} bad={c.name_diff.length > 0} />
            </div>
            {c.missing > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">ERP&apos;de olmayan cariler ({c.missing})</summary><p className="mt-1">{c.missing_list.map((x) => x.name).join(" · ")}</p></details>}
            {c.name_diff.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">Adı farklı cariler</summary><ul className="mt-1">{c.name_diff.map((x) => <li key={x.id}>Dentalsis: <b>{x.remote}</b> → ERP: {x.erp}</li>)}</ul></details>}
            {c.erp_only.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">Dentalsis&apos;te artık olmayan ERP carileri ({c.erp_only.length})</summary><p className="mt-1">{c.erp_only.map((x) => x.name).join(" · ")}</p></details>}
          </section>

          <section className="flex flex-col gap-2">
            <b className="text-sm">Cari bakiyeleri</b>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Karşılaştırılan" v={b.checked} />
              <Stat label="Bakiyesi farklı" v={b.mismatch} bad={b.mismatch > 0} />
            </div>
            {b.mismatch > 0 && (
              <div className="overflow-x-auto max-h-80 overflow-y-auto border border-line rounded-[10px]">
                <table className="w-full text-xs">
                  <thead><tr className="bg-[#F7F9FB] text-left text-muted"><th className="p-2">Hekim</th><th className="p-2 text-right">Dentalsis</th><th className="p-2 text-right">ERP</th><th className="p-2 text-right">Fark</th></tr></thead>
                  <tbody>{b.list.map((x) => <tr key={x.id} className="border-t border-[#EEF2F6]"><td className="p-2"><Link href={`/isler/hekimler/${x.id}`} className="text-brand-700 font-semibold">{x.name}</Link></td><td className="p-2 text-right">{money(x.remote, x.currency)}</td><td className="p-2 text-right">{money(x.erp, x.currency)}</td><td className="p-2 text-right text-bad">{money(x.diff, x.currency)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <b className="text-sm">İşler (2026&apos;dan bu yana)</b>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Dentalsis'te iş" v={j.remote} />
              <Stat label="ERP'de olmayan" v={j.missing} bad={j.missing > 0} />
              <Stat label="Kalan iş: Dentalsis / ERP" v={`${j.remote_open} / ${j.erp_open}`} bad={j.remote_open !== j.erp_open} />
              <Stat label="Dentalsis'te çıkmış, ERP'de açık" v={j.should_close} bad={j.should_close > 0} />
              <Stat label="Dentalsis'te açık, ERP'de çıkmış" v={j.should_open} bad={j.should_open > 0} />
              <Stat label="ERP'de olup Dentalsis'te olmayan" v={j.erp_only} bad={j.erp_only > 0} />
            </div>
            {j.missing > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">ERP&apos;de olmayan işler ({j.missing})</summary><ul className="mt-1">{j.missing_list.map((x) => <li key={x.id}>#{x.no} · {x.cari} · {x.hasta} · {x.tarih} · {x.prova}</li>)}</ul></details>}
            {j.should_close > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">Dentalsis&apos;te çıkmış ama ERP&apos;de açık ({j.should_close})</summary><ul className="mt-1">{j.should_close_list.map((x) => <li key={x.id}>#{x.no} · {x.cariad} · {x.hasta} · ERP: {x.status}</li>)}</ul></details>}
            {j.should_open > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">Dentalsis&apos;te açık ama ERP&apos;de çıkmış ({j.should_open})</summary><ul className="mt-1">{j.should_open_list.map((x) => <li key={x.id}>#{x.no} · {x.cariad} · {x.hasta} · Dentalsis: {x.provaturu} · ERP: {x.status}</li>)}</ul></details>}
            {j.erp_only > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold">ERP&apos;de olup Dentalsis listesinde olmayan ({j.erp_only})</summary><p className="mt-1 text-muted">Dentalsis&apos;te silinmiş olabilir; ERP&apos;de elle kontrol edin.</p><ul className="mt-1">{j.erp_only_list.map((x) => <li key={x.id}><Link href={`/isler/${x.id}`} className="text-brand-700">#{x.no}</Link> · {x.patient} · {x.status}</li>)}</ul></details>}
          </section>
        </>
      )}
      {!scanned && !state.message && <p className="text-sm text-muted">Henüz karşılaştırma yapılmadı: “Karşılaştır”a basın.</p>}
    </div>
  );
}
