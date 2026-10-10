/**
 * SGK bildirgeleri için personel verisi: işe giriş ve işten ayrılış satırları, eksik alan kontrolü.
 * Alan adları SGK 4A toplu giriş/çıkış XML kılavuzundaki adlarla aynıdır.
 */
import { educationCode } from "./codes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySB = any;

export type GirisRow = {
  employeeId: string; name: string; TCKNO: string; AD: string; SOYAD: string; ISEGIRISTARIHI: string; SIGORTAKOLU: number; OZURLUKODU: "E" | "H"; ESKIHUKUMLU: "E" | "H";
  OGRENIMKODU: number; MEZUNIYETYILI: number; MEZUNIYETBOLUMU: string; CSGBISKOLU: number; MESLEKKODU: string; GOREVKODU: number; problems: string[];
};
export type Donem = { BELGETURU: number; HAKEDILENUCRET: number; PRIMIKRAMIYE: number; EKSIKGUNSAYISI: number; EKSIKGUNNEDENI: number };
export type CikisRow = {
  employeeId: string; name: string; TCKNO: string; AD: string; SOYAD: string; ISTENCIKISTARIHI: string; MESLEKKODU: string; ISTENAYRILISNEDENI: number; CSGBISKOLU: number; UCRETYUZDEUSULU: "E" | "H";
  BULUNDUGUMUZDONEM: Donem; ONCEKIDONEM: Donem | null; problems: string[];
};

const up = (s: string) => s.toLocaleUpperCase("tr").trim();
export const validTc = (tc: string) => {
  if (!/^[1-9]\d{10}$/.test(tc)) return false;
  const d = tc.split("").map(Number);
  const c10 = ((d[0]! + d[2]! + d[4]! + d[6]! + d[8]!) * 7 - (d[1]! + d[3]! + d[5]! + d[7]!)) % 10;
  const c11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return ((c10 + 10) % 10) === d[9] && c11 === d[10];
};

export async function companySgk(sb: AnySB) {
  const { data } = await sb.from("companies").select("id, name, address, sgk_registration_no, csgb_iskolu, sgk_araci_no").limit(1).maybeSingle();
  return data as { id: string; name: string; address: string | null; sgk_registration_no: string | null; csgb_iskolu: number | null; sgk_araci_no: number | null } | null;
}

export async function girisRows(sb: AnySB, ids: string[]): Promise<GirisRow[]> {
  if (!ids.length) return [];
  const [{ data: emps }, { data: privs }, comp] = await Promise.all([
    sb.from("employees").select("id, first_name, last_name, hire_date, sgk_occupation_code, sgk_duty_code, sgk_insurance_branch, ex_convict, is_retired").in("id", ids),
    sb.from("employee_private").select("employee_id, national_id, disabled, education_level, education, school_department, graduation_year").in("employee_id", ids),
    companySgk(sb),
  ]);
  const pv = new Map(((privs ?? []) as Array<Record<string, unknown>>).map((p) => [p.employee_id as string, p]));
  return ((emps ?? []) as Array<Record<string, unknown>>).map((e) => {
    const p = pv.get(e.id as string) ?? {};
    const tc = String(p.national_id ?? "").trim();
    const problems: string[] = [];
    if (!validTc(tc)) problems.push("TC kimlik no geçersiz veya eksik");
    if (!e.hire_date) problems.push("İşe giriş tarihi yok");
    if (!e.sgk_occupation_code) problems.push("SGK meslek kodu yok (ör. 3258.02)");
    if (comp?.csgb_iskolu === null || comp?.csgb_iskolu === undefined) problems.push("Şirketin ÇSGB iş kolu seçilmemiş (SGK ayarları)");
    const kol = Number(e.sgk_insurance_branch ?? 0) || (e.is_retired ? 8 : 0);
    return {
      employeeId: e.id as string, name: `${e.first_name} ${e.last_name}`, TCKNO: tc, AD: up(String(e.first_name)), SOYAD: up(String(e.last_name)),
      ISEGIRISTARIHI: String(e.hire_date ?? ""), SIGORTAKOLU: kol, OZURLUKODU: p.disabled ? "E" : "H", ESKIHUKUMLU: e.ex_convict ? "E" : "H",
      OGRENIMKODU: educationCode((p.education_level as string) ?? (p.education as string)), MEZUNIYETYILI: Number(p.graduation_year ?? 0) || 0, MEZUNIYETBOLUMU: up(String(p.school_department ?? "")).slice(0, 100),
      CSGBISKOLU: comp?.csgb_iskolu ?? 0, MESLEKKODU: String(e.sgk_occupation_code ?? ""), GOREVKODU: Number(e.sgk_duty_code ?? 2), problems,
    };
  });
}

/** Çıkış satırı: bulunduğumuz ve önceki dönem ücretleri bordrodan (yoksa sözleşmeden) önerilir; ekranda düzeltilebilir */
export async function cikisRows(sb: AnySB, ids: string[], overrides: Record<string, Partial<Donem> & { prev?: Partial<Donem>; reason?: number }> = {}): Promise<CikisRow[]> {
  if (!ids.length) return [];
  const [{ data: emps }, { data: privs }, comp] = await Promise.all([
    sb.from("employees").select("id, first_name, last_name, termination_date, termination_code, sgk_occupation_code").in("id", ids),
    sb.from("employee_private").select("employee_id, national_id").in("employee_id", ids),
    companySgk(sb),
  ]);
  const pv = new Map(((privs ?? []) as Array<Record<string, unknown>>).map((p) => [p.employee_id as string, String(p.national_id ?? "").trim()]));
  const out: CikisRow[] = [];
  for (const e of (emps ?? []) as Array<Record<string, unknown>>) {
    const id = e.id as string;
    const end = String(e.termination_date ?? "");
    const per = end.slice(0, 7);
    const prevPer = per ? (() => { const [y, m] = per.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })() : "";
    const { data: lines } = per ? await sb.from("payroll_lines").select("period, days, official_gross").eq("employee_id", id).in("period", [per, prevPer]) : { data: [] };
    const L = new Map(((lines ?? []) as Array<Record<string, unknown>>).map((l) => [l.period as string, l]));
    const dayOfMonth = end ? Number(end.slice(8, 10)) : 30;
    const donem = (l: Record<string, unknown> | undefined, days: number): Donem => ({ BELGETURU: 1, HAKEDILENUCRET: Math.round(Number(l?.official_gross ?? 0)) / 100 /* bordro kuruş, SGK TL */, PRIMIKRAMIYE: 0, EKSIKGUNSAYISI: l ? Math.max(0, days - Number(l.days ?? days)) : 0, EKSIKGUNNEDENI: 0 });
    const o = overrides[id] ?? {};
    const cur = { ...donem(L.get(per), Math.min(30, dayOfMonth)), ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "prev" && k !== "reason" && v !== undefined)) } as Donem;
    const prev = L.get(prevPer) || o.prev ? ({ ...donem(L.get(prevPer), 30), ...(o.prev ?? {}) } as Donem) : null;
    const tc = pv.get(id) ?? "";
    const reason = o.reason ?? Number(e.termination_code ?? 0);
    const problems: string[] = [];
    if (!validTc(tc)) problems.push("TC kimlik no geçersiz veya eksik");
    if (!end) problems.push("İşten çıkış tarihi yok");
    if (!reason) problems.push("SGK çıkış kodu yok");
    if (!e.sgk_occupation_code) problems.push("SGK meslek kodu yok");
    if (!cur.HAKEDILENUCRET) problems.push("Bulunduğumuz dönem ücreti yok (bordro hesaplanmamış); elle girin");
    out.push({ employeeId: id, name: `${e.first_name} ${e.last_name}`, TCKNO: tc, AD: up(String(e.first_name)), SOYAD: up(String(e.last_name)), ISTENCIKISTARIHI: end, MESLEKKODU: String(e.sgk_occupation_code ?? ""), ISTENAYRILISNEDENI: reason, CSGBISKOLU: comp?.csgb_iskolu ?? 0, UCRETYUZDEUSULU: "H", BULUNDUGUMUZDONEM: cur, ONCEKIDONEM: prev, problems });
  }
  return out;
}

/** 26 haneli sicil: ilk 21 hane işyeri sicili, son 3 hane aracı no (XML kılavuzu ISYERISICIL 21 karakter) */
export function sicilParts(comp: { sgk_registration_no: string | null; sgk_araci_no: number | null }) {
  const d = (comp.sgk_registration_no ?? "").replace(/\D/g, "");
  const sicil = d.length >= 21 ? d.slice(0, 21) : d;
  const araci = comp.sgk_araci_no ? String(comp.sgk_araci_no) : d.length === 26 ? d.slice(23, 26) : "0";
  return { ISYERISICIL: sicil, ISYERIARACINO: araci.padStart(3, "0") };
}
const esc = (s: string | number) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const attrs = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");

/** SGK toplu işe giriş XML'i (uyg.sgk.gov.tr/SgkTescil4a) */
export function girisXml(comp: NonNullable<Awaited<ReturnType<typeof companySgk>>>, rows: GirisRow[]) {
  const isyeri = attrs({ ...sicilParts(comp), ISYERIUNVAN: up(comp.name).slice(0, 250), ISYERIADRES: up(comp.address ?? "").slice(0, 200) });
  const s = rows.map((r) => `    <SIGORTALI ${attrs({ TCKNO: r.TCKNO, AD: r.AD, SOYAD: r.SOYAD, ISEGIRISTARIHI: r.ISEGIRISTARIHI, SIGORTAKOLU: r.SIGORTAKOLU, OZURLUKODU: r.OZURLUKODU, ESKIHUKUMLU: r.ESKIHUKUMLU, OGRENIMKODU: r.OGRENIMKODU, MEZUNIYETYILI: r.MEZUNIYETYILI, MEZUNIYETBOLUMU: r.MEZUNIYETBOLUMU, CSGBISKOLU: r.CSGBISKOLU, MESLEKKODU: r.MESLEKKODU, GOREVKODU: r.GOREVKODU })} />`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<SGK4AISEGIRIS>\n  <ISYERI ${isyeri}/>\n  <SIGORTALILAR>\n${s}\n  </SIGORTALILAR>\n</SGK4AISEGIRIS>\n`;
}
/** SGK toplu işten ayrılış XML'i */
export function cikisXml(comp: NonNullable<Awaited<ReturnType<typeof companySgk>>>, rows: CikisRow[]) {
  const isyeri = attrs({ ...sicilParts(comp), ISYERIUNVAN: up(comp.name).slice(0, 250), ISYERIADRES: up(comp.address ?? "").slice(0, 200) });
  const d = (x: Donem) => attrs({ BELGETURU: x.BELGETURU, HAKEDILENUCRET: x.HAKEDILENUCRET.toFixed(2), PRIMIKRAMIYE: x.PRIMIKRAMIYE.toFixed(2), EKSIKGUNSAYISI: x.EKSIKGUNSAYISI, EKSIKGUNNEDENI: x.EKSIKGUNNEDENI });
  const s = rows.map((r) => `    <SIGORTALI ${attrs({ TCKNO: r.TCKNO, AD: r.AD, SOYAD: r.SOYAD, ISTENCIKISTARIHI: r.ISTENCIKISTARIHI, MESLEKKODU: r.MESLEKKODU, ISTENAYRILISNEDENI: r.ISTENAYRILISNEDENI, CSGBISKOLU: r.CSGBISKOLU, UCRETYUZDEUSULU: r.UCRETYUZDEUSULU })}>\n${r.ONCEKIDONEM ? `      <ONCEKIDONEM ${d(r.ONCEKIDONEM)} />\n` : ""}      <BULUNDUGUMUZDONEM ${d(r.BULUNDUGUMUZDONEM)} />\n    </SIGORTALI>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<SGK4AISTENCIKIS>\n  <ISYERI ${isyeri}/>\n  <SIGORTALILAR>\n${s}\n  </SIGORTALILAR>\n</SGK4AISTENCIKIS>\n`;
}
