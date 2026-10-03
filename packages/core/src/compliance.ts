/**
 * İSG eğitimleri ve sağlık muayeneleri için geçerlilik / uyarı hesabı.
 */
export type HazardClass = "AZ" | "TEHLIKELI" | "COK";

export interface ComplianceType {
  id: string;
  name: string;
  /** null = bir kez yapılır, yenilenmez */
  validityMonths: number | null;
  /** Tehlike sınıfına göre farklı periyot (ör. temel İSG eğitimi, periyodik muayene) */
  validityByClass?: Partial<Record<HazardClass, number>> | null;
  required: boolean;
}

export type ComplianceStatus = "VALID" | "SOON" | "EXPIRED" | "MISSING" | "ONCE";

export function validityFor(t: ComplianceType, hazard: HazardClass): number | null {
  return t.validityByClass?.[hazard] ?? t.validityMonths;
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso.slice(0, 10) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}

export function expiryDate(doneOn: string, t: ComplianceType, hazard: HazardClass, explicit?: string | null): string | null {
  if (explicit) return explicit;
  const v = validityFor(t, hazard);
  return v ? addMonths(doneOn, v) : null;
}

export interface ComplianceCell {
  status: ComplianceStatus;
  doneOn: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
}

/** Bir personelin bir tür için en son kaydına göre durumu */
export function complianceStatus(
  records: Array<{ doneOn: string; expiresOn?: string | null }>,
  t: ComplianceType,
  hazard: HazardClass,
  today: string,
  warnDays = 30,
): ComplianceCell {
  if (!records.length) return { status: "MISSING", doneOn: null, expiresOn: null, daysLeft: null };
  const last = [...records].sort((a, b) => b.doneOn.localeCompare(a.doneOn))[0]!;
  const exp = expiryDate(last.doneOn, t, hazard, last.expiresOn);
  if (!exp) return { status: "ONCE", doneOn: last.doneOn, expiresOn: null, daysLeft: null };
  const left = daysUntil(exp, today);
  return { status: left < 0 ? "EXPIRED" : left <= warnDays ? "SOON" : "VALID", doneOn: last.doneOn, expiresOn: exp, daysLeft: left };
}

/** Uyarı kademesi: 30 / 15 / 7 gün ve geçmiş */
export function alertLevel(daysLeft: number | null): "EXPIRED" | "D7" | "D15" | "D30" | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return "EXPIRED";
  if (daysLeft <= 7) return "D7";
  if (daysLeft <= 15) return "D15";
  if (daysLeft <= 30) return "D30";
  return null;
}
