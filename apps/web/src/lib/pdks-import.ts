import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDeviceFile } from "@mb/core";

export type PdksImportCore = { ok: boolean; message: string; read: number; inserted: number; dup: number; ignored: number; errors: { line: number; reason: string }[]; unknown: Map<string, number>; punches: ReturnType<typeof parseDeviceFile>["punches"] };

/**
 * Erom PDKS cihaz dosyasını (cihaz,kart,?,tarih,saat) okutma kayıtlarına işler. Aynı okutma ikinci kez eklenmez.
 * Hem elle yüklemede (kullanıcı oturumu) hem otomatik aktarımda (yönetici istemci + şirket filtresi) kullanılır.
 */
export async function importPunchText(sb: SupabaseClient, companyId: string, text: string, fileName: string, importedBy: string | null, opts: { skipEmptyLog?: boolean } = {}): Promise<PdksImportCore> {
  const { data: devices } = await sb.from("devices").select("code, direction, branch_id").eq("company_id", companyId);
  const deviceDirection = Object.fromEntries((devices ?? []).map((d) => [d.code, d.direction])) as Record<string, "IN" | "OUT">;
  const parsed = parseDeviceFile(text, Object.keys(deviceDirection).length ? { deviceDirection } : {});
  const base = { read: parsed.punches.length, inserted: 0, dup: 0, ignored: 0, errors: parsed.errors, unknown: new Map<string, number>(), punches: parsed.punches };
  if (!parsed.punches.length) return { ...base, ok: false, message: "Dosyada okunabilir kayıt yok." };

  const norm = (c: string) => String(c).replace(/^0+/, "");
  const { data: emps } = await sb.from("employees").select("id, card_no, branch_id").eq("company_id", companyId).not("card_no", "is", null);
  const byCard = new Map((emps ?? []).map((e) => [norm(String(e.card_no)), e]));
  // Kart kuralları: IGNORE → hiç alınmaz; MAP → başka personele bağlanır (ör. cihaz yöneticisi 00001)
  const { data: rules } = await sb.from("pdks_card_rules").select("card_no, action, employee_id").eq("company_id", companyId);
  const ignoredCards = new Set((rules ?? []).filter((r) => r.action === "IGNORE").map((r) => norm(r.card_no as string)));
  const mapIds = (rules ?? []).filter((r) => r.action === "MAP").map((r) => r.employee_id as string);
  if (mapIds.length) {
    const { data: mapped } = await sb.from("employees").select("id, card_no, branch_id").in("id", mapIds);
    const byId = new Map((mapped ?? []).map((e) => [e.id as string, e]));
    for (const r of rules ?? []) if (r.action === "MAP" && byId.has(r.employee_id as string)) byCard.set(norm(r.card_no as string), byId.get(r.employee_id as string)!);
  }
  const kept = parsed.punches.filter((p) => !ignoredCards.has(norm(p.cardNo)));
  base.ignored = parsed.punches.length - kept.length;
  base.punches = kept;
  if (!kept.length) return { ...base, ok: true, message: `${parsed.punches.length} okutma okundu · hepsi yok sayılan kartlara ait.` };
  const { data: branch } = await sb.from("branches").select("id").eq("company_id", companyId).order("created_at").limit(1).single();
  if (!branch) return { ...base, ok: false, message: "Şube bulunamadı." };
  const deviceBranch = new Map((devices ?? []).map((d) => [d.code, d.branch_id as string]));

  const { data: imp } = await sb.from("attendance_imports")
    .insert({ company_id: companyId, branch_id: branch.id, file_name: fileName.slice(0, 200), punch_count: kept.length, error_count: parsed.errors.length, ...(importedBy === null ? { imported_by: null } : {}) })
    .select("id").single();

  const rows = kept.map((p) => {
    const emp = byCard.get(norm(p.cardNo));
    if (!emp) base.unknown.set(p.cardNo, (base.unknown.get(p.cardNo) ?? 0) + 1);
    return {
      company_id: companyId, branch_id: emp?.branch_id ?? deviceBranch.get(p.device) ?? branch.id, card_no: p.cardNo, employee_id: emp?.id ?? null,
      device_code: p.device, direction: p.direction, punched_at: p.at.replace("T", " ") + ":00", source: "DEVICE", import_id: imp?.id ?? null,
    };
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await sb.from("attendance_punches").upsert(rows.slice(i, i + 500), { onConflict: "company_id,card_no,direction,punched_at", ignoreDuplicates: true }).select("id");
    if (error) return { ...base, inserted, dup: 0, ok: false, message: `Kayıt hatası: ${error.message}` };
    inserted += data?.length ?? 0;
  }
  const dup = rows.length - inserted;
  const ign = base.ignored ? ` · ${base.ignored} yok sayıldı` : "";
  if (imp) {
    if (opts.skipEmptyLog && inserted === 0) await sb.from("attendance_imports").delete().eq("id", imp.id);
    else await sb.from("attendance_imports").update({ duplicate_count: dup }).eq("id", imp.id);
  }
  return { ...base, inserted, dup, ok: true, message: `${parsed.punches.length} okutma okundu · ${inserted} yeni kayıt · ${dup} kayıt zaten vardı${ign}.` };
}
