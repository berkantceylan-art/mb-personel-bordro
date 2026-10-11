"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readReceipt, submitClaim, type ReceiptData } from "@/lib/expense-actions";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls, textareaCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";

/** Masraf beyanı: fiş fotoğrafı çek / yükle → (isteğe bağlı) yapay zekâ ile oku → gönder */
export function ClaimForm({ userId, categories, today, employees, accounts }: {
  userId: string; categories: { id: string; name: string }[]; today: string; employees?: { id: string; name: string }[]; accounts?: { id: string; name: string }[];
}) {
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "upload" | "ai">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [v, setV] = useState<ReceiptData & { category_id?: string }>({ date: today, vat_rate: 20 });
  const [ai, setAi] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setMsg({ ok: false, text: "Dosya 10 MB'tan büyük." }); return; }
    setBusy("upload"); setMsg(null);
    let blob: Blob = f;
    // telefon fotoğrafını küçült (okuma ve depolama için yeterli)
    if (f.type.startsWith("image/") && f.size > 1_200_000) {
      try {
        const img = await createImageBitmap(f);
        const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), "image/jpeg", 0.85));
      } catch { blob = f; }
    }
    const ext = blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : "jpg";
    const p = `${userId}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await createClient().storage.from("receipts").upload(p, blob, { contentType: blob.type || "image/jpeg" });
    setBusy("");
    if (error) { setMsg({ ok: false, text: `Yüklenemedi: ${error.message}` }); return; }
    setPath(p);
    setPreview(blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null);
  }

  async function read() {
    if (!path) return;
    setBusy("ai"); setMsg(null);
    const r = await readReceipt(path, categories.map((c) => c.name));
    setBusy("");
    if (!r.ok || !r.data) { setMsg({ ok: false, text: r.message ?? "Okunamadı." }); return; }
    const d = r.data;
    const cat = categories.find((c) => c.name === d.category);
    setV((x) => ({ ...x, ...Object.fromEntries(Object.entries(d).filter(([, val]) => val !== "" && val !== null && val !== undefined)), category_id: cat?.id ?? x.category_id }));
    setAi(JSON.stringify(d));
    setMsg({ ok: true, text: "Fiş okundu; alanları kontrol edip gönderin." });
  }

  return (
    <form ref={formRef} action={submitClaim} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="receipt_path" value={path ?? ""} />
      <input type="hidden" name="ai" value={ai} />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <label className={`${btnSecondary} cursor-pointer`}>
          📷 {path ? "Fişi değiştir" : "Fiş fotoğrafı / PDF"}
          <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {path && <button type="button" onClick={read} disabled={busy !== ""} className={btnSecondary}>{busy === "ai" ? "Okunuyor…" : "✨ Fişi otomatik oku"}</button>}
        {busy === "upload" && <span className="text-sm text-muted">Yükleniyor…</span>}
        {preview && <img src={preview} alt="Fiş" className="h-20 rounded-lg border border-line object-cover" />}
        {path && !preview && <span className="text-sm text-ok">PDF yüklendi</span>}
      </div>
      {msg && <div className="sm:col-span-2"><Notice tone={msg.ok ? "ok" : "bad"}>{msg.text}</Notice></div>}
      <Field label="Tutar (KDV dahil)"><input name="amount" required inputMode="decimal" value={v.amount ?? ""} onChange={(e) => setV({ ...v, amount: e.target.value })} className={`${inputCls} text-lg font-semibold`} /></Field>
      <Field label="KDV"><select name="vat_rate" value={String(v.vat_rate ?? 20)} onChange={(e) => setV({ ...v, vat_rate: Number(e.target.value) })} className={selectCls}>{[20, 10, 1, 0].map((r) => <option key={r} value={r}>%{r}</option>)}</select></Field>
      <Field label="Tarih"><input type="date" name="expense_date" value={v.date ?? today} onChange={(e) => setV({ ...v, date: e.target.value })} className={inputCls} /></Field>
      <Field label="Masraf türü">
        <select name="category_id" value={v.category_id ?? ""} onChange={(e) => setV({ ...v, category_id: e.target.value })} className={selectCls}>
          <option value="">Seçin</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Satıcı / firma"><input name="vendor" value={v.vendor ?? ""} onChange={(e) => setV({ ...v, vendor: e.target.value })} maxLength={160} className={inputCls} /></Field>
      <Field label="Satıcı VKN"><input name="vendor_tax_no" value={v.vendor_tax_no ?? ""} onChange={(e) => setV({ ...v, vendor_tax_no: e.target.value.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" className={inputCls} /></Field>
      <Field label="Fiş / fatura no"><input name="doc_no" value={v.doc_no ?? ""} onChange={(e) => setV({ ...v, doc_no: e.target.value })} maxLength={60} className={inputCls} /></Field>
      {employees && (
        <Field label="Personel" hint="boş = şirket masrafı">
          <select name="employee_id" className={selectCls}><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        </Field>
      )}
      {accounts && (
        <Field label="Ödendiği hesap" hint="onayda değiştirilebilir">
          <select name="account_id" className={selectCls}><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </Field>
      )}
      <Field label="Açıklama" className="sm:col-span-2"><textarea name="description" rows={2} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={500} className={textareaCls} /></Field>
      <div className="sm:col-span-2"><PendingSubmit className={btnPrimary}>Gönder</PendingSubmit></div>
    </form>
  );
}
