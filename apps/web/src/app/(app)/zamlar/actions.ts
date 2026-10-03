"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyRaise, parseTL, type RaiseKind } from "@mb/core";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";

export interface RaiseResult {
  ok: boolean;
  message: string;
}

type Current = {
  employee_id: string;
  total_net: number;
  insurance_type: "MIN_WAGE" | "FIXED_NET";
  fixed_official_net: number | null;
  bes_rate: number;
  employer_discount: boolean;
};

/** Her personelin verilen tarihte geçerli son ücret kaydı */
export async function currentContracts(employeeIds: string[], onDate: string): Promise<Map<string, Current>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pay_contracts")
    .select("employee_id, valid_from, total_net, insurance_type, fixed_official_net, bes_rate, employer_discount")
    .in("employee_id", employeeIds)
    .lte("valid_from", onDate)
    .order("valid_from", { ascending: true });
  const m = new Map<string, Current>();
  for (const c of data ?? []) {
    m.set(c.employee_id, {
      employee_id: c.employee_id,
      total_net: Number(c.total_net),
      insurance_type: c.insurance_type,
      fixed_official_net: c.fixed_official_net === null ? null : Number(c.fixed_official_net),
      bes_rate: Number(c.bes_rate),
      employer_discount: c.employer_discount,
    });
  }
  return m;
}

function parseRule(f: FormData): { kind: RaiseKind; value: number; roundTo: number } | string {
  const kind = String(f.get("kind")) as RaiseKind;
  const raw = String(f.get("value") ?? "").trim();
  if (!raw) return "Zam değerini girin.";
  let value: number;
  try {
    value = kind === "PERCENT" ? Number(raw.replace(",", ".")) : parseTL(raw);
  } catch {
    return "Zam değeri okunamadı.";
  }
  if (!Number.isFinite(value) || value <= 0) return "Zam değeri sıfırdan büyük olmalı.";
  const roundTo = Number(f.get("roundTo") ?? 0) * 100;
  return { kind, value, roundTo };
}

export async function applyBulkRaise(_: RaiseResult | null, f: FormData): Promise<RaiseResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const rule = parseRule(f);
  if (typeof rule === "string") return { ok: false, message: rule };
  const effective = String(f.get("effective_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { ok: false, message: "Geçerlilik tarihi seçin." };
  const ids = f.getAll("employeeId").map(String);
  if (!ids.length) return { ok: false, message: "En az bir personel seçin." };
  const note = String(f.get("note") ?? "").trim() || null;
  const scope = String(f.get("scope") ?? "Seçili personel");

  const supabase = await createClient();
  const current = await currentContracts(ids, effective);
  const { data: existing } = await supabase.from("pay_contracts").select("employee_id").in("employee_id", ids).eq("valid_from", effective);
  const clash = new Set((existing ?? []).map((r) => r.employee_id));

  const rows = ids
    .filter((id) => current.has(id) && !clash.has(id))
    .map((id) => {
      const c = current.get(id)!;
      return { c, next: applyRaise(c.total_net, rule) };
    })
    .filter(({ c, next }) => next !== c.total_net);
  if (!rows.length) return { ok: false, message: "Uygulanacak zam yok (ücret kaydı olmayan veya aynı tarihte kaydı olan personel atlanır)." };

  const monthlyIncrease = rows.reduce((a, r) => a + (r.next - r.c.total_net), 0);
  const { data: batch, error: bErr } = await supabase
    .from("salary_raise_batches")
    .insert({
      company_id: s.companyId,
      effective_date: effective,
      kind: rule.kind,
      value: rule.kind === "PERCENT" ? rule.value : rule.value / 100,
      round_to: rule.roundTo || null,
      scope,
      note,
      employee_count: rows.length,
      monthly_increase: monthlyIncrease,
    })
    .select("id")
    .single();
  if (bErr || !batch) return { ok: false, message: bErr?.message ?? "Zam kaydı oluşturulamadı." };

  const { error } = await supabase.from("pay_contracts").insert(
    rows.map(({ c, next }) => ({
      company_id: s.companyId,
      employee_id: c.employee_id,
      valid_from: effective,
      total_net: next,
      insurance_type: c.insurance_type,
      fixed_official_net: c.fixed_official_net,
      bes_rate: c.bes_rate,
      employer_discount: c.employer_discount,
      raise_batch_id: batch.id,
      previous_total_net: c.total_net,
      change_reason: note ?? "Toplu zam",
    })),
  );
  if (error) return { ok: false, message: error.message };

  revalidatePath("/zamlar");
  const skipped = ids.length - rows.length;
  return {
    ok: true,
    message: `${rows.length} personele zam uygulandı. Aylık toplam artış ${(monthlyIncrease / 100).toLocaleString("tr-TR")} TL.${skipped ? ` ${skipped} kişi atlandı.` : ""}`,
  };
}

export async function applyEmployeeRaise(_: RaiseResult | null, f: FormData): Promise<RaiseResult> {
  const s = await getSession();
  if (!canManagePay(s.role)) return { ok: false, message: "Yetkiniz yok." };
  const employeeId = String(f.get("employeeId"));
  const effective = String(f.get("effective_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { ok: false, message: "Geçerlilik tarihi seçin." };
  const rule = parseRule(f);
  if (typeof rule === "string") return { ok: false, message: rule };

  const current = (await currentContracts([employeeId], effective)).get(employeeId);
  const insurance = String(f.get("insurance_type")) === "FIXED_NET" ? "FIXED_NET" : "MIN_WAGE";
  const fixedRaw = String(f.get("fixed_official_net") ?? "").trim();
  if (insurance === "FIXED_NET" && !fixedRaw) return { ok: false, message: "Belirli net sigortada resmi net tutarını girin." };
  const next = applyRaise(current?.total_net ?? 0, rule);

  const supabase = await createClient();
  const { error } = await supabase.from("pay_contracts").insert({
    company_id: s.companyId,
    employee_id: employeeId,
    valid_from: effective,
    total_net: next,
    insurance_type: insurance,
    fixed_official_net: insurance === "FIXED_NET" ? parseTL(fixedRaw) : null,
    bes_rate: f.get("bes") === "on" ? 0.03 : 0,
    employer_discount: current?.employer_discount ?? true,
    previous_total_net: current?.total_net ?? null,
    change_reason: String(f.get("reason") ?? "").trim() || (current ? "Zam" : "İlk ücret"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/personel/${employeeId}`);
  revalidatePath("/zamlar");
  redirect(`/personel/${employeeId}`);
}

export async function deleteContract(f: FormData) {
  const s = await getSession();
  if (!canManagePay(s.role)) throw new Error("Yetkiniz yok");
  const id = String(f.get("id"));
  const employeeId = String(f.get("employeeId"));
  const supabase = await createClient();
  const { error } = await supabase.from("pay_contracts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/personel/${employeeId}`);
  revalidatePath("/zamlar");
}
