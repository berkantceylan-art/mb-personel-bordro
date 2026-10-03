import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formatTL, splitContract, summarize, withRunningBalance, type LedgerEntry } from "@mb/core";
import { Card, ChannelChip, TYPE_LABEL } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, formatDate, getSession, periodLabel } from "@/lib/session";

async function voidEntry(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const employeeId = String(formData.get("employeeId"));
  const reason = String(formData.get("reason") ?? "").trim() || "Yanlış giriş";
  const { error } = await supabase.rpc("void_ledger_entry", { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  revalidatePath(`/personel/${employeeId}`);
}

function yearsSince(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y--;
  return y;
}

export default async function EmployeeProfile({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donem?: string }>;
}) {
  const { id } = await params;
  const { donem } = await searchParams;
  const period = donem && /^\d{4}-\d{2}$/.test(donem) ? donem : currentPeriod();
  const s = await getSession();
  const pay = canManagePay(s.role);
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("employees")
    .select("id, card_no, first_name, last_name, hire_date, status, departments(name), positions(name), branches(name)")
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();

  const [{ data: contract }, { data: entries }, { data: docTypes }, { data: docs }, { data: periods }] = await Promise.all([
    supabase.from("pay_contracts").select("*").eq("employee_id", id).order("valid_from", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ledger_entries").select("*").eq("employee_id", id).eq("period", period).is("voided_at", null),
    supabase.from("document_types").select("id, name, required, category").order("sort_order"),
    supabase.from("employee_documents").select("document_type_id, expires_on").eq("employee_id", id),
    supabase.from("ledger_entries").select("period").eq("employee_id", id).is("voided_at", null),
  ]);

  const ledger: LedgerEntry[] = (entries ?? []).map((r) => ({
    id: r.id,
    period: r.period,
    date: r.entry_date,
    type: r.type,
    channel: r.channel,
    amount: Number(r.amount),
  }));
  const rows = withRunningBalance(ledger);
  const sum = summarize(ledger);
  const noteById = new Map((entries ?? []).map((r) => [r.id, r.note as string | null]));

  const month = Number(period.slice(5, 7));
  const split = contract
    ? splitContract(
        {
          totalNet: Number(contract.total_net),
          insuranceType: contract.insurance_type,
          fixedOfficialNet: contract.fixed_official_net ? Number(contract.fixed_official_net) : undefined,
          besRate: Number(contract.bes_rate),
        },
        month,
        0,
      )
    : null;

  const have = new Set((docs ?? []).map((d) => d.document_type_id));
  const required = (docTypes ?? []).filter((d) => d.required && d.category !== "cikis");
  const missing = required.filter((d) => !have.has(d.id)).length;
  const allPeriods = [...new Set([period, currentPeriod(), ...(periods ?? []).map((p) => p.period as string)])].sort().reverse();

  const dept = (e.departments as unknown as { name: string } | null)?.name;
  const pos = (e.positions as unknown as { name: string } | null)?.name;
  const branch = (e.branches as unknown as { name: string } | null)?.name;
  const initials = `${e.first_name[0] ?? ""}${e.last_name[0] ?? ""}`;

  return (
    <div className="flex flex-col">
      <div className="px-6 md:px-8 pt-5 text-[13px] text-muted">
        <Link href="/personel" className="text-brand-700">Personel</Link> / {dept ?? "—"} / {e.first_name} {e.last_name}
      </div>

      <section className="mx-6 md:mx-8 mt-3.5 bg-white border border-line rounded-2xl p-6 flex flex-wrap gap-5 items-center">
        <div className="w-[72px] h-[72px] rounded-full bg-brand-700 text-white grid place-items-center font-display font-bold text-2xl">{initials}</div>
        <div className="flex-1 min-w-72 flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-bold text-brand-800">{e.first_name} {e.last_name}</h1>
          <span className="text-muted">{[dept, pos, branch].filter(Boolean).join(" · ")}</span>
          <div className="flex flex-wrap gap-4 text-[13px] text-[#33414F]">
            <span>Sicil <b className="num">{e.card_no ?? "—"}</b></span>
            <span>İşe giriş <b className="num">{formatDate(e.hire_date)}</b> ({yearsSince(e.hire_date)} yıl)</span>
            {contract && <span>Sigorta <b>{contract.insurance_type === "MIN_WAGE" ? "Asgari ücret" : "Belirli net"}</b></span>}
          </div>
        </div>
        {pay && (
          <Link href={`/odemeler/yeni?personel=${e.id}`} className="h-11 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">+ Avans / Ödeme</Link>
        )}
      </section>

      <div className="p-6 md:p-8 flex flex-wrap gap-5 items-start max-w-[1240px]">
        <div className="flex-[999_1_520px] min-w-0 flex flex-col gap-5">
          {pay && (
            <Card
              title={`${periodLabel(period)} hakedişi`}
              action={
                <form className="flex items-center gap-2 text-[13px] text-muted">
                  <label htmlFor="donem">Dönem</label>
                  <select id="donem" name="donem" defaultValue={period} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white text-ink">
                    {allPeriods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                  </select>
                  <button className="h-10 px-3 rounded-lg border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Göster</button>
                </form>
              }
            >
              <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                {[
                  ["Hakediş", sum.accrued, "bg-[#EEF2F6] text-ink"],
                  ["Bankadan ödenen", sum.paidBank, "bg-[#E7F1FB] text-brand-700"],
                  ["Elden ödenen", sum.paidCash, "bg-[#E0F5FB] text-accent-ink"],
                  ["Kesintiler", sum.deductions, "bg-[#F1ECFA] text-[#5B3A9A]"],
                  ["Kalan", sum.balance, "bg-warn-bg text-warn"],
                ].map(([label, v, cls]) => (
                  <div key={label as string} className={`flex flex-col gap-1 rounded-[10px] px-3.5 py-3 ${cls}`}>
                    <span className="text-xs">{label}</span>
                    <span className="num font-display text-[19px] font-bold">{formatTL(v as number)}</span>
                  </div>
                ))}
              </div>
              {contract && split && (
                <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] text-[13px]">
                  <div className="border border-dashed border-[#C5D0DC] rounded-[10px] p-3.5 flex flex-col gap-1.5">
                    <span className="font-semibold text-brand-800">Resmi bordro (tahmini)</span>
                    <span className="flex justify-between"><span>Brüt</span><b className="num">{formatTL(split.official.gross)}</b></span>
                    <span className="flex justify-between"><span>SGK + işsizlik</span><span className="num">−{formatTL(split.official.sgkEmployee + split.official.unemploymentEmployee)}</span></span>
                    <span className="flex justify-between"><span>Gelir + damga vergisi</span><span className="num">−{formatTL(split.official.incomeTax + split.official.stampTax)}</span></span>
                    <span className="flex justify-between"><span>Net (bankaya)</span><b className="num">{formatTL(split.official.net)}</b></span>
                  </div>
                  <div className="border border-dashed border-[#C5D0DC] rounded-[10px] p-3.5 flex flex-col gap-1.5">
                    <span className="font-semibold text-brand-800">İç hakediş</span>
                    <span className="flex justify-between"><span>Anlaşılan toplam</span><b className="num">{formatTL(Number(contract.total_net))}</b></span>
                    <span className="flex justify-between"><span>Resmi net</span><span className="num">{formatTL(split.official.net)}</span></span>
                    <span className="flex justify-between"><span>Elden kısım</span><b className="num">{formatTL(split.cashPart)}</b></span>
                  </div>
                </div>
              )}
            </Card>
          )}

          {pay && (
            <Card title="Cari hareketler">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Tarih</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Hareket</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line">Kanal</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Tutar</th>
                      <th className="py-2 px-1.5 font-semibold border-b border-line text-right">Kalan</th>
                      <th className="py-2 px-1.5 border-b border-line"><span className="sr-only">İşlem</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const credit = ["ACCRUAL", "BONUS", "OVERTIME"].includes(r.type);
                      return (
                        <tr key={r.id}>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-muted">{formatDate(r.date)}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]">
                            {TYPE_LABEL[r.type]}
                            {noteById.get(r.id) && <><br /><span className="text-xs text-muted">{noteById.get(r.id)}</span></>}
                          </td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6]"><ChannelChip channel={r.channel} credit={credit} /></td>
                          <td className={`num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right font-semibold ${credit ? "text-ok" : ""}`}>
                            {credit ? "+" : "−"}{formatTL(r.amount)}
                          </td>
                          <td className="num py-2.5 px-1.5 border-b border-[#EEF2F6] text-right">{formatTL(r.balanceAfter)}</td>
                          <td className="py-2.5 px-1.5 border-b border-[#EEF2F6] text-right">
                            <form action={voidEntry}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="employeeId" value={e.id} />
                              <button className="text-xs text-bad font-semibold" aria-label={`${formatDate(r.date)} tarihli hareketi iptal et`}>İptal</button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Bu dönemde hareket yok.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <aside className="flex-[1_1_300px] min-w-0 flex flex-col gap-5">
          <Card title="Özlük dosyası" action={<span className="num text-xs text-muted">{required.length - missing} / {required.length}</span>}>
            {required.map((d) => {
              const ok = have.has(d.id);
              return (
                <div key={d.id} className="flex gap-2.5 items-center text-[13px]">
                  <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${ok ? "bg-[#1E7A4C]" : "bg-[#B42318]"}`} />
                  <span className="flex-1">{d.name}</span>
                  <span className={`text-xs ${ok ? "text-ok" : "text-bad"}`}>{ok ? "Yüklü" : "Eksik"}</span>
                </div>
              );
            })}
          </Card>
          <Card title="Sıradaki aşamalarda">
            <p className="text-[13px] text-muted">Puantaj, izin, fazla mesai, BES, icra, İSG ve sağlık sekmeleri sonraki aşamalarda bu profile eklenecek.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
