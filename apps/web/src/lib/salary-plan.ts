import { computePayroll } from "@/lib/payroll";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

export interface PlanRow {
  id: string;
  name: string;
  dept: string;
  totalNet: number;
  days: number;
  officialNet: number;
  bes: number;
  icra: number;
  netToBank: number;
  accrued: number;
  deductions: number;
  paidBank: number;
  paidCash: number;
  leftBank: number;
  leftCash: number;
  balance: number;
  saved: boolean;
}

export interface PaidEntry {
  id: string;
  employeeId: string;
  name: string;
  date: string;
  type: string;
  channel: string;
  amount: number;
  account: string | null;
  note: string | null;
}

export interface Remit {
  key: string;
  kind: "bes" | "icra" | "sgk" | "vergi";
  refId: string | null;
  label: string;
  detail: string;
  due: number;
  paid: { id: string; amount: number; date: string; account: string | null } | null;
}

export interface PayAccount { id: string; name: string; kind: "bank" | "cash" }

export const REMIT_ERR: Record<string, string> = {
  not_allowed: "Yetkiniz yok.",
  period_closed: "Dönem kapalı; önce dönemi açın.",
  date_required: "Ödeme tarihini seçin.",
  items_required: "Ödenecek personel seçin.",
  account_required: "Ödemenin yapıldığı kasa / bankayı seçin.",
  account_inactive: "Seçilen hesap pasif.",
  account_currency: "Maaş ödemesi yalnız TL hesaptan yapılabilir.",
  account_kind_bank: "Banka ödemesi için bir banka hesabı seçin.",
  account_kind_cash: "Elden ödeme için bir kasa seçin.",
  employee_not_found: "Personel bulunamadı.",
  already_paid: "Bu kalem bu dönem için zaten ödendi olarak işaretli.",
  amount_required: "Tutar girin.",
  not_found: "Kayıt bulunamadı.",
};

export function planError(msg: string): string {
  const code = Object.keys(REMIT_ERR).find((k) => msg.includes(k));
  if (code) return REMIT_ERR[code]!;
  if (/function .* does not exist|payroll_pay|payroll_remit/.test(msg)) return "Maaş planı veritabanı güncellemesi eksik: Supabase'de 20270114000000_payroll_pay.sql dosyasını çalıştırın.";
  return msg;
}

export async function loadPlan(supabase: SB, period: string) {
  const [rows, { data: per }, { data: paidRows }, { data: accRows }, { data: remRows }, { data: files }] = await Promise.all([
    computePayroll(supabase, period),
    supabase.from("payroll_periods").select("status").eq("period", period).maybeSingle(),
    supabase.from("ledger_entries").select("id, employee_id, entry_date, type, channel, amount, note, account_id").eq("period", period).in("type", ["SALARY", "ADVANCE"]).is("voided_at", null).order("entry_date", { ascending: false }),
    supabase.from("fin_accounts").select("id, name, kind, currency, is_active, sort").in("kind", ["bank", "cash"]).eq("is_active", true).eq("currency", "TRY").order("sort").order("name"),
    supabase.from("payroll_remittances").select("id, kind, ref_id, amount, paid_on, account_id").eq("period", period).is("voided_at", null),
    supabase.from("garnishment_files").select("id, office, file_no, kind, employee_id"),
  ]);
  const accounts: PayAccount[] = (accRows ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind as "bank" | "cash" }));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const empName = new Map(rows.map((r) => [r.employeeId, r.name]));

  const plan: PlanRow[] = rows.map((r) => {
    const pendingDed = r.saved?.posted ? 0 : r.result.breakdown.bes + r.result.garnishmentTotal;
    return {
      id: r.employeeId,
      name: r.name,
      dept: r.dept,
      totalNet: r.totalNet,
      days: r.result.days,
      officialNet: r.result.breakdown.net,
      bes: r.result.breakdown.bes,
      icra: r.result.garnishmentTotal,
      netToBank: r.result.netToBank,
      accrued: r.ledger.accrued,
      deductions: r.ledger.deductions + pendingDed,
      paidBank: r.ledger.paidBank,
      paidCash: r.ledger.paidCash,
      leftBank: r.pay.bank,
      leftCash: r.pay.cash,
      balance: r.ledger.balance - pendingDed,
      saved: !!r.saved,
    };
  });

  const paid: PaidEntry[] = (paidRows ?? []).map((e) => ({
    id: e.id,
    employeeId: e.employee_id,
    name: empName.get(e.employee_id) ?? "—",
    date: e.entry_date,
    type: e.type,
    channel: e.channel,
    amount: Number(e.amount),
    account: e.account_id ? accName.get(e.account_id) ?? "—" : null,
    note: e.note,
  }));

  // Kurum ödemeleri: bordrodan hesaplanan tutarlar + bu dönem ödendi kaydı
  const remPaid = new Map((remRows ?? []).map((r) => [`${r.kind}:${r.ref_id ?? ""}`, { id: r.id, amount: Number(r.amount), date: r.paid_on, account: r.account_id ? accName.get(r.account_id) ?? "—" : null }]));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const besPeople = rows.filter((r) => r.result.breakdown.bes > 0).length;
  const remits: Remit[] = [];
  const add = (kind: Remit["kind"], refId: string | null, label: string, detail: string, due: number) => {
    const key = `${kind}:${refId ?? ""}`;
    const p = remPaid.get(key) ?? null;
    if (due > 0 || p) remits.push({ key, kind, refId, label, detail, due, paid: p });
  };
  add("bes", null, "BES katkı payları", `${besPeople} personel · BES şirketine`, sum((r) => r.result.breakdown.bes));
  const fileById = new Map((files ?? []).map((f) => [f.id, f]));
  const icraByFile = new Map<string, { amount: number; emp: string }>();
  for (const r of rows) for (const g of r.result.garnishments) {
    const cur = icraByFile.get(g.fileId) ?? { amount: 0, emp: r.name };
    cur.amount += g.amount;
    icraByFile.set(g.fileId, cur);
  }
  for (const k of remPaid.keys()) if (k.startsWith("icra:") && !icraByFile.has(k.slice(5))) icraByFile.set(k.slice(5), { amount: 0, emp: empName.get(fileById.get(k.slice(5))?.employee_id ?? "") ?? "" });
  for (const [fid, v] of icraByFile) {
    const f = fileById.get(fid);
    add("icra", fid, f ? `${f.kind === "ALIMONY" ? "Nafaka" : "İcra"} · ${f.office}` : "İcra / nafaka", `${v.emp}${f ? ` · dosya ${f.file_no}` : ""}`, v.amount);
  }
  add("sgk", null, "SGK primleri", "İşçi + işveren payı, işsizlik dahil (teşvik düşülmüş)", sum((r) => r.result.breakdown.sgkEmployee + r.result.breakdown.unemploymentEmployee + r.result.breakdown.sgkEmployer + r.result.breakdown.unemploymentEmployer));
  add("vergi", null, "Muhtasar: gelir + damga vergisi", "Bordrodan kesilen vergiler", sum((r) => r.result.breakdown.incomeTax + r.result.breakdown.stampTax));

  return { plan, paid, remits, accounts, closed: per?.status === "closed", opened: !!per };
}
