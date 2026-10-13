"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";

export interface ResetPlan {
  ok: boolean;
  message?: string;
  modules: string[];
  added: Array<{ module: string; table: string; refers: string }>;
  warnings: Array<{ table: string; refers: string; cascade: boolean }>;
  counts: Record<string, number>;
}
export interface ResetResult { ok: boolean; message: string; rows?: number; files?: number; users?: number; userFail?: number; fileFail?: number }

function sqlMsg(m: string): string {
  if (/not_owner/.test(m)) return "Bu işlemi yalnız şirket sahibi yapabilir.";
  if (/confirm_required/.test(m)) return "Onay için kutuya büyük harflerle SİL yazın.";
  if (/needs_modules: (.*)/.test(m)) return `Şu modüller de seçilmeli: ${m.match(/needs_modules: (.*)/)![1]}`;
  if (/blocked: (.*)/.test(m)) return `Silinemiyor; korunan bir tablo bu kayıtlara bağlı: ${m.match(/blocked: (.*)/)![1]}`;
  if (/no_modules/.test(m)) return "En az bir modül seçin.";
  if (/sys_reset_(plan|run)|does not exist/.test(m)) return "Supabase'de 20270117000000_system_reset.sql çalıştırılmalı.";
  if (/reset_failed: (.*)/.test(m)) return `Silme tamamlanamadı, hiçbir şey silinmedi: ${m.match(/reset_failed: (.*)/)![1]}`;
  return m;
}

/** Seçime göre bağımlı modülleri ve kayıt sayılarını getirir (hiçbir şey silmez). */
export async function resetPlan(modules: string[]): Promise<ResetPlan> {
  const s = await getSession();
  const empty = { modules: [], added: [], warnings: [], counts: {} };
  if (s.role !== "owner") return { ok: false, message: "Bu işlemi yalnız şirket sahibi yapabilir.", ...empty };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sys_reset_plan", { p_modules: modules });
  if (error) return { ok: false, message: sqlMsg(error.message), ...empty };
  return { ok: true, ...(data as Omit<ResetPlan, "ok">) };
}

/** Seçilen modüllerin verisini siler; ardından depodaki dosyaları ve giriş hesaplarını temizler. */
export async function resetRun(_: ResetResult | null, f: FormData): Promise<ResetResult> {
  const s = await getSession();
  if (s.role !== "owner") return { ok: false, message: "Bu işlemi yalnız şirket sahibi yapabilir." };
  let modules: string[];
  try { modules = JSON.parse(String(f.get("modules") ?? "[]")); } catch { return { ok: false, message: "Seçim okunamadı." }; }
  const confirm = String(f.get("confirm") ?? "").trim().toLocaleUpperCase("tr");
  if (confirm !== "SİL") return { ok: false, message: "Onay için kutuya büyük harflerle SİL yazın." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sys_reset_run", { p_modules: modules, p_confirm: "SİL" });
  if (error) return { ok: false, message: sqlMsg(error.message) };
  const res = data as { deleted: Record<string, number>; files: Array<{ bucket: string; name: string }>; users: string[] };
  const rows = Object.values(res.deleted ?? {}).reduce((a, n) => a + n, 0);

  let fileFail = 0;
  let userFail = 0;
  const files = res.files ?? [];
  const users = res.users ?? [];
  if (files.length || users.length) {
    let admin: ReturnType<typeof createAdminClient> | null = null;
    try { admin = createAdminClient(); } catch { admin = null; }
    if (!admin) { fileFail = files.length; userFail = users.length; }
    else {
      const byBucket = new Map<string, string[]>();
      for (const x of files) byBucket.set(x.bucket, [...(byBucket.get(x.bucket) ?? []), x.name]);
      for (const [bucket, names] of byBucket) {
        for (let i = 0; i < names.length; i += 100) {
          const { error: e } = await admin.storage.from(bucket).remove(names.slice(i, i + 100));
          if (e) fileFail += Math.min(100, names.length - i);
        }
      }
      for (const id of users) {
        const { error: e } = await admin.auth.admin.deleteUser(id);
        if (e) userFail++;
      }
    }
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    rows, files: files.length - fileFail, users: users.length - userFail, fileFail, userFail,
    message: `${rows.toLocaleString("tr-TR")} kayıt silindi${files.length ? ` · ${files.length - fileFail} dosya silindi` : ""}${users.length ? ` · ${users.length - userFail} giriş hesabı kapatıldı` : ""}.`,
  };
}
