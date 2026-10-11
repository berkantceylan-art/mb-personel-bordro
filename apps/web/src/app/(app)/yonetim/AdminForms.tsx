"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useState } from "react";
import { saveBranch } from "./actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type R = { ok: boolean; message: string } | null;
const Msg = ({ s }: { s: R }) => (s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null);

export function BranchForm({ branch }: { branch?: { id: string; name: string; address: string | null; lat: number | null; lng: number | null; radius_m: number; mobile_punch_enabled: boolean } }) {
  const { state, pending, formProps: actionProps } = useActionForm(saveBranch);
  const [lat, setLat] = useState(branch?.lat?.toString() ?? "");
  const [lng, setLng] = useState(branch?.lng?.toString() ?? "");
  const [geoMsg, setGeoMsg] = useState("");
  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg("Tarayıcı konum desteklemiyor.");
    setGeoMsg("Konum alınıyor…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setGeoMsg(`Doğruluk ±${Math.round(p.coords.accuracy)} m`); },
      () => setGeoMsg("Konum izni verilmedi."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <form {...actionProps} className="grid gap-3 md:grid-cols-6 items-end">
      {branch && <input type="hidden" name="id" value={branch.id} />}
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Şube adı<input name="name" required defaultValue={branch?.name} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-4">Adres<input name="address" defaultValue={branch?.address ?? ""} className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Enlem<input name="lat" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Boylam<input name="lng" value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" className={input} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-muted">Yarıçap (m)<input name="radius_m" type="number" min={30} max={2000} defaultValue={branch?.radius_m ?? 150} className={input} /></label>
      <button type="button" onClick={locate} className="h-11 px-3 rounded-[10px] border border-[#D5DEE8] bg-white text-sm font-semibold text-brand-700">Şu anki konumumu kullan</button>
      <label className="flex gap-2 items-center text-sm h-11"><input type="checkbox" name="mobile_punch_enabled" defaultChecked={branch?.mobile_punch_enabled ?? true} className="w-5 h-5" />Mobil giriş açık</label>
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{branch ? "Kaydet" : "Şube ekle"}</button>
      <div className="md:col-span-6 flex gap-3 items-center text-xs text-muted">{geoMsg}<Msg s={state} /></div>
    </form>
  );
}
