/** Makine türleri ve durumları */
export const MACHINE_KIND: Record<string, string> = { mill: "Frez (CAM)", printer: "3D yazıcı", furnace: "Sinter / porselen fırını", scanner: "Masaüstü tarayıcı", casting: "Döküm", other: "Diğer" };
export const MACHINE_STATUS: Record<string, [string, string]> = {
  running: ["Çalışıyor", "bg-ok-bg text-ok"],
  idle: ["Boşta", "bg-[#EEF2F6] text-muted"],
  down: ["Arızada", "bg-bad-bg text-bad"],
  maintenance: ["Bakımda", "bg-warn-bg text-warn"],
};
export const QUEUE_STATUS: Record<string, string> = { queued: "Sırada", running: "İşleniyor", done: "Bitti", failed: "Hatalı", cancelled: "İptal" };
export type Machine = {
  id: string; name: string; kind: string; station_id: string | null; asset_id: string | null; brand_model: string | null; status: string;
  daily_units: number | null; tool_name: string | null; tool_life_units: number | null; tool_used_units: number; tool_changed_at: string | null;
  maint_every_units: number | null; units_since_maint: number; next_maintenance: string | null; total_units: number; is_active: boolean; note: string | null;
};
export const pct = (a: number, b: number | null) => (b ? Math.min(100, Math.round((a / b) * 100)) : null);

export function machineError(m: string): string {
  if (/not_allowed|permission/.test(m)) return "Üretim yetkiniz yok (Yönetim > Yetkiler).";
  if (/job_not_found/.test(m)) return "Bu numarayla iş bulunamadı.";
  if (/job_cancelled/.test(m)) return "İş iptal edilmiş.";
  if (/machine_down/.test(m)) return "Makine arızada / bakımda; önce 'Çalışıyor' olarak işaretleyin.";
  if (/already_down/.test(m)) return "Makine zaten arızada / bakımda.";
  if (/bad_status/.test(m)) return "Kuyruk satırının durumu bu işleme uygun değil.";
  if (/name_required/.test(m)) return "Makine adı yazın.";
  if (/prd_machine|schema cache/.test(m)) return "Supabase'de 20261223000000_machines.sql çalıştırılmalı.";
  return m;
}

