import { Chip, Notice, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { elogoConfigured } from "@/lib/elogo";
import { EINV_PROFILES, EINV_SEND_STATUS, EINV_TYPES, ELOGO_CODES, EXEMPTIONS, INCOTERMS, PACKAGE_KINDS, PAY_METHODS, PROFILE_TYPES, TRANSPORT_MODES, WITHHOLDINGS } from "@/lib/einv-codes";
import { resolveDoc, validateEdoc, weIssue } from "@/lib/einv-rules";
import { einvCancelEArchive, einvCheckParty, einvRefresh, einvSaveEdoc, einvSend } from "@/lib/einv-send-actions";
import type { Company, InvLine, Invoice } from "@/lib/invoice";

const isTR = (c?: string | null) => !c || ["TR", "TÜRKIYE", "TÜRKİYE", "TURKEY"].includes(c.trim().toLocaleUpperCase("tr-TR"));
const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }) : "");

/** Fatura sayfasındaki eLogo e-belge paneli (satış faturası / alış iadesi) */
export async function EdocPanel({ inv, lines, lvl }: { inv: Invoice; lines: InvLine[]; lvl: number }) {
  if (!weIssue(inv) || inv.source === "ubl" || inv.status === "draft") return null;
  const supabase = await createClient();
  const [{ data: co }, { data: party }, { data: ret }] = await Promise.all([
    supabase.from("companies").select("*").order("created_at").limit(1).maybeSingle(),
    supabase.from("fin_parties").select("id, tax_no, country, is_einvoice, einv_alias, is_edespatch, gib_checked_at, foreign_tax_id").eq("id", inv.party_id).maybeSingle(),
    inv.return_of ? supabase.from("inv_invoices").select("doc_no, invoice_date").eq("id", inv.return_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const c = co as Company | null;
  if (!c) return null;
  const p = party as { id: string; tax_no: string | null; country: string | null; is_einvoice: boolean; einv_alias: string | null; gib_checked_at: string | null; foreign_tax_id: string | null } | null;
  const r = ret as { doc_no: string | null; invoice_date: string } | null;
  const configured = elogoConfigured();
  const st = inv.einvoice_status;
  const editable = inv.status === "posted" && ["none", "ready", "error"].includes(st);
  const tracked = ["sending", "draft_sent", "sent", "accepted", "rejected", "error"].includes(st);
  const issues = editable ? validateEdoc(inv, lines, c, { party: p, returnOf: r?.doc_no ? { doc_no: r.doc_no, date: r.invoice_date } : null }) : [];
  const { profile, typeCode } = resolveDoc(inv, lines);
  const earsiv = profile === "EARSIVFATURA";
  const ageDays = Math.floor((Date.now() - new Date(`${inv.invoice_date}T00:00:00+03:00`).getTime()) / 86400000);
  const canCancel = earsiv && ["sent", "accepted", "error", "draft_sent"].includes(st) && inv.status === "posted" && lvl >= 3;
  const f = inv as Invoice & Record<string, unknown>;
  const v = (k: string) => (f[k] == null ? "" : String(f[k]));

  return (
    <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3 text-sm" id="e-belge">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">e-Belge (eLogo)</h2>
        <Chip tone="blue">{EINV_PROFILES[profile]?.label ?? profile} · {EINV_TYPES[typeCode] ?? typeCode}</Chip>
        <Chip tone={EINV_SEND_STATUS[st]?.[1]}>{EINV_SEND_STATUS[st]?.[0] ?? st}</Chip>
        {inv.einv_draft && st !== "none" && <Chip tone="amber">taslak olarak gönderildi</Chip>}
        {inv.einv_sent_at && <span className="text-xs text-muted">Gönderim {dt(inv.einv_sent_at)}{inv.einv_checked_at ? ` · son kontrol ${dt(inv.einv_checked_at)}` : ""}</span>}
      </div>
      {(inv.einv_desc || inv.einv_code != null) && (
        <p className={`text-sm ${st === "error" || st === "rejected" ? "text-bad" : "text-muted"}`}>{inv.einv_code != null && ELOGO_CODES[inv.einv_code] && !inv.einv_desc?.includes(ELOGO_CODES[inv.einv_code]!) ? `${ELOGO_CODES[inv.einv_code]} · ` : ""}{inv.einv_desc}</p>
      )}
      {inv.einv_alias && <p className="text-xs text-muted">Alıcı posta kutusu: {inv.einv_alias}</p>}

      {!configured && <Notice tone="info">eLogo bağlantısı tanımlı değil (Vercel: ELOGO_USER / ELOGO_PASS). O zamana kadar XML&apos;i indirip eLogo portalından gönderebilirsiniz.</Notice>}

      {editable && issues.length > 0 && (
        <div className="rounded-[10px] bg-warn-bg text-warn px-4 py-3">
          <b>Göndermeden önce düzeltin:</b>
          <ul className="list-disc ml-5 mt-1">{issues.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      {editable && configured && lvl >= 2 && (
        <form action={einvSend} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={inv.id} />
          <label className="flex items-center gap-2"><input type="radio" name="mode" value="draft" defaultChecked={c.einv_draft !== false} /> eLogo taslaklarına gönder <span className="text-xs text-muted">(portalda kontrol edip onaylarsınız)</span></label>
          <label className="flex items-center gap-2"><input type="radio" name="mode" value="direct" defaultChecked={c.einv_draft === false} /> Doğrudan GİB&apos;e gönder</label>
          <span className={btnPrimary}><ConfirmSubmit label="eLogo'ya gönder" className="font-semibold" question="Seçtiğiniz şekilde gönderilsin mi? Doğrudan gönderimde fatura GİB'e gider ve geri alınamaz." yes="Gönder" /></span>
          <p className="w-full text-xs text-muted">
            Gönderirken alıcının GİB mükellefiyeti sorgulanır: e-Fatura mükellefi değilse e-Arşiv olarak gider{p?.gib_checked_at ? ` (son sorgu ${dt(p.gib_checked_at)}: ${p.is_einvoice ? "e-Fatura mükellefi" : "mükellef değil"})` : ""}.
            {c.einv_numbering === "elogo" ? " Fatura numarasını eLogo verir." : ""}
          </p>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {configured && tracked && <form action={einvRefresh}><input type="hidden" name="id" value={inv.id} /><PendingSubmit className={btnSecondary}>Durumu yenile</PendingSubmit></form>}
        {configured && ["sent", "accepted", "rejected", "cancelled", "draft_sent"].includes(st) && (
          <>
            <a href={`/api/fatura/${inv.id}/pdf`} className={btnSecondary}>Resmî PDF (eLogo)</a>
            <a href={`/api/fatura/${inv.id}/pdf?bicim=html`} target="_blank" rel="noreferrer" className={btnSecondary}>Görüntüle</a>
          </>
        )}
        {configured && p?.tax_no && isTR(p.country) && lvl >= 2 && <form action={einvCheckParty}><input type="hidden" name="party" value={p.id} /><PendingSubmit className={btnSecondary}>Alıcıyı GİB&apos;den sorgula</PendingSubmit></form>}
      </div>

      {canCancel && configured && (
        <form action={einvCancelEArchive} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <input type="hidden" name="id" value={inv.id} />
          <label className="flex flex-col gap-1 font-semibold flex-1 min-w-60">e-Arşiv iptal nedeni<input name="reason" maxLength={300} className={inputCls} /></label>
          <span className={btnSecondary}><ConfirmSubmit label="e-Arşiv faturayı iptal et" question="Fatura eLogo'da iptal edilip cari, KDV ve stok geri alınacak. Emin misiniz?" /></span>
          <p className="w-full text-xs text-muted">{ageDays > 7 ? `Fatura ${ageDays} günlük: e-Arşiv iptali genellikle 7 gün içinde yapılabilir; eLogo reddederse alıcıdan iade faturası istenir.` : "e-Arşiv faturası 7 gün içinde iptal edilebilir."}</p>
        </form>
      )}
      {!earsiv && ["sent", "accepted"].includes(st) && <p className="text-xs text-muted">e-Fatura sistemde iptal edilemez: ticari faturada alıcı 8 gün içinde reddedebilir; aksi hâlde iade faturası kesilir.</p>}

      {editable && lvl >= 2 && (
        <details className="border-t border-line pt-3" open={issues.length > 0}>
          <summary className="cursor-pointer font-semibold">e-Belge bilgilerini düzenle</summary>
          <form action={einvSaveEdoc} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="id" value={inv.id} />
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 font-semibold">Fatura tipi
                <select name="type_code" defaultValue={v("type_code")} className={selectCls}><option value="">Otomatik</option>{(PROFILE_TYPES[profile] ?? []).map((k) => <option key={k} value={k}>{EINV_TYPES[k] ?? k}</option>)}</select>
              </label>
              {earsiv && (
                <>
                  <label className="flex flex-col gap-1 font-semibold">Gönderim şekli<select name="send_method" defaultValue={v("send_method") || "ELEKTRONIK"} className={selectCls}><option value="ELEKTRONIK">Elektronik</option><option value="KAGIT">Kâğıt</option></select></label>
                  <label className="flex flex-col gap-1 font-semibold">ETGB no<input name="export_doc_no" defaultValue={v("export_doc_no")} className={`${inputCls} font-mono`} /></label>
                  <input type="hidden" name="export_doc_kind" value="etgb" />
                  <label className="flex flex-col gap-1 font-semibold">ETGB tarihi<input type="date" name="export_doc_date" defaultValue={v("export_doc_date")} className={inputCls} /></label>
                  <input type="hidden" name="online_sale_on" value="1" />
                  <label className="flex items-center gap-2"><input type="checkbox" name="online_sale" defaultChecked={!!inv.online_sale} /> İnternet satışı</label>
                  <label className="flex flex-col gap-1 font-semibold">Ödeme şekli<select name="pay_method" defaultValue={v("pay_method")} className={selectCls}><option value="">—</option>{PAY_METHODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                  <label className="flex flex-col gap-1 font-semibold">Ödeme tarihi<input type="date" name="pay_date" defaultValue={v("pay_date")} className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold">Gönderim tarihi<input type="date" name="ship_date" defaultValue={v("ship_date")} className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold">Taşıyıcı unvanı<input name="carrier_name" defaultValue={v("carrier_name")} className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold">Taşıyıcı VKN<input name="carrier_tax_no" defaultValue={v("carrier_tax_no")} className={inputCls} /></label>
                </>
              )}
              {profile === "IHRACAT" && (
                <>
                  <label className="flex flex-col gap-1 font-semibold">Teslim şartı<select name="incoterm" defaultValue={v("incoterm")} className={selectCls}><option value="">—</option>{INCOTERMS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                  <label className="flex flex-col gap-1 font-semibold">Taşıma şekli<select name="transport_mode" defaultValue={v("transport_mode")} className={selectCls}><option value="">—</option>{TRANSPORT_MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                  <label className="flex flex-col gap-1 font-semibold">Kap cinsi<select name="package_kind" defaultValue={v("package_kind")} className={selectCls}><option value="">—</option>{PACKAGE_KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                  <label className="flex flex-col gap-1 font-semibold">Kap adedi<input name="package_count" defaultValue={v("package_count")} inputMode="numeric" className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold">Kap no<input name="package_no" defaultValue={v("package_no")} className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold sm:col-span-2">Teslim adresi<input name="delivery_address" defaultValue={v("delivery_address")} placeholder="boş = cari adresi" className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold">Alıcının yabancı vergi no<input name="foreign_tax_id" defaultValue={p?.foreign_tax_id ?? ""} className={inputCls} /></label>
                </>
              )}
              {profile === "KAMU" && (
                <>
                  <label className="flex flex-col gap-1 font-semibold">Alıcı kurum<input name="buyer_name" defaultValue={v("buyer_name")} placeholder="boş = cari" className={inputCls} /></label>
                  <label className="flex flex-col gap-1 font-semibold">Kurum VKN<input name="buyer_tax_no" defaultValue={v("buyer_tax_no")} className={inputCls} /></label>
                </>
              )}
              {earsiv && !isTR(inv.party_country) && <label className="flex flex-col gap-1 font-semibold">Alıcının yabancı vergi no<input name="foreign_tax_id" defaultValue={p?.foreign_tax_id ?? ""} className={inputCls} /></label>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[760px]">
                <thead><tr className="text-left text-muted"><th className="py-1 pr-2">Satır</th><th className="py-1 pr-2">KDV istisna (%0)</th><th className="py-1 pr-2">Tevkifat kodu</th><th className="py-1 pr-2">GTİP</th>{profile === "ILAC_TIBBICIHAZ" && <><th className="py-1 pr-2">Ürün türü</th><th className="py-1 pr-2">Tanımlayıcı</th></>}<th className="py-1">DİİB satır</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-[#EEF2F6]">
                      <td className="py-1 pr-2">{l.name}<input type="hidden" name="line" value={l.id} /></td>
                      <td className="py-1 pr-2">{Number(l.vat_rate) === 0 ? <select name={`vat_exemption_code_${l.id}`} defaultValue={l.vat_exemption_code ?? "351"} className={`${selectCls} h-8 w-60`}>{EXEMPTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select> : <span className="text-muted">%{Number(l.vat_rate)}</span>}</td>
                      <td className="py-1 pr-2">{Number(l.withholding_rate) > 0 ? <select name={`withholding_code_${l.id}`} defaultValue={l.withholding_code ?? ""} className={`${selectCls} h-8 w-44`}><option value="">—</option>{WITHHOLDINGS.map(([k, t, rt]) => <option key={k} value={k}>{k} · %{rt} · {t.slice(0, 30)}</option>)}</select> : <span className="text-muted">—</span>}</td>
                      <td className="py-1 pr-2"><input name={`gtip_${l.id}`} defaultValue={l.gtip ?? ""} className={`${inputCls} h-8 w-36 font-mono`} /></td>
                      {profile === "ILAC_TIBBICIHAZ" && (
                        <>
                          <td className="py-1 pr-2"><select name={`ident_scheme_${l.id}`} defaultValue={l.ident_scheme ?? "DIGER"} className={`${selectCls} h-8 w-32`}><option value="TIBBICIHAZ">Tıbbi cihaz</option><option value="ILAC">İlaç</option><option value="DIGER">Diğer</option></select></td>
                          <td className="py-1 pr-2"><input name={`ident_${l.id}`} defaultValue={l.ident ?? ""} className={`${inputCls} h-8 w-64 font-mono`} /></td>
                        </>
                      )}
                      <td className="py-1"><input name={`diib_line_${l.id}`} defaultValue={l.diib_line ?? ""} className={`${inputCls} h-8 w-28 font-mono`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Tutar, miktar, KDV oranı gibi alanlar fatura işlendikten sonra değişmez; onlar için faturayı iptal edip yeniden kesin. Tevkifat oranı koda göre olmalı.</p>
            <div><PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit></div>
          </form>
        </details>
      )}
    </section>
  );
}
