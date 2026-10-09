import Link from "next/link";
import { formatTL } from "@mb/core";
import { Card, ChannelChip, PageHeader, Stat, TYPE_LABEL } from "@/components/ui";
import { AdvanceRequestForm, LeaveRequestForm } from "@/components/CommsForms";
import { WebPunch } from "@/components/WebPunch";
import { EnablePush } from "@/components/Pwa";
import { cancelAdvance } from "@/lib/comms-actions";
import { createClient } from "@/lib/supabase/server";
import { currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

const STATUS: Record<string, [string, string]> = {
  pending: ["Bekliyor", "bg-warn-bg text-warn"],
  approved: ["Onaylandı", "bg-ok-bg text-ok"],
  rejected: ["Reddedildi", "bg-bad-bg text-bad"],
  cancelled: ["İptal", "bg-[#EEF2F6] text-[#33414F]"],
};
const Chip = ({ s }: { s: string }) => {
  const [l, c] = STATUS[s] ?? STATUS.pending!;
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>;
};

export default async function MyPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data: me } = await supabase.from("employees").select("id, first_name, last_name, card_no, hire_date, departments(name), branches(name)").eq("user_id", s.userId).maybeSingle();
  if (!me) {
    return (
      <>
        <PageHeader title="Benim sayfam" />
        <div className="p-6 text-muted">Hesabınız bir personel kaydına bağlı değil. Yönetim panelinden davet koduyla bağlanabilir.</div>
      </>
    );
  }
  const period = currentPeriod();
  const monthStart = `${period}-01T00:00:00`;
  const year = period.slice(0, 4);
  const [{ data: sum }, { data: entries }, { data: payroll }, { data: punches }, { data: leaves }, { data: types }, { data: adv }, { data: anns }, { data: reqDocs }, { data: myDocs }] = await Promise.all([
    supabase.from("ledger_period_summary").select("accrued, paid_bank, paid_cash, deductions, balance").eq("employee_id", me.id).eq("period", period).maybeSingle(),
    supabase.from("ledger_entries").select("id, entry_date, type, channel, amount, note").eq("employee_id", me.id).is("voided_at", null).order("entry_date", { ascending: false }).limit(12),
    supabase.from("payroll_lines").select("period, days, official_gross, official_net, net_to_bank, bes, garnishment").eq("employee_id", me.id).order("period", { ascending: false }).limit(6),
    supabase.from("attendance_punches").select("direction, punched_at, source").eq("employee_id", me.id).gte("punched_at", monthStart).order("punched_at"),
    supabase.from("leave_requests").select("id, start_date, end_date, days, status, leave_types(name, code)").eq("employee_id", me.id).gte("start_date", `${year}-01-01`).order("start_date", { ascending: false }),
    supabase.from("leave_types").select("id, name").order("sort_order"),
    supabase.from("advance_requests").select("id, amount, reason, status, created_at, decision_note").eq("employee_id", me.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("announcements").select("id, title, published_at, pinned").order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(4),
    supabase.from("document_types").select("id").eq("onboarding_step", 2).eq("required", true),
    supabase.from("employee_documents").select("document_type_id").eq("employee_id", me.id),
  ]);
  const haveDoc = new Set((myDocs ?? []).map((d) => d.document_type_id));
  const missingDocs = (reqDocs ?? []).filter((t) => !haveDoc.has(t.id)).length;

  const days = new Map<string, { in?: string; out?: string }>();
  for (const p of punches ?? []) {
    const d = p.punched_at.slice(0, 10);
    const t = p.punched_at.slice(11, 16);
    const cur = days.get(d) ?? {};
    if (p.direction === "IN" && !cur.in) cur.in = t;
    if (p.direction === "OUT") cur.out = t;
    days.set(d, cur);
  }
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const todayRow = days.get(today);
  const lastDir = (punches ?? []).filter((p) => p.punched_at.startsWith(today)).at(-1)?.direction as "IN" | "OUT" | undefined;
  const usedAnnual = (leaves ?? []).filter((l) => l.status === "approved" && (l.leave_types as unknown as { code: string } | null)?.code === "YILLIK").reduce((a, l) => a + Number(l.days), 0);
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const dept = (me.departments as unknown as { name: string } | null)?.name;
  const th = "py-2 px-2 font-semibold border-b border-line";
  const td = "py-2 px-2 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title={`Merhaba ${me.first_name}`} subtitle={[dept, me.card_no ? `PDKS ${me.card_no}` : null, me.hire_date ? `İşe giriş ${formatDate(me.hire_date)}` : null].filter(Boolean).join(" · ")} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1200px]">
        <Card title="Bugün">
          <div className="flex items-center gap-3 text-sm">
            <span className={`w-3 h-3 rounded-full ${lastDir === "IN" ? "bg-[#1FA971]" : "bg-[#9AA6B2]"}`} aria-hidden />
            <span>{lastDir === "IN" ? "İçeridesiniz" : lastDir === "OUT" ? "Çıkış yaptınız" : "Bugün henüz okutma yok"}</span>
            <span className="ml-auto text-muted">Giriş <b className="num text-ink">{todayRow?.in ?? "—"}</b> · Çıkış <b className="num text-ink">{todayRow?.out ?? "—"}</b></span>
          </div>
          <WebPunch inside={lastDir === "IN"} />
          <p className="text-xs text-muted">Konumla okutma için işyerinde olmanız gerekir. İşyerindeki ekranda QR kod da okutabilirsiniz.</p>
        </Card>

        <EnablePush />

        {missingDocs > 0 && (
          <Link href="/benim/belgeler" className="flex items-center justify-between gap-3 rounded-[14px] border border-[#F2C94C] bg-[#FFF4E0] p-4 text-sm">
            <span><b>{missingDocs} belge eksik.</b> e-Devlet&apos;ten indirip telefondan yükleyebilirsiniz.</span>
            <span className="font-semibold text-brand-700 whitespace-nowrap">Belgelerim →</span>
          </Link>
        )}

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Stat label={`${periodLabel(period)} hakediş`} value={formatTL(n(sum?.accrued))} />
          <Stat label="Bu ay ödenen" value={formatTL(n(sum?.paid_bank) + n(sum?.paid_cash))} sub={`Banka ${formatTL(n(sum?.paid_bank))} · Elden ${formatTL(n(sum?.paid_cash))}`} />
          <Stat label="Kalan" value={formatTL(n(sum?.balance))} />
          <Stat label={`${year} yıllık izin kullanılan`} value={`${usedAnnual} gün`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Avans iste">
            <AdvanceRequestForm />
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {(adv ?? []).map((a) => (
                <li key={a.id} className="py-2 flex flex-wrap gap-2 items-center">
                  <span className="text-muted w-20">{formatDate(a.created_at)}</span>
                  <span className="num font-semibold w-28">{formatTL(Number(a.amount))}</span>
                  <Chip s={a.status} />
                  <span className="text-xs text-muted flex-1 truncate">{a.decision_note ?? a.reason ?? ""}</span>
                  {a.status === "pending" && (
                    <form action={cancelAdvance}><input type="hidden" name="id" value={a.id} /><ConfirmSubmit label="İptal" question="Talep iptal edilsin mi?" /></form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="İzin iste">
            <LeaveRequestForm types={types ?? []} />
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {(leaves ?? []).slice(0, 8).map((l) => (
                <li key={l.id} className="py-2 flex flex-wrap gap-2 items-center">
                  <span className="w-40">{formatDate(l.start_date)}{l.end_date !== l.start_date && ` – ${formatDate(l.end_date)}`}</span>
                  <span className="flex-1">{(l.leave_types as unknown as { name: string } | null)?.name} · {l.days} gün</span>
                  <Chip s={l.status} />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Hesap hareketlerim">
            <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[340px]">
              <tbody>
                {(entries ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} text-muted`}>{formatDate(e.entry_date)}</td>
                    <td className={td}>{TYPE_LABEL[e.type] ?? e.type}</td>
                    <td className={td}><ChannelChip channel={e.channel} credit={["ACCRUAL", "BONUS", "OVERTIME"].includes(e.type)} /></td>
                    <td className={`${td} text-right num font-semibold`}>{formatTL(Number(e.amount))}</td>
                  </tr>
                ))}
                {(entries ?? []).length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted">Hareket yok.</td></tr>}
              </tbody>
            </table>
            </div>
          </Card>
          <Card title="Bordrolarım">
            <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[420px]">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Dönem</th><th className={`${th} text-right`}>Gün</th><th className={`${th} text-right`}>Brüt</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Bankaya</th></tr></thead>
              <tbody>
                {(payroll ?? []).map((p) => (
                  <tr key={p.period}>
                    <td className={td}>{periodLabel(p.period)}</td>
                    <td className={`${td} text-right num`}>{p.days}</td>
                    <td className={`${td} text-right num`}>{formatTL(Number(p.official_gross))}</td>
                    <td className={`${td} text-right num`}>{formatTL(Number(p.official_net))}</td>
                    <td className={`${td} text-right num font-semibold`}>{formatTL(Number(p.net_to_bank))}</td>
                  </tr>
                ))}
                {(payroll ?? []).length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted">Henüz bordro yok.</td></tr>}
              </tbody>
            </table>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`${periodLabel(period)} puantajım`}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className={th}>Gün</th><th className={th}>Giriş</th><th className={th}>Çıkış</th></tr></thead>
              <tbody>
                {[...days.entries()].reverse().map(([d, v]) => (
                  <tr key={d}><td className={td}>{formatDate(d)}</td><td className={`${td} num`}>{v.in ?? "—"}</td><td className={`${td} num`}>{v.out ?? "—"}</td></tr>
                ))}
                {days.size === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted">Bu ay okutma yok.</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title="Duyurular" action={<Link href="/duyurular" className="text-sm font-semibold text-brand-700">Tümü →</Link>}>
            <ul className="divide-y divide-[#EEF2F6] text-sm">
              {(anns ?? []).map((a) => (
                <li key={a.id} className="py-2 flex gap-2"><Link href="/duyurular" className="flex-1 font-semibold text-brand-800">{a.pinned ? "📌 " : ""}{a.title}</Link><span className="text-xs text-muted">{formatDate(a.published_at)}</span></li>
              ))}
              {(anns ?? []).length === 0 && <li className="py-4 text-center text-muted">Duyuru yok.</li>}
            </ul>
            <Link href="/mesajlar" className="text-sm font-semibold text-brand-700">Mesajlarım →</Link>
          </Card>
        </div>
      </div>
    </>
  );
}
