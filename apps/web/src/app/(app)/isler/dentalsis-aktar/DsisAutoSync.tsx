"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dsisSyncNow, dsisSyncToggle, type DsisSyncStatus } from "@/lib/dsis-sync-actions";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const ago = (iso?: string) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`;
};

/** Dentalsis otomatik eşitleme durumu ve kontrolleri */
export function DsisAutoSync({ status }: { status: DsisSyncStatus }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const last = status.last;
  const steps = (last?.steps ?? {}) as Record<string, Record<string, number> | number>;
  const jobs = (steps.jobs ?? {}) as Record<string, number>;
  const list = (steps.list ?? {}) as Record<string, number>;
  const bal = (steps.balance ?? {}) as Record<string, number>;
  const cust = (steps.customers ?? {}) as Record<string, number>;
  const ref = (steps.ref ?? {}) as Record<string, number>;

  async function now() {
    setBusy(true); setNote(null);
    const r = await dsisSyncNow();
    setNote(r.ok ? `Tamam: ${r.message}` : `Hata: ${"error" in r && r.error ? r.error : r.message}`);
    setBusy(false); router.refresh();
  }
  async function toggle() {
    setBusy(true);
    const r = await dsisSyncToggle(!status.enabled);
    if (!r.ok) setNote(r.message ?? "Kaydedilemedi");
    setBusy(false); router.refresh();
  }

  return (
    <div className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold">🔄 Otomatik eşitleme (5 dakikada bir)</h2>
        {!status.ready ? <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">Kurulum bekliyor</span>
          : status.enabled ? <span className="text-xs rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">Açık</span>
          : <span className="text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">Kapalı</span>}
        <div className="ml-auto flex gap-2">
          {status.ready && <button type="button" disabled={busy} onClick={toggle} className="h-10 px-4 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-bold disabled:opacity-50">{status.enabled ? "Durdur" : "Başlat"}</button>}
          {status.ready && <button type="button" disabled={busy} onClick={now} className="h-10 px-4 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "Eşitleniyor…" : "Şimdi eşitle"}</button>}
        </div>
      </div>
      {status.message && <p className="text-sm text-red-700">{status.message}</p>}
      {!status.ready && (
        <p className="text-sm text-slate-600">
          Dentalsis&apos;te ERP için ayrı bir kullanıcı açıp e-posta ve şifresini Vercel&apos;de <b>DENTALSIS_EMAIL</b> ve <b>DENTALSIS_PASSWORD</b> olarak kaydedin.
          Sonra ERP yeniden yayınlanınca eşitleme kendiliğinden başlar.
        </p>
      )}
      {status.ready && (
        <div className="text-sm text-slate-700 flex flex-col gap-1">
          <div>Son tur: <b>{when(last?.at)}</b> {ago(last?.at)} · {last ? (last.ok ? <span className="text-emerald-700">{last.message}</span> : <span className="text-red-700">{last.error ?? last.message}</span>) : "henüz çalışmadı"}</div>
          {status.lastOk && !last?.ok && <div>Son başarılı tur: {when(status.lastOk.at)} ({ago(status.lastOk.at)})</div>}
          {last?.ok && (
            <div className="text-slate-500">
              İş listesi {list.total ?? 0} · ayrıntısı çekilen {list.fetched ?? 0} · yeni iş {jobs.inserted ?? 0} · bilgi {jobs.info_updated ?? 0} · kalem {jobs.items_updated ?? 0} · prova {jobs.steps_updated ?? 0} · durum {jobs.status_updated ?? 0} · iptal {jobs.cancelled ?? 0}
              {" · "}yeni hekim {ref.customers_new ?? 0} · hekim bilgisi {cust.customers_updated ?? 0} · tahsilat {bal.payments ?? 0} · bakiye eşitleme {bal.adjusted ?? 0}
            </div>
          )}
        </div>
      )}
      {note && <p className="text-sm">{note}</p>}
    </div>
  );
}
