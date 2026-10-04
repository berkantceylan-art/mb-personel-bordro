"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useEffect, useState } from "react";
import { AmountInput } from "./AmountInput";
import { markAnnouncementsRead, publishAnnouncement, requestAdvance, requestLeaveSelf } from "@/lib/comms-actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
const Status = ({ s }: { s: { ok: boolean; message: string } | null }) =>
  s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null;

export function AnnouncementForm({ departments, branches }: { departments: Array<{ id: string; name: string }>; branches: Array<{ id: string; name: string }> }) {
  const { state, pending, formProps: actionProps } = useActionForm(publishAnnouncement);
  const [audience, setAudience] = useState("ALL");
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-2" key={state?.ok ? state.message : "f"}>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Başlık *<input name="title" required maxLength={140} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Metin *
        <textarea name="body" required rows={5} className="rounded-[10px] border border-[#D5DEE8] p-3 bg-white w-full" />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="text-muted mb-1.5">Kime</legend>
        {[["ALL", "Tüm personel"], ["DEPARTMENT", "Seçili bölümler"], ["BRANCH", "Seçili şubeler"]].map(([v, l]) => (
          <label key={v} className="flex gap-2 items-center"><input type="radio" name="audience" value={v} checked={audience === v} onChange={() => setAudience(v!)} className="w-5 h-5" />{l}</label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2 text-sm">
        {audience === "DEPARTMENT" && (
          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto border border-line rounded-lg p-2">
            {departments.map((d) => <label key={d.id} className="flex gap-2 items-center"><input type="checkbox" name="department_id" value={d.id} className="w-4 h-4" />{d.name}</label>)}
          </div>
        )}
        {audience === "BRANCH" && (
          <div className="grid gap-1.5 border border-line rounded-lg p-2">
            {branches.map((b) => <label key={b.id} className="flex gap-2 items-center"><input type="checkbox" name="branch_id" value={b.id} className="w-4 h-4" />{b.name}</label>)}
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-muted">Yayından kalkış (isteğe bağlı)<input type="date" name="expires_at" className={input} /></label>
      </div>
      <div className="md:col-span-2 flex flex-wrap gap-4 items-center text-sm">
        <label className="flex gap-2 items-center"><input type="checkbox" name="pinned" className="w-5 h-5" />Üste sabitle</label>
        <label className="flex gap-2 items-center"><input type="checkbox" name="push" defaultChecked className="w-5 h-5" />Telefonlara bildirim gönder</label>
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{pending ? "Yayınlanıyor…" : "Yayınla"}</button>
        <Status s={state} />
      </div>
    </form>
  );
}

/** Görüntülenen duyuruları okundu işaretler */
export function MarkRead({ ids }: { ids: string[] }) {
  useEffect(() => {
    if (ids.length) markAnnouncementsRead(ids);
  }, [ids]);
  return null;
}

export function AdvanceRequestForm() {
  const { state, pending, formProps: actionProps } = useActionForm(requestAdvance);
  return (
    <form {...actionProps} className="flex flex-wrap gap-3 items-end" key={state?.ok ? state.message : "f"}>
      <label className="flex flex-col gap-1.5 text-sm text-muted w-40">Tutar (TL) *<AmountInput required placeholder="5.000" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted flex-1 min-w-48">Açıklama<input name="reason" maxLength={200} className={input} /></label>
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">Avans iste</button>
      <Status s={state} />
    </form>
  );
}

export function LeaveRequestForm({ types }: { types: Array<{ id: string; name: string }> }) {
  const { state, pending, formProps: actionProps } = useActionForm(requestLeaveSelf);
  return (
    <form {...actionProps} className="grid gap-3 md:grid-cols-4 items-end" key={state?.ok ? state.message : "f"}>
      <label className="flex flex-col gap-1.5 text-sm text-muted">İzin türü
        <select name="typeId" required className={input}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Başlangıç<input type="date" name="start" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş<input type="date" name="end" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Açıklama<input name="note" className={input} /></label>
      <div className="md:col-span-4 flex flex-wrap gap-3 items-center">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">İzin iste</button>
        <Status s={state} />
      </div>
    </form>
  );
}
