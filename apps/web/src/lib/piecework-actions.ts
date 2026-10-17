"use server";
import { revalidatePath } from "next/cache";
import { formatTL, officialBonusGross, periodBounds } from "@mb/core";
import { contractsAt } from "@/lib/contracts";
import { legalParams } from "@/lib/legal";
import { cumulativeBases } from "@/lib/payroll";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;

function errText(m: string) {
  if (/pc_|schema cache|does not exist/.test(m) && /function|relation|column|schema/.test(m)) return "Supabase'de mbdental-parca-basi.sql çalıştırılmalı.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/employee_required/.test(m)) return "Personeli seçin.";
  if (/name_required/.test(m)) return "Ad yazın.";
  if (/bad_tax_no/.test(m)) return "VKN / TCKN 10 ya da 11 haneli olmalı.";
  if (/worker_required/.test(m)) return "Ustayı seçin (pasif usta seçilemez).";
  if (/qty_required/.test(m)) return "Adet / üye sayısını yazın.";
  if (/future_date/.test(m)) return "İleri tarihli kayıt girilemez.";
  if (/job_not_found/.test(m)) return "Bu numarada iş kaydı yok.";
  if (/price_required/.test(m)) return "Bu ürün / iş için fiyat listesinde fiyat yok; birim fiyatı yazın ya da Tanımlar'dan fiyat ekleyin.";
  if (/work_required/.test(m)) return "Ürün ya da iş adı seçin.";
  if (/locked/.test(m)) return "Onaylanmış / aktarılmış kayıt değiştirilemez; önce onayı geri alın.";
  if (/reason_required/.test(m)) return "Sebep yazın.";
  if (/party_missing:(.*)/.test(m)) return `${m.match(/party_missing:(.*)/)![1]} için finans carisi yok; Tanımlar'dan ustayı kaydedin.`;
  if (/kapalı|period_closed|closed/.test(m)) return "Bu dönem kapalı; personel carisine yazılamaz.";
  return m;
}
function refresh() {
  for (const p of ["/uretim/parca-basi", "/uretim/parca-basi/tanimlar", "/uretim/parca-basi/rapor", "/uretim/maliyet", "/odeme-merkezi", "/bordro/sihirbaz"]) revalidatePath(p);
}
async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await (await createClient()).rpc(fn, args);
  if (error) await fail(errText(error.message));
  return data as unknown;
}

export async function saveWorker(f: FormData) {
  await rpc("pc_worker_save", {
    p: {
      id: str(f, "id") || null, kind: str(f, "kind") === "internal" ? "internal" : "external", employee_id: str(f, "employee_id") || null,
      name: str(f, "name"), phone: str(f, "phone"), iban: str(f, "iban"), tax_no: str(f, "tax_no"), doc_type: str(f, "doc_type") || "none",
      stopaj_pct: str(f, "stopaj_pct").replace(",", ".") || "0", pay_side: str(f, "pay_side") || "CASH", pay_days: str(f, "pay_days") || "7",
      is_active: f.get("is_active") === "off" ? false : true, note: str(f, "note"),
    },
  });
  refresh();
  await done("Usta kaydedildi.");
}

export async function saveRate(f: FormData) {
  const price = parseMoney(str(f, "price"));
  if (price == null) await fail("Birim fiyatı yazın.");
  let workName = str(f, "work_name");
  const productId = str(f, "lab_product_id");
  if (!workName && productId) {
    const { data } = await (await createClient()).from("lab_products").select("name").eq("id", productId).maybeSingle();
    workName = data?.name ?? "";
  }
  if (!workName) await fail("Ürün seçin ya da iş adı yazın.");
  await rpc("pc_rate_save", { p: { id: str(f, "id") || null, lab_product_id: productId || null, work_name: workName, unit: str(f, "unit") || "üye", price, worker_id: str(f, "worker_id") || null } });
  refresh();
  await done("Fiyat kaydedildi.");
}

export async function deleteRate(f: FormData) {
  await rpc("pc_rate_delete", { p_id: str(f, "id") });
  refresh();
  await done("Fiyat kaldırıldı.");
}

export async function saveEntry(f: FormData) {
  const priceRaw = str(f, "unit_price");
  const price = priceRaw ? parseMoney(priceRaw) : null;
  if (priceRaw && price == null) await fail("Birim fiyat okunamadı.");
  await rpc("pc_entry_save", {
    p: {
      id: str(f, "id") || null, worker_id: str(f, "worker_id"), work_date: str(f, "work_date"), job_no: str(f, "job_no") || null,
      lab_product_id: str(f, "lab_product_id") || null, work_name: str(f, "work_name") || null, qty: str(f, "qty").replace(",", "."),
      unit_price: price, unit: str(f, "unit") || null, note: str(f, "note"),
    },
  });
  refresh();
  await done("İş kaydedildi; onay bekliyor.");
}

export async function deleteEntry(f: FormData) {
  await rpc("pc_entry_delete", { p_id: str(f, "id") });
  refresh();
  await done("Kayıt silindi.");
}

const selected = (f: FormData) => f.getAll("sel").map(String).filter((x) => UUID.test(x)).slice(0, 500);

/** Toplu: onayla / reddet / onayı geri al / aktar / aktarımı geri al */
export async function bulkPiece(f: FormData) {
  const ids = selected(f);
  const action = str(f, "action");
  if (!ids.length) await fail("Önce listeden kayıt seçin.");
  if (action === "approve" || action === "reject" || action === "reopen") {
    const n = await rpc("pc_decide", { p_ids: ids, p_decision: action, p_reason: str(f, "reason") || null });
    refresh();
    await done(`${Number(n ?? 0)} kayıt ${action === "approve" ? "onaylandı" : action === "reject" ? "reddedildi" : "onaya geri alındı"}.`);
  }
  if (action === "unpost") {
    const n = await rpc("pc_unpost", { p_ids: ids, p_reason: str(f, "reason") });
    refresh();
    await done(`${Number(n ?? 0)} kaydın aktarımı geri alındı (finans / cari kayıtları iptal edildi).`);
  }
  if (action === "post") await postEntries(ids);
  await fail("İşlem seçin.");
}

/** Aktar: dış usta → gider + borç + ödeme planı; personel → maaş carisine ek ödeme (elden ya da resmi brüt) */
async function postEntries(ids: string[]) {
  const s = await getSession();
  if (!canManagePay(s.role)) await fail("Aktarım için muhasebe / sahip yetkisi gerekir.");
  const sb = await createClient();
  const { data, error } = await sb.from("pc_entries").select("id, worker_id, period, amount, status, pc_workers(kind, employee_id, name, pay_side)").in("id", ids).eq("status", "approved");
  if (error) await fail(errText(error.message));
  type E = { id: string; worker_id: string; period: string; amount: number; pc_workers: { kind: string; employee_id: string | null; name: string; pay_side: "OFFICIAL" | "CASH" } | null };
  const rows = (data ?? []) as unknown as E[];
  if (!rows.length) await fail("Seçilenler arasında onaylı (aktarılmamış) kayıt yok.");
  const msgs: string[] = [];
  const ext = rows.filter((r) => r.pc_workers?.kind === "external").map((r) => r.id);
  if (ext.length) {
    const r = (await rpc("pc_post_external", { p_ids: ext })) as { workers: number; entries: number };
    msgs.push(`${r.workers} dış usta (${r.entries} kayıt) gidere ve ödeme merkezine aktarıldı`);
  }
  // Personel: usta + dönem başına tek cari satırı
  const groups = new Map<string, E[]>();
  for (const r of rows.filter((x) => x.pc_workers?.kind === "internal")) {
    const k = `${r.worker_id}|${r.period}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let nInt = 0;
  for (const g of groups.values()) {
    const w = g[0]!.pc_workers!;
    const empId = w.employee_id!;
    const period = g[0]!.period;
    const total = g.reduce((t, x) => t + Number(x.amount), 0);
    if (total <= 0) continue;
    const { end } = periodBounds(period);
    let gross: number | null = null;
    let net = total;
    if (w.pay_side === "OFFICIAL") {
      const [contracts, { data: emp }, legal] = await Promise.all([
        contractsAt(sb, [empId], end), sb.from("employees").select("id, hire_date").eq("id", empId).single(), legalParams(sb, Number(period.slice(0, 4))),
      ]);
      const c = contracts.get(empId);
      if (!c || !emp) { msgs.push(`${w.name}: ücret kaydı yok, resmi aktarılamadı`); continue; }
      const cum = await cumulativeBases(sb, period, [emp], contracts);
      const a = officialBonusGross({ contract: c, month: Number(period.slice(5, 7)), cumulativeTaxBaseBefore: cum.get(empId) ?? 0, params: legal.params }, total);
      gross = a.officialGross;
      net = a.officialNet;
    }
    const { data: le, error: e2 } = await sb.from("ledger_entries").insert({
      company_id: s.companyId, employee_id: empId, period, entry_date: end, type: "BONUS", channel: "NONE", amount: net, pay_side: w.pay_side, gross_amount: gross,
      note: `Parça başı ücret (${g.length} kayıt, ${w.pay_side === "OFFICIAL" ? "resmi" : "elden"})`,
    }).select("id").single();
    if (e2 || !le) { msgs.push(`${w.name}: ${errText(e2?.message ?? "cari kaydı yazılamadı")}`); continue; }
    const { error: e3 } = await sb.rpc("pc_mark_internal_posted", { p_ids: g.map((x) => x.id), p_ledger: le.id, p_gross: gross });
    if (e3) { msgs.push(`${w.name}: ${errText(e3.message)}`); continue; }
    nInt++;
    msgs.push(`${w.name}: ${formatTL(net)} maaş carisine${gross ? ` (bordroya brüt ${formatTL(gross)})` : " (elden)"}`);
  }
  refresh();
  if (!ext.length && !nInt) await fail(msgs.join(" · ") || "Aktarılacak kayıt yok.");
  await done(`Aktarıldı: ${msgs.join(" · ")}.`);
}
