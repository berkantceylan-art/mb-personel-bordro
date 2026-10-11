"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanInput, scanFeedback } from "@/components/ScanInput";
import { Notice } from "@/components/erp";
import { packClose, packGet, packRemove, packScan, type PackData } from "@/lib/qc-actions";
import type { Person } from "./data";

type OpenPkg = { id: string; no: string; status: string; exited: boolean; customer: string | null; packer: string | null; packer_id: string | null; jobs: number; closed_at: string | null };

/** Paketleme / çıkış: paketleyen okutur → hekimin paketine eklenir; paketi kapat → etiket ve toplu çıkış */
export function PackScreen({ people, me, canPick, packages }: { people: Person[]; me: Person | null; canPick: boolean; packages: OpenPkg[] }) {
  const router = useRouter();
  const packers = people.filter((p) => p.role === "dispatch");
  const [emp, setEmp] = useState(me?.role === "dispatch" ? me.id : canPick ? packers[0]?.id ?? "" : me?.id ?? "");
  const [pkg, setPkg] = useState<PackData | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [closed, setClosed] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => { if (canPick) { try { const v = localStorage.getItem("qc-emp-pack"); if (v && people.some((p) => p.id === v)) setEmp(v); } catch { /* yok */ } } }, [canPick, people]);

  const scan = (code: string) => start(async () => {
    setClosed(null);
    const r = await packScan(code, emp, pkg?.status === "open" ? pkg.id : null);
    scanFeedback(r.ok && !r.duplicate && !r.warning);
    if (!r.ok) { setMsg({ ok: false, text: r.message ?? "Okunamadı" }); return; }
    setPkg(r.package ?? null);
    setMsg({ ok: !r.warning, text: r.duplicate ? `İş #${r.job} zaten bu pakette.` : `İş #${r.job} pakete eklendi${r.warning ? ` · ${r.warning}` : ""}.` });
    router.refresh();
  });
  const close = (exit: boolean) => start(async () => {
    if (!pkg) return;
    const r = await packClose(pkg.id, exit);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setClosed({ id: pkg.id, text: `${pkg.no} · ${pkg.customer ?? ""}` }); setPkg(null); router.refresh(); }
  });
  const resume = (id: string) => start(async () => { setPkg(await packGet(id)); setClosed(null); setMsg(null); });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-[16px] border border-line bg-white p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Paketleyen:</span>
            {canPick ? (
              <select value={emp} onChange={(e) => { setEmp(e.target.value); try { localStorage.setItem("qc-emp-pack", e.target.value); } catch { /* yok */ } }} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2">
                <option value="">— Seçin —</option>{packers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : <b>{me?.name ?? "—"}</b>}
          </div>
          <ScanInput onCode={scan} busy={busy} placeholder="Son kontrolden geçen işi okutun" />
          {msg && <div className={`rounded-xl px-4 py-3 font-semibold ${msg.ok ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FEF2F2] text-bad"}`}>{msg.text}</div>}
        </section>

        {closed && (
          <div className="flex flex-wrap items-center gap-3 rounded-[16px] border-2 border-[#22C55E]/50 bg-white p-4">
            <span className="text-3xl">📦</span><span className="flex-1"><b>Paket kapandı</b><span className="block text-sm text-muted">{closed.text}</span></span>
            <Link href={`/kalite-hatti/paket/${closed.id}`} target="_blank" className="h-11 rounded-[10px] bg-brand-700 px-4 font-semibold leading-[44px] text-white">🏷 Etiket yazdır</Link>
          </div>
        )}

        {pkg ? (
          <section className="flex flex-col gap-3 rounded-[16px] border-2 border-brand-600/30 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl">📦</span>
              <div className="flex-1"><b className="text-xl">{pkg.customer ?? "Hekim yok"}</b><span className="block text-sm text-muted">{pkg.no} · paketleyen {pkg.packer ?? "—"} · {pkg.jobs.length} iş · {pkg.jobs.reduce((n, j) => n + Number(j.qty), 0)} birim</span></div>
            </div>
            <ul className="divide-y divide-[#EEF2F6] rounded-[12px] border border-line">
              {pkg.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <b className="w-16 font-mono text-brand-700">#{j.no}</b>
                  <span className="min-w-0 flex-1">{j.patient ?? "—"}<span className="block truncate text-xs text-muted">{j.items ?? ""}</span></span>
                  {pkg.status === "open" && <button type="button" onClick={() => start(async () => setPkg(await packRemove(j.id, pkg.id)))} className="text-xs font-semibold text-bad">Çıkar</button>}
                </li>
              ))}
            </ul>
            {pkg.status === "open" && (
              <div className="grid gap-2 md:grid-cols-2">
                <button type="button" disabled={busy || !pkg.jobs.length} onClick={() => close(true)} className="h-16 rounded-[14px] bg-[#16A34A] text-lg font-bold text-white disabled:opacity-40">📦 Paketi kapat · çıkış yap</button>
                <button type="button" disabled={busy || !pkg.jobs.length} onClick={() => close(false)} className="h-16 rounded-[14px] border-2 border-line bg-white text-lg font-bold disabled:opacity-40">Paketi kapat (çıkışsız)</button>
              </div>
            )}
            <p className="text-xs text-muted">Çıkış yapılınca işler “teslim edildi” olur ve hekim carisine işlenir. Farklı hekimin işi okutulursa kendi paketine konur.</p>
          </section>
        ) : !closed && <Notice tone="info">İlk işi okuttuğunuzda hekimin paketi açılır; aynı hekimin diğer işlerini okuttukça pakete eklenir.</Notice>}
      </div>
      <aside className="self-start rounded-[16px] border border-line bg-white">
        <h3 className="border-b border-line px-4 py-3 font-semibold">Paketler (son 24 saat)</h3>
        <ul className="divide-y divide-[#EEF2F6] text-sm">
          {packages.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-4 py-2.5">
              <button type="button" onClick={() => resume(p.id)} className="min-w-0 flex-1 text-left"><b>{p.customer ?? "—"}</b><span className="block text-xs text-muted">{p.no} · {p.jobs} iş · {p.packer ?? ""}</span></button>
              <span className={`text-xs font-semibold ${p.status === "open" ? "text-brand-700" : p.exited ? "text-ok" : "text-muted"}`}>{p.status === "open" ? "açık" : p.exited ? "çıktı" : "kapalı"}</span>
              {p.status !== "open" && <Link href={`/kalite-hatti/paket/${p.id}`} target="_blank" className="text-xs" title="Etiket">🏷</Link>}
            </li>
          ))}
          {!packages.length && <li className="px-4 py-6 text-center text-muted">Paket yok.</li>}
        </ul>
      </aside>
    </div>
  );
}
