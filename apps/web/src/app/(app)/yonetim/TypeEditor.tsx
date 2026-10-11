"use client";
import { useMemo, useState } from "react";
import { FLOW_LABEL, MOD_GROUPS, MOD_INFO, ROLE_LABEL, TYPE_COLORS, typeRole } from "@/lib/users";
import { saveUserType } from "@/lib/users-actions";

type T = { id?: string; name: string; description: string | null; color: string; levels: Record<string, number>; scoped: boolean; site_access: boolean; boss: boolean; flow_role: string | null };

const PRESETS: { label: string; levels: Record<string, number> }[] = [
  { label: "Hepsini kapat", levels: {} },
  { label: "Her şeyi görsün", levels: Object.fromEntries(MOD_INFO.filter((m) => m.key !== "users").map((m) => [m.key, 1])) },
];
const LV = ["Yok", "Görür", "Düzenler", "Yönetir"];
const LV_ON = ["bg-white text-muted shadow-sm", "bg-[#2563EB] text-white", "bg-[#D97706] text-white", "bg-[#059669] text-white"];

/** Kullanıcı türü düzenleyici: modül başına tek dokunuşla seviye; sağda canlı özet */
export function TypeEditor({ initial }: { initial: T }) {
  const [lv, setLv] = useState<Record<string, number>>(initial.levels ?? {});
  const [color, setColor] = useState(initial.color || TYPE_COLORS[0]!);
  const [name, setName] = useState(initial.name);
  const [scoped, setScoped] = useState(initial.scoped);
  const [flow, setFlow] = useState(initial.flow_role ?? "");
  const role = useMemo(() => typeRole(lv, scoped), [lv, scoped]);
  const on = MOD_INFO.filter((m) => (lv[m.key] ?? 0) > 0);
  const hrSide = (lv.hr ?? 0) + (lv.attendance ?? 0) > 0;

  return (
    <form action={saveUserType} className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {Object.entries(lv).map(([k, v]) => <input key={k} type="hidden" name={`lv_${k}`} value={v} />)}
      <input type="hidden" name="color" value={color} />
      <div className="flex flex-col gap-5 min-w-0">
        <section className="bg-white border border-line rounded-[18px] p-5 grid gap-4 sm:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">Tür adı
            <input name="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Ön muhasebeci" className="h-12 rounded-[12px] border border-[#D5DEE8] px-3 text-lg font-semibold" />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-semibold">Renk
            <div className="flex flex-wrap gap-1.5 max-w-[200px]">
              {TYPE_COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={`w-7 h-7 rounded-full ${color === c ? "ring-2 ring-offset-2 ring-ink" : ""}`} style={{ background: c }} />)}
            </div>
          </div>
          <label className="sm:col-span-2 flex flex-col gap-1.5 text-sm font-semibold">Açıklama <span className="font-normal text-muted text-xs">(listede görünür, isteğe bağlı)</span>
            <input name="description" maxLength={200} defaultValue={initial.description ?? ""} placeholder="ör. Fatura, tahsilat ve cari; bordro görmez" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3" />
          </label>
        </section>

        <section className="bg-white border border-line rounded-[18px] overflow-hidden">
          <header className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-line">
            <h2 className="font-display text-lg font-bold mr-auto">Hangi modülleri kullanacak?</h2>
            {PRESETS.map((p) => <button key={p.label} type="button" onClick={() => setLv(p.levels)} className="text-xs font-semibold text-brand-700 px-2 py-1 rounded-md hover:bg-[#EAF2FB]">{p.label}</button>)}
          </header>
          {MOD_GROUPS.map((g) => (
            <div key={g}>
              <div className="px-5 pt-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{g}</div>
              {MOD_INFO.filter((m) => m.group === g).map((m) => {
                const v = lv[m.key] ?? 0;
                return (
                  <div key={m.key} className={`flex flex-col gap-2 px-5 py-3 border-t border-[#F0F3F7] sm:flex-row sm:items-center ${v ? "" : "opacity-80"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{m.label}</div>
                      <div className="text-xs text-muted">{v ? <><b className="text-ink">{m.levels[v - 1]}</b> · {m.desc}</> : m.desc}</div>
                    </div>
                    <div role="radiogroup" aria-label={m.label} className="grid grid-cols-4 gap-0.5 rounded-[10px] bg-[#EEF2F6] p-0.5 text-xs font-semibold shrink-0 sm:w-[300px]">
                      {LV.map((l, i) => (
                        <button key={l} type="button" role="radio" aria-checked={v === i} onClick={() => setLv({ ...lv, [m.key]: i })}
                          className={`h-9 rounded-[8px] transition ${v === i ? LV_ON[i] : "text-muted hover:text-ink"}`} title={i ? m.levels[i - 1] : "Kullanmaz"}>{l}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <section className="bg-white border border-line rounded-[18px] p-5 flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Ek ayarlar</h2>
          {hrSide && (
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="scoped" checked={scoped} onChange={(e) => setScoped(e.target.checked)} className="mt-1 w-4 h-4" />
              <span><b>Yalnız kendi bölümünün personelini görsün</b><span className="block text-muted">Şef gibi: kullanıcının sayfasından sorumlu olduğu şube / bölümler seçilir; ücret bilgisi görmez.</span></span>
            </label>
          )}
          <label className="flex items-center gap-3 text-sm"><span className="min-w-40 font-semibold">Kutu akışındaki görevi</span>
            <select name="flow_role" value={flow} onChange={(e) => setFlow(e.target.value)} className="h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
              <option value="">Yok</option>{Object.entries(FLOW_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="site" defaultChecked={initial.site_access} className="mt-1 w-4 h-4" /><span><b>Web sitesi yönetimi</b><span className="block text-muted">Aynı şifreyle mbdentaire.com yönetim paneline girer.</span></span></label>
          {role === "accountant" && <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="boss" defaultChecked={initial.boss} className="mt-1 w-4 h-4" /><span><b>Patron ekranı</b><span className="block text-muted">Mobilde maaş yükü, SGK, devamsızlık özeti.</span></span></label>}
        </section>
      </div>

      <aside className="lg:sticky lg:top-4 flex flex-col gap-3">
        <div className="rounded-[18px] overflow-hidden border border-line bg-white">
          <div className="p-5 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}CC)` }}>
            <div className="text-xs uppercase tracking-wider text-white/70">Kullanıcı türü</div>
            <div className="font-display text-2xl font-bold leading-tight">{name || "Yeni tür"}</div>
            <div className="mt-1 text-sm text-white/85">{on.length ? `${on.length} modül` : "Yalnız kendi sayfası"}{flow ? ` · ${FLOW_LABEL[flow]}` : ""}</div>
          </div>
          <ul className="p-4 flex flex-col gap-2 text-sm">
            {on.map((m) => <li key={m.key} className="flex justify-between gap-2"><span>{m.label}</span><b className={["", "text-[#2563EB]", "text-[#D97706]", "text-[#059669]"][lv[m.key]!]}>{m.levels[lv[m.key]! - 1]}</b></li>)}
            {!on.length && <li className="text-muted">Telefondan kendi puantajı, izni, bordrosu, avans ve masraf beyanı.</li>}
          </ul>
          <div className="border-t border-line px-4 py-3 text-xs text-muted">Veri erişimi: <b className="text-ink">{ROLE_LABEL[role]}</b>{role !== "employee" && <span className="block mt-0.5">İnsan kaynakları verileri bu erişimle korunur; menüde yalnız seçili modüller görünür.</span>}</div>
        </div>
        <button className="h-12 rounded-[12px] bg-brand-700 text-white font-bold text-base hover:bg-brand-800">{initial.id ? "Kaydet ve herkese uygula" : "Türü oluştur"}</button>
        {initial.id && <p className="text-xs text-muted text-center">Kaydedince bu türdeki tüm kullanıcıların yetkisi güncellenir.</p>}
      </aside>
    </form>
  );
}
