import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CUSTOMS_PARTY, ELOGO_CODES, EINV_PROFILES } from "@/lib/einv-codes";
import { elogoCheckUsers, elogoConfigured, elogoSend, elogoStatus, pickAlias, withElogo, type ElogoDocType, type GibUser } from "@/lib/elogo";
import type { Company, InvLine, Invoice } from "@/lib/invoice";
import { EdocBuildError, buildUbl, resolveDoc, validateEdoc, weIssue } from "@/lib/ubl-build";

export type EdocParty = { id: string; name: string; tax_no: string | null; country: string | null; is_einvoice: boolean; einv_alias: string | null; is_edespatch: boolean; edsp_alias: string | null; gib_checked_at: string | null; foreign_tax_id: string | null };

/** Faturayı, satırlarını, şirketi, cariyi ve iade edilen faturayı yükler */
export async function loadEdoc(supabase: SupabaseClient, id: string) {
  const { data: inv } = await supabase.from("inv_invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return null;
  const i = inv as Invoice;
  const [{ data: lines }, { data: co }, { data: party }, { data: ret }] = await Promise.all([
    supabase.from("inv_lines").select("*").eq("invoice_id", id).order("sort"),
    supabase.from("companies").select("*").order("created_at").limit(1).maybeSingle(),
    supabase.from("fin_parties").select("id, name, tax_no, country, is_einvoice, einv_alias, is_edespatch, edsp_alias, gib_checked_at, foreign_tax_id").eq("id", i.party_id).maybeSingle(),
    i.return_of ? supabase.from("inv_invoices").select("doc_no, invoice_date").eq("id", i.return_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const r = ret as { doc_no: string | null; invoice_date: string } | null;
  return { inv: i, lines: (lines ?? []) as InvLine[], co: co as Company, party: party as EdocParty | null, returnOf: r?.doc_no ? { doc_no: r.doc_no, date: r.invoice_date } : null };
}

const isTR = (c: string | null | undefined) => !c || ["TR", "TÜRKIYE", "TÜRKİYE", "TURKEY"].includes(c.trim().toLocaleUpperCase("tr-TR"));

/** GİB sonucu cari kartına yazılır */
export async function saveGib(supabase: SupabaseClient, partyId: string, u: GibUser, keepAlias?: string | null) {
  const inv = u.einvoice ? (keepAlias && u.invoiceAliases.includes(keepAlias) ? keepAlias : pickAlias(u.invoiceAliases)) : null;
  await supabase.rpc("fin_party_gib_set", { p_party: partyId, p: { is_einvoice: u.einvoice, einv_alias: inv, is_edespatch: u.edespatch, edsp_alias: pickAlias(u.despatchAliases) } });
  return inv;
}

/** Cari(ler)in GİB mükellefiyetini sorgular ve kaydeder */
export async function checkParties(supabase: SupabaseClient, parties: Array<{ id: string; tax_no: string | null; country?: string | null }>): Promise<Map<string, GibUser>> {
  const list = parties.filter((p) => isTR(p.country) && /^\d{10,11}$/.test(p.tax_no ?? ""));
  const out = new Map<string, GibUser>();
  if (!list.length || !elogoConfigured()) return out;
  const users = await withElogo((w, s) => elogoCheckUsers(w, s, list.map((p) => p.tax_no!)));
  for (const p of list) {
    const u = users.find((x) => x.identifier === p.tax_no);
    if (u) { await saveGib(supabase, p.id, u); out.set(p.id, u); }
  }
  return out;
}

export const docTypeOf = (profile: string): ElogoDocType => (profile === "EARSIVFATURA" ? "EARCHIVE" : "EINVOICE");

export type SendResult = { ok: boolean; message: string; errors?: string[] };

/**
 * Faturayı eLogo'ya gönderir.
 * 1) Alıcının GİB mükellefiyeti sorgulanır (e-Fatura / e-Arşiv kararı ve posta kutusu etiketi)
 * 2) Doğrulama → 3) çift gönderim kilidi → 4) UBL → SendDocument (taslak ya da doğrudan) → 5) ilk durum
 */
export async function sendInvoice(supabase: SupabaseClient, id: string, o: { draft: boolean; alias?: string | null }): Promise<SendResult> {
  if (!elogoConfigured()) return { ok: false, message: "eLogo bağlantısı yok: Vercel'de ELOGO_USER ve ELOGO_PASS tanımlı olmalı." };
  const d = await loadEdoc(supabase, id);
  if (!d) return { ok: false, message: "Fatura bulunamadı ya da yetkiniz yok." };
  if (!d.co) return { ok: false, message: "Şirket bilgisi yok." };
  if (!weIssue(d.inv)) return { ok: false, message: validateEdoc(d.inv, d.lines, d.co)[0] ?? "Bu belge bizden gönderilmez." };
  return withElogo(async (w, session) => {
    let inv = d.inv;
    const party = d.party;
    let alias = o.alias || party?.einv_alias || null;
    // 1) GİB mükellef sorgusu
    if (party && inv.profile !== "IHRACAT" && isTR(inv.party_country) && /^\d{10,11}$/.test((inv.party_tax_no ?? "").replace(/\D/g, ""))) {
      const [u] = await elogoCheckUsers(w, session, [(inv.party_tax_no ?? "").replace(/\D/g, "")]);
      if (u) {
        alias = (await saveGib(supabase, party.id, u, o.alias || party.einv_alias)) ?? null;
        if (o.alias && u.invoiceAliases.includes(o.alias)) alias = o.alias;
        party.is_einvoice = u.einvoice;
        const kind = EINV_PROFILES[inv.profile]?.kind;
        const wantE = u.einvoice;
        if (kind === "earsiv" && wantE) {
          if (inv.doc_no) return { ok: false, message: "Alıcı e-Fatura mükellefi ama fatura e-Arşiv serisinden numaralandı. Faturayı iptal edip yeniden kesin (alıcı artık e-Fatura olarak seçilecek)." };
          const np = inv.type === "return" ? "TEMELFATURA" : "TICARIFATURA";
          await supabase.rpc("inv_einv_update", { p_id: id, p: { profile: np } });
          inv = { ...inv, profile: np };
        } else if (kind === "efatura" && !wantE && ["TICARIFATURA", "TEMELFATURA"].includes(inv.profile)) {
          if (inv.doc_no) return { ok: false, message: "Alıcı GİB listesinde e-Fatura mükellefi değil ama fatura e-Fatura serisinden numaralandı. Faturayı iptal edip yeniden kesin (e-Arşiv olarak)." };
          await supabase.rpc("inv_einv_update", { p_id: id, p: { profile: "EARSIVFATURA" } });
          inv = { ...inv, profile: "EARSIVFATURA" };
        }
      }
    }
    // 2) doğrulama
    const errors = validateEdoc(inv, d.lines, d.co, { party, returnOf: d.returnOf });
    if (errors.length) return { ok: false, message: `Gönderilmedi: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} sorun daha)` : ""}`, errors };
    const { profile } = resolveDoc(inv, d.lines);
    const type = docTypeOf(profile);
    if (profile === "IHRACAT") alias = CUSTOMS_PARTY.alias;
    if (type === "EINVOICE" && !alias) return { ok: false, message: "Alıcının e-Fatura posta kutusu etiketi bulunamadı; cari kartında “GİB'den sorgula” deyin." };
    // 3) kilit
    // daha önce eLogo'ya ulaşmış ama hata almış belge yeni ETTN ile gider (aynı ETTN ikinci kez kabul edilmez)
    if (inv.einvoice_status === "error" && inv.einv_ref) {
      await supabase.rpc("inv_einv_update", { p_id: id, p: { new_ettn: true } });
      const { data: fresh } = await supabase.from("inv_invoices").select("ettn").eq("id", id).maybeSingle();
      if (fresh?.ettn) inv = { ...inv, ettn: fresh.ettn as string };
    }
    // 3) XML (GİB kurallarıyla doğrulanır) — kilitten önce: hata varsa durum değişmez
    const elogoNumber = d.co.einv_numbering === "elogo" && !inv.doc_no;
    let xml: string;
    try { xml = buildUbl(inv, d.lines, d.co, { party, returnOf: d.returnOf, emptyId: elogoNumber }); }
    catch (e) {
      const errs = e instanceof EdocBuildError ? e.errors : [(e as Error).message];
      return { ok: false, message: `Gönderilmedi (GİB kuralı): ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} sorun daha)` : ""}`, errors: errs };
    }
    // 4) kilit + gönder
    const { error: le } = await supabase.rpc("inv_einv_begin", { p_id: id });
    if (le) return { ok: false, message: /einv_already/.test(le.message) ? "Bu fatura zaten gönderildi ya da gönderiliyor." : le.message };
    try {
      const r = await elogoSend(w, session, {
        type, ettn: inv.ettn, xml, alias, draft: o.draft,
        xslt: type === "EARCHIVE" ? d.co.einv_xslt_earsiv : d.co.einv_xslt_efatura,
        numberPrefix: elogoNumber ? (type === "EARCHIVE" ? d.co.inv_prefix_earsiv : d.co.inv_prefix_efatura) : null,
      });
      if (!r.ok) {
        await supabase.rpc("inv_einv_update", { p_id: id, p: { status: "error", desc: r.message } });
        return { ok: false, message: `eLogo belgeyi kabul etmedi: ${r.message}` };
      }
      await supabase.rpc("inv_einv_update", { p_id: id, p: { status: o.draft ? "draft_sent" : "sent", ref: r.ref, alias: type === "EINVOICE" ? alias : null, draft: o.draft, desc: o.draft ? "eLogo taslaklarında: portalda kontrol edip onaylayın" : "eLogo'ya iletildi" } });
    } catch (e) {
      await supabase.rpc("inv_einv_update", { p_id: id, p: { status: "error", desc: (e as Error).message.slice(0, 400) } });
      return { ok: false, message: `Gönderim hatası: ${(e as Error).message}`.slice(0, 280) };
    }
    // 5) ilk durum (numara)
    try { await refreshOne(supabase, w, session, { id, ettn: inv.ettn, profile, einvoice_status: o.draft ? "draft_sent" : "sent", einv_draft: o.draft, doc_no: elogoNumber ? null : inv.doc_no }); } catch { /* cron yeniler */ }
    return { ok: true, message: o.draft ? "Fatura eLogo taslaklarına gönderildi: eLogo portalında Taslaklar ekranından kontrol edip onaylayın. Onaylanınca durum burada kendiliğinden güncellenir." : `Fatura eLogo'ya gönderildi (${type === "EARCHIVE" ? "e-Arşiv" : "e-Fatura"}). GİB durumu birkaç dakika içinde güncellenir.` };
  });
}

type Pending = { id: string; ettn: string; profile: string; einvoice_status: string; einv_draft: boolean | null; doc_no: string | null };

/** eLogo durumu → fatura durumu */
export async function refreshOne(supabase: SupabaseClient, w: Parameters<Parameters<typeof withElogo>[0]>[0], session: string, row: Pending) {
  const st = await elogoStatus(w, session, row.ettn, docTypeOf(row.profile));
  if (!st.found || (st.code === 0 && !st.docNo)) {
    await supabase.rpc("inv_einv_update", { p_id: row.id, p: { desc: row.einvoice_status === "draft_sent" ? "eLogo taslaklarında: portalda onay bekliyor" : st.resultMsg || "eLogo'da henüz işlenmedi" } });
    return;
  }
  const desc = `${st.code != null ? ELOGO_CODES[st.code] ?? st.desc : st.desc}${st.desc && st.code != null && ELOGO_CODES[st.code] && !ELOGO_CODES[st.code]!.includes(st.desc) ? ` · ${st.desc}` : ""}`.slice(0, 480);
  let status = row.einvoice_status === "draft_sent" ? "sent" : row.einvoice_status;
  if (st.isCancel) status = "cancelled";
  else if (st.status === -1 && st.code !== -3) status = "error";
  else if (/\bKABUL\b/i.test(st.desc)) status = "accepted";
  else if (/\bRED\b|REDDED/i.test(st.desc)) status = "rejected";
  else if (status === "sending") status = "sent";
  await supabase.rpc("inv_einv_update", { p_id: row.id, p: { status, code: st.code, desc, doc_no: st.docNo } });
}

/** Bekleyen gönderimlerin durumlarını yeniler (cron ya da düğme) */
export async function refreshPending(supabase: SupabaseClient, ids?: string[]): Promise<{ checked: number; errors: number }> {
  if (!elogoConfigured()) return { checked: 0, errors: 0 };
  let rows: Pending[] = [];
  if (ids?.length) {
    const { data } = await supabase.from("inv_invoices").select("id, ettn, profile, einvoice_status, einv_draft, doc_no").in("id", ids);
    rows = ((data ?? []) as Pending[]).filter((r) => ["sending", "draft_sent", "sent", "accepted", "rejected", "error"].includes(r.einvoice_status));
  } else {
    const { data } = await supabase.rpc("inv_einv_pending", { p_limit: 60 });
    rows = (data ?? []) as Pending[];
  }
  if (!rows.length) return { checked: 0, errors: 0 };
  let errors = 0;
  await withElogo(async (w, s) => {
    for (const r of rows) { try { await refreshOne(supabase, w, s, r); } catch { errors++; } }
  });
  return { checked: rows.length, errors };
}
