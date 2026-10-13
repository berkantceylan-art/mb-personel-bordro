"use client";
import { useState } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { supUserAdd } from "@/lib/supplier-user-actions";
import { CopyText } from "@/components/CopyText";

const inp = "h-10 rounded-[10px] border border-[#D5DEE8] px-3 bg-white";

export function AddSupplierUser({ parties }: { parties: { id: string; name: string; email: string | null; phone: string | null }[] }) {
  const { state, pending, formProps } = useActionForm(supUserAdd);
  const [party, setParty] = useState("");
  const [q, setQ] = useState("");
  const p = parties.find((x) => x.id === party);
  return (
    <form {...formProps} className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <h2 className="font-display font-bold text-brand-800">Tedarikçiye kullanıcı tanımla</h2>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tedarikçi
          <input list="sup-parties" value={q} onChange={(e) => { setQ(e.target.value); setParty(parties.find((x) => x.name === e.target.value)?.id ?? ""); }} placeholder="Yazarak seçin" className={`${inp} w-64 text-ink`} />
          <datalist id="sup-parties">{parties.map((x) => <option key={x.id} value={x.name} />)}</datalist>
        </label>
        <input type="hidden" name="party_id" value={party} />
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Ad soyad<input name="name" required className={`${inp} w-48 text-ink`} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">E-posta (giriş)<input key={`e${party}`} name="email" type="email" required defaultValue={p?.email ?? ""} className={`${inp} w-56 text-ink`} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Telefon (WhatsApp)<input key={`p${party}`} name="phone" defaultValue={p?.phone ?? ""} className={`${inp} w-40 text-ink`} /></label>
        <label className="flex items-center gap-2 text-sm h-10"><input type="checkbox" name="send_mail" value="1" defaultChecked className="w-5 h-5" /> Daveti e-postayla gönder</label>
        <button disabled={pending || !party} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-bold disabled:opacity-40">{pending ? "Oluşturuluyor…" : "Davet oluştur"}</button>
      </div>
      {state && (
        <div role="status" className={`text-sm rounded-lg px-3 py-2 flex flex-wrap items-center gap-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>
          <span className="flex-1 min-w-[200px]">{state.message}</span>
          {state.link && <CopyText text={state.link} label="Davet bağlantısını kopyala" className="h-8 px-2 rounded-lg border border-[#D5DEE8] bg-white text-xs font-semibold text-ink" />}
          {state.wa && <a href={state.wa} target="_blank" rel="noreferrer" className="h-8 px-2 inline-flex items-center rounded-lg border border-[#25D366] bg-white text-xs font-semibold text-[#128C4B]">WhatsApp&apos;tan gönder</a>}
        </div>
      )}
      <p className="text-xs text-muted">Kişi davet bağlantısından kendi şifresini belirler; yalnız bu tedarikçiye verilen ve onaylanmış siparişleri görür. Fiyat ve tutarlar siparişte olduğu gibi görünür.</p>
    </form>
  );
}
