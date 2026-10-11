"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { CURRENCIES, dateOk, finError, parseAmount, parseRate, today } from "@/lib/fin";
import { fetchTcmb } from "@/lib/tcmb";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;
const cur = (v: string) => ((CURRENCIES as readonly string[]).includes(v) ? v : "TRY");

async function need(module: string, level: number) {
  const s = await getSession();
  if ((s.modules[module] ?? 0) < level) await fail("Bu işlem için yetkiniz yok (Yönetim > Yetkiler).");
  return s;
}

// ---------------------------------------------------------------------
// Cari kart
// ---------------------------------------------------------------------
export async function saveParty(form: FormData) {
  const s = await getSession();
  if (!["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 2)) await fail("Cari kart için yetkiniz yok.");
  const id = str(form, "id", 40);
  const name = str(form, "name", 200);
  if (!name) await fail("Cari adı yazın.");
  const taxNo = str(form, "tax_no", 20).replace(/\D/g, "");
  if (taxNo && ![10, 11].includes(taxNo.length)) await fail("Vergi no 10, TC kimlik no 11 haneli olmalı.");
  const openAmt = parseAmount(str(form, "opening_amount")) ?? 0;
  const openSide = str(form, "opening_side");          // "receivable" bize borçlu, "payable" biz borçluyuz
  const row = {
    name,
    code: opt(form, "code", 30),
    kind: ["customer", "supplier", "both", "other"].includes(str(form, "kind")) ? str(form, "kind") : "supplier",
    person_type: str(form, "person_type") === "person" ? "person" : "company",
    tax_office: opt(form, "tax_office", 80),
    tax_no: taxNo || null,
    phone: opt(form, "phone", 40),
    email: opt(form, "email", 200),
    website: opt(form, "website", 200),
    contact_name: opt(form, "contact_name", 120),
    address: opt(form, "address", 400),
    district: opt(form, "district", 80),
    city: opt(form, "city", 80),
    country: str(form, "country", 60) || "TR",
    iban: opt(form, "iban", 40)?.replace(/\s/g, "") ?? null,
    currency: cur(str(form, "currency")),
    opening_balance: openSide === "payable" ? -Math.abs(openAmt) : Math.abs(openAmt),
    opening_date: dateOk(str(form, "opening_date")) ?? (openAmt ? today() : null),
    payment_term_days: Math.min(365, Math.max(0, Number(str(form, "payment_term_days")) || 0)),
    credit_limit: parseAmount(str(form, "credit_limit")),
    credit_sales: form.get("credit_sales") === "on",
    is_einvoice: form.get("is_einvoice") === "on",
    einvoice_alias: opt(form, "einvoice_alias", 120),
    note: opt(form, "note", 2000),
    is_active: form.get("is_active") !== "off",
  };
  const supabase = await createClient();
  const res = id ? await supabase.from("fin_parties").update(row).eq("id", id).select("id").single() : await supabase.from("fin_parties").insert(row).select("id").single();
  if (res.error) await fail(finError(res.error.message));
  revalidatePath("/finans/cariler");
  if (!id) redirect(`/finans/cariler/${res.data!.id}?tamam=${encodeURIComponent("Cari kart açıldı.")}`);
  await done("Cari kart kaydedildi.");
}

// ---------------------------------------------------------------------
// Hesap: kasa, banka, kart, kredi, ortak, avans
// ---------------------------------------------------------------------
export async function saveAccount(form: FormData) {
  await need("finance", 3);
  const id = str(form, "id", 40);
  const kind = str(form, "kind", 20);
  if (!["cash", "bank", "pos", "credit_card", "loan", "partner", "advance", "cheque_in", "cheque_out"].includes(kind)) await fail("Hesap türü geçersiz.");
  const name = str(form, "name", 120);
  if (!name) await fail("Hesap adı yazın.");
  const liability = ["credit_card", "loan"].includes(kind);
  const openAmt = parseAmount(str(form, "opening_amount"), true) ?? 0;
  const row = {
    kind,
    name,
    currency: cur(str(form, "currency")),
    bank_name: opt(form, "bank_name", 80),
    branch: opt(form, "branch", 80),
    iban: opt(form, "iban", 40)?.replace(/\s/g, "") ?? null,
    account_no: opt(form, "account_no", 40),
    card_last4: /^\d{4}$/.test(str(form, "card_last4")) ? str(form, "card_last4") : null,
    card_limit: parseAmount(str(form, "card_limit")),
    statement_day: Number(str(form, "statement_day")) || null,
    due_day: Number(str(form, "due_day")) || null,
    holder_employee_id: opt(form, "holder_employee_id", 40),
    holder_name: opt(form, "holder_name", 120),
    share_pct: str(form, "share_pct") ? Math.min(100, Math.max(0, Number(str(form, "share_pct").replace(",", ".")) || 0)) : null,
    // borç hesaplarında (kart, kredi) açılış tutarı borç olarak yazılır
    opening_balance: liability ? -Math.abs(openAmt) : openAmt,
    opening_date: dateOk(str(form, "opening_date")) ?? today(),
    note: opt(form, "note", 1000),
    is_active: form.get("is_active") !== "off",
  };
  const supabase = await createClient();
  const res = id ? await supabase.from("fin_accounts").update(row).eq("id", id) : await supabase.from("fin_accounts").insert(row);
  if (res.error) await fail(finError(res.error.message));
  revalidatePath("/finans");
  await done(id ? "Hesap kaydedildi." : "Hesap açıldı.");
}

// ---------------------------------------------------------------------
// İşlem gir: tahsilat, ödeme, virman, gelir, masraf, döviz alım-satım
// ---------------------------------------------------------------------
export async function postTxn(form: FormData) {
  const s = await getSession();
  const kind = str(form, "kind", 20);
  const mod = kind === "expense" ? ((s.modules.finance ?? 0) >= 2 ? "finance" : "expenses") : "finance";
  if ((s.modules[mod] ?? 0) < 2) await fail("Bu işlem için yetkiniz yok.");
  const date = dateOk(str(form, "date")) ?? today();
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const rate = parseRate(str(form, "rate"));
  const desc = opt(form, "description", 500);
  const docNo = opt(form, "doc_no", 60);
  const supabase = await createClient();
  const accountId = str(form, "account_id", 40);
  const { data: acc } = accountId ? await supabase.from("fin_accounts").select("id, currency, kind").eq("id", accountId).maybeSingle() : { data: null };

  let error: { message: string } | null = null;
  if (kind === "collection" || kind === "payment") {
    const partyId = str(form, "party_id", 40);
    if (!acc || !partyId) await fail("Hesap ve cari seçin.");
    const partyAmount = parseAmount(str(form, "party_amount"));
    ({ error } = await supabase.rpc("fin_collect_or_pay", {
      p_kind: kind, p_party: partyId, p_account: acc!.id, p_date: date, p_amount: amount, p_party_amount: partyAmount, p_rate: rate, p_description: desc, p_doc_no: docNo, p_method: null,
      ...(str(form, "book", 10) ? { p_book: str(form, "book", 10) } : {}),
    }));
  } else if (kind === "transfer" || kind === "exchange") {
    const toId = str(form, "to_account_id", 40);
    const { data: to } = await supabase.from("fin_accounts").select("id, currency").eq("id", toId).maybeSingle();
    if (!acc || !to) await fail("Çıkış ve giriş hesabını seçin.");
    if (acc!.id === to!.id) await fail("Aynı hesaba virman yapılamaz.");
    const toAmount = acc!.currency === to!.currency ? amount! : parseAmount(str(form, "to_amount"));
    if (!toAmount) await fail("Giriş hesabına geçen tutarı yazın (farklı para birimi).");
    const fromRate = acc!.currency === "TRY" ? 1 : rate ?? null;
    // TL karşılığı aynı kalsın: giriş kuru = çıkış TL / giriş tutarı
    const lines: Record<string, unknown>[] = [
      { account_id: acc!.id, amount: -amount!, currency: acc!.currency, rate: fromRate },
      { account_id: to!.id, amount: toAmount, currency: to!.currency, rate: to!.currency === "TRY" ? 1 : fromRate && acc!.currency !== to!.currency ? (amount! * (fromRate ?? 1)) / toAmount! : fromRate },
    ];
    const fee = parseAmount(str(form, "fee"));
    if (fee) {
      const { data: feeCat } = await supabase.from("fin_categories").select("id").eq("code", "exp_bank").maybeSingle();
      if (feeCat) lines.push({ account_id: acc!.id, amount: -fee, currency: acc!.currency, rate: fromRate }, { category_id: feeCat.id, amount: fee, currency: acc!.currency, rate: fromRate });
    }
    ({ error } = await supabase.rpc("fin_post", {
      p_header: { kind: acc!.currency === to!.currency ? "transfer" : "exchange", txn_date: date, description: desc, doc_no: docNo, amount, currency: acc!.currency, account_id: acc!.id },
      p_lines: lines,
    }));
  } else if (kind === "income" || kind === "expense") {
    const categoryId = str(form, "category_id", 40);
    if (!categoryId) await fail("Gelir / gider hesabını seçin.");
    const partyId = str(form, "party_id", 40);
    const vatRate = Number(str(form, "vat_rate")) || 0;
    const sign = kind === "expense" ? 1 : -1;
    // tutar KDV dahil; KDV ayrı satıra
    const vat = vatRate > 0 ? Math.round((amount! * vatRate) / (100 + vatRate)) : 0;
    const net = amount! - vat;
    const currency = acc?.currency ?? str(form, "currency") ?? "TRY";
    const counter = acc ? { account_id: acc.id } : partyId ? { party_id: partyId } : null;
    if (!counter) await fail("Ödendiği / tahsil edildiği hesabı ya da cariyi seçin.");
    const { data: vatCat } = vat ? await supabase.from("fin_categories").select("id").eq("code", kind === "expense" ? "vat_in" : "vat_out").maybeSingle() : { data: null };
    const lines: Record<string, unknown>[] = [
      { category_id: categoryId, amount: sign * net, currency, rate },
      ...(vat && vatCat ? [{ category_id: vatCat.id, amount: sign * vat, currency, rate }] : []),
      { ...counter, amount: -sign * amount!, currency, rate },
    ];
    if (vat && !vatCat) lines[0]!.amount = sign * amount!;
    ({ error } = await supabase.rpc("fin_post", {
      p_header: { kind, txn_date: date, description: desc, doc_no: docNo, amount, currency, account_id: acc?.id ?? null, party_id: partyId || null, category_id: categoryId, attachment_path: opt(form, "attachment_path", 300), module: mod },
      p_lines: lines,
    }));
  } else {
    await fail("İşlem türü geçersiz.");
  }
  if (error) await fail(finError(error.message));
  revalidatePath("/finans", "layout");
  const back = str(form, "back", 200);
  if (back.startsWith("/")) redirect(`${back}${back.includes("?") ? "&" : "?"}tamam=${encodeURIComponent("İşlem kaydedildi.")}`);
  await done("İşlem kaydedildi.");
}

export async function voidTxn(form: FormData) {
  await need("finance", 2);
  const id = str(form, "id", 40);
  const reason = str(form, "reason", 300) || "İptal";
  const supabase = await createClient();
  const { error } = await supabase.rpc("fin_void", { p_txn: id, p_reason: reason });
  if (error) await fail(finError(error.message));
  revalidatePath("/finans", "layout");
  await done("İşlem iptal edildi; bakiyelerden düşüldü.");
}

// ---------------------------------------------------------------------
// Kurlar ve kategoriler
// ---------------------------------------------------------------------
export async function saveFxRate(form: FormData) {
  await need("finance", 2);
  const date = dateOk(str(form, "date")) ?? today();
  const currency = str(form, "currency");
  const selling = parseRate(str(form, "selling"));
  if (!["USD", "EUR", "GBP", "CHF"].includes(currency) || !selling) await fail("Para birimi ve kuru yazın.");
  const supabase = await createClient();
  const { error } = await supabase.from("fx_rates").upsert({ rate_date: date, currency, selling, buying: parseRate(str(form, "buying")), source: "manual" });
  if (error) await fail(finError(error.message));
  revalidatePath("/finans/kurlar");
  await done("Kur kaydedildi.");
}

export async function pullTcmb() {
  await need("finance", 2);
  let res;
  try {
    res = await fetchTcmb();
  } catch (e) {
    await fail(`TCMB'ye ulaşılamadı: ${(e as Error).message}`);
  }
  if (!res!.rates.length) await fail("TCMB kur listesi okunamadı.");
  const date = res!.date ?? today();
  const supabase = await createClient();
  const { error } = await supabase.from("fx_rates").upsert(res!.rates.map((r) => ({ rate_date: date, currency: r.currency, buying: r.buying, selling: r.selling, source: "tcmb" })));
  if (error) await fail(finError(error.message));
  revalidatePath("/finans", "layout");
  await done(`TCMB kurları alındı (${date}).`);
}

export async function saveCategory(form: FormData) {
  await need("finance", 3);
  const id = str(form, "id", 40);
  const name = str(form, "name", 120);
  const kind = str(form, "kind", 20);
  if (!name || !["income", "expense"].includes(kind)) await fail("Ad ve türü (gelir / gider) seçin.");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("fin_categories").update({ name, is_active: form.get("is_active") !== "off" }).eq("id", id);
    if (error) await fail(finError(error.message));
  } else {
    const code = `${kind === "income" ? "inc" : "exp"}_${Date.now().toString(36)}`;
    const { error } = await supabase.from("fin_categories").insert({ code, name, kind, sort: 50 });
    if (error) await fail(finError(error.message));
  }
  revalidatePath("/finans/kategoriler");
  await done("Kaydedildi.");
}
