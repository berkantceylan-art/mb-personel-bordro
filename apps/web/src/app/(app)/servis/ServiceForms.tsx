"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { PhotoPicker } from "@/components/PhotoPicker";
import { addTicketPhoto, approveTicket, costTicket, createTicket, doneTicket, payTicket, runMaintenanceDue, saveTechnician, type SvcState } from "@/lib/service-actions";

export type AssetOpt = { id: string; name: string; code: string | null; location: string | null; mine?: boolean };
const Msg = ({ state }: { state: SvcState | null }) => (state ? <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice> : null);

/** Arıza bildir: demirbaş seç (zimmetimdekiler önde) ya da yer yaz, fotoğraf çek */
export function NewTicketForm({ assets, defaultAsset }: { assets: AssetOpt[]; defaultAsset?: string }) {
  const router = useRouter();
  const [pics, setPics] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [asset, setAsset] = useState(defaultAsset ?? "");
  const { state, pending, formProps } = useActionForm(createTicket, { prepare: (fd) => { fd.set("photos", JSON.stringify(pics)); fd.set("asset_id", asset); }, onSuccess: () => { setPics([]); setAsset(""); router.refresh(); } });
  const mine = assets.filter((a) => a.mine);
  const hits = useMemo(() => {
    const k = q.trim().toLocaleLowerCase("tr");
    return k.length < 2 ? [] : assets.filter((a) => `${a.name} ${a.code ?? ""} ${a.location ?? ""}`.toLocaleLowerCase("tr").includes(k)).slice(0, 8);
  }, [q, assets]);
  const sel = assets.find((a) => a.id === asset);
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <Field label="Ne bozuk?" hint="kısaca"><input name="title" required minLength={2} maxLength={160} placeholder="ör. Masa ayağı kırık, priz yanmıyor, yazıcı kağıt sıkıştırıyor" className={inputCls} /></Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Demirbaş <span className="font-normal text-muted">(isteğe bağlı)</span></span>
        {sel ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-brand-600 bg-[#F5F9FE] px-3 py-2 text-sm"><b className="flex-1">{sel.name}{sel.code ? ` · ${sel.code}` : ""}</b><button type="button" onClick={() => setAsset("")} className="text-xs font-semibold text-bad">Kaldır</button></div>
        ) : (
          <>
            {!!mine.length && <div className="flex flex-wrap gap-1.5">{mine.map((a) => <button key={a.id} type="button" onClick={() => setAsset(a.id)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold hover:border-brand-600">🙂 {a.name}</button>)}</div>}
            <div className="relative">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Demirbaş ara (ad, kod, yer)…" className={inputCls} />
              {!!hits.length && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[12px] border border-line bg-white shadow-lg">
                  {hits.map((a) => <li key={a.id}><button type="button" onClick={() => { setAsset(a.id); setQ(""); }} className="w-full px-3 py-2 text-left text-sm hover:bg-[#F2F6FA]"><b>{a.name}</b> <span className="text-muted">{[a.code, a.location].filter(Boolean).join(" · ")}</span></button></li>)}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Yer" hint="bölüm / oda"><input name="location" maxLength={120} defaultValue={sel?.location ?? ""} placeholder="ör. Döküm odası, ön büro" className={inputCls} /></Field>
        <Field label="Öncelik"><select name="priority" defaultValue="normal" className={selectCls}><option value="low">Düşük</option><option value="normal">Normal</option><option value="high">Yüksek</option><option value="urgent">🔴 Acil (iş durdu)</option></select></Field>
      </div>
      <Field label="Açıklama" hint="isteğe bağlı"><textarea name="description" rows={3} maxLength={2000} className={textareaCls} /></Field>
      <PhotoPicker value={pics} onChange={setPics} />
      <Msg state={state} />
      <div><button disabled={pending} className={btnPrimary}>{pending ? "Gönderiliyor…" : "Arızayı bildir"}</button></div>
    </form>
  );
}

/** Satın alma kararı */
export function ApproveForm({ id, techs, reassign = false }: { id: string; techs: { user_id: string; name: string; open_jobs: number }[]; reassign?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"tech" | "external" | "reject">("tech");
  const { state, pending, formProps } = useActionForm(approveTicket, { onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="mode" value={mode} />
      <div className="flex flex-wrap gap-1.5">
        {([["tech", "🔧 Teknisyene ata"], ["external", "🏢 Dış servise ver"], ...(reassign ? [] : [["reject", "Reddet"]])] as [typeof mode, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold border ${mode === k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>{l}</button>
        ))}
      </div>
      {mode === "tech" && (techs.length ? (
        <Field label="Teknisyen"><select name="tech" required className={selectCls}>{techs.map((t) => <option key={t.user_id} value={t.user_id}>{t.name} · {t.open_jobs} açık iş</option>)}</select></Field>
      ) : <Notice tone="warn">Teknik servis personeli tanımlı değil. Arıza / servis sayfasının altındaki “Teknik servis personeli” bölümünden ekleyin.</Notice>)}
      {mode === "external" && <Field label="Servis firması"><input name="vendor" required maxLength={160} placeholder="ör. HP Yetkili Servis, Mobilyacı Ahmet" className={inputCls} /></Field>}
      {mode !== "reject" && <Field label="Hedef tarih" hint="isteğe bağlı"><input type="date" name="due" className={inputCls} /></Field>}
      <Field label={mode === "reject" ? "Ret gerekçesi" : "Not"} hint={mode === "reject" ? "bildirene gider" : "isteğe bağlı"}><input name="note" required={mode === "reject"} maxLength={500} className={inputCls} /></Field>
      <Msg state={state} />
      <div><button disabled={pending} className={mode === "reject" ? `${btnPrimary} bg-bad hover:bg-bad` : btnPrimary}>{pending ? "Kaydediliyor…" : mode === "reject" ? "Reddet" : reassign ? "Yeniden ata" : "Onayla ve ata"}</button></div>
    </form>
  );
}

/** Teknisyen: yapıldı, ücret, sonra fotoğrafları */
export function DoneForm({ id, external }: { id: string; external: boolean }) {
  const router = useRouter();
  const [pics, setPics] = useState<string[]>([]);
  const { state, pending, formProps } = useActionForm(doneTicket, { prepare: (fd) => fd.set("photos", JSON.stringify(pics)), onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Field label="Ne yapıldı?"><textarea name="note" required rows={2} maxLength={2000} placeholder={external ? "ör. Servis kartuş kafasını değiştirdi" : "ör. Fiş değiştirildi, kablo yenilendi"} className={textareaCls} /></Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Ücret (TL, KDV dahil)" hint="ücretsizse boş bırakın"><input name="cost" inputMode="decimal" placeholder="0" className={`${inputCls} num`} /></Field>
        <Field label="Ücret açıklaması" hint="malzeme, işçilik, fatura no…"><input name="cost_note" maxLength={500} className={inputCls} /></Field>
      </div>
      <div className="flex flex-col gap-1.5"><span className="text-sm font-semibold">İş sonrası fotoğraf</span><PhotoPicker value={pics} onChange={setPics} label="📷 Sonra fotoğrafı" /></div>
      <Msg state={state} />
      <div><button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Tamamlandı"}</button></div>
    </form>
  );
}

/** Satın alma: ücret onayı */
export function CostForm({ id, cost }: { id: string; cost: string }) {
  const router = useRouter();
  const [ret, setRet] = useState(false);
  const { state, pending, formProps } = useActionForm(costTicket, { onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {!ret && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Onaylanan tutar (TL, KDV dahil)"><input name="cost" defaultValue={cost} inputMode="decimal" className={`${inputCls} num`} /></Field>
          <Field label="KDV oranı"><select name="vat" defaultValue="20" className={selectCls}><option value="20">%20</option><option value="10">%10</option><option value="1">%1</option><option value="0">KDV yok (fişsiz / muaf)</option></select></Field>
        </div>
      )}
      <Field label={ret ? "Neden geri gönderiliyor?" : "Not"} hint={ret ? "teknisyene gider" : "isteğe bağlı"}><input name="note" required={ret} maxLength={500} className={inputCls} /></Field>
      <Msg state={state} />
      <div className="flex flex-wrap gap-2">
        {!ret ? <><button name="action" value="approve" disabled={pending} className={btnPrimary}>Ücreti onayla · muhasebeye gönder</button><button type="button" onClick={() => setRet(true)} className={btnSecondary}>Geri gönder</button></>
          : <><button name="action" value="return" disabled={pending} className={btnPrimary}>Geri gönder</button><button type="button" onClick={() => setRet(false)} className={btnSecondary}>Vazgeç</button></>}
      </div>
    </form>
  );
}

/** Muhasebe: ödeme */
export function PayForm({ id, accounts }: { id: string; accounts: { id: string; name: string; kind: string }[] }) {
  const router = useRouter();
  const { state, pending, formProps } = useActionForm(payTicket, { onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Ödeme hesabı"><select name="account" required className={selectCls}><option value="">— Seçin —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind === "cash" ? "kasa" : a.kind === "bank" ? "banka" : "kart"})</option>)}</select></Field>
        <Field label="Ödeme tarihi"><input type="date" name="date" defaultValue={new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)} className={inputCls} /></Field>
      </div>
      <Msg state={state} />
      <div><button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Ödendi olarak işle"}</button></div>
    </form>
  );
}

export function AddPhoto({ id, stage }: { id: string; stage: "before" | "after" }) {
  const router = useRouter();
  const [pics, setPics] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <PhotoPicker value={pics} onChange={(v) => { setPics(v); if (v.length > pics.length) start(async () => { for (const p of v.slice(pics.length)) { const r = await addTicketPhoto(id, stage, p); if (!r.ok) setMsg(r.message); } setPics([]); router.refresh(); }); }} max={1} label={busy ? "Yükleniyor…" : "📷 Fotoğraf ekle"} />
      {msg && <span className="text-xs text-bad">{msg}</span>}
    </div>
  );
}

export function TechForm({ users }: { users: { user_id: string; display_name: string }[] }) {
  const router = useRouter();
  const { state, pending, formProps } = useActionForm(saveTechnician, { onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="grid gap-2 md:grid-cols-[1fr_160px_1fr_auto] items-end">
      <Field label="Kullanıcı"><select name="user_id" required className={selectCls}><option value="">— Seçin —</option>{users.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</select></Field>
      <Field label="Telefon"><input name="phone" maxLength={40} className={inputCls} /></Field>
      <Field label="Uzmanlık"><input name="skills" maxLength={200} placeholder="ör. elektrik, mobilya, cihaz" className={inputCls} /></Field>
      <button disabled={pending} className={btnPrimary}>Ekle</button>
      <div className="md:col-span-4"><Msg state={state} /></div>
    </form>
  );
}

export function MaintenanceButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => start(async () => { const r = await runMaintenanceDue(); setMsg(r.message); router.refresh(); })} className={btnSecondary}>{busy ? "Kontrol ediliyor…" : "🗓 Bakım zamanı gelenleri aç"}</button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
