"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { recordShipmentFile, setShipmentStatus } from "./actions";

/** Telefon fotoğrafını küçült (en uzun kenar 1600 px, JPEG) — yükleme hızlı, depo küçük */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
}

async function upload(shipmentId: string, blob: Blob, name: string, kind: "photo" | "document" | "signature") {
  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80) || "dosya";
  const path = `${shipmentId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await createClient().storage.from("shipment-files").upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: false });
  if (error) return { ok: false, message: error.message.includes("Bucket not found") ? "Depo yok: Supabase'de 20261124000000_shipments.sql çalıştırılmalı." : error.message };
  return recordShipmentFile({ shipmentId, path, kind, name });
}

/** Açılış fotoğrafı / gümrük belgesi yükleme (telefonda kamera açılır) */
export function ShipmentUploader({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null, kind: "photo" | "document") {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    let okCount = 0;
    for (const f of Array.from(files).slice(0, 10)) {
      const blob = kind === "photo" ? await shrink(f) : f;
      const name = kind === "photo" && blob !== f ? f.name.replace(/\.\w+$/, "") + ".jpg" : f.name;
      const r = await upload(shipmentId, blob, name, kind);
      if (r.ok) okCount++;
      else setMsg(r.message);
    }
    setBusy(false);
    if (okCount) {
      setMsg(`${okCount} dosya yüklendi.`);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={photo} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files, "photo")} />
      <input ref={doc} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => onFiles(e.target.files, "document")} />
      <button type="button" disabled={busy} onClick={() => photo.current?.click()} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">
        {busy ? "Yükleniyor…" : "📷 Fotoğraf çek"}
      </button>
      <button type="button" disabled={busy} onClick={() => doc.current?.click()} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700 disabled:opacity-60">
        Belge ekle (PDF)
      </button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}

/** Kurye teslimi: alıcı imzası + "teslim edildi / teslim alındı" */
export function DeliverySign({ shipmentId, doneStatus, label }: { shipmentId: string; doneStatus: "delivered" | "arrived"; label: string }) {
  const router = useRouter();
  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const data = pad.current?.toDataURL() ?? "";
    if (data) {
      const blob = await (await fetch(data)).blob();
      const r = await upload(shipmentId, blob, `imza-${(name || "alici").replace(/\s+/g, "-")}.png`, "signature");
      if (!r.ok) {
        setBusy(false);
        return setMsg(r.message);
      }
    }
    const f = new FormData();
    f.set("id", shipmentId);
    f.set("status", doneStatus);
    if (name) f.set("note", `Teslim eden / alan: ${name}`);
    try {
      await setShipmentStatus(f);
    } catch {
      // setShipmentStatus yönlendirme ile döner; sayfayı tazele
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Teslim alan / eden kişinin adı" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white" />
      <div className="h-40 rounded-xl border border-[#D5DEE8] bg-white overflow-hidden">
        <SignaturePad ref={pad} />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => pad.current?.clear()} className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-muted">Temizle</button>
        <button type="button" disabled={busy} onClick={submit} className="h-11 px-5 rounded-[10px] bg-ok text-white font-semibold disabled:opacity-60">{busy ? "Kaydediliyor…" : label}</button>
      </div>
      {msg && <p className="text-sm text-bad">{msg}</p>}
    </div>
  );
}
