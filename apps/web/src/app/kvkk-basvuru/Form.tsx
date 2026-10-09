"use client";
import { useActionState } from "react";
import { REQUEST_TYPES } from "@/lib/kvkk";
import { submitPublicKvkk, type R } from "./actions";

const inp = "h-12 w-full rounded-[10px] border border-[#C9D4E0] bg-white px-3 text-base";

export function PublicKvkkForm() {
  const [state, action, pending] = useActionState<R | null, FormData>(submitPublicKvkk, null);
  if (state?.ok) return <p role="status" className="rounded-lg bg-[#E6F4EC] text-[#1A7F52] p-3 font-semibold">Başvurunuz alındı. En geç 30 gün içinde verdiğiniz iletişim bilgisinden yanıtlanacaktır.</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="flex flex-col gap-1 text-sm font-semibold text-[#33475B]">Ad soyad<input name="name" required className={inp} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-[#33475B]">Telefon veya e-posta<input name="contact" required className={inp} /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-[#33475B]">İlişkiniz<select name="rel" className={inp}><option value="aday">İş başvurusu yaptım</option><option value="eski_calisan">Eski çalışanım</option><option value="calisan">Çalışanım</option><option value="diger">Diğer</option></select></label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-[#33475B]">Talep<select name="type" className={inp}>{Object.entries(REQUEST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-[#33475B]">Açıklama<textarea name="details" required rows={4} className="rounded-[10px] border border-[#C9D4E0] bg-white px-3 py-2 text-base" /></label>
      {state && !state.ok && <p role="alert" className="text-sm font-semibold text-[#9B1C1C]">{state.message}</p>}
      <button disabled={pending} className="h-12 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{pending ? "Gönderiliyor…" : "Başvuruyu gönder"}</button>
    </form>
  );
}
