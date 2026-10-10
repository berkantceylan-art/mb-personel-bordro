import type { HazardClass } from "@mb/core";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Şirketin tehlike sınıfı, NACE kodu ve aktif çalışan sayısı */
export async function isgBase(sb: SB) {
  const [{ data: c }, { count }] = await Promise.all([
    sb.from("companies").select("id, name, hazard_class, nace_code").limit(1).maybeSingle(),
    sb.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);
  return { hazard: (c?.hazard_class ?? "COK") as HazardClass, nace: (c?.nace_code as string | null) ?? null, workers: count ?? 0, company: c?.name ?? "" };
}

/** <şirket>/isg/<klasör>/... altına dosya yükler; dosya yoksa null */
export async function uploadIsg(sb: SB, companyId: string, file: FormDataEntryValue | null, folder: string) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 20 * 1024 * 1024) throw new Error("Dosya 20 MB'tan büyük olamaz.");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${companyId}/${folder === "egitim" ? "isg-egitim" : "isg"}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message.includes("policy") ? "Dosya yükleme izni yok (20261119000000_isg.sql çalıştırılmalı)." : error.message);
  return path;
}

/** İmzalı bağlantılar (10 dk) */
export async function signedMap(sb: SB, paths: Array<string | null | undefined>) {
  const list = [...new Set(paths.filter(Boolean) as string[])];
  if (!list.length) return new Map<string, string>();
  const { data } = await sb.storage.from("documents").createSignedUrls(list, 600);
  return new Map(((data ?? []) as Array<{ path: string | null; signedUrl: string }>).map((u) => [u.path ?? "", u.signedUrl]));
}
