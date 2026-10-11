"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, inputCls } from "@/components/erp";
import { visSave } from "@/lib/visitor-actions";

/** Personel: misafirini önceden kaydet, QR davetiye bağlantısını paylaş */
export function InviteForm({ origin }: { origin: string }) {
  const router = useRouter();
  const [done, setDone] = useState<{ token: string; no: string; name: string; phone: string } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const { state, pending, formProps } = useActionForm(visSave, { onSuccess: (st) => { if (st.token) setDone({ token: st.token, no: st.no ?? "", name, phone }); router.refresh(); } });
  const link = done ? `${origin}/z/${done.token}` : "";
  const wa = done ? `https://wa.me/${done.phone.replace(/\D/g, "").replace(/^0/, "90")}?text=${encodeURIComponent(`Merhaba ${done.name}, ziyaretiniz için giriş davetiyeniz: ${link} — girişte bu QR kodu güvenliğe gösterin.`)}` : "";
  if (done) {
    return (
      <div className="flex flex-col gap-3 rounded-[14px] border-2 border-[#22C55E]/40 bg-[#F0FDF4] p-4">
        <b>✓ {done.no} davet oluşturuldu</b>
        <p className="text-sm">Misafirinize bu bağlantıyı gönderin; girişte QR kodu güvenliğe gösterir. Geldiğinde size bildirim gelir.</p>
        <input readOnly value={link} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-xs`} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className="h-11 rounded-[10px] border border-line bg-white px-4 font-semibold">Bağlantıyı kopyala</button>
          {done.phone && <a href={wa} target="_blank" rel="noreferrer" className="h-11 rounded-[10px] bg-[#25D366] px-4 font-semibold leading-[44px] text-white">WhatsApp ile gönder</a>}
          <a href={link} target="_blank" rel="noreferrer" className="h-11 rounded-[10px] border border-line bg-white px-4 font-semibold leading-[44px]">Davetiyeyi aç</a>
          <button type="button" onClick={() => { setDone(null); setName(""); setPhone(""); }} className="h-11 px-3 text-sm font-semibold text-brand-700">Yeni davet</button>
        </div>
      </div>
    );
  }
  return (
    <form {...formProps} className="grid gap-3 md:grid-cols-2">
      <Field label="Ziyaretçi adı soyadı"><input name="visitor_name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} className={inputCls} /></Field>
      <Field label="Firması" hint="isteğe bağlı"><input name="visitor_company" maxLength={120} className={inputCls} /></Field>
      <Field label="Telefonu" hint="WhatsApp ile davetiye için"><input name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} className={inputCls} /></Field>
      <Field label="Geliş zamanı"><input type="datetime-local" name="expected_at" className={inputCls} /></Field>
      <Field label="Ziyaret amacı" hint="isteğe bağlı"><input name="purpose" maxLength={200} placeholder="ör. Toplantı, teslimat, servis" className={inputCls} /></Field>
      <Field label="Araç plakası" hint="isteğe bağlı"><input name="plate" maxLength={20} className={inputCls} /></Field>
      {state && !state.ok && <div className="md:col-span-2"><Notice tone="bad">{state.message}</Notice></div>}
      <div className="md:col-span-2"><button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Davet oluştur"}</button></div>
    </form>
  );
}
