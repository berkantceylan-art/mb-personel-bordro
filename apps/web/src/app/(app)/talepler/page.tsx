import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { Card, PageHeader } from "@/components/ui";
import { decideAdvance, decideAdvancesBulk } from "@/lib/comms-actions";
import { decideLeave, decideLeavesBulk } from "@/lib/leave-ot-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, formatDate, getSession, todayIso } from "@/lib/session";
import { PendingSubmit } from "@/components/ConfirmSubmit";

const STATUS: Record<string, [string, string]> = {
  pending: ["Bekliyor", "bg-warn-bg text-warn"],
  approved: ["Onaylandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};
const input = "h-9 rounded-lg border border-[#D5DEE8] px-2 bg-white text-sm";
const check = "w-5 h-5 accent-[#0A3D73]";

export default async function RequestsPage() {
  const s = await getSession();
  const pay = canManagePay(s.role);
  const hr = ["owner", "accountant", "hr", "branch_manager"].includes(s.role);
  if (!pay && !hr) redirect("/");
  const supabase = await createClient();
  const [{ data: adv }, { data: leaves }] = await Promise.all([
    pay
      ? supabase.from("advance_requests").select("*, employees(first_name, last_name, card_no, departments(name))").order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    hr
      ? supabase.from("leave_requests").select("id, start_date, end_date, days, note, status, created_at, start_time, end_time, hours, document_path, leave_types(name), employees(first_name, last_name, departments(name))").eq("status", "pending").order("start_date")
      : Promise.resolve({ data: [] }),
  ]);
  const pendingAdv = (adv ?? []).filter((a) => a.status === "pending");
  // Rapor belgeleri için imzalı bağlantılar
  const docLinks = new Map<string, string>();
  const withDoc = (leaves ?? []).filter((l) => l.document_path);
  if (withDoc.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(withDoc.map((l) => l.document_path as string), 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && docLinks.set(withDoc[i]!.id, u.signedUrl));
  }
  const doneAdv = (adv ?? []).filter((a) => a.status !== "pending").slice(0, 30);
  const emp = (e: unknown) => e as { first_name: string; last_name: string; card_no?: string | null; departments: { name: string } | null } | null;
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6] align-top";

  return (
    <>
      <PageHeader title="Talepler" subtitle={`${pendingAdv.length} avans · ${(leaves ?? []).length} izin talebi onay bekliyor`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1320px]">
        {pay && (
          <Card title="Avans talepleri">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead><tr className="text-left text-xs text-muted"><th className={`${th} w-10`}><span className="sr-only">Seç</span></th><th className={th}>Personel</th><th className={th}>Talep</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Açıklama</th><th className={th}>Karar</th></tr></thead>
                <tbody>
                  {pendingAdv.map((a) => {
                    const e = emp(a.employees);
                    return (
                      <tr key={a.id}>
                        <td className={td}><input type="checkbox" name="id" value={a.id} form="bulk-adv" aria-label={`${e?.first_name} ${e?.last_name} seç`} className={check} /></td>
                        <td className={td}><Link href={`/personel/${a.employee_id}`} className="font-semibold text-brand-700">{e?.first_name} {e?.last_name}</Link><div className="text-xs text-muted">{e?.departments?.name}</div></td>
                        <td className={td}>{formatDate(a.created_at)}</td>
                        <td className={`${td} text-right num font-semibold`}>{formatTL(Number(a.amount))}</td>
                        <td className={td}>{a.reason ?? "—"}</td>
                        <td className={td}>
                          <form action={decideAdvance} className="flex flex-wrap gap-2 items-center">
                            <input type="hidden" name="id" value={a.id} />
                            <input name="amount" aria-label="Onaylanan tutar" placeholder={(Number(a.amount) / 100).toLocaleString("tr-TR")} className={`${input} w-28`} />
                            <select name="channel" aria-label="Ödeme kanalı" className={input} defaultValue="CASH"><option value="CASH">Elden</option><option value="BANK">Banka</option></select>
                            <input type="date" name="date" aria-label="Ödeme tarihi" defaultValue={todayIso()} className={input} />
                            <input name="note" aria-label="Not" placeholder="Not" className={`${input} w-32`} />
                            <PendingSubmit name="decision" value="approve" className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Onayla ve öde</PendingSubmit>
                            <PendingSubmit name="decision" value="reject" className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-bad">Reddet</PendingSubmit>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                  {pendingAdv.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Bekleyen avans talebi yok.</td></tr>}
                </tbody>
              </table>
            </div>
            {pendingAdv.length > 1 && (
              <form id="bulk-adv" action={decideAdvancesBulk} className="flex flex-wrap gap-2 items-center rounded-xl bg-[#F2F6FB] border border-[#D5DEE8] p-3">
                <span className="text-sm font-semibold text-brand-800">Seçilenler:</span>
                <select name="channel" aria-label="Ödeme kanalı" className={input} defaultValue="CASH"><option value="CASH">Elden</option><option value="BANK">Banka</option></select>
                <input type="date" name="date" aria-label="Ödeme tarihi" defaultValue={todayIso()} className={input} />
                <PendingSubmit name="decision" value="approve" className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">İstenen tutarla onayla ve öde</PendingSubmit>
                <PendingSubmit name="decision" value="reject" className="h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white text-xs font-semibold text-bad">Reddet</PendingSubmit>
              </form>
            )}
            <p className="text-xs text-muted">Onaylanan avans, seçilen tarih ve kanalla personelin cari hesabına &quot;Avans&quot; olarak işlenir. Tutarı boş bırakırsanız istenen tutar ödenir.</p>
          </Card>
        )}

        {hr && (
          <Card title="İzin talepleri" action={<Link href="/izin" className="text-sm font-semibold text-brand-700">Tüm izinler →</Link>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead><tr className="text-left text-xs text-muted"><th className={`${th} w-10`}><span className="sr-only">Seç</span></th><th className={th}>Personel</th><th className={th}>Tür</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Gün</th><th className={th}>Açıklama</th><th className={th}>Karar</th></tr></thead>
                <tbody>
                  {(leaves ?? []).map((l) => {
                    const e = emp(l.employees);
                    return (
                      <tr key={l.id}>
                        <td className={td}><input type="checkbox" name="id" value={l.id} form="bulk-leave" aria-label={`${e?.first_name} ${e?.last_name} seç`} className={check} /></td>
                        <td className={td}><span className="font-semibold">{e?.first_name} {e?.last_name}</span><div className="text-xs text-muted">{e?.departments?.name}</div></td>
                        <td className={td}>{(l.leave_types as unknown as { name: string } | null)?.name}</td>
                        <td className={td}>{formatDate(l.start_date)}{l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`}{l.hours ? <div className="text-xs text-muted num">{String(l.start_time).slice(0, 5)}–{String(l.end_time).slice(0, 5)}</div> : null}</td>
                        <td className={`${td} text-right num`}>{l.hours ? `${Number(l.hours)} sa` : l.days}</td>
                        <td className={td}>{l.note ?? "—"}{docLinks.has(l.id) && <a href={docLinks.get(l.id)} target="_blank" rel="noreferrer" className="block text-xs font-semibold text-brand-700">Rapor belgesini aç →</a>}</td>
                        <td className={td}>
                          <div className="flex gap-2">
                            <form action={decideLeave}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="approved" /><button className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Onayla</button></form>
                            <form action={decideLeave}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="rejected" /><button className="h-9 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-bad">Reddet</button></form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(leaves ?? []).length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Bekleyen izin talebi yok.</td></tr>}
                </tbody>
              </table>
            </div>
            {(leaves ?? []).length > 1 && (
              <form id="bulk-leave" action={decideLeavesBulk} className="flex flex-wrap gap-2 items-center rounded-xl bg-[#F2F6FB] border border-[#D5DEE8] p-3">
                <span className="text-sm font-semibold text-brand-800">Seçilenler:</span>
                <PendingSubmit name="status" value="approved" className="h-9 px-3 rounded-lg bg-brand-700 text-white text-xs font-semibold">Onayla</PendingSubmit>
                <PendingSubmit name="status" value="rejected" className="h-9 px-3 rounded-lg border border-[#D5DEE8] bg-white text-xs font-semibold text-bad">Reddet</PendingSubmit>
              </form>
            )}
          </Card>
        )}

        {pay && doneAdv.length > 0 && (
          <Card title="Son kararlar">
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {doneAdv.map((a) => {
                const e = emp(a.employees);
                const [l, c] = STATUS[a.status] ?? STATUS.pending!;
                return (
                  <li key={a.id} className="py-2 flex flex-wrap gap-3 items-center">
                    <span className="font-semibold w-48">{e?.first_name} {e?.last_name}</span>
                    <span className="num w-28 text-right">{formatTL(Number(a.amount))}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>
                    <span className="text-muted text-xs">{a.decided_at ? formatDate(a.decided_at) : formatDate(a.created_at)}{a.channel ? ` · ${a.channel === "BANK" ? "Banka" : "Elden"}` : ""}{a.decision_note ? ` · ${a.decision_note}` : ""}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
