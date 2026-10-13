"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useActionForm } from "@/lib/use-action-form";
import { resetPlan, resetRun, type ResetPlan } from "@/lib/reset-actions";

export type ModDef = { key: string; label: string; descr: string };

/** Birlikte silinmesi önerilen (zorunlu olmayan) modüller */
const PAIR: Record<string, { with: string; why: string }> = {
  bordro: { with: "finans", why: "Maaş / avans ödemelerinin kasa ve banka hareketleri Finans'ta durur; Finans'ı silmezseniz kasa bakiyelerinde kalır." },
  personel: { with: "puantaj", why: "Puantaj, izin ve bordro kayıtları personele bağlıdır." },
  lab_is: { with: "finans", why: "İşlerin tahsilat ve fatura hareketleri Finans'ta kalabilir." },
  musteri: { with: "lab_is", why: "Klinik kartları silinirse o kliniklerin işleri de silinmelidir." },
};

const step = (n: number, cur: number) => `flex items-center gap-2 text-sm font-semibold ${n === cur ? "text-brand-800" : n < cur ? "text-ok" : "text-muted"}`;

export function ResetWizard({ mods, counts, company }: { mods: ModDef[]; counts: Record<string, number>; company: string }) {
  const [cur, setCur] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<ResetPlan | null>(null);
  const [loading, start] = useTransition();
  const [backup, setBackup] = useState<"" | "done" | "skip">("");
  const [typed, setTyped] = useState("");
  const { state, pending, formProps } = useActionForm(resetRun);

  useEffect(() => {
    if (!picked.length) { setPlan(null); return; }
    start(async () => setPlan(await resetPlan(picked)));
  }, [picked]);

  const final = plan?.ok ? plan.modules : picked;
  const added = new Set(final.filter((m) => !picked.includes(m)));
  const label = (k: string) => mods.find((m) => m.key === k)?.label ?? k;
  const total = final.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const blockers = plan?.warnings.filter((w) => !w.cascade) ?? [];
  const cascades = plan?.warnings.filter((w) => w.cascade) ?? [];
  const tips = picked.filter((k) => PAIR[k] && !final.includes(PAIR[k]!.with));
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  if (state?.ok) {
    return (
      <section className="bg-white border border-ok/40 rounded-[14px] p-6 flex flex-col gap-3">
        <h2 className="font-display font-bold text-ok text-lg">Temizlik tamamlandı ✓</h2>
        <p className="text-sm">{state.message}</p>
        {(state.fileFail ?? 0) + (state.userFail ?? 0) > 0 && (
          <p className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">
            {state.fileFail ? `${state.fileFail} dosya depodan silinemedi. ` : ""}{state.userFail ? `${state.userFail} giriş hesabı silinemedi (ERP erişimleri yine de kaldırıldı). ` : ""}Supabase › Storage / Authentication&apos;dan elle silebilirsiniz.
          </p>
        )}
        <p className="text-sm text-muted">Silinen modüllere artık gerçek kayıtlarınızı girebilirsiniz. Şirket bilgileri, şubeler, ayarlar ve sizin hesabınız korundu.</p>
        <Link href="/" className="h-11 px-5 self-start inline-flex items-center rounded-xl bg-brand-700 text-white font-bold">Ana sayfaya dön</Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-x-6 gap-y-2">
        <li className={step(1, cur)}><span>1</span> Modülleri seçin</li>
        <li className={step(2, cur)}><span>2</span> Yedek alın</li>
        <li className={step(3, cur)}><span>3</span> Onaylayın ve silin</li>
      </ol>

      {cur === 1 && (
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <p className="text-sm text-muted">Silmek istediğiniz modülleri işaretleyin. Başka bir modüldeki kayıtlar silinecek kayıtlara bağlıysa o modül otomatik eklenir. <b>Şirket bilgileri, şubeler, ayarlar, yasal parametreler, kullanıcı türleri / yetkiler, izin ve belge türleri ile sizin hesabınız hiçbir zaman silinmez.</b></p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setPicked(mods.filter((m) => !["site_icerik", "tanimlar", "kullanicilar", "loglar"].includes(m.key)).map((m) => m.key))} className="text-[13px] px-3 py-1.5 rounded-full bg-[#E7F1FB] text-brand-700 font-semibold">Tüm hareket verileri (tanımlar, kullanıcılar ve site içeriği kalsın)</button>
            <button type="button" onClick={() => setPicked(mods.map((m) => m.key))} className="text-[13px] px-3 py-1.5 rounded-full border border-[#D5DEE8] text-[#33414F] font-semibold">Hepsini seç</button>
            <button type="button" onClick={() => setPicked([])} className="text-[13px] px-3 py-1.5 rounded-full border border-[#D5DEE8] text-[#33414F] font-semibold">Temizle</button>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">
            {mods.map((m) => {
              const on = final.includes(m.key);
              const auto = added.has(m.key);
              return (
                <li key={m.key}>
                  <label className={`flex gap-3 p-3 rounded-[12px] border cursor-pointer h-full ${on ? (auto ? "border-warn bg-warn-bg" : "border-bad/50 bg-bad-bg") : "border-line"}`}>
                    <input type="checkbox" checked={on} disabled={auto} onChange={() => toggle(m.key)} className="mt-1 w-5 h-5 accent-[#B42318] shrink-0" />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold text-sm">{m.label} <span className="num text-xs text-muted font-normal">· {(counts[m.key] ?? 0).toLocaleString("tr-TR")} kayıt</span></span>
                      <span className="text-xs text-muted">{m.descr}</span>
                      {auto && <span className="text-xs font-semibold text-warn">Bağlı kayıtlar nedeniyle otomatik eklendi</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {tips.map((k) => (
            <p key={k} className="text-sm rounded-lg px-3 py-2 bg-[#F0F6FD] text-brand-800">💡 {label(k)} ile birlikte <b>{label(PAIR[k]!.with)}</b> modülünü de silmeniz önerilir: {PAIR[k]!.why} <button type="button" onClick={() => toggle(PAIR[k]!.with)} className="font-semibold underline">Ekle</button></p>
          ))}
          {cascades.length > 0 && <p className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">Korunan tablolarda bağlı kayıtlar da silinecek: {cascades.map((w) => `${w.table} (${w.refers})`).join(", ")}</p>}
          {blockers.length > 0 && <p className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">Bu seçim silinemez; korunan tablolar bu kayıtlara bağlı: {blockers.map((w) => `${w.table} → ${w.refers}`).join(", ")}</p>}
          {plan && !plan.ok && <p className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{plan.message}</p>}
          <div className="flex items-center gap-3 flex-wrap border-t border-line pt-3">
            <span className="text-sm">{final.length ? <>Silinecek: <b>{final.length} modül</b> · yaklaşık <b className="num">{total.toLocaleString("tr-TR")}</b> kayıt</> : "Henüz modül seçilmedi"}{loading ? " · hesaplanıyor…" : ""}</span>
            <button type="button" disabled={!final.length || loading || blockers.length > 0 || (plan !== null && !plan.ok)} onClick={() => setCur(2)} className="h-11 px-5 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-40 ml-auto">Devam →</button>
          </div>
        </section>
      )}

      {cur === 2 && (
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <h2 className="font-display font-bold text-brand-800">Silmeden önce yedek alın</h2>
          <p className="text-sm text-muted">Seçtiğiniz modüllerin tüm kayıtları tek bir dosyaya (JSON) indirilir. Silme geri alınamaz; bir şey lazım olursa bu dosyadan geri yükleyebiliriz. Özlük belgeleri gibi dosyalar yedeğe dahil değildir.</p>
          <a href={`/api/sistem-temizle/yedek?m=${final.join(",")}`} onClick={() => setBackup("done")} className="h-11 px-5 self-start inline-flex items-center rounded-xl border border-brand-700 text-brand-700 font-bold">⬇ Yedeği indir ({final.length} modül)</a>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={backup === "skip"} onChange={(e) => setBackup(e.target.checked ? "skip" : "")} className="w-5 h-5" /> Yedek istemiyorum, bu kayıtlar zaten deneme kayıtları</label>
          <div className="flex gap-3 border-t border-line pt-3">
            <button type="button" onClick={() => setCur(1)} className="h-11 px-4 rounded-xl border border-[#D5DEE8] font-semibold">← Geri</button>
            <button type="button" disabled={!backup} onClick={() => setCur(3)} className="h-11 px-5 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-40 ml-auto">Devam →</button>
          </div>
        </section>
      )}

      {cur === 3 && (
        <form {...formProps} className="bg-white border border-bad/50 rounded-[14px] p-4 flex flex-col gap-3">
          <input type="hidden" name="modules" value={JSON.stringify(final)} />
          <h2 className="font-display font-bold text-bad">Son onay — bu işlem geri alınamaz</h2>
          <p className="text-sm">{company} şirketinde şu modüllerin <b className="num">{total.toLocaleString("tr-TR")}</b> kaydı kalıcı olarak silinecek:</p>
          <ul className="flex flex-wrap gap-2">{final.map((k) => <li key={k} className="text-[13px] px-3 py-1 rounded-full bg-bad-bg text-bad font-semibold">{label(k)}</li>)}</ul>
          {final.includes("kullanicilar") && <p className="text-sm text-warn">Sizin dışınızdaki tüm kullanıcıların girişi kapanacak; yeniden davet etmeniz gerekecek.</p>}
          {final.includes("musteri") && <p className="text-sm text-warn">Klinik ve hekimlerin site (portal) girişleri de silinecek.</p>}
          <label className="flex flex-col gap-1 text-sm max-w-xs">
            Onaylamak için <b>SİL</b> yazın
            <input name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11 rounded-lg border border-[#D5DEE8] px-3 font-bold tracking-widest" />
          </label>
          {state && !state.ok && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
          <div className="flex gap-3 border-t border-line pt-3">
            <button type="button" onClick={() => setCur(2)} className="h-11 px-4 rounded-xl border border-[#D5DEE8] font-semibold">← Geri</button>
            <button disabled={pending || typed.trim().toLocaleUpperCase("tr") !== "SİL"} className="h-11 px-5 rounded-xl bg-[#B42318] text-white font-bold disabled:opacity-40 ml-auto">{pending ? "Siliniyor… (sayfayı kapatmayın)" : "Kalıcı olarak sil"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
