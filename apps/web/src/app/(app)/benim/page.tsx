import Link from "next/link";
import { formatTL } from "@mb/core";
import { Card, PageHeader } from "@/components/ui";
import { WebPunch } from "@/components/WebPunch";
import { EnablePush } from "@/components/Pwa";
import { MenuIcon } from "@/components/MobileNav";
import { currentPeriod, formatDate, periodLabel } from "@/lib/session";
import { me, MY_MENU, NotLinked } from "./_shared";

export default async function MyPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Benim sayfam" />;
  const period = currentPeriod();
  const year = period.slice(0, 4);
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: sum }, { data: punches }, { data: leaves }, { data: adv }, { data: payroll }, { data: anns }, { data: reqDocs }, { data: myDocs }] = await Promise.all([
    supabase.from("ledger_period_summary").select("accrued, paid_bank, paid_cash, balance").eq("employee_id", e.id).eq("period", period).maybeSingle(),
    supabase.from("attendance_punches").select("direction, punched_at").eq("employee_id", e.id).gte("punched_at", `${today}T00:00:00`).order("punched_at"),
    supabase.from("leave_requests").select("days, status, leave_types(code)").eq("employee_id", e.id).gte("start_date", `${year}-01-01`),
    supabase.from("advance_requests").select("status").eq("employee_id", e.id).eq("status", "pending"),
    supabase.from("payroll_lines").select("period, net_to_bank").eq("employee_id", e.id).order("period", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("announcements").select("id, title, published_at, pinned").order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(3),
    supabase.from("document_types").select("id").eq("onboarding_step", 2).eq("required", true),
    supabase.from("employee_documents").select("document_type_id").eq("employee_id", e.id),
  ]);
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const haveDoc = new Set((myDocs ?? []).map((d) => d.document_type_id));
  const missingDocs = (reqDocs ?? []).filter((t) => !haveDoc.has(t.id)).length;
  const todayIn = (punches ?? []).find((p) => p.direction === "IN")?.punched_at.slice(11, 16);
  const todayOut = (punches ?? []).filter((p) => p.direction === "OUT").at(-1)?.punched_at.slice(11, 16);
  const lastDir = (punches ?? []).at(-1)?.direction as "IN" | "OUT" | undefined;
  const usedAnnual = (leaves ?? []).filter((l) => l.status === "approved" && (l.leave_types as unknown as { code: string } | null)?.code === "YILLIK").reduce((a, l) => a + Number(l.days), 0);
  const pendingLeave = (leaves ?? []).filter((l) => l.status === "pending").length;
  const dept = (e.departments as unknown as { name: string } | null)?.name;

  // Her kutunun altındaki kısa bilgi
  const info: Record<string, { text: string; warn?: boolean }> = {
    "/benim/avans": adv?.length ? { text: `${adv.length} talep bekliyor`, warn: true } : { text: "Talep yok" },
    "/benim/izin": pendingLeave ? { text: `${pendingLeave} talep bekliyor`, warn: true } : { text: `${year}: ${usedAnnual} gün yıllık izin` },
    "/benim/bordro": payroll ? { text: `${periodLabel(payroll.period)} · ${formatTL(Number(payroll.net_to_bank))}` } : { text: "Henüz bordro yok" },
    "/benim/hareketler": { text: `${periodLabel(period).split(" ")[0]} kalan ${formatTL(n(sum?.balance))}` },
    "/benim/puantaj": { text: todayIn ? `Bugün ${todayIn} – ${todayOut ?? "…"}` : "Bugün okutma yok" },
    "/benim/ozluk": { text: [dept, e.card_no ? `PDKS ${e.card_no}` : null].filter(Boolean).join(" · ") || "Bilgilerim" },
    "/benim/belgeler": missingDocs ? { text: `${missingDocs} belge eksik`, warn: true } : { text: "Belgeler tamam" },
  };

  return (
    <>
      <PageHeader title={`Merhaba ${e.first_name}`} subtitle={[dept, e.hire_date ? `İşe giriş ${formatDate(e.hire_date)}` : null].filter(Boolean).join(" · ")} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <Card title="Bugün">
          <div className="flex items-center gap-3 text-sm">
            <span className={`w-3 h-3 rounded-full ${lastDir === "IN" ? "bg-[#1FA971]" : "bg-[#9AA6B2]"}`} aria-hidden />
            <span>{lastDir === "IN" ? "İçeridesiniz" : lastDir === "OUT" ? "Çıkış yaptınız" : "Bugün henüz okutma yok"}</span>
            <span className="ml-auto text-muted">Giriş <b className="num text-ink">{todayIn ?? "—"}</b> · Çıkış <b className="num text-ink">{todayOut ?? "—"}</b></span>
          </div>
          <WebPunch inside={lastDir === "IN"} />
        </Card>

        <EnablePush />

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <div className="col-span-2 md:col-span-3 lg:col-span-4 grid gap-3 grid-cols-2 sm:grid-cols-3 rounded-[14px] bg-brand-900 text-white p-4">
            <div><div className="text-[11px] uppercase tracking-wide text-white/70">{periodLabel(period)} hakediş</div><div className="num text-lg font-bold">{formatTL(n(sum?.accrued))}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-white/70">Bu ay ödenen</div><div className="num text-lg font-bold">{formatTL(n(sum?.paid_bank) + n(sum?.paid_cash))}</div></div>
            <div><div className="text-[11px] uppercase tracking-wide text-white/70">Kalan</div><div className="num text-lg font-bold">{formatTL(n(sum?.balance))}</div></div>
          </div>
          {MY_MENU.map((m) => {
            const i = info[m.href] ?? { text: m.desc };
            return (
              <Link key={m.href} href={m.href} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2 min-h-[112px] active:bg-[#F2F6FB]">
                <span className={`w-10 h-10 rounded-xl grid place-items-center ${i.warn ? "bg-[#FFF4E0] text-[#8A5A00]" : "bg-[#EAF2FB] text-brand-700"}`}><MenuIcon name={m.icon} /></span>
                <span className="font-semibold text-ink leading-tight">{m.label}</span>
                <span className={`text-xs ${i.warn ? "text-[#8A5A00] font-semibold" : "text-muted"}`}>{i.text}</span>
              </Link>
            );
          })}
        </div>

        <Card title="Duyurular" action={<Link href="/duyurular" className="text-sm font-semibold text-brand-700">Tümü →</Link>}>
          <ul className="divide-y divide-[#EEF2F6] text-sm">
            {(anns ?? []).map((a) => (
              <li key={a.id} className="py-2 flex gap-2"><Link href="/duyurular" className="flex-1 font-semibold text-brand-800">{a.pinned ? "📌 " : ""}{a.title}</Link><span className="text-xs text-muted">{formatDate(a.published_at)}</span></li>
            ))}
            {(anns ?? []).length === 0 && <li className="py-4 text-center text-muted">Duyuru yok.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
