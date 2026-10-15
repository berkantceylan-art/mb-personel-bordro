"use client";
import { useActionForm } from "@/lib/use-action-form";
import { useState } from "react";
import { saveBranch } from "./actions";
import { DoorButton } from "@/components/DoorButton";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type R = { ok: boolean; message: string } | null;
const Msg = ({ s }: { s: R }) => (s ? <span role="status" className={`text-sm rounded-lg px-3 py-1.5 ${s.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{s.message}</span> : null);

export function BranchForm({ branch, doorReady }: { branch?: { id: string; name: string; address: string | null; lat: number | null; lng: number | null; radius_m: number; mobile_punch_enabled: boolean; door_enabled?: boolean; door_device_id?: string | null; door_channel?: number; door_pulse_s?: number; door_gps_m?: number }; doorReady?: boolean }) {
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
      {branch && "door_enabled" in branch && (
        <fieldset className="md:col-span-6 grid gap-3 md:grid-cols-6 items-end rounded-[12px] border border-line bg-[#F7F9FC] p-3">
          <legend className="px-1 text-sm font-semibold text-brand-800">🚪 Kapı rölesi (girişte kapıyı otomatik aç)</legend>
          <input type="hidden" name="door_section" value="1" />
          <label className="flex gap-2 items-center text-sm h-11 md:col-span-2"><input type="checkbox" name="door_enabled" defaultChecked={branch.door_enabled} className="w-5 h-5" />Girişte kapıyı aç</label>
          <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Röle cihaz kimliği (Shelly Device Id)<input name="door_device_id" defaultValue={branch.door_device_id ?? ""} placeholder="ör. a0b1c2d3e4f5" autoComplete="off" className={`${input} font-mono`} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Açık tutma (sn)<input name="door_pulse_s" type="number" min={1} max={10} defaultValue={branch.door_pulse_s ?? 1} className={input} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">Röle kanalı<select name="door_channel" defaultValue={branch.door_channel ?? 0} className={input}>{[0, 1, 2, 3].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-sm text-muted md:col-span-2">Konumla açma mesafesi (m, 0 = sadece QR)<input name="door_gps_m" type="number" min={0} max={200} defaultValue={branch.door_gps_m ?? 30} className={input} /></label>
          <div className="md:col-span-4 flex flex-wrap gap-3 items-center">
            <DoorButton branchId={branch.id} label="Test: kapıyı şimdi aç" />
            <span className="text-xs text-muted">{doorReady ? "Röle bağlantısı hazır." : "Vercel'e SHELLY_CLOUD_SERVER ve SHELLY_CLOUD_KEY eklenmeli."} Kapı yalnızca <b>girişte</b> açılır: QR&apos;da kapıdaki ekranın güncel kodu, konumda kapıya bu mesafeden yakınlık ve iyi konum doğruluğu gerekir. Konumla açma için şube enlem/boylamını kapının önünde alın.</span>
          </div>
        </fieldset>
      )}
      <div className="md:col-span-6 flex gap-3 items-center text-xs text-muted">{geoMsg}<Msg s={state} /></div>
    </form>
  );
}
