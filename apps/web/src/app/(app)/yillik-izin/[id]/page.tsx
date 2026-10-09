import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { Card, PageHeader, Stat } from "@/components/ui";
import { fmtDays, loadLeaveData, returnDate } from "@/lib/annual-leave";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addAdjustment, addGap, deleteGap, recallLeave, saveSeniority } from "../actions";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm";
const btn2 = "h-10 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold text-sm";
const th = "py-2 px-2 font-semibold text-left";
const td = "py-2 px-2 border-t border-[#EEF2F6]";
const ST: Record<string, string> = { approved: "Onaylı", pending: "Bekliyor" };

/** Personelin izin defteri: yıl yıl hak ediş, kullanım, düzeltme, kesinti ve belgeler */
export default async function LeaveLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const hr = s.role !== "branch_manager";
  const { id } = await params;
  const today = todayIso();
  const supabase = await createClient();
  const data = await loadLeaveData(supabase, today, { includeTerminated: true });
  const e = data.emps.find((x) => x.id === id);
  if (!e) notFound();
  const l = data.ledgers.get(id);
  const rows = data.rows.filter((r) => r.employee_id === id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const [{ data: gaps }, { data: adjs }] = await Promise.all([
    supabase.from("leave_service_gaps").select("id, start_date, end_date, reason").eq("employee_id", id).order("start_date"),
    supabase.from("leave_adjustments").select("days, note, created_at").eq("employee_id", id).order("created_at"),
  ]);
  const P = (href: string, label: string) => <a href={href} target="_blank" rel="noopener" className={`${btn2} grid place-items-center`}>{label}</a>;
  return (
    <>
      <PageHeader title={`${e.first_name} ${e.last_name}`} subtitle={`${e.dept} · yıllık izin defteri`} actions={<Link href="/yillik-izin?sekme=bakiye" className={btn2}>← Bakiyeler</Link>} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        {!l ? <Card><p className="text-sm">İşe giriş tarihi girilmemiş; izin hesaplanamıyor.</p></Card> : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <Stat label="Kalan izin" value={`${fmtDays(l.balance)} gün`} sub={l.balance < 0 ? "avans izin kullanılmış" : undefined} />
              <Stat label="Hak edilen (toplam)" value={`${fmtDays(l.earned)} gün`} sub={`${l.completedYears} hizmet yılı`} />
              <Stat label="Kullanılan" value={`${fmtDays(l.used)} gün`} sub={l.adjust ? `devir / düzeltme ${fmtDays(l.adjust)}` : undefined} />
              <Stat label="Sonraki hak ediş" value={formatDate(l.next.date)} sub={`+${l.next.days} gün (${l.next.k}. yıl)`} />
            </div>
            <div className="flex flex-wrap gap-2">
              {P(`/yazdir/yillik-izin?tur=kayit&personel=${id}`, "Yıllık izin kayıt belgesi")}
              {hr && P(`/yazdir/yillik-izin?tur=ucret&personel=${id}`, "Ayrılışta izin ücreti hesabı")}
              <Link href={`/personel/${id}`} className={`${btn2} grid place-items-center`}>Personel kartı</Link>
            </div>
            <Card title="Yıl yıl hak ediş">
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-xs text-muted"><th className={th}>Hizmet yılı</th><th className={th}>Hak ediş tarihi</th><th className={`${th} text-right`}>Yaş</th><th className={`${th} text-right`}>Ötelenen gün</th><th className={`${th} text-right`}>Hak</th><th className={`${th} text-right`}>Kullanılan</th><th className={`${th} text-right`}>Kalan</th></tr></thead>
                <tbody>
                  {l.adjust !== 0 && <tr className="bg-[#FAFBFC]"><td className={td} colSpan={4}>Devir / açılış / düzeltme</td><td className={`${td} num text-right`}>{fmtDays(l.opening.days)}</td><td className={`${td} num text-right`}>{fmtDays(l.opening.used)}</td><td className={`${td} num text-right font-semibold`}>{fmtDays(l.opening.left)}</td></tr>}
                  {l.years.map((y) => (
                    <tr key={y.k}><td className={td}>{y.k}. yıl</td><td className={`${td} num`}>{formatDate(y.date)}</td><td className={`${td} num text-right`}>{y.age ?? "—"}</td><td className={`${td} num text-right`}>{y.gapDays || "—"}</td><td className={`${td} num text-right`}>{y.days}</td><td className={`${td} num text-right`}>{fmtDays(y.used)}</td><td className={`${td} num text-right font-semibold ${y.left > 0 ? "" : "text-muted"}`}>{fmtDays(y.left)}</td></tr>
                  ))}
                  {l.years.length === 0 && <tr><td className={td} colSpan={7}>Henüz 1 yılını doldurmadı. İlk hak ediş {formatDate(l.next.date)} ({l.next.days} gün).</td></tr>}
                </tbody>
              </table></div>
              <p className="text-xs text-muted">Kıdem başlangıcı {formatDate(l.base)}{e.leave_seniority_start ? " (düzeltilmiş)" : " (işe giriş)"}. Kullanılan izin en eski haktan düşülür.</p>
            </Card>
          </>
        )}
        <Card title="İzin kayıtları">
          <ul className="text-sm divide-y divide-[#EEF2F6]">{rows.map((r) => (
            <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[220px]"><b>{r.name}</b> · <span className="num">{formatDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""} · {fmtDays(r.days)} gün</span> <span className="text-xs text-muted">· {ST[r.status]}{r.note ? ` · ${r.note}` : ""}</span></span>
              {!r.parent_id && r.code !== "SAATLIK" && <a href={`/yazdir/yillik-izin?tur=form&id=${r.id}`} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">Talep / onay formu</a>}
              {r.status === "approved" && r.code === "YILLIK" && <a href={`/yazdir/yillik-izin?tur=isbasi&id=${r.id}`} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">İşbaşı formu</a>}
              {hr && r.status === "approved" && r.code === "YILLIK" && r.start_date < today && r.end_date >= today && (
                <form action={recallLeave} className="flex flex-wrap gap-1.5 items-center w-full sm:w-auto">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="text-xs text-muted flex items-center gap-1">İşbaşı<input type="date" name="back_date" min={r.start_date} max={r.end_date} defaultValue={returnDate(today, data.hol) <= r.end_date ? returnDate(today, data.hol) : r.end_date} className={`${input} h-8`} /></label>
                  <input name="note" placeholder="Neden" className={`${input} h-8 w-32`} aria-label="Geri çağırma nedeni" />
                  <ConfirmSubmit label="Geri çağır" question="Personel izinden geri çağrılacak, kalan gün bakiyesine dönecek. Emin misiniz?" yes="Evet, geri çağır" className="h-8 px-3 rounded-lg border border-[#E3B4AE] text-xs font-semibold text-bad" />
                </form>
              )}
            </li>
          ))}{rows.length === 0 && <li className="py-3 text-muted">Kayıt yok.</li>}</ul>
        </Card>
        {hr && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Devir / düzeltme">
              <ul className="text-sm divide-y divide-[#EEF2F6]">{(adjs ?? []).map((a, i) => <li key={i} className="py-1.5 flex justify-between gap-2"><span>{a.note ?? "—"} <span className="text-xs text-muted">{formatDate(String(a.created_at).slice(0, 10))}</span></span><b className="num">{Number(a.days) > 0 ? "+" : ""}{fmtDays(Number(a.days))}</b></li>)}</ul>
              <form action={addAdjustment} className="flex flex-wrap gap-2">
                <input type="hidden" name="employee_id" value={id} />
                <input name="days" inputMode="decimal" placeholder="± gün" className={`${input} w-24`} aria-label="Gün" />
                <input name="note" placeholder="Açıklama" className={`${input} flex-1 min-w-32`} aria-label="Açıklama" />
                <PendingSubmit className={btn2}>Ekle</PendingSubmit>
              </form>
            </Card>
            <Card title="Hak edişe sayılmayan süreler">
              <p className="text-xs text-muted">Ücretsiz izinler otomatik sayılır. Askerlik, tutukluluk gibi md. 55 dışındaki kesintileri buraya girin; hak ediş tarihi bu süre kadar ötelenir.</p>
              <ul className="text-sm divide-y divide-[#EEF2F6]">
                {(data.gaps.get(id) ?? []).filter((g) => g.reason === "Ücretsiz izin").map((g, i) => <li key={`u${i}`} className="py-1.5 text-muted num">{formatDate(g.start)} – {formatDate(g.end)} · ücretsiz izin</li>)}
                {(gaps ?? []).map((g) => <li key={g.id} className="py-1.5 flex justify-between gap-2"><span className="num">{formatDate(g.start_date)} – {formatDate(g.end_date)} · {g.reason}</span><form action={deleteGap}><input type="hidden" name="id" value={g.id} /><PendingSubmit className="text-xs text-bad">Sil</PendingSubmit></form></li>)}
              </ul>
              <form action={addGap} className="grid gap-2 grid-cols-2">
                <input type="hidden" name="employee_id" value={id} />
                <input type="date" name="start" required className={input} aria-label="Başlangıç" />
                <input type="date" name="end" required className={input} aria-label="Bitiş" />
                <input name="reason" required placeholder="Neden (ör. askerlik)" className={input} aria-label="Neden" />
                <PendingSubmit className={btn2}>Ekle</PendingSubmit>
              </form>
            </Card>
            <Card title="Kıdem başlangıcı">
              <p className="text-xs text-muted">Aynı işverene ait başka işyerinde geçen süre izin hesabına katılır (md. 54). Boş bırakılırsa işe giriş tarihi kullanılır ({e.hire_date ? formatDate(e.hire_date) : "—"}).</p>
              <form action={saveSeniority} className="flex gap-2">
                <input type="hidden" name="employee_id" value={id} />
                <input type="date" name="date" defaultValue={e.leave_seniority_start ?? ""} className={input} aria-label="Kıdem başlangıcı" />
                <PendingSubmit className={btn2}>Kaydet</PendingSubmit>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
