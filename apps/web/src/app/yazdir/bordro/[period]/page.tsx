import { redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PrintButton } from "@/components/PrintButton";
import { TYPE_LABEL } from "@/components/ui";
import { computePayroll, type PayrollRow } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, periodLabel } from "@/lib/session";

export const dynamic = "force-dynamic";

type Entry = { employee_id: string; entry_date: string; type: string; channel: string; amount: number; pay_side: string | null; note: string | null };
type Priv = { employee_id: string; national_id: string | null; sgk_no: string | null; iban: string | null };

const Row = ({ l, v, b }: { l: string; v: string; b?: boolean }) => (
  <tr className={b ? "font-bold" : ""}>
    <td className="py-[3px] pr-2">{l}</td>
    <td className="py-[3px] text-right tabular-nums whitespace-nowrap">{v}</td>
  </tr>
);

function Official({ r, period, company, priv, position }: { r: PayrollRow; period: string; company: string; priv?: Priv; position?: string | null }) {
  const b = r.result.breakdown;
  return (
    <section className="sheet">
      <header className="flex justify-between items-start border-b-2 border-[#0A3D73] pb-2 mb-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-12 h-10 object-contain" />
          <div><div className="font-bold text-[15px]">{company}</div><div className="text-[11px] text-[#5A6878]">Ücret hesap pusulası (resmi bordro)</div></div>
        </div>
        <div className="text-right"><div className="font-bold">{periodLabel(period)}</div><div className="text-[11px] text-[#5A6878]">{r.result.days} gün</div></div>
      </header>
      <table className="w-full text-[12px] mb-3">
        <tbody>
          <tr><td className="text-[#5A6878] w-32">Adı soyadı</td><td className="font-semibold">{r.name}</td><td className="text-[#5A6878] w-28">TC kimlik no</td><td>{priv?.national_id ?? "—"}</td></tr>
          <tr><td className="text-[#5A6878]">Bölüm / görev</td><td>{r.dept}{position ? ` / ${position}` : ""}</td><td className="text-[#5A6878]">SGK no</td><td>{priv?.sgk_no ?? "—"}</td></tr>
          <tr><td className="text-[#5A6878]">İşe giriş</td><td>{formatDate(r.hireDate)}</td><td className="text-[#5A6878]">IBAN</td><td className="text-[11px]">{priv?.iban ?? "—"}</td></tr>
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-6 text-[12px]">
        <div>
          <h3 className="font-bold text-[#0A3D73] border-b border-[#C5D0DC] mb-1">Kazançlar</h3>
          <table className="w-full"><tbody>
            <Row l={`Normal çalışma (${r.result.days} gün)`} v={formatTL(r.result.dayGross)} />
            {r.result.overtimeGross > 0 && <Row l="Fazla mesai" v={formatTL(r.result.overtimeGross)} />}
            {r.result.bonusGross > 0 && <Row l="Prim / ikramiye" v={formatTL(r.result.bonusGross)} />}
            <Row l="Brüt toplam" v={formatTL(b.gross)} b />
          </tbody></table>
          <h3 className="font-bold text-[#0A3D73] border-b border-[#C5D0DC] mt-3 mb-1">Matrahlar</h3>
          <table className="w-full"><tbody>
            <Row l="SGK prime esas kazanç" v={formatTL(b.sgkBase)} />
            <Row l="Gelir vergisi matrahı" v={formatTL(b.taxBase)} />
            <Row l="Kümülatif GV matrahı" v={formatTL(b.cumulativeTaxBaseAfter)} />
          </tbody></table>
        </div>
        <div>
          <h3 className="font-bold text-[#0A3D73] border-b border-[#C5D0DC] mb-1">Kesintiler</h3>
          <table className="w-full"><tbody>
            <Row l="SGK işçi payı (%14)" v={formatTL(b.sgkEmployee)} />
            <Row l="İşsizlik işçi payı (%1)" v={formatTL(b.unemploymentEmployee)} />
            <Row l="Gelir vergisi (hesaplanan)" v={formatTL(b.incomeTaxGross)} />
            <Row l="Asgari ücret GV istisnası" v={`−${formatTL(b.incomeTaxExemption)}`} />
            <Row l="Gelir vergisi" v={formatTL(b.incomeTax)} />
            <Row l="Damga vergisi (istisna sonrası)" v={formatTL(b.stampTax)} />
            {b.bes > 0 && <Row l="BES otomatik katılım" v={formatTL(b.bes)} />}
            {r.result.garnishmentTotal > 0 && <Row l="İcra / nafaka" v={formatTL(r.result.garnishmentTotal)} />}
          </tbody></table>
        </div>
      </div>
      <div className="mt-4 flex justify-between items-center bg-[#F3F6F9] rounded-lg px-4 py-3">
        <span className="text-[12px]">Net ücret <b className="tabular-nums">{formatTL(b.net)}</b></span>
        <span className="text-[14px] font-bold">Bankaya ödenecek: <span className="tabular-nums">{formatTL(r.result.netToBank)}</span></span>
      </div>
      <div className="mt-2 text-[10.5px] text-[#5A6878]">
        İşveren payları: SGK {formatTL(b.sgkEmployer)} · işsizlik {formatTL(b.unemploymentEmployer)} · toplam işveren maliyeti {formatTL(b.employerCost)}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-10 text-[11px]">
        <div className="border-t border-[#5A6878] pt-1">İşveren kaşe / imza</div>
        <div className="border-t border-[#5A6878] pt-1">Yukarıdaki hesap pusulasını aldım. — {r.name}</div>
      </div>
    </section>
  );
}

function Internal({ r, period, company, entries }: { r: PayrollRow; period: string; company: string; entries: Entry[] }) {
  const pendingDed = r.saved?.posted ? 0 : r.result.breakdown.bes + r.result.garnishmentTotal;
  const credit = (t: string) => ["ACCRUAL", "BONUS", "OVERTIME"].includes(t);
  const sideTxt = (e: Entry) => (e.channel === "BANK" ? "Banka" : e.channel === "CASH" ? "Elden" : e.pay_side === "OFFICIAL" ? "Resmi" : e.pay_side === "CASH" ? "Elden" : "");
  return (
    <section className="sheet">
      <header className="flex justify-between items-start border-b-2 border-[#00A6D6] pb-2 mb-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-12 h-10 object-contain" />
          <div><div className="font-bold text-[15px]">{company}</div><div className="text-[11px] text-[#5A6878]">İç hakediş ve ödeme fişi</div></div>
        </div>
        <div className="text-right"><div className="font-bold">{periodLabel(period)}</div><div className="text-[11px] text-[#5A6878]">{r.name} · {r.dept}</div></div>
      </header>
      <div className="grid grid-cols-3 gap-3 text-[12px] mb-3">
        <div className="bg-[#F3F6F9] rounded-lg p-2.5"><div className="text-[#5A6878]">Anlaşılan aylık ücret</div><div className="font-bold tabular-nums">{formatTL(r.totalNet)}</div></div>
        <div className="bg-[#F3F6F9] rounded-lg p-2.5"><div className="text-[#5A6878]">Resmi net (bordro)</div><div className="font-bold tabular-nums">{formatTL(r.result.breakdown.net)}</div></div>
        <div className="bg-[#F3F6F9] rounded-lg p-2.5"><div className="text-[#5A6878]">Elden kısım (tam ay)</div><div className="font-bold tabular-nums">{formatTL(r.result.cashPart)}</div></div>
      </div>
      <table className="w-full text-[12px]">
        <thead><tr className="text-left text-[#5A6878] border-b border-[#C5D0DC]"><th className="py-1">Tarih</th><th>Hareket</th><th>Kanal</th><th className="text-right">Alacak</th><th className="text-right">Ödeme / kesinti</th></tr></thead>
        <tbody>
          {entries.sort((a, b) => a.entry_date.localeCompare(b.entry_date)).map((e, i) => (
            <tr key={i} className="border-b border-[#EEF2F6]">
              <td className="py-[3px] tabular-nums">{formatDate(e.entry_date)}</td>
              <td>{TYPE_LABEL[e.type]}{e.note ? <span className="text-[#5A6878]"> · {e.note}</span> : null}</td>
              <td>{sideTxt(e)}</td>
              <td className="text-right tabular-nums">{credit(e.type) ? formatTL(Number(e.amount)) : ""}</td>
              <td className="text-right tabular-nums">{credit(e.type) ? "" : formatTL(Number(e.amount))}</td>
            </tr>
          ))}
          {pendingDed > 0 && (
            <tr className="border-b border-[#EEF2F6] text-[#5A6878]"><td className="py-[3px]">—</td><td>BES / icra (bordrodan, henüz cariye yazılmadı)</td><td>Resmi</td><td /><td className="text-right tabular-nums">{formatTL(pendingDed)}</td></tr>
          )}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-6 mt-4 text-[12px]">
        <table className="w-full"><tbody>
          <Row l="Toplam alacak" v={formatTL(r.ledger.accrued)} />
          <Row l="Bankadan ödenen" v={formatTL(r.ledger.paidBank)} />
          <Row l="Elden ödenen" v={formatTL(r.ledger.paidCash)} />
          <Row l="Kesintiler" v={formatTL(r.ledger.deductions + pendingDed)} />
          <Row l="Kalan alacak" v={formatTL(r.ledger.balance - pendingDed)} b />
        </tbody></table>
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border-2 border-[#0A3D73] px-3 py-2 flex justify-between"><span>Bankaya yatacak</span><b className="tabular-nums">{formatTL(r.pay.bank)}</b></div>
          <div className="rounded-lg border-2 border-[#00A6D6] px-3 py-2 flex justify-between"><span>Elden verilecek</span><b className="tabular-nums">{formatTL(r.pay.cash)}</b></div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-10 text-[11px]">
        <div className="border-t border-[#5A6878] pt-1">Ödeyen</div>
        <div className="border-t border-[#5A6878] pt-1">Yukarıdaki tutarları teslim aldım. — {r.name}</div>
      </div>
    </section>
  );
}

export default async function PrintPayroll({ params, searchParams }: { params: Promise<{ period: string }>; searchParams: Promise<{ tur?: string; personel?: string; bolum?: string }> }) {
  const { period } = await params;
  const sp = await searchParams;
  const s = await getSession();
  const self = sp.personel;
  if (!["owner", "accountant"].includes(s.role) && !self) redirect("/");
  if (!/^\d{4}-\d{2}$/.test(period)) redirect("/bordro");
  const kind = sp.tur === "ic" ? "ic" : "resmi";
  const supabase = await createClient();
  let rows = await computePayroll(supabase, period, { employeeId: self });
  if (sp.bolum) rows = rows.filter((r) => r.dept === sp.bolum);
  const ids = rows.map((r) => r.employeeId);
  const [{ data: privs }, { data: emps }, { data: entries }] = await Promise.all([
    supabase.from("employee_private").select("employee_id, national_id, sgk_no, iban").in("employee_id", ids),
    supabase.from("employees").select("id, position_title").in("id", ids),
    kind === "ic"
      ? supabase.from("ledger_entries").select("employee_id, entry_date, type, channel, amount, pay_side, note").eq("period", period).is("voided_at", null).in("employee_id", ids)
      : Promise.resolve({ data: [] as Entry[] }),
  ]);
  const priv = new Map((privs ?? []).map((p) => [p.employee_id, p as Priv]));
  const pos = new Map((emps ?? []).map((e) => [e.id, e.position_title as string | null]));

  return (
    <main className="bg-[#E9EEF4] min-h-screen print:bg-white">
      <style>{`
        @page { size: A4; margin: 12mm; }
        .sheet { background: #fff; width: 186mm; min-height: 130mm; margin: 0 auto 8mm; padding: 10mm; box-sizing: border-box; color: #14202E; font-family: 'Public Sans', sans-serif; }
        @media print { .sheet { margin: 0; padding: 0; width: auto; break-after: page; } .noprint { display: none !important; } }
      `}</style>
      <div className="noprint sticky top-0 z-10 bg-white border-b border-[#E1E7EE] px-6 py-3 flex items-center gap-4">
        <span className="font-semibold">{kind === "resmi" ? "Resmi bordrolar" : "İç hakediş fişleri"} · {periodLabel(period)} · {rows.length} kişi</span>
        <PrintButton />
        <span className="text-xs text-[#5A6878]">Yazdır penceresinde &quot;Hedef: PDF olarak kaydet&quot; seçerek PDF alabilirsiniz.</span>
      </div>
      <div className="py-6 print:py-0">
        {rows.map((r) =>
          kind === "resmi" ? (
            <Official key={r.employeeId} r={r} period={period} company={s.companyName} priv={priv.get(r.employeeId)} position={pos.get(r.employeeId)} />
          ) : (
            <Internal key={r.employeeId} r={r} period={period} company={s.companyName} entries={((entries ?? []) as Entry[]).filter((e) => e.employee_id === r.employeeId)} />
          ),
        )}
        {rows.length === 0 && <p className="text-center text-[#5A6878]">Bu dönemde bordro yok.</p>}
      </div>
    </main>
  );
}
