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
  const [kind, setKind] = useState("info");
  const KINDS: Array<[string, string]> = [["info", "Bilgilendirme"], ["event", "Etkinlik"], ["poll", "Anket"], ["qa", "Soru-cevap"]];
  return (
    <form {...actionProps} className="grid gap-4 md:grid-cols-2" key={state?.ok ? state.message : "f"}>
      <fieldset className="md:col-span-2 flex flex-wrap gap-2">
        <legend className="sr-only">Tür</legend>
        {KINDS.map(([v, l]) => (
          <label key={v} className={`h-10 px-4 rounded-full border text-sm font-semibold grid place-items-center cursor-pointer ${kind === v ? "bg-brand-800 text-white border-brand-800" : "bg-white border-[#D5DEE8] text-brand-700"}`}>
            <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="sr-only" />{l}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Başlık *<input name="title" required maxLength={140} placeholder={kind === "event" ? "Örn. Yılbaşı yemeği" : kind === "poll" ? "Örn. Servis saati hangisi olsun?" : kind === "qa" ? "Örn. Yeni vardiya düzeni hakkında sorularınız" : ""} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Metin *
        <textarea name="body" required rows={4} className="rounded-[10px] border border-[#D5DEE8] p-3 bg-white w-full" />
      </label>
      {kind === "event" && (
        <div className="md:col-span-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-sm text-muted">Başlangıç *<input type="datetime-local" name="event_at" required className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş<input type="datetime-local" name="event_end" className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Yer<input name="location" className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Kontenjan<input name="capacity" type="number" min={1} className={input} /></label>
        </div>
      )}
      {kind === "poll" && (
        <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm text-muted">Seçenekler * (her satıra bir tane)<textarea name="options" rows={4} required className="rounded-[10px] border border-[#D5DEE8] p-3 bg-white" /></label>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex gap-2 items-center"><input type="checkbox" name="poll_multi" className="w-5 h-5" />Birden fazla seçilebilir</label>
            <label className="flex gap-2 items-center"><input type="checkbox" name="anonymous" defaultChecked className="w-5 h-5" />İsimsiz (kimin ne seçtiği görünmez)</label>
            <label className="flex flex-col gap-1.5 text-muted">Kapanış<input type="datetime-local" name="closes_at" className={input} /></label>
          </div>
        </div>
      )}
      {kind === "qa" && <p className="md:col-span-2 text-sm text-muted">Personel soru sorar (isterse isimsiz), diğerleri soruları oylar; en çok oy alan sorular üstte görünür, yanıtlarınızı duyuru sayfasından yazarsınız.</p>}
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
        {kind === "info" && <label className="flex gap-2 items-center"><input type="checkbox" name="require_ack" className="w-5 h-5" />&quot;Okudum, anladım&quot; onayı iste</label>}
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

/** Personel izin talebi: yıllık izinde gün sayısı, işbaşı tarihi ve kalan bakiye canlı hesaplanır; yol izni istenebilir */
export function LeaveRequestForm({ types, holidays = [], balance }: { types: Array<{ id: string; name: string; code?: string }>; holidays?: Array<[string, boolean]>; balance?: number }) {
  const { state, pending, formProps: actionProps } = useActionForm(requestLeaveSelf);
  const visible = types.filter((t) => t.code !== "RAPOR" && t.code !== "DOGUM");
  const [typeId, setTypeId] = useState(visible[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [travel, setTravel] = useState(0);
  const code = visible.find((t) => t.id === typeId)?.code;
  const hourly = code === "SAATLIK";
  const yearly = code === "YILLIK";
  const hol = new Map(holidays);
  const DAY = 86_400_000;
  const t0 = (d: string) => Date.parse(d + "T12:00:00Z");
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const off = (d: string) => new Date(t0(d)).getUTCDay() === 0 || hol.get(d) === false;
  let days = 0;
  let back = "";
  const last = end || start;
  if (start && last >= start && !hourly) {
    for (let t = t0(start); t <= t0(last); t += DAY) { const d = iso(t); if (!off(d)) days += hol.get(d) === true ? 0.5 : 1; }
    let d = last, left = yearly ? travel : 0;
    while (left > 0) { d = iso(t0(d) + DAY); if (!off(d)) left--; }
    do d = iso(t0(d) + DAY); while (off(d));
    back = d.split("-").reverse().join(".");
  }
  return (
    <form {...actionProps} className="grid gap-3 md:grid-cols-4 items-end" key={state?.ok ? state.message : "f"}>
      <label className="flex flex-col gap-1.5 text-sm text-muted">İzin türü
        <select name="typeId" required value={typeId} onChange={(e) => setTypeId(e.target.value)} className={input}>{visible.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">{hourly ? "Gün" : "Başlangıç"}<input type="date" name="start" required value={start} onChange={(e) => setStart(e.target.value)} className={input} /></label>
      {hourly ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Saat (başlangıç)<input type="time" name="start_time" required className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Saat (bitiş)<input type="time" name="end_time" required className={input} /></label>
        </>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm text-muted">Bitiş<input type="date" name="end" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} className={input} /></label>
      )}
      <label className={`flex flex-col gap-1.5 text-sm text-muted ${hourly ? "md:col-span-4" : ""}`}>Açıklama<input name="note" className={input} /></label>
      {yearly && (
        <div className="md:col-span-4 grid gap-3 md:grid-cols-4 rounded-xl border border-line p-3 bg-[#FAFBFC]">
          <label className="flex flex-col gap-1.5 text-sm text-muted">Yol izni (ücretsiz)
            <select name="travel_days" value={travel} onChange={(e) => setTravel(Number(e.target.value))} className={input}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n ? `${n} gün` : "İstemiyorum"}</option>)}</select>
          </label>
          {travel > 0 && <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-3">İzni geçireceğim yer<input name="destination" placeholder="Şehir" className={input} /></label>}
          <p className="md:col-span-4 text-xs text-muted">İznini başka bir şehirde geçirecekseniz gidiş-dönüş için 4 güne kadar ücretsiz yol izni isteyebilirsiniz (İş K. md. 56).</p>
        </div>
      )}
      {days > 0 && (
        <div className="md:col-span-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-[#E7F1FB] text-brand-700 px-3 py-1.5 font-semibold">{days.toLocaleString("tr-TR")} iş günü</span>
          <span className="rounded-lg bg-[#EEF2F6] px-3 py-1.5">İşbaşı: <b>{back}</b></span>
          {yearly && balance !== undefined && <span className={`rounded-lg px-3 py-1.5 ${balance - days < 0 ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok"}`}>Kalan: {balance.toLocaleString("tr-TR")} → <b>{(balance - days).toLocaleString("tr-TR")}</b> gün</span>}
          {yearly && days < 10 && <span className="rounded-lg bg-warn-bg text-warn px-3 py-1.5">10 günden kısa: iznin bölünerek kullanılması talebi sayılır</span>}
        </div>
      )}
      <div className="md:col-span-4 flex flex-wrap gap-3 items-center">
        <button disabled={pending} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60 w-full md:w-auto">{hourly ? "Saatlik izin iste" : "İzin iste"}</button>
        <Status s={state} />
      </div>
      {hourly && <p className="md:col-span-4 text-xs text-muted">Saatlik izin en fazla 7,5 saat; onaylanınca o günkü geç gelme / erken çıkış mazeretli sayılır.</p>}
      {!hourly && <p className="md:col-span-4 text-xs text-muted">Pazar ve resmi tatiller izinden sayılmaz; cumartesi iş günüdür. Talebiniz önce şefinize, sonra İK&apos;ya gider.</p>}
    </form>
  );
}

/** Personel sağlık raporunu fotoğraflayıp bildirir; İK onaylayınca rapor izni olarak işlenir */
export function SickReportForm({ typeId }: { typeId: string }) {
  const { state, pending, formProps: actionProps } = useActionForm(requestLeaveSelf);
  return (
    <form {...actionProps} className="grid gap-3 md:grid-cols-3 items-end" key={state?.ok ? state.message : "f"}>
      <input type="hidden" name="typeId" value={typeId} />
      <label className="flex flex-col gap-1.5 text-sm text-muted">Rapor başlangıcı<input type="date" name="start" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Rapor bitişi<input type="date" name="end" required className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Açıklama<input name="note" placeholder="ör. grip, 3 gün istirahat" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-3">Rapor belgesi (fotoğraf veya PDF) *
        <input type="file" name="file" required accept="image/*,application/pdf" className="text-sm" />
      </label>
      <div className="md:col-span-3 flex flex-wrap gap-3 items-center">
        <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-[#B42318] text-white font-semibold disabled:opacity-60">{pending ? "Gönderiliyor…" : "Raporu bildir"}</button>
        <Status s={state} />
      </div>
      <p className="md:col-span-3 text-xs text-muted">e-Devlet → e-Nabız / Sağlık Bakanlığı &quot;Raporlarım&quot; sayfasından raporunuzun PDF&apos;ini de indirebilirsiniz. Raporun aslını işe dönünce İK&apos;ya teslim edin.</p>
    </form>
  );
}
