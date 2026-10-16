"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadReceipt } from "@/lib/upload-receipt";
import { attachInvoiceFile, deleteInvoiceFile } from "@/lib/invoice-file-actions";

export type InvFile = { id: string; name: string | null; mime: string | null; url: string | null; created_at: string };

/** Fatura ayrıntısında: kağıt fatura / fiş / e-Arşiv görüntüsü ekle, gör, sil */
export function InvoiceFiles({ invoiceId, userId, files, canEdit, missing }: { invoiceId: string; userId: string; files: InvFile[]; canEdit: boolean; missing?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setMsg(null);
    for (const f of Array.from(list)) {
      const u = await uploadReceipt(f, userId);
      if (u.error || !u.path) { setMsg({ ok: false, text: u.error ?? "Yüklenemedi" }); setBusy(false); return; }
      const r = await attachInvoiceFile(invoiceId, u.path, f.name, u.mime ?? null, u.size ?? null);
      if (!r.ok) { setMsg({ ok: false, text: r.message }); setBusy(false); return; }
    }
    setBusy(false); setMsg({ ok: true, text: "Görüntü kaydedildi." }); router.refresh();
  }
  async function del(id: string) {
    if (!confirm("Bu görüntü silinsin mi?")) return;
    const r = await deleteInvoiceFile(id);
    setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh();
  }

  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3" id="gorsel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-bold mr-auto">Fatura görüntüsü</h2>
        {canEdit && !missing && (
          <label className={`h-10 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700 cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
            {busy ? "Yükleniyor…" : "📎 Fotoğraf / PDF ekle"}
            <input type="file" multiple accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>
      {missing && <p className="text-sm text-muted">Görüntü eklemek için Supabase&apos;de mbdental-fatura-gorsel.sql çalıştırılmalı.</p>}
      {!missing && !files.length && <p className="text-sm text-muted">Henüz görüntü eklenmedi. Kağıt fatura, fiş ya da e-Arşiv çıktısının fotoğrafını ekleyebilirsiniz.</p>}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {files.map((f) => (
            <li key={f.id} className="w-36 flex flex-col gap-1">
              <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="block h-40 rounded-xl border border-line overflow-hidden bg-[#F6F8FB] grid place-items-center">
                {f.url && f.mime?.startsWith("image/") && f.mime !== "image/heic"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={f.url} alt={f.name ?? "Fatura görüntüsü"} className="w-full h-full object-cover" />
                  : <span className="text-3xl" aria-hidden>📄</span>}
              </a>
              <span className="text-xs truncate" title={f.name ?? ""}>{f.name ?? "Görüntü"}</span>
              {canEdit && <button type="button" onClick={() => void del(f.id)} className="text-xs text-bad text-left">Sil</button>}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role="status" className={`text-sm rounded-lg px-3 py-1.5 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
    </section>
  );
}
