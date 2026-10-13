"use client";
import { useActionForm } from "@/lib/use-action-form";
import { supInviteAccept } from "@/lib/supplier-invite-actions";

export function InviteForm({ code, email }: { code: string; email: string }) {
  const { state, pending, formProps } = useActionForm(supInviteAccept);
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="code" value={code} />
      <label className="flex flex-col gap-1 text-sm font-semibold">E-posta<input value={email} readOnly className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-[#F3F6F9] font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Şifre belirleyin<input type="password" name="password" minLength={8} required autoComplete="new-password" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Şifre (tekrar)<input type="password" name="password2" minLength={8} required autoComplete="new-password" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>
      <button disabled={pending} className="h-11 rounded-[10px] bg-brand-700 text-white font-bold disabled:opacity-50">{pending ? "Hesap açılıyor…" : "Hesabı aç ve siparişleri gör"}</button>
      {state && !state.ok && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
      <p className="text-xs text-muted">Sonraki girişlerde bu e-posta ve şifreyle giriş sayfasından girersiniz.</p>
    </form>
  );
}
