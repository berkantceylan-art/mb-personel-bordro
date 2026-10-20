import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/fetch-all";
import type { CarrierReport } from "@/lib/carrier-report";

const TR: Record<string, string> = { ı: "I", i: "I", ğ: "G", ü: "U", ş: "S", ö: "O", ç: "C", İ: "I", Ğ: "G", Ü: "U", Ş: "S", Ö: "O", Ç: "C" };
const up = (s: string) => s.replace(/[ıiğüşöçİĞÜŞÖÇ]/g, (c) => TR[c] ?? c).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** dsis_norm ile aynı: harf + rakam */
export const norm = (s: string | null | undefined) => up(s ?? "").replace(/[^A-Z0-9]+/g, "");
// eşleşmede anlamı olmayan sözcükler
const STOP = new Set("LABORATOIRE LABORATORIO LABORATORY LABOR LAB LABO DENTAIRE DENTAL DENTAL DENTALE DENT PROTHESE PROTHESES PROTHESIS PROTESI SARL SAS SASU SA SRL GMBH LTD STI SAN TIC CABINET CENTRE CENTER CLINIQUE CLINIC DR DOCTEUR ET DE DU LA LE LES DES AND THE".split(" "));
const tokens = (s: string) => up(s).split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));

function score(a: string, b: string) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  let inter = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some((u) => (u.length >= 4 && t.startsWith(u)) || (t.length >= 4 && u.startsWith(t)))) inter++;
  const jac = ta.size && tb.size ? inter / Math.min(ta.size, tb.size) : 0;
  const sub = nb.length >= 5 && na.includes(nb) ? 0.85 : na.length >= 5 && nb.includes(na) ? 0.8 : 0;
  return Math.max(jac * 0.9, sub);
}

export type NocustGroup = { key: string; names: string[]; country: string; n: number; total: number; inReport: number; awbs: string[]; sugg: { id: string; name: string; s: number }[] };

/** Hekimi bulunamayan fatura satırları + konşimento listesi satırları, alıcı adına göre gruplanır; her grup için hekim önerileri */
export async function nocustGroups(d: CarrierReport) {
  const sb = await createClient();
  const { data: custs } = await allRows<{ id: string; name: string }>((a, b) => sb.from("lab_customers").select("id, name").eq("is_active", true).order("name").range(a, b));
  const g = new Map<string, NocustGroup>();
  const add = (name: string | null, country: string | null, awb: string, total: number, rep: boolean) => {
    const k = norm(name);
    if (!k) return;
    const x = g.get(k) ?? { key: k, names: [], country: country ?? "", n: 0, total: 0, inReport: 0, awbs: [], sugg: [] };
    if (name && !x.names.includes(name.trim())) x.names.push(name.trim());
    if (!x.awbs.includes(awb)) { x.awbs.push(awb); if (rep) x.inReport++; else { x.n++; x.total += total; } }
    g.set(k, x);
  };
  for (const i of d.items) if (!i.customer_id) add(i.recipient_company ?? i.recipient, i.dest_country ?? i.dest, i.awb, i.total, false);
  for (const r of d.repActive) if (!r.customer_id && r.direction !== "import") add(r.party_company, r.party_country, r.awb, 0, true);
  for (const x of g.values()) {
    x.sugg = custs.map((c) => ({ id: c.id, name: c.name, s: Math.max(...x.names.map((n) => score(n, c.name))) })).filter((c) => c.s >= 0.34).sort((a, b) => b.s - a.s).slice(0, 4);
  }
  return { groups: [...g.values()].sort((a, b) => b.total - a.total || b.awbs.length - a.awbs.length), customers: custs };
}
