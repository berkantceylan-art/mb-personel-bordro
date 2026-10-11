"use server";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { CURRENCIES, dateOk, finError, parseAmount, today } from "@/lib/fin";

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? "").trim().slice(0, max);
const opt = (f: FormData, k: string, max = 400) => str(f, k, max) || null;

function expError(m: string) {
  if (/employee_required/.test(m)) return "Avanstan düşmek için beyanın bir personele ait olması gerekir.";
  if (/exp_claims|schema cache|relation "exp_/.test(m)) return "Masraf tabloları yok: Supabase'de 20261206000000_expenses_assets.sql çalıştırılmalı.";
  return finError(m);
}
const reval = () => { revalidatePath("/masraf", "layout"); revalidatePath("/benim/masraf"); revalidatePath("/finans", "layout"); };

/** Masraf beyanı (personel kendi adına; masraf yetkilisi başkası adına da girebilir) */
export async function submitClaim(form: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const manager = (s.modules.expenses ?? 0) >= 2;
  let employeeId = manager ? opt(form, "employee_id", 40) : null;
  if (!manager) {
    const { data: me } = await supabase.from("employees").select("id").eq("user_id", s.userId).limit(1).maybeSingle();
    employeeId = (me?.id as string) ?? null;
  }
  const currency = (CURRENCIES as readonly string[]).includes(str(form, "currency")) ? str(form, "currency") : "TRY";
  let ai: unknown = null;
  try { ai = str(form, "ai", 4000) ? JSON.parse(str(form, "ai", 4000)) : null; } catch { ai = null; }
  const { error } = await supabase.from("exp_claims").insert({
    employee_id: employeeId, submitted_by: s.userId, expense_date: dateOk(str(form, "expense_date")) ?? today(), amount, currency,
    vat_rate: Math.min(100, Math.max(0, Number(str(form, "vat_rate")) || 0)), category_id: opt(form, "category_id", 40), vendor: opt(form, "vendor", 160),
    vendor_tax_no: str(form, "vendor_tax_no", 11).replace(/\D/g, "") || null, doc_no: opt(form, "doc_no", 60), description: opt(form, "description", 500),
    receipt_path: str(form, "receipt_path", 300).startsWith(`${s.userId}/`) || manager ? opt(form, "receipt_path", 300) : null,
    account_id: manager ? opt(form, "account_id", 40) : null, ai,
  });
  if (error) await fail(expError(error.message));
  reval();
  await done(manager ? "Masraf kaydedildi; onay kuyruğunda." : "Masraf beyanınız gönderildi.");
}

export async function deleteClaim(form: FormData) {
  const supabase = await createClient();
  const id = str(form, "id", 40);
  const { data: c } = await supabase.from("exp_claims").select("receipt_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("exp_claims").delete().eq("id", id);
  if (error) await fail(expError(error.message));
  if (c?.receipt_path) await supabase.storage.from("receipts").remove([c.receipt_path as string]);
  reval();
  await done("Beyan silindi.");
}

export async function decideClaim(form: FormData) {
  const s = await getSession();
  if ((s.modules.expenses ?? 0) < 2) await fail("Masraf onayı için yetkiniz yok.");
  const supabase = await createClient();
  const decision = str(form, "decision") === "reject" ? "reject" : "approve";
  const { error } = await supabase.rpc("exp_claim_decide", {
    p_id: str(form, "id", 40), p_decision: decision,
    p: { method: str(form, "method") || "account", account_id: opt(form, "account_id", 40), party_id: opt(form, "party_id", 40), category_id: opt(form, "category_id", 40),
         vat_rate: str(form, "vat_rate") === "" ? null : Number(str(form, "vat_rate")), date: dateOk(str(form, "date")), reason: opt(form, "reason", 300) },
  });
  if (error) await fail(expError(error.message));
  reval();
  await done(decision === "reject" ? "Beyan reddedildi." : "Onaylandı ve finansa işlendi.");
}

export async function reopenClaim(form: FormData) {
  const s = await getSession();
  if ((s.modules.expenses ?? 0) < 3) await fail("Geri almak için masraf yönetici yetkisi gerekir.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("exp_claim_reopen", { p_id: str(form, "id", 40) });
  if (error) await fail(expError(error.message));
  reval();
  await done("Onay geri alındı; beyan yeniden kuyrukta.");
}

export async function saveRecurring(form: FormData) {
  const s = await getSession();
  if ((s.modules.expenses ?? 0) < 2) await fail("Yetkiniz yok.");
  const amount = parseAmount(str(form, "amount"));
  if (!amount || amount <= 0) await fail("Tutarı yazın.");
  const supabase = await createClient();
  const row = {
    name: str(form, "name", 120) || "Masraf", category_id: opt(form, "category_id", 40), party_id: opt(form, "party_id", 40), account_id: opt(form, "account_id", 40),
    amount, currency: (CURRENCIES as readonly string[]).includes(str(form, "currency")) ? str(form, "currency") : "TRY", vat_rate: Math.min(100, Math.max(0, Number(str(form, "vat_rate")) || 0)),
    day_of_month: Math.min(28, Math.max(1, Number(str(form, "day_of_month")) || 1)), start_date: dateOk(str(form, "start_date")) ?? today(), end_date: dateOk(str(form, "end_date")), note: opt(form, "note", 300),
  };
  const id = str(form, "id", 40);
  const { error } = id ? await supabase.from("exp_recurring").update(row).eq("id", id) : await supabase.from("exp_recurring").insert(row);
  if (error) await fail(expError(error.message));
  await supabase.rpc("exp_recurring_run", { p_date: today() });
  reval();
  await done("Tekrarlayan masraf kaydedildi.");
}

export async function toggleRecurring(form: FormData) {
  const s = await getSession();
  if ((s.modules.expenses ?? 0) < 2) await fail("Yetkiniz yok.");
  const supabase = await createClient();
  const { error } = await supabase.from("exp_recurring").update({ is_active: str(form, "on") === "1" }).eq("id", str(form, "id", 40));
  if (error) await fail(expError(error.message));
  reval();
  await done("Güncellendi.");
}

export type ReceiptData = { amount?: string; date?: string; vendor?: string; vendor_tax_no?: string; vat_rate?: number; doc_no?: string; category?: string; description?: string };

/** Fiş / fatura fotoğrafını yapay zekâ ile oku (ANTHROPIC_API_KEY gerekir) */
export async function readReceipt(path: string, categories: string[]): Promise<{ ok: boolean; message?: string; data?: ReceiptData }> {
  const s = await getSession();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: "Fiş okuma için Vercel'e ANTHROPIC_API_KEY eklenmeli. Alanları elle doldurabilirsiniz." };
  if (!path.startsWith(`${s.userId}/`) && (s.modules.expenses ?? 0) < 1) return { ok: false, message: "Bu dosyaya erişiminiz yok." };
  const supabase = await createClient();
  const { data: blob, error } = await supabase.storage.from("receipts").download(path);
  if (error || !blob) return { ok: false, message: "Dosya okunamadı." };
  if (blob.size > 5 * 1024 * 1024) return { ok: false, message: "Dosya çok büyük (en fazla 5 MB)." };
  const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const type = blob.type || (path.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const media = type === "application/pdf"
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } as const)
    : ({ type: "image", source: { type: "base64", media_type: (["image/png", "image/webp", "image/gif"].includes(type) ? type : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: b64 } } as const);
  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 500,
      messages: [{ role: "user", content: [media, { type: "text", text: `Bu bir Türk fişi / faturası. Yalnız JSON döndür, açıklama yazma:
{"amount":"KDV dahil genel toplam, ör. 1250,50","date":"YYYY-MM-DD","vendor":"satıcı unvanı","vendor_tax_no":"satıcı VKN veya TCKN (yalnız rakam)","vat_rate":KDV oranı sayı (birden çoksa en büyük tutarlı olan),"doc_no":"fiş / fatura no","category":"şu listeden en uygunu: ${categories.join(" | ")}","description":"3-6 kelimelik ne alındığı"}
Okunamayan alanı boş bırak.` }] }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as ReceiptData;
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, message: `Fiş okunamadı: ${(e as Error).message.slice(0, 120)}` };
  }
}
