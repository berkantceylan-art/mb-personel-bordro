import { grossOf } from "@/lib/boss";
import { contractsAt } from "@/lib/contracts";
import type { LeaveData } from "@/lib/annual-leave";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Günlük brüt ücret (resmi / gerçek): izin ücreti ve yükümlülük için (md. 57, 59) */
export async function dailyWages(sb: SB, d: LeaveData, on: string) {
  const ids = d.emps.map((e) => e.id);
  const cs = await contractsAt(sb, ids, on);
  const out = new Map<string, { official: number; real: number }>();
  for (const [id, c] of cs) {
    try {
      const g = grossOf(c, on);
      out.set(id, { official: g.official / 30, real: g.real / 30 });
    } catch { /* sözleşme eksik */ }
  }
  return out;
}

export function liability(d: LeaveData, wages: Map<string, { official: number; real: number }>) {
  let days = 0, official = 0, real = 0, missing = 0;
  for (const e of d.emps) {
    const l = d.ledgers.get(e.id);
    if (!l || l.balance <= 0) continue;
    days += l.balance;
    const w = wages.get(e.id);
    if (!w) { missing++; continue; }
    official += w.official * l.balance; real += w.real * l.balance;
  }
  return { days: Math.round(days * 10) / 10, official: Math.round(official), real: Math.round(real), missing };
}

export const yearsSince = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (365.25 * 86_400_000);
