"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { done, fail } from "@/lib/flash";
import { parseMoney } from "@/lib/jobs";
import { portalError } from "@/lib/supplier-portal";
import { fileAttachment, sendSupplierNotice } from "@/lib/supplier-notify";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const MAX = 20 * 1024 * 1024;

function refresh(party: string) {
  revalidatePath("/tedarikci", "layout");
  revalidatePath(`/satinalma/tedarikci/${party}`);
  revalidatePath("/satinalma/tedarikci-merkezi");
}

async function guard(party: string) {
  if (!UUID.test(party)) await fail("Tedarikçi seçilmemiş.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("sup_can", { p_party: party });
  if (error) await fail(portalError(error.message));
  if (!data) await fail("Bu tedarikçi için yetkiniz yok.");
  return sb;
}

/** Dosyayı kovaya yükleyip belge kaydı açar; belge id döner */
async function storeDoc(sb: Awaited<ReturnType<typeof createClient>>, party: string, file: File, meta: { kind?: string; title?: string; po_id?: string; note?: string; valid_until?: string }) {
  if (file.size > MAX) await fail("Dosya 20 MB'tan büyük olamaz.");
  const safe = file.name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80) || "belge";
  const path = `${party}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
  const { error: up } = await createAdminClient().storage.from("supplier-files").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream" });
  if (up) await fail(`Dosya yüklenemedi: ${up.message}`);
  const { data, error } = await sb.rpc("sup_doc_add", {
    p: { party_id: party, file_path: path, file_name: file.name.slice(0, 200), mime: file.type || null, size: file.size, kind: meta.kind || "other", title: meta.title || file.name, po_id: meta.po_id || null, note: meta.note || null, valid_until: meta.valid_until || null },
  });
  if (error) {
    await createAdminClient().storage.from("supplier-files").remove([path]);
    await fail(portalError(error.message));
  }
  return { id: data as string, path, name: file.name, mime: file.type };
}

/** Mesaj gönder (tedarikçi ya da laboratuvar). Laboratuvar tarafı e-posta / WhatsApp da seçebilir. */
export async function sendPortalMessage(f: FormData) {
  const party = str(f, "party_id");
  const sb = await guard(party);
  const body = str(f, "body");
  const file = f.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!body && !hasFile) await fail("Mesaj yazın ya da dosya ekleyin.");
  const po = UUID.test(str(f, "po_id")) ? str(f, "po_id") : null;
  const doc = hasFile ? await storeDoc(sb, party, file as File, { kind: str(f, "kind") || "other", po_id: po ?? undefined }) : null;
  const channels = f.getAll("via").map(String).filter((x) => x === "email" || x === "whatsapp");
  const { data: mine } = await sb.rpc("sup_is_mine", { p_party: party });
  const lab = !mine;
  const text = body || `Belge gönderildi: ${(file as File).name}`;
  const { error } = await sb.rpc("sup_message_send", { p_party: party, p_body: text, p_po: po, p_doc: doc?.id ?? null, p_via: ["portal", ...(lab ? channels : [])] });
  if (error) await fail(portalError(error.message));
  let note = "";
  if (lab && channels.length) {
    const { data: co } = await sb.from("companies").select("name").limit(1).maybeSingle();
    const r = await sendSupplierNotice({
      partyId: party, subject: `${(co?.name as string) || "MB Dental"}: yeni mesaj`, text, email: channels.includes("email"), whatsapp: channels.includes("whatsapp"), path: "/tedarikci/mesajlar",
      attachment: doc ? await fileAttachment(doc.path, doc.name, doc.mime) : null,
    });
    note = r.via.length ? ` · ${r.via.map((v) => (v === "email" ? "e-posta" : "WhatsApp")).join(" + ")} ile de gönderildi` : "";
    if (r.errors.length) note += ` · ${r.errors.join(" · ")}`;
  }
  refresh(party);
  await done(`Mesaj gönderildi${note}.`);
}

/** Belge yükle */
export async function uploadPortalDoc(f: FormData) {
  const party = str(f, "party_id");
  const sb = await guard(party);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) await fail("Dosya seçin.");
  const doc = await storeDoc(sb, party, file as File, { kind: str(f, "kind"), title: str(f, "title"), po_id: str(f, "po_id"), note: str(f, "note"), valid_until: str(f, "valid_until") });
  let note = "";
  const { data: mine } = await sb.rpc("sup_is_mine", { p_party: party });
  if (!mine && (f.get("email") === "on" || f.get("whatsapp") === "on")) {
    const r = await sendSupplierNotice({
      partyId: party, subject: `Belge: ${str(f, "title") || (file as File).name}`, text: `Size bir belge gönderdik: ${str(f, "title") || (file as File).name}${str(f, "note") ? `\n${str(f, "note")}` : ""}`,
      email: f.get("email") === "on", whatsapp: f.get("whatsapp") === "on", path: "/tedarikci/belgeler", attachment: await fileAttachment(doc.path, doc.name, doc.mime),
    });
    note = r.via.length ? ` · ${r.via.map((v) => (v === "email" ? "e-posta" : "WhatsApp")).join(" + ")} ile bildirildi` : "";
    if (r.errors.length) note += ` · ${r.errors.join(" · ")}`;
  }
  refresh(party);
  await done(`Belge yüklendi${note}.`);
}

export async function removePortalDoc(f: FormData) {
  const party = str(f, "party_id");
  const sb = await guard(party);
  const { error } = await sb.rpc("sup_doc_remove", { p_id: str(f, "id") });
  if (error) await fail(portalError(error.message));
  refresh(party);
  await done("Belge kaldırıldı.");
}

/** Tedarikçi yeni fiyat listesi gönderir. Alanlar: p_<anahtar> (yeni fiyat), meta_<anahtar> (JSON), new_name_i / new_unit_i / new_price_i */
export async function submitPriceList(f: FormData) {
  const party = str(f, "party_id");
  const sb = await guard(party);
  const lines: Record<string, unknown>[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("p_")) continue;
    const price = parseMoney(String(v));
    if (price == null || !String(v).trim()) continue;
    const meta = JSON.parse(str(f, `meta_${k.slice(2)}`) || "{}") as { item_id?: string; code?: string; name?: string; unit?: string; old_price?: number; old_currency?: string };
    lines.push({ ...meta, new_price: price });
  }
  for (let i = 0; i < 20; i++) {
    const name = str(f, `new_name_${i}`), price = parseMoney(str(f, `new_price_${i}`));
    if (name && price != null) lines.push({ name, unit: str(f, `new_unit_${i}`) || "adet", code: str(f, `new_code_${i}`) || null, new_price: price });
  }
  if (!lines.length) await fail("En az bir ürüne yeni fiyat girin.");
  const file = f.get("file");
  const doc = file instanceof File && file.size ? await storeDoc(sb, party, file, { kind: "price_list", title: str(f, "title") || "Fiyat listesi" }) : null;
  const { error } = await sb.rpc("sup_price_submit", {
    p: { party_id: party, title: str(f, "title"), currency: str(f, "currency") || "TRY", valid_from: str(f, "valid_from") || null, note: str(f, "note"), doc_id: doc?.id ?? null, lines },
  });
  if (error) await fail(portalError(error.message));
  refresh(party);
  await done(`Fiyat listesi gönderildi (${lines.length} kalem). Satın alma onaylayınca geçerli olur.`);
}

/** Satın alma fiyat listesi kararı */
export async function decidePriceList(f: FormData) {
  const party = str(f, "party_id");
  const sb = await guard(party);
  const reject = str(f, "reject") === "1";
  const ids = f.getAll("line").map(String).filter((x) => UUID.test(x));
  if (!reject && !ids.length) await fail("Onaylanacak kalemleri seçin ya da listeyi reddedin.");
  const { data, error } = await sb.rpc("pur_price_decide", { p_list: str(f, "id"), p_lines: reject ? null : ids, p_reject: reject, p_note: str(f, "note") || null });
  if (error) await fail(portalError(error.message));
  refresh(party);
  revalidatePath("/stok/urunler");
  await done(reject ? "Fiyat listesi reddedildi; tedarikçiye bildirildi." : `Onaylandı: ${data} stok kartının alış fiyatı güncellendi; tedarikçiye bildirildi.`);
}

/** Ödeme planı ekle / güncelle */
export async function savePayPlan(f: FormData) {
  const sb = await createClient();
  const amount = parseMoney(str(f, "amount"));
  const party = str(f, "party_id");
  const { error } = await sb.rpc("pay_plan_save", {
    p: { id: str(f, "id") || null, party_id: party, due_date: str(f, "due_date"), amount, currency: str(f, "currency") || "TRY", method: str(f, "method") || "transfer", note: str(f, "note"),
      remind_days: Number(str(f, "remind_days") || 3), notify_supplier: f.get("notify_supplier") === "on", show_supplier: f.get("show_supplier") !== "off" && f.get("hide_supplier") !== "on" },
  });
  if (error) await fail(portalError(error.message));
  revalidatePath("/satinalma/odeme-takvimi");
  if (UUID.test(party)) refresh(party);
  await done("Ödeme planlandı; vadeden önce hatırlatma gelecek.");
}

export async function setPayPlanStatus(f: FormData) {
  const sb = await createClient();
  const { error } = await sb.rpc("pay_plan_status", { p_id: str(f, "id"), p_status: str(f, "status") });
  if (error) await fail(portalError(error.message));
  revalidatePath("/satinalma/odeme-takvimi");
  const party = str(f, "party_id");
  if (UUID.test(party)) refresh(party);
  await done(str(f, "status") === "paid" ? "Ödendi olarak işaretlendi. Ödemeyi finansta da kaydetmeyi unutmayın." : "Plan iptal edildi.");
}

export async function savePaySettings(f: FormData) {
  const sb = await createClient();
  const { error } = await sb.rpc("pay_settings_save", { p_days: Number(str(f, "days") || 3), p_supplier: f.get("supplier") === "on" });
  if (error) await fail(portalError(error.message));
  revalidatePath("/satinalma/odeme-takvimi");
  await done("Hatırlatma ayarları kaydedildi.");
}

export async function savePortalSettings(f: FormData) {
  const party = str(f, "party_id");
  const sb = await createClient();
  const { error } = await sb.rpc("sup_portal_settings_save", { p_party: party, p_ledger: f.get("ledger") === "on", p_slip: f.get("slip") === "on" });
  if (error) await fail(portalError(error.message));
  refresh(party);
  await done("Portal görünürlüğü kaydedildi.");
}

/** Siparişin faturalı / faturasız yöntemi */
export async function setPOBilling(f: FormData) {
  const id = str(f, "id");
  const sb = await createClient();
  const { error } = await sb.rpc("pur_order_set_billing", { p_id: id, p_billing: str(f, "billing") });
  if (error) await fail(portalError(error.message));
  revalidatePath(`/alis/siparisler/${id}`);
  await done(str(f, "billing") === "slip" ? "Faturasız (fişli) olarak işaretlendi: mal kabul fişli cariye işlenir." : "Faturalı olarak işaretlendi.");
}
