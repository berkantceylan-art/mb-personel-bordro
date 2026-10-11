"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { ScanInput, scanFeedback } from "@/components/ScanInput";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Field, Notice, inputCls, selectCls } from "@/components/erp";
import { visAction, visSave, visScan, type ScanRes } from "@/lib/visitor-actions";
import { speakTr } from "@/components/VoiceGreeter";

export type V = { id: string; no: string; visitor_name: string; visitor_company: string | null; host: string | null; purpose: string | null; status: string; expected_at: string | null; checked_in_at: string | null; checked_out_at: string | null; badge_no: string | null; plate: string | null; photo: string | null; token: string };
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) : "");
const dur = (iso: string | null) => { if (!iso) return ""; const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`; };

/** Güvenlik paneli: QR / kart okut (giriş ↔ çıkış), hızlı kayıt, içeridekiler, beklenenler */
export function GuardPanel({ visits, hosts }: { visits: V[]; hosts: { user_id: string; display_name: string }[] }) {
  const router = useRouter();
  const [badge, setBadge] = useState("");
  const [photo, setPhoto] = useState<string[]>([]);
  const [last, setLast] = useState<ScanRes | null>(null);
  const [busy, start] = useTransition();
  const [q, setQ] = useState("");
  const [quickPhoto, setQuickPhoto] = useState<string[]>([]);
  const { state, pending, formProps } = useActionForm(visSave, { prepare: (fd) => { fd.set("checkin", "on"); fd.set("photo", quickPhoto[0] ?? ""); }, onSuccess: () => { setQuickPhoto([]); router.refresh(); } });
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30000); return () => clearInterval(t); }, [router]);

  const inside = visits.filter((v) => v.status === "in");
  const expected = visits.filter((v) => v.status === "expected");
  const outs = visits.filter((v) => v.status === "out").slice(0, 15);
  const k = q.trim().toLocaleLowerCase("tr");
  const match = (v: V) => !k || `${v.visitor_name} ${v.visitor_company ?? ""} ${v.host ?? ""} ${v.badge_no ?? ""} ${v.plate ?? ""}`.toLocaleLowerCase("tr").includes(k);
  const lateBadges = useMemo(() => inside.filter((v) => v.checked_in_at && Date.now() - new Date(v.checked_in_at).getTime() > 8 * 3600000), [inside]);

  const scan = (code: string) => start(async () => {
    const r = await visScan(code, badge, photo[0], true);
    scanFeedback(r.ok);
    setLast(r);
    if (r.ok) {
      void speakTr(r.action === "in" ? `Hoş geldiniz ${r.name}` : `İyi günler ${r.name}`);
      setBadge(""); setPhoto([]); router.refresh();
    }
  });
  const act = (id: string, a: "checkout" | "checkin" | "cancel", b?: string) => start(async () => { const r = await visAction(id, a, b); if (!r.ok) setLast({ ok: false, message: r.message }); router.refresh(); });

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-[18px] border border-line bg-white p-4">
          <h2 className="font-display text-lg font-bold">QR / kart okut</h2>
          <div className="grid gap-2 md:grid-cols-[200px_1fr]">
            <input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Verilecek kart no" className={inputCls} />
            <PhotoPicker value={photo} onChange={setPhoto} max={1} label="📷 Fotoğraf" />
          </div>
          <ScanInput onCode={scan} busy={busy} placeholder="Davetiye QR'ı, kart no ya da ZY no" />
          {last && (
            <div className={`rounded-2xl p-4 ${last.ok ? (last.action === "in" ? "bg-[#ECFDF5]" : "bg-[#EFF6FF]") : "bg-[#FEF2F2]"}`}>
              {last.ok ? (
                <>
                  <b className="block text-xl">{last.action === "in" ? "✅ Giriş" : "👋 Çıkış"} · {last.name}</b>
                  <span className="text-sm">{[last.company, last.host ? `görüşeceği: ${last.host}` : null, last.badge ? `kart ${last.badge}` : null, last.minutes != null ? `içeride ${last.minutes} dk kaldı` : null].filter(Boolean).join(" · ")}</span>
                </>
              ) : <b className="text-bad">⚠ {last.message}</b>}
            </div>
          )}
          <button type="button" disabled title="Kapı / turnike cihazı bağlandığında etkinleşir" className="h-12 rounded-[12px] border-2 border-dashed border-[#C5D0DB] font-semibold text-muted">🔓 Kapıyı aç (cihaz entegrasyonu bekleniyor)</button>
        </section>

        <section className="flex flex-col gap-3 rounded-[18px] border border-line bg-white p-4">
          <h2 className="font-display text-lg font-bold">Hızlı kayıt · içeri al</h2>
          <form {...formProps} className="grid gap-3 md:grid-cols-2">
            <Field label="Ad soyad"><input name="visitor_name" required minLength={2} maxLength={120} className={inputCls} /></Field>
            <Field label="Firma"><input name="visitor_company" maxLength={120} className={inputCls} /></Field>
            <Field label="Görüşeceği kişi"><select name="host_user" className={selectCls}><option value="">—</option>{hosts.map((h) => <option key={h.user_id} value={h.user_id}>{h.display_name}</option>)}</select></Field>
            <Field label="Amaç"><input name="purpose" maxLength={200} placeholder="Toplantı, kargo, servis…" className={inputCls} /></Field>
            <Field label="Telefon"><input name="phone" inputMode="tel" maxLength={40} className={inputCls} /></Field>
            <Field label="Kimlik son 4 hane"><input name="id_last4" maxLength={4} className={inputCls} /></Field>
            <Field label="Kart no"><input name="badge_no" maxLength={30} className={inputCls} /></Field>
            <Field label="Plaka"><input name="plate" maxLength={20} className={inputCls} /></Field>
            <div className="md:col-span-2 flex flex-wrap items-center gap-4"><PhotoPicker value={quickPhoto} onChange={setQuickPhoto} max={1} label="📷 Fotoğraf" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="kvkk_ok" className="h-5 w-5" required />KVKK aydınlatması yapıldı</label></div>
            {state && <div className="md:col-span-2"><Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice></div>}
            <div className="md:col-span-2"><button disabled={pending} className="h-12 rounded-[12px] bg-[#16A34A] px-6 font-bold text-white disabled:opacity-60">{pending ? "Kaydediliyor…" : "Kaydet ve içeri al"}</button></div>
          </form>
        </section>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          {[["İçeride", inside.length, "text-ok"], ["Bekleniyor", expected.length, "text-brand-700"], ["Bugün çıkan", outs.length, "text-muted"]].map(([l, n, c]) => (
            <div key={l as string} className="rounded-[14px] border border-line bg-white p-3"><span className="text-xs text-muted">{l}</span><b className={`block text-3xl ${c}`}>{n as number}</b></div>
          ))}
        </div>
        {!!lateBadges.length && <Notice tone="warn">{lateBadges.length} ziyaretçi 8 saatten uzun süredir içeride görünüyor; kart iadesini kontrol edin.</Notice>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, firma, kart, plaka ara…" className={inputCls} />
        <section className="rounded-[18px] border border-line bg-white">
          <h3 className="border-b border-line px-4 py-3 font-semibold">🟢 İçeride ({inside.length})</h3>
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {inside.filter(match).map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                {v.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.photo} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : <span className="grid h-10 w-10 place-items-center rounded-full bg-[#ECFDF5] font-bold text-ok">{v.visitor_name.slice(0, 1)}</span>}
                <span className="min-w-0 flex-1"><b>{v.visitor_name}</b><span className="block truncate text-xs text-muted">{[v.visitor_company, v.host, v.badge_no ? `kart ${v.badge_no}` : null, `giriş ${hm(v.checked_in_at)} · ${dur(v.checked_in_at)}`].filter(Boolean).join(" · ")}</span></span>
                <button type="button" onClick={() => act(v.id, "checkout")} className="h-10 rounded-[10px] border border-line px-3 text-xs font-semibold hover:border-brand-600">Çıkış</button>
              </li>
            ))}
            {!inside.length && <li className="px-4 py-5 text-center text-muted">İçeride ziyaretçi yok.</li>}
          </ul>
        </section>
        <section className="rounded-[18px] border border-line bg-white">
          <h3 className="border-b border-line px-4 py-3 font-semibold">🕒 Beklenen ({expected.length})</h3>
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {expected.filter(match).map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1"><b>{v.visitor_name}</b><span className="block truncate text-xs text-muted">{[v.visitor_company, v.host, v.purpose, v.expected_at ? new Date(v.expected_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null].filter(Boolean).join(" · ")}</span></span>
                <button type="button" onClick={() => act(v.id, "checkin", badge)} className="h-10 rounded-[10px] bg-[#16A34A] px-3 text-xs font-semibold text-white">Giriş</button>
              </li>
            ))}
            {!expected.length && <li className="px-4 py-5 text-center text-muted">Beklenen ziyaretçi yok.</li>}
          </ul>
        </section>
        <section className="rounded-[18px] border border-line bg-white">
          <h3 className="border-b border-line px-4 py-3 font-semibold">Bugün çıkanlar</h3>
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {outs.filter(match).map((v) => <li key={v.id} className="px-4 py-2"><b>{v.visitor_name}</b> <span className="text-xs text-muted">{[v.visitor_company, `${hm(v.checked_in_at)} – ${hm(v.checked_out_at)}`].filter(Boolean).join(" · ")}</span></li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
