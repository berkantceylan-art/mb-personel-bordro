"use client";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { visWalkin } from "@/lib/visitor-public-actions";

const inp = "h-12 w-full rounded-xl border border-[#D5DEE8] bg-white px-4 text-base text-ink focus:border-brand-600 focus:outline-none";

/** Randevusuz ziyaretçi: bilgilerini girer, onay sayfasına geçer */
export function WalkinForm({ hosts }: { hosts: Array<{ id: string; label: string; description: string | null }> }) {
  const router = useRouter();
  const { state, pending, formProps } = useActionForm(visWalkin, { onSuccess: (st) => { if (st.token) router.push(`/z/${st.token}`); } });
  return (
    <form {...formProps} className="flex flex-col gap-3 text-left">
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1.5 text-sm font-semibold">Siz kimsiniz?</legend>
        {[["supplier", "📦 Tedarikçi"], ["customer", "🤝 Müşteri"], ["doctor", "🦷 Hekim / klinik"], ["other", "👤 Diğer"]].map(([v, l], i) => (
          <label key={v} className="flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-[#D5DEE8] bg-white px-3 text-sm font-semibold has-[:checked]:border-brand-700 has-[:checked]:bg-[#EEF4FB]">
            <input type="radio" name="visitor_type" value={v} defaultChecked={i === 0} className="accent-[#1F4E79]" />{l}
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1 text-sm font-semibold">Ad soyad<input name="name" required minLength={2} maxLength={120} autoComplete="name" className={inp} /></label>
      <label className="grid gap-1 text-sm font-semibold">Firma / klinik<input name="company" maxLength={120} autoComplete="organization" className={inp} /></label>
      <label className="grid gap-1 text-sm font-semibold">Telefon<input name="phone" required type="tel" inputMode="tel" maxLength={40} autoComplete="tel" placeholder="05xx xxx xx xx" className={inp} /></label>
      {hosts.length > 0 && (
        <label className="grid gap-1 text-sm font-semibold">Kimi ziyaret ediyorsunuz?
          <select name="host" defaultValue="" className={inp}>
            <option value="">Bilmiyorum · güvenlik yönlendirsin</option>
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.label}{h.description ? ` · ${h.description}` : ""}</option>)}
          </select>
        </label>
      )}
      <label className="grid gap-1 text-sm font-semibold">Ziyaret amacı<input name="purpose" maxLength={200} placeholder="ör. malzeme teslimi, toplantı, iş teslimi" className={inp} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm font-semibold">Kişi sayısı<input name="count" type="number" min={1} max={20} defaultValue={1} className={inp} /></label>
        <label className="grid gap-1 text-sm font-semibold">Araç plakası<input name="plate" maxLength={20} placeholder="isteğe bağlı" className={`${inp} uppercase`} /></label>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" name="kvkk" required className="mt-0.5" /> Kişisel verilerimin ziyaret ve güvenlik amacıyla işlenmesine ilişkin aydınlatmayı okudum, kabul ediyorum.</label>
      {state && !state.ok && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{state.message}</p>}
      <button disabled={pending} className="h-14 rounded-xl bg-brand-700 text-lg font-bold text-white disabled:opacity-60">{pending ? "Gönderiliyor…" : "Giriş için onay iste"}</button>
    </form>
  );
}
