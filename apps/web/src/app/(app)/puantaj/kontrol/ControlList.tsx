"use client";
import { useMemo, useState, useTransition } from "react";
import { ISSUE } from "@/lib/att-issues";
import { addPunchInline, attDayPunches, deletePunchInline, fixAttInline, type AttPunch, type AttRowData, type InlineResult } from "@/lib/att-control-actions";

type Opt = { id: string; name: string };
type ShiftOpt = { id: string; code: string; start: string; end: string };

const WD = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const dLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)} ${WD[new Date(d + "T12:00:00Z").getUTCDay()]}`;
const hm = (ts: string | null) => (ts ? ts.slice(11, 16) : "—");
const dur = (m: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : "—");
const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const TONE = { red: "bg-bad-bg text-bad", amber: "bg-warn-bg text-warn", blue: "bg-[#EAF2FB] text-brand-700", gray: "bg-[#EEF2F6] text-ink", green: "bg-ok-bg text-ok" } as const;
const STATE: Record<string, [string, keyof typeof TONE]> = { open: ["Açık", "red"], fixed: ["Düzeltildi", "green"], accepted: ["Kabul edildi", "blue"], ok: ["Sorunsuz", "green"] };
const RES: Record<string, string> = { forgot_card: "kart unuttu", shift_fill: "vardiyaya göre", overtime: "mesai onaya", leave: "izinli", absent: "devamsız", accept: "kabul", shift_change: "vardiya değişti" };
const btn = "h-8 px-2.5 rounded-lg text-xs font-semibold border disabled:opacity-50";
const inp = "h-8 rounded-lg border border-[#D5DEE8] px-2 text-xs bg-white";
const Chip = ({ t, children }: { t: keyof typeof TONE; children: React.ReactNode }) => <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE[t]}`}>{children}</span>;

export function ControlList({ rows: initial, leaveTypes, shifts, names, closed, durum, initialQuery }: { rows: AttRowData[]; leaveTypes: Opt[]; shifts: ShiftOpt[]; names: string[]; closed: boolean; durum: string; initialQuery: string }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState(initialQuery);
  const shown = useMemo(() => {
    const t = norm(q.trim());
    const list = t ? rows.filter((r) => norm(`${r.employees?.first_name ?? ""} ${r.employees?.last_name ?? ""}`).includes(t)) : rows;
    return list.slice(0, 300);
  }, [rows, q]);
  const update = (key: string, row: AttRowData | null | undefined) => {
    if (!row) return;
    setRows((rs) => rs.map((r) => (`${r.employee_id}|${r.work_date}` === key ? row : r)));
  };
  const openCount = rows.filter((r) => r.state === "open").length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} list="att-names" placeholder="Personel ara (yazdıkça süzülür)" autoComplete="off" className="h-10 w-72 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm" />
        <datalist id="att-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        {q && <button type="button" onClick={() => setQ("")} className="text-sm font-semibold text-muted">Temizle</button>}
        <span className="ml-auto text-sm text-muted">{shown.length} gün gösteriliyor{durum === "open" ? ` · ${openCount} açık` : ""}</span>
      </div>
      {shown.map((r) => <RowCard key={`${r.employee_id}|${r.work_date}`} r={r} leaveTypes={leaveTypes} shifts={shifts} closed={closed} durum={durum} onRow={update} />)}
      {!shown.length && <div className="rounded-[14px] border border-line bg-white p-8 text-center text-muted">{q ? "Aramaya uyan gün yok." : durum === "open" ? "Açık hatalı gün yok." : "Kayıt yok."}</div>}
    </div>
  );
}

function RowCard({ r, leaveTypes, shifts, closed, durum, onRow }: { r: AttRowData; leaveTypes: Opt[]; shifts: ShiftOpt[]; closed: boolean; durum: string; onRow: (key: string, row: AttRowData | null | undefined) => void }) {
  const key = `${r.employee_id}|${r.work_date}`;
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [tin, setTin] = useState("");
  const [tout, setTout] = useState("");
  const [ot, setOt] = useState("");
  const [lt, setLt] = useState("");
  const [sh, setSh] = useState("");
  const [punches, setPunches] = useState<AttPunch[] | null>(null);
  const [showP, setShowP] = useState(false);
  const [np, setNp] = useState<{ direction: "IN" | "OUT"; time: string; nextDay: boolean }>({ direction: r.issues.includes("MISSING_IN") ? "IN" : "OUT", time: "", nextDay: false });

  const name = r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "?";
  const missing = r.issues.includes("MISSING_IN") || r.issues.includes("MISSING_OUT");
  const editable = !closed && r.state === "open";
  const done = (res: InlineResult) => {
    setMsg({ ok: res.ok, text: res.message });
    if (res.row) onRow(key, res.row);
    if (res.punches) setPunches(res.punches);
  };
  const act = (action: string) => start(async () => done(await fixAttInline({ employee_id: r.employee_id, date: r.work_date, action, reason, time_in: tin, time_out: tout, ot_hours: ot, leave_type: lt, shift_id: sh })));
  const togglePunches = () => {
    const next = !showP;
    setShowP(next);
    if (next && !punches) start(async () => setPunches(await attDayPunches(r.employee_id, r.work_date)));
  };

  return (
    <article className={`rounded-[14px] border bg-white p-3 flex flex-col gap-2 ${r.state === "open" ? "border-[#F3C7C7]" : "border-line"} ${busy ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {editable && durum === "open" && <input type="checkbox" name="sel" value={key} form="toplu" className="w-4 h-4" aria-label="Seç" />}
        <span className="font-semibold">{name}</span>
        <span className="text-xs text-muted">{r.employees?.departments?.name ?? "Bölümsüz"}</span>
        <span className="num text-sm">{dLabel(r.work_date)}</span>
        <span className="text-xs text-muted">{r.shift_code ? `Vardiya ${r.shift_code} ${r.shift_start?.slice(0, 5) ?? ""}–${r.shift_end?.slice(0, 5) ?? ""}` : "Vardiya yok"}</span>
        <span className="num text-xs">Giriş <b>{hm(r.first_in)}</b> · Çıkış <b>{hm(r.last_out)}</b> · Net {dur(r.worked_min)}{r.late_min ? ` · geç ${r.late_min} dk` : ""}{r.early_min ? ` · erken ${r.early_min} dk` : ""}{r.overtime_min ? ` · FM ${dur(r.overtime_min)}` : ""}</span>
        <span className="flex flex-wrap gap-1">{r.issues.map((i) => <Chip key={i} t={ISSUE[i]?.tone ?? "gray"}>{ISSUE[i]?.label ?? i}</Chip>)}</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <Chip t={STATE[r.state]?.[1] ?? "gray"}>{STATE[r.state]?.[0] ?? r.state}</Chip>
          {r.resolution && <span className="text-muted">{RES[r.resolution] ?? r.resolution}</span>}
          <button type="button" onClick={togglePunches} className="text-brand-700 font-semibold">{showP ? "Okutmaları gizle" : `Okutmalar (${r.punch_count})`}</button>
        </span>
      </div>

      {showP && (
        <div className="rounded-lg bg-[#F7F9FB] border border-[#E6ECF2] p-2.5 flex flex-col gap-2 text-xs">
          {!punches ? <span className="text-muted">Yükleniyor…</span> : punches.length === 0 ? <span className="text-muted">Bu gün için okutma yok.</span> : (
            <ul className="flex flex-col gap-1">
              {punches.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className={`w-12 font-semibold ${p.direction === "IN" ? "text-ok" : "text-brand-700"}`}>{p.direction === "IN" ? "Giriş" : "Çıkış"}</span>
                  <span className="num font-semibold">{p.punched_at.slice(11, 16)}</span>
                  {p.punched_at.slice(0, 10) !== r.work_date && <span className="text-muted">(ertesi gün)</span>}
                  <span className="text-muted">{p.source === "MANUAL" ? `elle${p.reason ? ` · ${p.reason}` : ""}` : p.source === "MOBILE" ? "mobil / kiosk" : `cihaz ${p.device_code ?? ""}`}</span>
                  {!closed && p.source === "MANUAL" && (
                    <button type="button" disabled={busy} onClick={() => start(async () => done(await deletePunchInline(p.id, r.employee_id, r.work_date)))} className="ml-auto text-bad font-semibold">Sil</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!closed && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[#E6ECF2] pt-2">
              <span className="font-semibold text-brand-800">Okutma ekle:</span>
              <select value={np.direction} onChange={(e) => setNp({ ...np, direction: e.target.value as "IN" | "OUT" })} className={inp}><option value="IN">Giriş</option><option value="OUT">Çıkış</option></select>
              <input type="time" value={np.time} onChange={(e) => setNp({ ...np, time: e.target.value })} className={inp} />
              <label className="flex items-center gap-1"><input type="checkbox" checked={np.nextDay} onChange={(e) => setNp({ ...np, nextDay: e.target.checked })} />ertesi gün</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sebep" maxLength={300} className={`${inp} w-44`} />
              <button type="button" disabled={busy || !np.time} onClick={() => start(async () => done(await addPunchInline({ employee_id: r.employee_id, date: r.work_date, direction: np.direction, time: np.time, next_day: np.nextDay, reason })))} className={`${btn} bg-brand-700 text-white border-brand-700`}>Ekle</button>
            </div>
          )}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sebep (ör. kartını unuttu)" maxLength={300} className={`${inp} w-52`} />
          {missing && (
            <>
              {r.issues.includes("MISSING_IN") && <input type="time" value={tin} onChange={(e) => setTin(e.target.value)} title="Giriş saati (boşsa vardiya başlangıcı)" className={inp} />}
              {r.issues.includes("MISSING_OUT") && <input type="time" value={tout} onChange={(e) => setTout(e.target.value)} title="Çıkış saati (boşsa vardiya bitişi)" className={inp} />}
              <button type="button" disabled={busy} onClick={() => act("forgot_card")} className={`${btn} bg-brand-700 text-white border-brand-700`}>Kart unuttu</button>
            </>
          )}
          {(missing || r.issues.includes("ABSENT")) && <button type="button" disabled={busy} onClick={() => act("shift_fill")} className={`${btn} border-brand-600 text-brand-700`}>Vardiyasına göre işle</button>}
          {r.issues.includes("OVERTIME") && (
            <>
              <input value={ot} onChange={(e) => setOt(e.target.value)} inputMode="decimal" placeholder={`${(r.overtime_min / 60).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sa`} title="Saat (boşsa hesaplanan)" className={`${inp} w-16 text-right`} />
              <button type="button" disabled={busy} onClick={() => act("overtime")} className={`${btn} bg-[#0F766E] text-white border-[#0F766E]`}>Mesai işle</button>
            </>
          )}
          {(r.issues.includes("ABSENT") || r.issues.includes("LEAVE_PRESENT") || missing) && (
            <>
              <select value={lt} onChange={(e) => setLt(e.target.value)} className={`${inp} max-w-[150px]`} aria-label="İzin türü"><option value="">İzin türü…</option>{leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <button type="button" disabled={busy || !lt} onClick={() => act("leave")} className={`${btn} border-line`}>İzinli say</button>
            </>
          )}
          {r.issues.includes("ABSENT") && <button type="button" disabled={busy} onClick={() => act("absent")} className={`${btn} border-[#F3C7C7] text-bad`}>Devamsız onayla</button>}
          <select value={sh} onChange={(e) => setSh(e.target.value)} className={`${inp} max-w-[140px]`} aria-label="Vardiya"><option value="">Vardiya…</option><option value="off">Hafta tatili</option>{shifts.map((x) => <option key={x.id} value={x.id}>{x.code} {x.start}–{x.end}</option>)}</select>
          <button type="button" disabled={busy || !sh} onClick={() => act("shift_change")} className={`${btn} border-line`}>Vardiya değiştir</button>
          <button type="button" disabled={busy} onClick={() => act("accept")} className={`${btn} border-line text-muted`}>Kabul et</button>
        </div>
      )}
      {!closed && (r.state === "fixed" || r.state === "accepted") && (
        <button type="button" disabled={busy} onClick={() => act("reopen")} className="self-start text-xs font-semibold text-muted underline">Yeniden aç</button>
      )}
      {busy && <span className="text-xs text-muted">İşleniyor…</span>}
      {msg && !busy && <span className={`text-xs font-semibold ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
    </article>
  );
}
