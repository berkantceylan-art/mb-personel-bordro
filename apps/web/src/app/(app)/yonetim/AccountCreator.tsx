"use client";
import { useActionState, useMemo, useState } from "react";
import { createAccounts, resetPassword, type CreateResult } from "@/lib/users-actions";

type Emp = { employee_id: string; name: string; card_no: string | null; department: string | null; email: string | null; open_invite: string | null };
type Ty = { id: string; name: string; color: string; description: string | null };

/** Giriş bilgileri kartı: yazdırılıp kişiye verilir (şifre yalnız bu ekranda bir kez görünür) */
export function Credentials({ res, url }: { res: CreateResult; url: string }) {
  if (!res.rows.length) return <p role="status" className={`rounded-[12px] px-4 py-3 text-sm font-semibold ${res.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{res.message}</p>;
  return (
    <section className="print-area rounded-[16px] border-2 border-brand-600 bg-white p-4 flex flex-col gap-3">
      <style>{`@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; inset: 0; border: 0; } .no-print { display: none !important; } }`}</style>
      <div className="flex flex-wrap items-center gap-3">
        <p className={`text-sm font-semibold ${res.ok ? "text-ok" : "text-bad"}`}>{res.message}</p>
        <button type="button" onClick={() => window.print()} className="no-print ml-auto h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Yazdır</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {res.rows.map((r, i) => (
          <div key={i} className={`rounded-[12px] border border-dashed p-3 break-inside-avoid ${r.error ? "border-bad bg-bad-bg" : "border-[#9AA7B4]"}`}>
            <b className="block text-base">{r.name}</b>
            {r.error ? <span className="text-sm text-bad">{r.error}</span> : (
              <dl className="mt-1 grid grid-cols-[110px_1fr] gap-y-1 text-sm">
                <dt className="text-muted">Adres</dt><dd className="font-mono">{url}</dd>
                <dt className="text-muted">Kullanıcı adı</dt><dd className="font-mono font-bold">{r.login}</dd>
                {r.password && <><dt className="text-muted">Geçici şifre</dt><dd className="font-mono font-bold text-lg tracking-wider">{r.password}</dd></>}
                {r.code && <><dt className="text-muted">Davet kodu</dt><dd className="font-mono font-bold text-lg tracking-wider">{r.code}</dd></>}
              </dl>
            )}
            {!r.error && <p className="mt-2 text-[11px] text-muted">{r.password ? "Giriş yaptıktan sonra Ayarlar › Şifremi değiştir’den kendi şifrenizi belirleyin." : "Uygulamada “Hesap oluştur” deyip kodu girin ve şifrenizi belirleyin."}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Tek ekranda hesap açma: personel seç → tür seç → aç */
export function AccountCreator({ employees, types, defaultType, url, keyReady }: { employees: Emp[]; types: Ty[]; defaultType: string; url: string; keyReady: boolean }) {
  const [res, act, pending] = useActionState(createAccounts, null);
  const [mode, setMode] = useState<"personel" | "dis">("personel");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [bulk, setBulk] = useState(defaultType);
  const [rowType, setRowType] = useState<Record<string, string>>({});
  const [pw, setPw] = useState(keyReady ? "auto" : "invite");
  const list = useMemo(() => employees.filter((e) => !q || `${e.name} ${e.card_no ?? ""} ${e.department ?? ""}`.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))), [employees, q]);
  const all = list.length > 0 && list.every((e) => sel.has(e.employee_id));
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };

  return (
    <div className="flex flex-col gap-4">
      {res && <Credentials res={res} url={url} />}
      <form action={act} className="flex flex-col gap-4">
        <input type="hidden" name="mode" value={mode} />
        <div className="flex flex-wrap gap-2">
          {([["personel", `Personele hesap (${employees.length} kişinin hesabı yok)`], ["dis", "Dışarıdan biri (mali müşavir, ortak…)"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={`h-10 px-4 rounded-full text-sm font-semibold border ${mode === k ? "bg-ink text-white border-ink" : "bg-white border-line"}`}>{l}</button>
          ))}
        </div>

        {mode === "personel" ? (
          <section className="bg-white border border-line rounded-[16px] overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-3 border-b border-line">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Personel ara…" className="h-10 flex-1 min-w-48 rounded-[10px] border border-[#D5DEE8] px-3" />
              <label className="flex items-center gap-2 text-sm font-semibold">Seçilenlerin türü
                <select name="type_id" value={bulk} onChange={(e) => { setBulk(e.target.value); setRowType({}); }} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
            </div>
            <div className="max-h-[440px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#F8FAFC] text-xs text-muted text-left">
                  <tr>
                    <th className="p-3 w-10"><input type="checkbox" aria-label="Tümünü seç" checked={all} onChange={() => setSel(all ? new Set() : new Set(list.map((e) => e.employee_id)))} className="w-4 h-4" /></th>
                    <th className="p-3">Personel</th><th className="p-3">Kullanıcı adı</th><th className="p-3">Tür</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => {
                    const on = sel.has(e.employee_id);
                    const def = e.email ?? (e.card_no ? e.card_no.replace(/\D/g, "") : "");
                    return (
                      <tr key={e.employee_id} className={`border-t border-[#EEF2F6] ${on ? "bg-[#F2F7FD]" : ""}`}>
                        <td className="p-3"><input type="checkbox" name="employee_id" value={e.employee_id} checked={on} onChange={() => toggle(e.employee_id)} aria-label={e.name} className="w-4 h-4" /></td>
                        <td className="p-3" onClick={() => toggle(e.employee_id)}><b>{e.name}</b><span className="block text-xs text-muted">{e.department ?? ""}{e.open_invite ? " · bekleyen davet kodu var" : ""}</span></td>
                        <td className="p-3"><input name={`login_${e.employee_id}`} placeholder={def || "PDKS no"} disabled={!on} className="h-9 w-44 rounded-md border border-[#D5DEE8] px-2 font-mono text-xs disabled:bg-transparent disabled:border-transparent" /></td>
                        <td className="p-3">
                          <select name={`type_${e.employee_id}`} disabled={!on} value={rowType[e.employee_id] ?? bulk} onChange={(x) => setRowType({ ...rowType, [e.employee_id]: x.target.value })} className="h-9 rounded-md border border-[#D5DEE8] bg-white px-1 text-xs disabled:opacity-50">
                            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                  {list.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">{employees.length ? "Aramaya uyan personel yok." : "Tüm aktif personelin hesabı var."}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="bg-white border border-line rounded-[16px] p-4 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">Ad soyad<input name="name" required className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">E-posta (kullanıcı adı)<input name="email" type="email" required className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 font-normal" /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Tür<select name="type_id" defaultValue={defaultType} className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-2 font-normal">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          </section>
        )}

        <section className="bg-white border border-line rounded-[16px] p-4 flex flex-col gap-3">
          <div className="text-sm font-semibold">Şifre</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {keyReady && <label className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 ${pw === "auto" ? "border-brand-600 bg-[#F2F7FD]" : "border-line"}`}><input type="radio" name="pw" value="auto" checked={pw === "auto"} onChange={() => setPw("auto")} />Otomatik geçici şifre <span className="text-muted">(önerilen)</span></label>}
            {keyReady && <label className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 ${pw === "manual" ? "border-brand-600 bg-[#F2F7FD]" : "border-line"}`}><input type="radio" name="pw" value="manual" checked={pw === "manual"} onChange={() => setPw("manual")} />Şifreyi ben yazayım</label>}
            <label className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 ${pw === "invite" ? "border-brand-600 bg-[#F2F7FD]" : "border-line"}`}><input type="radio" name="pw" value="invite" checked={pw === "invite"} onChange={() => setPw("invite")} />Davet kodu ver, şifresini kendisi belirlesin</label>
          </div>
          {pw === "manual" && <input name="password" type="text" minLength={6} maxLength={72} placeholder="En az 6 karakter (herkese aynı)" className="h-11 max-w-xs rounded-[10px] border border-[#D5DEE8] px-3 font-mono" />}
          {!keyReady && <p className="text-xs text-muted">Şifreyle anında hesap açmak için Vercel&apos;de sunucu hesap anahtarı tanımlı olmalı; şu an davet koduyla açılır.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={pending || (mode === "personel" && sel.size === 0)} className="h-12 px-6 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">
              {pending ? "Açılıyor…" : mode === "personel" ? `${sel.size || ""} hesap aç` : "Hesap aç"}
            </button>
            <span className="text-xs text-muted">Kullanıcı adı boş bırakılırsa e-postası, yoksa PDKS numarası olur. Girişte numarayı yazmak yeterli.</span>
          </div>
        </section>
      </form>
    </div>
  );
}

/** Kullanıcı sayfasında şifre sıfırlama */
export function ResetPassword({ userId, url }: { userId: string; url: string }) {
  const [res, act, pending] = useActionState(resetPassword, null);
  return (
    <div className="flex flex-col gap-3">
      <form action={act}><input type="hidden" name="user_id" value={userId} /><button disabled={pending} className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700 disabled:opacity-50">{pending ? "…" : "Şifre sıfırla"}</button></form>
      {res && <Credentials res={res} url={url} />}
    </div>
  );
}
