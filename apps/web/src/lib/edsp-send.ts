import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ELOGO_CODES } from "@/lib/einv-codes";
import { elogoCheckUsers, elogoConfigured, elogoSend, elogoStatus, pickAlias, withElogo } from "@/lib/elogo";
import type { Company } from "@/lib/invoice";
import { EdocBuildError, buildDespatch, validateDespatch, type Despatch, type DespatchLine } from "@/lib/ubl-build";
import { saveGib } from "@/lib/einv-send";

export type DespatchRow = Despatch & { no: number; status: string; party_id: string | null; einv_status: string; einv_alias: string | null; einv_draft: boolean | null; einv_sent_at: string | null; einv_ref: number | null; einv_code: number | null; einv_desc: string | null; einv_checked_at: string | null; waybill_id: string | null; invoice_id: string | null; created_at: string };

export async function loadDespatch(supabase: SupabaseClient, id: string) {
  const [{ data: d }, { data: lines }, { data: co }] = await Promise.all([
    supabase.from("edsp_despatches").select("*").eq("id", id).maybeSingle(),
    supabase.from("edsp_lines").select("name, qty, unit, seller_code, unit_price, currency").eq("despatch_id", id).order("sort"),
    supabase.from("companies").select("*").order("created_at").limit(1).maybeSingle(),
  ]);
  if (!d) return null;
  return { d: d as DespatchRow, lines: (lines ?? []) as DespatchLine[], co: co as Company };
}

/** e-İrsaliyeyi eLogo'ya gönderir (alıcı e-İrsaliye mükellefi olmalı) */
export async function sendDespatch(supabase: SupabaseClient, id: string, o: { draft: boolean }): Promise<{ ok: boolean; message: string; errors?: string[] }> {
  if (!elogoConfigured()) return { ok: false, message: "eLogo bağlantısı yok: Vercel'de ELOGO_USER ve ELOGO_PASS tanımlı olmalı." };
  const x = await loadDespatch(supabase, id);
  if (!x) return { ok: false, message: "İrsaliye bulunamadı ya da yetkiniz yok." };
  const { d, lines, co } = x;
  if (d.status !== "draft" || !["none", "error"].includes(d.einv_status)) return { ok: false, message: "Bu irsaliye zaten gönderildi ya da gönderiliyor." };
  const pre = validateDespatch(d, lines, co);
  if (pre.length) return { ok: false, message: `Gönderilmedi: ${pre[0]}${pre.length > 1 ? ` (+${pre.length - 1} sorun daha)` : ""}`, errors: pre };
  return withElogo(async (w, session) => {
    const vkn = (d.party_tax_no ?? "").replace(/\D/g, "");
    const [u] = await elogoCheckUsers(w, session, [vkn]);
    if (u && d.party_id) await saveGib(supabase, d.party_id, u);
    if (!u?.edespatch) return { ok: false, message: "Alıcı GİB listesinde e-İrsaliye mükellefi değil: e-İrsaliye gönderilemez. Malın yanında kâğıt (matbu) irsaliye düzenleyin; laboratuvar irsaliyesinin çıktısını kullanabilirsiniz." };
    const alias = pickAlias(u.despatchAliases);
    let cur = d;
    if (d.einv_status === "error" && d.einv_ref) {
      await supabase.rpc("edsp_update", { p_id: id, p: { new_ettn: true } });
      const { data: fresh } = await supabase.from("edsp_despatches").select("ettn").eq("id", id).maybeSingle();
      if (fresh?.ettn) cur = { ...cur, ettn: fresh.ettn as string };
    }
    const elogoNumber = co.einv_numbering === "elogo" && !d.doc_no;
    // XML önce (kurallara uymazsa numara harcanmaz)
    try { buildDespatch({ ...cur, doc_no: cur.doc_no ?? `${co.inv_prefix_irsaliye ?? "MBI"}${cur.issue_date.slice(0, 4)}000000001` }, lines, co); }
    catch (e) { const errs = e instanceof EdocBuildError ? e.errors : [(e as Error).message]; return { ok: false, message: `Gönderilmedi (GİB kuralı): ${errs[0]}`, errors: errs }; }
    const { data: locked, error: le } = await supabase.rpc("edsp_begin", { p_id: id, p_number: !elogoNumber });
    if (le) return { ok: false, message: /einv_already/.test(le.message) ? "Bu irsaliye zaten gönderildi ya da gönderiliyor." : le.message };
    const L = locked as DespatchRow;
    try {
      const xml = buildDespatch({ ...cur, doc_no: L.doc_no }, lines, co, { emptyId: elogoNumber });
      const r = await elogoSend(w, session, { type: "DESPATCHADVICE", ettn: cur.ettn, xml, alias, draft: o.draft, xslt: co.einv_xslt_irsaliye, numberPrefix: elogoNumber ? co.inv_prefix_irsaliye ?? "MBI" : null });
      if (!r.ok) { await supabase.rpc("edsp_update", { p_id: id, p: { status: "error", desc: r.message } }); return { ok: false, message: `eLogo irsaliyeyi kabul etmedi: ${r.message}` }; }
      await supabase.rpc("edsp_update", { p_id: id, p: { status: o.draft ? "draft_sent" : "sent", ref: r.ref, alias, draft: o.draft, desc: o.draft ? "eLogo taslaklarında: portalda kontrol edip onaylayın" : "eLogo'ya iletildi" } });
    } catch (e) {
      await supabase.rpc("edsp_update", { p_id: id, p: { status: "error", desc: (e as Error).message.slice(0, 400) } });
      return { ok: false, message: `Gönderim hatası: ${(e as Error).message}`.slice(0, 280) };
    }
    try { await refreshDespatchOne(supabase, w, session, { id, ettn: cur.ettn, einv_status: o.draft ? "draft_sent" : "sent" }); } catch { /* cron yeniler */ }
    return { ok: true, message: o.draft ? "e-İrsaliye eLogo taslaklarına gönderildi: portalda kontrol edip onaylayın." : "e-İrsaliye eLogo'ya gönderildi." };
  });
}

type P = { id: string; ettn: string; einv_status: string };
export async function refreshDespatchOne(supabase: SupabaseClient, w: Parameters<Parameters<typeof withElogo>[0]>[0], session: string, row: P) {
  const st = await elogoStatus(w, session, row.ettn, "DESPATCHADVICE");
  if (!st.found || (st.code === 0 && !st.docNo)) {
    await supabase.rpc("edsp_update", { p_id: row.id, p: { desc: row.einv_status === "draft_sent" ? "eLogo taslaklarında: portalda onay bekliyor" : st.resultMsg || "eLogo'da henüz işlenmedi" } });
    return;
  }
  const desc = `${st.code != null ? ELOGO_CODES[st.code] ?? st.desc : st.desc}${st.desc && st.code != null && ELOGO_CODES[st.code] && !ELOGO_CODES[st.code]!.includes(st.desc) ? ` · ${st.desc}` : ""}`.slice(0, 480);
  let status = row.einv_status === "draft_sent" || row.einv_status === "sending" ? "sent" : row.einv_status;
  if (st.isCancel) status = "cancelled";
  else if (st.status === -1 && st.code !== -3) status = "error";
  else if (/KISMI|KABUL/i.test(st.desc)) status = "accepted";
  else if (/\bRED\b|REDDED/i.test(st.desc)) status = "rejected";
  await supabase.rpc("edsp_update", { p_id: row.id, p: { status, code: st.code, desc, doc_no: st.docNo } });
}

export async function refreshDespatches(supabase: SupabaseClient, ids?: string[]): Promise<{ checked: number; errors: number }> {
  if (!elogoConfigured()) return { checked: 0, errors: 0 };
  let rows: P[] = [];
  if (ids?.length) {
    const { data } = await supabase.from("edsp_despatches").select("id, ettn, einv_status").in("id", ids);
    rows = ((data ?? []) as P[]).filter((r) => ["sending", "draft_sent", "sent", "accepted", "rejected", "error"].includes(r.einv_status));
  } else {
    const { data } = await supabase.rpc("edsp_pending", { p_limit: 40 });
    rows = (data ?? []) as P[];
  }
  if (!rows.length) return { checked: 0, errors: 0 };
  let errors = 0;
  await withElogo(async (w, s) => { for (const r of rows) { try { await refreshDespatchOne(supabase, w, s, r); } catch { errors++; } } });
  return { checked: rows.length, errors };
}
