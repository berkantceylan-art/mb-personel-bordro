"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";
import { waybillError } from "@/lib/waybill";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function refresh() {
  revalidatePath("/isler/irsaliye");
  revalidatePath("/isler/aylik-fatura");
  revalidatePath("/isler/cari");
}

/** Müşteri kartı: iç hesap, varsayılan tahsilat hesabı, belge dili, iç açılış bakiyesi */
export async function saveCustomerBook(f: FormData) {
  const id = str(f, "customer_id");
  const opening = str(f, "internal_opening");
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_customer_set_book", {
    p_customer: id, p_on: f.get("internal_book") === "on", p_pay_book: str(f, "pay_book"), p_lang: str(f, "doc_lang"),
    p_opening: opening ? (parseMoney(opening) ?? 0) * (str(f, "opening_side") === "credit" ? -1 : 1) : null, p_opening_date: day(str(f, "internal_opening_date")),
  });
  if (error) await fail(waybillError(error.message));
  revalidatePath(`/isler/hekimler/${id}`);
  refresh();
  await done(f.get("internal_book") === "on" ? "Kaydedildi. Bu müşteride çıkışlar günlük irsaliyeye eklenir, iç cariye işlenir; resmi cariye yalnız resmi fatura ve resmi tahsilat girer." : "Kaydedildi.");
}

export async function createWaybill(f: FormData) {
  const jobs = f.getAll("job_id").map(String).filter((x) => UUID.test(x));
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_waybill_create", { p_customer: str(f, "customer_id"), p_date: day(str(f, "date")) ?? new Date().toISOString().slice(0, 10), p_jobs: jobs });
  if (error) await fail(waybillError(error.message));
  refresh();
  await done("İrsaliye oluşturuldu.");
}

export async function issueWaybill(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_waybill_issue", { p_id: str(f, "id") });
  if (error) await fail(waybillError(error.message));
  refresh();
  await done("İrsaliye kesildi. Bugün bu müşteriye çıkan yeni işler yeni irsaliyeye eklenir.");
}

export async function cancelWaybill(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_waybill_cancel", { p_id: str(f, "id") });
  if (error) await fail(waybillError(error.message));
  refresh();
  await done("İrsaliye iptal edildi; işler irsaliyesiz kaldı.");
}

export async function removeWaybillJob(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_waybill_remove_job", { p_job: str(f, "job_id") });
  if (error) await fail(waybillError(error.message));
  refresh();
  await done("İş irsaliyeden çıkarıldı.");
}

/** Ay sonu fatura: tek müşteri ya da seçilen tüm müşteriler */
export async function createStatements(f: FormData) {
  const from = day(str(f, "from")), to = day(str(f, "to"));
  if (!from || !to) await fail("Dönem seçin.");
  const ids = f.getAll("customer_id").map(String).filter((x) => UUID.test(x));
  if (!ids.length) await fail("Müşteri seçin.");
  const supabase = await createClient();
  let ok = 0;
  const errs: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.rpc("lab_statement_create", { p_customer: id, p_from: from, p_to: to, p_issue: day(str(f, "issue")) ?? to, p_note: str(f, "note") || null });
    if (error) errs.push(waybillError(error.message));
    else ok++;
  }
  refresh();
  if (!ok) await fail(errs[0] ?? "Fatura oluşturulamadı.");
  await done(`${ok} fatura oluşturuldu.${errs.length ? ` ${errs.length} müşteride faturalanacak irsaliye yoktu.` : ""}`);
}

export async function cancelStatement(f: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_statement_cancel", { p_id: str(f, "id") });
  if (error) await fail(waybillError(error.message));
  refresh();
  await done("Fatura iptal edildi; irsaliyeleri yeniden faturalanabilir.");
}

/** Hekim kartından tahsilat: resmi / iç / ikisi */
export async function addLabPayment(f: FormData) {
  const customer = str(f, "customer_id");
  const amount = parseMoney(str(f, "amount"));
  if (!UUID.test(customer)) await fail("Müşteri seçin.");
  if (!amount) await fail("Tutar girin (ör. 1.250,00).");
  const account = str(f, "account_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_payment_add", {
    p_customer: customer, p_date: day(str(f, "paid_on")) ?? new Date().toISOString().slice(0, 10), p_amount: amount, p_method: str(f, "method") || "bank",
    p_ref: str(f, "ref") || null, p_note: str(f, "note") || null, p_book: str(f, "book") || "official", p_account: UUID.test(account) ? account : null,
    p_account_amount: parseMoney(str(f, "account_amount")) || null,
  });
  if (error) await fail(waybillError(error.message));
  revalidatePath(`/isler/hekimler/${customer}`);
  refresh();
  revalidatePath("/finans");
  const b = str(f, "book");
  await done(b === "both" ? "Tahsilat resmi ve iç cariye işlendi." : b === "internal" ? "Tahsilat iç cariye işlendi." : "Tahsilat kaydedildi.");
}
