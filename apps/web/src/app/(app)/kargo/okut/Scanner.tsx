"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { STATUS, type ShipStatus } from "@/lib/shipments";
import { findShipment, receiveByScan } from "../actions";

type Hit = { id: string; no: number; status: ShipStatus; label: string };

/** Telefon kamerasıyla takip numarası / barkod okutma (yazarak da aranabilir) */
export function Scanner() {
  const video = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [on, setOn] = useState(false);
  const [code, setCode] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => stopRef.current?.(), []);

  async function lookup(value: string) {
    const v = value.trim();
    if (!v) return;
    setCode(v);
    setBusy(true);
    setHits(await findShipment(v));
    setBusy(false);
  }

  async function start() {
    setMsg(null);
    setHits(null);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setOn(true);
      const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (result) => {
        if (result) {
          controls.stop();
          setOn(false);
          if (navigator.vibrate) navigator.vibrate(80);
          void lookup(result.getText());
        }
      });
      stopRef.current = () => controls.stop();
    } catch {
      setOn(false);
      setMsg("Kamera açılamadı. Tarayıcıya kamera izni verin ya da numarayı yazın.");
    }
  }

  function stop() {
    stopRef.current?.();
    setOn(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] max-h-[60vh]">
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        {!on && (
          <button type="button" onClick={start} className="absolute inset-0 grid place-items-center text-white text-lg font-semibold">
            📷 Kamerayı aç ve barkodu okut
          </button>
        )}
        {on && <div className="absolute inset-x-8 top-1/2 h-0.5 bg-red-500/80" aria-hidden="true" />}
      </div>
      {on && <button type="button" onClick={stop} className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-muted">Kamerayı kapat</button>}

      <form onSubmit={(e) => { e.preventDefault(); void lookup(code); }} className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Takip no ya da G123" autoCapitalize="characters" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3 bg-white flex-1 font-mono text-base" />
        <button disabled={busy} className="h-12 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{busy ? "…" : "Ara"}</button>
      </form>
      {msg && <p className="text-sm text-bad">{msg}</p>}

      {hits && (
        <div className="flex flex-col gap-2">
          {hits.map((h) => (
            <div key={h.id} className="rounded-xl border border-line bg-white p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-48">
                <Link href={`/kargo/${h.id}`} className="font-semibold text-brand-700">G{h.no}</Link>
                <div className="text-sm text-muted">{h.label}</div>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${STATUS[h.status][1]}`}>{STATUS[h.status][0]}</span>
              {["expected", "in_transit", "at_customs", "out_for_delivery"].includes(h.status) && (
                <form action={receiveByScan}>
                  <input type="hidden" name="id" value={h.id} />
                  <button className="h-10 px-4 rounded-[10px] bg-ok text-white font-semibold">Teslim aldım</button>
                </form>
              )}
            </div>
          ))}
          {hits.length === 0 && (
            <div className="rounded-xl border border-warn bg-warn-bg p-3 flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm text-warn">Bu numarayla kayıt yok. Haber verilmemiş bir paket olabilir.</p>
              <form action={receiveByScan}>
                <input type="hidden" name="code" value={code} />
                <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Yeni gelen paket olarak aç</button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
