"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { CURRENCIES, dateOk, finError, parseAmount, today } from "@/lib/fin";
import type { Inst } from "@/lib/loan";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;
const cur = (v: string) => ((CURRENCIES as readonly string[]).includes(v) ? v : "TRY");

async function need(level: number, alt?: string) {
  const s = await getSession();
  const ok = (s.modules.finance ?? 0) >= level || (alt ? (s.modules[alt] ?? 0) >= level : false);
  if (!ok) await fail("Bu işlem için yetkiniz yok (Yönetim > Yetkiler).");
  return s;
}
const reval = () => revalidatePath("/finans", "layout");

// ---------------------------------------------------------------------
// Çek / senet
// ---------------------------------------------------------------------
export async function newCheque(form: FormData) {
  await need(2);
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const due = dateOk(str(form, "due_date"));
  if (!due) await fail("Vade tarihini yazın.");
  const direction = str(form, "direction") === "out" ? "out" : "in";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_cheque_new", {
    p: {
      direction, doc_type: str(form, "doc_type") === "note" ? "note" : "cheque", serial_no: opt(form, "serial_no", 40), bank_name: opt(form, "bank_name", 80), branch: opt(form, "branch", 80),
      account_no: opt(form, "account_no", 40), drawer: opt(form, "drawer", 160), drawer_tax_no: opt(form, "drawer_tax_no", 11), amount, currency: cur(str(form, "currency")),
      issue_date: dateOk(str(form, "issue_date")), due_date: due, party_id: opt(form, "party_id", 40), bank_account_id: opt(form, "bank_account_id", 40), note: opt(form, "note", 500),
      date: dateOk(str(form, "date")) ?? today(),
    },
  });
  if (error) await fail(finError(error.message));
  reval();
  redirect(`/finans/cek-senet/${data}?tamam=${encodeURIComponent(direction === "in" ? "Çek / senet portföye alındı; cari bakiyesinden düşüldü." : "Verilen çek kaydedildi; cariye ödeme olarak işlendi.")}`);
}

export async function chequeAction(form: FormData) {
  await need(2);
  const supabase = await createClient();
  const action = str(form, "action", 20);
  const { error } = await supabase.rpc("fin_cheque_action", {
    p_id: str(form, "id", 40), p_action: action,
    p: { account_id: opt(form, "account_id", 40), party_id: opt(form, "party_id", 40), date: dateOk(str(form, "date")) ?? today(), note: opt(form, "note", 300) },
  });
  if (error) await fail(finError(error.message));
  reval();
  const msg: Record<string, string> = { deposit: "Tahsile verildi.", collect: "Tahsil edildi; bankaya girdi.", endorse: "Ciro edildi; firmaya ödeme olarak işlendi.", bounce: "Karşılıksız işlendi; borç cariye geri yazıldı.", return: "Çek iade edildi.", pay: "Çek ödendi.", cancel: "Çek geri alındı / iptal edildi." };
  await done(msg[action] ?? "Kaydedildi.");
}

export async function chequeUndo(form: FormData) {
  await need(3);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_cheque_undo", { p_id: str(form, "id", 40) });
  if (error) await fail(finError(error.message));
  reval();
  if (data === "deleted") redirect(`/finans/cek-senet?tamam=${encodeURIComponent("Çek kaydı silindi; cari bakiyesi geri alındı.")}`);
  await done("Son işlem geri alındı.");
}

// ---------------------------------------------------------------------
// Kredi kartı
// ---------------------------------------------------------------------
export async function cardSpend(form: FormData) {
  await need(2, "expenses");
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const supabase = await createClient();
  const toParty = str(form, "target") === "party";
  const { error } = await supabase.rpc("fin_card_spend", {
    p: {
      account_id: str(form, "account_id", 40), date: dateOk(str(form, "date")) ?? today(), amount, installments: Math.max(1, Math.min(48, Number(str(form, "installments")) || 1)),
      party_id: toParty ? opt(form, "party_id", 40) : null, category_id: toParty ? null : opt(form, "category_id", 40), vat_rate: toParty ? 0 : Number(str(form, "vat_rate")) || 0,
      description: opt(form, "description", 300), doc_no: opt(form, "doc_no", 60),
    },
  });
  if (error) await fail(finError(error.message));
  reval();
  await done("Kart harcaması kaydedildi; taksitler ekstre tahminine eklendi.");
}

export async function cardPay(form: FormData) {
  await need(2);
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const supabase = await createClient();
  const card = str(form, "card_id", 40), bank = str(form, "account_id", 40);
  const { data: accs } = await supabase.from("fin_accounts").select("id, currency, name").in("id", [card, bank]);
  const c = accs?.find((a) => a.id === card), b = accs?.find((a) => a.id === bank);
  if (!c || !b) await fail("Kart ve ödeme hesabını seçin.");
  if (c!.currency !== b!.currency) await fail("Kart ve banka hesabı aynı para biriminde olmalı.");
  const date = dateOk(str(form, "date")) ?? today();
  const { error } = await supabase.rpc("fin_post", {
    p_header: { kind: "card_payment", txn_date: date, description: `Kart borcu ödemesi · ${c!.name}`, amount, currency: c!.currency, account_id: card, module: "finance" },
    p_lines: [{ account_id: bank, amount: -amount!, currency: b!.currency }, { account_id: card, amount, currency: c!.currency }],
  });
  if (error) await fail(finError(error.message));
  reval();
  await done("Kart borcu ödendi.");
}

// ---------------------------------------------------------------------
// Krediler
// ---------------------------------------------------------------------
export type LoanPayload = {
  name: string; bank_name: string; loan_no: string; principal: number; currency: string; annual_rate: number; tax_pct: number; method: string;
  start_date: string; disbursed_account_id: string | null; existing: boolean; note: string; schedule: Inst[];
};

export async function createLoan(p: LoanPayload): Promise<{ ok: boolean; id?: string; message: string }> {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 3) return { ok: false, message: "Kredi tanımlamak için finans yönetici yetkisi gerekir." };
  if (!p.schedule?.length) return { ok: false, message: "Ödeme planı boş." };
  if (!p.existing && !p.disbursed_account_id) return { ok: false, message: "Kredinin yatacağı banka hesabını seçin." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_loan_create", {
    p: { ...p, currency: cur(p.currency), start_date: dateOk(p.start_date) ?? today(), schedule: p.schedule.slice(0, 240).map((i) => ({ no: i.no, due_date: dateOk(i.due_date), principal: Math.max(0, Math.round(i.principal)), interest: Math.max(0, Math.round(i.interest)), tax: Math.max(0, Math.round(i.tax)) })) },
  });
  if (error) return { ok: false, message: finError(error.message) };
  reval();
  return { ok: true, id: data as string, message: "Kredi kaydedildi." };
}

export async function payLoan(form: FormData) {
  await need(2);
  const supabase = await createClient();
  const total = parseAmount(str(form, "total"));
  const { error } = await supabase.rpc("fin_loan_pay", { p_inst: str(form, "id", 40), p_account: str(form, "account_id", 40), p_date: dateOk(str(form, "date")) ?? today(), p_total: total });
  if (error) await fail(finError(error.message));
  reval();
  await done("Taksit ödendi; anapara krediden, faiz gidere yazıldı.");
}

export async function unpayLoan(form: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_loan_unpay", { p_inst: str(form, "id", 40) });
  if (error) await fail(finError(error.message));
  reval();
  await done("Ödeme geri alındı.");
}

export async function editLoanInst(form: FormData) {
  await need(3);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_loan_edit", {
    p_inst: str(form, "id", 40), p_due: dateOk(str(form, "due_date")), p_principal: parseAmount(str(form, "principal")), p_interest: parseAmount(str(form, "interest")), p_tax: parseAmount(str(form, "tax")),
  });
  if (error) await fail(finError(error.message));
  reval();
  await done("Taksit güncellendi.");
}

// ---------------------------------------------------------------------
// Avans (personel iş avansı) ve ortak hesapları
// ---------------------------------------------------------------------
async function postSimple(kind: string, mod: string, date: string, description: string, amount: number, currency: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_post", { p_header: { kind, txn_date: date, description, amount, currency, module: mod, ...extra }, p_lines: lines });
  if (error) await fail(finError(error.message));
}

async function accountsOf(ids: string[]) {
  const supabase = await createClient();
  const { data } = await supabase.from("fin_accounts").select("id, kind, currency, name, holder_name").in("id", ids.filter(Boolean));
  return new Map((data ?? []).map((a) => [a.id as string, a as { id: string; kind: string; currency: string; name: string; holder_name: string | null }]));
}

export async function advanceOp(form: FormData) {
  const s = await need(2, "expenses");
  const op = str(form, "op", 10);
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const supabase = await createClient();
  let advId = str(form, "advance_id", 40);
  if (!advId && str(form, "employee_id")) {
    const { data, error } = await supabase.rpc("fin_advance_account", { p_employee: str(form, "employee_id", 40), p_currency: cur(str(form, "currency")) });
    if (error) await fail(finError(error.message));
    advId = data as string;
  }
  const cash = str(form, "account_id", 40);
  const acc = await accountsOf([advId, cash]);
  const adv = acc.get(advId);
  if (!adv) await fail("Personel / avans hesabı seçin.");
  const date = dateOk(str(form, "date")) ?? today();
  const desc = str(form, "description", 300);
  const who = adv!.holder_name ?? adv!.name;
  if (op === "give" || op === "return") {
    const c = acc.get(cash);
    if (!c) await fail("Kasa / banka seçin.");
    if (c!.currency !== adv!.currency) await fail("Avans ve kasa aynı para biriminde olmalı.");
    const sgn = op === "give" ? 1 : -1;
    await postSimple(op === "give" ? "advance_give" : "advance_return", "finance", date, `${op === "give" ? "Avans verildi" : "Avans iadesi"} · ${who}${desc ? ` · ${desc}` : ""}`, amount!, adv!.currency,
      [{ account_id: advId, amount: sgn * amount!, currency: adv!.currency }, { account_id: cash, amount: -sgn * amount!, currency: c!.currency }], { account_id: advId });
  } else if (op === "close") {
    const vr = Number(str(form, "vat_rate")) || 0;
    const vat = vr > 0 ? Math.round((amount! * vr) / (100 + vr)) : 0;
    const cat = opt(form, "category_id", 40);
    if (!cat) await fail("Gider hesabı seçin.");
    await postSimple("advance_close", (s.modules.finance ?? 0) >= 2 ? "finance" : "expenses", date, `Avans kapama (masraf) · ${who}${desc ? ` · ${desc}` : ""}`, amount!, adv!.currency,
      [{ account_id: advId, amount: -amount!, currency: adv!.currency }, { category_id: cat, amount: amount! - vat, currency: adv!.currency }, ...(vat ? [{ category_id: await vatCat(), amount: vat, currency: adv!.currency }] : [])],
      { account_id: advId, doc_no: opt(form, "doc_no", 60) });
  } else await fail("Bilinmeyen işlem.");
  reval();
  await done(op === "give" ? "Avans verildi." : op === "return" ? "Avans iadesi alındı." : "Avans masrafla kapatıldı.");
}

async function vatCat() {
  const supabase = await createClient();
  const { data } = await supabase.from("fin_categories").select("id").eq("code", "vat_in").limit(1).maybeSingle();
  return data?.id as string;
}

export async function partnerOp(form: FormData) {
  await need(2);
  const op = str(form, "op", 10);
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const pid = str(form, "partner_id", 40), cash = str(form, "account_id", 40);
  const acc = await accountsOf([pid, cash]);
  const p = acc.get(pid);
  if (!p || p.kind !== "partner") await fail("Ortak seçin.");
  const date = dateOk(str(form, "date")) ?? today();
  const desc = str(form, "description", 300);
  if (op === "in" || op === "out") {
    const c = acc.get(cash);
    if (!c) await fail("Kasa / banka seçin.");
    if (c!.currency !== p!.currency) await fail("Ortak hesabı ve kasa aynı para biriminde olmalı.");
    const sgn = op === "in" ? 1 : -1;
    await postSimple(op === "in" ? "partner_in" : "partner_out", "finance", date, `${op === "in" ? "Ortaktan şirkete" : "Şirketten ortağa"} · ${p!.name}${desc ? ` · ${desc}` : ""}`, amount!, p!.currency,
      [{ account_id: cash, amount: sgn * amount!, currency: c!.currency }, { account_id: pid, amount: -sgn * amount!, currency: p!.currency }], { account_id: pid });
  } else if (op === "expense") {
    const cat = opt(form, "category_id", 40);
    if (!cat) await fail("Gider hesabı seçin.");
    const vr = Number(str(form, "vat_rate")) || 0;
    const vat = vr > 0 ? Math.round((amount! * vr) / (100 + vr)) : 0;
    await postSimple("partner_in", "finance", date, `Ortak şirket masrafını ödedi · ${p!.name}${desc ? ` · ${desc}` : ""}`, amount!, p!.currency,
      [{ account_id: pid, amount: -amount!, currency: p!.currency }, { category_id: cat, amount: amount! - vat, currency: p!.currency }, ...(vat ? [{ category_id: await vatCat(), amount: vat, currency: p!.currency }] : [])], { account_id: pid });
  } else await fail("Bilinmeyen işlem.");
  reval();
  await done("Ortak hesabına işlendi.");
}

// ---------------------------------------------------------------------
// Veresiye
// ---------------------------------------------------------------------
export async function creditSale(form: FormData) {
  const s = await getSession();
  const mod = (s.modules.sales ?? 0) >= 2 ? "sales" : "finance";
  if ((s.modules[mod] ?? 0) < 2) await fail("Bu işlem için yetkiniz yok.");
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const supabase = await createClient();
  const { data: party } = await supabase.from("fin_parties").select("id, name, currency, credit_limit").eq("id", str(form, "party_id", 40)).maybeSingle();
  if (!party) await fail("Cari seçin.");
  const vr = Number(str(form, "vat_rate")) || 0;
  const vat = vr > 0 ? Math.round((amount! * vr) / (100 + vr)) : 0;
  const { data: cats } = await supabase.from("fin_categories").select("id, code").in("code", ["sales_goods", "vat_out"]);
  const catId = opt(form, "category_id", 40) ?? (cats ?? []).find((c) => c.code === "sales_goods")?.id;
  const vatId = (cats ?? []).find((c) => c.code === "vat_out")?.id;
  const date = dateOk(str(form, "date")) ?? today();
  const { error } = await supabase.rpc("fin_post", {
    p_header: { kind: "credit_sale", txn_date: date, description: `Veresiye satış · ${str(form, "description", 300) || party!.name}`, amount, currency: party!.currency, party_id: party!.id, module: mod, doc_no: opt(form, "doc_no", 60) },
    p_lines: [{ party_id: party!.id, amount, currency: party!.currency }, { category_id: catId, amount: -(amount! - vat), currency: party!.currency }, ...(vat ? [{ category_id: vatId, amount: -vat, currency: party!.currency }] : [])],
  });
  if (error) await fail(finError(error.message));
  if (form.get("mark") === "on") await supabase.from("fin_parties").update({ credit_sales: true }).eq("id", party!.id);
  reval();
  await done("Veresiye satış yazıldı.");
}

export async function setCreditSales(form: FormData) {
  await need(2, "sales");
  const supabase = await createClient();
  const { error } = await supabase.from("fin_parties").update({ credit_sales: form.get("on") === "1", credit_limit: parseAmount(str(form, "credit_limit")) }).eq("id", str(form, "party_id", 40));
  if (error) await fail(finError(error.message));
  reval();
  await done("Veresiye ayarı kaydedildi.");
}
