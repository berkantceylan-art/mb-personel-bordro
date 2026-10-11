"use client";
import { useState, useTransition } from "react";
import { saveFlow, type StepInput } from "@/lib/approval-actions";

export type FlowData = { id?: string; entity: string; name: string; min_amount: number; max_amount: number | null; category_id: string | null; priority: number; is_active: boolean; steps: StepInput[] };
type Opt = { id: string; name: string };

const KIND: Record<string, string> = { manager: "Personelin yöneticisi / şefi", user: "Belirli kişi", module: "Modül yetkilisi", owner: "Şirket sahibi" };
const tl = (k: number | null | undefined) => (k ? String(k / 100).replace(".", ",") : "");

/** Onay akışı düzenleyici: koşullar ve sıralı adımlar */
export function FlowEditor({ flow, users, categories, modules }: { flow?: FlowData; users: Opt[]; categories: Opt[]; modules: { key: string; label: string; levels: string[] }[] }) {
  const [f, setF] = useState({
    entity: flow?.entity ?? "expense_claim", name: flow?.name ?? "", min: tl(flow?.min_amount), max: tl(flow?.max_amount), cat: flow?.category_id ?? "",
    prio: String(flow?.priority ?? 0), active: flow?.is_active ?? true,
  });
  const [steps, setSteps] = useState<StepInput[]>(flow?.steps?.length ? flow.steps : [{ approver_kind: "manager", label: "Yönetici" }]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const inp = "h-9 rounded-[8px] border border-line bg-white px-2 text-sm";
  const upd = (i: number, p: Partial<StepInput>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); setSteps(n); };

  function save(del = false) {
    setMsg(null);
    start(async () => {
      const r = await saveFlow({ id: flow?.id, entity: f.entity, name: f.name, min_amount: f.min, max_amount: f.max, category_id: f.cat, priority: f.prio, is_active: f.active, steps, delete: del });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && !flow) { setF({ ...f, name: "", min: "", max: "" }); setSteps([{ approver_kind: "manager", label: "Yönetici" }]); }
    });
  }

  return (
    <div className={`flex flex-col gap-3 ${f.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs font-semibold text-muted flex flex-col gap-1">Belge<select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} className={inp}><option value="expense_claim">Masraf beyanı</option><option value="purchase_order">Satın alma siparişi</option></select></label>
        <label className="text-xs font-semibold text-muted flex flex-col gap-1">Akış adı<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="ör. 5.000 TL üstü masraf" className={`${inp} w-56`} /></label>
        <label className="text-xs font-semibold text-muted flex flex-col gap-1">En az (₺)<input value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} inputMode="decimal" className={`${inp} w-28`} /></label>
        <label className="text-xs font-semibold text-muted flex flex-col gap-1">En çok (₺)<input value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} inputMode="decimal" placeholder="sınırsız" className={`${inp} w-28`} /></label>
        {f.entity === "expense_claim" && <label className="text-xs font-semibold text-muted flex flex-col gap-1">Masraf türü<select value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })} className={`${inp} w-44`}><option value="">Hepsi</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="text-xs font-semibold text-muted flex flex-col gap-1">Öncelik<input value={f.prio} onChange={(e) => setF({ ...f, prio: e.target.value.replace(/[^\d-]/g, "") })} className={`${inp} w-16`} /></label>
        <label className="text-sm flex items-center gap-1.5 h-9"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktif</label>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap gap-2 items-center rounded-[12px] bg-[#F8FAFC] border border-line p-2">
            <b className="w-14 text-sm">{i + 1}. adım</b>
            <select value={s.approver_kind} onChange={(e) => upd(i, { approver_kind: e.target.value })} className={inp}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {s.approver_kind === "user" && <select value={s.user_id ?? ""} onChange={(e) => upd(i, { user_id: e.target.value })} className={`${inp} w-48`}><option value="">Kişi seçin</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
            {s.approver_kind === "module" && (
              <>
                <select value={s.module ?? ""} onChange={(e) => upd(i, { module: e.target.value })} className={`${inp} w-44`}><option value="">Modül seçin</option>{modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
                <select value={String(s.level ?? 2)} onChange={(e) => upd(i, { level: Number(e.target.value) })} className={inp}>{[1, 2, 3].map((l) => <option key={l} value={l}>{modules.find((m) => m.key === s.module)?.levels[l - 1] ?? `Seviye ${l}`} ve üstü</option>)}</select>
              </>
            )}
            <input value={s.label ?? ""} onChange={(e) => upd(i, { label: e.target.value })} maxLength={80} placeholder="Etiket (ör. Muhasebe)" className={`${inp} w-40`} />
            <span className="flex gap-1 ml-auto">
              {i > 0 && <button type="button" onClick={() => move(i, -1)} className="h-8 w-8 rounded-[8px] border border-line">↑</button>}
              {i < steps.length - 1 && <button type="button" onClick={() => move(i, 1)} className="h-8 w-8 rounded-[8px] border border-line">↓</button>}
              {steps.length > 1 && <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="h-8 px-2 rounded-[8px] text-bad text-sm font-semibold">Kaldır</button>}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={() => setSteps([...steps, { approver_kind: "module", module: "finance", level: 3, label: "Muhasebe" }])} className="h-9 px-3 rounded-[8px] border border-line text-sm font-semibold">+ Adım ekle</button>
        <button type="button" disabled={pending} onClick={() => save()} className="h-9 px-4 rounded-[8px] bg-brand-700 text-white text-sm font-semibold disabled:opacity-60">{flow ? "Kaydet" : "Akışı oluştur"}</button>
        {flow && <button type="button" disabled={pending} onClick={() => confirm("Akış silinsin mi? Süren onaylar etkilenmez.") && save(true)} className="h-9 px-3 text-sm font-semibold text-bad">Sil</button>}
        {msg && <span className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
