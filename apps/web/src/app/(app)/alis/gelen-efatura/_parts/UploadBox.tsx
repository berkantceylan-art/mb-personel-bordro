"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { einvAddXmls } from "@/lib/einv-actions";

/** XML / ZIP dosyaları tarayıcıda açılır, XML'ler parça parça sunucuya gönderilir */
export function UploadBox() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setOut(null);
    const xmls: Array<{ name: string; xml: string }> = [];
    const errs: string[] = [];
    const readZip = async (name: string, data: ArrayBuffer) => {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(data);
      for (const e of Object.values(zip.files)) {
        if (e.dir) continue;
        if (/\.xml$/i.test(e.name)) xmls.push({ name: `${name} › ${e.name}`, xml: await e.async("string") });
        else if (/\.zip$/i.test(e.name)) await readZip(e.name, await e.async("arraybuffer"));
      }
    };
    for (const f of Array.from(files)) {
      try {
        if (/\.zip$/i.test(f.name)) await readZip(f.name, await f.arrayBuffer());
        else if (/\.xml$/i.test(f.name)) xmls.push({ name: f.name, xml: await f.text() });
      } catch (e) { errs.push(`${f.name}: ${(e as Error).message}`); }
    }
    let added = 0, dup = 0, imp = 0, skip = 0;
    let batch: typeof xmls = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const r = await einvAddXmls(batch);
      if (!r.ok) errs.push(r.message);
      added += r.added; dup += r.duplicate; imp += r.imported; skip += r.skipped; errs.push(...r.errors);
      batch = []; size = 0;
    };
    for (const x of xmls) {
      if (size + x.xml.length > 2_500_000) await flush();
      if (x.xml.length > 3_500_000) { errs.push(`${x.name}: dosya çok büyük (gömülü PDF olabilir)`); continue; }
      batch.push(x); size += x.xml.length;
    }
    await flush();
    setOut(`${added} yeni e-fatura eklendi${dup ? ` · ${dup} zaten kutudaydı` : ""}${imp ? ` · ${imp} daha önce alışa aktarılmış` : ""}${skip ? ` · ${skip} dosya gelen e-fatura değil` : ""}${errs.length ? ` · ${errs.length} hata: ${errs.slice(0, 2).join("; ")}` : ""}`);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed border-[#B9CDE3] bg-white px-6 py-6 text-center cursor-pointer hover:border-brand-600"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}>
        <span className="font-semibold">{busy ? "Okunuyor…" : "Logo'dan / portaldan indirilen XML ya da ZIP dosyalarını bırakın veya seçin"}</span>
        <span className="text-xs text-muted">Aynı fatura iki kez eklenmez (ETTN). Kendi kestiğiniz satış faturaları atlanır.</span>
        <input type="file" accept=".xml,.zip,application/xml,text/xml,application/zip" multiple className="sr-only" disabled={busy} onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      </label>
      {out && <p className="text-sm">{out}</p>}
    </div>
  );
}
