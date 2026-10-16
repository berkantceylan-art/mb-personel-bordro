"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { scanBankMail } from "@/lib/bank-mail";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const hint = (m: string) => (/fin_bank_mail|fin_bank_import_core|schema cache/.test(m) ? "Supabase'de mbdental-banka-eposta.sql çalıştırılmalı." : /not_allowed/.test(m) ? "Finans yetkiniz yok." : m);

export async function saveBankMailSettings(f: FormData) {
  const { error } = await (await createClient()).rpc("fin_bank_mail_settings_save", { p_account: UUID.test(str(f, "account")) ? str(f, "account") : null, p_query: str(f, "query") || null, p_enabled: f.get("enabled") === "on" });
  if (error) await fail(hint(error.message));
  revalidatePath("/finans/banka-eposta");
  await done("Ayarlar kaydedildi. Kutu 15 dakikada bir taranır.");
}

export async function scanBankMailNow() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) await fail("Finans yetkiniz yok.");
  const r = await scanBankMail(createAdminClient()).catch((e) => ({ ok: false, message: (e as Error).message }));
  revalidatePath("/finans/banka-eposta");
  revalidatePath("/finans/banka-aktar");
  if (!r.ok) await fail(hint(r.message));
  await done(r.message);
}

export async function assignBankMail(f: FormData) {
  const acc = str(f, "account");
  if (!UUID.test(acc)) await fail("Banka hesabını seçin.");
  const { data, error } = await (await createClient()).rpc("fin_bank_mail_assign", { p_pending: str(f, "id"), p_account: acc, p_learn: f.get("learn") === "on" });
  if (error) await fail(hint(error.message));
  revalidatePath("/finans/banka-eposta");
  revalidatePath("/finans/banka-aktar");
  const d = data as { rows: number; added: number };
  await done(`${d.added} yeni hareket aktarıldı${d.rows - d.added ? ` (${d.rows - d.added} satır zaten vardı)` : ""}.${f.get("learn") === "on" ? " Bu gönderenin ekstreleri artık otomatik bu hesaba gider." : ""}`);
}

export async function dismissBankMail(f: FormData) {
  const { error } = await (await createClient()).rpc("fin_bank_mail_dismiss", { p_pending: str(f, "id") });
  if (error) await fail(hint(error.message));
  revalidatePath("/finans/banka-eposta");
  await done("Ek yok sayıldı.");
}
